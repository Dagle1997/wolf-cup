import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { seasons, seasonStandings, players } from '../../db/schema.js';
import { adminAuthMiddleware } from '../../middleware/admin-auth.js';
import {
  createHistoricalSeasonSchema,
  setChampionSchema,
  upsertStandingsSchema,
} from '../../schemas/history.js';
import type { Variables } from '../../types.js';

const app = new Hono<{ Variables: Variables }>();

// ---------------------------------------------------------------------------
// POST / — create a historical season
// ---------------------------------------------------------------------------

app.post('/', adminAuthMiddleware, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: [] },
      400,
    );
  }

  const result = createHistoricalSeasonSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues },
      400,
    );
  }

  try {
    const now = Date.now();
    const inserted = await db
      .insert(seasons)
      .values({
        name: result.data.name,
        year: result.data.year,
        startDate: result.data.startDate,
        endDate: result.data.endDate,
        totalRounds: result.data.totalRounds,
        playoffFormat: result.data.playoffFormat,
        harveyLiveEnabled: 0,
        championPlayerId: result.data.championPlayerId ?? null,
        createdAt: now,
      })
      .returning();

    const season = inserted[0];
    if (!season) throw new Error('Insert failed');

    return c.json({ id: season.id, name: season.name }, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Season with this year already exists', code: 'CONFLICT' }, 409);
    }
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// PATCH /:seasonId/champion — set champion for a season
// ---------------------------------------------------------------------------

app.patch('/:seasonId/champion', adminAuthMiddleware, async (c) => {
  const seasonId = Number(c.req.param('seasonId'));
  if (!Number.isInteger(seasonId) || seasonId <= 0) {
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

  const result = setChampionSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues },
      400,
    );
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

    if (result.data.championPlayerId !== null) {
      const player = await db
        .select({ id: players.id })
        .from(players)
        .where(eq(players.id, result.data.championPlayerId))
        .get();

      if (!player) {
        return c.json({ error: 'Player not found', code: 'NOT_FOUND' }, 404);
      }
    }

    await db
      .update(seasons)
      .set({ championPlayerId: result.data.championPlayerId })
      .where(eq(seasons.id, seasonId));

    return c.json({ success: true }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// PUT /:seasonId/standings — upsert standings for a season
// ---------------------------------------------------------------------------

app.put('/:seasonId/standings', adminAuthMiddleware, async (c) => {
  const seasonId = Number(c.req.param('seasonId'));
  if (!Number.isInteger(seasonId) || seasonId <= 0) {
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

  const result = upsertStandingsSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues },
      400,
    );
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

    const now = Date.now();
    for (const entry of result.data.standings) {
      await db
        .insert(seasonStandings)
        .values({
          seasonId,
          playerId: entry.playerId,
          rank: entry.rank,
          points: entry.points ?? null,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [seasonStandings.seasonId, seasonStandings.playerId],
          set: { rank: entry.rank, points: entry.points ?? null },
        });
    }

    return c.json({ success: true, count: result.data.standings.length }, 200);
  } catch (err) {
    if (err instanceof Error && err.message.includes('FOREIGN KEY constraint failed')) {
      return c.json({ error: 'One or more playerIds do not exist', code: 'VALIDATION_ERROR' }, 400);
    }
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

export default app;
