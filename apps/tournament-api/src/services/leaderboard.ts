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
  courseHoles,
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
import { getHandicapStrokes } from '../engine/handicap-strokes.js';
import { aggregateSkinsForEvent } from './sub-games.js';
import { loadLockedHandicapsByEvent } from './event-handicap-overrides.js';

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
  /**
   * T6-14: running sum of skins pot shares for this player across all
   * FINALIZED rounds' skins sub-games. `null` when no finalized skins
   * sub-game has contributed for this player (UI shows `—` not `$0.00`
   * per Josh's safety call against pre-finalize projections).
   */
  skinsCents: number | null;
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

  // If this event's handicaps are LOCKED, the snapshot index overrides the
  // live/manual one for every round in scope — the whole point of the lock.
  const lockedHandicaps = await loadLockedHandicapsByEvent(ctx.db, eventId, tenantId);
  for (const [playerId, hi] of lockedHandicaps) {
    const accum = participantMap.get(playerId);
    if (accum) accum.handicapIndex = hi;
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

  // T6-14: aggregate skins pot shares from finalized rounds.
  const skinsByPlayer = await aggregateSkinsForEvent(ctx.db, eventId, tenantId);

  return assignRanksAndBuildRows(participantMap, roundCtxMap, skinsByPlayer);
}

/**
 * Build LeaderboardRow[] from the accumulator map: compute net per-round +
 * sum, sort by (gross asc NULLS LAST, playerId asc), assign 1224 ranks.
 */
function assignRanksAndBuildRows(
  participants: Map<string, PlayerAccum>,
  roundCtxMap?: Map<string, RoundContextRow>,
  skinsByPlayer?: Map<string, number>,
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
      const skinsCents = skinsByPlayer?.get(p.accum.playerId) ?? null;
      rows.push({
        playerId: p.accum.playerId,
        playerName: p.accum.playerName,
        handicapIndex: p.accum.handicapIndex,
        grossThroughHole: p.grossThroughHole,
        netThroughHole: p.netThroughHole,
        throughHole: p.accum.totalThroughHole,
        rank: groupRank,
        tiedWith,
        skinsCents,
      });
    }
    i = j;
  }
  // Append all unscored players sharing rank.
  for (let k = scoredCount; k < partial.length; k++) {
    const p = partial[k]!;
    const skinsCents = skinsByPlayer?.get(p.accum.playerId) ?? null;
    rows.push({
      playerId: p.accum.playerId,
      playerName: p.accum.playerName,
      handicapIndex: p.accum.handicapIndex,
      grossThroughHole: null,
      netThroughHole: null,
      throughHole: 0,
      rank: unscoredRank,
      tiedWith: unscoredCount,
      skinsCents,
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// netForSegment — the net contract the betting engine consumes (P2/D3).
// ---------------------------------------------------------------------------

/**
 * Version stamp for the canonical net allocation used by `netForSegment`
 * (gross − getHandicapStrokes per stroke-index, locked-HI aware). A banked
 * action-bet records the version it settled under; if this constant later
 * changes, the betting query surfaces a mismatch for organizer review rather
 * than silently re-settling already-banked money (architecture key-deliverable,
 * independent of Epic 5's finalize snapshot). Bump ONLY when the per-hole net
 * math changes in a way that could move a settled outcome.
 */
export const NET_CALC_VERSION = 1;

export type NetForSegmentTrust =
  | 'ok'
  | 'no_handicap' // player has no HI (live or locked) → fail-closed (FR24)
  | 'no_course_data' // round/tee/course missing → fail-closed (FR24)
  | 'incomplete'; // at least one scoped hole not yet scored → provisional (FR25)

export type NetForSegmentResult = {
  /** Per-hole net (gross − getHandicapStrokes) over the requested holes, hole-ascending. `net`/`gross` null when that hole isn't scored. */
  perHole: Array<{ holeNumber: number; net: number | null; gross: number | null }>;
  /** Sum of per-hole net; null unless trust === 'ok' (every scoped hole scored + trustworthy HI/course). */
  total: number | null;
  trust: NetForSegmentTrust;
};

/**
 * Net for a player over an explicit set of holes in one scoring round.
 *
 * The betting engine NEVER re-derives net (P2) — it consumes this. Net is the
 * CANONICAL per-hole allocation `gross − getHandicapStrokes(HI, strokeIndex, tee)`
 * — the same per-stroke-index method the individual_bets + 2v2 best-ball
 * engines use (NOT the leaderboard's proportional `allocateNetThroughHole`,
 * which is a partial-round display approximation and cannot produce per-hole
 * net). Over a full 18 the two agree exactly (Σ getHandicapStrokes = CH), so
 * a full-round total reconciles with the leaderboard's `netThroughHole`
 * (asserted by the net-reconciliation test); per-hole values additionally let
 * front + back sum to total cleanly (Nassau, Epic 4) and feed the hole-by-hole
 * basis (FR36).
 *
 * Locked-HI aware (the event's snapshot overrides the live index, FR23).
 * Fail-closed: returns `total: null` with a `trust` reason when net can't be
 * vouched for (no HI / no course data) or the scope isn't complete.
 *
 * Read-only; tenant-scoped on every query.
 */
export async function netForSegment(
  ctx: LeaderboardCtx,
  args: { roundId: string; playerId: string; holeNumbers: number[] },
): Promise<NetForSegmentResult> {
  const tenantId = ctx.tenantId;
  const holeNumbers = [...args.holeNumbers].sort((a, b) => a - b);
  const emptyPerHole = holeNumbers.map((holeNumber) => ({
    holeNumber,
    net: null,
    gross: null,
  }));

  // 1. Round context (slope/rating/par + course revision + event), same joins
  // as computeLeaderboard. Missing → fail-closed (no_course_data).
  const ctxRows = await ctx.db
    .select({
      eventId: eventRounds.eventId,
      courseRevisionId: eventRounds.courseRevisionId,
      slope: courseTees.slope,
      rating: courseTees.rating,
      coursePar: courseRevisions.courseTotal,
    })
    .from(rounds)
    .innerJoin(eventRounds, eq(eventRounds.id, rounds.eventRoundId))
    .innerJoin(courseRevisions, eq(courseRevisions.id, eventRounds.courseRevisionId))
    .innerJoin(
      courseTees,
      and(
        eq(courseTees.courseRevisionId, eventRounds.courseRevisionId),
        eq(courseTees.teeColor, eventRounds.teeColor),
      ),
    )
    .where(
      and(
        eq(rounds.id, args.roundId),
        eq(rounds.tenantId, tenantId),
        eq(eventRounds.tenantId, tenantId),
        eq(courseRevisions.tenantId, tenantId),
        eq(courseTees.tenantId, tenantId),
      ),
    )
    .limit(1);
  const rc = ctxRows[0];
  if (!rc) return { perHole: emptyPerHole, total: null, trust: 'no_course_data' };

  // 2. Effective handicap index: live/manual, overridden by the event's locked
  // snapshot when the event's handicaps are locked. Null → fail-closed.
  const playerRow = await ctx.db
    .select({ hi: players.manualHandicapIndex })
    .from(players)
    .where(and(eq(players.id, args.playerId), eq(players.tenantId, tenantId)))
    .limit(1);
  let hi: number | null = playerRow[0]?.hi ?? null;
  const locked = await loadLockedHandicapsByEvent(ctx.db, rc.eventId, tenantId);
  const lockedHi = locked.get(args.playerId);
  if (lockedHi !== undefined) hi = lockedHi;
  if (hi === null) return { perHole: emptyPerHole, total: null, trust: 'no_handicap' };

  // 3. Stroke index per requested hole.
  const holeRows = await ctx.db
    .select({ holeNumber: courseHoles.holeNumber, si: courseHoles.si })
    .from(courseHoles)
    .where(
      and(
        eq(courseHoles.courseRevisionId, rc.courseRevisionId),
        inArray(courseHoles.holeNumber, holeNumbers),
        eq(courseHoles.tenantId, tenantId),
      ),
    );
  const siByHole = new Map(holeRows.map((r) => [r.holeNumber, r.si]));

  // 4. Gross per requested hole for this player+round.
  const scoreRows = await ctx.db
    .select({ holeNumber: holeScores.holeNumber, grossStrokes: holeScores.grossStrokes })
    .from(holeScores)
    .where(
      and(
        eq(holeScores.roundId, args.roundId),
        eq(holeScores.playerId, args.playerId),
        inArray(holeScores.holeNumber, holeNumbers),
        eq(holeScores.tenantId, tenantId),
      ),
    );
  const grossByHole = new Map(scoreRows.map((r) => [r.holeNumber, r.grossStrokes]));

  const tee = { slope: rc.slope, ratingTimes10: rc.rating, coursePar: rc.coursePar };
  const perHole = holeNumbers.map((holeNumber) => {
    const gross = grossByHole.get(holeNumber) ?? null;
    const si = siByHole.get(holeNumber);
    if (gross === null || si === undefined) {
      return { holeNumber, net: null, gross };
    }
    return { holeNumber, net: gross - getHandicapStrokes(hi, si, tee), gross };
  });

  if (perHole.some((p) => p.net === null)) {
    return { perHole, total: null, trust: 'incomplete' };
  }
  const total = perHole.reduce((sum, p) => sum + (p.net as number), 0);
  return { perHole, total, trust: 'ok' };
}
