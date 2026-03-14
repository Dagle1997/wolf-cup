import { Hono } from 'hono';
import { eq, and, desc, gte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { seasons, seasonWeeks, players, attendance } from '../db/schema.js';
import type { Variables } from '../types.js';

const app = new Hono<{ Variables: Variables }>();

// ---------------------------------------------------------------------------
// GET /attendance — public, current/next week attendance for latest season
// ---------------------------------------------------------------------------

app.get('/attendance', async (c) => {
  try {
    // Find latest season
    const season = await db
      .select()
      .from(seasons)
      .orderBy(desc(seasons.startDate))
      .limit(1)
      .get();

    if (!season) {
      return c.json({ week: null, players: [], confirmed: 0, total: 0 }, 200);
    }

    // Find current or next active Friday
    const today = new Date().toISOString().slice(0, 10);
    let week = await db
      .select()
      .from(seasonWeeks)
      .where(
        and(
          eq(seasonWeeks.seasonId, season.id),
          eq(seasonWeeks.isActive, 1),
          gte(seasonWeeks.friday, today),
        ),
      )
      .orderBy(seasonWeeks.friday)
      .limit(1)
      .get();

    // If no future Friday, show most recent active week
    if (!week) {
      week = await db
        .select()
        .from(seasonWeeks)
        .where(
          and(
            eq(seasonWeeks.seasonId, season.id),
            eq(seasonWeeks.isActive, 1),
          ),
        )
        .orderBy(desc(seasonWeeks.friday))
        .limit(1)
        .get();
    }

    if (!week) {
      return c.json({ week: null, players: [], confirmed: 0, total: 0 }, 200);
    }

    // Compute weekNumber
    const allWeeks = await db
      .select({ id: seasonWeeks.id })
      .from(seasonWeeks)
      .where(eq(seasonWeeks.seasonId, season.id))
      .orderBy(seasonWeeks.friday);
    const weekNumber = allWeeks.findIndex((w) => w.id === week!.id) + 1;

    // Get active roster players (not guests, not deactivated)
    const rosterPlayers = await db
      .select()
      .from(players)
      .where(and(eq(players.isActive, 1), eq(players.isGuest, 0)))
      .orderBy(players.name);

    // Get attendance records for this week
    const attendanceRows = await db
      .select()
      .from(attendance)
      .where(eq(attendance.seasonWeekId, week.id));

    const statusMap = new Map(attendanceRows.map((a) => [a.playerId, a.status]));

    const playerList = rosterPlayers.map((p) => ({
      id: p.id,
      name: p.name,
      handicapIndex: p.handicapIndex,
      status: statusMap.get(p.id) ?? 'unset',
    }));

    const confirmed = playerList.filter((p) => p.status === 'in').length;

    return c.json(
      {
        week: {
          id: week.id,
          friday: week.friday,
          weekNumber,
          tee: week.tee,
        },
        players: playerList,
        confirmed,
        total: playerList.length,
      },
      200,
    );
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

export default app;
