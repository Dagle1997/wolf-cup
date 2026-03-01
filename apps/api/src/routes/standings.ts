import { Hono } from 'hono';
import { eq, and, inArray, not, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { rounds, roundPlayers, players, harveyResults, seasons } from '../db/schema.js';
import { calculateSeasonTotal } from '@wolf-cup/engine';

const app = new Hono();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StandingsPlayer = {
  playerId: number;
  name: string;
  roundsPlayed: number;
  roundsDropped: number;
  stablefordTotal: number;
  moneyTotal: number;
  combinedTotal: number;
  rank: number;
  isPlayoffEligible: boolean;
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
// GET /standings — public, no auth middleware
// ---------------------------------------------------------------------------

app.get('/standings', async (c) => {
  try {
    // Step 1: Find current season (most recent by startDate)
    const season = await db
      .select({ id: seasons.id, name: seasons.name, totalRounds: seasons.totalRounds })
      .from(seasons)
      .orderBy(desc(seasons.startDate))
      .get();

    if (!season) {
      return c.json({ season: null, fullMembers: [], subs: [], lastUpdated: new Date().toISOString() }, 200);
    }

    // Step 2: Official non-cancelled rounds for this season
    const officialRounds = await db
      .select({ id: rounds.id, status: rounds.status })
      .from(rounds)
      .where(
        and(
          eq(rounds.seasonId, season.id),
          eq(rounds.type, 'official'),
          not(eq(rounds.status, 'cancelled')),
        ),
      );

    const officialRoundIds = officialRounds.map((r) => r.id);
    const roundsCompleted = officialRounds.filter((r) => r.status === 'finalized').length;

    if (officialRoundIds.length === 0) {
      return c.json(
        {
          season: { id: season.id, name: season.name, totalRounds: season.totalRounds, roundsCompleted: 0 },
          fullMembers: [],
          subs: [],
          lastUpdated: new Date().toISOString(),
        },
        200,
      );
    }

    // Step 3: All harvey_results for those rounds
    const harveyRows = await db
      .select({
        playerId: harveyResults.playerId,
        roundId: harveyResults.roundId,
        stablefordPoints: harveyResults.stablefordPoints,
        moneyPoints: harveyResults.moneyPoints,
      })
      .from(harveyResults)
      .where(inArray(harveyResults.roundId, officialRoundIds));

    const playerIds = [...new Set(harveyRows.map((r) => r.playerId))];

    if (playerIds.length === 0) {
      return c.json(
        {
          season: { id: season.id, name: season.name, totalRounds: season.totalRounds, roundsCompleted },
          fullMembers: [],
          subs: [],
          lastUpdated: new Date().toISOString(),
        },
        200,
      );
    }

    // Step 4: round_players for sub classification
    const roundPlayerRows = await db
      .select({ playerId: roundPlayers.playerId, isSub: roundPlayers.isSub })
      .from(roundPlayers)
      .where(
        and(
          inArray(roundPlayers.playerId, playerIds),
          inArray(roundPlayers.roundId, officialRoundIds),
        ),
      );

    // Step 5: Player names
    const playerRows = await db
      .select({ id: players.id, name: players.name })
      .from(players)
      .where(inArray(players.id, playerIds));
    const nameMap = new Map(playerRows.map((p) => [p.id, p.name]));

    // Step 6: Build per-player harvey results map
    const harveyByPlayer = new Map<number, Array<{ stablefordPoints: number; moneyPoints: number }>>();
    for (const row of harveyRows) {
      if (!harveyByPlayer.has(row.playerId)) harveyByPlayer.set(row.playerId, []);
      harveyByPlayer.get(row.playerId)!.push({ stablefordPoints: row.stablefordPoints, moneyPoints: row.moneyPoints });
    }

    // Determine sub classification: full member if ANY round_players row has is_sub=0
    const subStatusByPlayer = new Map<number, boolean>();
    for (const pid of playerIds) {
      const entries = roundPlayerRows.filter((r) => r.playerId === pid);
      const hasFullMemberRound = entries.some((r) => !r.isSub);
      subStatusByPlayer.set(pid, !hasFullMemberRound);
    }

    // Step 7: Calculate season totals per player
    const playerStandings = playerIds.map((pid) => {
      const playerRounds = harveyByPlayer.get(pid) ?? [];
      const totals = calculateSeasonTotal(playerRounds, []);
      return {
        playerId: pid,
        name: nameMap.get(pid) ?? 'Unknown',
        roundsPlayed: totals.roundsPlayed,
        roundsDropped: totals.roundsDropped,
        stablefordTotal: totals.stableford,
        moneyTotal: totals.money,
        combinedTotal: totals.stableford + totals.money,
        isSub: subStatusByPlayer.get(pid) ?? true,
      };
    });

    // Step 8: Assign dense ranks and playoff eligibility
    const fullMemberRows = playerStandings.filter((p) => !p.isSub);
    const subRows = playerStandings.filter((p) => p.isSub);

    const fullMemberRanks = assignRanks(fullMemberRows.map((p) => ({ playerId: p.playerId, total: p.combinedTotal })));
    const subRanks = assignRanks(subRows.map((p) => ({ playerId: p.playerId, total: p.combinedTotal })));

    const sortByRankName = (a: StandingsPlayer, b: StandingsPlayer) =>
      a.rank - b.rank || a.name.localeCompare(b.name);

    const fullMembers: StandingsPlayer[] = fullMemberRows
      .map((p) => ({
        playerId: p.playerId,
        name: p.name,
        roundsPlayed: p.roundsPlayed,
        roundsDropped: p.roundsDropped,
        stablefordTotal: p.stablefordTotal,
        moneyTotal: p.moneyTotal,
        combinedTotal: p.combinedTotal,
        rank: fullMemberRanks.get(p.playerId) ?? fullMemberRows.length,
        isPlayoffEligible: (fullMemberRanks.get(p.playerId) ?? 999) <= 8,
      }))
      .sort(sortByRankName);

    const subs: StandingsPlayer[] = subRows
      .map((p) => ({
        playerId: p.playerId,
        name: p.name,
        roundsPlayed: p.roundsPlayed,
        roundsDropped: p.roundsDropped,
        stablefordTotal: p.stablefordTotal,
        moneyTotal: p.moneyTotal,
        combinedTotal: p.combinedTotal,
        rank: subRanks.get(p.playerId) ?? subRows.length,
        isPlayoffEligible: false,
      }))
      .sort(sortByRankName);

    return c.json(
      {
        season: { id: season.id, name: season.name, totalRounds: season.totalRounds, roundsCompleted },
        fullMembers,
        subs,
        lastUpdated: new Date().toISOString(),
      },
      200,
    );
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

export default app;
