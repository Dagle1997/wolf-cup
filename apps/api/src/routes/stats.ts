import { Hono } from 'hono';
import { eq, and, isNotNull, count, desc, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { players, rounds, wolfDecisions, holeScores, roundResults, seasons, groups, roundPlayers } from '../db/schema.js';
import { getCourseHole, calculateSandbaggerStatus, TEE_RATINGS, getWolfAssignment } from '@wolf-cup/engine';
import type { SandbaggerRoundInput, Tee } from '@wolf-cup/engine';
import { HISTORICAL_CHAMPIONS, HISTORICAL_STANDINGS, HISTORICAL_ROSTERS, HISTORICAL_CASH, HISTORICAL_IRONMAN, HISTORICAL_CASH_RECORDS } from '../db/history-data.js';
import { computeAllAwards, computePlayerBadges } from '../lib/badges.js';
import type { PlayerBadge } from '../lib/badges.js';

const app = new Hono();

const POSITIONS = ['1st Batter', '2nd Batter', '3rd Batter', '4th Batter'] as const;

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
  sandies: number;
  totalMoney: number;
  biggestRoundWin: number;
  biggestRoundLoss: number;
  moneyByRound: number[];
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

    // Step 4: Round money totals (ordered by date for sparklines)
    const rrRows = await db
      .select({ playerId: roundResults.playerId, moneyTotal: roundResults.moneyTotal, scheduledDate: rounds.scheduledDate })
      .from(roundResults)
      .innerJoin(rounds, eq(rounds.id, roundResults.roundId))
      .where(and(eq(rounds.type, 'official'), eq(rounds.status, 'finalized')))
      .orderBy(rounds.scheduledDate);

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

    // Step 6: Greenies + polies + sandies from bonusesJson
    const greenieMap = new Map<number, number>();
    const polieMap = new Map<number, number>();
    const sandieMap = new Map<number, number>();
    for (const row of wdRows) {
      if (!row.bonusesJson) continue;
      try {
        const b = JSON.parse(row.bonusesJson) as { greenies?: number[]; polies?: number[]; sandies?: number[] };
        for (const pid of b.greenies ?? []) greenieMap.set(pid, (greenieMap.get(pid) ?? 0) + 1);
        for (const pid of b.polies ?? []) polieMap.set(pid, (polieMap.get(pid) ?? 0) + 1);
        for (const pid of b.sandies ?? []) sandieMap.set(pid, (sandieMap.get(pid) ?? 0) + 1);
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

    // Step 8: Total money, biggest round win / loss, per-round sparkline data
    const totalMoneyMap = new Map<number, number>();
    const winMap = new Map<number, number>();
    const lossMap = new Map<number, number>();
    const moneyByRoundMap = new Map<number, number[]>();
    for (const row of rrRows) {
      totalMoneyMap.set(row.playerId, (totalMoneyMap.get(row.playerId) ?? 0) + row.moneyTotal);
      winMap.set(row.playerId, Math.max(winMap.get(row.playerId) ?? 0, row.moneyTotal));
      lossMap.set(row.playerId, Math.min(lossMap.get(row.playerId) ?? 0, row.moneyTotal));
      const arr = moneyByRoundMap.get(row.playerId) ?? [];
      arr.push(row.moneyTotal);
      moneyByRoundMap.set(row.playerId, arr);
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
        sandies: sandieMap.get(p.id) ?? 0,
        totalMoney: totalMoneyMap.get(p.id) ?? 0,
        biggestRoundWin: winMap.get(p.id) ?? 0,
        biggestRoundLoss: lossMap.get(p.id) ?? 0,
        moneyByRound: moneyByRoundMap.get(p.id) ?? [],
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

    // Find best partnership — actually winning together (win rate > 50%).
    // Sample-size floor removed; a pair with 1-0 qualifies if nobody else is > 50%.
    // Below-50% and exactly-50% pairs aren't "best" of anything, so the stat
    // hides until someone earns it.
    const qualifiedPairs = [...pairMap.values()].filter((p) => p.holes > 0 && p.wins / p.holes > 0.5);
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
      return c.json({ playerId, holeAverages: [], rounds: [], rivals: [], chemistry: [], statEvents: [], bonusEvents: [], battingPerformance: [] }, 200);
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

    // Rivals — per-hole team composition × per-hole money.
    //
    // POSITIVE-ONLY attributions — losses don't offset gains.
    //
    //   luckyCharm — my GAINS on ANY shared hole with X, partner OR opponent.
    //                "You happen to cash when I'm around." Not about team
    //                chemistry (that's Best Partnership) — just correlation.
    //                Same value for all groupmates in a single round where
    //                they were all around for every hole; diverges over the
    //                season as group compositions change.
    //   dominate   — my GAINS on opponent-only holes with X. "When they're
    //                against me, I take from them."
    //   rival      — my LOSSES on opponent-only holes with X. "When they're
    //                against me, they take from me."
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

    // Map roundId → this player's groupId (to filter groupMates to actual shared rounds)
    const myGroupByRound = new Map(playerRoundRows.map((r) => [r.roundId, r.groupId]));

    // Name lookup
    const allGroupPlayerIds = [...new Set(groupMates.map((g) => g.playerId))];
    const playerNames = await db
      .select({ id: players.id, name: players.name })
      .from(players)
      .where(inArray(players.id, allGroupPlayerIds));
    const nameMap = new Map(playerNames.map((p) => [p.id, p.name]));

    // Per-(round, group) player list for team-composition lookup
    const groupRoster = new Map<string, number[]>();
    for (const gm of groupMates) {
      const key = `${gm.roundId}-${gm.groupId}`;
      const arr = groupRoster.get(key) ?? [];
      arr.push(gm.playerId);
      groupRoster.set(key, arr);
    }

    // Fetch wolf decisions for the relevant (round, group) pairs
    const myGroupKeys = new Set([...myGroupByRound.entries()].map(([r, g]) => `${r}-${g}`));
    const allDecisionsForRivals = roundIds.length > 0
      ? await db
          .select({
            roundId: wolfDecisions.roundId,
            groupId: wolfDecisions.groupId,
            holeNumber: wolfDecisions.holeNumber,
            decision: wolfDecisions.decision,
            wolfPlayerId: wolfDecisions.wolfPlayerId,
            partnerPlayerId: wolfDecisions.partnerPlayerId,
          })
          .from(wolfDecisions)
          .where(inArray(wolfDecisions.roundId, roundIds))
      : [];
    const decisionByKey = new Map<string, typeof allDecisionsForRivals[number]>();
    for (const d of allDecisionsForRivals) {
      if (!myGroupKeys.has(`${d.roundId}-${d.groupId}`)) continue;
      decisionByKey.set(`${d.roundId}-${d.groupId}-${d.holeNumber}`, d);
    }

    // Compute per-round money breakdowns (one API call per distinct round)
    const { getHoleTeamFor } = await import('../lib/hole-teams.js');
    const { computeRoundMoneyBreakdown } = await import('../lib/money-breakdown.js');

    // Accumulator: rivalId → buckets. All totals are positive-only (losses
    // captured as positive values in opp_lost).
    const rivalBuckets = new Map<number, {
      roundsTogetherSet: Set<number>;
      partnerHoles: number;
      opponentHoles: number;
      shared_won: number;       // my gains on ANY shared hole — luckyCharm
      opp_won: number;          // my gains on opponent holes — dominate
      opp_lost: number;         // my losses on opponent holes — rival (positive)
      opp_holesWon: number;     // count of opp holes I gained on
      opp_holesLost: number;    // count of opp holes I lost on
    }>();
    const bucket = (rivalId: number) => {
      let b = rivalBuckets.get(rivalId);
      if (!b) {
        b = {
          roundsTogetherSet: new Set(),
          partnerHoles: 0,
          opponentHoles: 0,
          shared_won: 0,
          opp_won: 0,
          opp_lost: 0,
          opp_holesWon: 0,
          opp_holesLost: 0,
        };
        rivalBuckets.set(rivalId, b);
      }
      return b;
    };

    for (const rId of roundIds) {
      const myGid = myGroupByRound.get(rId);
      if (myGid === undefined) continue;
      const rosterKey = `${rId}-${myGid}`;
      const rosterPlayers = groupRoster.get(rosterKey) ?? [];
      if (!rosterPlayers.includes(playerId)) continue;

      // Money breakdown for this round
      const breakdown = await computeRoundMoneyBreakdown(rId);
      const myGroupHoles = breakdown.holes.filter((h) => h.groupId === myGid);
      if (myGroupHoles.length === 0) continue;

      // Track rounds-together per rival
      for (const otherId of rosterPlayers) {
        if (otherId === playerId) continue;
        bucket(otherId).roundsTogetherSet.add(rId);
      }

      // Iterate each scored hole in my group and attribute $ to rivals
      for (const hb of myGroupHoles) {
        const decRow = decisionByKey.get(`${rId}-${myGid}-${hb.holeNumber}`);
        const wolfDec = (hb.decision && hb.wolfPlayerId !== null)
          ? {
              decision: hb.decision,
              wolfPlayerId: hb.wolfPlayerId,
              partnerPlayerId: hb.partnerPlayerId,
            }
          : (decRow && decRow.decision && decRow.wolfPlayerId !== null)
            ? {
                decision: decRow.decision as 'alone' | 'partner' | 'blind_wolf',
                wolfPlayerId: decRow.wolfPlayerId,
                partnerPlayerId: decRow.partnerPlayerId,
              }
            : null;

        const composition = getHoleTeamFor(playerId, hb.holeNumber, rosterPlayers, wolfDec);
        const myMoney = hb.perPlayer.get(playerId)?.total ?? 0;
        const myGain = Math.max(myMoney, 0);
        const myLoss = Math.max(-myMoney, 0); // absolute value of loss (0 if I gained)

        for (const rivalId of rosterPlayers) {
          if (rivalId === playerId) continue;
          const b = bucket(rivalId);
          // Lucky Charm: gains count regardless of team role
          b.shared_won += myGain;
          if (composition.teammates.has(rivalId)) {
            b.partnerHoles += 1;
          } else if (composition.opponents.has(rivalId)) {
            b.opponentHoles += 1;
            b.opp_won += myGain;
            b.opp_lost += myLoss;
            if (myMoney > 0) b.opp_holesWon += 1;
            else if (myMoney < 0) b.opp_holesLost += 1;
          }
          // If neither (wolf hole with no decision), only charm gets the gain.
        }
      }
    }

    const rivals = [...rivalBuckets.entries()]
      .map(([id, b]) => ({
        playerId: id,
        name: nameMap.get(id) ?? 'Unknown',
        roundsTogether: b.roundsTogetherSet.size,
        partnerHoles: b.partnerHoles,
        opponentHoles: b.opponentHoles,
        luckyCharm: b.shared_won,
        dominate: b.opp_won,
        rival: b.opp_lost,
        holesWon: b.opp_holesWon,
        holesLost: b.opp_holesLost,
      }))
      .sort((a, b) => b.rival - a.rival);

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

    // Stat drill-downs: eagles, birdies, greenies, polies with hole/round/date context
    const roundDateMap = new Map(playerRoundRows.map((r) => [r.roundId, r.scheduledDate]));

    const statEvents: { type: 'eagle' | 'birdie'; hole: number; par: number; gross: number; roundId: number; date: string }[] = [];
    for (const row of holeRows) {
      const courseHoleData = getCourseHole(row.holeNumber as Parameters<typeof getCourseHole>[0]);
      const diff = row.grossScore - courseHoleData.par;
      if (diff <= -2) {
        statEvents.push({ type: 'eagle', hole: row.holeNumber, par: courseHoleData.par, gross: row.grossScore, roundId: row.roundId, date: roundDateMap.get(row.roundId) ?? '' });
      } else if (diff === -1) {
        statEvents.push({ type: 'birdie', hole: row.holeNumber, par: courseHoleData.par, gross: row.grossScore, roundId: row.roundId, date: roundDateMap.get(row.roundId) ?? '' });
      }
    }

    // Greenies and polies from wolf_decisions bonusesJson
    const bonusDecisionRows = await db
      .select({
        roundId: wolfDecisions.roundId,
        holeNumber: wolfDecisions.holeNumber,
        bonusesJson: wolfDecisions.bonusesJson,
      })
      .from(wolfDecisions)
      .where(and(
        inArray(wolfDecisions.roundId, roundIds),
        isNotNull(wolfDecisions.bonusesJson),
      ));

    const bonusEvents: { type: 'greenie' | 'polie' | 'sandie'; hole: number; par: number; roundId: number; date: string }[] = [];
    for (const row of bonusDecisionRows) {
      if (!row.bonusesJson) continue;
      try {
        const parsed = JSON.parse(row.bonusesJson) as { greenies?: number[]; polies?: number[]; sandies?: number[] };
        const courseHoleData = getCourseHole(row.holeNumber as Parameters<typeof getCourseHole>[0]);
        if (parsed.greenies?.includes(playerId)) {
          bonusEvents.push({ type: 'greenie', hole: row.holeNumber, par: courseHoleData.par, roundId: row.roundId, date: roundDateMap.get(row.roundId) ?? '' });
        }
        if (parsed.polies?.includes(playerId)) {
          bonusEvents.push({ type: 'polie', hole: row.holeNumber, par: courseHoleData.par, roundId: row.roundId, date: roundDateMap.get(row.roundId) ?? '' });
        }
        if (parsed.sandies?.includes(playerId)) {
          bonusEvents.push({ type: 'sandie', hole: row.holeNumber, par: courseHoleData.par, roundId: row.roundId, date: roundDateMap.get(row.roundId) ?? '' });
        }
      } catch { /* skip malformed JSON */ }
    }

    // Batting order performance: money/stableford/wolf record by position
    const groupRows = await db
      .select({
        groupId: groups.id,
        roundId: groups.roundId,
        battingOrder: groups.battingOrder,
      })
      .from(groups)
      .where(and(
        inArray(groups.roundId, roundIds),
        isNotNull(groups.battingOrder),
      ));

    // Reuse myGroupByRound from rivals section above
    const rrMap2 = new Map(
      (await db.select({ roundId: roundResults.roundId, playerId: roundResults.playerId, stablefordTotal: roundResults.stablefordTotal, moneyTotal: roundResults.moneyTotal })
        .from(roundResults)
        .where(and(eq(roundResults.playerId, playerId), inArray(roundResults.roundId, roundIds)))
      ).map((r) => [r.roundId, r]),
    );

    // Wolf decisions for this player's rounds (for wolf record by position)
    const wolfDecRows = await db
      .select({
        roundId: wolfDecisions.roundId,
        groupId: wolfDecisions.groupId,
        holeNumber: wolfDecisions.holeNumber,
        wolfPlayerId: wolfDecisions.wolfPlayerId,
        decision: wolfDecisions.decision,
        outcome: wolfDecisions.outcome,
      })
      .from(wolfDecisions)
      .where(and(
        inArray(wolfDecisions.roundId, roundIds),
      ));

    const positionStats = [0, 1, 2, 3].map((pos) => ({
      position: pos,
      rounds: 0,
      totalMoney: 0,
      totalStableford: 0,
      wolfWins: 0,
      wolfLosses: 0,
      wolfPushes: 0,
    }));

    for (const gr of groupRows) {
      if (myGroupByRound.get(gr.roundId) !== gr.groupId) continue;
      if (!gr.battingOrder) continue;
      let battingArr: number[];
      try { battingArr = JSON.parse(gr.battingOrder) as number[]; } catch { continue; }
      const posIdx = battingArr.indexOf(playerId);
      if (posIdx === -1) continue;

      const stat = positionStats[posIdx]!;
      stat.rounds++;
      const rr = rrMap2.get(gr.roundId);
      if (rr) {
        stat.totalMoney += rr.moneyTotal;
        stat.totalStableford += rr.stablefordTotal;
      }

      // Wolf record for holes where this player was wolf based on batting position
      const roundWolfDecs = wolfDecRows.filter((d) => d.roundId === gr.roundId && d.groupId === gr.groupId);
      for (const d of roundWolfDecs) {
        if (d.holeNumber === 1 || d.holeNumber === 3) continue; // skins holes
        const assignment = getWolfAssignment(battingArr as [number, number, number, number], d.holeNumber as Parameters<typeof getWolfAssignment>[1]);
        if (assignment.type === 'wolf' && assignment.wolfBatterIndex === posIdx) {
          // This player was wolf on this hole
          if (d.wolfPlayerId === playerId) {
            if (d.outcome === 'win') stat.wolfWins++;
            else if (d.outcome === 'loss') stat.wolfLosses++;
            else if (d.outcome === 'push') stat.wolfPushes++;
          }
        }
      }
    }

    const battingPerformance = positionStats.map((s) => ({
      position: s.position,
      label: POSITIONS[s.position] ?? '',
      rounds: s.rounds,
      avgMoney: s.rounds > 0 ? Math.round((s.totalMoney / s.rounds) * 10) / 10 : 0,
      avgStableford: s.rounds > 0 ? Math.round((s.totalStableford / s.rounds) * 10) / 10 : 0,
      wolfRecord: { wins: s.wolfWins, losses: s.wolfLosses, pushes: s.wolfPushes },
    }));

    return c.json({ playerId, holeAverages, rounds: roundSummaries, rivals, chemistry, statEvents, bonusEvents, battingPerformance }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

export default app;
