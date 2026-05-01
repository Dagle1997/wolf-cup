import { Hono } from 'hono';
import { and, eq, isNull, isNotNull, desc, asc, count, inArray, notInArray, ne, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { seasons, seasonStandings, players, sideGameResults, sideGames, sideGameCtpEntries, rounds } from '../db/schema.js';
import { HISTORICAL_CHAMPIONS, HISTORICAL_STANDINGS, HISTORICAL_ROSTERS, HISTORICAL_CASH, HISTORICAL_IRONMAN, HISTORICAL_CASH_RECORDS } from '../db/history-data.js';
import { computeAllAwards } from '../lib/badges.js';
import { resolvePerHoleWinners, PAR3_HOLES, type CtpEntry } from '../lib/ctp.js';

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

    // 7. Query side game results for Side Game Champion.
    // Skins is a list-display game and explicitly does not feed the Champion
    // track (acceptance criterion #2). The orchestrator + admin-endpoint
    // guards prevent persisted rows in the first place; this filter is a
    // belt-and-suspenders safeguard in case any sideGameResults row for an
    // auto_skins game ever slips through (manual SQL, future migrations,
    // pre-rename historical data, etc.).
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
      .leftJoin(players, eq(sideGameResults.winnerPlayerId, players.id))
      // calculationType is nullable (legacy/manual games); ne() doesn't match
      // NULLs in SQL, so OR with isNull() to include them.
      // Belt-and-suspenders: also exclude by name in case a legacy row has
      // a NULL calc type and migration 0028 hasn't yet promoted it (defensive
      // for boot-order races between code deploys and migration runs).
      .where(
        and(
          or(
            isNull(sideGames.calculationType),
            ne(sideGames.calculationType, 'auto_skins'),
          ),
          notInArray(sideGames.name, ['Skins', 'Most Skins']),
        ),
      );

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
    // CTP-derived side game wins — round-leader-takes-all. Each finalized CTP
    // round contributes exactly 1.0 Side Game Champion credit total, awarded to
    // the player(s) who took the MOST par 3s in that round. Ties split equally
    // (2-way tie = 0.5 each; 4-way tie = 0.25 each).
    //
    // Why this and not "1 credit per unique winner": with the prior rule, a
    // player who took 1 of 4 CTPs got the same credit as the player who swept
    // 3 of 4 — Side Game Champion stopped tracking dominance. The per-par-3
    // recognition still flows through the separate Par 3 Champion track.
    //
    // Per-hole winners come from the same resolvePerHoleWinners helper used at
    // read time, so the counting rule matches the leaderboard display exactly.
    //
    // Gated on rounds.status = 'finalized' — the authoritative finalization
    // signal — rather than sideGameCtpEntries.finalizedAt. Reason: the
    // finalized_at stamp happens via a non-fatal finalize hook, and if that
    // hook ever failed (or for rounds finalized before this feature shipped),
    // we still want historical awards to reflect those CTP wins.
    try {
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
          year: seasons.year,
        })
        .from(sideGameCtpEntries)
        .innerJoin(rounds, eq(sideGameCtpEntries.roundId, rounds.id))
        .innerJoin(seasons, eq(rounds.seasonId, seasons.id))
        .leftJoin(players, eq(sideGameCtpEntries.winnerPlayerId, players.id))
        .where(eq(rounds.status, 'finalized'));

      const perRound = new Map<number, { year: number; entries: CtpEntry[] }>();
      for (const r of ctpRows) {
        if (!perRound.has(r.roundId)) {
          perRound.set(r.roundId, { year: r.year, entries: [] });
        }
        perRound.get(r.roundId)!.entries.push({
          id: r.id,
          roundId: r.roundId,
          groupId: r.groupId,
          holeNumber: r.holeNumber,
          winnerPlayerId: r.winnerPlayerId,
          winnerName: r.livePlayerName ?? r.winnerName,
          holeCompletedAt: r.holeCompletedAt,
        });
      }

      for (const [, { year, entries }] of perRound) {
        const winners = resolvePerHoleWinners(entries);
        // Count par-3 wins per player and remember the best name we've seen
        // for each (a player who won 2 par 3s where one entry had a missing
        // snapshot and the other had a real name should show the real name).
        const winsByPlayer = new Map<number, { count: number; name: string }>();
        for (const hole of PAR3_HOLES) {
          const w = winners[hole];
          if (!w) continue;
          const cur = winsByPlayer.get(w.playerId);
          if (!cur) {
            winsByPlayer.set(w.playerId, { count: 1, name: w.playerName });
          } else {
            cur.count++;
            if (cur.name === 'Unknown' && w.playerName !== 'Unknown') {
              cur.name = w.playerName;
            }
          }
        }
        if (winsByPlayer.size === 0) continue; // round had zero par-3 winners

        // Round-leader-takes-all: only the player(s) tied at the highest hole
        // count get credit, split evenly so each round contributes 1.0 total.
        let maxCount = 0;
        for (const v of winsByPlayer.values()) {
          if (v.count > maxCount) maxCount = v.count;
        }
        if (maxCount === 0) continue;
        const leaders: { playerId: number; name: string }[] = [];
        for (const [playerId, v] of winsByPlayer) {
          if (v.count === maxCount) leaders.push({ playerId, name: v.name });
        }
        const credit = 1 / leaders.length;

        for (const { playerId, name: playerName } of leaders) {
          const key = `${playerId}-${year}`;
          const existing = winCountMap.get(key);
          if (!existing) {
            winCountMap.set(key, { playerName, year, wins: credit });
            continue;
          }
          existing.wins += credit;
          // Upgrade Unknown → real name if a later round has it.
          if (existing.playerName === 'Unknown' && playerName !== 'Unknown') {
            existing.playerName = playerName;
          }
        }
      }
    } catch (err) {
      // Non-fatal — CTP credit is additive; history still renders without it.
      console.error('Failed to compute CTP side-game credits (non-fatal):', err);
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
