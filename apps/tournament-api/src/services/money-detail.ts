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
import {
  compute2v2BestBall,
  type HoleScoreInput,
  type TeeShape,
} from '../engine/formats/best-ball-2v2.js';
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
