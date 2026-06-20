/**
 * T6-5 head-to-head money matrix service.
 *
 * Pure query (no writes, no audit, no activity). Aggregates per-pair
 * money across all rounds + bets in an event into an N×N matrix.
 *
 * **v1 scope (load-bearing simplifications):**
 *
 * - **2v2 best ball base contributions:** ✅ via compute2v2BestBall.
 * - **Individual bets:** ✅ via computeIndividualBet for each active bet.
 * - **Team press multipliers:** ❌ DEFERRED (Followup T6-5f). The press
 *   log persists fires (T6-4 ships team_press_log) but applying
 *   multiplier-scaled contributions to perPair requires re-walking each
 *   pressed segment per round per press. v1 returns base contributions
 *   only; followup ships when manual-press UI lands (T6-7) and money
 *   accuracy under presses becomes user-visible.
 * - **Skins:** ❌ NOT SHIPPED (T6-14 backlog). v1 returns 0 from skins.
 * - **Sandies / greenies bonuses:** ✅ via compute2v2BestBall (T6-1).
 *
 * **Anti-symmetry invariant:** matrix[a][b] === −matrix[b][a]. Guaranteed
 * by compute2v2BestBall.perPair (T6-1 AC-9) + the symmetric write pattern
 * for individual bets (matrix[a][b] += value AND matrix[b][a] -= value).
 *
 * **Diagonal cells:** matrix[playerId][playerId] === 0 always (a player
 * cannot owe themselves).
 *
 * **Integer-cents discipline:** every cell value Number.isInteger(...) === true.
 *
 * No DB writes. No audit row. No activity emit. cache-control: no-store
 * is set by the route layer (T6-5 spec AC-5).
 */

import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { db as DbType } from '../db/index.js';
import {
  courseHoles,
  courseRevisions,
  courseTees,
  eventRounds,
  groupMembers,
  groups,
  holeScores,
  individualBets,
  individualBetRounds,
  pairingMembers,
  pairings,
  players,
  rounds,
  ruleSetRevisions,
  ruleSets,
} from '../db/schema/index.js';
import {
  compute2v2BestBall,
  type Compute2v2BestBallInput,
  type HoleScoreInput,
  type HoleShape,
  type TeeShape,
} from '../engine/formats/best-ball-2v2.js';
import {
  computeIndividualBet,
  type ComputeIndividualBetInput,
  type HoleScoreShape,
  type IndividualBetType,
} from '../engine/rules/individual-bets.js';
import { loadSkinsSnapshotsForEvent } from './sub-games.js';
import { loadLockedHandicapsByEvent, applyLockedToNumberMap } from './event-handicap-overrides.js';
import { resolveFoursomeTeams } from './foursome-teams.js';
import { buildTeeByPlayer } from './per-player-tee.js';
import { computeActionBetEdgesForEvent } from './bets-query.js';

type Db = typeof DbType;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type Ledger = {
  matrix: Record<string, Record<string, number>>;
  totals: Record<string, number>;
};

export type MoneyMatrix = {
  players: Array<{ id: string; name: string }>;
  /** COMBINED ledger: 2v2 + individual bets + skins. */
  matrix: Record<string, Record<string, number>>;
  totals: Record<string, number>;
  /** T13-5 split: 2v2 best-ball ("Team / Ball money"). */
  teamLedger: Ledger;
  /** T13-5 split: 1v1 individual bets ("Individual bets"). */
  individualLedger: Ledger;
  /** "The Action" split: action-bet SettlementEdges, stakeholder-keyed. */
  actionLedger: Ledger;
  computedAt: string;
  visibilityMode: 'open' | 'participant' | 'self_only';
};

/**
 * v1 helper: fetch the latest rule_set revision config for the tenant.
 * Mirrors press-orchestrator.ts pattern (Followup T6-4f / T6-5f tracks
 * proper effective-from-hole-aware lookup).
 */
export async function fetchActive2v2Config(
  txOrDb: Tx | Db,
  tenantId: string,
): Promise<{
  basePerHoleCents: number;
  sandies: boolean;
  sandiesBonusPerHoleCents: number;
  greenieCarryover: boolean;
  greenieValidation: '2-putt' | 'none';
  greenieBaseCents: number;
} | null> {
  // Deterministic: most-recent rule_set in tenant by created_at desc, id desc tiebreak.
  // Mirrors press-orchestrator's pattern. v1 trip-day reality has 1 rule_set per
  // tenant; followup T6-5e tracks proper effective-from-hole-aware lookup once
  // event_rule_set_links table exists (T5-11e).
  const ruleSetRows = await txOrDb
    .select({ id: ruleSets.id })
    .from(ruleSets)
    .where(eq(ruleSets.tenantId, tenantId))
    .orderBy(desc(ruleSets.createdAt), desc(ruleSets.id))
    .limit(1);
  if (ruleSetRows.length === 0) return null;

  const revRows = await txOrDb
    .select({ configJson: ruleSetRevisions.configJson })
    .from(ruleSetRevisions)
    .where(
      and(
        eq(ruleSetRevisions.ruleSetId, ruleSetRows[0]!.id),
        eq(ruleSetRevisions.tenantId, tenantId),
      ),
    )
    .orderBy(desc(ruleSetRevisions.revisionNumber))
    .limit(1);
  if (revRows.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(revRows[0]!.configJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const cfg = parsed as Record<string, unknown>;
  return {
    basePerHoleCents:
      typeof cfg['basePerHoleCents'] === 'number' ? (cfg['basePerHoleCents'] as number) : 100,
    sandies: typeof cfg['sandies'] === 'boolean' ? (cfg['sandies'] as boolean) : false,
    sandiesBonusPerHoleCents:
      typeof cfg['sandiesBonusPerHoleCents'] === 'number'
        ? (cfg['sandiesBonusPerHoleCents'] as number)
        : 0,
    greenieCarryover:
      typeof cfg['greenieCarryover'] === 'boolean' ? (cfg['greenieCarryover'] as boolean) : false,
    greenieValidation:
      cfg['greenieValidation'] === '2-putt' ? '2-putt' : 'none',
    greenieBaseCents:
      typeof cfg['greenieBaseCents'] === 'number' ? (cfg['greenieBaseCents'] as number) : 0,
  };
}

export async function computeMoneyMatrix(
  txOrDb: Tx | Db,
  eventId: string,
  _viewerPlayerId: string,
  tenantId: string,
): Promise<MoneyMatrix> {
  const computedAt = new Date().toISOString();

  // ── (1) Read event participants. ──
  const memberRows = await txOrDb
    .select({
      playerId: groupMembers.playerId,
      visibilityMode: groups.moneyVisibilityMode,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(
      and(
        eq(groups.eventId, eventId),
        eq(groups.tenantId, tenantId),
        eq(groupMembers.tenantId, tenantId),
      ),
    );
  if (memberRows.length === 0) {
    const emptyLedger: Ledger = { matrix: {}, totals: {} };
    return {
      players: [],
      matrix: {},
      totals: {},
      teamLedger: emptyLedger,
      individualLedger: emptyLedger,
      actionLedger: emptyLedger,
      computedAt,
      visibilityMode: 'open',
    };
  }
  // Distinct player ids; visibility mode from the first group (v1 single-group convention).
  const playerIds = Array.from(new Set(memberRows.map((r) => r.playerId)));
  const visibilityMode = (memberRows[0]?.visibilityMode ?? 'open') as MoneyMatrix['visibilityMode'];

  // Player names for response.
  const playerRows = await txOrDb
    .select({ id: players.id, name: players.name, manualHandicapIndex: players.manualHandicapIndex })
    .from(players)
    .where(and(inArray(players.id, playerIds), eq(players.tenantId, tenantId)));
  const playerNameById = new Map(playerRows.map((p) => [p.id, p.name]));
  const handicapIndexByPlayer: Record<string, number> = {};
  for (const p of playerRows) {
    handicapIndexByPlayer[p.id] = p.manualHandicapIndex ?? 0;
  }
  // Locked handicaps (if the event is locked) override manual for money calc.
  applyLockedToNumberMap(handicapIndexByPlayer, await loadLockedHandicapsByEvent(txOrDb, eventId, tenantId));

  // ── (2) Initialize matrix + totals. ──
  // `matrix` is the COMBINED ledger (2v2 + bets + skins) — unchanged behavior.
  // teamMatrix / individualMatrix are parallel SPLITS (T13-5) so the money page
  // can present "Team / Ball money" and "Individual bets" separately instead of
  // one blurred total. Skins stays folded into combined only (v1).
  const zeroMatrix = (): Record<string, Record<string, number>> => {
    const m: Record<string, Record<string, number>> = {};
    for (const a of playerIds) {
      m[a] = {};
      for (const b of playerIds) m[a]![b] = 0;
    }
    return m;
  };
  const matrix = zeroMatrix();
  const teamMatrix = zeroMatrix();
  const individualMatrix = zeroMatrix();
  const actionMatrix = zeroMatrix();

  // ── (3) Aggregate 2v2 best ball per round. ──
  const config = await fetchActive2v2Config(txOrDb, tenantId);
  if (config) {
    // Read all rounds for this event.
    const eventRoundRows = await txOrDb
      .select({
        id: eventRounds.id,
        teeColor: eventRounds.teeColor,
        courseRevisionId: eventRounds.courseRevisionId,
        holesToPlay: eventRounds.holesToPlay,
      })
      .from(eventRounds)
      .where(
        and(
          eq(eventRounds.eventId, eventId),
          eq(eventRounds.tenantId, tenantId),
        ),
      );

    for (const er of eventRoundRows) {
      // Find the runtime rounds row for this event_round. Deterministic +
      // identical ordering to money-detail/team-standings so all surfaces pick
      // the SAME round if more than one ever exists for an event_round
      // (otherwise money, foursome-results, and standings could desync).
      const runtimeRoundRows = await txOrDb
        .select({ id: rounds.id })
        .from(rounds)
        .where(
          and(
            eq(rounds.eventRoundId, er.id),
            eq(rounds.tenantId, tenantId),
          ),
        )
        .orderBy(asc(rounds.createdAt), asc(rounds.id))
        .limit(1);
      if (runtimeRoundRows.length === 0) continue;
      const roundId = runtimeRoundRows[0]!.id;

      // Course tee + holes.
      const teeRows = await txOrDb
        .select({ slope: courseTees.slope, rating: courseTees.rating })
        .from(courseTees)
        .where(
          and(
            eq(courseTees.courseRevisionId, er.courseRevisionId),
            eq(courseTees.teeColor, er.teeColor),
            eq(courseTees.tenantId, tenantId),
          ),
        )
        .limit(1);
      if (teeRows.length === 0) continue;
      const courseRevRow = await txOrDb
        .select({ courseTotal: courseRevisions.courseTotal })
        .from(courseRevisions)
        .where(
          and(
            eq(courseRevisions.id, er.courseRevisionId),
            eq(courseRevisions.tenantId, tenantId),
          ),
        )
        .limit(1);
      if (courseRevRow.length === 0) continue;
      const tee: TeeShape = {
        slope: teeRows[0]!.slope,
        ratingTimes10: teeRows[0]!.rating,
        coursePar: courseRevRow[0]!.courseTotal,
      };
      const holeRows = await txOrDb
        .select({
          holeNumber: courseHoles.holeNumber,
          par: courseHoles.par,
          si: courseHoles.si,
        })
        .from(courseHoles)
        .where(
          and(
            eq(courseHoles.courseRevisionId, er.courseRevisionId),
            eq(courseHoles.tenantId, tenantId),
          ),
        )
        .orderBy(courseHoles.holeNumber);
      // Respect holesToPlay (codex impl M#4). 9-hole rounds compute over
      // holes 1..9 only; 18-hole rounds use all 18.
      const courseHolesEngine: HoleShape[] = holeRows
        .filter((h) => h.holeNumber <= er.holesToPlay)
        .map((h) => ({
          holeNumber: h.holeNumber,
          par: h.par as 3 | 4 | 5,
          strokeIndex: h.si,
        }));

      // Pairings (foursomes) for this event round.
      const pairingRows = await txOrDb
        .select({ id: pairings.id, foursomeNumber: pairings.foursomeNumber })
        .from(pairings)
        .where(
          and(
            eq(pairings.eventRoundId, er.id),
            eq(pairings.tenantId, tenantId),
          ),
        );
      for (const pairing of pairingRows) {
        const memberRows2 = await txOrDb
          .select({ playerId: pairingMembers.playerId, slotNumber: pairingMembers.slotNumber })
          .from(pairingMembers)
          .where(
            and(
              eq(pairingMembers.pairingId, pairing.id),
              eq(pairingMembers.tenantId, tenantId),
            ),
          );
        // Teams come from the organizer's slot order (slots 1&2 vs 3&4), never
        // alphabetical — the partnership decides each team's best net per hole.
        const teams = resolveFoursomeTeams(memberRows2);
        if (!teams) continue;  // 4-player guard rail (matches press orchestrator)
        const { teamA, teamB, ordered: sortedMembers } = teams;

        // Hole scores for this round + foursome.
        const scoreRows = await txOrDb
          .select({
            playerId: holeScores.playerId,
            holeNumber: holeScores.holeNumber,
            grossStrokes: holeScores.grossStrokes,
            putts: holeScores.putts,
          })
          .from(holeScores)
          .where(
            and(
              eq(holeScores.roundId, roundId),
              inArray(holeScores.playerId, sortedMembers),
              eq(holeScores.tenantId, tenantId),
            ),
          );
        const holeScoresEngine: HoleScoreInput[] = scoreRows.map((s) => ({
          playerId: s.playerId,
          holeNumber: s.holeNumber,
          grossStrokes: s.grossStrokes,
          putts: s.putts,
        }));

        // Skip foursome if any member is missing handicap.
        if (sortedMembers.some((id) => handicapIndexByPlayer[id] === undefined)) continue;

        // Per-player tee overrides (T10 — Judd-on-forward-tee feature).
        // Empty map when no member sets `pairing_members.tee_color`; engine
        // falls back to `course.tee` for every player in that case.
        const teeByPlayer = await buildTeeByPlayer(txOrDb, roundId, tenantId);

        const bbInput: Compute2v2BestBallInput = {
          holeScores: holeScoresEngine,
          holeMeta: [],
          pairings: { teamA, teamB },
          config: {
            basePerHoleCents: config.basePerHoleCents,
            sandies: config.sandies,
            sandiesBonusPerHoleCents: config.sandiesBonusPerHoleCents,
            greenieCarryover: config.greenieCarryover,
            greenieValidation: config.greenieValidation,
            greenieBaseCents: config.greenieBaseCents,
          },
          course: { tee, holes: courseHolesEngine },
          handicapIndexByPlayer,
          teeByPlayer,
        };
        let bbResult: ReturnType<typeof compute2v2BestBall>;
        try {
          bbResult = compute2v2BestBall(bbInput);
        } catch {
          continue;  // engine error on a foursome — skip; don't fail entire matrix
        }

        // Accumulate perPair into combined + team ledgers.
        for (const a of Object.keys(bbResult.perPair)) {
          if (!matrix[a]) continue;
          for (const b of Object.keys(bbResult.perPair[a]!)) {
            if (!matrix[a]![b] && matrix[a]![b] !== 0) continue;
            const delta = bbResult.perPair[a]![b] ?? 0;
            matrix[a]![b] = (matrix[a]![b] ?? 0) + delta;
            teamMatrix[a]![b] = (teamMatrix[a]![b] ?? 0) + delta;
          }
        }
      }
    }
  }

  // ── (4) Aggregate individual bets. ──
  const betRows = await txOrDb
    .select({
      id: individualBets.id,
      playerAId: individualBets.playerAId,
      playerBId: individualBets.playerBId,
      betType: individualBets.betType,
      stakePerHoleCents: individualBets.stakePerHoleCents,
      configJson: individualBets.configJson,
    })
    .from(individualBets)
    .where(
      and(
        eq(individualBets.eventId, eventId),
        eq(individualBets.tenantId, tenantId),
      ),
    );

  for (const bet of betRows) {
    // Both players must be in the matrix (group_members).
    if (!matrix[bet.playerAId] || !matrix[bet.playerBId]) continue;

    let betConfig: unknown = {};
    try {
      betConfig = JSON.parse(bet.configJson);
    } catch {
      continue;
    }

    // Read applicable rounds.
    const applicableRoundRows = await txOrDb
      .select({ eventRoundId: individualBetRounds.eventRoundId })
      .from(individualBetRounds)
      .where(
        and(
          eq(individualBetRounds.betId, bet.id),
          eq(individualBetRounds.tenantId, tenantId),
        ),
      );
    if (applicableRoundRows.length === 0) continue;

    // Build engine input — fetch each round's runtime + course.
    const applicableRoundsForEngine: ComputeIndividualBetInput['applicableRounds'] = [];
    const holeScoresByCell = new Map<string, HoleScoreShape>();
    for (const ar of applicableRoundRows) {
      const erRow = await txOrDb
        .select({
          id: eventRounds.id,
          teeColor: eventRounds.teeColor,
          courseRevisionId: eventRounds.courseRevisionId,
        })
        .from(eventRounds)
        .where(
          and(
            eq(eventRounds.id, ar.eventRoundId),
            eq(eventRounds.tenantId, tenantId),
          ),
        )
        .limit(1);
      if (erRow.length === 0) continue;
      const runtimeRow = await txOrDb
        .select({ id: rounds.id })
        .from(rounds)
        .where(
          and(
            eq(rounds.eventRoundId, erRow[0]!.id),
            eq(rounds.tenantId, tenantId),
          ),
        )
        .limit(1);
      if (runtimeRow.length === 0) continue;
      const teeR = await txOrDb
        .select({ slope: courseTees.slope, rating: courseTees.rating })
        .from(courseTees)
        .where(
          and(
            eq(courseTees.courseRevisionId, erRow[0]!.courseRevisionId),
            eq(courseTees.teeColor, erRow[0]!.teeColor),
            eq(courseTees.tenantId, tenantId),
          ),
        )
        .limit(1);
      if (teeR.length === 0) continue;
      const courseRevR = await txOrDb
        .select({ courseTotal: courseRevisions.courseTotal })
        .from(courseRevisions)
        .where(
          and(
            eq(courseRevisions.id, erRow[0]!.courseRevisionId),
            eq(courseRevisions.tenantId, tenantId),
          ),
        )
        .limit(1);
      if (courseRevR.length === 0) continue;
      const holeR = await txOrDb
        .select({
          holeNumber: courseHoles.holeNumber,
          par: courseHoles.par,
          si: courseHoles.si,
        })
        .from(courseHoles)
        .where(
          and(
            eq(courseHoles.courseRevisionId, erRow[0]!.courseRevisionId),
            eq(courseHoles.tenantId, tenantId),
          ),
        )
        .orderBy(courseHoles.holeNumber);
      applicableRoundsForEngine.push({
        roundId: runtimeRow[0]!.id,
        eventRoundId: erRow[0]!.id,
        course: {
          tee: {
            slope: teeR[0]!.slope,
            ratingTimes10: teeR[0]!.rating,
            coursePar: courseRevR[0]!.courseTotal,
          },
          holes: holeR.map((h) => ({
            holeNumber: h.holeNumber,
            par: h.par as 3 | 4 | 5,
            strokeIndex: h.si,
          })),
        },
      });
      // Hole scores for both bet players in this round.
      const scoreR = await txOrDb
        .select({
          playerId: holeScores.playerId,
          holeNumber: holeScores.holeNumber,
          grossStrokes: holeScores.grossStrokes,
          putts: holeScores.putts,
        })
        .from(holeScores)
        .where(
          and(
            eq(holeScores.roundId, runtimeRow[0]!.id),
            inArray(holeScores.playerId, [bet.playerAId, bet.playerBId]),
            eq(holeScores.tenantId, tenantId),
          ),
        );
      for (const s of scoreR) {
        holeScoresByCell.set(
          `${runtimeRow[0]!.id}|${s.playerId}|${s.holeNumber}`,
          { grossStrokes: s.grossStrokes, putts: s.putts },
        );
      }
    }

    if (applicableRoundsForEngine.length === 0) continue;

    let betResult;
    try {
      betResult = computeIndividualBet({
        bet: {
          id: bet.id,
          playerAId: bet.playerAId,
          playerBId: bet.playerBId,
          betType: bet.betType as IndividualBetType,
          stakePerHoleCents: bet.stakePerHoleCents,
          config: betConfig as never,
        },
        applicableRounds: applicableRoundsForEngine,
        holeScoresByCell,
        pressesByRound: {},
        handicapIndexByPlayer,
      });
    } catch {
      continue;
    }

    // Add to combined + individual ledgers: A up netToPlayerACents on B.
    const a = bet.playerAId;
    const b = bet.playerBId;
    matrix[a]![b] = (matrix[a]![b] ?? 0) + betResult.netToPlayerACents;
    matrix[b]![a] = (matrix[b]![a] ?? 0) - betResult.netToPlayerACents;
    individualMatrix[a]![b] = (individualMatrix[a]![b] ?? 0) + betResult.netToPlayerACents;
    individualMatrix[b]![a] = (individualMatrix[b]![a] ?? 0) - betResult.netToPlayerACents;
  }

  // ── (5) Skins (T6-5a closes T6-5's deferred scope). ──
  // For each FINALIZED skins sub-game, attribute pot shares pairwise:
  //   matrix[a][b] += floor((potShares[a] - potShares[b]) / N)  for a !== b
  // This preserves anti-symmetry; sum-to-zero has ≤ N-cents drift due to
  // integer division (Followup T6-5h tracks remainder distribution if
  // observed at scale; trip-day buy-ins make the drift invisible).
  const skinsSnapshots = await loadSkinsSnapshotsForEvent(txOrDb, eventId, tenantId);
  for (const snap of skinsSnapshots) {
    const N = snap.participants.length;
    if (N < 2) continue;
    for (let i = 0; i < snap.participants.length; i++) {
      for (let j = i + 1; j < snap.participants.length; j++) {
        const a = snap.participants[i]!;
        const b = snap.participants[j]!;
        if (!matrix[a] || !matrix[b]) continue;  // skip if either not in matrix scope
        const shareA = snap.potShares.get(a) ?? 0;
        const shareB = snap.potShares.get(b) ?? 0;
        const delta = shareA - shareB;
        // floor toward -infinity for negative deltas keeps anti-symmetry
        // exact: floor((a-b)/N) === -floor((b-a)/N) only when (a-b) is
        // a multiple of N. For non-multiples, use Math.trunc-toward-zero
        // to keep matrix[a][b] === -matrix[b][a].
        const share = Math.trunc(delta / N);
        matrix[a]![b] = (matrix[a]![b] ?? 0) + share;
        matrix[b]![a] = (matrix[b]![a] ?? 0) - share;
      }
    }
  }

  // ── (5b) "The Action" bets — fold SettlementEdges into combined + action. ──
  // The edges come from the P8 chokepoint (bets-query). Direction: from PAYS to,
  // so `to` collects `cents` from `from`. matrix[a][b] = a is up on b, so the
  // winner (to) gains and the loser (from) loses. Edges are between STAKEHOLDERS
  // (roster members; FR38 non-playing backers are in playerIds). Push /
  // provisional bets emit no edges (FR26/FR39), so nothing to add for them.
  const actionEdges = await computeActionBetEdgesForEvent(txOrDb, eventId, tenantId);
  for (const edge of actionEdges) {
    const to = edge.toPlayerId;
    const from = edge.fromPlayerId;
    if (!matrix[to] || !matrix[from]) continue; // stakeholder outside event scope — skip
    matrix[to]![from] = (matrix[to]![from] ?? 0) + edge.cents;
    matrix[from]![to] = (matrix[from]![to] ?? 0) - edge.cents;
    actionMatrix[to]![from] = (actionMatrix[to]![from] ?? 0) + edge.cents;
    actionMatrix[from]![to] = (actionMatrix[from]![to] ?? 0) - edge.cents;
  }

  // ── (6) Compute totals (combined + each split). ──
  const totalsFor = (m: Record<string, Record<string, number>>): Record<string, number> => {
    const t: Record<string, number> = {};
    for (const a of playerIds) {
      let total = 0;
      for (const b of playerIds) {
        if (a === b) continue;
        total += m[a]![b] ?? 0;
      }
      t[a] = total;
    }
    return t;
  };
  const totals = totalsFor(matrix);

  // ── (7) Build players list. ──
  const playersList = playerIds.map((id) => ({
    id,
    name: playerNameById.get(id) ?? '',
  }));

  return {
    players: playersList,
    matrix,
    totals,
    teamLedger: { matrix: teamMatrix, totals: totalsFor(teamMatrix) },
    individualLedger: { matrix: individualMatrix, totals: totalsFor(individualMatrix) },
    actionLedger: { matrix: actionMatrix, totals: totalsFor(actionMatrix) },
    computedAt,
    visibilityMode,
  };
}
