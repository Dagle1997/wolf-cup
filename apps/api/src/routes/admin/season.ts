import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { seasons } from '../../db/schema.js';
import { adminAuthMiddleware } from '../../middleware/admin-auth.js';
import { createSeasonSchema, updateSeasonSchema } from '../../schemas/season.js';
import type { Variables } from '../../types.js';

const app = new Hono<{ Variables: Variables }>();

// ---------------------------------------------------------------------------
// GET /seasons — list all seasons
// ---------------------------------------------------------------------------

app.get('/seasons', adminAuthMiddleware, async (c) => {
  try {
    const allSeasons = await db.select().from(seasons).orderBy(seasons.id);
    return c.json({ items: allSeasons }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /seasons — create a season
// ---------------------------------------------------------------------------

app.post('/seasons', adminAuthMiddleware, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: [] },
      400,
    );
  }

  const result = createSeasonSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues },
      400,
    );
  }

  try {
    const inserted = await db
      .insert(seasons)
      .values({ ...result.data, createdAt: Date.now() })
      .returning();

    const season = inserted[0];
    if (!season) {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
    return c.json({ season }, 201);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// PATCH /seasons/:id — update a season
// ---------------------------------------------------------------------------

app.patch('/seasons/:id', adminAuthMiddleware, async (c) => {
  const idParam = c.req.param('id');
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
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

  const result = updateSeasonSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues },
      400,
    );
  }

  let existing: { id: number } | undefined;
  try {
    existing = await db
      .select({ id: seasons.id })
      .from(seasons)
      .where(eq(seasons.id, id))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (!existing) {
    return c.json({ error: 'Season not found', code: 'NOT_FOUND' }, 404);
  }

  const updates: Partial<typeof seasons.$inferInsert> = {};
  if (result.data.name !== undefined) updates.name = result.data.name;
  if (result.data.startDate !== undefined) updates.startDate = result.data.startDate;
  if (result.data.endDate !== undefined) updates.endDate = result.data.endDate;
  if (result.data.totalRounds !== undefined) updates.totalRounds = result.data.totalRounds;
  if (result.data.playoffFormat !== undefined) updates.playoffFormat = result.data.playoffFormat;
  if (result.data.harveyLiveEnabled !== undefined) updates.harveyLiveEnabled = result.data.harveyLiveEnabled ? 1 : 0;

  try {
    const updated = await db
      .update(seasons)
      .set(updates)
      .where(eq(seasons.id, id))
      .returning();

    const season = updated[0];
    if (!season) {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
    return c.json({ season }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

export default app;
