/**
 * Cross-group stroke-play leaderboard query service (T5-5).
 *
 * Read-only per the services-layer convention (architecture D1-1):
 * never imports `db` for writes; routes call this service to compute
 * the leaderboard payload for `GET /api/events/:eventId/leaderboard`.
 *
 * v1 scope (per spec sections 4–7):
 *   - Stroke-play only (gross + slope-aware net via handicap.ts).
 *   - NO tie-break: equal gross totals share rank with `tiedWith` count.
 *     Per-event-configurable tie-break is deferred to T5-5b.
 *   - 18-hole rating only. Per-9 ratings deferred to T5-5c (not just
 *     half-of-18; USGA-issued per nine).
 *   - Round-scope or event-scope (sum across all event_rounds).
 *   - Stable secondary sort by playerId for UI flicker prevention.
 *   - 1224 (competition) ranking; unscored players share rank
 *     (scored_count + 1).
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { db as DbType } from '../db/index.js';
import {
  courseRevisions,
  courseTees,
  eventRounds,
  groupMembers,
  groups,
  holeScores,
  players,
  rounds,
} from '../db/schema/index.js';
import { allocateNetThroughHole, calcCourseHandicap } from './handicap.js';

export type LeaderboardRow = {
  playerId: string;
  playerName: string;
  /** Player's manual handicap index (null if not on file). */
  handicapIndex: number | null;
  /** Sum of gross strokes across the scope. Null if unscored. */
  grossThroughHole: number | null;
  /**
   * Net = sum of per-round (gross − allocated course handicap). Null if
   * `handicapIndex` is null OR if grossThroughHole is null.
   */
  netThroughHole: number | null;
  /** Total scored holes in the scope (0..18 for round, 0..N for event). */
  throughHole: number;
  /**
   * 1224-style rank (ties share, next rank skips). Unscored players all
   * share rank = (scored_count + 1).
   */
  rank: number;
  /** Count of players sharing this rank (>=1; >1 means tie). */
  tiedWith: number;
};

export type LeaderboardCtx = {
  db: typeof DbType;
  tenantId: string;
};

export type LeaderboardOpts =
  | { roundId: string; scope: 'round' }
  | { scope: 'event' };

type RoundContextRow = {
  roundId: string;
  eventRoundId: string;
  slope: number;
  rating: number;
  coursePar: number;
};

/** Per-player accumulator built up while walking hole_scores rows. */
type PlayerAccum = {
  playerId: string;
  playerName: string;
  handicapIndex: number | null;
  totalGross: number;
  totalThroughHole: number;
  /**
   * Per-round (gross, holes-scored) so we can compute per-round course
   * handicap + allocate net proportionally PER ROUND. Net for the scope
   * is the sum of per-round (gross − allocated_handicap).
   */
  perRound: Map<string /* roundId */, { gross: number; holes: number }>;
};

/**
 * Compute the leaderboard for an event in the requested scope.
 * Reads only; never writes. Tenant-scoped on every query.
 */
export async function computeLeaderboard(
  ctx: LeaderboardCtx,
  eventId: string,
  opts: LeaderboardOpts,
): Promise<LeaderboardRow[]> {
  const tenantId = ctx.tenantId;

  // 1. Resolve the participant set (all players in any group of this event).
  const participantRows = await ctx.db
    .select({
      id: players.id,
      name: players.name,
      manualHandicapIndex: players.manualHandicapIndex,
    })
    .from(players)
    .innerJoin(groupMembers, eq(groupMembers.playerId, players.id))
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(
      and(
        eq(groups.eventId, eventId),
        eq(players.tenantId, tenantId),
        eq(groupMembers.tenantId, tenantId),
        eq(groups.tenantId, tenantId),
      ),
    );
  // De-dupe by id in case a player is in multiple groups of the event.
  const participantMap = new Map<string, PlayerAccum>();
  for (const p of participantRows) {
    if (participantMap.has(p.id)) continue;
    participantMap.set(p.id, {
      playerId: p.id,
      playerName: p.name,
      handicapIndex: p.manualHandicapIndex ?? null,
      totalGross: 0,
      totalThroughHole: 0,
      perRound: new Map(),
    });
  }

  // 2. Resolve the round set in scope.
  let roundIdsInScope: string[];
  if (opts.scope === 'round') {
    // Defense-in-depth: verify the round both exists AND belongs to the
    // requested event (via the event_rounds join). The route already
    // gates this, but a future caller invoking the service directly
    // (job, internal tool) should not be able to mix scores across
    // events by passing a foreign roundId. Returns [] when the join
    // fails so the route can map to 404 if it cares.
    const roundRow = await ctx.db
      .select({ id: rounds.id })
      .from(rounds)
      .innerJoin(eventRounds, eq(eventRounds.id, rounds.eventRoundId))
      .where(
        and(
          eq(rounds.id, opts.roundId),
          eq(eventRounds.eventId, eventId),
          eq(rounds.tenantId, tenantId),
          eq(eventRounds.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (roundRow.length === 0) return [];
    roundIdsInScope = [opts.roundId];
  } else {
    // Event scope: all rounds whose event_round belongs to this event.
    const allRounds = await ctx.db
      .select({ id: rounds.id })
      .from(rounds)
      .innerJoin(eventRounds, eq(eventRounds.id, rounds.eventRoundId))
      .where(
        and(
          eq(eventRounds.eventId, eventId),
          eq(rounds.tenantId, tenantId),
          eq(eventRounds.tenantId, tenantId),
        ),
      );
    roundIdsInScope = allRounds.map((r) => r.id);
  }

  if (roundIdsInScope.length === 0) {
    // No rounds yet — every participant ranks last (unscored).
    return assignRanksAndBuildRows(participantMap);
  }

  // 3. Per-round context (slope/rating/par) keyed by roundId. Used to
  // compute course handicap per round before allocating net.
  const roundCtxRows = await ctx.db
    .select({
      roundId: rounds.id,
      eventRoundId: eventRounds.id,
      slope: courseTees.slope,
      rating: courseTees.rating,
      coursePar: courseRevisions.courseTotal,
    })
    .from(rounds)
    .innerJoin(eventRounds, eq(eventRounds.id, rounds.eventRoundId))
    .innerJoin(
      courseRevisions,
      eq(courseRevisions.id, eventRounds.courseRevisionId),
    )
    .innerJoin(
      courseTees,
      and(
        eq(courseTees.courseRevisionId, eventRounds.courseRevisionId),
        eq(courseTees.teeColor, eventRounds.teeColor),
      ),
    )
    .where(
      and(
        inArray(rounds.id, roundIdsInScope),
        eq(rounds.tenantId, tenantId),
        eq(eventRounds.tenantId, tenantId),
        eq(courseRevisions.tenantId, tenantId),
        eq(courseTees.tenantId, tenantId),
      ),
    );
  const roundCtxMap = new Map<string, RoundContextRow>(
    roundCtxRows.map((r) => [r.roundId, r]),
  );

  // 4. Fetch hole_scores for all in-scope rounds; aggregate per player +
  // per round.
  const holeRows = await ctx.db
    .select({
      roundId: holeScores.roundId,
      playerId: holeScores.playerId,
      holeNumber: holeScores.holeNumber,
      grossStrokes: holeScores.grossStrokes,
    })
    .from(holeScores)
    .where(
      and(
        inArray(holeScores.roundId, roundIdsInScope),
        eq(holeScores.tenantId, tenantId),
      ),
    );

  for (const h of holeRows) {
    const accum = participantMap.get(h.playerId);
    if (!accum) continue; // hole_score for a non-participant: skip defensively
    accum.totalGross += h.grossStrokes;
    accum.totalThroughHole += 1;
    const perRound = accum.perRound.get(h.roundId) ?? { gross: 0, holes: 0 };
    perRound.gross += h.grossStrokes;
    perRound.holes += 1;
    accum.perRound.set(h.roundId, perRound);
  }

  return assignRanksAndBuildRows(participantMap, roundCtxMap);
}

/**
 * Build LeaderboardRow[] from the accumulator map: compute net per-round +
 * sum, sort by (gross asc NULLS LAST, playerId asc), assign 1224 ranks.
 */
function assignRanksAndBuildRows(
  participants: Map<string, PlayerAccum>,
  roundCtxMap?: Map<string, RoundContextRow>,
): LeaderboardRow[] {
  // Compute net per accumulator (sum of per-round (gross − allocated handicap)).
  const partial: Array<{
    accum: PlayerAccum;
    grossThroughHole: number | null;
    netThroughHole: number | null;
  }> = [];
  for (const accum of participants.values()) {
    if (accum.totalThroughHole === 0) {
      partial.push({ accum, grossThroughHole: null, netThroughHole: null });
      continue;
    }
    let netSum = 0;
    let netComputable = accum.handicapIndex !== null && roundCtxMap !== undefined;
    if (netComputable) {
      for (const [roundId, perRound] of accum.perRound) {
        const ctx = roundCtxMap?.get(roundId);
        if (!ctx) {
          // Round context missing — net not computable for this scope.
          netComputable = false;
          break;
        }
        const courseHandicap = calcCourseHandicap({
          handicapIndex: accum.handicapIndex as number,
          slope: ctx.slope,
          ratingTimes10: ctx.rating,
          coursePar: ctx.coursePar,
        });
        const allocated = allocateNetThroughHole({
          courseHandicap,
          throughHole: perRound.holes,
        });
        netSum += perRound.gross - allocated;
      }
    }
    partial.push({
      accum,
      grossThroughHole: accum.totalGross,
      netThroughHole: netComputable ? netSum : null,
    });
  }

  // Sort: gross asc NULLS LAST, then playerId asc (deterministic UI order).
  partial.sort((a, b) => {
    const ag = a.grossThroughHole;
    const bg = b.grossThroughHole;
    if (ag === null && bg === null) {
      return a.accum.playerId < b.accum.playerId ? -1 : 1;
    }
    if (ag === null) return 1; // a unscored, after b
    if (bg === null) return -1; // b unscored, after a
    if (ag !== bg) return ag - bg;
    return a.accum.playerId < b.accum.playerId ? -1 : 1;
  });

  // 1224 ranking + unscored shared rank.
  const rows: LeaderboardRow[] = [];
  const scoredCount = partial.filter((p) => p.grossThroughHole !== null).length;
  const unscoredRank = scoredCount + 1;
  const unscoredCount = partial.length - scoredCount;

  // Walk scored players, grouping ties.
  let i = 0;
  while (i < scoredCount) {
    const groupGross = partial[i]!.grossThroughHole as number;
    let j = i;
    while (j < scoredCount && partial[j]!.grossThroughHole === groupGross) j++;
    const tiedWith = j - i;
    const groupRank = i + 1;
    for (let k = i; k < j; k++) {
      const p = partial[k]!;
      rows.push({
        playerId: p.accum.playerId,
        playerName: p.accum.playerName,
        handicapIndex: p.accum.handicapIndex,
        grossThroughHole: p.grossThroughHole,
        netThroughHole: p.netThroughHole,
        throughHole: p.accum.totalThroughHole,
        rank: groupRank,
        tiedWith,
      });
    }
    i = j;
  }
  // Append all unscored players sharing rank.
  for (let k = scoredCount; k < partial.length; k++) {
    const p = partial[k]!;
    rows.push({
      playerId: p.accum.playerId,
      playerName: p.accum.playerName,
      handicapIndex: p.accum.handicapIndex,
      grossThroughHole: null,
      netThroughHole: null,
      throughHole: 0,
      rank: unscoredRank,
      tiedWith: unscoredCount,
    });
  }

  return rows;
}
