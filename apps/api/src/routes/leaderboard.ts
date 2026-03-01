import { Hono } from 'hono';
import { eq, and, inArray, sql, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  rounds,
  groups,
  roundPlayers,
  players,
  holeScores,
  roundResults,
  harveyResults,
  seasons,
  sideGames,
} from '../db/schema.js';

const app = new Hono();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LeaderboardPlayer = {
  playerId: number;
  name: string;
  groupId: number;
  groupNumber: number;
  thruHole: number;
  stablefordTotal: number;
  moneyTotal: number;
  stablefordRank: number;
  moneyRank: number;
  harveyStableford: number | null;
  harveyMoney: number | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assignRanks(items: { playerId: number; total: number }[]): Map<number, number> {
  const sorted = [...items].sort((a, b) => b.total - a.total);
  const ranks = new Map<number, number>();
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i]!.total < sorted[i - 1]!.total) rank = i + 1;
    ranks.set(sorted[i]!.playerId, rank);
  }
  return ranks;
}

// ---------------------------------------------------------------------------
// GET /leaderboard/live — public, no auth middleware
// ---------------------------------------------------------------------------

app.get('/leaderboard/live', async (c) => {
  try {
    // Step 1: Find today's scheduled or active round
    const TODAY = new Date().toISOString().slice(0, 10);
    const round = await db
      .select({
        id: rounds.id,
        type: rounds.type,
        status: rounds.status,
        scheduledDate: rounds.scheduledDate,
        autoCalculateMoney: rounds.autoCalculateMoney,
        seasonId: rounds.seasonId,
      })
      .from(rounds)
      .where(
        and(
          eq(rounds.scheduledDate, TODAY),
          inArray(rounds.status, ['scheduled', 'active']),
        ),
      )
      .orderBy(desc(rounds.id))
      .get();

    if (!round) {
      return c.json(
        {
          round: null,
          harveyLiveEnabled: false,
          sideGame: null,
          leaderboard: [],
          lastUpdated: new Date().toISOString(),
        },
        200,
      );
    }

    const roundInfo = {
      id: round.id,
      type: round.type as 'official' | 'casual',
      status: round.status,
      scheduledDate: round.scheduledDate,
      autoCalculateMoney: Boolean(round.autoCalculateMoney),
    };

    // Step 2: Season — harveyLiveEnabled flag
    const season = await db
      .select({ harveyLiveEnabled: seasons.harveyLiveEnabled })
      .from(seasons)
      .where(eq(seasons.id, round.seasonId))
      .get();
    const harveyLiveEnabled = Boolean(season?.harveyLiveEnabled);

    // Step 3: All round_players with group info
    const playerRows = await db
      .select({
        playerId: roundPlayers.playerId,
        groupId: roundPlayers.groupId,
        groupNumber: groups.groupNumber,
        name: players.name,
      })
      .from(roundPlayers)
      .innerJoin(players, eq(players.id, roundPlayers.playerId))
      .innerJoin(groups, eq(groups.id, roundPlayers.groupId))
      .where(eq(roundPlayers.roundId, round.id));

    // Step 4: thruHole per group (MAX hole_number)
    const thruHoleRows = await db
      .select({
        groupId: holeScores.groupId,
        thruHole: sql<number>`max(${holeScores.holeNumber})`,
      })
      .from(holeScores)
      .where(eq(holeScores.roundId, round.id))
      .groupBy(holeScores.groupId);
    const thruHoleMap = new Map(thruHoleRows.map((r) => [r.groupId, r.thruHole ?? 0]));

    // Step 5: round_results
    const resultRows = await db
      .select({
        playerId: roundResults.playerId,
        stablefordTotal: roundResults.stablefordTotal,
        moneyTotal: roundResults.moneyTotal,
      })
      .from(roundResults)
      .where(eq(roundResults.roundId, round.id));
    const resultMap = new Map(resultRows.map((r) => [r.playerId, r]));

    // Step 6: harvey_results (conditional)
    let harveyMap = new Map<number, { stablefordPoints: number; moneyPoints: number }>();
    if (harveyLiveEnabled) {
      const harveyRows = await db
        .select({
          playerId: harveyResults.playerId,
          stablefordPoints: harveyResults.stablefordPoints,
          moneyPoints: harveyResults.moneyPoints,
        })
        .from(harveyResults)
        .where(eq(harveyResults.roundId, round.id));
      harveyMap = new Map(harveyRows.map((r) => [r.playerId, r]));
    }

    // Step 7: Active side game (JS filter on scheduledRoundIds JSON)
    const allSideGames = await db
      .select({
        name: sideGames.name,
        format: sideGames.format,
        scheduledRoundIds: sideGames.scheduledRoundIds,
      })
      .from(sideGames)
      .where(eq(sideGames.seasonId, round.seasonId));
    const activeSideGame = allSideGames.find((sg) => {
      try {
        const ids = JSON.parse(sg.scheduledRoundIds ?? '[]') as number[];
        return Array.isArray(ids) && ids.includes(round.id);
      } catch {
        return false;
      }
    });
    const sideGame = activeSideGame
      ? { name: activeSideGame.name, format: activeSideGame.format }
      : null;

    // Step 8: Rank assignment (dense, higher total = better rank)
    const stablefordRanks = assignRanks(
      playerRows.map((p) => ({
        playerId: p.playerId,
        total: resultMap.get(p.playerId)?.stablefordTotal ?? 0,
      })),
    );
    const moneyRanks = assignRanks(
      playerRows.map((p) => ({
        playerId: p.playerId,
        total: resultMap.get(p.playerId)?.moneyTotal ?? 0,
      })),
    );

    // Step 9: Assemble and sort
    const leaderboard: LeaderboardPlayer[] = playerRows
      .map((p) => {
        const result = resultMap.get(p.playerId);
        const harvey = harveyMap.get(p.playerId);
        return {
          playerId: p.playerId,
          name: p.name,
          groupId: p.groupId,
          groupNumber: p.groupNumber,
          thruHole: thruHoleMap.get(p.groupId) ?? 0,
          stablefordTotal: result?.stablefordTotal ?? 0,
          moneyTotal: result?.moneyTotal ?? 0,
          stablefordRank: stablefordRanks.get(p.playerId) ?? playerRows.length,
          moneyRank: moneyRanks.get(p.playerId) ?? playerRows.length,
          harveyStableford: harveyLiveEnabled ? (harvey?.stablefordPoints ?? null) : null,
          harveyMoney: harveyLiveEnabled ? (harvey?.moneyPoints ?? null) : null,
        };
      })
      .sort((a, b) => a.stablefordRank - b.stablefordRank || a.name.localeCompare(b.name));

    return c.json(
      { round: roundInfo, harveyLiveEnabled, sideGame, leaderboard, lastUpdated: new Date().toISOString() },
      200,
    );
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

export default app;
