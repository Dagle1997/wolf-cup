/**
 * T5-9 score-corrections endpoint.
 *
 * Mount: `app.route('/api/rounds', scoreCorrectionsRouter)`. Effective URLs:
 *   POST /api/rounds/:roundId/scores/:playerId/:holeNumber/correct
 *   GET  /api/rounds/:roundId/score-corrections
 *
 * NARROWED port of Wolf Cup's apps/api/src/routes/admin/score-corrections.ts
 * @ commit 279a3538019d68329804189011a6d456999b0e42 (dated 2026-04-25).
 *
 * Tournament v1 deltas vs Wolf Cup precedent:
 *   - Covers gross + putts only (no wolf decisions / greenies / polies /
 *     sandies / handicapIndex — those live in T6+ for tournament).
 *   - Auth model: per-event organizer OR scorer-of-target-foursome
 *     (NOT global admin). Reuses T5-8's `isEventOrganizer` helper.
 *   - State-machine integration via T5-8 `getRoundState`: allowed in
 *     `in_progress`, `complete_editable`, `finalized`; rejected in
 *     `not_started`, `cancelled`.
 *   - T6 money/side-game recompute deferred to followup T5-9a (T6 not
 *     shipped); v1 emits a post-commit breadcrumb log.
 *   - URL shape: cell coords in PATH (`:roundId`, `:playerId`,
 *     `:holeNumber`) instead of body (`grossScore` field-name dispatch
 *     in Wolf Cup's polymorphic POST).
 *   - Auth-leak resistance: auth runs INSIDE the tx BEFORE any state /
 *     existence read. Nonexistent rounds return 403 to unauthorized
 *     callers (NOT 404), preserving information-disclosure resistance.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  holeScores,
  pairingMembers,
  pairings,
  rounds,
  scoreCorrections,
  scorerAssignments,
} from '../db/schema/index.js';
import { logger as moduleLogger } from '../lib/log.js';
import { requireSession } from '../middleware/require-session.js';
import {
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
  writeAudit,
} from '../lib/audit-log.js';
import { emitActivity } from '../lib/activity.js';
import {
  BusinessRuleError,
  getRoundState,
  isEventOrganizer,
} from '../services/round-state.js';

const TENANT_ID = 'guyan';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const scoreCorrectionBodySchema = z.object({
  grossStrokes: z.number().int().min(1).max(20),
  putts: z.number().int().min(0).max(15).nullable().optional(),
  reason: z.string().max(500).optional(),
});

export const scoreCorrectionsRouter = new Hono();

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Returns true if `callerId` is the per-event organizer OR the scorer
 * of the foursome containing `targetPlayerId`. Used by POST /correct.
 *
 * Tenant-scoped on every joined table. Returns FALSE for nonexistent
 * roundId (no rows in events join) — preserves the no-existence-leak
 * invariant: unauthorized caller on a nonexistent round gets 403, not 404.
 */
async function isOrganizerOrScorerOfPlayersFoursome(
  tx: Tx,
  roundId: string,
  targetPlayerId: string,
  callerId: string,
  tenantId: string,
): Promise<boolean> {
  // Path A: per-event organizer.
  if (await isEventOrganizer(tx, roundId, callerId, tenantId)) return true;

  // Path B: scorer of the foursome containing targetPlayerId.
  // Step 1: find the foursome the targetPlayerId is in for this round's event_round.
  const foursomeRows = await tx
    .select({ foursomeNumber: pairings.foursomeNumber })
    .from(pairingMembers)
    .innerJoin(pairings, eq(pairingMembers.pairingId, pairings.id))
    .innerJoin(rounds, eq(rounds.eventRoundId, pairings.eventRoundId))
    .where(
      and(
        eq(rounds.id, roundId),
        eq(pairingMembers.playerId, targetPlayerId),
        eq(rounds.tenantId, tenantId),
        eq(pairings.tenantId, tenantId),
        eq(pairingMembers.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (foursomeRows.length === 0) return false;
  const targetFoursome = foursomeRows[0]!.foursomeNumber;

  // Step 2: check if caller is the assigned scorer of THAT foursome.
  const scorerRows = await tx
    .select({ scorerPlayerId: scorerAssignments.scorerPlayerId })
    .from(scorerAssignments)
    .where(
      and(
        eq(scorerAssignments.roundId, roundId),
        eq(scorerAssignments.foursomeNumber, targetFoursome),
        eq(scorerAssignments.scorerPlayerId, callerId),
        eq(scorerAssignments.tenantId, tenantId),
      ),
    )
    .limit(1);
  return scorerRows.length > 0;
}

/**
 * Returns true if `callerId` is the per-event organizer OR a scorer of
 * ANY foursome of this round. Used by GET /score-corrections.
 */
async function isOrganizerOrAnyRoundScorer(
  tx: Tx,
  roundId: string,
  callerId: string,
  tenantId: string,
): Promise<boolean> {
  if (await isEventOrganizer(tx, roundId, callerId, tenantId)) return true;
  const rows = await tx
    .select({ foursomeNumber: scorerAssignments.foursomeNumber })
    .from(scorerAssignments)
    .where(
      and(
        eq(scorerAssignments.roundId, roundId),
        eq(scorerAssignments.scorerPlayerId, callerId),
        eq(scorerAssignments.tenantId, tenantId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// POST /:roundId/scores/:playerId/:holeNumber/correct
// ---------------------------------------------------------------------------

scoreCorrectionsRouter.post(
  '/:roundId/scores/:playerId/:holeNumber/correct',
  requireSession,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const player = c.get('player')!;
    const roundId = c.req.param('roundId');
    const playerIdParam = c.req.param('playerId');
    const holeNumberParam = c.req.param('holeNumber');

    // Path validation.
    if (!roundId || !UUID_RE.test(roundId)) {
      return c.json(
        { error: 'bad_request', code: 'invalid_round_id', requestId },
        400,
      );
    }
    if (!playerIdParam || !UUID_RE.test(playerIdParam)) {
      return c.json(
        { error: 'bad_request', code: 'invalid_player_id', requestId },
        400,
      );
    }
    const holeNumber = Number(holeNumberParam);
    if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18) {
      return c.json(
        { error: 'bad_request', code: 'invalid_hole_number', requestId },
        400,
      );
    }

    // Body parse + Zod.
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json(
        {
          error: 'bad_request',
          code: 'malformed_json',
          requestId,
        },
        400,
      );
    }
    const parsed = scoreCorrectionBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        {
          error: 'validation_error',
          code: 'invalid_body',
          issues: parsed.error.issues,
          requestId,
        },
        400,
      );
    }
    const body = parsed.data;

    // ── Begin transaction (auth FIRST → state gate → existence → write) ──
    let postCommitContext: {
      correctionId: string;
      finalState: string;
    } | null = null;

    try {
      const result = await db.transaction(async (tx) => {
        // (i) Auth FIRST. No-existence-leak invariant: nonexistent
        // round/player → predicate FALSE → 403 (NOT 404).
        const authed = await isOrganizerOrScorerOfPlayersFoursome(
          tx,
          roundId,
          playerIdParam,
          player.id,
          TENANT_ID,
        );
        if (!authed) {
          throw new BusinessRuleError(
            'not_authorized_for_correction',
            'caller is neither event organizer nor scorer of target player\'s foursome',
            403,
          );
        }

        // (ii) State gate.
        const state = await getRoundState(tx, roundId, TENANT_ID);
        if (state === null) {
          throw new BusinessRuleError(
            'round_state_missing',
            'no round_states row',
            422,
          );
        }
        if (state === 'not_started' || state === 'cancelled') {
          throw new BusinessRuleError(
            'round_state_forbids_correction',
            `round is in state '${state}'; corrections not allowed`,
            422,
          );
        }

        // (iii) Existence check on hole_scores cell.
        const cellRows = await tx
          .select({
            id: holeScores.id,
            grossStrokes: holeScores.grossStrokes,
            putts: holeScores.putts,
            contextId: holeScores.contextId,
          })
          .from(holeScores)
          .where(
            and(
              eq(holeScores.roundId, roundId),
              eq(holeScores.playerId, playerIdParam),
              eq(holeScores.holeNumber, holeNumber),
              eq(holeScores.tenantId, TENANT_ID),
            ),
          )
          .limit(1);
        if (cellRows.length === 0) {
          throw new BusinessRuleError(
            'cannot_correct_unscored_hole',
            'no hole_scores row for this (roundId, playerId, holeNumber)',
            404,
          );
        }
        const cell = cellRows[0]!;

        // (iv) Compute new values. Distinguish three putts cases:
        //   - body.putts === undefined → preserve existing cell.putts (no change).
        //   - body.putts === null     → explicitly clear to NULL.
        //   - body.putts is a number  → set to that value.
        // Rationale: Zod's .nullable().optional() produces T | null | undefined;
        // omitting putts is the dominant case (typo-fix on grossStrokes only)
        // and must NOT silently zero out putts (data loss).
        const correctionId = randomUUID();
        const now = Date.now();
        const newPutts =
          body.putts === undefined ? cell.putts : body.putts;
        const priorValue = {
          grossStrokes: cell.grossStrokes,
          putts: cell.putts,
        };
        const newValue = {
          grossStrokes: body.grossStrokes,
          putts: newPutts,
        };

        await tx.insert(scoreCorrections).values({
          id: correctionId,
          roundId,
          playerId: playerIdParam,
          holeNumber,
          actorPlayerId: player.id,
          priorValueJson: JSON.stringify(priorValue),
          newValueJson: JSON.stringify(newValue),
          requestId,
          reason: body.reason ?? null,
          createdAt: now,
          tenantId: TENANT_ID,
          contextId: cell.contextId,
        });

        // (v) UPDATE hole_scores (target cell only).
        await tx
          .update(holeScores)
          .set({
            grossStrokes: body.grossStrokes,
            putts: newPutts,
            updatedAt: now,
          })
          .where(
            and(
              eq(holeScores.roundId, roundId),
              eq(holeScores.playerId, playerIdParam),
              eq(holeScores.holeNumber, holeNumber),
              eq(holeScores.tenantId, TENANT_ID),
            ),
          );

        // (vi) Audit row.
        await writeAudit(tx, {
          eventType: AUDIT_EVENT_TYPES.SCORE_CORRECTED,
          entityType: AUDIT_ENTITY_TYPES.HOLE_SCORE,
          entityId: cell.id,
          actorPlayerId: player.id,
          payload: {
            roundId,
            playerId: playerIdParam,
            holeNumber,
            prior: priorValue,
            new: newValue,
            reason: body.reason ?? null,
          },
        });

        // (vii) Activity emit (v1 NO-OP per lib/activity.ts).
        await emitActivity(tx, {
          type: 'score.corrected',
          actorPlayerId: player.id,
          scope: { roundId },
          payload: {
            playerId: playerIdParam,
            holeNumber,
            prior: priorValue,
            new: newValue,
          },
        });

        return {
          correctionId,
          priorValue,
          newValue,
          finalState: state,
        };
      });

      // Post-commit: emit T6-pending breadcrumb if state was finalized.
      // Logged outside the tx so a rolled-back tx doesn't emit a misleading
      // log line (per AC-4 spec requirement).
      if (result.finalState === 'finalized') {
        log.info({
          msg: 'correction_post_finalize_pending_t6',
          event: 'correction_post_finalize_pending_t6',
          requestId,
          roundId,
          correctionId: result.correctionId,
        });
      }

      postCommitContext = {
        correctionId: result.correctionId,
        finalState: result.finalState,
      };

      return c.json(
        {
          ok: true,
          correctionId: result.correctionId,
          prior: result.priorValue,
          new: result.newValue,
          requestId,
        },
        200,
      );
    } catch (err) {
      if (err instanceof BusinessRuleError) {
        const errorLabel =
          err.status === 403
            ? 'forbidden'
            : err.status === 404
              ? 'not_found'
              : 'unprocessable';
        return c.json(
          { error: errorLabel, code: err.code, requestId },
          err.status as 403 | 404 | 422,
        );
      }
      log.error({
        msg: '/correct threw',
        requestId,
        roundId,
        err: String(err),
        postCommitContext,
      });
      return c.json(
        { error: 'internal', code: 'correction_failed', requestId },
        500,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// GET /:roundId/score-corrections
// ---------------------------------------------------------------------------

scoreCorrectionsRouter.get(
  '/:roundId/score-corrections',
  requireSession,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const player = c.get('player')!;
    const roundId = c.req.param('roundId');

    if (!roundId || !UUID_RE.test(roundId)) {
      return c.json(
        { error: 'bad_request', code: 'invalid_round_id', requestId },
        400,
      );
    }

    try {
      const items = await db.transaction(async (tx) => {
        // Auth FIRST — no short-circuit on "no corrections found" → 200.
        // Nonexistent roundId returns FALSE here → 403 (no existence leak).
        const authed = await isOrganizerOrAnyRoundScorer(
          tx,
          roundId,
          player.id,
          TENANT_ID,
        );
        if (!authed) {
          throw new BusinessRuleError(
            'not_authorized_for_correction_history',
            'caller is neither event organizer nor a scorer of any foursome',
            403,
          );
        }

        const rows = await tx
          .select()
          .from(scoreCorrections)
          .where(
            and(
              eq(scoreCorrections.roundId, roundId),
              eq(scoreCorrections.tenantId, TENANT_ID),
            ),
          )
          .orderBy(desc(scoreCorrections.createdAt));
        return rows;
      });

      return c.json({ items, requestId }, 200);
    } catch (err) {
      if (err instanceof BusinessRuleError) {
        return c.json(
          {
            error: err.status === 403 ? 'forbidden' : 'unprocessable',
            code: err.code,
            requestId,
          },
          err.status as 403 | 422,
        );
      }
      log.error({
        msg: '/score-corrections threw',
        requestId,
        roundId,
        err: String(err),
      });
      return c.json(
        { error: 'internal', code: 'correction_history_failed', requestId },
        500,
      );
    }
  },
);

