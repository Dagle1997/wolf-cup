/**
 * T5-6 score POST endpoint + integration with require-scorer-for-round
 * middleware. Single-writer enforcement boundary (FR-B10, NFR-S3, FR-H3).
 *
 * Mount: `app.route('/api/rounds', scoresRouter)`. Effective URL:
 * `POST /api/rounds/:roundId/holes/:holeNumber/scores`.
 *
 * Chain: requireSession → requireScorerForRound → handler.
 *
 * The middleware does Zod parse on the body and stores the parsed shape
 * via `c.set('scorePostBody', ...)`; the handler reads via
 * `c.get('scorePostBody')` (typed via ContextVariableMap in
 * `apps/tournament-api/src/types/hono.d.ts`). No second parse.
 *
 * The 14-path error taxonomy is documented in T5-6 spec §9. The handler
 * implements steps 1-8 of the transaction logic. State-transition logic
 * is INLINE here; T5-8 will refactor into a `transitionState` service
 * (audit-row payload contract `{ from, to }` is stable; T5-8's refactor
 * is call-site only).
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  holeScores,
  pairings,
  pairingMembers,
  players,
  rounds,
  roundStates,
  scorerAssignments,
} from '../db/schema/index.js';
import { requireSession } from '../middleware/require-session.js';
import { requireScorerForRound } from '../middleware/require-scorer-for-round.js';
import {
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
  writeAudit,
} from '../lib/audit-log.js';
import { emitActivity } from '../lib/activity.js';

const TENANT_ID = 'guyan';

export const scorePostBodySchema = z.object({
  playerId: z.string().uuid(),
  grossStrokes: z.number().int().min(1).max(20),
  putts: z.number().int().min(0).max(15).nullable().optional(),
  clientEventId: z.string().min(1).max(128),
});

export type ScorePostBody = z.infer<typeof scorePostBodySchema>;

export const scoresRouter = new Hono();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * T5-2 score-entry-context GET. Read-only; gated by requireSession only
 * (non-scorers must be able to fetch the round to render the read-only
 * placeholder). Returns 404 round_not_found uniformly for: round doesn't
 * exist OR foreign tenant OR session.userId is not a member of any
 * foursome for this round (round-existence obfuscation pattern).
 *
 * Returns the score-entry-context shape per T5-2 spec §3.
 */
scoresRouter.get('/:roundId', requireSession, async (c) => {
  const requestId = c.get('requestId') ?? randomUUID();
  const player = c.get('player')!;
  const roundId = c.req.param('roundId')!;

  if (!UUID_RE.test(roundId)) {
    return c.json(
      { error: 'bad_request', code: 'invalid_round_id', requestId },
      400,
    );
  }

  // (1) Round existence — uniform 404 for nonexistent / foreign-tenant.
  const roundRows = await db
    .select({
      id: rounds.id,
      eventId: rounds.eventId,
      eventRoundId: rounds.eventRoundId,
      holesToPlay: rounds.holesToPlay,
    })
    .from(rounds)
    .where(and(eq(rounds.id, roundId), eq(rounds.tenantId, TENANT_ID)))
    .limit(1);
  if (roundRows.length === 0) {
    return c.json(
      { error: 'not_found', code: 'round_not_found', requestId },
      404,
    );
  }
  const round = roundRows[0]!;

  // (2) round_states — 422 if absent (no silent default).
  const rsRows = await db
    .select({ state: roundStates.state })
    .from(roundStates)
    .where(
      and(
        eq(roundStates.roundId, roundId),
        eq(roundStates.tenantId, TENANT_ID),
      ),
    )
    .limit(1);
  if (rsRows.length === 0) {
    return c.json(
      { error: 'unprocessable', code: 'round_state_missing', requestId },
      422,
    );
  }
  const state = rsRows[0]!.state;

  // (3) Locate the session player's foursome via pairing_members + pairings.
  // Returns 404 (uniform with foreign-tenant) for non-participants — round
  // existence obfuscation per T5-2 spec §3.
  if (round.eventRoundId === null) {
    // v1.5 standalone-round shape; v1 never writes nulls. Treat as
    // non-participant (404 uniform).
    return c.json(
      { error: 'not_found', code: 'round_not_found', requestId },
      404,
    );
  }

  const myFoursomeRows = await db
    .select({ foursomeNumber: pairings.foursomeNumber })
    .from(pairingMembers)
    .innerJoin(pairings, eq(pairingMembers.pairingId, pairings.id))
    .where(
      and(
        eq(pairings.eventRoundId, round.eventRoundId),
        eq(pairingMembers.playerId, player.id),
        eq(pairings.tenantId, TENANT_ID),
        eq(pairingMembers.tenantId, TENANT_ID),
      ),
    )
    .limit(1);
  if (myFoursomeRows.length === 0) {
    return c.json(
      { error: 'not_found', code: 'round_not_found', requestId },
      404,
    );
  }
  const myFoursomeNumber = myFoursomeRows[0]!.foursomeNumber;

  // (4) Members of my foursome (ordered by slot_number ASC — load-bearing
  // for ref-positional indexing in the UI).
  const memberRows = await db
    .select({
      playerId: pairingMembers.playerId,
      slotNumber: pairingMembers.slotNumber,
      name: players.name,
      handicapIndex: players.manualHandicapIndex,
    })
    .from(pairingMembers)
    .innerJoin(pairings, eq(pairingMembers.pairingId, pairings.id))
    .innerJoin(players, eq(pairingMembers.playerId, players.id))
    .where(
      and(
        eq(pairings.eventRoundId, round.eventRoundId),
        eq(pairings.foursomeNumber, myFoursomeNumber),
        eq(pairings.tenantId, TENANT_ID),
        eq(pairingMembers.tenantId, TENANT_ID),
        eq(players.tenantId, TENANT_ID),
      ),
    )
    .orderBy(pairingMembers.slotNumber);
  const members = memberRows.map((m) => ({
    playerId: m.playerId,
    name: m.name,
    handicapIndex: m.handicapIndex,
  }));

  // (5) Scorer assignment for my foursome (may be null pre-T5-7).
  const scorerRows = await db
    .select({
      scorerPlayerId: scorerAssignments.scorerPlayerId,
      scorerName: players.name,
    })
    .from(scorerAssignments)
    .innerJoin(players, eq(scorerAssignments.scorerPlayerId, players.id))
    .where(
      and(
        eq(scorerAssignments.roundId, roundId),
        eq(scorerAssignments.foursomeNumber, myFoursomeNumber),
        eq(scorerAssignments.tenantId, TENANT_ID),
        eq(players.tenantId, TENANT_ID),
      ),
    )
    .limit(1);
  const scorerPlayerId = scorerRows[0]?.scorerPlayerId ?? null;
  const scorerName = scorerRows[0]?.scorerName ?? null;
  const isScorer = scorerPlayerId === player.id;

  // (6) hole_scores filtered to my foursome's player_ids — pushed into
  // the SQL WHERE so we don't read+filter-in-memory all of the round's
  // hole_scores (could be 4 foursomes × 18 holes = 72 rows for a
  // typical Pinehurst round; small, but tighter is better).
  const memberPlayerIds = members.map((m) => m.playerId);
  const myHoleScores = memberPlayerIds.length > 0
    ? await db
        .select({
          holeNumber: holeScores.holeNumber,
          playerId: holeScores.playerId,
          grossStrokes: holeScores.grossStrokes,
          putts: holeScores.putts,
        })
        .from(holeScores)
        .where(
          and(
            eq(holeScores.roundId, roundId),
            eq(holeScores.tenantId, TENANT_ID),
            inArray(holeScores.playerId, memberPlayerIds),
          ),
        )
    : [];

  return c.json(
    {
      roundId,
      state,
      holesToPlay: round.holesToPlay,
      myFoursome: {
        foursomeNumber: myFoursomeNumber,
        isScorer,
        scorerPlayerId,
        scorerName,
        members,
        holeScores: myHoleScores,
      },
    },
    200,
  );
});

scoresRouter.post(
  '/:roundId/holes/:holeNumber/scores',
  requireSession,
  requireScorerForRound,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const player = c.get('player')!;
    const body = c.get('scorePostBody');
    const roundId = c.req.param('roundId')!;
    const holeNumber = Number(c.req.param('holeNumber'));

    if (!body) {
      // Defensive: middleware mis-mount would leave this undefined.
      // Should never fire in practice; FK middleware contract is the
      // primary guarantee.
      return c.json(
        { error: 'internal', code: 'middleware_misuse_no_body', requestId },
        500,
      );
    }
    if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18) {
      // Defensive: middleware validates this. Reaching here implies
      // mis-mount or test-only bypass.
      return c.json(
        { error: 'internal', code: 'middleware_misuse_no_hole_number', requestId },
        500,
      );
    }

    return await db.transaction(async (tx) => {
      // (1) Fetch round (defense-in-depth; middleware already returned 404)
      const roundRows = await tx
        .select()
        .from(rounds)
        .where(and(eq(rounds.id, roundId), eq(rounds.tenantId, TENANT_ID)))
        .limit(1);
      if (roundRows.length === 0) {
        return c.json(
          { error: 'not_found', code: 'round_not_found', requestId },
          404,
        );
      }
      const round = roundRows[0]!;

      // (2) holeNumber must be within the round's holes_to_play
      if (holeNumber > round.holesToPlay) {
        return c.json(
          {
            error: 'unprocessable',
            code: 'hole_number_exceeds_holes_to_play',
            holesToPlay: round.holesToPlay,
            requestId,
          },
          422,
        );
      }

      // (3) Fetch round_states + writability gate
      const rsRows = await tx
        .select()
        .from(roundStates)
        .where(
          and(
            eq(roundStates.roundId, roundId),
            eq(roundStates.tenantId, TENANT_ID),
          ),
        )
        .limit(1);
      if (rsRows.length === 0) {
        return c.json(
          { error: 'unprocessable', code: 'round_state_missing', requestId },
          422,
        );
      }
      const rs = rsRows[0]!;
      const writableStates = new Set([
        'not_started',
        'in_progress',
        'complete_editable',
      ]);
      if (!writableStates.has(rs.state)) {
        return c.json(
          {
            error: 'unprocessable',
            code: 'round_not_writable',
            currentState: rs.state,
            requestId,
          },
          422,
        );
      }

      // (4) INSERT with idempotent dedupe target. Catch UNIQUE-collision separately.
      const insertId = randomUUID();
      const now = Date.now();
      let didInsert: boolean;
      try {
        const result = await tx
          .insert(holeScores)
          .values({
            id: insertId,
            roundId,
            playerId: body.playerId,
            holeNumber,
            grossStrokes: body.grossStrokes,
            putts: body.putts ?? null,
            scorerPlayerId: player.id,
            clientEventId: body.clientEventId,
            createdAt: now,
            updatedAt: now,
            tenantId: TENANT_ID,
            contextId: round.contextId,
          })
          .onConflictDoNothing({
            target: [
              holeScores.roundId,
              holeScores.playerId,
              holeScores.holeNumber,
              holeScores.clientEventId,
            ],
          })
          .returning({ id: holeScores.id });
        didInsert = result.length === 1;
      } catch (err) {
        // The cell-level UNIQUE fired (different client_event_id at same cell).
        if (isUniqueConstraintError(err)) {
          const existing = await tx
            .select({
              scorerPlayerId: holeScores.scorerPlayerId,
              createdAt: holeScores.createdAt,
              clientEventId: holeScores.clientEventId,
            })
            .from(holeScores)
            .where(
              and(
                eq(holeScores.roundId, roundId),
                eq(holeScores.playerId, body.playerId),
                eq(holeScores.holeNumber, holeNumber),
                eq(holeScores.tenantId, TENANT_ID),
              ),
            )
            .limit(1);
          const conflictingEntry =
            existing.length > 0
              ? {
                  scorer_player_id: existing[0]!.scorerPlayerId,
                  created_at: existing[0]!.createdAt,
                  client_event_id: existing[0]!.clientEventId,
                }
              : null;
          return c.json(
            {
              error: 'conflict',
              code: 'hole_already_scored',
              conflictingEntry,
              requestId,
            },
            409,
          );
        }
        throw err;
      }

      // (4b) Idempotent replay path: same clientEventId → no insert, no audit.
      if (!didInsert) {
        return c.json(
          {
            status: 'ok',
            clientEventId: body.clientEventId,
            deduped: true,
          },
          200,
        );
      }

      // (5) Audit + activity for the new cell.
      await writeAudit(tx, {
        eventType: AUDIT_EVENT_TYPES.SCORE_COMMITTED,
        entityType: AUDIT_ENTITY_TYPES.HOLE_SCORE,
        entityId: insertId,
        actorPlayerId: player.id,
        payload: {
          roundId,
          playerId: body.playerId,
          holeNumber,
          grossStrokes: body.grossStrokes,
          putts: body.putts ?? null,
        },
      });
      const activityScope: { eventId?: string; roundId?: string } = { roundId };
      if (round.eventId !== null) activityScope.eventId = round.eventId;
      await emitActivity(tx, {
        type: 'score.committed',
        actorPlayerId: player.id,
        payload: {
          roundId,
          playerId: body.playerId,
          holeNumber,
          grossStrokes: body.grossStrokes,
        },
        scope: activityScope,
      });

      // (6) First-commit transition not_started → in_progress.
      // Use conditional UPDATE with a state predicate so that concurrent
      // first-commits race-safely: only the first UPDATE actually changes
      // a row; the second sees 0 rows-affected and skips the audit emit.
      let postState = rs.state;
      if (rs.state === 'not_started') {
        const updated = await tx
          .update(roundStates)
          .set({
            state: 'in_progress',
            enteredAt: now,
            enteredByPlayerId: player.id,
          })
          .where(
            and(
              eq(roundStates.roundId, roundId),
              eq(roundStates.tenantId, TENANT_ID),
              eq(roundStates.state, 'not_started'),
            ),
          )
          .returning({ roundId: roundStates.roundId });
        if (updated.length === 1) {
          await tx
            .update(rounds)
            .set({ openedAt: now, openedByPlayerId: player.id })
            .where(
              and(eq(rounds.id, roundId), eq(rounds.tenantId, TENANT_ID)),
            );
          await writeAudit(tx, {
            eventType: AUDIT_EVENT_TYPES.ROUND_STATE_CHANGED,
            entityType: AUDIT_ENTITY_TYPES.ROUND,
            entityId: roundId,
            actorPlayerId: player.id,
            payload: { from: 'not_started', to: 'in_progress' },
          });
          postState = 'in_progress';
        } else {
          // Concurrent transition won; re-read to use the latest state.
          // KEEP the tenant predicate — bypassing it would risk tenant
          // bleed if the same id ever collides across tenants (defense in
          // depth; round-2 codex catch).
          const refetch = await tx
            .select({ state: roundStates.state })
            .from(roundStates)
            .where(
              and(
                eq(roundStates.roundId, roundId),
                eq(roundStates.tenantId, TENANT_ID),
              ),
            )
            .limit(1);
          postState = refetch[0]?.state ?? rs.state;
        }
      }

      // (7) Auto-complete detection. Same race-safe pattern: conditional
      // UPDATE with state='in_progress' predicate so only one transition
      // emits its audit row.
      if (postState === 'in_progress') {
        const expected = await computeExpectedCells(tx, round);
        const actualResult = await tx
          .select({ count: sql<number>`count(*)` })
          .from(holeScores)
          .where(
            and(
              eq(holeScores.roundId, roundId),
              eq(holeScores.tenantId, TENANT_ID),
              sql`${holeScores.holeNumber} <= ${round.holesToPlay}`,
            ),
          );
        const actualCount = actualResult[0]?.count ?? 0;
        if (expected > 0 && actualCount >= expected) {
          const now2 = Date.now();
          const updated = await tx
            .update(roundStates)
            .set({
              state: 'complete_editable',
              enteredAt: now2,
              enteredByPlayerId: player.id,
            })
            .where(
              and(
                eq(roundStates.roundId, roundId),
                eq(roundStates.tenantId, TENANT_ID),
                eq(roundStates.state, 'in_progress'),
              ),
            )
            .returning({ roundId: roundStates.roundId });
          if (updated.length === 1) {
            await writeAudit(tx, {
              eventType: AUDIT_EVENT_TYPES.ROUND_STATE_CHANGED,
              entityType: AUDIT_ENTITY_TYPES.ROUND,
              entityId: roundId,
              actorPlayerId: player.id,
              payload: { from: 'in_progress', to: 'complete_editable' },
            });
          }
        }
      }

      // (8) 201 Created
      return c.json(
        {
          status: 'ok',
          clientEventId: body.clientEventId,
          holeScoreId: insertId,
          deduped: false,
        },
        201,
      );
    });
  },
);

/**
 * `expected = count(distinct player_id) over pairings × round.holesToPlay`.
 * Pass the already-fetched round row so we don't re-query.
 *
 * T5-8 may promote this to `apps/tournament-api/src/services/round-state.ts`
 * when the FSM is extracted.
 */
async function computeExpectedCells(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  round: { eventRoundId: string | null; holesToPlay: number },
): Promise<number> {
  if (round.eventRoundId === null) return 0; // v1.5 standalone-round shape; never auto-completes
  const result = await tx
    .select({ count: sql<number>`count(distinct ${pairingMembers.playerId})` })
    .from(pairingMembers)
    .innerJoin(pairings, eq(pairingMembers.pairingId, pairings.id))
    .where(
      and(
        eq(pairings.eventRoundId, round.eventRoundId),
        eq(pairings.tenantId, TENANT_ID),
        eq(pairingMembers.tenantId, TENANT_ID),
      ),
    );
  const distinctPlayerCount = result[0]?.count ?? 0;
  return distinctPlayerCount * round.holesToPlay;
}

/**
 * Detect SQLite's UNIQUE constraint failure via libsql's wrapped error
 * shape. libsql raises `LibsqlError` with one of:
 *   - `code` (string) = `'SQLITE_CONSTRAINT_UNIQUE'`
 *   - `extendedCode` (string) = same
 *   - `rawCode` (number) = 2067 (SQLITE_CONSTRAINT_UNIQUE extended result code)
 *
 * Drizzle re-throws preserving these fields. We check ALL three on both
 * the wrapping error and its `cause`. We do NOT fall back to message
 * substring matching because that's both too broad ("UNIQUE" appears in
 * error messages for unrelated index issues) and brittle across libsql
 * version updates.
 */
function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const cause = (err as { cause?: unknown }).cause;
  const sources = [err as Record<string, unknown>];
  if (cause && typeof cause === 'object')
    sources.push(cause as Record<string, unknown>);
  for (const src of sources) {
    const code = src['code'];
    const extendedCode = src['extendedCode'];
    const rawCode = src['rawCode'];
    if (
      code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      extendedCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
      rawCode === 2067
    ) {
      return true;
    }
  }
  return false;
}
