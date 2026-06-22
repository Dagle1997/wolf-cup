/**
 * Story 2.1 — F1 Epic 2 inline claim capture route.
 *
 * Mount: `app.route('/api/rounds', claimsRouter)`. Effective URL:
 *   POST /api/rounds/:roundId/claims
 *
 * Body: { playerId, holeNumber, claimType ('greenie'|'polie'|'sandie'),
 *         op ('set'|'remove'), clientEventId }.
 *
 * Chain: requireSession → handler. The single-writer scorer gate is enforced
 * IN-HANDLER via the shared `resolveScorerGate` helper (the same per-USER gate
 * `requireScorerForRound` uses). The middleware itself can't be mounted here:
 * it is hard-coupled to `:holeNumber` in the path and a SCORE-shaped body
 * (`scorePostBodySchema` requires grossStrokes). Claims carry a different body,
 * so — exactly as the presses route does — we reuse the gate LOGIC, not the
 * middleware. This preserves single-writer semantics with zero score-path
 * regression risk.
 *
 * ⚠️ APPEND-ONLY: a write APPENDS a row (set OR remove) via the claim-write
 * service's ON CONFLICT(client_event_id) DO NOTHING. NO cell-unique, NO 409,
 * NO hard delete. A `remove` is a later write; a stale `set` replay is deduped.
 *
 * Story 2.1 ships CAPTURE + STORAGE + recompute-fanout ONLY — a recorded claim
 * is INERT (no money effect) until its resolver (2.2-2.4) ships.
 *
 * Interim finalized-check: a write to a finalized round is refused here
 * (Epic 4 routes this through the canonical frozen-boundary check; this is the
 * deliberate seam). Allowed states mirror the score-write writability gate.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { rounds, roundStates, eventRounds } from '../db/schema/index.js';
import { requireSession } from '../middleware/require-session.js';
import { resolveScorerGate } from '../middleware/require-scorer-for-round.js';
import {
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
  writeAudit,
} from '../lib/audit-log.js';
import { emitActivity } from '../lib/activity.js';
import { appendClaimWrite } from '../services/claim-write.js';
import { CLAIM_TYPES, CLAIM_OPS } from '../services/claim-write.js';
import { logger as moduleLogger } from '../lib/log.js';

const TENANT_ID = 'guyan';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const claimPostBodySchema = z.object({
  playerId: z.string().uuid(),
  holeNumber: z.number().int().min(1).max(18),
  // Zod-validated (NOT DB CHECK) per the append-only schema decision.
  claimType: z.enum(CLAIM_TYPES),
  op: z.enum(CLAIM_OPS),
  clientEventId: z.string().min(1).max(128),
});

export type ClaimPostBody = z.infer<typeof claimPostBodySchema>;

export const claimsRouter = new Hono();

claimsRouter.post('/:roundId/claims', requireSession, async (c) => {
  const requestId = c.get('requestId') ?? randomUUID();
  const log = c.get('logger') ?? moduleLogger;
  const player = c.get('player')!;
  const roundId = c.req.param('roundId')!;

  if (!UUID_RE.test(roundId)) {
    return c.json(
      { error: 'bad_request', code: 'invalid_round_id', requestId },
      400,
    );
  }

  // Parse + Zod-validate the body (claim_type/op validated here, not DB CHECK).
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json(
      { error: 'bad_request', code: 'invalid_body', reason: 'malformed_json', requestId },
      400,
    );
  }
  const parsed = claimPostBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      { error: 'validation_error', code: 'invalid_body', issues: parsed.error.issues, requestId },
      400,
    );
  }
  const body = parsed.data;

  try {
    return await db.transaction(async (tx) => {
      // (1) Round existence — tenant-scoped uniform 404.
      const roundRows = await tx
        .select({
          id: rounds.id,
          eventId: rounds.eventId,
          eventRoundId: rounds.eventRoundId,
          contextId: rounds.contextId,
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

      if (round.eventRoundId === null) {
        // v1.5 standalone-round shape; v1 never writes nulls. No pairings to
        // resolve a foursome/scorer against → cannot gate. 422 setup error
        // (mirrors requireScorerForRound's standalone-round handling).
        return c.json(
          { error: 'unprocessable', code: 'foursome_has_no_scorer', requestId },
          422,
        );
      }

      // (1b) holes-in-play gate: reject a claim on a hole outside the round's
      // holes_to_play (a 9-hole round has no hole 10-18). Mirrors the score
      // path's holes-in-play filter so out-of-play claims never enter the log
      // and surface (inert now; the 2.2-2.4 resolvers would otherwise consume
      // them). Tenant-scoped via the event_round → round linkage.
      const erRows = await tx
        .select({ holesToPlay: eventRounds.holesToPlay })
        .from(eventRounds)
        .where(
          and(
            eq(eventRounds.id, round.eventRoundId),
            eq(eventRounds.tenantId, TENANT_ID),
          ),
        )
        .limit(1);
      const holesToPlay = erRows[0]?.holesToPlay ?? 18;
      if (body.holeNumber > holesToPlay) {
        return c.json(
          {
            error: 'validation_error',
            code: 'hole_out_of_play',
            holesToPlay,
            requestId,
          },
          400,
        );
      }

      // (2) round_states writability gate — INTERIM finalized-check (AC13).
      // Allowed states mirror the score-write gate. A finalized (or cancelled /
      // missing) round refuses the claim write with an explanation. Epic 4
      // routes this through the canonical frozen-boundary check.
      const rsRows = await tx
        .select({ state: roundStates.state })
        .from(roundStates)
        .where(
          and(eq(roundStates.roundId, roundId), eq(roundStates.tenantId, TENANT_ID)),
        )
        .limit(1);
      if (rsRows.length === 0) {
        return c.json(
          { error: 'unprocessable', code: 'round_state_missing', requestId },
          422,
        );
      }
      const state = rsRows[0]!.state;
      const writableStates = new Set([
        'not_started',
        'in_progress',
        'complete_editable',
      ]);
      if (!writableStates.has(state)) {
        return c.json(
          {
            error: 'unprocessable',
            code: 'round_not_writable',
            currentState: state,
            requestId,
          },
          422,
        );
      }

      // (3) Single-writer scorer gate (same per-USER gate as a score write).
      // Also validates body.playerId belongs to a foursome of this round
      // (cross-event/foursome guard, AC3): an unknown player → 404
      // player_not_in_any_foursome.
      const decision = await resolveScorerGate(tx, {
        roundId,
        eventRoundId: round.eventRoundId,
        targetPlayerId: body.playerId,
        callerPlayerId: player.id,
        tenantId: TENANT_ID,
      });
      if (!decision.ok) {
        switch (decision.code) {
          case 'player_not_in_any_foursome':
            return c.json(
              { error: 'not_found', code: 'player_not_in_any_foursome', requestId },
              404,
            );
          case 'foursome_has_no_scorer':
            return c.json(
              { error: 'unprocessable', code: 'foursome_has_no_scorer', requestId },
              422,
            );
          default:
            return c.json(
              {
                error: 'forbidden',
                code: decision.code,
                currentScorerPlayerId: decision.currentScorerPlayerId,
                currentScorerName: decision.currentScorerName ?? null,
                requestId,
              },
              403,
            );
        }
      }

      // (4) Append the write (set OR remove) idempotently. Claim is ACCEPTED
      // AS ENTERED — v1 does NOT validate eligibility (e.g. greenie-only-on-par-3);
      // correctness is the group's (trust + audit) (AC8).
      const insertId = randomUUID();
      const now = Date.now();
      const appendResult = await appendClaimWrite(tx, {
        id: insertId,
        roundId,
        playerId: body.playerId,
        holeNumber: body.holeNumber,
        claimType: body.claimType,
        op: body.op,
        scorerPlayerId: player.id,
        clientEventId: body.clientEventId,
        tenantId: TENANT_ID,
        contextId: round.contextId,
        now,
      });

      // (4b) Idempotent replay: same clientEventId → no append, no audit/activity.
      if (!appendResult.inserted) {
        return c.json(
          { status: 'ok', clientEventId: body.clientEventId, deduped: true },
          200,
        );
      }

      // (5) Audit + activity in the same tx.
      await writeAudit(tx, {
        eventType: AUDIT_EVENT_TYPES.GAME_CLAIM_RECORDED,
        entityType: AUDIT_ENTITY_TYPES.HOLE_CLAIM,
        entityId: insertId,
        actorPlayerId: player.id,
        payload: {
          roundId,
          playerId: body.playerId,
          holeNumber: body.holeNumber,
          claimType: body.claimType,
          op: body.op,
        },
      });

      // Activity feed requires a non-null eventId; v1 event rounds always have
      // one (eventRoundId non-null ⇒ eventId non-null via the rounds CHECK).
      if (round.eventId !== null) {
        await emitActivity(tx, {
          type: 'game.claim_recorded',
          eventId: round.eventId,
          roundId,
          playerId: body.playerId,
          holeNumber: body.holeNumber,
          claimType: body.claimType,
          op: body.op,
          actorPlayerId: player.id,
        });
      }

      return c.json(
        {
          status: 'ok',
          clientEventId: body.clientEventId,
          claimWriteId: insertId,
          seq: appendResult.seq,
          deduped: false,
        },
        201,
      );
    });
  } catch (err) {
    log.error({
      msg: 'claim_write_failed',
      requestId,
      roundId,
      err: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    throw err;
  }
});
