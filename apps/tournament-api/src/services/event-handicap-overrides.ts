/**
 * Locked-handicap overlay. When an event's handicaps are locked
 * (event_handicaps snapshot exists), the locked index — NOT the player's
 * live/manual index — is what every net-score calculation must use, for
 * EVERY round of that event. This is the single source of truth consumed by
 * the leaderboard, money, sub-games, presses, and bets so the lock is honored
 * uniformly.
 *
 * Returns a Map of playerId → locked handicap index (may be null = "locked to
 * no index"). An UNLOCKED event yields an empty map, so callers simply skip
 * the overlay and keep today's manual-index behavior.
 */
import { and, eq } from 'drizzle-orm';
import type { db as DbType } from '../db/index.js';
import { eventHandicaps, rounds } from '../db/schema/index.js';

type Db = typeof DbType;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export async function loadLockedHandicapsByEvent(
  dbOrTx: Db | Tx,
  eventId: string,
  tenantId: string,
): Promise<Map<string, number | null>> {
  const rows = await dbOrTx
    .select({ playerId: eventHandicaps.playerId, hi: eventHandicaps.handicapIndex })
    .from(eventHandicaps)
    .where(and(eq(eventHandicaps.eventId, eventId), eq(eventHandicaps.tenantId, tenantId)));
  return new Map(rows.map((r) => [r.playerId, r.hi]));
}

export async function loadLockedHandicapsByRound(
  dbOrTx: Db | Tx,
  roundId: string,
  tenantId: string,
): Promise<Map<string, number | null>> {
  const r = await dbOrTx
    .select({ eventId: rounds.eventId })
    .from(rounds)
    .where(and(eq(rounds.id, roundId), eq(rounds.tenantId, tenantId)))
    .limit(1);
  const eventId = r[0]?.eventId;
  if (!eventId) return new Map();
  return loadLockedHandicapsByEvent(dbOrTx, eventId, tenantId);
}

/**
 * Overlay locked indices onto a plain `playerId → number` map (the common
 * shape in money/sub-games/press where a missing index defaults to 0).
 * Locked null → 0 (no strokes), matching the manual-null default.
 */
export function applyLockedToNumberMap(
  target: Record<string, number>,
  locked: Map<string, number | null>,
): void {
  for (const [playerId, hi] of locked) {
    target[playerId] = hi ?? 0;
  }
}
