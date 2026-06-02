// ---------------------------------------------------------------------------
// Pairing capture + diff
//
// Persists the engine's *generated* pairing at group creation (set-once) and
// diffs it against the round's current (final) group membership so the admin
// pairing audit can show what Jason changed by hand.
//
// Two concerns kept deliberately separate:
//   - serializeGroups / captureGeneratedPairingIfAbsent  → DB IO (not pure)
//   - computePairingDiff                                  → pure, unit-testable
// ---------------------------------------------------------------------------

import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { groups, roundPlayers, rounds } from '../db/schema.js';

/**
 * Accepts either the global `db` or an open transaction handle. Capture MUST
 * be called with the active `tx` when inside a transaction, or it won't see
 * the uncommitted round_players inserts and will snapshot empty/stale state.
 */
type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** One group's membership in the persisted/diff shape. */
export interface PairingGroup {
  groupNumber: number;
  playerIds: number[];
}

export interface PairingDiff {
  moved: { playerId: number; fromGroup: number; toGroup: number }[];
  added: { playerId: number; toGroup: number }[];
  removed: { playerId: number; fromGroup: number }[];
}

/**
 * Read the round's CURRENT groups + members as [{ groupNumber, playerIds }],
 * ordered by group number, members in insertion order. Does DB IO.
 *
 * Empty groups (no members) are omitted — the diff is player-centric, so a
 * group with no players contributes nothing to moved/added/removed.
 *
 * groupNumber is treated as the group's identity (ADR-4: stable, never
 * renumbered). If two group rows in one round shared a number — not enforced
 * by a DB constraint, but not produced by any current code path — their members
 * would merge under that number, which is the intended human-level semantic.
 */
export async function serializeGroups(
  roundId: number,
  dbx: DbOrTx = db,
): Promise<PairingGroup[]> {
  const rows = await dbx
    .select({
      groupNumber: groups.groupNumber,
      playerId: roundPlayers.playerId,
      rpId: roundPlayers.id,
    })
    .from(groups)
    .innerJoin(
      roundPlayers,
      and(eq(roundPlayers.groupId, groups.id), eq(roundPlayers.roundId, roundId)),
    )
    .where(eq(groups.roundId, roundId))
    .orderBy(groups.groupNumber, roundPlayers.id);

  const byGroup = new Map<number, number[]>();
  for (const r of rows) {
    let list = byGroup.get(r.groupNumber);
    if (!list) {
      list = [];
      byGroup.set(r.groupNumber, list);
    }
    list.push(r.playerId);
  }

  return [...byGroup.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([groupNumber, playerIds]) => ({ groupNumber, playerIds }));
}

/**
 * Set-once: write the generated-pairing snapshot ONLY if it is currently null.
 * Returns true if it captured, false if already set (idempotent — re-finalize
 * or a second call is a no-op). Snapshot is taken from committed DB state via
 * serializeGroups, never from a client payload.
 *
 * ⚠️ Pass the active `tx` when inside a transaction (see DbOrTx note).
 */
export async function captureGeneratedPairingIfAbsent(
  roundId: number,
  dbx: DbOrTx = db,
): Promise<boolean> {
  const existing = await dbx
    .select({ generatedPairing: rounds.generatedPairing })
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .get();

  // Fast path: round absent, or baseline already set (re-finalize / repeat call).
  if (!existing || existing.generatedPairing != null) return false;

  const snapshot = await serializeGroups(roundId, dbx);
  // Atomic set-once: the `IS NULL` predicate makes the write a no-op if another
  // path captured between our SELECT and here. rowsAffected tells us who won.
  const res = await dbx
    .update(rounds)
    .set({ generatedPairing: JSON.stringify(snapshot) })
    .where(and(eq(rounds.id, roundId), isNull(rounds.generatedPairing)));

  return (res.rowsAffected ?? 0) > 0;
}

/**
 * Shape guard for a persisted snapshot. A value that parses as JSON but isn't a
 * well-formed PairingGroup[] (wrong/corrupt shape) is rejected so callers can
 * treat the round as "not tracked" rather than throwing downstream.
 */
export function isValidSnapshot(x: unknown): x is PairingGroup[] {
  return (
    Array.isArray(x) &&
    x.every(
      (g) =>
        !!g &&
        typeof g === 'object' &&
        typeof (g as PairingGroup).groupNumber === 'number' &&
        Array.isArray((g as PairingGroup).playerIds) &&
        (g as PairingGroup).playerIds.every((id) => typeof id === 'number'),
    )
  );
}

/**
 * Pure in-memory diff of generated vs final group membership.
 *
 * - In both, different group  → moved (fromGroup → toGroup)
 * - Only in final             → added (a sub or late addition)
 * - Only in generated         → removed (dropped after generation)
 *
 * Keyed on groupNumber (stable: assigned at creation, never renumbered;
 * delete-group only removes empty groups).
 */
export function computePairingDiff(
  generated: PairingGroup[],
  final: PairingGroup[],
): PairingDiff {
  const genGroupOf = new Map<number, number>();
  for (const g of generated) {
    for (const pid of g.playerIds) genGroupOf.set(pid, g.groupNumber);
  }
  const finalGroupOf = new Map<number, number>();
  for (const g of final) {
    for (const pid of g.playerIds) finalGroupOf.set(pid, g.groupNumber);
  }

  const diff: PairingDiff = { moved: [], added: [], removed: [] };

  for (const [pid, toGroup] of finalGroupOf) {
    const fromGroup = genGroupOf.get(pid);
    if (fromGroup === undefined) {
      diff.added.push({ playerId: pid, toGroup });
    } else if (fromGroup !== toGroup) {
      diff.moved.push({ playerId: pid, fromGroup, toGroup });
    }
  }

  for (const [pid, fromGroup] of genGroupOf) {
    if (!finalGroupOf.has(pid)) {
      diff.removed.push({ playerId: pid, fromGroup });
    }
  }

  return diff;
}
