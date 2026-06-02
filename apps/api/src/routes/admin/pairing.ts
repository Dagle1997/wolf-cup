import { Hono } from 'hono';
import { eq, and, or, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { pairingHistory, rounds, players } from '../../db/schema.js';
import { buildGroupRequestPins } from '../../lib/group-request-pins.js';
import {
  serializeGroups,
  computePairingDiff,
  isValidSnapshot,
  type PairingGroup,
} from '../../lib/pairing-capture.js';
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

  // Get round's seasonId + scheduledDate (for attendance group-request lookup)
  let round: { seasonId: number; scheduledDate: string } | undefined;
  try {
    round = await db
      .select({ seasonId: rounds.seasonId, scheduledDate: rounds.scheduledDate })
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (!round) {
    return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  }

  const { pins: requestPins, warnings: requestWarnings } = await buildGroupRequestPins({
    seasonId: round.seasonId,
    scheduledDate: round.scheduledDate,
    playerIds,
  });

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

  // Start from attendance group-requests, then let explicit admin pins override.
  const pinMap = new Map<number, number>(requestPins);
  if (rawPins) {
    for (const [pidStr, gIdx] of Object.entries(rawPins)) {
      pinMap.set(Number(pidStr), gIdx);
    }
  }

  const result = suggestGroups({ matrix, playerIds, pins: pinMap });

  // Format response with 1-based group numbers + pair counts
  const groupsOut = result.groups.map((g, i) => {
    const ids = [...g];
    const pairs: { playerA: number; playerB: number; count: number }[] = [];
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        const count = matrix.get(pairKey(ids[a]!, ids[b]!)) ?? 0;
        if (count > 0) {
          pairs.push({ playerA: ids[a]!, playerB: ids[b]!, count });
        }
      }
    }
    pairs.sort((a, b) => b.count - a.count);
    return {
      groupNumber: i + 1,
      playerIds: ids,
      pairCounts: pairs,
      maxPairCount: pairs[0]?.count ?? 0,
    };
  });

  return c.json(
    {
      groups: groupsOut,
      remainder: [...result.remainder],
      totalCost: result.totalCost,
      requestWarnings,
      honoredRequests: [...requestPins.entries()].map(([playerId, groupIdx]) => ({
        playerId,
        groupNumber: groupIdx + 1,
      })),
    },
    200,
  );
});

// ---------------------------------------------------------------------------
// GET /rounds/:roundId/pairing-diff
//
// Audit: the engine's generated pairing (captured at from-attendance Generate)
// vs the round's current group membership. Untracked rounds (null snapshot,
// e.g. created before this feature) return tracked:false + generated:null +
// the current groups as `final`, never an error.
// ---------------------------------------------------------------------------

app.get('/rounds/:roundId/pairing-diff', adminAuthMiddleware, async (c) => {
  const roundId = Number(c.req.param('roundId'));
  if (!Number.isInteger(roundId) || roundId <= 0) {
    return c.json({ error: 'Invalid round ID', code: 'INVALID_ID' }, 400);
  }

  try {
    const round = await db
      .select({ id: rounds.id, generatedPairing: rounds.generatedPairing })
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .get();

    if (!round) {
      return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
    }

    // Parse the set-once snapshot. A value that is unparseable OR parses to the
    // wrong shape is treated as "not tracked" rather than throwing downstream
    // (FMA guard — generated_pairing is only ever written well-formed, but the
    // endpoint must never 500 on a corrupt row).
    let generated: PairingGroup[] | null = null;
    if (round.generatedPairing != null) {
      try {
        const parsed: unknown = JSON.parse(round.generatedPairing);
        if (isValidSnapshot(parsed)) generated = parsed;
      } catch {
        generated = null;
      }
    }

    const final = await serializeGroups(roundId, db);
    const tracked = generated !== null;
    const changes = tracked
      ? computePairingDiff(generated!, final)
      : { moved: [], added: [], removed: [] };

    // Resolve display names for every player referenced in either snapshot.
    // Tolerate a since-deleted player (missing/null name) → "Player #<id>".
    const ids = new Set<number>();
    for (const g of generated ?? []) for (const id of g.playerIds) ids.add(id);
    for (const g of final) for (const id of g.playerIds) ids.add(id);

    const nameById = new Map<number, string>();
    if (ids.size > 0) {
      const rows = await db
        .select({ id: players.id, name: players.name })
        .from(players)
        .where(inArray(players.id, [...ids]));
      for (const r of rows) if (r.name) nameById.set(r.id, r.name);
    }
    const nameOf = (id: number) => nameById.get(id) ?? `Player #${id}`;
    const withNames = (gs: PairingGroup[]) =>
      gs.map((g) => ({
        groupNumber: g.groupNumber,
        playerIds: g.playerIds,
        names: g.playerIds.map(nameOf),
      }));

    return c.json(
      {
        tracked,
        generated: generated ? withNames(generated) : null,
        final: withNames(final),
        changes,
        names: Object.fromEntries([...ids].map((id) => [id, nameOf(id)])),
      },
      200,
    );
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

export default app;
