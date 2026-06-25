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
  gameConfig,
  groupMembers,
  groups,
  holeScores,
  players,
  rounds,
  roundPins,
} from '../db/schema/index.js';
import { allocateNetThroughHole, calcCourseHandicap } from './handicap.js';
import {
  getHandicapStrokes,
  allocateStrokesFromCourseHandicap,
  applyAllowanceOffLow,
} from '../engine/handicap-strokes.js';
import { aggregateSkinsForEvent } from './sub-games.js';
import { loadLockedHandicapsByEvent } from './event-handicap-overrides.js';
import { perPlayerHandicapsSchema } from '../engine/games/config-schema.js';

export type LeaderboardRow = {
  playerId: string;
  playerName: string;
  /** Player's manual handicap index (null if not on file). */
  handicapIndex: number | null;
  /**
   * F1 (Story 1.4, AC9): the player's PINNED course handicap for the round, when
   * this is a round-scope F1 leaderboard read (the CH the money was/will be
   * settled off, always visible after the fact). Null for non-F1 or event-scope.
   */
  courseHandicap?: number | null;
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
   * NET-to-par through the scored holes (Story 3-4a, Wolf-style "To Par"):
   * netThroughHole − (par of the holes the player actually scored). Negative =
   * under par. Null when net is not computable (no handicap / fail-closed pin) or
   * par is unavailable. Drives the colored To-Par column.
   */
  netToPar: number | null;
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
  /**
   * F1 (Story 1.4): per-round per-hole gross (holeNumber → gross), so an F1
   * round's net is allocated per-stroke-index from the PINNED course handicap
   * (matching the settled money, AC2/AC4) instead of the proportional approx.
   * Only populated for rounds that have a pin.
   */
  perRoundHoleGross: Map<string /* roundId */, Map<number, number>>;
};

/**
 * Pinned context for an F1 round (Story 1.4). The leaderboard derives F1-round
 * net from this — the pinned per-player CH + the pinned course-rev stroke index
 * — never a live HI/course (AC2). `null`-valued CH means the player had no
 * usable handicap in the pin (net falls back to gross for them, like the legacy
 * null-HI behavior).
 */
type RoundPinContext = {
  chByPlayer: Map<string, number>;
  hiByPlayer: Map<string, number>;
  /**
   * Stroke index per hole, RESTRICTED to holes in play (≤ holesToPlay). The F1
   * net build iterates the player's scored holes against this map; restricting it
   * to holes-in-play means a 9-hole F1 round's net counts only the front 9, and a
   * stray hole_score beyond holesToPlay is ignored — matching the settlement
   * path's `holesInPlay` filter (games-money.ts) so leaderboard net can't diverge
   * from settled money by counting extra holes (Story 1.4 hardening).
   */
  siByHole: Map<number, number>;
};

/**
 * F1 pin context for the in-scope rounds (Story 1.4).
 *   - `isF1`: the event has an event-level game_config row. When true, EVERY
 *     in-scope round is an F1 round and MUST derive net from its pin only — a
 *     round absent from `pinsByRound` (missing/corrupt/incomplete pin) is
 *     FAIL-CLOSED (net null), NEVER a live-HI/course fallback (the money-safety
 *     invariant, AC2/AC11). For a non-F1 event `isF1` is false and the legacy
 *     proportional live-CH path runs unchanged (ZERO regression).
 *   - `pinsByRound`: per-round pin context for rounds with a VALID pin.
 */
type F1PinScope = {
  isF1: boolean;
  pinsByRound: Map<string, RoundPinContext>;
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
      perRoundHoleGross: new Map(),
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

  // Par-by-hole per round (Story 3-4a, for net-to-par). Joined from each round's
  // event-round course revision. Display-only (To-Par column); par is stable
  // across revisions, so the event-round rev is fine even for F1 rounds whose
  // money settles off the pinned rev.
  const parRows = await ctx.db
    .select({
      roundId: rounds.id,
      holeNumber: courseHoles.holeNumber,
      par: courseHoles.par,
    })
    .from(rounds)
    .innerJoin(eventRounds, eq(eventRounds.id, rounds.eventRoundId))
    .innerJoin(
      courseHoles,
      eq(courseHoles.courseRevisionId, eventRounds.courseRevisionId),
    )
    .where(
      and(
        inArray(rounds.id, roundIdsInScope),
        eq(rounds.tenantId, tenantId),
        eq(eventRounds.tenantId, tenantId),
        eq(courseHoles.tenantId, tenantId),
      ),
    );
  const parByRoundHole = new Map<string, Map<number, number>>();
  for (const r of parRows) {
    let m = parByRoundHole.get(r.roundId);
    if (!m) {
      m = new Map<number, number>();
      parByRoundHole.set(r.roundId, m);
    }
    m.set(r.holeNumber, r.par);
  }

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
    let holeGross = accum.perRoundHoleGross.get(h.roundId);
    if (!holeGross) {
      holeGross = new Map();
      accum.perRoundHoleGross.set(h.roundId, holeGross);
    }
    holeGross.set(h.holeNumber, h.grossStrokes);
  }

  // F1 (Story 1.4): for an F1 event, every in-scope round that has a pin derives
  // its net from the PINNED per-player CH + the pinned course stroke index
  // (matching the settled money, AC2). Build the pin context per round. Non-F1
  // events have no event-level game_config row → this map is empty → the legacy
  // proportional path runs unchanged (ZERO regression).
  const f1Scope = await loadF1RoundPins(ctx.db, eventId, tenantId, roundIdsInScope);

  // T6-14: aggregate skins pot shares from finalized rounds.
  const skinsByPlayer = await aggregateSkinsForEvent(ctx.db, eventId, tenantId);

  return assignRanksAndBuildRows(
    participantMap,
    roundCtxMap,
    skinsByPlayer,
    f1Scope,
    opts.scope === 'round',
    parByRoundHole,
  );
}

/**
 * Load the pin context (per-player CH/HI + per-hole stroke index from the pinned
 * course revision) for each in-scope round of an F1 event. Returns an EMPTY map
 * for a non-F1 event (no event-level game_config row), so the legacy net path is
 * untouched. Reads ONLY the pin — never live HI/course (AC2).
 */
async function loadF1RoundPins(
  database: typeof DbType,
  eventId: string,
  tenantId: string,
  roundIds: string[],
): Promise<F1PinScope> {
  const pinsByRound = new Map<string, RoundPinContext>();
  if (roundIds.length === 0) return { isF1: false, pinsByRound };

  // Only F1 events (event-level game_config row) pin for money.
  const isF1 = (
    await database
      .select({ id: gameConfig.id })
      .from(gameConfig)
      .where(
        and(
          eq(gameConfig.level, 'event'),
          eq(gameConfig.refId, eventId),
          eq(gameConfig.tenantId, tenantId),
        ),
      )
      .limit(1)
  ).length > 0;
  if (!isF1) return { isF1: false, pinsByRound };

  // Tenant-scoped pin read (Story 1.4 fix) — a read can never load another
  // tenant's pin even if a round_id collided. Join event_rounds for holesToPlay
  // so the F1 net only counts holes in play (front 9 vs 18), matching settlement.
  const pinRows = await database
    .select({
      roundId: roundPins.roundId,
      perPlayerHandicapsJson: roundPins.perPlayerHandicapsJson,
      courseRevisionId: roundPins.courseRevisionId,
      holesToPlay: eventRounds.holesToPlay,
    })
    .from(roundPins)
    .innerJoin(rounds, eq(rounds.id, roundPins.roundId))
    .innerJoin(eventRounds, eq(eventRounds.id, rounds.eventRoundId))
    .where(
      and(
        inArray(roundPins.roundId, roundIds),
        eq(roundPins.tenantId, tenantId),
        eq(rounds.tenantId, tenantId),
        eq(eventRounds.tenantId, tenantId),
      ),
    );

  for (const pin of pinRows) {
    let rawHcp: unknown;
    try {
      rawHcp = JSON.parse(pin.perPlayerHandicapsJson);
    } catch {
      // Corrupt pin JSON: do NOT add a context. For an F1 event the builder
      // fail-closes this round (net null) — it must NEVER fall back to live data.
      continue;
    }
    const parsed = perPlayerHandicapsSchema.safeParse(rawHcp);
    if (!parsed.success) continue; // partial/corrupt pin → fail-closed (no context)
    const chByPlayer = new Map<string, number>();
    const hiByPlayer = new Map<string, number>();
    for (const [playerId, h] of Object.entries(parsed.data)) {
      // A `null` ch is an ABSENT handicap (no HI/GHIN at pin-time) — leave the
      // player OUT of chByPlayer so the builder marks them not-computable
      // (fail-closed, never settled as scratch). A finite 0 is a legit scratch.
      if (h.ch !== null && Number.isFinite(h.ch)) chByPlayer.set(playerId, h.ch);
      if (h.hi !== null && Number.isFinite(h.hi)) hiByPlayer.set(playerId, h.hi);
    }
    const holeRows = await database
      .select({ holeNumber: courseHoles.holeNumber, si: courseHoles.si })
      .from(courseHoles)
      .where(
        and(
          eq(courseHoles.courseRevisionId, pin.courseRevisionId),
          eq(courseHoles.tenantId, tenantId),
        ),
      );
    // Restrict to holes in play (≤ holesToPlay) so the F1 net counts only the
    // front 9 on a 9-hole round and ignores stray scores beyond it — matching the
    // settlement path's holesInPlay filter (games-money.ts).
    const siByHole = new Map(
      holeRows
        .filter((h) => h.holeNumber <= pin.holesToPlay)
        .map((h) => [h.holeNumber, h.si]),
    );
    pinsByRound.set(pin.roundId, { chByPlayer, hiByPlayer, siByHole });
  }
  return { isF1: true, pinsByRound };
}

/**
 * Build LeaderboardRow[] from the accumulator map: compute net per-round +
 * sum, sort by (gross asc NULLS LAST, playerId asc), assign 1224 ranks.
 */
function assignRanksAndBuildRows(
  participants: Map<string, PlayerAccum>,
  roundCtxMap?: Map<string, RoundContextRow>,
  skinsByPlayer?: Map<string, number>,
  f1Scope?: F1PinScope,
  isRoundScope = false,
  parByRoundHole?: Map<string, Map<number, number>>,
): LeaderboardRow[] {
  const isF1Event = f1Scope?.isF1 ?? false;
  const f1RoundPins = f1Scope?.pinsByRound;
  // Compute net per accumulator (sum of per-round (gross − allocated handicap)).
  const partial: Array<{
    accum: PlayerAccum;
    grossThroughHole: number | null;
    netThroughHole: number | null;
    /** Net-to-par over scored holes (Story 3-4a); null when net/par unavailable. */
    netToPar: number | null;
    /** Pinned course handicap for an F1 round-scope read (AC9); null otherwise. */
    courseHandicap: number | null;
    /** Pinned HI for an F1 round-scope read (AC9); null otherwise. */
    pinnedHandicapIndex: number | null;
  }> = [];
  for (const accum of participants.values()) {
    if (accum.totalThroughHole === 0) {
      partial.push({ accum, grossThroughHole: null, netThroughHole: null, netToPar: null, courseHandicap: null, pinnedHandicapIndex: null });
      continue;
    }
    let netSum = 0;
    let netComputable = roundCtxMap !== undefined;
    let pinnedCH: number | null = null;
    let pinnedHI: number | null = null;
    if (netComputable) {
      for (const [roundId, perRound] of accum.perRound) {
        const pin = f1RoundPins?.get(roundId);
        if (pin) {
          // F1 round (Story 1.4, AC2): net = Σ per scored hole
          // (gross − allocateStrokesFromCourseHandicap(pinnedCH, strokeIndex)).
          // The CH comes from the PIN, never a live HI; SI from the pinned course.
          const ch = pin.chByPlayer.get(accum.playerId);
          if (ch === undefined) {
            // Player not in this pin (absent handicap) → no usable F1 net for this
            // round; fail-closed (NEVER a live fallback).
            netComputable = false;
            break;
          }
          // Surface the pinned CH/HI ONLY for a round-scope read (AC9). Event-scope
          // mixes rounds, so a single per-round CH/HI is misleading → leave null.
          if (isRoundScope) {
            pinnedCH = ch;
            pinnedHI = pin.hiByPlayer.get(accum.playerId) ?? null;
          }
          const holeGross = accum.perRoundHoleGross.get(roundId);
          if (!holeGross) {
            netComputable = false;
            break;
          }
          // Per-round fail-closed isolation (AC11): a corrupt-but-schema-valid pin
          // (non-integer CH, out-of-range stroke index) makes
          // `allocateStrokesFromCourseHandicap` THROW. Wrap the allocation so a
          // throw fails THIS F1 round closed (net null) — exactly like the
          // missing-pin case above — instead of crashing the leaderboard endpoint
          // (no 500). Other rounds/players still compute. Mirrors the settlement
          // path's per-foursome try/catch (games-money.ts).
          let allocated = 0;
          try {
            for (const [holeNumber, gross] of holeGross) {
              const si = pin.siByHole.get(holeNumber);
              // `si === undefined` means the hole is OUT OF PLAY (> holesToPlay) —
              // the SI map is restricted to holes in play. Skip it (matching the
              // settlement path's holesInPlay filter), NEVER count it.
              if (si === undefined) continue;
              allocated += gross - allocateStrokesFromCourseHandicap(ch, si);
            }
          } catch {
            // Corrupt pinned CH / stroke index → this F1 round is unsettleable.
            // Fail closed (net null), never crash the endpoint.
            netComputable = false;
            break;
          }
          netSum += allocated;
          continue;
        }
        // FAIL-CLOSED for an F1 event with NO valid pin for this round (Story 1.4
        // fix): an F1 round whose pin is missing/corrupt/incomplete is NEVER
        // settled against live HI/course — its net is not computable (null). This
        // is the money-safety invariant: there must be ZERO read paths that derive
        // an F1 round's net from live (non-pinned) data.
        if (isF1Event) {
          netComputable = false;
          break;
        }
        // Legacy (non-F1) round: proportional allocation off the live CH.
        if (accum.handicapIndex === null) {
          netComputable = false;
          break;
        }
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
    // Net-to-par (Story 3-4a): netSum − par of the player's scored holes. Par per
    // scored hole comes from parByRoundHole (the round's course revision). Null
    // when net isn't computable or any scored hole's par is unavailable.
    let netToPar: number | null = null;
    if (netComputable && parByRoundHole !== undefined) {
      let totalPar = 0;
      let parComputable = true;
      for (const [roundId, holeGross] of accum.perRoundHoleGross) {
        const parMap = parByRoundHole.get(roundId);
        if (!parMap) {
          parComputable = false;
          break;
        }
        // Mirror the NET hole set exactly: for an F1 round, net counts only holes
        // IN PLAY (the pin's siByHole, ≤ holesToPlay) — so par must skip a stray
        // out-of-play hole_score too, or netToPar would be deflated by its par
        // while net ignored its strokes. A legacy round (no pin) counts all
        // scored holes, matching its proportional net.
        const pin = f1RoundPins?.get(roundId);
        for (const holeNumber of holeGross.keys()) {
          if (pin && !pin.siByHole.has(holeNumber)) continue; // out of play → not in net
          const par = parMap.get(holeNumber);
          if (par === undefined) {
            parComputable = false;
            break;
          }
          totalPar += par;
        }
        if (!parComputable) break;
      }
      if (parComputable) netToPar = netSum - totalPar;
    }

    partial.push({
      accum,
      grossThroughHole: accum.totalGross,
      netThroughHole: netComputable ? netSum : null,
      netToPar,
      // Surface a single pinned CH only when the player has exactly one F1 round
      // in scope (round-scope reads); otherwise null (event-scope mixes rounds).
      courseHandicap: pinnedCH,
      pinnedHandicapIndex: pinnedHI,
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
        // AC9: for an F1 round-scope read, show the PINNED HI (what the money was
        // computed off), falling back to the live/manual HI otherwise.
        handicapIndex: p.pinnedHandicapIndex ?? p.accum.handicapIndex,
        courseHandicap: p.courseHandicap,
        grossThroughHole: p.grossThroughHole,
        netThroughHole: p.netThroughHole,
        netToPar: p.netToPar,
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
      handicapIndex: p.pinnedHandicapIndex ?? p.accum.handicapIndex,
      courseHandicap: p.courseHandicap,
      grossThroughHole: null,
      netThroughHole: null,
      netToPar: null,
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
 *
 * v2 (2026-06-25): a NET per-hole match now settles OFF THE DIFFERENCE
 * (offLowNetForMatch) instead of full-handicap-each, which can move a match
 * outcome — so the stamp bumps. Nothing has banked yet (bets recompute on read),
 * so no live bet carries v1; the bump arms the guard for if/when banking lands.
 */
export const NET_CALC_VERSION = 2;

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

export type OffLowMatchNetResult = {
  /** subjectId → per-hole net (off the pair's low), aligned to sorted holeNumbers. */
  netPerHoleBySubject: Record<string, Array<number | null>>;
  trustBySubject: Record<string, NetForSegmentTrust>;
};

/**
 * Off-the-difference net per hole for a HEADS-UP match (the "$5 a hole" game).
 *
 * The match convention Josh's group plays: the LOW course handicap in the pair
 * plays to scratch and the higher player gets only the SPREAD, allocated on the
 * hardest holes — NOT each player's full handicap (Josh 2026-06-25: "He's a 10,
 * I'm a 16, he gives me 6; Ronnie gets none."). Contrast netForSegment, which
 * nets every player off their OWN full handicap (correct for skins / the field,
 * wrong for a 1-v-1 match).
 *
 * Same net basis as netForSegment (effective/locked HI → course handicap off the
 * ROUND's tee), but the per-hole stroke allocation runs off the pair's low via
 * applyAllowanceOffLow at 100% (full difference, no allowance reduction). A
 * subject missing an HI, or any incomplete hole, yields a `null` net for that
 * subject → settlePerHoleMatch keeps the bet provisional (never settles on a
 * partial/handicap-less pair). gross-basis matches never call this.
 */
export async function offLowNetForMatch(
  ctx: LeaderboardCtx,
  args: { roundId: string; subjectIds: string[]; holeNumbers: number[] },
): Promise<OffLowMatchNetResult> {
  const tenantId = ctx.tenantId;
  // Preserve the caller's hole order — the H2hInput contract aligns each subject's
  // net array 1:1 with bet.scopedHoles, and all lookups below are by hole number.
  const holeNumbers = [...args.holeNumbers];
  const subjectIds = [...new Set(args.subjectIds)];
  const allNull = (): Record<string, Array<number | null>> =>
    Object.fromEntries(subjectIds.map((id) => [id, holeNumbers.map(() => null)]));

  // No subjects → nothing to grade (applyAllowanceOffLow throws on an empty group).
  // A real per_hole_match always has two; guard so a malformed bet fails closed.
  if (subjectIds.length === 0) {
    return { netPerHoleBySubject: {}, trustBySubject: {} };
  }

  // 1. Round context (tee slope/rating/par + course revision + event) — same
  // joins/tee selection as netForSegment, so the match nets off the same tee.
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
  if (!rc) {
    return {
      netPerHoleBySubject: allNull(),
      trustBySubject: Object.fromEntries(subjectIds.map((id) => [id, 'no_course_data' as const])),
    };
  }
  const tee = { slope: rc.slope, ratingTimes10: rc.rating, coursePar: rc.coursePar };

  // 2. Effective HI per subject (manual, overridden by the event's locked snapshot).
  const locked = await loadLockedHandicapsByEvent(ctx.db, rc.eventId, tenantId);
  const trustBySubject: Record<string, NetForSegmentTrust> = {};
  const chBySubject = new Map<string, number>();
  for (const id of subjectIds) {
    const playerRow = await ctx.db
      .select({ hi: players.manualHandicapIndex })
      .from(players)
      .where(and(eq(players.id, id), eq(players.tenantId, tenantId)))
      .limit(1);
    let hi: number | null = playerRow[0]?.hi ?? null;
    const lockedHi = locked.get(id);
    if (lockedHi !== undefined) hi = lockedHi;
    if (hi === null) {
      trustBySubject[id] = 'no_handicap';
      continue;
    }
    // calcCourseHandicap throws on a non-finite HI / bad tee. Treat a throw as
    // "no usable handicap" (→ ungradeable pair → provisional) rather than 500ing
    // the settlement read.
    try {
      chBySubject.set(id, calcCourseHandicap({ handicapIndex: hi, ...tee }));
    } catch {
      trustBySubject[id] = 'no_handicap';
    }
  }

  // A handicapped match needs EVERY subject's CH to size the spread. If any is
  // missing, the pair is ungradeable → all-null (provisional), each subject keeps
  // its own trust (no_handicap for the missing one).
  if (chBySubject.size !== subjectIds.length) {
    for (const id of subjectIds) trustBySubject[id] ??= 'ok';
    return { netPerHoleBySubject: allNull(), trustBySubject };
  }

  // 3. Off the pair's low: low plays scratch, others get the spread (pct=100 → full
  // difference). offLowBase is the handicap each allocates strokes FROM.
  const { offLow } = applyAllowanceOffLow(chBySubject, 100);

  // 4. SI per hole + gross per subject/hole.
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

  const netPerHoleBySubject: Record<string, Array<number | null>> = {};
  for (const id of subjectIds) {
    const scoreRows = await ctx.db
      .select({ holeNumber: holeScores.holeNumber, grossStrokes: holeScores.grossStrokes })
      .from(holeScores)
      .where(
        and(
          eq(holeScores.roundId, args.roundId),
          eq(holeScores.playerId, id),
          inArray(holeScores.holeNumber, holeNumbers),
          eq(holeScores.tenantId, tenantId),
        ),
      );
    const grossByHole = new Map(scoreRows.map((r) => [r.holeNumber, r.grossStrokes]));
    const offLowBase = offLow.get(id)!;
    const perHole = holeNumbers.map((h) => {
      const gross = grossByHole.get(h);
      const si = siByHole.get(h);
      if (gross === undefined || gross === null || si === undefined || si === null) return null;
      // allocateStrokesFromCourseHandicap THROWS on a non-integer / out-of-range
      // SI (corrupt course data). Fail closed to a null hole (→ provisional),
      // never a 500 on the settlement read — mirrors the per-foursome blast-radius
      // guard on the F1 side.
      try {
        return gross - allocateStrokesFromCourseHandicap(offLowBase, si);
      } catch {
        return null;
      }
    });
    netPerHoleBySubject[id] = perHole;
    trustBySubject[id] = perHole.some((v) => v === null) ? 'incomplete' : 'ok';
  }

  return { netPerHoleBySubject, trustBySubject };
}
