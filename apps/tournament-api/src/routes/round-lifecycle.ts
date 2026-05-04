/**
 * T5-8 round-lifecycle endpoints.
 *
 * Mount: `app.route('/api/rounds', roundLifecycleRouter)`. Effective URLs:
 *   - POST /api/rounds/:roundId/complete
 *   - POST /api/rounds/:roundId/complete-rollback
 *   - POST /api/rounds/:roundId/finalize
 *   - POST /api/rounds/:roundId/cancel
 *
 * Authorization model:
 *   - /complete + /complete-rollback: per-event organizer OR scorer of
 *     ANY foursome in the round.
 *   - /finalize + /cancel: per-event organizer ONLY.
 *
 * All auth checks happen INSIDE the transaction (T5-7 pattern) for TOCTOU
 * safety. State reads use `getRoundState`; transitions use `transitionState`.
 *
 * v1 NOTE on /finalize: epic AC mentions T6 money/leaderboard recompute
 * inside the finalize transaction. T6 hasn't shipped — followup T5-8a
 * tracks appending the dispatcher invocation when it does. v1 ships the
 * skeleton: missing-cell re-verify, transitionState, audit row, activity
 * emit. Returns 200 with { state: 'finalized', finalizedAt, idempotent }.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { roundStates, scorerAssignments } from '../db/schema/index.js';
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
  computeMissingCells,
  getRoundContext,
  getRoundState,
  isEventOrganizer,
  transitionState,
} from '../services/round-state.js';
import { computeSubGamesForRound } from '../services/sub-games.js';

const TENANT_ID = 'guyan';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const roundLifecycleRouter = new Hono();

/**
 * Returns true if `playerId` is the per-event organizer OR a scorer of
 * any foursome in the round. Used by /complete + /complete-rollback.
 */
async function isOrganizerOrAnyScorer(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  roundId: string,
  playerId: string,
  tenantId: string,
): Promise<boolean> {
  if (await isEventOrganizer(tx, roundId, playerId, tenantId)) return true;
  const rows = await tx
    .select({ foursomeNumber: scorerAssignments.foursomeNumber })
    .from(scorerAssignments)
    .where(
      and(
        eq(scorerAssignments.roundId, roundId),
        eq(scorerAssignments.scorerPlayerId, playerId),
        eq(scorerAssignments.tenantId, tenantId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

function uuidValidationError(roundId: string | undefined, requestId: string) {
  if (!roundId || !UUID_RE.test(roundId)) {
    return { error: 'bad_request' as const, code: 'invalid_round_id' as const, requestId };
  }
  return null;
}

// ---------------------------------------------------------------------------
// POST /:roundId/complete  —  in_progress → complete_editable
// ---------------------------------------------------------------------------

roundLifecycleRouter.post('/:roundId/complete', requireSession, async (c) => {
  const requestId = c.get('requestId') ?? randomUUID();
  const log = c.get('logger') ?? moduleLogger;
  const player = c.get('player')!;
  const roundId = c.req.param('roundId');

  const uuidErr = uuidValidationError(roundId, requestId);
  if (uuidErr) return c.json(uuidErr, 400);

  try {
    const result = await db.transaction(async (tx) => {
      // (i) Authorization FIRST — runs before ANY state read or
      // existence check so unauthorized callers can't probe whether
      // the round exists or what state it's in.
      const authed = await isOrganizerOrAnyScorer(tx, roundId!, player.id, TENANT_ID);
      if (!authed) {
        throw new BusinessRuleError(
          'not_authorized_for_complete',
          'caller is neither event organizer nor a scorer of any foursome',
          403,
        );
      }

      // (ii) State gate.
      const state = await getRoundState(tx, roundId!, TENANT_ID);
      if (state === null) {
        throw new BusinessRuleError('round_state_missing', 'no round_states row', 422);
      }

      // (iii) State-driven branching (auth already passed).
      if (state === 'cancelled') {
        throw new BusinessRuleError('round_cancelled', 'round is cancelled', 422);
      }
      if (state === 'finalized') {
        throw new BusinessRuleError('round_finalized', 'round is finalized', 422);
      }
      if (state === 'complete_editable') {
        // Idempotent (caller authorized).
        return { kind: 'idempotent' as const, state };
      }
      if (state === 'not_started') {
        throw new BusinessRuleError(
          'round_not_in_progress',
          'cannot complete a round that has not started',
          422,
        );
      }

      // (iii) Read round context.
      const round = await getRoundContext(tx, roundId!, TENANT_ID);
      if (round === null) {
        throw new BusinessRuleError('round_not_found', 'rounds row missing', 404);
      }

      // (v) Missing-cell enumeration.
      const missing = await computeMissingCells(tx, roundId!, round, TENANT_ID);
      if (missing.missingCells.length > 0) {
        // Throw a typed error so the route catches with the missingCells payload.
        const err = new BusinessRuleError(
          'round_incomplete',
          `${missing.missingCells.length} cells unscored`,
          422,
        );
        // Attach the array; route will read it before responding.
        (err as unknown as { missingCells: typeof missing.missingCells }).missingCells =
          missing.missingCells;
        throw err;
      }

      // (vi) Transition.
      await transitionState(tx, roundId!, 'complete_editable', player.id, TENANT_ID);

      // (vii) Activity.
      await emitActivity(tx, {
        type: 'round.completed',
        actorPlayerId: player.id,
        scope: { roundId: roundId! },
        payload: {},
      });

      return { kind: 'transitioned' as const, state: 'complete_editable' as const };
    });

    return c.json(
      {
        ok: true,
        state: 'complete_editable',
        idempotent: result.kind === 'idempotent',
        requestId,
      },
      200,
    );
  } catch (err) {
    if (err instanceof BusinessRuleError) {
      const body: Record<string, unknown> = {
        error:
          err.status === 403
            ? 'forbidden'
            : err.status === 404
              ? 'not_found'
              : 'unprocessable',
        code: err.code,
        requestId,
      };
      const missingCells = (err as unknown as { missingCells?: unknown }).missingCells;
      if (missingCells !== undefined) body['missingCells'] = missingCells;
      return c.json(body, err.status as 403 | 422 | 404);
    }
    log.error({ msg: '/complete threw', requestId, roundId, err: String(err) });
    return c.json({ error: 'internal', code: 'complete_failed', requestId }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /:roundId/complete-rollback  —  complete_editable → in_progress
// ---------------------------------------------------------------------------

roundLifecycleRouter.post(
  '/:roundId/complete-rollback',
  requireSession,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const player = c.get('player')!;
    const roundId = c.req.param('roundId');

    const uuidErr = uuidValidationError(roundId, requestId);
    if (uuidErr) return c.json(uuidErr, 400);

    try {
      await db.transaction(async (tx) => {
        // Auth FIRST (before any state read / existence probing).
        const authed = await isOrganizerOrAnyScorer(
          tx,
          roundId!,
          player.id,
          TENANT_ID,
        );
        if (!authed) {
          throw new BusinessRuleError(
            'not_authorized_for_complete_rollback',
            'caller is neither event organizer nor a scorer of any foursome',
            403,
          );
        }
        const state = await getRoundState(tx, roundId!, TENANT_ID);
        if (state === null) {
          throw new BusinessRuleError(
            'round_state_missing',
            'no round_states row',
            422,
          );
        }
        if (state !== 'complete_editable') {
          throw new BusinessRuleError(
            'not_in_complete_editable',
            `round is in state '${state}'; cannot rollback`,
            422,
          );
        }
        await transitionState(tx, roundId!, 'in_progress', player.id, TENANT_ID);
        await emitActivity(tx, {
          type: 'round.complete_rolled_back',
          actorPlayerId: player.id,
          scope: { roundId: roundId! },
          payload: {},
        });
      });
      return c.json(
        { ok: true, state: 'in_progress', requestId },
        200,
      );
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
        msg: '/complete-rollback threw',
        requestId,
        roundId,
        err: String(err),
      });
      return c.json(
        { error: 'internal', code: 'complete_rollback_failed', requestId },
        500,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// POST /:roundId/finalize  —  complete_editable → finalized (organizer only)
// ---------------------------------------------------------------------------

roundLifecycleRouter.post(
  '/:roundId/finalize',
  requireSession,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const player = c.get('player')!;
    const roundId = c.req.param('roundId');

    const uuidErr = uuidValidationError(roundId, requestId);
    if (uuidErr) return c.json(uuidErr, 400);

    try {
      const result = await db.transaction(async (tx) => {
        // (i) Per-event organizer auth FIRST (before state read / probing).
        const isOrg = await isEventOrganizer(tx, roundId!, player.id, TENANT_ID);
        if (!isOrg) {
          throw new BusinessRuleError(
            'not_authorized_for_finalize',
            'only the event organizer may finalize',
            403,
          );
        }

        // (ii) State gate.
        const state = await getRoundState(tx, roundId!, TENANT_ID);
        if (state === null) {
          throw new BusinessRuleError('round_state_missing', 'no round_states row', 422);
        }

        if (state === 'finalized') {
          // Idempotent (caller authorized): re-read entered_at for the response.
          const rows = await tx
            .select({ enteredAt: roundStates.enteredAt })
            .from(roundStates)
            .where(
              and(
                eq(roundStates.roundId, roundId!),
                eq(roundStates.tenantId, TENANT_ID),
              ),
            )
            .limit(1);
          return {
            kind: 'idempotent' as const,
            finalizedAt: rows[0]?.enteredAt ?? Date.now(),
          };
        }
        if (state !== 'complete_editable') {
          throw new BusinessRuleError(
            'not_in_complete_editable',
            `round is in state '${state}'; finalize requires complete_editable`,
            422,
          );
        }

        // (iii) Round context.
        const round = await getRoundContext(tx, roundId!, TENANT_ID);
        if (round === null) {
          throw new BusinessRuleError('round_not_found', 'rounds row missing', 404);
        }

        // (iv) Defensive missing-cell re-verify.
        const missing = await computeMissingCells(tx, roundId!, round, TENANT_ID);
        if (missing.missingCells.length > 0) {
          const err = new BusinessRuleError(
            'round_incomplete',
            `${missing.missingCells.length} cells unscored`,
            422,
          );
          (err as unknown as { missingCells: typeof missing.missingCells }).missingCells =
            missing.missingCells;
          throw err;
        }

        // (v) Transition (writes the generic state_changed audit row).
        await transitionState(tx, roundId!, 'finalized', player.id, TENANT_ID);

        // (vi) Re-read round_states.entered_at as the canonical finalizedAt.
        // This ensures the audit row, the response payload, and the persisted
        // round_states all share ONE timestamp source. The idempotent path
        // (above) reads from the same column, so first-call and second-call
        // responses agree.
        const finalizedRows = await tx
          .select({ enteredAt: roundStates.enteredAt })
          .from(roundStates)
          .where(
            and(
              eq(roundStates.roundId, roundId!),
              eq(roundStates.tenantId, TENANT_ID),
            ),
          )
          .limit(1);
        const finalizedAt = finalizedRows[0]?.enteredAt ?? Date.now();

        // (vii) Dedicated round.finalized audit row (defense in depth: makes
        // post-finalize drilldowns + T9 reporting filter-by-eventType cheap).
        await writeAudit(tx, {
          eventType: AUDIT_EVENT_TYPES.ROUND_FINALIZED,
          entityType: AUDIT_ENTITY_TYPES.ROUND,
          entityId: roundId!,
          actorPlayerId: player.id,
          payload: { finalizedAt },
        });

        // (vii) Activity.
        await emitActivity(tx, {
          type: 'round.finalized',
          actorPlayerId: player.id,
          scope: { roundId: roundId! },
          payload: {},
        });

        // (viii) T6-13a: auto-compute attached sub-games (skins, etc.).
        // Stub-typed sub-games are SKIPPED (logged) — they don't fail
        // finalization. computeSubGamesForRound is idempotent in the sense
        // that re-finalize would just append more sub_game_results rows
        // (FD-10/11 append-only history), but finalize itself is gated on
        // complete_editable → finalized so re-finalize won't happen unless
        // a future story adds an unfinalize path.
        try {
          await computeSubGamesForRound(tx, roundId!, TENANT_ID, log);
        } catch (err) {
          // Non-fatal: log + continue. Sub-game compute failures should not
          // block finalization (per epic AC line 2192 — stub types skip
          // with a logged note; same posture for other compute errors v1).
          // Followup T6-13b tracks if observed at scale that we need a
          // stricter posture.
          log.warn({
            msg: 'finalize_subgame_compute_failed_non_fatal',
            roundId: roundId!,
            err: String(err),
          });
        }

        return { kind: 'transitioned' as const, finalizedAt };
      });

      return c.json(
        {
          ok: true,
          state: 'finalized',
          finalizedAt: result.finalizedAt,
          idempotent: result.kind === 'idempotent',
          requestId,
        },
        200,
      );
    } catch (err) {
      if (err instanceof BusinessRuleError) {
        const body: Record<string, unknown> = {
          error:
            err.status === 403
              ? 'forbidden'
              : err.status === 404
                ? 'not_found'
                : 'unprocessable',
          code: err.code,
          requestId,
        };
        const missingCells = (err as unknown as { missingCells?: unknown }).missingCells;
        if (missingCells !== undefined) body['missingCells'] = missingCells;
        return c.json(body, err.status as 403 | 422 | 404);
      }
      log.error({ msg: '/finalize threw', requestId, roundId, err: String(err) });
      return c.json(
        { error: 'internal', code: 'finalize_failed', requestId },
        500,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// POST /:roundId/cancel  —  any non-finalized → cancelled (organizer only)
// ---------------------------------------------------------------------------

roundLifecycleRouter.post('/:roundId/cancel', requireSession, async (c) => {
  const requestId = c.get('requestId') ?? randomUUID();
  const log = c.get('logger') ?? moduleLogger;
  const player = c.get('player')!;
  const roundId = c.req.param('roundId');

  const uuidErr = uuidValidationError(roundId, requestId);
  if (uuidErr) return c.json(uuidErr, 400);

  try {
    const result = await db.transaction(async (tx) => {
      // Auth FIRST (before state read / existence probing).
      const isOrg = await isEventOrganizer(tx, roundId!, player.id, TENANT_ID);
      if (!isOrg) {
        throw new BusinessRuleError(
          'not_authorized_for_cancel',
          'only the event organizer may cancel',
          403,
        );
      }

      const state = await getRoundState(tx, roundId!, TENANT_ID);
      if (state === null) {
        throw new BusinessRuleError('round_state_missing', 'no round_states row', 422);
      }

      if (state === 'finalized') {
        throw new BusinessRuleError(
          'cannot_cancel_finalized',
          'finalized rounds cannot be cancelled',
          422,
        );
      }
      if (state === 'cancelled') {
        return { kind: 'idempotent' as const };
      }

      await transitionState(tx, roundId!, 'cancelled', player.id, TENANT_ID);
      await emitActivity(tx, {
        type: 'round.cancelled',
        actorPlayerId: player.id,
        scope: { roundId: roundId! },
        payload: {},
      });

      return { kind: 'transitioned' as const };
    });

    return c.json(
      {
        ok: true,
        state: 'cancelled',
        idempotent: result.kind === 'idempotent',
        requestId,
      },
      200,
    );
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
    log.error({ msg: '/cancel threw', requestId, roundId, err: String(err) });
    return c.json(
      { error: 'internal', code: 'cancel_failed', requestId },
      500,
    );
  }
});
