/**
 * T13-5 money PRESENTATION detail service.
 *
 * The combined H2H matrix (`money.ts`) sums 2v2 best-ball + individual bets +
 * skins into one number per pair, discarding the per-hole detail both engines
 * already produce. This module surfaces that detail for the two presentation
 * surfaces Josh asked for (2026-06-12):
 *   - computeFoursomeResults: the per-foursome 2v2 team match, hole by hole
 *     (team best nets, hole winner, money/hole) + each player's gross/net.
 *
 * Pure reads; no writes/audit/activity. Reuses the SAME engine
 * (compute2v2BestBall) and the SAME team-formation rule (UUID sort →
 * teamA = first two) as money.ts §3, so the numbers reconcile exactly.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { db as DbType } from '../db/index.js';
import {
  courseHoles,
  courseRevisions,
  courseTees,
  eventRounds,
  holeScores,
  pairingMembers,
  pairings,
  players,
  rounds,
} from '../db/schema/index.js';
import { individualBetRounds, individualBets } from '../db/schema/index.js';
import {
  compute2v2BestBall,
  type HoleScoreInput,
  type TeeShape,
} from '../engine/formats/best-ball-2v2.js';
import {
  computeIndividualBet,
  type ComputeIndividualBetInput,
  type HoleScoreShape,
  type IndividualBetType,
} from '../engine/rules/individual-bets.js';
import { getHandicapStrokes } from '../engine/handicap-strokes.js';
import { fetchActive2v2Config } from './money.js';
import { buildTeeByPlayer } from './per-player-tee.js';

type Db = typeof DbType;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type FoursomePlayerHole = {
  playerId: string;
  gross: number | null;
  net: number | null;
};

export type FoursomeHoleResult = {
  holeNumber: number;
  par: number;
  /** Lower team best net wins the hole; null until both teams have a net. */
  teamABestNet: number | null;
  teamBBestNet: number | null;
  winner: 'teamA' | 'teamB' | 'tie' | null;
  /** Signed: positive = teamA up this hole. */
  moneyTeamACents: number;
  players: FoursomePlayerHole[];
};

export type FoursomeResult = {
  foursomeNumber: number;
  teamA: Array<{ playerId: string; name: string | null }>;
  teamB: Array<{ playerId: string; name: string | null }>;
  perHole: FoursomeHoleResult[];
  /** Signed round total: positive = teamA up. */
  teamATotalCents: number;
  /** Cross-team pairwise cents (antisymmetric). */
  perPair: Record<string, Record<string, number>>;
};

export type FoursomeResultsResponse = {
  eventRoundId: string;
  roundNumber: number;
  foursomes: FoursomeResult[];
};

/**
 * Compute every foursome's 2v2 team result (hole by hole) for one event round.
 * Returns an empty `foursomes` list (not an error) when the round isn't set up
 * or no rule config exists — the route maps that to a 200 with empty results.
 */
export async function computeFoursomeResults(
  txOrDb: Tx | Db,
  eventRoundId: string,
  tenantId: string,
): Promise<FoursomeResultsResponse | null> {
  const erRows = await txOrDb
    .select({
      id: eventRounds.id,
      roundNumber: eventRounds.roundNumber,
      teeColor: eventRounds.teeColor,
      courseRevisionId: eventRounds.courseRevisionId,
      holesToPlay: eventRounds.holesToPlay,
    })
    .from(eventRounds)
    .where(and(eq(eventRounds.id, eventRoundId), eq(eventRounds.tenantId, tenantId)))
    .limit(1);
  if (erRows.length === 0) return null;
  const er = erRows[0]!;

  const empty: FoursomeResultsResponse = {
    eventRoundId,
    roundNumber: er.roundNumber,
    foursomes: [],
  };

  const config = await fetchActive2v2Config(txOrDb, tenantId);
  if (!config) return empty;

  const runtimeRoundRows = await txOrDb
    .select({ id: rounds.id })
    .from(rounds)
    .where(and(eq(rounds.eventRoundId, er.id), eq(rounds.tenantId, tenantId)))
    .limit(1);
  if (runtimeRoundRows.length === 0) return empty;
  const roundId = runtimeRoundRows[0]!.id;

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
  if (teeRows.length === 0) return empty;
  const courseRevRow = await txOrDb
    .select({ courseTotal: courseRevisions.courseTotal })
    .from(courseRevisions)
    .where(and(eq(courseRevisions.id, er.courseRevisionId), eq(courseRevisions.tenantId, tenantId)))
    .limit(1);
  if (courseRevRow.length === 0) return empty;
  const tee: TeeShape = {
    slope: teeRows[0]!.slope,
    ratingTimes10: teeRows[0]!.rating,
    coursePar: courseRevRow[0]!.courseTotal,
  };

  const holeRows = await txOrDb
    .select({ holeNumber: courseHoles.holeNumber, par: courseHoles.par, si: courseHoles.si })
    .from(courseHoles)
    .where(
      and(
        eq(courseHoles.courseRevisionId, er.courseRevisionId),
        eq(courseHoles.tenantId, tenantId),
      ),
    )
    .orderBy(courseHoles.holeNumber);
  const holesInPlay = holeRows.filter((h) => h.holeNumber <= er.holesToPlay);
  const siByHole = new Map(holesInPlay.map((h) => [h.holeNumber, h.si]));
  const parByHole = new Map(holesInPlay.map((h) => [h.holeNumber, h.par]));
  const courseHolesEngine = holesInPlay.map((h) => ({
    holeNumber: h.holeNumber,
    par: h.par as 3 | 4 | 5,
    strokeIndex: h.si,
  }));

  const teeByPlayer = await buildTeeByPlayer(txOrDb, roundId, tenantId);

  const pairingRows = await txOrDb
    .select({ id: pairings.id, foursomeNumber: pairings.foursomeNumber })
    .from(pairings)
    .where(and(eq(pairings.eventRoundId, er.id), eq(pairings.tenantId, tenantId)))
    .orderBy(pairings.foursomeNumber);

  const foursomes: FoursomeResult[] = [];
  for (const pairing of pairingRows) {
    const memberRows = await txOrDb
      .select({ playerId: pairingMembers.playerId })
      .from(pairingMembers)
      .where(
        and(eq(pairingMembers.pairingId, pairing.id), eq(pairingMembers.tenantId, tenantId)),
      );
    if (memberRows.length !== 4) continue; // engine requires 4 (matches money.ts)
    const sortedMembers = memberRows.map((m) => m.playerId).sort();
    const teamAIds: [string, string] = [sortedMembers[0]!, sortedMembers[1]!];
    const teamBIds: [string, string] = [sortedMembers[2]!, sortedMembers[3]!];

    const nameRows = await txOrDb
      .select({ id: players.id, name: players.name, hi: players.manualHandicapIndex })
      .from(players)
      .where(and(inArray(players.id, sortedMembers), eq(players.tenantId, tenantId)));
    const nameById = new Map(nameRows.map((p) => [p.id, p.name]));
    const hiById: Record<string, number> = {};
    for (const p of nameRows) hiById[p.id] = p.hi ?? 0;

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
    const grossByCell = new Map<string, number>();
    const engineScores: HoleScoreInput[] = scoreRows.map((s) => {
      grossByCell.set(`${s.playerId}|${s.holeNumber}`, s.grossStrokes);
      return {
        playerId: s.playerId,
        holeNumber: s.holeNumber,
        grossStrokes: s.grossStrokes,
        putts: s.putts,
      };
    });

    let bb;
    try {
      bb = compute2v2BestBall({
        holeScores: engineScores,
        holeMeta: [],
        pairings: { teamA: teamAIds, teamB: teamBIds },
        config: {
          basePerHoleCents: config.basePerHoleCents,
          sandies: config.sandies,
          sandiesBonusPerHoleCents: config.sandiesBonusPerHoleCents,
          greenieCarryover: config.greenieCarryover,
          greenieValidation: config.greenieValidation,
          greenieBaseCents: config.greenieBaseCents,
        },
        course: { tee, holes: courseHolesEngine },
        handicapIndexByPlayer: hiById,
        teeByPlayer,
      });
    } catch {
      continue; // engine error on a foursome — skip, don't fail the response
    }

    const holeResultByNumber = new Map(bb.perHole.map((h) => [h.holeNumber, h]));
    const perHole: FoursomeHoleResult[] = holesInPlay.map((h) => {
      const hr = holeResultByNumber.get(h.holeNumber);
      const playerHoles: FoursomePlayerHole[] = sortedMembers.map((pid) => {
        const gross = grossByCell.get(`${pid}|${h.holeNumber}`) ?? null;
        const si = siByHole.get(h.holeNumber);
        const playerTee = teeByPlayer[pid] ?? tee;
        const net =
          gross !== null && si !== undefined
            ? gross - getHandicapStrokes(hiById[pid] ?? 0, si, playerTee)
            : null;
        return { playerId: pid, gross, net };
      });
      return {
        holeNumber: h.holeNumber,
        par: parByHole.get(h.holeNumber) ?? 0,
        teamABestNet: hr ? hr.teamABestNet : null,
        teamBBestNet: hr ? hr.teamBBestNet : null,
        winner: hr ? hr.winner : null,
        moneyTeamACents: hr ? hr.teamDeltaCents : 0,
        players: playerHoles,
      };
    });

    foursomes.push({
      foursomeNumber: pairing.foursomeNumber,
      teamA: teamAIds.map((id) => ({ playerId: id, name: nameById.get(id) ?? null })),
      teamB: teamBIds.map((id) => ({ playerId: id, name: nameById.get(id) ?? null })),
      perHole,
      teamATotalCents: bb.perRound.teamTotalCents,
      perPair: bb.perPair,
    });
  }

  return { eventRoundId, roundNumber: er.roundNumber, foursomes };
}

// ── My Money: viewer-centric P&L decomposed by game ───────────────────────

export type MyMoneyHole = {
  holeNumber: number;
  par: number;
  viewerGross: number | null;
  viewerNet: number | null;
  /** Opponent's gross (individual games); null for the foursome team game. */
  oppGross: number | null;
  /** Opponent net (individual) or opposing team best net (foursome). */
  oppNet: number | null;
  winner: 'viewer' | 'opponent' | 'halved' | null;
  /** Signed to the viewer: positive = viewer won this hole. */
  moneyToViewerCents: number;
};

export type MyMoneyGameRound = {
  eventRoundId: string;
  roundNumber: number;
  netToViewerCents: number;
  perHole: MyMoneyHole[];
};

export type MyMoneyGame = {
  kind: 'foursome' | 'individual';
  /** Stable id: 'foursome' for the team game, the betId for each side game. */
  key: string;
  label: string;
  opponentName: string | null;
  netToViewerCents: number;
  perRound: MyMoneyGameRound[];
};

export type MyMoneyResponse = {
  viewerId: string;
  totalNetCents: number;
  games: MyMoneyGame[];
};

/**
 * The viewer's entire event P&L, decomposed by game: the 2-ball foursome match
 * (their team, across rounds) + one entry per individual side bet they're in.
 * Every cents value is VIEWER-SIGNED (positive = viewer won). Each game's
 * per-hole money sums to its round net; game nets sum to totalNetCents — so a
 * player who is −$20 in the 2-ball and +$10/+$15 in two side matches sees those
 * three subheadings and a +$5 grand total.
 */
export async function computeMyMoney(
  txOrDb: Tx | Db,
  eventId: string,
  viewerId: string,
  tenantId: string,
): Promise<MyMoneyResponse> {
  const games: MyMoneyGame[] = [];

  // ── Foursome (team) game — reuse computeFoursomeResults per round. ──
  const erRows = await txOrDb
    .select({ id: eventRounds.id, roundNumber: eventRounds.roundNumber })
    .from(eventRounds)
    .where(and(eq(eventRounds.eventId, eventId), eq(eventRounds.tenantId, tenantId)))
    .orderBy(eventRounds.roundNumber);

  const foursomeRounds: MyMoneyGameRound[] = [];
  for (const er of erRows) {
    const fr = await computeFoursomeResults(txOrDb, er.id, tenantId);
    if (!fr) continue;
    const mine = fr.foursomes.find(
      (f) =>
        f.teamA.some((p) => p.playerId === viewerId) ||
        f.teamB.some((p) => p.playerId === viewerId),
    );
    if (!mine) continue;
    const viewerOnA = mine.teamA.some((p) => p.playerId === viewerId);
    let roundNet = 0;
    const perHole: MyMoneyHole[] = mine.perHole.map((h) => {
      const me = h.players.find((p) => p.playerId === viewerId);
      // h.moneyTeamACents is the WHOLE team's signed delta (4 cross-pairs). The
      // viewer is in only 2 of those 4 pairs, so their PERSONAL share is half —
      // this is what reconciles with the combined money matrix (a teamA player's
      // foursome total = matrix[viewer][b1] + matrix[viewer][b2] = teamDelta/2).
      // Always integer: teamDelta = 4 × perPairCents.
      const teamSigned = viewerOnA ? h.moneyTeamACents : -h.moneyTeamACents;
      const moneyToViewer = teamSigned / 2;
      roundNet += moneyToViewer;
      const winner: MyMoneyHole['winner'] =
        h.winner === null
          ? null
          : h.winner === 'tie'
            ? 'halved'
            : (h.winner === 'teamA') === viewerOnA
              ? 'viewer'
              : 'opponent';
      return {
        holeNumber: h.holeNumber,
        par: h.par,
        viewerGross: me?.gross ?? null,
        viewerNet: me?.net ?? null,
        oppGross: null,
        oppNet: viewerOnA ? h.teamBBestNet : h.teamABestNet,
        winner,
        moneyToViewerCents: moneyToViewer,
      };
    });
    foursomeRounds.push({
      eventRoundId: er.id,
      roundNumber: er.roundNumber,
      netToViewerCents: roundNet,
      perHole,
    });
  }
  if (foursomeRounds.length > 0) {
    games.push({
      kind: 'foursome',
      key: 'foursome',
      label: '2-Ball Foursome Match',
      opponentName: null,
      netToViewerCents: foursomeRounds.reduce((a, r) => a + r.netToViewerCents, 0),
      perRound: foursomeRounds,
    });
  }

  // ── Individual side games — one per bet the viewer is in. ──
  const roundNumberByEventRound = new Map(erRows.map((r) => [r.id, r.roundNumber]));
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
    .where(and(eq(individualBets.eventId, eventId), eq(individualBets.tenantId, tenantId)));

  for (const bet of betRows) {
    const viewerIsA = bet.playerAId === viewerId;
    const viewerIsB = bet.playerBId === viewerId;
    if (!viewerIsA && !viewerIsB) continue;
    const oppId = viewerIsA ? bet.playerBId : bet.playerAId;

    let betConfig: unknown = {};
    try {
      betConfig = JSON.parse(bet.configJson);
    } catch {
      continue;
    }

    const oppNameRows = await txOrDb
      .select({ name: players.name, hiA: players.manualHandicapIndex })
      .from(players)
      .where(and(eq(players.id, oppId), eq(players.tenantId, tenantId)))
      .limit(1);
    const opponentName = oppNameRows[0]?.name ?? null;

    const hiRows = await txOrDb
      .select({ id: players.id, hi: players.manualHandicapIndex })
      .from(players)
      .where(and(inArray(players.id, [bet.playerAId, bet.playerBId]), eq(players.tenantId, tenantId)));
    const handicapIndexByPlayer: Record<string, number> = {};
    for (const p of hiRows) handicapIndexByPlayer[p.id] = p.hi ?? 0;

    const applicableRoundRows = await txOrDb
      .select({ eventRoundId: individualBetRounds.eventRoundId })
      .from(individualBetRounds)
      .where(
        and(eq(individualBetRounds.betId, bet.id), eq(individualBetRounds.tenantId, tenantId)),
      );
    if (applicableRoundRows.length === 0) continue;

    const applicableRoundsForEngine: ComputeIndividualBetInput['applicableRounds'] = [];
    const holeScoresByCell = new Map<string, HoleScoreShape>();
    const grossByCell = new Map<string, number>();
    for (const ar of applicableRoundRows) {
      const erRow = await txOrDb
        .select({
          id: eventRounds.id,
          teeColor: eventRounds.teeColor,
          courseRevisionId: eventRounds.courseRevisionId,
        })
        .from(eventRounds)
        .where(and(eq(eventRounds.id, ar.eventRoundId), eq(eventRounds.tenantId, tenantId)))
        .limit(1);
      if (erRow.length === 0) continue;
      const runtimeRow = await txOrDb
        .select({ id: rounds.id })
        .from(rounds)
        .where(and(eq(rounds.eventRoundId, erRow[0]!.id), eq(rounds.tenantId, tenantId)))
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
        .select({ holeNumber: courseHoles.holeNumber, par: courseHoles.par, si: courseHoles.si })
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
        const cell = `${runtimeRow[0]!.id}|${s.playerId}|${s.holeNumber}`;
        holeScoresByCell.set(cell, { grossStrokes: s.grossStrokes, putts: s.putts });
        grossByCell.set(cell, s.grossStrokes);
      }
    }
    if (applicableRoundsForEngine.length === 0) continue;

    let out;
    try {
      out = computeIndividualBet({
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

    const sign = viewerIsA ? 1 : -1;
    const perRound: MyMoneyGameRound[] = out.perRound.map((r) => {
      let roundNet = 0;
      const perHole: MyMoneyHole[] = r.perHole.map((ph) => {
        const moneyToViewer = sign * (ph.baseDeltaCents + ph.pressDeltaCents);
        roundNet += moneyToViewer;
        const winner: MyMoneyHole['winner'] =
          ph.winner === 'halved'
            ? 'halved'
            : (ph.winner === 'playerA') === viewerIsA
              ? 'viewer'
              : 'opponent';
        return {
          holeNumber: ph.holeNumber,
          par: ph.par,
          viewerGross: grossByCell.get(`${r.roundId}|${viewerId}|${ph.holeNumber}`) ?? null,
          viewerNet: viewerIsA ? ph.netA : ph.netB,
          oppGross: grossByCell.get(`${r.roundId}|${oppId}|${ph.holeNumber}`) ?? null,
          oppNet: viewerIsA ? ph.netB : ph.netA,
          winner,
          moneyToViewerCents: moneyToViewer,
        };
      });
      return {
        eventRoundId: r.eventRoundId,
        roundNumber: roundNumberByEventRound.get(r.eventRoundId) ?? 0,
        netToViewerCents: roundNet,
        perHole,
      };
    });

    games.push({
      kind: 'individual',
      key: bet.id,
      label: opponentName ? `Match vs ${opponentName}` : 'Side match',
      opponentName,
      netToViewerCents: sign * out.netToPlayerACents,
      perRound,
    });
  }

  const totalNetCents = games.reduce((a, g) => a + g.netToViewerCents, 0);
  return { viewerId, totalNetCents, games };
}
