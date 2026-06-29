/* PORTED from apps/web/src/lib/offline-queue.ts @ commit ddf921b29afe9b6b50a1f136021502770b180e65, dated 2026-04-27.
 *
 * Tournament deltas vs Wolf Cup:
 *   - DB name: wolf-cup-offline → tournament-offline
 *   - Object store: score-queue → mutation-queue (v1 carries 4 kinds)
 *   - REMOVED ctp-queue store + 4 functions (CTP is Wolf Cup-only; v1 tournament has no CTP)
 *   - REMOVED groupId / wolfDecision / autoCalculateMoney / entryCode fields
 *   - ADDED kind discriminator (4 v1 values)
 *   - ADDED clientEventId (FD-3 / FD-5 idempotency; CALLER-supplied UUID v4)
 *   - ADDED url + body fields (kind-agnostic dispatch)
 *   - ADDED conflictPending + lastError fields (409 retention path)
 *   - ADDED retryCount field (universal failsafe at MAX_TRANSIENT_RETRIES = 5)
 *   - ADDED mutation-queue-errored store (corrupted-entry quarantine)
 *   - ADDED registerTerminalErrors / getTerminalErrors (consumer-supplied per-kind classifications)
 */

import { openDB, type IDBPDatabase } from 'idb';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MutationKind =
  | 'hole_score'
  | 'sub_game_result'
  | 'scorer_handoff'
  | 'round_finalize'
  // F1 Epic 2 (Story 2.1) — a greenie/polie/sandie claim write (set OR remove).
  // Removal is ALSO a queued mutation (a `remove` op), never a client-only delete.
  | 'claim'
  // 2026-06-29 — a "take the snake" tap (single transferable token; latest wins).
  | 'snake';

/**
 * Single source of truth for the v1 mutation kinds at runtime. Kept module-
 * private so consumers can't mutate it; exposed via `isValidKind()` for
 * read-only checks. Eliminates drift risk between the type union and the
 * runtime guard while preventing external mutation.
 */
const VALID_KINDS_INTERNAL: ReadonlySet<MutationKind> = new Set([
  'hole_score',
  'sub_game_result',
  'scorer_handoff',
  'round_finalize',
  'claim',
  'snake',
]);

/** Read-only predicate. Returns true if `k` is a v1 MutationKind. */
export function isValidKind(k: unknown): k is MutationKind {
  return typeof k === 'string' && VALID_KINDS_INTERNAL.has(k as MutationKind);
}

export interface MutationEntry {
  id?: number;
  kind: MutationKind;
  url: string;
  body: unknown;
  /** Caller-supplied UUID v4. Validated non-empty at enqueue. */
  clientEventId: string;
  roundId: string;
  timestamp: number;
  retryCount: number;
  conflictPending?: boolean;
  lastError?: { status: number; body: unknown } | null;
}

/** Universal-failsafe threshold: a transient 4xx hits this many retries → purge. */
export const MAX_TRANSIENT_RETRIES = 5;

// ---------------------------------------------------------------------------
// DB singleton
// ---------------------------------------------------------------------------

const DB_NAME = 'tournament-offline';
const STORE_NAME = 'mutation-queue';
const ERRORED_STORE_NAME = 'mutation-queue-errored';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(ERRORED_STORE_NAME)) {
          db.createObjectStore(ERRORED_STORE_NAME, {
            keyPath: 'id',
            autoIncrement: true,
          });
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Test-only helper to close + reset the singleton between tests. NOT for
 * production use — guarded against accidental runtime invocation. Async
 * because closing the resolved IDBPDatabase before nulling the promise
 * is what unblocks subsequent indexedDB.deleteDatabase calls.
 */
export async function _resetDbForTests(): Promise<void> {
  if (typeof process === 'undefined') {
    throw new Error('_resetDbForTests is test-only (no process in browser)');
  }
  if (
    process.env['NODE_ENV'] !== 'test' &&
    process.env['VITEST'] !== 'true'
  ) {
    throw new Error('_resetDbForTests is test-only');
  }
  if (dbPromise !== null) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // Already closed / never resolved — nothing to clean up.
    }
    dbPromise = null;
  }
}

// ---------------------------------------------------------------------------
// Terminal-error registry (per-kind allowlist)
// ---------------------------------------------------------------------------

const terminalErrorRegistry = new Map<MutationKind, ReadonlyArray<string>>();

export function registerTerminalErrors(
  kind: MutationKind,
  codes: ReadonlyArray<string>,
): void {
  // Snapshot to a new frozen array so a caller mutating the original
  // doesn't silently reshape the registry contents.
  terminalErrorRegistry.set(kind, Object.freeze([...codes]));
}

export function getTerminalErrors(kind: MutationKind): ReadonlyArray<string> {
  return terminalErrorRegistry.get(kind) ?? [];
}

/**
 * Test-only registry reset. Guarded against accidental runtime invocation.
 */
export function _resetTerminalErrorsForTests(): void {
  if (typeof process === 'undefined') {
    throw new Error('_resetTerminalErrorsForTests is test-only (no process in browser)');
  }
  if (
    process.env['NODE_ENV'] !== 'test' &&
    process.env['VITEST'] !== 'true'
  ) {
    throw new Error('_resetTerminalErrorsForTests is test-only');
  }
  terminalErrorRegistry.clear();
}

// ---------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------

export type EnqueueInput = Omit<
  MutationEntry,
  'id' | 'timestamp' | 'retryCount' | 'conflictPending' | 'lastError'
>;

export async function enqueueMutation(entry: EnqueueInput): Promise<void> {
  if (!entry.clientEventId || entry.clientEventId.length === 0) {
    throw new Error(
      'enqueueMutation: clientEventId is required (caller-supplied UUID v4)',
    );
  }
  if (!isValidKind(entry.kind)) {
    throw new Error(`enqueueMutation: invalid kind '${entry.kind}'`);
  }
  if (!entry.url || entry.url.length === 0) {
    throw new Error('enqueueMutation: url is required');
  }
  if (entry.body === undefined) {
    throw new Error('enqueueMutation: body is required');
  }
  const db = await getDB();
  const row: Omit<MutationEntry, 'id'> = {
    kind: entry.kind,
    url: entry.url,
    body: entry.body,
    clientEventId: entry.clientEventId,
    roundId: entry.roundId,
    timestamp: Date.now(),
    retryCount: 0,
  };
  await db.add(STORE_NAME, row);
}

/**
 * Returns queued entries in id ASC order (FIFO insertion order).
 * When roundId is provided, returns only entries for that round.
 */
export async function getQueue(roundId?: string): Promise<MutationEntry[]> {
  const db = await getDB();
  const all = (await db.getAll(STORE_NAME)) as MutationEntry[];
  const filtered =
    roundId !== undefined ? all.filter((e) => e.roundId === roundId) : all;
  return filtered.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

export async function removeFromQueue(id: number): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_NAME, id);
}

export async function getQueueCount(roundId: string): Promise<number> {
  const db = await getDB();
  const all = (await db.getAll(STORE_NAME)) as MutationEntry[];
  return all.filter((e) => e.roundId === roundId).length;
}

/**
 * Persist mutated entry fields. Used by drain to update retryCount /
 * conflictPending / lastError without re-adding the row.
 */
export async function updateEntry(
  id: number,
  patch: Partial<Omit<MutationEntry, 'id'>>,
): Promise<void> {
  const db = await getDB();
  const existing = (await db.get(STORE_NAME, id)) as MutationEntry | undefined;
  if (!existing) return;
  const next: MutationEntry = { ...existing, ...patch, id };
  await db.put(STORE_NAME, next);
}

/**
 * Read-only peek into the errored quarantine bucket. Returns entries
 * scoped to `roundId` (or all if omitted). Used by T5-7's score-entry
 * stale-queue banner: when the active scorer changes mid-round, queued
 * mutations from the prior scorer drain → 403 → quarantine; the banner
 * surfaces those entries with the new scorer's name (read from each
 * entry's `lastError.body.currentScorerName`).
 */
export async function peekErroredEntries(
  roundId?: string,
): Promise<MutationEntry[]> {
  const db = await getDB();
  const all = (await db.getAll(ERRORED_STORE_NAME)) as MutationEntry[];
  const filtered =
    roundId !== undefined ? all.filter((e) => e.roundId === roundId) : all;
  return filtered.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

/**
 * Atomically move an entry from `mutation-queue` to `mutation-queue-errored`.
 */
export async function quarantineEntry(id: number): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([STORE_NAME, ERRORED_STORE_NAME], 'readwrite');
  const queueStore = tx.objectStore(STORE_NAME);
  const erroredStore = tx.objectStore(ERRORED_STORE_NAME);
  const row = (await queueStore.get(id)) as MutationEntry | undefined;
  if (row) {
    // Drop the source-store id; let the errored store assign a fresh one.
    const { id: _droppedId, ...rest } = row;
    await erroredStore.add(rest);
    await queueStore.delete(id);
  }
  await tx.done;
}

/**
 * resolveConflict('discard') — purge the entry. No body mutation.
 */
export function resolveConflict(
  id: number,
  action: 'discard',
): Promise<void>;
/**
 * resolveConflict('overwrite', body) — replace entry.body with caller-supplied
 * `overwriteBody` verbatim, clear conflictPending, reset retryCount = 0.
 * The CALLER constructs the wire shape; T5-3 does NOT mutate fields itself.
 */
export function resolveConflict(
  id: number,
  action: 'overwrite',
  overwriteBody: unknown,
): Promise<void>;
export async function resolveConflict(
  id: number,
  action: 'discard' | 'overwrite',
  overwriteBody?: unknown,
): Promise<void> {
  if (action === 'discard') {
    await removeFromQueue(id);
    return;
  }
  // 'overwrite' — overwriteBody is required (the second-arg overload).
  // Reject undefined explicitly so we never write a malformed entry that
  // would later be quarantined on the next drain pass.
  if (overwriteBody === undefined) {
    throw new Error(
      "resolveConflict('overwrite') requires a non-undefined overwriteBody",
    );
  }
  await updateEntry(id, {
    body: overwriteBody,
    conflictPending: false,
    retryCount: 0,
    lastError: null,
  });
}

/**
 * Deletes every queue entry not matching `activeRoundId`. Returns count removed.
 */
export async function purgeOrphanedEntries(activeRoundId: string): Promise<number> {
  const db = await getDB();
  const all = (await db.getAll(STORE_NAME)) as MutationEntry[];
  const orphans = all.filter((e) => e.roundId !== activeRoundId);
  for (const entry of orphans) {
    if (entry.id !== undefined) await db.delete(STORE_NAME, entry.id);
  }
  return orphans.length;
}
