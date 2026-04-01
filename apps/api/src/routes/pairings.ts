import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { rounds, groups, roundPlayers, players, pairingHistory, seasons } from '../db/schema.js';
import { calcCourseHandicap } from '@wolf-cup/engine';
import type { Tee } from '@wolf-cup/engine';
import type { Variables } from '../types.js';

const app = new Hono<{ Variables: Variables }>();

// ---------------------------------------------------------------------------
// GET /pairings/:roundId — public pairings with course handicaps
// ---------------------------------------------------------------------------

app.get('/pairings/:roundId', async (c) => {
  const roundId = Number(c.req.param('roundId'));
  if (!Number.isInteger(roundId) || roundId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  try {
    const round = await db
      .select()
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .get();

    if (!round) {
      return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
    }

    const roundGroups = await db
      .select()
      .from(groups)
      .where(eq(groups.roundId, roundId))
      .orderBy(groups.groupNumber);

    const roundPlayerRows = await db
      .select({
        playerId: roundPlayers.playerId,
        groupId: roundPlayers.groupId,
        handicapIndex: roundPlayers.handicapIndex,
        isSub: roundPlayers.isSub,
        name: players.name,
      })
      .from(roundPlayers)
      .innerJoin(players, eq(roundPlayers.playerId, players.id))
      .where(eq(roundPlayers.roundId, roundId));

    const tee = (round.tee as Tee) ?? 'blue';

    const groupsResponse = roundGroups.map((g) => {
      const groupPlayers = roundPlayerRows
        .filter((rp) => rp.groupId === g.id)
        .map((rp) => ({
          id: rp.playerId,
          name: rp.name,
          handicapIndex: rp.handicapIndex,
          courseHandicap: calcCourseHandicap(rp.handicapIndex, tee),
          isSub: rp.isSub === 1,
        }));

      return {
        groupNumber: g.groupNumber,
        players: groupPlayers,
      };
    });

    return c.json(
      {
        round: {
          id: round.id,
          scheduledDate: round.scheduledDate,
          tee: round.tee,
          status: round.status,
          handicapUpdatedAt: round.handicapUpdatedAt,
        },
        groups: groupsResponse,
      },
      200,
    );
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /pairings/history — public pairing history for current season
// ---------------------------------------------------------------------------

app.get('/pairings/history', async (c) => {
  try {
    // Find the most recent season
    const season = await db
      .select({ id: seasons.id, name: seasons.name, year: seasons.year })
      .from(seasons)
      .orderBy(desc(seasons.year))
      .limit(1)
      .get();

    if (!season) {
      return c.json({ season: null, pairs: [] }, 200);
    }

    // Get all pairing history for this season
    const rows = await db
      .select({
        playerAId: pairingHistory.playerAId,
        playerBId: pairingHistory.playerBId,
        pairCount: pairingHistory.pairCount,
      })
      .from(pairingHistory)
      .where(eq(pairingHistory.seasonId, season.id));

    // Collect player names
    const playerRows = await db
      .select({ id: players.id, name: players.name })
      .from(players);
    const nameMap = new Map<number, string>();
    for (const p of playerRows) nameMap.set(p.id, p.name);

    const pairs = rows.map((r) => ({
      playerAId: r.playerAId,
      playerAName: nameMap.get(r.playerAId) ?? 'Unknown',
      playerBId: r.playerBId,
      playerBName: nameMap.get(r.playerBId) ?? 'Unknown',
      count: r.pairCount,
    }));

    return c.json({
      season: { id: season.id, name: season.name, year: season.year },
      pairs,
    }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

export default app;
