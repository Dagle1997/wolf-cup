/**
 * T6-3 cross-foursome individual-bets route.
 *
 * Mount: `app.route('/api/events', betsRouter)`. Effective URL:
 *   POST /api/events/:eventId/bets
 *
 * Auth chain (T3-8): `requireSession` → `requireEventParticipant`.
 * Malformed/nonexistent `:eventId` returns 403 from the participant
 * middleware (no-existence-leak invariant).
 *
 * Validation order (per T6-3 spec Section 6):
 *   1. Body Zod parse → 400 invalid_body / malformed_json.
 *   2. db.transaction:
 *      (i)   playerAId !== playerBId → 400 self_bet_not_allowed.
 *      (ii)  Both players in event's group_members → 422 players_not_in_event.
 *      (iii) Normalize (playerAId, playerBId) to canonical alphabetical order.
 *      (iv)  applicableRoundIds dedupe → 400 duplicate_applicable_round_ids.
 *            Then verify all belong to this event → 422 round_not_in_event.
 *      (v)   For match_play_with_auto_press: validate config shape → 400 invalid_config.
 *      (vi)  INSERT individual_bets row; UNIQUE catch → 422 duplicate_bet.
 *      (vii) INSERT N rows in individual_bet_rounds.
 *      (viii) writeAudit BET_CREATED.
 *      (ix)  emitActivity 'bet.created'.
 *   3. Return 200 { ok, betId, requestId }.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  eventRounds,
  groupMembers,
  groups,
  individualBets,
  individualBetRounds,
} from '../db/schema/index.js';
import { logger as moduleLogger } from '../lib/log.js';
import { requireSession } from '../middleware/require-session.js';
import { requireEventParticipant } from '../middleware/require-event-participant.js';
import {
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
  writeAudit,
} from '../lib/audit-log.js';
import { emitActivity } from '../lib/activity.js';

const TENANT_ID = 'guyan';
const SQLITE_UNIQUE_RAW_CODE = 2067;

function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; rawCode?: unknown; cause?: unknown };
  if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
  if (e.rawCode === SQLITE_UNIQUE_RAW_CODE) return true;
  if (e.cause && typeof e.cause === 'object') {
    return isUniqueConstraintError(e.cause);
  }
  return false;
}

const matchPlayPerHoleConfigSchema = z.object({}).strict();
const matchPlayWithAutoPressConfigSchema = z.object({
  autoPressTriggerAtNDown: z.number().int().min(1).max(18),
  pressMultiplier: z.number().int().min(1),
}).strict();

const betBodySchema = z
  .object({
    playerAId: z.string().uuid(),
    playerBId: z.string().uuid(),
    betType: z.enum(['match_play_per_hole', 'match_play_with_auto_press']),
    stakePerHoleCents: z.number().int().min(1),
    applicableRoundIds: z.array(z.string().uuid()).min(1),
    config: z.unknown(),
  });

class BusinessError extends Error {
  readonly code: string;
  readonly status: 400 | 422;
  constructor(code: string, message: string, status: 400 | 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const betsRouter = new Hono();

betsRouter.post(
  '/:eventId/bets',
  requireSession,
  requireEventParticipant,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const player = c.get('player')!;
    const eventId = c.req.param('eventId');

    // Body parse + Zod.
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json(
        { error: 'bad_request', code: 'malformed_json', requestId },
        400,
      );
    }
    const parsed = betBodySchema.safeParse(rawBody);
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

    let betId: string;
    try {
      betId = await db.transaction(async (tx) => {
        // (i) Self-bet check.
        if (body.playerAId === body.playerBId) {
          throw new BusinessError(
            'self_bet_not_allowed',
            'a player cannot bet against themself',
            400,
          );
        }

        // (ii) Both players are participants of this event.
        const memberRows = await tx
          .select({ playerId: groupMembers.playerId })
          .from(groupMembers)
          .innerJoin(groups, eq(groupMembers.groupId, groups.id))
          .where(
            and(
              eq(groups.eventId, eventId),
              inArray(groupMembers.playerId, [body.playerAId, body.playerBId]),
              eq(groups.tenantId, TENANT_ID),
              eq(groupMembers.tenantId, TENANT_ID),
            ),
          );
        const memberIds = new Set(memberRows.map((r) => r.playerId));
        if (!memberIds.has(body.playerAId) || !memberIds.has(body.playerBId)) {
          throw new BusinessError(
            'players_not_in_event',
            'one or both players are not participants of this event',
            422,
          );
        }

        // (iii) Canonical alphabetical order.
        const [a, b] =
          body.playerAId < body.playerBId
            ? [body.playerAId, body.playerBId]
            : [body.playerBId, body.playerAId];

        // (iv) applicableRoundIds dedupe + scope check.
        const seen = new Set<string>();
        for (const rid of body.applicableRoundIds) {
          if (seen.has(rid)) {
            throw new BusinessError(
              'duplicate_applicable_round_ids',
              `duplicate applicableRoundId ${rid}`,
              400,
            );
          }
          seen.add(rid);
        }
        const eventRoundRows = await tx
          .select({ id: eventRounds.id })
          .from(eventRounds)
          .where(
            and(
              inArray(eventRounds.id, body.applicableRoundIds),
              eq(eventRounds.eventId, eventId),
              eq(eventRounds.tenantId, TENANT_ID),
            ),
          );
        const validIds = new Set(eventRoundRows.map((r) => r.id));
        for (const rid of body.applicableRoundIds) {
          if (!validIds.has(rid)) {
            throw new BusinessError(
              'round_not_in_event',
              `applicableRoundId ${rid} does not belong to event ${eventId}`,
              422,
            );
          }
        }

        // (v) Config shape per betType.
        let validatedConfig: Record<string, unknown>;
        if (body.betType === 'match_play_per_hole') {
          // Strict empty-object check; null/undefined are rejected explicitly
          // (don't coalesce — that would silently accept malformed bodies).
          const cfgParse = matchPlayPerHoleConfigSchema.safeParse(body.config);
          if (!cfgParse.success) {
            throw new BusinessError(
              'invalid_config',
              'config must be an empty object {} for match_play_per_hole',
              400,
            );
          }
          validatedConfig = cfgParse.data;
        } else {
          const cfgParse = matchPlayWithAutoPressConfigSchema.safeParse(body.config);
          if (!cfgParse.success) {
            throw new BusinessError(
              'invalid_config',
              'config required: { autoPressTriggerAtNDown, pressMultiplier }',
              400,
            );
          }
          validatedConfig = cfgParse.data;
        }

        // (vi) INSERT individual_bets row.
        const newBetId = randomUUID();
        const now = Date.now();
        const ctx = `event:${eventId}`;
        try {
          await tx.insert(individualBets).values({
            id: newBetId,
            eventId,
            playerAId: a,
            playerBId: b,
            betType: body.betType,
            stakePerHoleCents: body.stakePerHoleCents,
            configJson: JSON.stringify(validatedConfig),
            createdByPlayerId: player.id,
            createdAt: now,
            tenantId: TENANT_ID,
            contextId: ctx,
          });
        } catch (err) {
          if (isUniqueConstraintError(err)) {
            throw new BusinessError(
              'duplicate_bet',
              'a bet with the same (event, players, bet_type) already exists',
              422,
            );
          }
          throw err;
        }

        // (vii) INSERT bet_rounds rows.
        for (const rid of body.applicableRoundIds) {
          await tx.insert(individualBetRounds).values({
            betId: newBetId,
            eventRoundId: rid,
            tenantId: TENANT_ID,
            contextId: ctx,
          });
        }

        // (viii) Audit row.
        await writeAudit(tx, {
          eventType: AUDIT_EVENT_TYPES.BET_CREATED,
          entityType: AUDIT_ENTITY_TYPES.BET,
          entityId: newBetId,
          actorPlayerId: player.id,
          payload: {
            eventId,
            betId: newBetId,
            playerAId: a,
            playerBId: b,
            betType: body.betType,
            stakePerHoleCents: body.stakePerHoleCents,
            applicableRoundIds: body.applicableRoundIds,
            config: validatedConfig,
            createdByPlayerId: player.id,
          },
        });

        // (ix) Activity emit (NO-OP per T8).
        await emitActivity(tx, {
          type: 'bet.created',
          actorPlayerId: player.id,
          scope: { eventId },
          payload: {
            betId: newBetId,
            playerAId: a,
            playerBId: b,
            betType: body.betType,
            stakePerHoleCents: body.stakePerHoleCents,
          },
        });

        return newBetId;
      });
    } catch (err) {
      if (err instanceof BusinessError) {
        return c.json(
          {
            error: err.status === 400 ? 'bad_request' : 'unprocessable',
            code: err.code,
            requestId,
          },
          err.status,
        );
      }
      log.error({
        msg: 'POST /bets threw',
        requestId,
        eventId,
        err: String(err),
      });
      return c.json(
        { error: 'internal', code: 'bet_create_failed', requestId },
        500,
      );
    }

    return c.json({ ok: true, betId, requestId }, 200);
  },
);
