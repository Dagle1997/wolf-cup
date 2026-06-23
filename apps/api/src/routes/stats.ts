import { Hono } from 'hono';
import { eq, and, isNotNull, count, desc, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { players, rounds, wolfDecisions, holeScores, roundResults, seasons, groups, roundPlayers, sideGameCtpEntries } from '../db/schema.js';
import { resolvePerHoleWinners, PAR3_HOLES as CTP_PAR3_HOLES, type CtpEntry as CtpEntryShape } from '../lib/ctp.js';
import { getCourseHole, calculateSandbaggerStatus, TEE_RATINGS, getWolfAssignment, calcCourseHandicap } from '@wolf-cup/engine';
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

// Season highlights — drives the rotating widget at the top of the stats
// page. Each field is null when there's no data to show that slide
// (e.g. mostSandies stays null until anyone has recorded a sandie).
//
// "Par 3 Champion" on the UI maps to mostGreenies — total greenies all
// season. CTP side game (sideGameCtpEntries) is a separate thing that
// only shows up as a banner on the leaderboard for the week it runs.
type SeasonHighlights = {
  mostBirdies: { playerNames: string[]; count: number } | null;
  mostGreenies: { playerNames: string[]; count: number } | null;
  mostPolies: { playerNames: string[]; count: number } | null;
  mostSandies: { playerNames: string[]; count: number } | null;
  lowestGrossRound: { playerName: string; gross: number; date: string; tee: string | null } | null;
  lowestNetRound: { playerName: string; net: number; gross: number; ch: number; date: string; tee: string | null } | null;
  // Win-rate winner. winRate = wins / (wins + losses); pushes don't penalize.
  bestPartnership: { player1: string; player2: string; winRate: number; wins: number; losses: number; pushes: number; holes: number } | null;
  // Money winner. teamMoney = sum of both pair members' per-hole money on
  // their 2v2 partner holes (combined take-home as a team).
  bestFinancialPartnership: { player1: string; player2: string; teamMoney: number; holes: number } | null;
  // Secret achievement (Seve nickname). Unlocked when the same player(s)
  // top BOTH the Sandman (most sandies) and Putting Master (most polies)
  // leaderboards this season. Honors short-game dominance — sand saves
  // PLUS lights-out putting. Hidden when nobody qualifies.
  wizard: { playerNames: string[] } | null;
};

// ---------------------------------------------------------------------------
// computeSeasonHighlights
// ---------------------------------------------------------------------------
// Builds the SeasonHighlights bundle for the rotating widget on the stats
// top section. Scoped to one season's finalized official rounds. Each
// highlight is null when no data qualifies (e.g. nobody has a sandie yet).

async function computeSeasonHighlights(
  seasonId: number,
  allPlayers: Array<{ id: number; name: string }>,
): Promise<SeasonHighlights> {
  const playerNameById = new Map(allPlayers.map((p) => [p.id, p.name]));
  const seasonRoundFilter = and(
    eq(rounds.seasonId, seasonId),
    eq(rounds.type, 'official'),
    eq(rounds.status, 'finalized'),
  );

  // Hole scores (with round metadata) — drives birdies + lowest gross/net round.
  const holeRows = await db
    .select({
      roundId: holeScores.roundId,
      playerId: holeScores.playerId,
      holeNumber: holeScores.holeNumber,
      grossScore: holeScores.grossScore,
      tee: rounds.tee,
      date: rounds.scheduledDate,
    })
    .from(holeScores)
    .innerJoin(rounds, eq(rounds.id, holeScores.roundId))
    .where(seasonRoundFilter);

  // Wolf decisions — drives polies/sandies + best partnership.
  const wolfRows = await db
    .select({
      roundId: wolfDecisions.roundId,
      groupId: wolfDecisions.groupId,
      holeNumber: wolfDecisions.holeNumber,
      decision: wolfDecisions.decision,
      wolfPlayerId: wolfDecisions.wolfPlayerId,
      partnerPlayerId: wolfDecisions.partnerPlayerId,
      outcome: wolfDecisions.outcome,
      bonusesJson: wolfDecisions.bonusesJson,
    })
    .from(wolfDecisions)
    .innerJoin(rounds, eq(rounds.id, wolfDecisions.roundId))
    .where(seasonRoundFilter);

  // Round players — drives net round (handicap index per round).
  const rpRows = await db
    .select({
      roundId: roundPlayers.roundId,
      groupId: roundPlayers.groupId,
      playerId: roundPlayers.playerId,
      handicapIndex: roundPlayers.handicapIndex,
    })
    .from(roundPlayers)
    .innerJoin(rounds, eq(rounds.id, roundPlayers.roundId))
    .where(seasonRoundFilter);

  // ---- Most birdies / polies / sandies (with ties) ----
  const birdiesByPlayer = new Map<number, number>();
  for (const r of holeRows) {
    const par = getCourseHole(r.holeNumber as Parameters<typeof getCourseHole>[0]).par;
    if (r.grossScore === par - 1) {
      birdiesByPlayer.set(r.playerId, (birdiesByPlayer.get(r.playerId) ?? 0) + 1);
    }
  }

  const greeniesByPlayer = new Map<number, number>();
  const poliesByPlayer = new Map<number, number>();
  const sandiesByPlayer = new Map<number, number>();
  for (const d of wolfRows) {
    if (!d.bonusesJson) continue;
    try {
      const parsed = JSON.parse(d.bonusesJson) as { greenies?: number[]; polies?: number[]; sandies?: number[] };
      for (const pid of parsed.greenies ?? []) {
        greeniesByPlayer.set(pid, (greeniesByPlayer.get(pid) ?? 0) + 1);
      }
      for (const pid of parsed.polies ?? []) {
        poliesByPlayer.set(pid, (poliesByPlayer.get(pid) ?? 0) + 1);
      }
      for (const pid of parsed.sandies ?? []) {
        sandiesByPlayer.set(pid, (sandiesByPlayer.get(pid) ?? 0) + 1);
      }
    } catch {
      // skip malformed JSON
    }
  }

  function topWithTies(map: Map<number, number>): { playerNames: string[]; count: number } | null {
    if (map.size === 0) return null;
    let max = 0;
    for (const v of map.values()) if (v > max) max = v;
    if (max === 0) return null;
    const tied = [...map.entries()]
      .filter(([, v]) => v === max)
      .map(([id]) => playerNameById.get(id) ?? 'Unknown')
      .sort();
    return { playerNames: tied, count: max };
  }

  // ---- Lowest gross / net round (complete 18-hole rounds only) ----
  const grossByRoundPlayer = new Map<string, { roundId: number; playerId: number; gross: number; tee: string | null; date: string; holeCount: number }>();
  for (const r of holeRows) {
    const key = `${r.roundId}-${r.playerId}`;
    const existing = grossByRoundPlayer.get(key);
    if (existing) {
      existing.gross += r.grossScore;
      existing.holeCount += 1;
    } else {
      grossByRoundPlayer.set(key, {
        roundId: r.roundId,
        playerId: r.playerId,
        gross: r.grossScore,
        tee: r.tee,
        date: r.date,
        holeCount: 1,
      });
    }
  }

  const hiByRoundPlayer = new Map<string, number>();
  for (const rp of rpRows) {
    hiByRoundPlayer.set(`${rp.roundId}-${rp.playerId}`, rp.handicapIndex);
  }

  let lowestGrossRound: SeasonHighlights['lowestGrossRound'] = null;
  let lowestNetRound: SeasonHighlights['lowestNetRound'] = null;
  const validTees = new Set<string>(['black', 'blue', 'white']);
  for (const [key, gp] of grossByRoundPlayer) {
    if (gp.holeCount < 18) continue;

    if (lowestGrossRound === null || gp.gross < lowestGrossRound.gross) {
      lowestGrossRound = {
        playerName: playerNameById.get(gp.playerId) ?? 'Unknown',
        gross: gp.gross,
        date: gp.date,
        tee: gp.tee,
      };
    }

    if (gp.tee && validTees.has(gp.tee)) {
      const hi = hiByRoundPlayer.get(key);
      if (hi !== undefined) {
        const ch = calcCourseHandicap(hi, gp.tee as Tee);
        const net = gp.gross - ch;
        if (lowestNetRound === null || net < lowestNetRound.net) {
          lowestNetRound = {
            playerName: playerNameById.get(gp.playerId) ?? 'Unknown',
            net,
            gross: gp.gross,
            ch,
            date: gp.date,
            tee: gp.tee,
          };
        }
      }
    }
  }

  // ---- Best 2v2 Partnership (season) — both win-rate and money flavors.
  //
  // Win rate uses wins / (wins + losses); pushes are excluded from the
  // denominator so they don't penalize a duo that won every decided hole.
  // Money uses sum of both teammates' per-hole money — that's the team's
  // combined take-home across their 2v2 partner holes (bonuses included).
  const partnerDecisions = wolfRows.filter((d) => d.decision === 'partner' && d.wolfPlayerId !== null && d.partnerPlayerId !== null);
  const groupRosters = new Map<string, number[]>();
  for (const rp of rpRows) {
    const key = `${rp.roundId}-${rp.groupId}`;
    const arr = groupRosters.get(key) ?? [];
    arr.push(rp.playerId);
    groupRosters.set(key, arr);
  }

  // Per-hole money breakdown for each round in scope. One query per round
  // (the helper does its own internal queries). At 25 rounds this is fine
  // for an endpoint that's already a heavy aggregator.
  const { computeRoundMoneyBreakdown } = await import('../lib/money-breakdown.js');
  const partnerRoundIds = [...new Set(partnerDecisions.map((d) => d.roundId))];
  const moneyByRound = new Map<number, Awaited<ReturnType<typeof computeRoundMoneyBreakdown>>>();
  for (const rId of partnerRoundIds) {
    moneyByRound.set(rId, await computeRoundMoneyBreakdown(rId));
  }
  const lookupHoleMoney = (roundId: number, groupId: number, holeNumber: number) => {
    const breakdown = moneyByRound.get(roundId);
    if (!breakdown) return null;
    return breakdown.holes.find((h) => h.groupId === groupId && h.holeNumber === holeNumber) ?? null;
  };

  type PairAccumulator = {
    ids: [number, number];
    holes: number;
    wins: number;
    losses: number;
    pushes: number;
    teamMoney: number; // sum of both teammates' per-hole money on these holes
  };
  const pairMap = new Map<string, PairAccumulator>();
  const ensurePair = (a: number, b: number) => {
    const key = [a, b].sort((x, y) => x - y).join('-');
    const existing = pairMap.get(key);
    if (existing) return existing;
    const created: PairAccumulator = {
      ids: [Math.min(a, b), Math.max(a, b)],
      holes: 0, wins: 0, losses: 0, pushes: 0, teamMoney: 0,
    };
    pairMap.set(key, created);
    return created;
  };

  for (const d of partnerDecisions) {
    const wolfId = d.wolfPlayerId!;
    const partnerId = d.partnerPlayerId!;
    const roster = groupRosters.get(`${d.roundId}-${d.groupId}`) ?? [];
    const opponents = roster.filter((pid) => pid !== wolfId && pid !== partnerId);
    const holeMoney = lookupHoleMoney(d.roundId, d.groupId, d.holeNumber);

    // Wolf-team pair (wolf + partner, same team)
    const wolfPair = ensurePair(wolfId, partnerId);
    wolfPair.holes++;
    if (d.outcome === 'win') wolfPair.wins++;
    else if (d.outcome === 'loss') wolfPair.losses++;
    else if (d.outcome === 'push') wolfPair.pushes++;
    if (holeMoney) {
      wolfPair.teamMoney +=
        (holeMoney.perPlayer.get(wolfId)?.total ?? 0) +
        (holeMoney.perPlayer.get(partnerId)?.total ?? 0);
    }

    // Opponent-team pair (the leftover two players, same team vs the wolf duo)
    if (opponents.length === 2) {
      const opp1 = opponents[0]!;
      const opp2 = opponents[1]!;
      const oppPair = ensurePair(opp1, opp2);
      oppPair.holes++;
      // Inverted outcome from opponents' perspective
      if (d.outcome === 'win') oppPair.losses++;
      else if (d.outcome === 'loss') oppPair.wins++;
      else if (d.outcome === 'push') oppPair.pushes++;
      if (holeMoney) {
        oppPair.teamMoney +=
          (holeMoney.perPlayer.get(opp1)?.total ?? 0) +
          (holeMoney.perPlayer.get(opp2)?.total ?? 0);
      }
    }
  }

  // 5-hole minimum gate — keeps small samples out of both flavors.
  const MIN_PARTNERSHIP_HOLES = 5;

  // Best (win-rate) — wins / (wins + losses), pushes excluded from denom.
  let bestPartnership: SeasonHighlights['bestPartnership'] = null;
  const winRateQualified = [...pairMap.values()].filter((p) => {
    if (p.holes < MIN_PARTNERSHIP_HOLES) return false;
    const decided = p.wins + p.losses;
    if (decided === 0) return false; // all pushes — undefined rate, skip
    return p.wins / decided > 0.5;
  });
  if (winRateQualified.length > 0) {
    const best = winRateQualified.reduce((a, b) => {
      const aRate = a.wins / (a.wins + a.losses);
      const bRate = b.wins / (b.wins + b.losses);
      if (Math.abs(aRate - bRate) > 0.001) return bRate > aRate ? b : a;
      return b.holes > a.holes ? b : a;
    });
    bestPartnership = {
      player1: playerNameById.get(best.ids[0]) ?? 'Unknown',
      player2: playerNameById.get(best.ids[1]) ?? 'Unknown',
      holes: best.holes,
      wins: best.wins,
      losses: best.losses,
      pushes: best.pushes,
      winRate: Math.round((best.wins / (best.wins + best.losses)) * 100),
    };
  }

  // Best (money) — pair with the highest combined take-home across their
  // 2v2 partner holes. Negative or zero net doesn't qualify (nobody is
  // proud of breaking even or losing money together).
  let bestFinancialPartnership: SeasonHighlights['bestFinancialPartnership'] = null;
  const moneyQualified = [...pairMap.values()].filter(
    (p) => p.holes >= MIN_PARTNERSHIP_HOLES && p.teamMoney > 0,
  );
  if (moneyQualified.length > 0) {
    const best = moneyQualified.reduce((a, b) => {
      if (a.teamMoney !== b.teamMoney) return b.teamMoney > a.teamMoney ? b : a;
      return b.holes > a.holes ? b : a;
    });
    bestFinancialPartnership = {
      player1: playerNameById.get(best.ids[0]) ?? 'Unknown',
      player2: playerNameById.get(best.ids[1]) ?? 'Unknown',
      teamMoney: best.teamMoney,
      holes: best.holes,
    };
  }

  const mostBirdies = topWithTies(birdiesByPlayer);
  const mostGreenies = topWithTies(greeniesByPlayer);
  const mostPolies = topWithTies(poliesByPlayer);
  const mostSandies = topWithTies(sandiesByPlayer);

  // The Wizard — a player who is on BOTH the Sandman and Putting Master
  // leader lists this season. Intersection of the two leader sets.
  let wizard: SeasonHighlights['wizard'] = null;
  if (mostPolies && mostSandies) {
    const polieSet = new Set(mostPolies.playerNames);
    const both = mostSandies.playerNames.filter((n) => polieSet.has(n));
    if (both.length > 0) wizard = { playerNames: both };
  }

  return {
    mostBirdies,
    mostGreenies,
    mostPolies,
    mostSandies,
    lowestGrossRound,
    lowestNetRound,
    bestPartnership,
    bestFinancialPartnership,
    wizard,
  };
}

// ---------------------------------------------------------------------------
// GET /stats — public, no auth middleware
// ---------------------------------------------------------------------------

app.get('/stats', async (c) => {
  try {
    // Step 1: Active full members only (non-guest). Subs/inactive players do not
    // get a stats page — the roster badge gates it, an incentive to join.
    const allPlayers = await db
      .select({ id: players.id, name: players.name })
      .from(players)
      .where(and(eq(players.status, 'active'), eq(players.isActive, 1), eq(players.isGuest, 0)))
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

    // Find best partnership — wins / (wins + losses) so pushes don't penalize
    // a duo that won every decided hole. 5-hole minimum total volume; pairs
    // whose decided count is 0 (all pushes) are skipped. Matches the
    // seasonHighlights formula.
    const qualifiedPairs = [...pairMap.values()].filter((p) => {
      if (p.holes < 5) return false;
      const decided = p.wins + p.losses;
      if (decided === 0) return false;
      return p.wins / decided > 0.5;
    });
    let bestPartnership: { player1: string; player2: string; holes: number; wins: number; losses: number; pushes: number; winRate: number } | null = null;
    if (qualifiedPairs.length > 0) {
      const best = qualifiedPairs.reduce((a, b) => {
        const aRate = a.wins / (a.wins + a.losses);
        const bRate = b.wins / (b.wins + b.losses);
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
        winRate: Math.round((best.wins / (best.wins + best.losses)) * 100),
      };
    }

    // --- Par 3 Champion (season) stat ---
    // Counts total CTPs won across all finalized CTP rounds in the CURRENT
    // season. "Current" = the season with the max year (see inline comment
    // below). Top 5 with ties shown as co-leaders. Hidden (empty array) when
    // the season has 0 CTPs recorded. Spec AC #18-20.
    //
    // Per-round winners are resolved via the shared resolvePerHoleWinners
    // helper — same source of truth as the leaderboard card, round
    // highlights, and Side Game Champion aggregation.
    let par3Champion: Array<{ playerId: number; name: string; ctps: number; holes: number[] }> = [];
    try {
      // Current season = the season with the max year. Using max(year)
      // rather than "seasonId of most-recent finalized round" ensures that
      // when a new season has been created but no rounds have been
      // finalized yet, we return an empty par3Champion card — NOT the
      // prior season's champion. (The older round-based inference would
      // silently fall back to the prior season.)
      const latestSeason = await db
        .select({ id: seasons.id })
        .from(seasons)
        .orderBy(desc(seasons.year))
        .limit(1)
        .get();
      const currentSeasonId = latestSeason?.id ?? null;

      if (currentSeasonId != null) {
        const ctpRows = await db
          .select({
            id: sideGameCtpEntries.id,
            roundId: sideGameCtpEntries.roundId,
            groupId: sideGameCtpEntries.groupId,
            holeNumber: sideGameCtpEntries.holeNumber,
            winnerPlayerId: sideGameCtpEntries.winnerPlayerId,
            winnerName: sideGameCtpEntries.winnerName,
            holeCompletedAt: sideGameCtpEntries.holeCompletedAt,
            livePlayerName: players.name,
          })
          .from(sideGameCtpEntries)
          .innerJoin(rounds, eq(rounds.id, sideGameCtpEntries.roundId))
          .leftJoin(players, eq(players.id, sideGameCtpEntries.winnerPlayerId))
          .where(and(
            eq(rounds.seasonId, currentSeasonId),
            eq(rounds.status, 'finalized'),
            // Match the rest of /stats — casual rounds are excluded entirely.
            // A casual round should never have CTP scheduled (the endpoint's
            // CTP_NOT_ACTIVE gate handles that), but the filter is defensive
            // against direct-SQL admin overrides and keeps this aggregation
            // consistent with other all-stats semantics.
            eq(rounds.type, 'official'),
          ))
          .orderBy(sideGameCtpEntries.roundId, sideGameCtpEntries.holeNumber, sideGameCtpEntries.groupId);

        // Group by round, resolve per-hole winners, accumulate per-player totals.
        const perRound = new Map<number, CtpEntryShape[]>();
        for (const r of ctpRows) {
          if (!perRound.has(r.roundId)) perRound.set(r.roundId, []);
          perRound.get(r.roundId)!.push({
            id: r.id,
            roundId: r.roundId,
            groupId: r.groupId,
            holeNumber: r.holeNumber,
            winnerPlayerId: r.winnerPlayerId,
            winnerName: r.livePlayerName ?? r.winnerName,
            holeCompletedAt: r.holeCompletedAt,
          });
        }

        const totals = new Map<number, { name: string; ctps: number; holes: number[] }>();
        for (const entries of perRound.values()) {
          const winners = resolvePerHoleWinners(entries);
          for (const hole of CTP_PAR3_HOLES) {
            const w = winners[hole];
            if (!w) continue;
            const existing = totals.get(w.playerId);
            if (existing) {
              existing.ctps++;
              existing.holes.push(hole);
              if (existing.name === 'Unknown' && w.playerName !== 'Unknown') {
                existing.name = w.playerName;
              }
            } else {
              totals.set(w.playerId, { name: w.playerName, ctps: 1, holes: [hole] });
            }
          }
        }

        // Top 5 with ties — include anyone tied with the 5th place score.
        const sorted = [...totals.entries()]
          .map(([playerId, v]) => ({ playerId, name: v.name, ctps: v.ctps, holes: v.holes }))
          .sort((a, b) => b.ctps - a.ctps || a.name.localeCompare(b.name));
        if (sorted.length <= 5) {
          par3Champion = sorted;
        } else {
          const cutoff = sorted[4]!.ctps;
          par3Champion = sorted.filter((r) => r.ctps >= cutoff);
        }
      }
    } catch (err) {
      // Non-fatal — stat card just doesn't render.
      console.error('Failed to compute Par 3 Champion stat (non-fatal):', err);
    }

    // ---- Season Highlights (rotating widget on stats top) ---------------
    // All highlights are scoped to the current (max-year) season's finalized
    // official rounds. Wrapped in try/catch so a single failed query doesn't
    // 500 the whole stats endpoint.
    let seasonHighlights: SeasonHighlights | null = null;
    try {
      const latestSeasonForHighlights = await db
        .select({ id: seasons.id })
        .from(seasons)
        .orderBy(desc(seasons.year))
        .limit(1)
        .get();
      const currentSeasonId = latestSeasonForHighlights?.id ?? null;
      if (currentSeasonId != null) {
        seasonHighlights = await computeSeasonHighlights(currentSeasonId, allPlayers);
      }
    } catch (err) {
      console.error('Failed to compute season highlights (non-fatal):', err);
    }

    return c.json({ players: playerStats, bestPartnership, par3Champion, seasonHighlights, lastUpdated: new Date().toISOString() }, 200);
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

    // Course par for Guyan G&CC = 71 (36 out / 35 in). diffToPar uses net
    // score (gross − slope-aware CH); CH falls back to Math.round(HI) only
    // when the round has no valid tee recorded (legacy / casual data).
    const COURSE_PAR = 71;
    const VALID_TEES = new Set<string>(['black', 'blue', 'white']);
    const roundSummaries = playerRoundRows.map((pr) => {
      const rr = rrMap.get(pr.roundId);
      const gross = grossByRound.get(pr.roundId) ?? 0;
      const ch = pr.tee && VALID_TEES.has(pr.tee)
        ? calcCourseHandicap(pr.handicapIndex, pr.tee as Tee)
        : Math.round(pr.handicapIndex);
      const net = gross > 0 ? gross - ch : 0;
      const diffToPar = gross > 0 ? net - COURSE_PAR : 0;
      return {
        roundId: pr.roundId,
        date: pr.scheduledDate,
        tee: pr.tee,
        handicapIndex: pr.handicapIndex,
        ch,
        gross,
        net,
        diffToPar,
        stableford: rr?.stablefordTotal ?? 0,
        money: rr?.moneyTotal ?? 0,
      };
    });

    // Rivals — per-hole head-to-head + per-round Lucky Charm.
    //
    //   dominate    — my GAINS on opponent holes with X (per-hole). Positive-only.
    //   rival       — my LOSSES on opponent holes with X (per-hole). Stored positive.
    //   luckyCharm  — sum of my NET round money across rounds where X was my
    //                 groupmate. Per-round, not per-hole. Diverges across
    //                 rivals only as the season progresses and group
    //                 compositions rotate. Gated on roundsTogether >= 3 so
    //                 early-season noise is suppressed.
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
      opp_won: number;          // my gains on opponent holes — dominate
      opp_lost: number;         // my losses on opponent holes — rival (positive)
      opp_holesWon: number;     // count of opp holes I gained on
      opp_holesLost: number;    // count of opp holes I lost on
      luckyCharm_netPerRound: number; // sum of my round nets when they were my groupmate
      theirMoney_netPerRound: number; // sum of their round nets when they were my groupmate
    }>();
    const bucket = (rivalId: number) => {
      let b = rivalBuckets.get(rivalId);
      if (!b) {
        b = {
          roundsTogetherSet: new Set(),
          partnerHoles: 0,
          opponentHoles: 0,
          opp_won: 0,
          opp_lost: 0,
          opp_holesWon: 0,
          opp_holesLost: 0,
          luckyCharm_netPerRound: 0,
          theirMoney_netPerRound: 0,
        };
        rivalBuckets.set(rivalId, b);
      }
      return b;
    };

    // Per-round money totals for me + every groupmate across shared rounds
    const allRoundMoneyRows = await db
      .select({
        playerId: roundResults.playerId,
        roundId: roundResults.roundId,
        moneyTotal: roundResults.moneyTotal,
      })
      .from(roundResults)
      .where(inArray(roundResults.roundId, roundIds));
    const myRoundMoneyByRound = new Map<number, number>();
    const roundMoneyByPlayerRound = new Map<string, number>();
    for (const r of allRoundMoneyRows) {
      roundMoneyByPlayerRound.set(`${r.playerId}-${r.roundId}`, r.moneyTotal);
      if (r.playerId === playerId) myRoundMoneyByRound.set(r.roundId, r.moneyTotal);
    }

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

      // Track rounds-together per rival + attribute my round net to each
      // groupmate's luckyCharm bucket (per-round, not per-hole).
      const myRoundNet = myRoundMoneyByRound.get(rId) ?? 0;
      for (const otherId of rosterPlayers) {
        if (otherId === playerId) continue;
        const b = bucket(otherId);
        b.roundsTogetherSet.add(rId);
        b.luckyCharm_netPerRound += myRoundNet;
        b.theirMoney_netPerRound += roundMoneyByPlayerRound.get(`${otherId}-${rId}`) ?? 0;
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
          if (composition.teammates.has(rivalId)) {
            b.partnerHoles += 1;
          } else if (composition.opponents.has(rivalId)) {
            b.opponentHoles += 1;
            b.opp_won += myGain;
            b.opp_lost += myLoss;
            if (myMoney > 0) b.opp_holesWon += 1;
            else if (myMoney < 0) b.opp_holesLost += 1;
          }
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
        dominate: b.opp_won,
        rival: b.opp_lost,
        holesWon: b.opp_holesWon,
        holesLost: b.opp_holesLost,
        luckyCharm: b.luckyCharm_netPerRound,
        myMoney: b.luckyCharm_netPerRound,
        theirMoney: b.theirMoney_netPerRound,
      }))
      .sort((a, b) => b.rival - a.rival);

    // Chemistry: same-team relationships across every wolf-hole decision.
    // "Same team" = any hole where player and X ended up on the same side —
    // 2v2 partner pair, both on the 3-side of a 1v3, or both non-wolf in a
    // blind-wolf hole. Decision-agnostic so it reconciles with rivals.
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
        isNotNull(wolfDecisions.wolfPlayerId),
        inArray(wolfDecisions.decision, ['alone', 'partner', 'blind_wolf']),
      ));

    // Build a map: groupId+roundId → list of player IDs in that group
    const groupPlayersMap = new Map<string, number[]>();
    for (const gm of groupMates) {
      const key = `${gm.roundId}-${gm.groupId}`;
      const arr = groupPlayersMap.get(key) ?? [];
      arr.push(gm.playerId);
      groupPlayersMap.set(key, arr);
    }

    // p2v2* fields track the subset restricted to 2v2 (decision === 'partner')
    // holes only — this is the "Best 2v2 Partnership" record, surfaced inside the
    // broader same-team chemistry so 4-0-1 (2v2) reads as a labeled subset of
    // 5-1-1 (all same-team) instead of looking like a contradiction.
    const chemMap = new Map<number, { name: string; holes: number; wins: number; losses: number; pushes: number; p2v2Holes: number; p2v2Wins: number; p2v2Losses: number; p2v2Pushes: number }>();
    for (const d of decisionRows) {
      if (d.wolfPlayerId === null) continue;
      if (d.decision !== 'alone' && d.decision !== 'partner' && d.decision !== 'blind_wolf') continue;
      const key = `${d.roundId}-${d.groupId}`;
      const groupPlayers = groupPlayersMap.get(key) ?? [];
      if (!groupPlayers.includes(playerId)) continue;

      const composition = getHoleTeamFor(playerId, d.holeNumber, groupPlayers, {
        decision: d.decision,
        wolfPlayerId: d.wolfPlayerId,
        partnerPlayerId: d.partnerPlayerId,
      });
      if (composition.teammates.size === 0) continue;

      // Outcome from player's perspective: wolf-side keeps d.outcome,
      // non-wolf-side inverts. push/null pass through.
      const onWolfSide = d.wolfPlayerId === playerId
        || (d.decision === 'partner' && d.partnerPlayerId === playerId);
      let playerOutcome = d.outcome;
      if (!onWolfSide) {
        if (d.outcome === 'win') playerOutcome = 'loss';
        else if (d.outcome === 'loss') playerOutcome = 'win';
      }

      for (const teammateId of composition.teammates) {
        const entry = chemMap.get(teammateId) ?? {
          name: nameMap.get(teammateId) ?? 'Unknown',
          holes: 0,
          wins: 0,
          losses: 0,
          pushes: 0,
          p2v2Holes: 0,
          p2v2Wins: 0,
          p2v2Losses: 0,
          p2v2Pushes: 0,
        };
        entry.holes++;
        if (playerOutcome === 'win') entry.wins++;
        else if (playerOutcome === 'loss') entry.losses++;
        else if (playerOutcome === 'push') entry.pushes++;
        // 2v2 subset: a 'partner' hole puts exactly two players on each side, so
        // this teammate IS the 2v2 partner for this hole.
        if (d.decision === 'partner') {
          entry.p2v2Holes++;
          if (playerOutcome === 'win') entry.p2v2Wins++;
          else if (playerOutcome === 'loss') entry.p2v2Losses++;
          else if (playerOutcome === 'push') entry.p2v2Pushes++;
        }
        chemMap.set(teammateId, entry);
      }
    }

    const chemistry = [...chemMap.entries()]
      .map(([id, c]) => {
        // Push-agnostic win rate — matches Best 2v2 Partnership math so a
        // 4-0-1 teammate (100%) outranks a 4-0-0 teammate over fewer holes.
        const decided = c.wins + c.losses;
        const p2v2Decided = c.p2v2Wins + c.p2v2Losses;
        return {
          playerId: id,
          name: c.name,
          holes: c.holes,
          wins: c.wins,
          losses: c.losses,
          pushes: c.pushes,
          winRate: decided > 0 ? Math.round((c.wins / decided) * 100) : 0,
          // 2v2-only subset (the "Best 2v2 Partnership" record), or null when the
          // pair has never been 2v2 partners.
          partner2v2: c.p2v2Holes > 0 ? {
            holes: c.p2v2Holes,
            wins: c.p2v2Wins,
            losses: c.p2v2Losses,
            pushes: c.p2v2Pushes,
            winRate: p2v2Decided > 0 ? Math.round((c.p2v2Wins / p2v2Decided) * 100) : 0,
          } : null,
        };
      })
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
