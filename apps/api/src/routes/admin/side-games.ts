import { Hono } from 'hono';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { seasons, rounds, players, sideGames, sideGameResults, seasonWeeks } from '../../db/schema.js';
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
    calculationType: row.calculationType ?? null,
    scheduledRoundIds: row.scheduledRoundIds
      ? (JSON.parse(row.scheduledRoundIds) as number[])
      : [],
    scheduledFridays: row.scheduledFridays
      ? (JSON.parse(row.scheduledFridays) as string[])
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

  // Check side game exists and is scheduled for this round
  let sideGame: { id: number; scheduledRoundIds: string | null } | undefined;
  try {
    sideGame = await db
      .select({ id: sideGames.id, scheduledRoundIds: sideGames.scheduledRoundIds })
      .from(sideGames)
      .where(eq(sideGames.id, result.data.sideGameId))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!sideGame) {
    return c.json({ error: 'Side game not found', code: 'NOT_FOUND' }, 404);
  }

  // Validate side game is scheduled for this round
  try {
    const scheduledIds = JSON.parse(sideGame.scheduledRoundIds ?? '[]') as number[];
    if (!scheduledIds.includes(roundId)) {
      return c.json(
        { error: 'Side game is not scheduled for this round', code: 'VALIDATION_ERROR' },
        422,
      );
    }
  } catch {
    return c.json(
      { error: 'Side game is not scheduled for this round', code: 'VALIDATION_ERROR' },
      422,
    );
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
        source: 'manual',
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
        playerName: players.name,
        gameName: sideGames.name,
        gameCalcType: sideGames.calculationType,
        notes: sideGameResults.notes,
        source: sideGameResults.source,
      })
      .from(sideGameResults)
      .innerJoin(sideGames, eq(sideGameResults.sideGameId, sideGames.id))
      .leftJoin(players, eq(sideGameResults.winnerPlayerId, players.id))
      .where(eq(sideGameResults.roundId, roundId));
    return c.json({
      items: allResults.map((r) => ({
        ...r,
        displayName: r.playerName ?? r.winnerName ?? 'Unknown',
      })),
    }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /rounds/:roundId/side-game-results/:resultId — delete a result
// ---------------------------------------------------------------------------

app.delete('/rounds/:roundId/side-game-results/:resultId', adminAuthMiddleware, async (c) => {
  const roundId = Number(c.req.param('roundId'));
  const resultId = Number(c.req.param('resultId'));
  if (!Number.isInteger(roundId) || roundId <= 0 || !Number.isInteger(resultId) || resultId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  try {
    const existing = await db
      .select({ id: sideGameResults.id, roundId: sideGameResults.roundId })
      .from(sideGameResults)
      .where(eq(sideGameResults.id, resultId))
      .get();

    if (!existing || existing.roundId !== roundId) {
      return c.json({ error: 'Result not found', code: 'NOT_FOUND' }, 404);
    }

    await db.delete(sideGameResults).where(eq(sideGameResults.id, resultId));
    return c.json({ success: true }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /seasons/:seasonId/side-games/initialize — auto-create 6-game rotation
// ---------------------------------------------------------------------------

const SIDE_GAME_DEFINITIONS = [
  { name: 'Most Net Pars', format: 'Most holes at net par', calculationType: 'auto_net_pars' },
  { name: 'Closest to Pin', format: 'Closest tee shot on par 3s', calculationType: 'manual' },
  { name: 'Most Skins', format: 'Lowest unique net score on any hole — all players, all 18 holes', calculationType: 'auto_skins' },
  { name: 'Least Putts', format: 'Fewest total putts', calculationType: 'auto_putts' },
  { name: 'Most Net Under Par', format: 'Most holes under net par', calculationType: 'auto_net_under_par' },
  { name: 'Most Polies', format: 'Most polies in the round', calculationType: 'auto_polies' },
] as const;

app.post('/seasons/:seasonId/side-games/initialize', adminAuthMiddleware, async (c) => {
  const seasonId = Number(c.req.param('seasonId'));
  if (!Number.isInteger(seasonId) || seasonId <= 0) {
    return c.json({ error: 'Invalid season ID', code: 'INVALID_ID' }, 400);
  }

  // Check season exists
  const season = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(eq(seasons.id, seasonId))
    .get();
  if (!season) {
    return c.json({ error: 'Season not found', code: 'NOT_FOUND' }, 404);
  }

  // Rotation is anchored to active Fridays (season_weeks). Rounds are created
  // week-by-week from attendance and back-filled into scheduledRoundIds later.
  const activeWeeks = await db
    .select({ friday: seasonWeeks.friday })
    .from(seasonWeeks)
    .where(and(eq(seasonWeeks.seasonId, seasonId), eq(seasonWeeks.isActive, 1)))
    .orderBy(seasonWeeks.friday);

  if (activeWeeks.length === 0) {
    return c.json({ error: 'No active weeks found for this season', code: 'NO_WEEKS' }, 422);
  }

  // Resolve any already-existing official rounds to seed scheduledRoundIds
  const existingRounds = await db
    .select({ id: rounds.id, scheduledDate: rounds.scheduledDate })
    .from(rounds)
    .where(
      and(
        eq(rounds.seasonId, seasonId),
        eq(rounds.type, 'official'),
        sql`${rounds.status} != 'cancelled'`,
      ),
    );
  const dateToRoundId = new Map(existingRounds.map((r) => [r.scheduledDate, r.id]));

  // Atomic check-and-insert inside a transaction to prevent TOCTOU race
  try {
    const createdGames = await db.transaction(async (tx) => {
      // Guard against double-initialization
      const existing = await tx
        .select({ id: sideGames.id })
        .from(sideGames)
        .where(eq(sideGames.seasonId, seasonId));
      if (existing.length > 0) {
        throw new Error('ALREADY_EXISTS');
      }

      const now = Date.now();
      const games = [];

      for (let gameIdx = 0; gameIdx < SIDE_GAME_DEFINITIONS.length; gameIdx++) {
        const def = SIDE_GAME_DEFINITIONS[gameIdx]!;
        const assignedFridays = activeWeeks
          .filter((_, weekIdx) => weekIdx % 6 === gameIdx)
          .map((w) => w.friday);
        const assignedRoundIds = assignedFridays
          .map((f) => dateToRoundId.get(f))
          .filter((id): id is number => typeof id === 'number');

        const [inserted] = await tx
          .insert(sideGames)
          .values({
            seasonId,
            name: def.name,
            format: def.format,
            calculationType: def.calculationType,
            scheduledFridays: JSON.stringify(assignedFridays),
            scheduledRoundIds: JSON.stringify(assignedRoundIds),
            createdAt: now,
          })
          .returning();

        if (inserted) games.push(toSideGameResponse(inserted));
      }

      return games;
    });

    return c.json({ items: createdGames }, 201);
  } catch (err) {
    if (err instanceof Error && err.message === 'ALREADY_EXISTS') {
      return c.json({ error: 'Side games already initialized for this season', code: 'ALREADY_EXISTS' }, 409);
    }
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

export default app;
