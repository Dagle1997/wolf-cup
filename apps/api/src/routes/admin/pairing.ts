import { Hono } from 'hono';
import { eq, and, or, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { pairingHistory, rounds } from '../../db/schema.js';
import { adminAuthMiddleware } from '../../middleware/admin-auth.js';
import { suggestGroupsSchema } from '../../schemas/pairing.js';
import { suggestGroups, pairKey, type PairingMatrix } from '@wolf-cup/engine';
import type { Variables } from '../../types.js';

const app = new Hono<{ Variables: Variables }>();

// ---------------------------------------------------------------------------
// GET /pairing/matrix?seasonId=X&playerIds=1,2,3
// ---------------------------------------------------------------------------

app.get('/pairing/matrix', adminAuthMiddleware, async (c) => {
  const seasonIdParam = c.req.query('seasonId');
  const playerIdsParam = c.req.query('playerIds');

  if (!seasonIdParam) {
    return c.json({ error: 'seasonId query param required', code: 'MISSING_PARAM' }, 400);
  }
  const seasonId = Number(seasonIdParam);
  if (!Number.isInteger(seasonId) || seasonId <= 0) {
    return c.json({ error: 'Invalid seasonId', code: 'INVALID_PARAM' }, 400);
  }

  let playerIds: number[] | undefined;
  if (playerIdsParam) {
    playerIds = playerIdsParam.split(',').map(Number);
    if (playerIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      return c.json({ error: 'Invalid playerIds', code: 'INVALID_PARAM' }, 400);
    }
  }

  try {
    let rows;
    if (playerIds && playerIds.length > 0) {
      rows = await db
        .select()
        .from(pairingHistory)
        .where(
          and(
            eq(pairingHistory.seasonId, seasonId),
            or(
              inArray(pairingHistory.playerAId, playerIds),
              inArray(pairingHistory.playerBId, playerIds),
            ),
          ),
        );
      // Filter to only rows where BOTH players are in the set
      const pidSet = new Set(playerIds);
      rows = rows.filter((r) => pidSet.has(r.playerAId) && pidSet.has(r.playerBId));
    } else {
      rows = await db
        .select()
        .from(pairingHistory)
        .where(eq(pairingHistory.seasonId, seasonId));
    }

    // Build symmetric matrix as nested object
    const matrix: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      const a = String(row.playerAId);
      const b = String(row.playerBId);
      if (!matrix[a]) matrix[a] = {};
      if (!matrix[b]) matrix[b] = {};
      matrix[a]![b] = row.pairCount;
      matrix[b]![a] = row.pairCount;
    }

    return c.json({ matrix }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/suggest-groups
// ---------------------------------------------------------------------------

app.post('/rounds/:roundId/suggest-groups', adminAuthMiddleware, async (c) => {
  const roundId = Number(c.req.param('roundId'));
  if (!Number.isInteger(roundId) || roundId <= 0) {
    return c.json({ error: 'Invalid round ID', code: 'INVALID_ID' }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON', code: 'INVALID_BODY' }, 400);
  }

  const parsed = suggestGroupsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: 'Validation failed', code: 'VALIDATION_ERROR', issues: parsed.error.issues },
      400,
    );
  }

  const { playerIds, pins: rawPins } = parsed.data;

  // Get round's seasonId
  let round: { seasonId: number } | undefined;
  try {
    round = await db
      .select({ seasonId: rounds.seasonId })
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (!round) {
    return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  }

  // Fetch pairing history for these players
  let historyRows;
  try {
    const rows = await db
      .select()
      .from(pairingHistory)
      .where(eq(pairingHistory.seasonId, round.seasonId));

    const pidSet = new Set(playerIds);
    historyRows = rows.filter((r) => pidSet.has(r.playerAId) && pidSet.has(r.playerBId));
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  // Build matrix for engine
  const matrix: PairingMatrix = new Map();
  for (const row of historyRows) {
    matrix.set(pairKey(row.playerAId, row.playerBId), row.pairCount);
  }

  // Convert pins from Record<string, number> to Map<number, number>
  const pinMap = new Map<number, number>();
  if (rawPins) {
    for (const [pidStr, gIdx] of Object.entries(rawPins)) {
      pinMap.set(Number(pidStr), gIdx);
    }
  }

  const result = suggestGroups({ matrix, playerIds, pins: pinMap });

  // Format response with 1-based group numbers
  const groupsOut = result.groups.map((g, i) => ({
    groupNumber: i + 1,
    playerIds: [...g],
  }));

  return c.json({ groups: groupsOut, remainder: [...result.remainder], totalCost: result.totalCost }, 200);
});

export default app;
