import { Hono } from 'hono';
import { eq, and, isNotNull, count, desc, inArray } from 'drizzle-orm';
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

    // Step 10: Best partnership — league-wide from 2v2 wolf_decisions
    const allPartnerDecisions = await db
      .select({
        roundId: wolfDecisions.roundId,
        groupId: wolfDecisions.groupId,
        wolfPlayerId: wolfDecisions.wolfPlayerId,
        partnerPlayerId: wolfDecisions.partnerPlayerId,
        outcome: wolfDecisions.outcome,
      })
      .from(wolfDecisions)
      .innerJoin(rounds, eq(rounds.id, wolfDecisions.roundId))
      .where(and(
        eq(rounds.type, 'official'),
        eq(rounds.status, 'finalized'),
        eq(wolfDecisions.decision, 'partner'),
      ));

    // Get all group memberships for these rounds to find opposing pairs
    const partnerRoundIds = [...new Set(allPartnerDecisions.map((d) => d.roundId))];
    const allGroupMembersForPartnership = partnerRoundIds.length > 0 ? await db
      .select({
        roundId: roundPlayers.roundId,
        groupId: roundPlayers.groupId,
        playerId: roundPlayers.playerId,
      })
      .from(roundPlayers)
      .where(inArray(roundPlayers.roundId, partnerRoundIds)) : [];

    const gpMap = new Map<string, number[]>();
    for (const gm of allGroupMembersForPartnership) {
      const key = `${gm.roundId}-${gm.groupId}`;
      const arr = gpMap.get(key) ?? [];
      arr.push(gm.playerId);
      gpMap.set(key, arr);
    }

    // Build partnership stats: both wolf+partner team AND opponent team
    const pairMap = new Map<string, { ids: [number, number]; holes: number; wins: number; losses: number; pushes: number }>();
    const nameMapAll = new Map(allPlayers.map((p) => [p.id, p.name]));

    for (const d of allPartnerDecisions) {
      if (d.wolfPlayerId == null || d.partnerPlayerId == null) continue;
      const key1 = `${d.roundId}-${d.groupId}`;
      const groupPlayers = gpMap.get(key1) ?? [];

      // Wolf team pair
      const wolfPairKey = [d.wolfPlayerId, d.partnerPlayerId].sort((a, b) => a - b).join('-');
      const wolfPair = pairMap.get(wolfPairKey) ?? { ids: [Math.min(d.wolfPlayerId, d.partnerPlayerId), Math.max(d.wolfPlayerId, d.partnerPlayerId)] as [number, number], holes: 0, wins: 0, losses: 0, pushes: 0 };
      wolfPair.holes++;
      if (d.outcome === 'win') wolfPair.wins++;
      else if (d.outcome === 'loss') wolfPair.losses++;
      else if (d.outcome === 'push') wolfPair.pushes++;
      pairMap.set(wolfPairKey, wolfPair);

      // Opponent team pair
      const opponents = groupPlayers.filter((pid) => pid !== d.wolfPlayerId && pid !== d.partnerPlayerId);
      if (opponents.length === 2) {
        const oppPairKey = opponents.sort((a, b) => a - b).join('-');
        const oppPair = pairMap.get(oppPairKey) ?? { ids: [opponents[0]!, opponents[1]!] as [number, number], holes: 0, wins: 0, losses: 0, pushes: 0 };
        oppPair.holes++;
        // Inverted outcome for opponents
        if (d.outcome === 'win') oppPair.losses++;
        else if (d.outcome === 'loss') oppPair.wins++;
        else if (d.outcome === 'push') oppPair.pushes++;
        pairMap.set(oppPairKey, oppPair);
      }
    }

    // Find best partnership (min 5 holes together, highest win rate)
    const qualifiedPairs = [...pairMap.values()].filter((p) => p.holes >= 5);
    let bestPartnership: { player1: string; player2: string; holes: number; wins: number; losses: number; pushes: number; winRate: number } | null = null;
    if (qualifiedPairs.length > 0) {
      const best = qualifiedPairs.reduce((a, b) => {
        const aRate = a.wins / a.holes;
        const bRate = b.wins / b.holes;
        if (Math.abs(aRate - bRate) > 0.001) return bRate > aRate ? b : a;
        return b.holes > a.holes ? b : a; // tiebreak: more holes
      });
      bestPartnership = {
        player1: nameMapAll.get(best.ids[0]) ?? 'Unknown',
        player2: nameMapAll.get(best.ids[1]) ?? 'Unknown',
        holes: best.holes,
        wins: best.wins,
        losses: best.losses,
        pushes: best.pushes,
        winRate: Math.round((best.wins / best.holes) * 100),
      };
    }

    return c.json({ players: playerStats, bestPartnership, lastUpdated: new Date().toISOString() }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /stats/:playerId/detail — per-hole averages + round history + rivals
// ---------------------------------------------------------------------------

app.get('/stats/:playerId/detail', async (c) => {
  const playerId = Number(c.req.param('playerId'));
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return c.json({ error: 'Invalid player ID', code: 'INVALID_ID' }, 400);
  }

  try {
    // Get all finalized official rounds this player participated in
    const playerRoundRows = await db
      .select({
        roundId: roundPlayers.roundId,
        groupId: roundPlayers.groupId,
        handicapIndex: roundPlayers.handicapIndex,
        scheduledDate: rounds.scheduledDate,
        tee: rounds.tee,
      })
      .from(roundPlayers)
      .innerJoin(rounds, eq(rounds.id, roundPlayers.roundId))
      .where(and(
        eq(roundPlayers.playerId, playerId),
        eq(rounds.type, 'official'),
        eq(rounds.status, 'finalized'),
      ))
      .orderBy(rounds.scheduledDate);

    const roundIds = playerRoundRows.map((r) => r.roundId);

    if (roundIds.length === 0) {
      return c.json({ playerId, holeAverages: [], rounds: [], rivals: [], chemistry: [] }, 200);
    }

    // Per-hole scores for this player across all rounds
    const holeRows = await db
      .select({
        roundId: holeScores.roundId,
        holeNumber: holeScores.holeNumber,
        grossScore: holeScores.grossScore,
      })
      .from(holeScores)
      .where(and(
        eq(holeScores.playerId, playerId),
        inArray(holeScores.roundId, roundIds),
      ));

    // Group by hole number for averages
    const holeMap = new Map<number, number[]>();
    for (const row of holeRows) {
      const arr = holeMap.get(row.holeNumber) ?? [];
      arr.push(row.grossScore);
      holeMap.set(row.holeNumber, arr);
    }

    const holeAverages = Array.from({ length: 18 }, (_, i) => {
      const hole = i + 1;
      const scores = holeMap.get(hole) ?? [];
      const courseHole = getCourseHole(hole as Parameters<typeof getCourseHole>[0]);
      return {
        hole,
        par: courseHole.par,
        avg: scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : null,
        min: scores.length > 0 ? Math.min(...scores) : null,
        max: scores.length > 0 ? Math.max(...scores) : null,
        rounds: scores.length,
      };
    });

    // Round-by-round summary
    const rrRows = await db
      .select({
        roundId: roundResults.roundId,
        stablefordTotal: roundResults.stablefordTotal,
        moneyTotal: roundResults.moneyTotal,
      })
      .from(roundResults)
      .where(and(
        eq(roundResults.playerId, playerId),
        inArray(roundResults.roundId, roundIds),
      ));
    const rrMap = new Map(rrRows.map((r) => [r.roundId, r]));

    // Gross totals per round
    const grossByRound = new Map<number, number>();
    for (const row of holeRows) {
      grossByRound.set(row.roundId, (grossByRound.get(row.roundId) ?? 0) + row.grossScore);
    }

    const roundSummaries = playerRoundRows.map((pr) => {
      const rr = rrMap.get(pr.roundId);
      return {
        roundId: pr.roundId,
        date: pr.scheduledDate,
        tee: pr.tee,
        handicapIndex: pr.handicapIndex,
        gross: grossByRound.get(pr.roundId) ?? 0,
        stableford: rr?.stablefordTotal ?? 0,
        money: rr?.moneyTotal ?? 0,
      };
    });

    // Rivals: who was in the same group, money differential
    const groupIds = playerRoundRows.map((r) => r.groupId);
    const groupMates = await db
      .select({
        roundId: roundPlayers.roundId,
        groupId: roundPlayers.groupId,
        playerId: roundPlayers.playerId,
      })
      .from(roundPlayers)
      .where(and(
        inArray(roundPlayers.groupId, groupIds),
        inArray(roundPlayers.roundId, roundIds),
      ));

    // Map roundId → this player's groupId
    const myGroupByRound = new Map(playerRoundRows.map((r) => [r.roundId, r.groupId]));

    // Get all round results for group mates
    const allGroupPlayerIds = [...new Set(groupMates.map((g) => g.playerId))];
    const allRRRows = await db
      .select({
        roundId: roundResults.roundId,
        playerId: roundResults.playerId,
        moneyTotal: roundResults.moneyTotal,
      })
      .from(roundResults)
      .where(and(
        inArray(roundResults.playerId, allGroupPlayerIds),
        inArray(roundResults.roundId, roundIds),
      ));
    const rrLookup = new Map<string, number>();
    for (const r of allRRRows) rrLookup.set(`${r.roundId}-${r.playerId}`, r.moneyTotal);

    // Build rival stats
    const rivalMap = new Map<number, { name: string; roundsTogether: number; myMoney: number; theirMoney: number }>();
    const playerNames = await db.select({ id: players.id, name: players.name }).from(players).where(inArray(players.id, allGroupPlayerIds));
    const nameMap = new Map(playerNames.map((p) => [p.id, p.name]));

    for (const gm of groupMates) {
      if (gm.playerId === playerId) continue;
      if (myGroupByRound.get(gm.roundId) !== gm.groupId) continue; // different group same round

      const rival = rivalMap.get(gm.playerId) ?? {
        name: nameMap.get(gm.playerId) ?? 'Unknown',
        roundsTogether: 0,
        myMoney: 0,
        theirMoney: 0,
      };
      rival.roundsTogether++;
      rival.myMoney += rrLookup.get(`${gm.roundId}-${playerId}`) ?? 0;
      rival.theirMoney += rrLookup.get(`${gm.roundId}-${gm.playerId}`) ?? 0;
      rivalMap.set(gm.playerId, rival);
    }

    const rivals = [...rivalMap.entries()]
      .map(([id, r]) => ({
        playerId: id,
        name: r.name,
        roundsTogether: r.roundsTogether,
        myMoney: r.myMoney,
        theirMoney: r.theirMoney,
        moneyDiff: r.myMoney - r.theirMoney,
      }))
      .sort((a, b) => b.roundsTogether - a.roundsTogether);

    // Chemistry: partner relationships from wolf_decisions on 2v2 holes
    const decisionRows = await db
      .select({
        roundId: wolfDecisions.roundId,
        groupId: wolfDecisions.groupId,
        holeNumber: wolfDecisions.holeNumber,
        wolfPlayerId: wolfDecisions.wolfPlayerId,
        decision: wolfDecisions.decision,
        partnerPlayerId: wolfDecisions.partnerPlayerId,
        outcome: wolfDecisions.outcome,
      })
      .from(wolfDecisions)
      .where(and(
        inArray(wolfDecisions.roundId, roundIds),
        eq(wolfDecisions.decision, 'partner'),
      ));

    // Build a map: groupId+roundId → list of player IDs in that group
    const groupPlayersMap = new Map<string, number[]>();
    for (const gm of groupMates) {
      const key = `${gm.roundId}-${gm.groupId}`;
      const arr = groupPlayersMap.get(key) ?? [];
      arr.push(gm.playerId);
      groupPlayersMap.set(key, arr);
    }

    // For each 2v2 hole, determine if this player was involved and who their partner was
    const chemMap = new Map<number, { name: string; holes: number; wins: number; losses: number; pushes: number }>();
    for (const d of decisionRows) {
      // Only process holes where this player was in the group
      const key = `${d.roundId}-${d.groupId}`;
      const groupPlayers = groupPlayersMap.get(key) ?? [];
      if (!groupPlayers.includes(playerId)) continue;

      let partnerId: number | null = null;
      let playerWon: string | null = null; // from this player's perspective

      if (d.wolfPlayerId === playerId) {
        // This player was wolf, their partner is partnerPlayerId
        partnerId = d.partnerPlayerId;
        playerWon = d.outcome; // wolf's outcome = this player's outcome
      } else if (d.partnerPlayerId === playerId) {
        // This player was picked as partner
        partnerId = d.wolfPlayerId;
        playerWon = d.outcome; // same team as wolf
      } else {
        // This player is on the opposing team — find the other opponent
        const opponents = groupPlayers.filter(
          (pid) => pid !== d.wolfPlayerId && pid !== d.partnerPlayerId,
        );
        partnerId = opponents.find((pid) => pid !== playerId) ?? null;
        // Invert outcome: wolf win = opponent loss, wolf loss = opponent win
        if (d.outcome === 'win') playerWon = 'loss';
        else if (d.outcome === 'loss') playerWon = 'win';
        else playerWon = d.outcome; // push stays push, null stays null
      }

      if (partnerId == null) continue;

      const entry = chemMap.get(partnerId) ?? {
        name: nameMap.get(partnerId) ?? 'Unknown',
        holes: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
      };
      entry.holes++;
      if (playerWon === 'win') entry.wins++;
      else if (playerWon === 'loss') entry.losses++;
      else if (playerWon === 'push') entry.pushes++;
      chemMap.set(partnerId, entry);
    }

    const chemistry = [...chemMap.entries()]
      .map(([id, c]) => ({
        playerId: id,
        name: c.name,
        holes: c.holes,
        wins: c.wins,
        losses: c.losses,
        pushes: c.pushes,
        winRate: c.holes > 0 ? Math.round((c.wins / c.holes) * 100) : 0,
      }))
      .sort((a, b) => b.holes - a.holes);

    return c.json({ playerId, holeAverages, rounds: roundSummaries, rivals, chemistry }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

export default app;
