import { Hono } from 'hono';
import { eq, and, desc, countDistinct } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { db } from '../../db/index.js';
import { seasons, rounds, groups, roundPlayers, players, holeScores } from '../../db/schema.js';
import { adminAuthMiddleware } from '../../middleware/admin-auth.js';
import {
  createRoundSchema,
  updateRoundSchema,
  createGroupSchema,
  addGroupPlayerSchema,
} from '../../schemas/round.js';
import { updateHandicapSchema } from '../../schemas/handicap.js';
import type { Variables } from '../../types.js';

const app = new Hono<{ Variables: Variables }>();

// Helper: strip entryCodeHash from a round row before returning
function toRoundResponse(row: typeof rounds.$inferSelect) {
  const { entryCodeHash: _hash, ...roundData } = row;
  return roundData;
}

// ---------------------------------------------------------------------------
// GET /rounds — list all rounds (no entryCodeHash)
// ---------------------------------------------------------------------------

app.get('/rounds', adminAuthMiddleware, async (c) => {
  try {
    const allRounds = await db
      .select()
      .from(rounds)
      .orderBy(desc(rounds.scheduledDate));

    // Build groupCompletion map: total groups and how many have all 18 holes scored
    const allGroups = await db
      .select({ id: groups.id, roundId: groups.roundId })
      .from(groups);

    const holeCountRows = await db
      .select({ groupId: holeScores.groupId, scored: countDistinct(holeScores.holeNumber) })
      .from(holeScores)
      .groupBy(holeScores.groupId);

    const holeCountMap = new Map(holeCountRows.map((r) => [r.groupId, r.scored]));

    const completionMap = new Map<number, { total: number; complete: number }>();
    for (const g of allGroups) {
      const entry = completionMap.get(g.roundId) ?? { total: 0, complete: 0 };
      entry.total++;
      if ((holeCountMap.get(g.id) ?? 0) >= 18) entry.complete++;
      completionMap.set(g.roundId, entry);
    }

    const items = allRounds.map((r) => ({
      ...toRoundResponse(r),
      groupCompletion: completionMap.get(r.id) ?? { total: 0, complete: 0 },
    }));

    return c.json({ items }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /rounds — create a round
// ---------------------------------------------------------------------------

app.post('/rounds', adminAuthMiddleware, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: [] },
      400,
    );
  }

  const result = createRoundSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues },
      400,
    );
  }

  const { seasonId, type, scheduledDate, entryCode } = result.data;

  // Verify season exists
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

  // Hash entry code if provided
  let entryCodeHash: string | null = null;
  if (entryCode) {
    try {
      entryCodeHash = await bcrypt.hash(entryCode, 10);
    } catch {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
  }

  try {
    const inserted = await db
      .insert(rounds)
      .values({
        seasonId,
        type,
        scheduledDate,
        status: 'scheduled',
        entryCodeHash,
        autoCalculateMoney: 1,
        createdAt: Date.now(),
      })
      .returning();

    const round = inserted[0];
    if (!round) {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
    return c.json({ round: toRoundResponse(round) }, 201);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// PATCH /rounds/:id — update a round
// ---------------------------------------------------------------------------

app.patch('/rounds/:id', adminAuthMiddleware, async (c) => {
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

  const result = updateRoundSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues },
      400,
    );
  }

  let existing: { id: number } | undefined;
  try {
    existing = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(eq(rounds.id, id))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (!existing) {
    return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  }

  const updates: Partial<typeof rounds.$inferInsert> = {};
  if (result.data.status !== undefined) updates.status = result.data.status;
  if (result.data.headcount !== undefined) updates.headcount = result.data.headcount;
  if (result.data.scheduledDate !== undefined) updates.scheduledDate = result.data.scheduledDate;
  if (result.data.autoCalculateMoney !== undefined) updates.autoCalculateMoney = result.data.autoCalculateMoney ? 1 : 0;

  // Hash new entry code if provided
  if (result.data.entryCode !== undefined) {
    try {
      updates.entryCodeHash = await bcrypt.hash(result.data.entryCode, 10);
    } catch {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
  }

  // Cancellation also clears the entry code hash (NFR23)
  if (updates.status === 'cancelled') {
    updates.entryCodeHash = null;
  }

  try {
    const updated = await db
      .update(rounds)
      .set(updates)
      .where(eq(rounds.id, id))
      .returning();

    const round = updated[0];
    if (!round) {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
    return c.json({ round: toRoundResponse(round) }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /rounds/:roundId/groups — list groups for a round
// ---------------------------------------------------------------------------

app.get('/rounds/:roundId/groups', adminAuthMiddleware, async (c) => {
  const roundIdParam = c.req.param('roundId');
  const roundId = Number(roundIdParam);
  if (!Number.isInteger(roundId) || roundId <= 0) {
    return c.json({ error: 'Invalid round ID', code: 'INVALID_ID' }, 400);
  }

  // Verify round exists
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
    const allGroups = await db
      .select({
        id: groups.id,
        roundId: groups.roundId,
        groupNumber: groups.groupNumber,
      })
      .from(groups)
      .where(eq(groups.roundId, roundId))
      .orderBy(groups.groupNumber);
    return c.json({ items: allGroups }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/groups — create a group
// ---------------------------------------------------------------------------

app.post('/rounds/:roundId/groups', adminAuthMiddleware, async (c) => {
  const roundIdParam = c.req.param('roundId');
  const roundId = Number(roundIdParam);
  if (!Number.isInteger(roundId) || roundId <= 0) {
    return c.json({ error: 'Invalid round ID', code: 'INVALID_ID' }, 400);
  }

  // Verify round exists
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

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: [] },
      400,
    );
  }

  const result = createGroupSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues },
      400,
    );
  }

  try {
    const inserted = await db
      .insert(groups)
      .values({ roundId, groupNumber: result.data.groupNumber, battingOrder: null })
      .returning();

    const group = inserted[0];
    if (!group) {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
    return c.json({ group: { id: group.id, roundId: group.roundId, groupNumber: group.groupNumber } }, 201);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/groups/:groupId/players — add player to group
// ---------------------------------------------------------------------------

app.post('/rounds/:roundId/groups/:groupId/players', adminAuthMiddleware, async (c) => {
  const roundIdParam = c.req.param('roundId');
  const groupIdParam = c.req.param('groupId');
  const roundId = Number(roundIdParam);
  const groupId = Number(groupIdParam);

  if (!Number.isInteger(roundId) || roundId <= 0) {
    return c.json({ error: 'Invalid round ID', code: 'INVALID_ID' }, 400);
  }
  if (!Number.isInteger(groupId) || groupId <= 0) {
    return c.json({ error: 'Invalid group ID', code: 'INVALID_ID' }, 400);
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

  const result = addGroupPlayerSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues },
      400,
    );
  }

  const { playerId, handicapIndex } = result.data;

  // Verify round exists
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
    return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
  }

  // Verify group exists AND belongs to this round
  let group: { id: number } | undefined;
  try {
    group = await db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.id, groupId), eq(groups.roundId, roundId)))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!group) {
    return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
  }

  // Verify player exists
  let player: { id: number } | undefined;
  try {
    player = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.id, playerId))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!player) {
    return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
  }

  // Check if player is already in this round (unique constraint: round_id + player_id)
  let existingRoundPlayer: { id: number } | undefined;
  try {
    existingRoundPlayer = await db
      .select({ id: roundPlayers.id })
      .from(roundPlayers)
      .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.playerId, playerId)))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (existingRoundPlayer) {
    return c.json({ error: 'Player already in round', code: 'CONFLICT' }, 409);
  }

  // Insert round_players row
  try {
    await db.insert(roundPlayers).values({ roundId, groupId, playerId, handicapIndex, isSub: 0 });
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  return c.json({ roundPlayer: { roundId, groupId, playerId, handicapIndex, isSub: 0 } }, 201);
});

// ---------------------------------------------------------------------------
// POST /rounds/:id/finalize — lock an active official round
// ---------------------------------------------------------------------------

app.post('/rounds/:id/finalize', adminAuthMiddleware, async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  let round: { id: number; type: string; status: string } | undefined;
  try {
    round = await db
      .select({ id: rounds.id, type: rounds.type, status: rounds.status })
      .from(rounds)
      .where(eq(rounds.id, id))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  if (round.type === 'casual') {
    return c.json({ error: 'Casual rounds cannot be finalized', code: 'CASUAL_ROUND' }, 422);
  }
  if (round.status !== 'active') {
    return c.json({ error: 'Round must be active to finalize', code: 'ROUND_NOT_ACTIVE' }, 422);
  }

  try {
    await db.update(rounds).set({ status: 'finalized' }).where(eq(rounds.id, id));
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  return c.json({ id, status: 'finalized' }, 200);
});

// ---------------------------------------------------------------------------
// GET /rounds/:roundId/players — list all players in a round with their HI
// ---------------------------------------------------------------------------

app.get('/rounds/:roundId/players', adminAuthMiddleware, async (c) => {
  const roundId = Number(c.req.param('roundId'));
  if (!Number.isInteger(roundId) || roundId <= 0) {
    return c.json({ error: 'Invalid round ID', code: 'INVALID_ID' }, 400);
  }

  let round: { id: number } | undefined;
  try {
    round = await db.select({ id: rounds.id }).from(rounds).where(eq(rounds.id, roundId)).get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);

  try {
    const rows = await db
      .select({
        playerId: roundPlayers.playerId,
        name: players.name,
        ghinNumber: players.ghinNumber,
        groupId: roundPlayers.groupId,
        groupNumber: groups.groupNumber,
        handicapIndex: roundPlayers.handicapIndex,
        isSub: roundPlayers.isSub,
      })
      .from(roundPlayers)
      .innerJoin(players, eq(roundPlayers.playerId, players.id))
      .innerJoin(groups, eq(roundPlayers.groupId, groups.id))
      .where(eq(roundPlayers.roundId, roundId))
      .orderBy(groups.groupNumber, players.name);
    return c.json({ items: rows }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// PATCH /rounds/:roundId/players/:playerId/handicap — set HI for a player
// ---------------------------------------------------------------------------

app.patch('/rounds/:roundId/players/:playerId/handicap', adminAuthMiddleware, async (c) => {
  const roundId = Number(c.req.param('roundId'));
  const playerId = Number(c.req.param('playerId'));
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
    return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: [] }, 400);
  }

  const result = updateHandicapSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues },
      400,
    );
  }

  let round: { id: number; status: string } | undefined;
  try {
    round = await db
      .select({ id: rounds.id, status: rounds.status })
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  if (round.status === 'finalized') {
    return c.json(
      { error: 'Use corrections flow for finalized rounds', code: 'ROUND_FINALIZED' },
      422,
    );
  }

  let rp: { id: number } | undefined;
  try {
    rp = await db
      .select({ id: roundPlayers.id })
      .from(roundPlayers)
      .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.playerId, playerId)))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!rp) return c.json({ error: 'Player not in round', code: 'NOT_FOUND' }, 404);

  try {
    await db
      .update(roundPlayers)
      .set({ handicapIndex: result.data.handicapIndex })
      .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.playerId, playerId)));
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  return c.json({ playerId, roundId, handicapIndex: result.data.handicapIndex }, 200);
});

export default app;
