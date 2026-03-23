import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc, countDistinct, sql } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { db } from '../../db/index.js';
import { seasons, rounds, groups, roundPlayers, players, holeScores, pairingHistory, seasonWeeks, attendance, subBench, scoreCorrections, wolfDecisions, harveyResults, roundResults, sideGameResults } from '../../db/schema.js';
import { adminAuthMiddleware } from '../../middleware/admin-auth.js';
import {
  createRoundSchema,
  updateRoundSchema,
  createGroupSchema,
  addGroupPlayerSchema,
  fromAttendanceSchema,
} from '../../schemas/round.js';
import { updateHandicapSchema } from '../../schemas/handicap.js';
import { calculateHarveyPoints } from '@wolf-cup/engine';
import { ghinClient } from '../../lib/ghin-client.js';
import type { Variables } from '../../types.js';

const app = new Hono<{ Variables: Variables }>();

// Helper: strip entryCodeHash from a round row before returning
function toRoundResponse(row: typeof rounds.$inferSelect) {
  const { entryCodeHash: _hash, ...roundData } = row;
  return roundData;
}

// Helper: record all C(n,2) pairings for each group in a finalized round
async function recordPairings(seasonId: number, roundId: number): Promise<void> {
  const allGroups = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.roundId, roundId));

  for (const group of allGroups) {
    const groupPlayerRows = await db
      .select({ playerId: roundPlayers.playerId })
      .from(roundPlayers)
      .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.groupId, group.id)));

    const playerIds = groupPlayerRows.map((r) => r.playerId);

    for (let i = 0; i < playerIds.length; i++) {
      for (let j = i + 1; j < playerIds.length; j++) {
        const a = Math.min(playerIds[i]!, playerIds[j]!);
        const b = Math.max(playerIds[i]!, playerIds[j]!);
        await db
          .insert(pairingHistory)
          .values({ seasonId, playerAId: a, playerBId: b, pairCount: 1 })
          .onConflictDoUpdate({
            target: [pairingHistory.seasonId, pairingHistory.playerAId, pairingHistory.playerBId],
            set: { pairCount: sql`${pairingHistory.pairCount} + 1` },
          });
      }
    }
  }
}

/** Group-size bonus per player for Harvey points (incentivizes larger groups). */
function harveyBonus(playerCount: number): number {
  const lookup: Record<number, number> = { 1: 8, 2: 6, 3: 4, 4: 2 };
  return lookup[Math.floor(playerCount / 4)] ?? 0;
}

/**
 * Compute tie-aware dense ranks for a descending-sorted value list.
 * Tied values share the same rank (e.g. [20, 18, 18, 10] → [1, 2, 2, 4]).
 */
function computeRanks(
  items: readonly { playerId: number; value: number }[],
): Map<number, number> {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const ranks = new Map<number, number>();
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i]!.value < sorted[i - 1]!.value) rank = i + 1;
    ranks.set(sorted[i]!.playerId, rank);
  }
  return ranks;
}

// Helper: compute Harvey Cup ranking points from round_results and store in harvey_results
async function computeAndStoreHarvey(roundId: number): Promise<void> {
  // Get all round_results for this round
  const results = await db
    .select({
      playerId: roundResults.playerId,
      stablefordTotal: roundResults.stablefordTotal,
      moneyTotal: roundResults.moneyTotal,
    })
    .from(roundResults)
    .where(eq(roundResults.roundId, roundId));

  if (results.length === 0) return;

  // Calculate Harvey points using engine — include group-size bonus
  const harveyInput = results.map((r) => ({
    stableford: r.stablefordTotal,
    money: r.moneyTotal,
  }));

  const bonusPerPlayer = harveyBonus(results.length);
  const harveyOutput = calculateHarveyPoints(harveyInput, 'regular', bonusPerPlayer);
  const now = Date.now();

  // Compute tie-aware ranks for storage
  const stablefordRanks = computeRanks(results.map((r) => ({ playerId: r.playerId, value: r.stablefordTotal })));
  const moneyRanks = computeRanks(results.map((r) => ({ playerId: r.playerId, value: r.moneyTotal })));

  for (let i = 0; i < results.length; i++) {
    const player = results[i]!;
    const harvey = harveyOutput[i]!;
    const stablefordRank = stablefordRanks.get(player.playerId)!;
    const moneyRank = moneyRanks.get(player.playerId)!;

    await db
      .insert(harveyResults)
      .values({
        roundId,
        playerId: player.playerId,
        stablefordRank,
        moneyRank,
        stablefordPoints: harvey.stablefordPoints,
        moneyPoints: harvey.moneyPoints,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [harveyResults.roundId, harveyResults.playerId],
        set: {
          stablefordRank,
          moneyRank,
          stablefordPoints: harvey.stablefordPoints,
          moneyPoints: harvey.moneyPoints,
          updatedAt: now,
        },
      });
  }
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

    // Player count per round
    const playerCountRows = await db
      .select({ roundId: roundPlayers.roundId, count: countDistinct(roundPlayers.playerId) })
      .from(roundPlayers)
      .groupBy(roundPlayers.roundId);
    const playerCountMap = new Map(playerCountRows.map((r) => [r.roundId, r.count]));

    // Compute per-season round numbers (ordered by scheduledDate, excluding cancelled)
    const roundNumberMap = new Map<number, number>();
    const bySeasonDate = [...allRounds]
      .filter((r) => r.status !== 'cancelled')
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.id - b.id);
    const seasonCounters = new Map<number, number>();
    for (const r of bySeasonDate) {
      const n = (seasonCounters.get(r.seasonId) ?? 0) + 1;
      seasonCounters.set(r.seasonId, n);
      roundNumberMap.set(r.id, n);
    }

    const items = allRounds.map((r) => ({
      ...toRoundResponse(r),
      roundNumber: roundNumberMap.get(r.id) ?? null,
      groupCompletion: completionMap.get(r.id) ?? { total: 0, complete: 0 },
      playerCount: playerCountMap.get(r.id) ?? 0,
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

  const { seasonId, type, scheduledDate, entryCode, tee } = result.data;

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
        entryCode: entryCode ?? null,
        tee: tee ?? null,
        autoCalculateMoney: 1,
        handicapUpdatedAt: Date.now(),
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
  if (result.data.tee !== undefined) updates.tee = result.data.tee;
  if (result.data.cancellationReason !== undefined) updates.cancellationReason = result.data.cancellationReason;

  // Hash new entry code if provided
  if (result.data.entryCode !== undefined) {
    try {
      updates.entryCodeHash = await bcrypt.hash(result.data.entryCode, 10);
      updates.entryCode = result.data.entryCode;
    } catch {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
  }

  // Cancellation also clears the entry code (NFR23)
  if (updates.status === 'cancelled') {
    updates.entryCodeHash = null;
    updates.entryCode = null;
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
// DELETE /rounds/:id — permanently delete a round and all dependent data
// ---------------------------------------------------------------------------

app.delete('/rounds/:id', adminAuthMiddleware, async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  try {
    const round = await db
      .select({ id: rounds.id, status: rounds.status, scheduledDate: rounds.scheduledDate })
      .from(rounds)
      .where(eq(rounds.id, id))
      .get();

    if (!round) {
      return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
    }

    if (round.status === 'finalized') {
      return c.json({ error: 'Cannot delete a finalized round', code: 'VALIDATION_ERROR' }, 422);
    }

    await db.transaction(async (tx) => {
      await tx.delete(scoreCorrections).where(eq(scoreCorrections.roundId, id));
      await tx.delete(wolfDecisions).where(eq(wolfDecisions.roundId, id));
      await tx.delete(harveyResults).where(eq(harveyResults.roundId, id));
      await tx.delete(roundResults).where(eq(roundResults.roundId, id));
      await tx.delete(holeScores).where(eq(holeScores.roundId, id));
      await tx.delete(roundPlayers).where(eq(roundPlayers.roundId, id));
      await tx.delete(groups).where(eq(groups.roundId, id));
      await tx.delete(sideGameResults).where(eq(sideGameResults.roundId, id));
      await tx.delete(rounds).where(eq(rounds.id, id));
    });

    return c.json({ deleted: true }, 200);
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

  const { playerId, handicapIndex, isSub } = result.data;

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
    await db.insert(roundPlayers).values({ roundId, groupId, playerId, handicapIndex, isSub: isSub ? 1 : 0 });
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  return c.json({ roundPlayer: { roundId, groupId, playerId, handicapIndex, isSub: isSub ? 1 : 0 } }, 201);
});

// ---------------------------------------------------------------------------
// DELETE /rounds/:roundId/groups/:groupId/players/:playerId — remove player
// ---------------------------------------------------------------------------

app.delete('/rounds/:roundId/groups/:groupId/players/:playerId', adminAuthMiddleware, async (c) => {
  const roundId = Number(c.req.param('roundId'));
  const groupId = Number(c.req.param('groupId'));
  const playerId = Number(c.req.param('playerId'));

  if (!Number.isInteger(roundId) || roundId <= 0 ||
      !Number.isInteger(groupId) || groupId <= 0 ||
      !Number.isInteger(playerId) || playerId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  let rp: { id: number } | undefined;
  try {
    rp = await db
      .select({ id: roundPlayers.id })
      .from(roundPlayers)
      .where(
        and(
          eq(roundPlayers.roundId, roundId),
          eq(roundPlayers.groupId, groupId),
          eq(roundPlayers.playerId, playerId),
        ),
      )
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (!rp) return c.json({ error: 'Player not in group', code: 'NOT_FOUND' }, 404);

  try {
    await db.delete(roundPlayers).where(eq(roundPlayers.id, rp.id));
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  return c.json({ success: true }, 200);
});

// ---------------------------------------------------------------------------
// DELETE /rounds/:roundId/groups/:groupId — delete an empty group
// ---------------------------------------------------------------------------

app.delete('/rounds/:roundId/groups/:groupId', adminAuthMiddleware, async (c) => {
  const roundId = Number(c.req.param('roundId'));
  const groupId = Number(c.req.param('groupId'));

  if (!Number.isInteger(roundId) || roundId <= 0 ||
      !Number.isInteger(groupId) || groupId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  try {
    const group = await db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.id, groupId), eq(groups.roundId, roundId)))
      .get();

    if (!group) {
      return c.json({ error: 'Group not found', code: 'NOT_FOUND' }, 404);
    }

    // Check if group has players
    const playerCount = await db
      .select({ id: roundPlayers.id })
      .from(roundPlayers)
      .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.groupId, groupId)))
      .all();

    if (playerCount.length > 0) {
      return c.json({ error: 'Group still has players — remove them first', code: 'VALIDATION_ERROR' }, 422);
    }

    await db.delete(groups).where(eq(groups.id, groupId));
    return c.json({ success: true }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /rounds/:id/finalize — lock an active official round
// ---------------------------------------------------------------------------

app.post('/rounds/:id/finalize', adminAuthMiddleware, async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  let round: { id: number; seasonId: number; type: string; status: string } | undefined;
  try {
    round = await db
      .select({ id: rounds.id, seasonId: rounds.seasonId, type: rounds.type, status: rounds.status })
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
    await db.transaction(async (tx) => {
      await tx.update(rounds).set({ status: 'finalized' }).where(eq(rounds.id, id));
    });

    // Compute Harvey Cup points — must succeed for standings integrity
    await computeAndStoreHarvey(id);
  } catch (err) {
    // Roll back finalization if Harvey computation failed
    try {
      await db.update(rounds).set({ status: 'active' }).where(eq(rounds.id, id));
    } catch { /* best-effort rollback */ }
    console.error('Finalization failed:', err);
    return c.json({ error: 'Failed to finalize round — Harvey computation error', code: 'INTERNAL_ERROR' }, 500);
  }

  // Record pairings for group suggestion history (non-fatal — doesn't affect standings)
  try {
    await recordPairings(round.seasonId, id);
  } catch (err) {
    console.error('Failed to record pairings (non-fatal):', err);
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

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/refresh-handicaps — bulk GHIN refresh
// ---------------------------------------------------------------------------

app.post('/rounds/:roundId/refresh-handicaps', adminAuthMiddleware, async (c) => {
  const roundId = Number(c.req.param('roundId'));
  if (!Number.isInteger(roundId) || roundId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  if (!ghinClient) {
    return c.json({ error: 'GHIN not configured', code: 'GHIN_NOT_CONFIGURED' }, 503);
  }

  try {
    const round = await db.select({ id: rounds.id }).from(rounds).where(eq(rounds.id, roundId)).get();
    if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);

    const rps = await db
      .select({
        rpId: roundPlayers.id,
        playerId: roundPlayers.playerId,
        ghinNumber: players.ghinNumber,
      })
      .from(roundPlayers)
      .innerJoin(players, eq(roundPlayers.playerId, players.id))
      .where(eq(roundPlayers.roundId, roundId));

    let refreshed = 0;
    let failed = 0;

    for (const rp of rps) {
      if (!rp.ghinNumber) continue;
      try {
        const { handicapIndex } = await ghinClient.getHandicap(Number(rp.ghinNumber));
        if (handicapIndex !== null) {
          await db.update(players).set({ handicapIndex }).where(eq(players.id, rp.playerId));
          await db.update(roundPlayers).set({ handicapIndex }).where(eq(roundPlayers.id, rp.rpId));
          refreshed++;
        }
      } catch {
        failed++;
      }
    }

    const now = Date.now();
    await db.update(rounds).set({ handicapUpdatedAt: now }).where(eq(rounds.id, roundId));

    return c.json({ refreshed, failed, handicapUpdatedAt: now }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/groups/:groupId/swap — swap a player in a group
// ---------------------------------------------------------------------------

const swapPlayerSchema = z.object({
  removePlayerId: z.number().int().positive(),
  addPlayerId: z.number().int().positive(),
  handicapIndex: z.number().min(0).max(54),
  isSub: z.boolean().optional(),
});

app.post('/rounds/:roundId/groups/:groupId/swap', adminAuthMiddleware, async (c) => {
  const roundId = Number(c.req.param('roundId'));
  const groupId = Number(c.req.param('groupId'));
  if (!Number.isInteger(roundId) || roundId <= 0 || !Number.isInteger(groupId) || groupId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: [] }, 400);
  }

  const parsed = swapPlayerSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);
  }

  const { removePlayerId, addPlayerId, handicapIndex, isSub } = parsed.data;

  try {
    // Verify round and group exist
    const round = await db.select({ id: rounds.id, seasonId: rounds.seasonId, scheduledDate: rounds.scheduledDate })
      .from(rounds).where(eq(rounds.id, roundId)).get();
    if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);

    const group = await db.select({ id: groups.id }).from(groups)
      .where(and(eq(groups.id, groupId), eq(groups.roundId, roundId))).get();
    if (!group) return c.json({ error: 'Group not found', code: 'NOT_FOUND' }, 404);

    // Verify player to remove is in this group
    const existing = await db.select().from(roundPlayers)
      .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.playerId, removePlayerId), eq(roundPlayers.groupId, groupId))).get();
    if (!existing) return c.json({ error: 'Player not in this group', code: 'NOT_FOUND' }, 404);

    // Check replacement not already in round
    const duplicate = await db.select({ id: roundPlayers.id }).from(roundPlayers)
      .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.playerId, addPlayerId))).get();
    if (duplicate) return c.json({ error: 'Replacement already in round', code: 'VALIDATION_ERROR', issues: [{ message: 'Player is already in this round' }] }, 400);

    // Determine isSub if not explicitly provided
    let subFlag = isSub ?? false;
    if (isSub === undefined) {
      const benchEntry = await db.select({ id: subBench.id }).from(subBench)
        .where(and(eq(subBench.seasonId, round.seasonId), eq(subBench.playerId, addPlayerId))).get();
      subFlag = !!benchEntry;
    }

    await db.transaction(async (tx) => {
      // Remove old player
      await tx.delete(roundPlayers).where(
        and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.playerId, removePlayerId)),
      );

      // Add replacement to same group
      await tx.insert(roundPlayers).values({
        roundId,
        playerId: addPlayerId,
        groupId,
        handicapIndex,
        isSub: subFlag ? 1 : 0,
      });

      // Update attendance if we can find the season week
      const week = await tx.select({ id: seasonWeeks.id }).from(seasonWeeks)
        .where(and(eq(seasonWeeks.seasonId, round.seasonId), eq(seasonWeeks.friday, round.scheduledDate))).get();

      if (week) {
        // Mark removed player as 'out'
        await tx.insert(attendance).values({ seasonWeekId: week.id, playerId: removePlayerId, status: 'out', updatedAt: Date.now() })
          .onConflictDoUpdate({ target: [attendance.seasonWeekId, attendance.playerId], set: { status: 'out', updatedAt: Date.now() } });

        // Mark added player as 'in'
        await tx.insert(attendance).values({ seasonWeekId: week.id, playerId: addPlayerId, status: 'in', updatedAt: Date.now() })
          .onConflictDoUpdate({ target: [attendance.seasonWeekId, attendance.playerId], set: { status: 'in', updatedAt: Date.now() } });
      }
    });

    // Return updated group
    const updatedPlayers = await db.select({
      playerId: roundPlayers.playerId,
      handicapIndex: roundPlayers.handicapIndex,
      isSub: roundPlayers.isSub,
      name: players.name,
    }).from(roundPlayers)
      .innerJoin(players, eq(roundPlayers.playerId, players.id))
      .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.groupId, groupId)));

    return c.json({ players: updatedPlayers }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /rounds/from-attendance — create round from confirmed attendance
// ---------------------------------------------------------------------------

app.post('/rounds/from-attendance', adminAuthMiddleware, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: [] }, 400);
  }

  const parsed = fromAttendanceSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);
  }

  const { seasonWeekId } = parsed.data;

  try {
    // Get week info
    const week = await db.select().from(seasonWeeks).where(eq(seasonWeeks.id, seasonWeekId)).get();
    if (!week) {
      return c.json({ error: 'Week not found', code: 'NOT_FOUND' }, 404);
    }
    if (week.isActive === 0) {
      return c.json({ error: 'Week is inactive', code: 'VALIDATION_ERROR', issues: [{ message: 'Cannot create round for inactive week' }] }, 400);
    }

    // Check if round already exists for this date/season
    const existingRound = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(and(eq(rounds.seasonId, week.seasonId), eq(rounds.scheduledDate, week.friday)))
      .get();
    if (existingRound) {
      return c.json({ error: 'Round already exists for this date', code: 'VALIDATION_ERROR', issues: [{ message: 'A round already exists for this Friday' }] }, 400);
    }

    // Get confirmed players
    const attendanceRows = await db
      .select({ playerId: attendance.playerId })
      .from(attendance)
      .where(and(eq(attendance.seasonWeekId, seasonWeekId), eq(attendance.status, 'in')));

    const confirmedIds = attendanceRows.map((a) => a.playerId);
    if (confirmedIds.length === 0) {
      return c.json({ error: 'No confirmed players', code: 'VALIDATION_ERROR', issues: [{ message: 'No players confirmed for this week' }] }, 400);
    }
    if (confirmedIds.length % 4 !== 0) {
      const needed = 4 - (confirmedIds.length % 4);
      return c.json({
        error: 'Validation error',
        code: 'VALIDATION_ERROR',
        issues: [{ message: `${needed} more player${needed !== 1 ? 's' : ''} needed for groups of 4` }],
      }, 400);
    }

    // Get player details
    const playerRows = await db
      .select({ id: players.id, handicapIndex: players.handicapIndex })
      .from(players)
      .where(sql`${players.id} IN (${sql.join(confirmedIds.map((id) => sql`${id}`), sql`, `)})`);

    // Determine subs
    const subRows = await db
      .select({ playerId: subBench.playerId })
      .from(subBench)
      .where(eq(subBench.seasonId, week.seasonId));
    const subIds = new Set(subRows.map((s) => s.playerId));

    // Generate entry code
    const entryCode = week.friday.slice(0, 4);
    const entryCodeHash = await bcrypt.hash(entryCode, 10);

    const now = Date.now();
    const groupCount = confirmedIds.length / 4;

    const txResult = await db.transaction(async (tx) => {
      // Create round
      const [round] = await tx
        .insert(rounds)
        .values({
          seasonId: week.seasonId,
          type: 'official',
          status: 'scheduled',
          scheduledDate: week.friday,
          entryCodeHash,
          entryCode,
          tee: week.tee,
          headcount: confirmedIds.length,
          handicapUpdatedAt: now,
          createdAt: now,
        })
        .returning();

      if (!round) throw new Error('Round insert failed');

      // Create groups
      const groupIds: number[] = [];
      for (let i = 0; i < groupCount; i++) {
        const [g] = await tx
          .insert(groups)
          .values({ roundId: round.id, groupNumber: i + 1 })
          .returning();
        groupIds.push(g!.id);
      }

      // Add players (round-robin across groups)
      for (let i = 0; i < confirmedIds.length; i++) {
        const pid = confirmedIds[i]!;
        const player = playerRows.find((p) => p.id === pid);
        const groupId = groupIds[i % groupCount]!;
        await tx.insert(roundPlayers).values({
          roundId: round.id,
          playerId: pid,
          groupId,
          handicapIndex: player?.handicapIndex ?? 0,
          isSub: subIds.has(pid) ? 1 : 0,
        });
      }

      return round;
    });

    return c.json(
      {
        round: toRoundResponse(txResult),
        entryCode,
        groupCount,
        playerCount: confirmedIds.length,
      },
      201,
    );
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

export default app;
