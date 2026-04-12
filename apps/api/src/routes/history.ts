import { Hono } from 'hono';
import { eq, isNotNull, desc, asc, count, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { seasons, seasonStandings, players, sideGameResults, sideGames, rounds } from '../db/schema.js';
import { HISTORICAL_CHAMPIONS, HISTORICAL_STANDINGS, HISTORICAL_ROSTERS, HISTORICAL_CASH, HISTORICAL_IRONMAN, HISTORICAL_CASH_RECORDS } from '../db/history-data.js';
import { computeAllAwards } from '../lib/badges.js';

const app = new Hono();

// ---------------------------------------------------------------------------
// GET /history — public, no auth
// ---------------------------------------------------------------------------

app.get('/history', async (c) => {
  try {
    // 1. All seasons ordered by year DESC
    const allSeasons = await db
      .select()
      .from(seasons)
      .orderBy(desc(seasons.year));

    // 2. Championship win counts per player
    const champCountRows = await db
      .select({
        playerId: seasons.championPlayerId,
        wins: count(),
      })
      .from(seasons)
      .where(isNotNull(seasons.championPlayerId))
      .groupBy(seasons.championPlayerId);

    const champCountMap = new Map<number, number>();
    for (const row of champCountRows) {
      if (row.playerId != null) {
        champCountMap.set(row.playerId, row.wins);
      }
    }

    // 3. All standings with player names
    const allStandingsRows = await db
      .select({
        seasonId: seasonStandings.seasonId,
        playerId: seasonStandings.playerId,
        name: players.name,
        rank: seasonStandings.rank,
        points: seasonStandings.points,
      })
      .from(seasonStandings)
      .innerJoin(players, eq(seasonStandings.playerId, players.id))
      .orderBy(asc(seasonStandings.rank));

    // Group standings by seasonId
    const standingsBySeason = new Map<number, { playerId: number; name: string; rank: number; points: number | null }[]>();
    for (const row of allStandingsRows) {
      let arr = standingsBySeason.get(row.seasonId);
      if (!arr) {
        arr = [];
        standingsBySeason.set(row.seasonId, arr);
      }
      arr.push({ playerId: row.playerId, name: row.name, rank: row.rank, points: row.points });
    }

    // 4. Get champion player names (single query)
    const championPlayerIds = allSeasons
      .map((s) => s.championPlayerId)
      .filter((id): id is number => id != null);
    const uniqueChampIds = [...new Set(championPlayerIds)];
    const champPlayers = new Map<number, string>();
    if (uniqueChampIds.length > 0) {
      const champRows = await db
        .select({ id: players.id, name: players.name })
        .from(players)
        .where(inArray(players.id, uniqueChampIds));
      for (const row of champRows) {
        champPlayers.set(row.id, row.name);
      }
    }

    // 5. Build response
    const seasonResults = allSeasons.map((s) => {
      const champion = s.championPlayerId != null
        ? {
            playerId: s.championPlayerId,
            name: champPlayers.get(s.championPlayerId) ?? 'Unknown',
            wins: champCountMap.get(s.championPlayerId) ?? 0,
          }
        : null;

      return {
        id: s.id,
        name: s.name,
        year: s.year,
        champion,
        standings: standingsBySeason.get(s.id) ?? [],
      };
    });

    // 6. Championship counts top-level
    const championshipCounts = uniqueChampIds.map((pid) => ({
      playerId: pid,
      name: champPlayers.get(pid) ?? 'Unknown',
      wins: champCountMap.get(pid) ?? 0,
    }));
    championshipCounts.sort((a, b) => b.wins - a.wins);

    // 7. Query side game results for Side Game Champion
    const sideGameResultRows = await db
      .select({
        winnerPlayerId: sideGameResults.winnerPlayerId,
        winnerName: sideGameResults.winnerName,
        playerName: players.name,
        year: seasons.year,
        gameName: sideGames.name,
        roundDate: rounds.scheduledDate,
        notes: sideGameResults.notes,
        source: sideGameResults.source,
      })
      .from(sideGameResults)
      .innerJoin(sideGames, eq(sideGameResults.sideGameId, sideGames.id))
      .innerJoin(rounds, eq(sideGameResults.roundId, rounds.id))
      .innerJoin(seasons, eq(rounds.seasonId, seasons.id))
      .leftJoin(players, eq(sideGameResults.winnerPlayerId, players.id));

    // Aggregate wins per player per season (only roster players)
    const winCountMap = new Map<string, { playerName: string; year: number; wins: number }>();
    for (const r of sideGameResultRows) {
      if (r.winnerPlayerId === null) continue;
      const key = `${r.winnerPlayerId}-${r.year}`;
      const name = r.playerName ?? 'Unknown';
      if (!winCountMap.has(key)) {
        winCountMap.set(key, { playerName: name, year: r.year, wins: 0 });
      }
      winCountMap.get(key)!.wins++;
    }
    const sideGameWins = [...winCountMap.values()];

    // Build per-season side game results for frontend
    const sideGameResultsBySeason = new Map<number, Array<{
      gameName: string;
      winnerDisplayName: string;
      winnerPlayerId: number | null;
      roundDate: string;
      notes: string | null;
      source: string | null;
    }>>();
    for (const r of sideGameResultRows) {
      if (!sideGameResultsBySeason.has(r.year)) sideGameResultsBySeason.set(r.year, []);
      sideGameResultsBySeason.get(r.year)!.push({
        gameName: r.gameName,
        winnerDisplayName: r.playerName ?? r.winnerName ?? 'Unknown',
        winnerPlayerId: r.winnerPlayerId,
        roundDate: r.roundDate,
        notes: r.notes,
        source: r.source,
      });
    }

    // Add sideGameResults to each season
    const seasonsWithSideGames = seasonResults.map((sr) => ({
      ...sr,
      sideGameResults: sideGameResultsBySeason.get(sr.year) ?? [],
    }));

    // 8. Compute awards from historical data + side game wins
    const awards = computeAllAwards(
      HISTORICAL_CHAMPIONS, HISTORICAL_STANDINGS, HISTORICAL_ROSTERS,
      HISTORICAL_CASH, HISTORICAL_IRONMAN, HISTORICAL_CASH_RECORDS,
      sideGameWins,
    );

    return c.json({ seasons: seasonsWithSideGames, championshipCounts, awards }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

export default app;
