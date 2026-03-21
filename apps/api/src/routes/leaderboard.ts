import { Hono } from 'hono';
import { eq, and, or, inArray, desc, countDistinct } from 'drizzle-orm';
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
import { getCourseHole, getHandicapStrokes, calculateHarveyPoints } from '@wolf-cup/engine';
import type { HoleNumber } from '@wolf-cup/engine';

const app = new Hono();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LeaderboardPlayer = {
  playerId: number;
  name: string;
  handicapIndex: number;
  groupId: number;
  groupNumber: number;
  thruHole: number;
  grossTotal: number;
  netToPar: number;
  stablefordTotal: number;
  moneyTotal: number;
  rank: number;          // primary: netToPar ascending
  stablefordRank: number; // for Harvey computation
  moneyRank: number;
  harveyStableford: number | null;
  harveyMoney: number | null;
  harveyTotal: number | null;
};

type RoundRow = {
  id: number;
  type: string;
  status: string;
  scheduledDate: string;
  autoCalculateMoney: number;
  seasonId: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Dense rank, descending — higher total = better (stableford / money) */
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

/** Dense rank, ascending — lower total = better (net-to-par) */
function assignRanksAsc(items: { playerId: number; total: number }[]): Map<number, number> {
  const sorted = [...items].sort((a, b) => a.total - b.total);
  const ranks = new Map<number, number>();
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i]!.total > sorted[i - 1]!.total) rank = i + 1;
    ranks.set(sorted[i]!.playerId, rank);
  }
  return ranks;
}

/** Build full leaderboard response for a given round */
async function buildLeaderboard(round: RoundRow) {
  const roundInfo = {
    id: round.id,
    type: round.type as 'official' | 'casual',
    status: round.status,
    scheduledDate: round.scheduledDate,
    autoCalculateMoney: Boolean(round.autoCalculateMoney),
  };

  // Season — harveyLiveEnabled flag
  const season = await db
    .select({ harveyLiveEnabled: seasons.harveyLiveEnabled })
    .from(seasons)
    .where(eq(seasons.id, round.seasonId))
    .get();
  const harveyLiveEnabled = Boolean(season?.harveyLiveEnabled);

  // All round_players with group info and handicap
  const playerRows = await db
    .select({
      playerId: roundPlayers.playerId,
      groupId: roundPlayers.groupId,
      groupNumber: groups.groupNumber,
      name: players.name,
      handicapIndex: roundPlayers.handicapIndex,
    })
    .from(roundPlayers)
    .innerJoin(players, eq(players.id, roundPlayers.playerId))
    .innerJoin(groups, eq(groups.id, roundPlayers.groupId))
    .where(eq(roundPlayers.roundId, round.id));

  // All hole scores → compute thruHole per group + grossTotal/netToPar per player
  const handicapMap = new Map(playerRows.map((p) => [p.playerId, p.handicapIndex]));

  const allHoleScoreRows = await db
    .select({
      playerId: holeScores.playerId,
      groupId: holeScores.groupId,
      holeNumber: holeScores.holeNumber,
      grossScore: holeScores.grossScore,
    })
    .from(holeScores)
    .where(eq(holeScores.roundId, round.id));

  const thruHoleMap = new Map<number, number>(); // groupId → max holeNumber
  const playerStatsMap = new Map<number, { grossTotal: number; netToPar: number }>();

  for (const row of allHoleScoreRows) {
    const courseHole = getCourseHole(row.holeNumber as HoleNumber);
    const hi = handicapMap.get(row.playerId) ?? 0;
    const strokes = getHandicapStrokes(hi, courseHole.strokeIndex);
    const net = row.grossScore - strokes;

    thruHoleMap.set(row.groupId, Math.max(thruHoleMap.get(row.groupId) ?? 0, row.holeNumber));

    const stats = playerStatsMap.get(row.playerId) ?? { grossTotal: 0, netToPar: 0 };
    stats.grossTotal += row.grossScore;
    stats.netToPar += net - courseHole.par;
    playerStatsMap.set(row.playerId, stats);
  }

  // round_results for stablefordTotal / moneyTotal
  const resultRows = await db
    .select({
      playerId: roundResults.playerId,
      stablefordTotal: roundResults.stablefordTotal,
      moneyTotal: roundResults.moneyTotal,
    })
    .from(roundResults)
    .where(eq(roundResults.roundId, round.id));
  const resultMap = new Map(resultRows.map((r) => [r.playerId, r]));

  // Harvey points — try DB first (finalized rounds), fall back to live computation
  let harveyMap = new Map<number, { stablefordPoints: number; moneyPoints: number }>();
  if (harveyLiveEnabled) {
    // Try stored results first (finalized rounds with harvey_results)
    if (round.status !== 'active') {
      const harveyRows = await db
        .select({
          playerId: harveyResults.playerId,
          stablefordPoints: harveyResults.stablefordPoints,
          moneyPoints: harveyResults.moneyPoints,
        })
        .from(harveyResults)
        .where(eq(harveyResults.roundId, round.id));
      if (harveyRows.length > 0) {
        harveyMap = new Map(harveyRows.map((r) => [r.playerId, r]));
      }
    }
    // Compute on the fly if no stored results (active rounds or missing harvey_results)
    if (harveyMap.size === 0 && playerRows.length > 0) {
      const playerCount = playerRows.length;
      const bonusPerPlayer =
        ({ 1: 8, 2: 6, 3: 4, 4: 2 } as Record<number, number>)[
          Math.floor(playerCount / 4)
        ] ?? 0;
      const harveyInput = playerRows.map((p) => {
        const r = resultMap.get(p.playerId);
        return { stableford: r?.stablefordTotal ?? 0, money: r?.moneyTotal ?? 0 };
      });
      const liveHarvey = calculateHarveyPoints(harveyInput, 'regular', bonusPerPlayer);
      harveyMap = new Map(
        playerRows.map((p, i) => [
          p.playerId,
          {
            stablefordPoints: liveHarvey[i]!.stablefordPoints,
            moneyPoints: liveHarvey[i]!.moneyPoints,
          },
        ]),
      );
    }
  }

  // Active side game
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

  // Rank assignments
  const netToParRanks = assignRanksAsc(
    playerRows.map((p) => ({
      playerId: p.playerId,
      total: playerStatsMap.get(p.playerId)?.netToPar ?? 0,
    })),
  );
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

  // Compute Harvey totals and determine primary rank
  const harveyTotalMap = new Map<number, number>();
  if (harveyLiveEnabled) {
    for (const p of playerRows) {
      const h = harveyMap.get(p.playerId);
      harveyTotalMap.set(p.playerId, h ? h.stablefordPoints + h.moneyPoints : 0);
    }
  }
  const primaryRanks = harveyLiveEnabled
    ? assignRanks(playerRows.map((p) => ({ playerId: p.playerId, total: harveyTotalMap.get(p.playerId) ?? 0 })))
    : netToParRanks;

  const leaderboard: LeaderboardPlayer[] = playerRows
    .map((p) => {
      const result = resultMap.get(p.playerId);
      const stats = playerStatsMap.get(p.playerId);
      const harvey = harveyMap.get(p.playerId);
      return {
        playerId: p.playerId,
        name: p.name,
        handicapIndex: p.handicapIndex,
        groupId: p.groupId,
        groupNumber: p.groupNumber,
        thruHole: thruHoleMap.get(p.groupId) ?? 0,
        grossTotal: stats?.grossTotal ?? 0,
        netToPar: stats?.netToPar ?? 0,
        stablefordTotal: result?.stablefordTotal ?? 0,
        moneyTotal: result?.moneyTotal ?? 0,
        rank: primaryRanks.get(p.playerId) ?? playerRows.length,
        stablefordRank: stablefordRanks.get(p.playerId) ?? playerRows.length,
        moneyRank: moneyRanks.get(p.playerId) ?? playerRows.length,
        harveyStableford: harveyLiveEnabled ? (harvey?.stablefordPoints ?? null) : null,
        harveyMoney: harveyLiveEnabled ? (harvey?.moneyPoints ?? null) : null,
        harveyTotal: harveyLiveEnabled ? (harveyTotalMap.get(p.playerId) ?? null) : null,
      };
    })
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

  return { round: roundInfo, harveyLiveEnabled, sideGame, leaderboard, lastUpdated: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// GET /leaderboard/live — public, no auth middleware
// ---------------------------------------------------------------------------

app.get('/leaderboard/live', async (c) => {
  try {
    // Find today's scheduled or active round
    // Active rounds always show (even if date doesn't match — supports testing
    // and late-night scoring). Scheduled rounds only show on their date.
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
        or(
          eq(rounds.status, 'active'),
          and(
            eq(rounds.scheduledDate, TODAY),
            eq(rounds.status, 'scheduled'),
          ),
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

    return c.json(await buildLeaderboard(round), 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /leaderboard/history — list of completed rounds (most recent first)
// ---------------------------------------------------------------------------

app.get('/leaderboard/history', async (c) => {
  try {
    const roundRows = await db
      .select({
        id: rounds.id,
        type: rounds.type,
        status: rounds.status,
        scheduledDate: rounds.scheduledDate,
      })
      .from(rounds)
      .where(inArray(rounds.status, ['finalized', 'active']))
      .orderBy(desc(rounds.scheduledDate), desc(rounds.id));

    // Get player counts per round
    const playerCounts = await db
      .select({ roundId: roundPlayers.roundId, count: countDistinct(roundPlayers.playerId) })
      .from(roundPlayers)
      .groupBy(roundPlayers.roundId);
    const countMap = new Map(playerCounts.map((r) => [r.roundId, r.count]));

    const rows = roundRows.map((r) => ({
      ...r,
      playerCount: countMap.get(r.id) ?? 0,
    }));

    return c.json({ rounds: rows }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /leaderboard/:roundId — leaderboard for a specific round
// ---------------------------------------------------------------------------

app.get('/leaderboard/:roundId', async (c) => {
  try {
    const roundId = Number(c.req.param('roundId'));
    if (!Number.isInteger(roundId) || roundId <= 0) {
      return c.json({ error: 'Invalid round ID', code: 'INVALID_ID' }, 400);
    }

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
      .where(eq(rounds.id, roundId))
      .get();

    if (!round) {
      return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
    }

    return c.json(await buildLeaderboard(round), 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

export default app;
