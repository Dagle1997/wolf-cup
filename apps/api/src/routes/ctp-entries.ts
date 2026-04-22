import { Hono } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { db } from '../db/index.js';
import {
  rounds,
  groups,
  roundPlayers,
  players,
  sideGames,
  sideGameCtpEntries,
  holeCompletions,
} from '../db/schema.js';
import { createCtpEntrySchema } from '../schemas/ctp.js';
import { resolvePerHoleWinners, type CtpEntry } from '../lib/ctp.js';
import type { Variables } from '../types.js';

const app = new Hono<{ Variables: Variables }>();

// Tenant/context values are hard-coded for the single-tenant Wolf Cup
// deployment. When multi-tenant arrives, these become request-scoped and
// threaded through auth middleware.
const DEFAULT_TENANT_ID = 'guyan';
const DEFAULT_CONTEXT_ID = 'league:guyan-wolf-cup-friday';

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/ctp-entries — any round-joined player records a
// group+par3 CTP answer. Upserts on (tenant, context, round, group, hole).
// ---------------------------------------------------------------------------

app.post('/rounds/:roundId/ctp-entries', async (c) => {
  const roundId = Number(c.req.param('roundId'));
  if (!Number.isInteger(roundId) || roundId <= 0) {
    return c.json({ error: 'Invalid round ID', code: 'INVALID_ID' }, 400);
  }

  // Fetch round
  let round:
    | { id: number; type: string; status: string; entryCodeHash: string | null; seasonId: number }
    | undefined;
  try {
    round = await db
      .select({
        id: rounds.id,
        type: rounds.type,
        status: rounds.status,
        entryCodeHash: rounds.entryCodeHash,
        seasonId: rounds.seasonId,
      })
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  // 'completed' is the terminal state for casual/practice rounds — those are
  // never in the CTP rotation, so they'll 422 at the CTP_NOT_ACTIVE check
  // anyway. Per spec, ROUND_FINALIZED covers only 'finalized' and 'cancelled'.
  if (round.status === 'finalized' || round.status === 'cancelled') {
    return c.json({ error: 'Round finalized', code: 'ROUND_FINALIZED' }, 422);
  }

  // Reject non-official rounds outright. Casual/practice rounds bypass the
  // entry-code check by design (see score-submit handler), so if one were
  // ever scheduled into the CTP rotation the endpoint would be unauthenticated.
  // Per spec, CTP is never on practice rounds — enforce it at the API boundary
  // rather than relying on the rotation config never drifting.
  if (round.type !== 'official') {
    return c.json({ error: 'CTP is not the active side game for this round', code: 'CTP_NOT_ACTIVE' }, 422);
  }

  // Entry-code check for official rounds (mirrors score-submit handler)
  const code = c.req.header('x-entry-code');
  if (!code || !round.entryCodeHash) {
    return c.json({ error: 'Invalid entry code', code: 'INVALID_ENTRY_CODE' }, 403);
  }
  let valid = false;
  try {
    valid = await bcrypt.compare(code, round.entryCodeHash);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!valid) return c.json({ error: 'Invalid entry code', code: 'INVALID_ENTRY_CODE' }, 403);

  // Parse + validate body
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: [] }, 400);
  }
  const parsed = createCtpEntrySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);
  }
  const { groupId, holeNumber, winnerPlayerId } = parsed.data;

  // Verify group belongs to round
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
  if (!group) return c.json({ error: 'Group not found', code: 'GROUP_NOT_FOUND' }, 404);

  // Verify CTP is the active side game for this round.
  //
  // Identity check: calculationType === 'manual'. This is stable (admin API
  // does not let the field be edited) and resilient to display-name renames.
  //
  // Known assumption: CTP is the ONLY manual side game in the rotation
  // (confirmed by SIDE_GAME_DEFINITIONS in apps/api/src/routes/admin/side-games.ts).
  // If a second manual side game is ever added, this check becomes ambiguous
  // and a dedicated slug column on side_games is required. Prior codex
  // rounds considered combining calculationType with a name match for
  // defense-in-depth, but that regresses under a legitimate admin rename,
  // silently disabling CTP. Single-signal identification is preferred.
  let ctpActive = false;
  try {
    const seasonSideGames = await db
      .select({
        calculationType: sideGames.calculationType,
        scheduledRoundIds: sideGames.scheduledRoundIds,
      })
      .from(sideGames)
      .where(eq(sideGames.seasonId, round.seasonId));
    ctpActive = seasonSideGames.some((sg) => {
      if (sg.calculationType !== 'manual') return false;
      try {
        const parsedIds = JSON.parse(sg.scheduledRoundIds ?? '[]') as unknown;
        if (!Array.isArray(parsedIds)) return false;
        const ids = parsedIds.map((v) => Number(v)).filter((n) => Number.isFinite(n));
        return ids.includes(roundId);
      } catch {
        return false;
      }
    });
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!ctpActive) {
    return c.json({ error: 'CTP is not the active side game for this round', code: 'CTP_NOT_ACTIVE' }, 422);
  }

  // Validate winnerPlayerId is on the SUBMITTING group's roster (not just
  // anywhere on the round). CTP winners are the physical tee shot — they
  // must have been teeing off in this group. Prevents attribution bugs
  // where group 1 submits a group-2 player as their winner.
  let winnerNameSnapshot: string | null = null;
  if (winnerPlayerId !== null) {
    let rp: { name: string } | undefined;
    try {
      rp = await db
        .select({ name: players.name })
        .from(roundPlayers)
        .innerJoin(players, eq(players.id, roundPlayers.playerId))
        .where(and(
          eq(roundPlayers.roundId, roundId),
          eq(roundPlayers.groupId, groupId),
          eq(roundPlayers.playerId, winnerPlayerId),
        ))
        .get();
    } catch {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
    if (!rp) {
      return c.json({ error: 'Player not on round', code: 'PLAYER_NOT_ON_ROUND' }, 422);
    }
    winnerNameSnapshot = rp.name;
  }

  // Require hole_completions row for this (round, group, hole). Scoped by
  // tenant/context to avoid cross-tenant leakage in a future multi-tenant deployment.
  let completion: { completedAt: number } | undefined;
  try {
    completion = await db
      .select({ completedAt: holeCompletions.completedAt })
      .from(holeCompletions)
      .where(
        and(
          eq(holeCompletions.tenantId, DEFAULT_TENANT_ID),
          eq(holeCompletions.contextId, DEFAULT_CONTEXT_ID),
          eq(holeCompletions.roundId, roundId),
          eq(holeCompletions.groupId, groupId),
          eq(holeCompletions.holeNumber, holeNumber),
        ),
      )
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!completion) {
    return c.json({ error: 'Hole not complete', code: 'HOLE_NOT_COMPLETE' }, 422);
  }

  // Determine whether this POST will create or update a row — drives the HTTP
  // status code (201 vs 200). This is a small, non-atomic read purely for
  // status-code accuracy; the actual WRITE below is atomic and handles
  // concurrent submits correctly regardless of what this read saw. In the
  // narrow window where another request inserts between this SELECT and our
  // upsert, the status code may be 201 when it should be 200 — cosmetic, not
  // a data-integrity issue. Ms-resolution createdAt=updatedAt collision (the
  // concern from round-2 codex #1) is avoided entirely with this approach.
  let existedBefore = false;
  try {
    const check = await db
      .select({ id: sideGameCtpEntries.id })
      .from(sideGameCtpEntries)
      .where(
        and(
          eq(sideGameCtpEntries.tenantId, DEFAULT_TENANT_ID),
          eq(sideGameCtpEntries.contextId, DEFAULT_CONTEXT_ID),
          eq(sideGameCtpEntries.roundId, roundId),
          eq(sideGameCtpEntries.groupId, groupId),
          eq(sideGameCtpEntries.holeNumber, holeNumber),
        ),
      )
      .get();
    existedBefore = !!check;
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  // Single-statement atomic upsert on the unique index. The WHERE clause on
  // the DO UPDATE branch blocks updates to already-finalized rows, closing
  // the TOCTOU race between a separate read-then-write. When the conflict
  // target row has finalized_at set, SQLite's ON CONFLICT DO UPDATE WHERE
  // evaluates the WHERE against the existing row; if false, the UPDATE is
  // skipped and RETURNING yields no rows — our signal to reject 422.
  const now = Date.now();
  let returned: Array<typeof sideGameCtpEntries.$inferSelect>;
  try {
    returned = await db
      .insert(sideGameCtpEntries)
      .values({
        roundId,
        groupId,
        holeNumber,
        winnerPlayerId: winnerPlayerId,
        winnerName: winnerNameSnapshot,
        enteredByPlayerId: null,
        holeCompletedAt: completion.completedAt,
        finalizedAt: null,
        tenantId: DEFAULT_TENANT_ID,
        contextId: DEFAULT_CONTEXT_ID,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          sideGameCtpEntries.tenantId,
          sideGameCtpEntries.contextId,
          sideGameCtpEntries.roundId,
          sideGameCtpEntries.groupId,
          sideGameCtpEntries.holeNumber,
        ],
        // hole_completed_at is intentionally omitted: it's a property of when
        // the hole was physically played, not when CTP was claimed, and must
        // be preserved across answer changes.
        set: {
          winnerPlayerId: winnerPlayerId,
          winnerName: winnerNameSnapshot,
          updatedAt: now,
        },
        where: isNull(sideGameCtpEntries.finalizedAt),
      })
      .returning();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (returned.length === 0) {
    // Conflict occurred but the WHERE blocked the UPDATE — target row is finalized.
    return c.json({ error: 'Round finalized', code: 'ROUND_FINALIZED' }, 422);
  }

  return c.json({ entry: toEntryResponse(returned[0]!) }, existedBefore ? 200 : 201);
});

// ---------------------------------------------------------------------------
// GET /rounds/:roundId/ctp-entries — public. Entries + resolved winners.
// ---------------------------------------------------------------------------

app.get('/rounds/:roundId/ctp-entries', async (c) => {
  const roundId = Number(c.req.param('roundId'));
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
  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);

  let rows;
  try {
    rows = await db
      .select({
        id: sideGameCtpEntries.id,
        roundId: sideGameCtpEntries.roundId,
        groupId: sideGameCtpEntries.groupId,
        holeNumber: sideGameCtpEntries.holeNumber,
        winnerPlayerId: sideGameCtpEntries.winnerPlayerId,
        storedWinnerName: sideGameCtpEntries.winnerName,
        livePlayerName: players.name,
        holeCompletedAt: sideGameCtpEntries.holeCompletedAt,
        finalizedAt: sideGameCtpEntries.finalizedAt,
        updatedAt: sideGameCtpEntries.updatedAt,
      })
      .from(sideGameCtpEntries)
      .leftJoin(players, eq(players.id, sideGameCtpEntries.winnerPlayerId))
      .where(and(
        eq(sideGameCtpEntries.tenantId, DEFAULT_TENANT_ID),
        eq(sideGameCtpEntries.contextId, DEFAULT_CONTEXT_ID),
        eq(sideGameCtpEntries.roundId, roundId),
      ));
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  // Prefer live player name (handles rename) but fall back to stored snapshot
  // if the player was deleted.
  const entries: CtpEntry[] = rows.map((r) => ({
    id: r.id,
    roundId: r.roundId,
    groupId: r.groupId,
    holeNumber: r.holeNumber,
    winnerPlayerId: r.winnerPlayerId,
    winnerName: r.livePlayerName ?? r.storedWinnerName,
    holeCompletedAt: r.holeCompletedAt,
  }));

  const currentWinners = resolvePerHoleWinners(entries);

  return c.json(
    {
      entries: rows.map((r) => ({
        id: r.id,
        roundId: r.roundId,
        groupId: r.groupId,
        holeNumber: r.holeNumber,
        winnerPlayerId: r.winnerPlayerId,
        winnerName: r.livePlayerName ?? r.storedWinnerName,
        holeCompletedAt: r.holeCompletedAt,
        finalizedAt: r.finalizedAt,
        updatedAt: r.updatedAt,
      })),
      currentWinners,
    },
    200,
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CtpEntryRow = typeof sideGameCtpEntries.$inferSelect;

function toEntryResponse(row: CtpEntryRow) {
  return {
    id: row.id,
    roundId: row.roundId,
    groupId: row.groupId,
    holeNumber: row.holeNumber,
    winnerPlayerId: row.winnerPlayerId,
    winnerName: row.winnerName,
    holeCompletedAt: row.holeCompletedAt,
    finalizedAt: row.finalizedAt,
    updatedAt: row.updatedAt,
  };
}

export default app;
