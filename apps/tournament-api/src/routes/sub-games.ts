/**
 * T6-13 sub-game compute route.
 *
 * Mount: app.route('/api/rounds', subGamesComputeRouter). Effective URL:
 *   POST /api/rounds/:roundId/sub-games/:subGameId/compute
 *
 * Auth chain: requireSession + handler-internal event-participant check
 * (the route is mounted under /api/rounds but the participant check
 * goes through the round's event_id since requireEventParticipant only
 * works on /:eventId routes).
 *
 * Per epic AC: gated by `require-event-participant`. Implementation
 * inlines the check via the round's eventId since the route is on
 * /api/rounds (no :eventId segment).
 *
 * Audit + activity emitted on successful compute. Stub types return 501.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  groupMembers,
  groups,
  rounds,
  subGames,
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
} from '../services/round-state.js';
import { computeSubGame } from '../services/sub-games.js';

const TENANT_ID = 'guyan';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const subGamesComputeRouter = new Hono();

subGamesComputeRouter.post(
  '/:roundId/sub-games/:subGameId/compute',
  requireSession,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const player = c.get('player')!;
    const roundId = c.req.param('roundId');
    const subGameId = c.req.param('subGameId');

    if (!roundId || !UUID_RE.test(roundId)) {
      return c.json({ error: 'bad_request', code: 'invalid_round_id', requestId }, 400);
    }
    if (!subGameId || !UUID_RE.test(subGameId)) {
      return c.json({ error: 'bad_request', code: 'invalid_sub_game_id', requestId }, 400);
    }

    try {
      const result = await db.transaction(async (tx) => {
        // Auth: caller must be a participant of the round's event.
        const roundRows = await tx
          .select({ id: rounds.id, eventId: rounds.eventId, contextId: rounds.contextId })
          .from(rounds)
          .where(and(eq(rounds.id, roundId), eq(rounds.tenantId, TENANT_ID)))
          .limit(1);
        if (roundRows.length === 0 || roundRows[0]!.eventId === null) {
          // No-existence-leak: 403 instead of 404 for nonexistent round.
          throw new BusinessRuleError(
            'not_event_participant',
            'caller is not a participant of this event',
            403,
          );
        }
        const round = roundRows[0]!;

        const memberRows = await tx
          .select({ playerId: groupMembers.playerId })
          .from(groupMembers)
          .innerJoin(groups, eq(groups.id, groupMembers.groupId))
          .where(
            and(
              eq(groups.eventId, round.eventId!),
              eq(groupMembers.playerId, player.id),
              eq(groups.tenantId, TENANT_ID),
              eq(groupMembers.tenantId, TENANT_ID),
            ),
          )
          .limit(1);
        if (memberRows.length === 0) {
          throw new BusinessRuleError(
            'not_event_participant',
            'caller is not a participant of this event',
            403,
          );
        }

        // Verify the sub-game belongs to this round's event_round.
        const subGameRows = await tx
          .select({ eventRoundId: subGames.eventRoundId })
          .from(subGames)
          .where(
            and(
              eq(subGames.id, subGameId),
              eq(subGames.tenantId, TENANT_ID),
            ),
          )
          .limit(1);
        if (subGameRows.length === 0) {
          throw new BusinessRuleError('subgame_not_found', 'sub-game not found', 404);
        }
        // Cross-check: the sub-game's eventRoundId must match the round's eventRoundId.
        const eventRoundCheck = await tx
          .select({ eventRoundId: rounds.eventRoundId })
          .from(rounds)
          .where(eq(rounds.id, roundId))
          .limit(1);
        if (
          eventRoundCheck.length === 0 ||
          eventRoundCheck[0]!.eventRoundId !== subGameRows[0]!.eventRoundId
        ) {
          throw new BusinessRuleError(
            'subgame_not_in_round',
            'sub-game does not belong to this round',
            422,
          );
        }

        // Compute.
        const computeResult = await computeSubGame(tx, subGameId, player.id, TENANT_ID);

        // Audit.
        await writeAudit(tx, {
          eventType: AUDIT_EVENT_TYPES.SUBGAME_COMPUTED,
          entityType: AUDIT_ENTITY_TYPES.SUBGAME,
          entityId: subGameId,
          actorPlayerId: player.id,
          payload: {
            roundId,
            subGameId,
            subGameResultId: computeResult.subGameResultId,
            totalPotCents: computeResult.totalPotCents,
          },
        });

        // Activity.
        await emitActivity(tx, {
          type: 'subgame.computed',
          actorPlayerId: player.id,
          scope: { roundId, eventId: round.eventId! },
          payload: {
            subGameId,
            subGameResultId: computeResult.subGameResultId,
            totalPotCents: computeResult.totalPotCents,
          },
        });

        return computeResult;
      });

      return c.json(
        {
          ok: true,
          subGameResultId: result.subGameResultId,
          totalPotCents: result.totalPotCents,
          requestId,
        },
        200,
      );
    } catch (err) {
      if (err instanceof BusinessRuleError) {
        const status = err.status as 400 | 403 | 404 | 422 | 501;
        const errorLabel =
          status === 403
            ? 'forbidden'
            : status === 404
              ? 'not_found'
              : status === 501
                ? 'not_implemented'
                : 'unprocessable';
        return c.json({ error: errorLabel, code: err.code, requestId }, status);
      }
      log.error({ msg: 'POST /sub-games/compute threw', requestId, err: String(err) });
      return c.json(
        { error: 'internal', code: 'subgame_compute_failed', requestId },
        500,
      );
    }
  },
);
