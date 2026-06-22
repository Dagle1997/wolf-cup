/**
 * claim-write.ts (Story 2.1) — the append + current-state derivation service
 * for the APPEND-ONLY `hole_claim_writes` log.
 *
 * ⚠️ DESIGN DECISION (Josh-approved): append-only, NOT a mutable cell table.
 *   - `appendClaimWrite` APPENDS a row via INSERT … ON CONFLICT(client_event_id)
 *     DO NOTHING. A replay of the same client_event_id (set OR remove) is a
 *     no-op (returns { deduped: true }). There is NO cell-upsert, NO 409, NO
 *     hard delete — a `remove` is just a later write.
 *   - `seq` is the DB-assigned INTEGER PRIMARY KEY AUTOINCREMENT (rowid alias):
 *     monotonic, never reused, collision-free even under concurrent writers
 *     (no application-side MAX(seq)+1, which could tie two in-flight writes).
 *     It is the order key the current-state derivation sorts by (NEVER the
 *     client `created_at`).
 *   - `deriveCurrentClaims` returns the current claim set = the latest-seq write
 *     per cell where op='set' (op='remove'-latest cells are absent). This makes
 *     resurrection impossible: a stale `set` replay is deduped, and a later
 *     `remove` always wins.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { db as DbType } from '../db/index.js';
import { holeClaimWrites } from '../db/schema/index.js';

type Db = typeof DbType;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const CLAIM_TYPES = ['greenie', 'polie', 'sandie'] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];
export const CLAIM_OPS = ['set', 'remove'] as const;
export type ClaimOp = (typeof CLAIM_OPS)[number];

export function isClaimType(v: unknown): v is ClaimType {
  return typeof v === 'string' && (CLAIM_TYPES as readonly string[]).includes(v);
}
export function isClaimOp(v: unknown): v is ClaimOp {
  return typeof v === 'string' && (CLAIM_OPS as readonly string[]).includes(v);
}

export interface AppendClaimWriteArgs {
  id: string;
  roundId: string;
  playerId: string;
  holeNumber: number;
  claimType: ClaimType;
  op: ClaimOp;
  scorerPlayerId: string;
  clientEventId: string;
  tenantId: string;
  contextId: string;
  now: number;
}

export interface AppendClaimWriteResult {
  /** true => the row was appended; false => client_event_id replay no-op. */
  inserted: boolean;
  /** The server-assigned seq of the appended row (only when inserted). */
  seq?: number;
}

/**
 * Append a claim write (set or remove). Idempotent on client_event_id via
 * ON CONFLICT DO NOTHING. MUST run inside the caller's tx so the INSERT is
 * atomic with the caller's audit/activity.
 */
export async function appendClaimWrite(
  tx: Tx,
  args: AppendClaimWriteArgs,
): Promise<AppendClaimWriteResult> {
  // `seq` is the table's INTEGER PRIMARY KEY AUTOINCREMENT (rowid alias): the DB
  // assigns it under the write lock, so it is monotonic, never reused, and
  // collision-free even under concurrent writers — no application-side
  // MAX(seq)+1 (which could tie two in-flight writes and make "latest"
  // non-deterministic). We omit seq from VALUES and read it back via RETURNING.
  const result = await tx
    .insert(holeClaimWrites)
    .values({
      id: args.id,
      roundId: args.roundId,
      playerId: args.playerId,
      holeNumber: args.holeNumber,
      claimType: args.claimType,
      op: args.op,
      scorerPlayerId: args.scorerPlayerId,
      clientEventId: args.clientEventId,
      createdAt: args.now,
      tenantId: args.tenantId,
      contextId: args.contextId,
    })
    .onConflictDoNothing({ target: [holeClaimWrites.clientEventId] })
    .returning({ seq: holeClaimWrites.seq });

  if (result.length === 1) {
    return { inserted: true, seq: result[0]!.seq };
  }
  return { inserted: false };
}

/** A single active claim cell (op='set' was the latest write). */
export interface CurrentClaim {
  playerId: string;
  holeNumber: number;
  claimType: ClaimType;
}

/**
 * Derive the CURRENT claim set for a round = the latest-seq write per cell
 * (round_id, player_id, hole_number, claim_type) where the latest op is 'set'.
 * Cells whose latest write is a 'remove' are absent (resurrection-proof).
 *
 * `restrictToPlayerIds` (optional) scopes the read to a foursome's players so
 * the settlement path only loads its own foursome's claims (FR23 isolation).
 * Tenant-scoped. Pure derivation — no DB writes.
 */
export async function deriveCurrentClaims(
  txOrDb: Tx | Db,
  args: { roundId: string; tenantId: string; restrictToPlayerIds?: readonly string[] },
): Promise<CurrentClaim[]> {
  const conds = [
    eq(holeClaimWrites.roundId, args.roundId),
    eq(holeClaimWrites.tenantId, args.tenantId),
  ];
  if (args.restrictToPlayerIds !== undefined) {
    if (args.restrictToPlayerIds.length === 0) return [];
    conds.push(inArray(holeClaimWrites.playerId, [...args.restrictToPlayerIds]));
  }

  const rows = await txOrDb
    .select({
      seq: holeClaimWrites.seq,
      playerId: holeClaimWrites.playerId,
      holeNumber: holeClaimWrites.holeNumber,
      claimType: holeClaimWrites.claimType,
      op: holeClaimWrites.op,
    })
    .from(holeClaimWrites)
    .where(and(...conds));

  // Latest-seq write per cell. Fold in one pass keeping the highest seq.
  const latestByCell = new Map<string, { seq: number; op: string }>();
  for (const r of rows) {
    const key = `${r.playerId}|${r.holeNumber}|${r.claimType}`;
    const prev = latestByCell.get(key);
    if (prev === undefined || r.seq > prev.seq) {
      latestByCell.set(key, { seq: r.seq, op: r.op });
    }
  }

  const current: CurrentClaim[] = [];
  for (const [key, v] of latestByCell) {
    if (v.op !== 'set') continue; // latest write removed it → absent
    const [playerId, holeStr, claimType] = key.split('|');
    if (!isClaimType(claimType)) continue; // defensive (Zod-validated on write)
    current.push({
      playerId: playerId!,
      holeNumber: Number(holeStr),
      claimType,
    });
  }
  return current;
}
