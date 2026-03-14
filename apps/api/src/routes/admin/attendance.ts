import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { seasonWeeks, players, attendance } from '../../db/schema.js';
import { adminAuthMiddleware } from '../../middleware/admin-auth.js';
import type { Variables } from '../../types.js';

const toggleStatusSchema = z.object({
  status: z.enum(['in', 'out']),
});

const app = new Hono<{ Variables: Variables }>();

// ---------------------------------------------------------------------------
// GET /attendance/:seasonWeekId — admin view of attendance for a specific week
// ---------------------------------------------------------------------------

app.get('/attendance/:seasonWeekId', adminAuthMiddleware, async (c) => {
  const seasonWeekId = Number(c.req.param('seasonWeekId'));
  if (!Number.isInteger(seasonWeekId) || seasonWeekId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  try {
    const week = await db
      .select()
      .from(seasonWeeks)
      .where(eq(seasonWeeks.id, seasonWeekId))
      .get();

    if (!week) {
      return c.json({ error: 'Week not found', code: 'NOT_FOUND' }, 404);
    }

    // Compute weekNumber
    const allWeeks = await db
      .select({ id: seasonWeeks.id })
      .from(seasonWeeks)
      .where(eq(seasonWeeks.seasonId, week.seasonId))
      .orderBy(seasonWeeks.friday);
    const weekNumber = allWeeks.findIndex((w) => w.id === week.id) + 1;

    // Get active roster players
    const rosterPlayers = await db
      .select()
      .from(players)
      .where(and(eq(players.isActive, 1), eq(players.isGuest, 0)))
      .orderBy(players.name);

    // Get attendance records for this week
    const attendanceRows = await db
      .select()
      .from(attendance)
      .where(eq(attendance.seasonWeekId, seasonWeekId));

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

// ---------------------------------------------------------------------------
// PATCH /attendance/:seasonWeekId/players/:playerId — toggle player in/out
// ---------------------------------------------------------------------------

app.patch('/attendance/:seasonWeekId/players/:playerId', adminAuthMiddleware, async (c) => {
  const seasonWeekId = Number(c.req.param('seasonWeekId'));
  const playerId = Number(c.req.param('playerId'));
  if (
    !Number.isInteger(seasonWeekId) || seasonWeekId <= 0 ||
    !Number.isInteger(playerId) || playerId <= 0
  ) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: [] },
      400,
    );
  }

  const result = toggleStatusSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues },
      400,
    );
  }

  try {
    // Verify week exists
    const week = await db
      .select({ id: seasonWeeks.id })
      .from(seasonWeeks)
      .where(eq(seasonWeeks.id, seasonWeekId))
      .get();

    if (!week) {
      return c.json({ error: 'Week not found', code: 'NOT_FOUND' }, 404);
    }

    // Verify player exists
    const player = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.id, playerId))
      .get();

    if (!player) {
      return c.json({ error: 'Player not found', code: 'NOT_FOUND' }, 404);
    }

    // Upsert attendance
    await db
      .insert(attendance)
      .values({
        seasonWeekId,
        playerId,
        status: result.data.status,
        updatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: [attendance.seasonWeekId, attendance.playerId],
        set: { status: result.data.status, updatedAt: Date.now() },
      });

    // Count confirmed for response
    const attendanceRows = await db
      .select()
      .from(attendance)
      .where(eq(attendance.seasonWeekId, seasonWeekId));

    const confirmed = attendanceRows.filter((a) => a.status === 'in').length;

    // Count total roster players
    const rosterPlayers = await db
      .select({ id: players.id })
      .from(players)
      .where(and(eq(players.isActive, 1), eq(players.isGuest, 0)));

    return c.json(
      {
        status: result.data.status,
        confirmed,
        total: rosterPlayers.length,
      },
      200,
    );
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

export default app;
