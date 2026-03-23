import { Hono } from 'hono';
import { eq, and, isNotNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { players, roundPlayers, rounds } from '../../db/schema.js';
import { adminAuthMiddleware } from '../../middleware/admin-auth.js';
import { createPlayerSchema, updatePlayerSchema } from '../../schemas/player.js';
import { updateHandicapSchema } from '../../schemas/handicap.js';
import { updateSubStatusSchema } from '../../schemas/sub.js';
import { ghinClient } from '../../lib/ghin-client.js';
import type { Variables } from '../../types.js';

const app = new Hono<{ Variables: Variables }>();

// ---------------------------------------------------------------------------
// GET /players — list all players (active and inactive)
// ---------------------------------------------------------------------------

app.get('/players', adminAuthMiddleware, async (c) => {
  try {
    const allPlayers = await db
      .select()
      .from(players)
      .orderBy(players.id);
    return c.json({ items: allPlayers }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /players/refresh-handicaps — bulk-refresh HI for all GHIN players
// ---------------------------------------------------------------------------

app.post('/players/refresh-handicaps', adminAuthMiddleware, async (c) => {
  if (!ghinClient) {
    return c.json({ error: 'GHIN credentials not configured', code: 'GHIN_NOT_CONFIGURED' }, 503);
  }

  let roster: { id: number; ghinNumber: string | null }[];
  try {
    roster = await db
      .select({ id: players.id, ghinNumber: players.ghinNumber })
      .from(players)
      .where(and(eq(players.isActive, 1), isNotNull(players.ghinNumber)));
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  let updated = 0;
  let failed = 0;

  for (const player of roster) {
    try {
      const { handicapIndex } = await ghinClient.getHandicap(Number(player.ghinNumber));
      await db.update(players).set({ handicapIndex }).where(eq(players.id, player.id));
      updated++;
    } catch {
      failed++;
    }
  }

  return c.json({ updated, failed, total: roster.length }, 200);
});

// ---------------------------------------------------------------------------
// POST /players — create a player
// ---------------------------------------------------------------------------

app.post('/players', adminAuthMiddleware, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: [] },
      400,
    );
  }

  const result = createPlayerSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      {
        error: 'Validation error',
        code: 'VALIDATION_ERROR',
        issues: result.error.issues,
      },
      400,
    );
  }

  const { name, ghinNumber } = result.data;

  try {
    const inserted = await db
      .insert(players)
      .values({
        name,
        ghinNumber: ghinNumber ?? null,
        createdAt: Date.now(),
      })
      .returning();

    const player = inserted[0];
    if (!player) {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
    return c.json({ player }, 201);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// PATCH /players/:id — update a player (soft-delete via isActive: 0)
// ---------------------------------------------------------------------------

app.patch('/players/:id', adminAuthMiddleware, async (c) => {
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

  const result = updatePlayerSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      {
        error: 'Validation error',
        code: 'VALIDATION_ERROR',
        issues: result.error.issues,
      },
      400,
    );
  }

  // Check player exists
  let existing: { id: number } | undefined;
  try {
    existing = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.id, id))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (!existing) {
    return c.json({ error: 'Player not found', code: 'NOT_FOUND' }, 404);
  }

  // Build update from provided fields only
  const updates: Partial<typeof players.$inferInsert> = {};
  if (result.data.name !== undefined) updates.name = result.data.name;
  if (result.data.ghinNumber !== undefined) updates.ghinNumber = result.data.ghinNumber;
  if (result.data.handicapIndex !== undefined) updates.handicapIndex = result.data.handicapIndex;

  // status takes precedence; keep isActive in sync
  if (result.data.status !== undefined) {
    updates.status = result.data.status;
    updates.isActive = result.data.status === 'inactive' ? 0 : 1;
  } else if (result.data.isActive !== undefined) {
    // Legacy isActive support — map to status
    updates.isActive = result.data.isActive;
    updates.status = result.data.isActive === 1 ? 'active' : 'inactive';
  }

  try {
    const updated = await db
      .update(players)
      .set(updates)
      .where(eq(players.id, id))
      .returning();

    const player = updated[0];
    if (!player) {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
    return c.json({ player }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /players/:id — hard-delete a player (only if no round history)
// ---------------------------------------------------------------------------

app.delete('/players/:id', adminAuthMiddleware, async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  let existing: { id: number } | undefined;
  try {
    existing = await db.select({ id: players.id }).from(players).where(eq(players.id, id)).get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!existing) return c.json({ error: 'Player not found', code: 'NOT_FOUND' }, 404);

  // Block deletion if player has round history (preserves data integrity)
  let roundEntry: { id: number } | undefined;
  try {
    roundEntry = await db
      .select({ id: roundPlayers.id })
      .from(roundPlayers)
      .where(eq(roundPlayers.playerId, id))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (roundEntry) {
    return c.json(
      { error: 'Player has round history — deactivate instead', code: 'HAS_ROUND_HISTORY' },
      409,
    );
  }

  try {
    await db.delete(players).where(eq(players.id, id));
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  return c.json({ success: true }, 200);
});

// ---------------------------------------------------------------------------
// PATCH /rounds/:roundId/players/:playerId/handicap — update handicap index
// ---------------------------------------------------------------------------

app.patch(
  '/rounds/:roundId/players/:playerId/handicap',
  adminAuthMiddleware,
  async (c) => {
    const roundIdParam = c.req.param('roundId');
    const playerIdParam = c.req.param('playerId');
    const roundId = Number(roundIdParam);
    const playerId = Number(playerIdParam);

    if (!Number.isInteger(roundId) || roundId <= 0) {
      return c.json({ error: 'Invalid round ID', code: 'INVALID_ID' }, 400);
    }
    if (!Number.isInteger(playerId) || playerId <= 0) {
      return c.json({ error: 'Invalid player ID', code: 'INVALID_ID' }, 400);
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

    const result = updateHandicapSchema.safeParse(body);
    if (!result.success) {
      return c.json(
        {
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          issues: result.error.issues,
        },
        400,
      );
    }

    const { handicapIndex } = result.data;

    // Check round_players row exists
    let roundPlayer:
      | { id: number; roundId: number; playerId: number }
      | undefined;
    try {
      roundPlayer = await db
        .select({
          id: roundPlayers.id,
          roundId: roundPlayers.roundId,
          playerId: roundPlayers.playerId,
        })
        .from(roundPlayers)
        .where(
          and(
            eq(roundPlayers.roundId, roundId),
            eq(roundPlayers.playerId, playerId),
          ),
        )
        .get();
    } catch {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }

    if (!roundPlayer) {
      return c.json(
        { error: 'Player not in round', code: 'NOT_FOUND' },
        404,
      );
    }

    try {
      await db
        .update(roundPlayers)
        .set({ handicapIndex })
        .where(
          and(
            eq(roundPlayers.roundId, roundId),
            eq(roundPlayers.playerId, playerId),
          ),
        );
    } catch {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }

    return c.json({ roundPlayer: { roundId, playerId, handicapIndex } }, 200);
  },
);

// ---------------------------------------------------------------------------
// PATCH /rounds/:roundId/players/:playerId/sub — mark/unmark as sub (FR50, FR51)
// ---------------------------------------------------------------------------

app.patch(
  '/rounds/:roundId/players/:playerId/sub',
  adminAuthMiddleware,
  async (c) => {
    const roundIdParam = c.req.param('roundId');
    const playerIdParam = c.req.param('playerId');
    const roundId = Number(roundIdParam);
    const playerId = Number(playerIdParam);

    if (!Number.isInteger(roundId) || roundId <= 0) {
      return c.json({ error: 'Invalid round ID', code: 'INVALID_ID' }, 400);
    }
    if (!Number.isInteger(playerId) || playerId <= 0) {
      return c.json({ error: 'Invalid player ID', code: 'INVALID_ID' }, 400);
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

    const result = updateSubStatusSchema.safeParse(body);
    if (!result.success) {
      return c.json(
        {
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          issues: result.error.issues,
        },
        400,
      );
    }

    const { isSub } = result.data;

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

    // Check player is in round
    let roundPlayer: { id: number } | undefined;
    try {
      roundPlayer = await db
        .select({ id: roundPlayers.id })
        .from(roundPlayers)
        .where(
          and(
            eq(roundPlayers.roundId, roundId),
            eq(roundPlayers.playerId, playerId),
          ),
        )
        .get();
    } catch {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
    if (!roundPlayer) {
      return c.json({ error: 'Player not in round', code: 'NOT_FOUND' }, 404);
    }

    try {
      await db
        .update(roundPlayers)
        .set({ isSub: isSub ? 1 : 0 })
        .where(
          and(
            eq(roundPlayers.roundId, roundId),
            eq(roundPlayers.playerId, playerId),
          ),
        );
    } catch {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }

    return c.json({ roundPlayer: { roundId, playerId, isSub: isSub ? 1 : 0 } }, 200);
  },
);

export default app;
