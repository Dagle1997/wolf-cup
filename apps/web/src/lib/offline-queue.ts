import { openDB, type IDBPDatabase } from 'idb';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueueEntry {
  id?: number; // auto-increment keyPath; undefined before add()
  roundId: number;
  groupId: number;
  holeNumber: number; // primary sort key for drain order
  scores: Array<{ playerId: number; grossScore: number; putts?: number }>;
  wolfDecision: {
    decision: 'alone' | 'partner' | 'blind_wolf' | null;
    partnerId: number | null;
    greenies: number[];
    polies: number[];
    sandies: number[];
  } | null; // null when no wolf data to replay
  autoCalculateMoney: boolean;
  entryCode: string | null; // from session.entryCode
  timestamp: number; // Date.now() at enqueue time
}

// CTP entries queue separately from scores. Rationale: a CTP answer can be
// given for a hole whose scores went online successfully (user answered
// while connection flickered), so CTP entries aren't always bundled with a
// score QueueEntry. Draining order is: all score entries first (they create
// hole_completions server-side), then all CTP entries. The CTP POST
// requires the matching hole_completions row or it 422s HOLE_NOT_COMPLETE.
export interface CtpQueueEntry {
  id?: number;
  roundId: number;
  groupId: number;
  holeNumber: number; // 6 | 7 | 12 | 15
  winnerPlayerId: number | null; // null = "nobody hit the green"
  entryCode: string | null;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// DB singleton
// ---------------------------------------------------------------------------

const DB_NAME = 'wolf-cup-offline';
const STORE_NAME = 'score-queue';
const CTP_STORE_NAME = 'ctp-queue';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      // The upgrade callback only fires when the persisted DB version is
      // less than DB_VERSION. Inside it, create any missing stores
      // unconditionally — this is robust to users arriving from any prior
      // version, including edge cases where a store was never created on
      // an earlier bump.
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(CTP_STORE_NAME)) {
          db.createObjectStore(CTP_STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------

export async function enqueueScore(entry: Omit<QueueEntry, 'id'>): Promise<void> {
  const db = await getDB();
  await db.add(STORE_NAME, entry);
}

/**
 * Returns queued entries sorted by holeNumber ascending (drain order).
 * When roundId and groupId are provided, returns only entries for that
 * (round, group) — this is the drain path, and scoping is required so a
 * stale entry from a dead round can't block current sync.
 * Pass no args to get every entry (used by the orphan purge path).
 */
export async function getQueue(roundId?: number, groupId?: number): Promise<QueueEntry[]> {
  const db = await getDB();
  const all = (await db.getAll(STORE_NAME)) as QueueEntry[];
  const filtered = roundId !== undefined && groupId !== undefined
    ? all.filter((e) => e.roundId === roundId && e.groupId === groupId)
    : all;
  return filtered.sort((a, b) => a.holeNumber - b.holeNumber);
}

export async function removeFromQueue(id: number): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_NAME, id);
}

export async function getQueueCount(roundId: number, groupId: number): Promise<number> {
  const db = await getDB();
  const all = (await db.getAll(STORE_NAME)) as QueueEntry[];
  return all.filter((e) => e.roundId === roundId && e.groupId === groupId).length;
}

/**
 * Deletes every queue entry not matching (roundId, groupId).
 * Intended for an explicit "abandoned queue" cleanup — never called from the
 * normal drain path. Returns the number of entries removed.
 */
export async function purgeOrphanedEntries(
  activeRoundId: number,
  activeGroupId: number,
): Promise<number> {
  const db = await getDB();
  const all = (await db.getAll(STORE_NAME)) as QueueEntry[];
  const orphans = all.filter(
    (e) => e.roundId !== activeRoundId || e.groupId !== activeGroupId,
  );
  for (const entry of orphans) {
    if (entry.id !== undefined) await db.delete(STORE_NAME, entry.id);
  }
  // Also purge orphaned CTP entries for the same reason.
  const allCtp = (await db.getAll(CTP_STORE_NAME)) as CtpQueueEntry[];
  const ctpOrphans = allCtp.filter(
    (e) => e.roundId !== activeRoundId || e.groupId !== activeGroupId,
  );
  for (const entry of ctpOrphans) {
    if (entry.id !== undefined) await db.delete(CTP_STORE_NAME, entry.id);
  }
  return orphans.length + ctpOrphans.length;
}

// ---------------------------------------------------------------------------
// CTP queue operations
// ---------------------------------------------------------------------------

export async function enqueueCtpEntry(entry: Omit<CtpQueueEntry, 'id'>): Promise<void> {
  const db = await getDB();
  // Dedupe on (round, group, hole) — a later CTP answer for the same hole
  // replaces any earlier queued answer. Matches the server's upsert semantics.
  //
  // Wrapped in a single `readwrite` transaction so the find → delete → add
  // sequence is atomic. Without this, a rapid second enqueueCtpEntry call
  // could see the first call's pre-delete state and end up with duplicate
  // or lost entries (implicit per-call transactions commit independently).
  //
  // Deletes ALL prior matches, not just the first — defensive against any
  // pre-existing duplicates from an older buggy enqueue path.
  const tx = db.transaction(CTP_STORE_NAME, 'readwrite');
  const store = tx.objectStore(CTP_STORE_NAME);
  const all = (await store.getAll()) as CtpQueueEntry[];
  for (const e of all) {
    if (
      e.roundId === entry.roundId &&
      e.groupId === entry.groupId &&
      e.holeNumber === entry.holeNumber &&
      e.id !== undefined
    ) {
      await store.delete(e.id);
    }
  }
  await store.add(entry);
  await tx.done;
}

export async function getCtpQueue(
  roundId?: number,
  groupId?: number,
): Promise<CtpQueueEntry[]> {
  const db = await getDB();
  const all = (await db.getAll(CTP_STORE_NAME)) as CtpQueueEntry[];
  const filtered =
    roundId !== undefined && groupId !== undefined
      ? all.filter((e) => e.roundId === roundId && e.groupId === groupId)
      : all;
  // Sort by hole asc to drain par-3s in play order, same convention as scores.
  return filtered.sort((a, b) => a.holeNumber - b.holeNumber);
}

export async function removeCtpFromQueue(id: number): Promise<void> {
  const db = await getDB();
  await db.delete(CTP_STORE_NAME, id);
}

export async function getCtpQueueCount(roundId: number, groupId: number): Promise<number> {
  const db = await getDB();
  const all = (await db.getAll(CTP_STORE_NAME)) as CtpQueueEntry[];
  return all.filter((e) => e.roundId === roundId && e.groupId === groupId).length;
}
