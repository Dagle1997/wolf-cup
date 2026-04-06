import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { seasons, seasonWeeks, players, attendance, subBench } from '../../db/schema.js';
import { adminAuthMiddleware } from '../../middleware/admin-auth.js';
import type { Variables } from '../../types.js';

const toggleStatusSchema = z.object({
  status: z.enum(['in', 'out', 'unset']),
});

const addSubSchema = z.object({
  name: z.string().trim().min(1),
  ghinNumber: z.string().optional(),
  handicapIndex: z.number().min(0).max(54).optional(),
  seasonWeekId: z.number().int().positive(),
});

const addSubToWeekSchema = z.object({
  seasonWeekId: z.number().int().positive(),
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

    // Upsert attendance (unset = delete the row to return to default)
    if (result.data.status === 'unset') {
      await db
        .delete(attendance)
        .where(and(eq(attendance.seasonWeekId, seasonWeekId), eq(attendance.playerId, playerId)));
    } else {
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
    }

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

// ---------------------------------------------------------------------------
// GET /seasons/:seasonId/subs — list bench subs for a season
// ---------------------------------------------------------------------------

app.get('/seasons/:seasonId/subs', adminAuthMiddleware, async (c) => {
  const seasonId = Number(c.req.param('seasonId'));
  if (!Number.isInteger(seasonId) || seasonId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  try {
    const season = await db
      .select({ id: seasons.id })
      .from(seasons)
      .where(eq(seasons.id, seasonId))
      .get();

    if (!season) {
      return c.json({ error: 'Season not found', code: 'NOT_FOUND' }, 404);
    }

    const benchEntries = await db
      .select({
        id: subBench.id,
        playerId: subBench.playerId,
        roundCount: subBench.roundCount,
        name: players.name,
        ghinNumber: players.ghinNumber,
        handicapIndex: players.handicapIndex,
      })
      .from(subBench)
      .innerJoin(players, eq(subBench.playerId, players.id))
      .where(eq(subBench.seasonId, seasonId))
      .orderBy(players.name);

    return c.json({ items: benchEntries }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /seasons/:seasonId/subs — add new sub to bench + attendance
// ---------------------------------------------------------------------------

app.post('/seasons/:seasonId/subs', adminAuthMiddleware, async (c) => {
  const seasonId = Number(c.req.param('seasonId'));
  if (!Number.isInteger(seasonId) || seasonId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: [] }, 400);
  }

  const result = addSubSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues }, 400);
  }

  try {
    const now = Date.now();

    // Find existing player by ghinNumber or create new
    let player: { id: number; name: string; ghinNumber: string | null; handicapIndex: number | null } | undefined;

    if (result.data.ghinNumber) {
      player = await db
        .select({ id: players.id, name: players.name, ghinNumber: players.ghinNumber, handicapIndex: players.handicapIndex })
        .from(players)
        .where(eq(players.ghinNumber, result.data.ghinNumber))
        .get();
    }

    if (!player) {
      const [created] = await db
        .insert(players)
        .values({
          name: result.data.name,
          ghinNumber: result.data.ghinNumber ?? null,
          handicapIndex: result.data.handicapIndex ?? null,
          isActive: 1,
          isGuest: 0,
          createdAt: now,
        })
        .returning();
      player = created!;
    } else {
      // Update HI if provided
      if (result.data.handicapIndex !== undefined) {
        await db
          .update(players)
          .set({ handicapIndex: result.data.handicapIndex })
          .where(eq(players.id, player.id));
        player.handicapIndex = result.data.handicapIndex;
      }
    }

    // Upsert sub_bench entry
    await db
      .insert(subBench)
      .values({ seasonId, playerId: player.id, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [subBench.seasonId, subBench.playerId],
        set: { updatedAt: now },
      });

    // Mark as "in" on attendance
    await db
      .insert(attendance)
      .values({ seasonWeekId: result.data.seasonWeekId, playerId: player.id, status: 'in', updatedAt: now })
      .onConflictDoUpdate({
        target: [attendance.seasonWeekId, attendance.playerId],
        set: { status: 'in', updatedAt: now },
      });

    return c.json({ sub: { playerId: player.id, name: player.name, ghinNumber: player.ghinNumber, handicapIndex: player.handicapIndex } }, 201);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /seasons/:seasonId/subs/:subBenchId/add-to-week — add bench sub to week
// ---------------------------------------------------------------------------

app.post('/seasons/:seasonId/subs/:subBenchId/add-to-week', adminAuthMiddleware, async (c) => {
  const seasonId = Number(c.req.param('seasonId'));
  const subBenchId = Number(c.req.param('subBenchId'));
  if (!Number.isInteger(seasonId) || seasonId <= 0 || !Number.isInteger(subBenchId) || subBenchId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: [] }, 400);
  }

  const result = addSubToWeekSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues }, 400);
  }

  try {
    const bench = await db
      .select()
      .from(subBench)
      .where(and(eq(subBench.id, subBenchId), eq(subBench.seasonId, seasonId)))
      .get();

    if (!bench) {
      return c.json({ error: 'Sub not found', code: 'NOT_FOUND' }, 404);
    }

    const now = Date.now();

    // Mark as "in" on attendance
    await db
      .insert(attendance)
      .values({ seasonWeekId: result.data.seasonWeekId, playerId: bench.playerId, status: 'in', updatedAt: now })
      .onConflictDoUpdate({
        target: [attendance.seasonWeekId, attendance.playerId],
        set: { status: 'in', updatedAt: now },
      });

    // Get player info for response
    const player = await db
      .select({ id: players.id, name: players.name, ghinNumber: players.ghinNumber, handicapIndex: players.handicapIndex })
      .from(players)
      .where(eq(players.id, bench.playerId))
      .get();

    return c.json({ sub: player, added: true }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

export default app;
