import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { seasons, rounds, players, sideGames, sideGameResults } from '../../db/schema.js';
import { adminAuthMiddleware } from '../../middleware/admin-auth.js';
import {
  createSideGameSchema,
  updateSideGameSchema,
  createSideGameResultSchema,
} from '../../schemas/side-game.js';
import type { Variables } from '../../types.js';

const app = new Hono<{ Variables: Variables }>();

// Helper: parse scheduledRoundIds from JSON string → number[]
function toSideGameResponse(row: typeof sideGames.$inferSelect) {
  return {
    id: row.id,
    seasonId: row.seasonId,
    name: row.name,
    format: row.format,
    scheduledRoundIds: row.scheduledRoundIds
      ? (JSON.parse(row.scheduledRoundIds) as number[])
      : [],
  };
}

// ---------------------------------------------------------------------------
// GET /seasons/:seasonId/side-games — list all side games for a season
// ---------------------------------------------------------------------------

app.get('/seasons/:seasonId/side-games', adminAuthMiddleware, async (c) => {
  const seasonIdParam = c.req.param('seasonId');
  const seasonId = Number(seasonIdParam);
  if (!Number.isInteger(seasonId) || seasonId <= 0) {
    return c.json({ error: 'Invalid season ID', code: 'INVALID_ID' }, 400);
  }

  let season: { id: number } | undefined;
  try {
    season = await db
      .select({ id: seasons.id })
      .from(seasons)
      .where(eq(seasons.id, seasonId))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!season) {
    return c.json({ error: 'Season not found', code: 'NOT_FOUND' }, 404);
  }

  try {
    const allGames = await db
      .select()
      .from(sideGames)
      .where(eq(sideGames.seasonId, seasonId));
    return c.json({ items: allGames.map(toSideGameResponse) }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /seasons/:seasonId/side-games — create a side game
// ---------------------------------------------------------------------------

app.post('/seasons/:seasonId/side-games', adminAuthMiddleware, async (c) => {
  const seasonIdParam = c.req.param('seasonId');
  const seasonId = Number(seasonIdParam);
  if (!Number.isInteger(seasonId) || seasonId <= 0) {
    return c.json({ error: 'Invalid season ID', code: 'INVALID_ID' }, 400);
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

  const result = createSideGameSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues },
      400,
    );
  }

  let season: { id: number } | undefined;
  try {
    season = await db
      .select({ id: seasons.id })
      .from(seasons)
      .where(eq(seasons.id, seasonId))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!season) {
    return c.json({ error: 'Season not found', code: 'NOT_FOUND' }, 404);
  }

  const { name, format, scheduledRoundIds } = result.data;

  try {
    const inserted = await db
      .insert(sideGames)
      .values({
        seasonId,
        name,
        format,
        scheduledRoundIds: scheduledRoundIds ? JSON.stringify(scheduledRoundIds) : null,
        createdAt: Date.now(),
      })
      .returning();

    const game = inserted[0];
    if (!game) {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
    return c.json({ sideGame: toSideGameResponse(game) }, 201);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// PATCH /side-games/:id — update a side game
// ---------------------------------------------------------------------------

app.patch('/side-games/:id', adminAuthMiddleware, async (c) => {
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

  const result = updateSideGameSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues },
      400,
    );
  }

  let existing: { id: number } | undefined;
  try {
    existing = await db
      .select({ id: sideGames.id })
      .from(sideGames)
      .where(eq(sideGames.id, id))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!existing) {
    return c.json({ error: 'Side game not found', code: 'NOT_FOUND' }, 404);
  }

  const updates: Partial<typeof sideGames.$inferInsert> = {};
  if (result.data.name !== undefined) updates.name = result.data.name;
  if (result.data.format !== undefined) updates.format = result.data.format;
  if (result.data.scheduledRoundIds !== undefined)
    updates.scheduledRoundIds = JSON.stringify(result.data.scheduledRoundIds);

  try {
    const updated = await db
      .update(sideGames)
      .set(updates)
      .where(eq(sideGames.id, id))
      .returning();

    const game = updated[0];
    if (!game) {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
    return c.json({ sideGame: toSideGameResponse(game) }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/side-game-results — record a side game result
// ---------------------------------------------------------------------------

app.post('/rounds/:roundId/side-game-results', adminAuthMiddleware, async (c) => {
  const roundIdParam = c.req.param('roundId');
  const roundId = Number(roundIdParam);
  if (!Number.isInteger(roundId) || roundId <= 0) {
    return c.json({ error: 'Invalid round ID', code: 'INVALID_ID' }, 400);
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

  const result = createSideGameResultSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues },
      400,
    );
  }

  // Check round exists
  let round: { id: number } | undefined;
  try {
    round = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!round) {
    return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  }

  // Check side game exists
  let sideGame: { id: number } | undefined;
  try {
    sideGame = await db
      .select({ id: sideGames.id })
      .from(sideGames)
      .where(eq(sideGames.id, result.data.sideGameId))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!sideGame) {
    return c.json({ error: 'Side game not found', code: 'NOT_FOUND' }, 404);
  }

  // If winnerPlayerId provided, check player exists
  if (result.data.winnerPlayerId !== undefined) {
    let player: { id: number } | undefined;
    try {
      player = await db
        .select({ id: players.id })
        .from(players)
        .where(eq(players.id, result.data.winnerPlayerId))
        .get();
    } catch {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
    if (!player) {
      return c.json({ error: 'Player not found', code: 'NOT_FOUND' }, 404);
    }
  }

  const { sideGameId, winnerPlayerId, winnerName, notes } = result.data;

  try {
    const inserted = await db
      .insert(sideGameResults)
      .values({
        sideGameId,
        roundId,
        winnerPlayerId: winnerPlayerId ?? null,
        winnerName: winnerName ?? null,
        notes: notes ?? null,
        createdAt: Date.now(),
      })
      .returning();

    const res = inserted[0];
    if (!res) {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
    return c.json(
      {
        result: {
          id: res.id,
          sideGameId: res.sideGameId,
          roundId: res.roundId,
          winnerPlayerId: res.winnerPlayerId,
          winnerName: res.winnerName,
          notes: res.notes,
        },
      },
      201,
    );
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /rounds/:roundId/side-game-results — list results for a round
// ---------------------------------------------------------------------------

app.get('/rounds/:roundId/side-game-results', adminAuthMiddleware, async (c) => {
  const roundIdParam = c.req.param('roundId');
  const roundId = Number(roundIdParam);
  if (!Number.isInteger(roundId) || roundId <= 0) {
    return c.json({ error: 'Invalid round ID', code: 'INVALID_ID' }, 400);
  }

  let round: { id: number } | undefined;
  try {
    round = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!round) {
    return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  }

  try {
    const allResults = await db
      .select({
        id: sideGameResults.id,
        sideGameId: sideGameResults.sideGameId,
        roundId: sideGameResults.roundId,
        winnerPlayerId: sideGameResults.winnerPlayerId,
        winnerName: sideGameResults.winnerName,
        notes: sideGameResults.notes,
      })
      .from(sideGameResults)
      .where(eq(sideGameResults.roundId, roundId));
    return c.json({ items: allResults }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

export default app;
