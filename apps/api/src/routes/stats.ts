import { Hono } from 'hono';
import { eq, and, isNotNull, count, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { players, rounds, wolfDecisions, holeScores, roundResults, seasons, groups, roundPlayers } from '../db/schema.js';
import { getCourseHole, calculateSandbaggerStatus, TEE_RATINGS } from '@wolf-cup/engine';
import type { SandbaggerRoundInput, Tee } from '@wolf-cup/engine';
import { HISTORICAL_CHAMPIONS, HISTORICAL_STANDINGS, HISTORICAL_ROSTERS, HISTORICAL_CASH, HISTORICAL_IRONMAN, HISTORICAL_CASH_RECORDS } from '../db/history-data.js';
import { computeAllAwards, computePlayerBadges } from '../lib/badges.js';
import type { PlayerBadge } from '../lib/badges.js';

const app = new Hono();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlayerStats = {
  playerId: number;
  name: string;
  wolfCallsTotal: number;
  wolfCallsWolf: number;
  wolfCallsBlindWolf: number;
  wolfWins: number;
  wolfLosses: number;
  wolfPushes: number;
  birdies: number;
  eagles: number;
  greenies: number;
  polies: number;
  totalMoney: number;
  biggestRoundWin: number;
  biggestRoundLoss: number;
  championshipWins?: number;
  championshipYears?: number[];
  isDefendingChampion?: boolean;
  badges?: PlayerBadge[];
  sandbagging?: { beatsCount: number; totalRounds: number; tier: 1 | 2 | 3 };
};

// ---------------------------------------------------------------------------
// GET /stats — public, no auth middleware
// ---------------------------------------------------------------------------

app.get('/stats', async (c) => {
  try {
    // Step 1: All non-guest active players, sorted by name
    const allPlayers = await db
      .select({ id: players.id, name: players.name })
      .from(players)
      .where(and(eq(players.isActive, 1), eq(players.isGuest, 0)))
      .orderBy(players.name);

    // Step 2: Wolf decisions for official finalized rounds
    const wdRows = await db
      .select({
        wolfPlayerId: wolfDecisions.wolfPlayerId,
        decision: wolfDecisions.decision,
        outcome: wolfDecisions.outcome,
        bonusesJson: wolfDecisions.bonusesJson,
      })
      .from(wolfDecisions)
      .innerJoin(rounds, eq(rounds.id, wolfDecisions.roundId))
      .where(and(eq(rounds.type, 'official'), eq(rounds.status, 'finalized')));

    // Step 3: Hole scores for birdies/eagles (gross)
    const hsRows = await db
      .select({
        playerId: holeScores.playerId,
        roundId: holeScores.roundId,
        holeNumber: holeScores.holeNumber,
        grossScore: holeScores.grossScore,
      })
      .from(holeScores)
      .innerJoin(rounds, eq(rounds.id, holeScores.roundId))
      .where(and(eq(rounds.type, 'official'), eq(rounds.status, 'finalized')));

    // Step 4: Round money totals
    const rrRows = await db
      .select({ playerId: roundResults.playerId, moneyTotal: roundResults.moneyTotal })
      .from(roundResults)
      .innerJoin(rounds, eq(rounds.id, roundResults.roundId))
      .where(and(eq(rounds.type, 'official'), eq(rounds.status, 'finalized')));

    // Step 4b: Championship win counts
    const champCounts = await db
      .select({ playerId: seasons.championPlayerId, wins: count() })
      .from(seasons)
      .where(isNotNull(seasons.championPlayerId))
      .groupBy(seasons.championPlayerId);
    const champMap = new Map<number, number>();
    for (const row of champCounts) {
      if (row.playerId != null) champMap.set(row.playerId, row.wins);
    }

    // Step 4c: Championship years per player (for year labels under trophies)
    const champYearRows = await db
      .select({ playerId: seasons.championPlayerId, year: seasons.year })
      .from(seasons)
      .where(isNotNull(seasons.championPlayerId))
      .orderBy(seasons.year);
    const champYearsMap = new Map<number, number[]>();
    for (const row of champYearRows) {
      if (row.playerId != null) {
        const arr = champYearsMap.get(row.playerId) ?? [];
        arr.push(row.year);
        champYearsMap.set(row.playerId, arr);
      }
    }

    // Step 4d: Defending champion (most recent completed season's champion)
    const mostRecentChamp = await db
      .select({ championPlayerId: seasons.championPlayerId })
      .from(seasons)
      .where(isNotNull(seasons.championPlayerId))
      .orderBy(desc(seasons.year))
      .limit(1);
    const defendingChampId = mostRecentChamp[0]?.championPlayerId ?? null;

    // Step 4e: Compute badge awards from historical data
    const allAwards = computeAllAwards(
      HISTORICAL_CHAMPIONS, HISTORICAL_STANDINGS, HISTORICAL_ROSTERS,
      HISTORICAL_CASH, HISTORICAL_IRONMAN, HISTORICAL_CASH_RECORDS,
    );

    // Step 5: Aggregate wolf record per player
    const wolfMap = new Map<
      number,
      { total: number; wolf: number; blindWolf: number; wins: number; losses: number; pushes: number }
    >();
    for (const row of wdRows) {
      if (row.wolfPlayerId == null) continue; // skip skins holes
      const s = wolfMap.get(row.wolfPlayerId) ?? {
        total: 0,
        wolf: 0,
        blindWolf: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
      };
      s.total++;
      if (row.decision === 'alone') s.wolf++;
      else if (row.decision === 'blind_wolf') s.blindWolf++;
      // W-L-T only counts alone and blind wolf calls
      if (row.decision === 'alone' || row.decision === 'blind_wolf') {
        if (row.outcome === 'win') s.wins++;
        else if (row.outcome === 'loss') s.losses++;
        else if (row.outcome === 'push') s.pushes++;
      }
      wolfMap.set(row.wolfPlayerId, s);
    }

    // Step 6: Greenies + polies from bonusesJson
    const greenieMap = new Map<number, number>();
    const polieMap = new Map<number, number>();
    for (const row of wdRows) {
      if (!row.bonusesJson) continue;
      try {
        const b = JSON.parse(row.bonusesJson) as { greenies?: number[]; polies?: number[] };
        for (const pid of b.greenies ?? []) greenieMap.set(pid, (greenieMap.get(pid) ?? 0) + 1);
        for (const pid of b.polies ?? []) polieMap.set(pid, (polieMap.get(pid) ?? 0) + 1);
      } catch {
        // ignore malformed JSON
      }
    }

    // Step 7: Gross birdies / eagles
    const birdieMap = new Map<number, number>();
    const eagleMap = new Map<number, number>();
    for (const row of hsRows) {
      const courseHole = getCourseHole(row.holeNumber as Parameters<typeof getCourseHole>[0]);
      const diff = row.grossScore - courseHole.par;
      if (diff === -1) {
        birdieMap.set(row.playerId, (birdieMap.get(row.playerId) ?? 0) + 1);
      } else if (diff <= -2) {
        eagleMap.set(row.playerId, (eagleMap.get(row.playerId) ?? 0) + 1);
      }
    }

    // Step 8: Total money, biggest round win / loss
    const totalMoneyMap = new Map<number, number>();
    const winMap = new Map<number, number>();
    const lossMap = new Map<number, number>();
    for (const row of rrRows) {
      totalMoneyMap.set(row.playerId, (totalMoneyMap.get(row.playerId) ?? 0) + row.moneyTotal);
      winMap.set(row.playerId, Math.max(winMap.get(row.playerId) ?? 0, row.moneyTotal));
      lossMap.set(row.playerId, Math.min(lossMap.get(row.playerId) ?? 0, row.moneyTotal));
    }

    // Step 8b: Sandbagger detection — per-player gross totals + tee info
    const validTees = new Set<string>(['black', 'blue', 'white']);
    // Get gross totals per (roundId, playerId) — only complete 18-hole rounds
    const grossByRoundPlayer = new Map<string, number>(); // key: `${roundId}-${playerId}`
    const holeCountByRoundPlayer = new Map<string, number>();
    for (const row of hsRows) {
      const key = `${row.roundId}-${row.playerId}`;
      grossByRoundPlayer.set(key, (grossByRoundPlayer.get(key) ?? 0) + row.grossScore);
      holeCountByRoundPlayer.set(key, (holeCountByRoundPlayer.get(key) ?? 0) + 1);
    }

    // Get roundPlayers for HI snapshots and group tee info
    const rpRows = await db
      .select({
        roundId: roundPlayers.roundId,
        playerId: roundPlayers.playerId,
        handicapIndex: roundPlayers.handicapIndex,
        groupId: roundPlayers.groupId,
      })
      .from(roundPlayers)
      .innerJoin(rounds, eq(rounds.id, roundPlayers.roundId))
      .where(and(eq(rounds.type, 'official'), eq(rounds.status, 'finalized')));

    // Get group tees and round tees
    const groupTeeMap = new Map<number, string | null>();
    const groupRows = await db
      .select({ id: groups.id, tee: groups.tee })
      .from(groups);
    for (const g of groupRows) groupTeeMap.set(g.id, g.tee);

    const roundTeeMap = new Map<number, string | null>();
    const roundTeeRows = await db
      .select({ id: rounds.id, tee: rounds.tee })
      .from(rounds)
      .where(and(eq(rounds.type, 'official'), eq(rounds.status, 'finalized')));
    for (const r of roundTeeRows) roundTeeMap.set(r.id, r.tee);

    // Build sandbagger inputs per player
    const sandbaggerMap = new Map<number, SandbaggerRoundInput[]>();
    for (const rp of rpRows) {
      const key = `${rp.roundId}-${rp.playerId}`;
      const holeCount = holeCountByRoundPlayer.get(key) ?? 0;
      if (holeCount < 18) continue; // incomplete round
      const gross18 = grossByRoundPlayer.get(key) ?? 0;
      const tee = (groupTeeMap.get(rp.groupId) ?? roundTeeMap.get(rp.roundId)) as string | null;
      if (!tee || !validTees.has(tee)) continue; // skip invalid tee
      const ratings = TEE_RATINGS[tee as Tee];
      if (!ratings) continue;
      const input: SandbaggerRoundInput = {
        gross18,
        courseRating: ratings.courseRating,
        slopeRating: ratings.slopeRating,
        handicapIndex: rp.handicapIndex,
      };
      const arr = sandbaggerMap.get(rp.playerId) ?? [];
      arr.push(input);
      sandbaggerMap.set(rp.playerId, arr);
    }

    // Step 9: Build response array
    const playerStats: PlayerStats[] = allPlayers.map((p) => {
      const w = wolfMap.get(p.id);
      return {
        playerId: p.id,
        name: p.name,
        wolfCallsTotal: w?.total ?? 0,
        wolfCallsWolf: w?.wolf ?? 0,
        wolfCallsBlindWolf: w?.blindWolf ?? 0,
        wolfWins: w?.wins ?? 0,
        wolfLosses: w?.losses ?? 0,
        wolfPushes: w?.pushes ?? 0,
        birdies: birdieMap.get(p.id) ?? 0,
        eagles: eagleMap.get(p.id) ?? 0,
        greenies: greenieMap.get(p.id) ?? 0,
        polies: polieMap.get(p.id) ?? 0,
        totalMoney: totalMoneyMap.get(p.id) ?? 0,
        biggestRoundWin: winMap.get(p.id) ?? 0,
        biggestRoundLoss: lossMap.get(p.id) ?? 0,
        ...(champMap.has(p.id) ? { championshipWins: champMap.get(p.id)! } : {}),
        ...(champYearsMap.has(p.id) ? { championshipYears: champYearsMap.get(p.id)! } : {}),
        ...(p.id === defendingChampId ? { isDefendingChampion: true } : {}),
        ...(() => {
          const badges = computePlayerBadges(p.name, allAwards);
          return badges.length > 0 ? { badges } : {};
        })(),
        ...(() => {
          const sandbaggerRounds = sandbaggerMap.get(p.id);
          if (!sandbaggerRounds || sandbaggerRounds.length === 0) return {};
          const result = calculateSandbaggerStatus(sandbaggerRounds);
          if (result.tier === 0) return {};
          return { sandbagging: { beatsCount: result.beatsCount, totalRounds: result.totalRounds, tier: result.tier as 1 | 2 | 3 } };
        })(),
      };
    });

    return c.json({ players: playerStats, lastUpdated: new Date().toISOString() }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

export default app;
