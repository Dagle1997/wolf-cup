/**
 * "The Action" PLAYER-facing router (participant-scoped, event-scoped).
 *
 *   POST /api/events/:eventId/action-bets   — a participant posts their own bet.
 *   GET  /api/events/:eventId/action-board   — the public board, visibility-bounded.
 *
 * This is the player self-serve counterpart to the organizer's admin-event-bets
 * router. Auth is requireSession + requireEventParticipant (any verified event
 * member), NOT requireOrganizer.
 *
 * CREATE guardrail: a self-serve creator MUST be one of the two stakeholders
 * (createActionBet's `requireActorIsStakeholder`), so a participant can never
 * unilaterally commit only OTHER players' money — they have to have skin in the
 * bet. All other validation (FR9/FR49/FR50, whole-dollar, scope) is the SAME
 * createActionBet path the organizer uses; the player path adds no override.
 *
 * BOARD: `listVisibleBetsForViewer` returns 'event_wide' bets to everyone +
 * 'stakeholders_only' bets only to their stakeholders (the organizer sees all).
 * A stakeholders_only bet's matchup is never serialized to a non-stakeholder.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { eventRounds, groupMembers, groups, players } from '../db/schema/index.js';
import { requireSession } from '../middleware/require-session.js';
import { requireEventParticipant } from '../middleware/require-event-participant.js';
import { isEventOrganizerByEventId } from '../services/index.js';
import { actionBetCreateSchema, createActionBet, BetWriteError } from '../services/bets-write.js';
import { listVisibleBetsForViewer } from '../services/bets-query.js';

export const eventsActionBetsRouter = new Hono();
const TENANT_ID = 'guyan';
const BODY_LIMIT = 8 * 1024;

function errorLabelFor(status: number): string {
  switch (status) {
    case 400:
      return 'bad_request';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    default:
      return 'unprocessable';
  }
}

// GET — options a participant needs to compose a bet: the event roster (who you
// can bet on / back) + the rounds (which round the bet binds to). Read-only,
// participant-gated; roster names + round numbers are already visible on the
// leaderboard, so nothing sensitive is exposed here.
eventsActionBetsRouter.get(
  '/:eventId/bet-options',
  requireSession,
  requireEventParticipant,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger');
    const eventId = c.req.param('eventId')!;
    try {
      const groupRows = await db
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.eventId, eventId), eq(groups.tenantId, TENANT_ID)));
      const groupIds = groupRows.map((g) => g.id);
      const roster =
        groupIds.length === 0
          ? []
          : await db
              .selectDistinct({ playerId: players.id, name: players.name })
              .from(groupMembers)
              .innerJoin(players, eq(groupMembers.playerId, players.id))
              .where(
                and(
                  inArray(groupMembers.groupId, groupIds),
                  eq(groupMembers.tenantId, TENANT_ID),
                  eq(players.tenantId, TENANT_ID),
                ),
              )
              .orderBy(asc(players.name));
      const rounds = await db
        .select({ eventRoundId: eventRounds.id, roundNumber: eventRounds.roundNumber })
        .from(eventRounds)
        .where(and(eq(eventRounds.eventId, eventId), eq(eventRounds.tenantId, TENANT_ID)))
        .orderBy(asc(eventRounds.roundNumber));
      c.header('cache-control', 'no-store');
      return c.json({ roster, rounds, requestId }, 200);
    } catch (err) {
      log?.error({ msg: 'GET bet-options threw', requestId, eventId, err: String(err) });
      return c.json({ error: 'internal', code: 'bet_options_failed', requestId }, 500);
    }
  },
);

// GET — the public Action board for this viewer (visibility-bounded).
eventsActionBetsRouter.get(
  '/:eventId/action-board',
  requireSession,
  requireEventParticipant,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger');
    const eventId = c.req.param('eventId')!;
    const player = c.get('player')!;

    try {
      const isOrganizer = await isEventOrganizerByEventId(db, eventId, player.id, TENANT_ID);
      const bets = await listVisibleBetsForViewer(db, eventId, player.id, isOrganizer, TENANT_ID);
      c.header('cache-control', 'no-store');
      return c.json({ bets, viewerId: player.id, requestId }, 200);
    } catch (err) {
      log?.error({ msg: 'GET action-board threw', requestId, eventId, err: String(err) });
      return c.json({ error: 'internal', code: 'action_board_failed', requestId }, 500);
    }
  },
);

// POST — a participant posts their own action bet (must be a stakeholder).
eventsActionBetsRouter.post(
  '/:eventId/action-bets',
  requireSession,
  requireEventParticipant,
  bodyLimit({
    maxSize: BODY_LIMIT,
    onError: (c) =>
      c.json({ error: 'bad_request', code: 'body_too_large', requestId: c.get('requestId') }, 400),
  }),
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger');
    const eventId = c.req.param('eventId')!;
    const player = c.get('player')!;

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'bad_request', code: 'malformed_json', requestId }, 400);
    }
    // Players use the SAME bet params as the organizer, minus the FR49 override
    // (a participant can't bet after scores exist on the segment).
    const parsed = actionBetCreateSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { error: 'validation_error', code: 'invalid_body', issues: parsed.error.issues, requestId },
        400,
      );
    }

    let betId: string;
    try {
      betId = await db.transaction((tx) =>
        createActionBet(tx, {
          eventId,
          actorPlayerId: player.id,
          input: parsed.data,
          requireActorIsStakeholder: true,
        }),
      );
    } catch (err) {
      if (err instanceof BetWriteError) {
        return c.json({ error: errorLabelFor(err.status), code: err.code, requestId }, err.status);
      }
      log?.error({ msg: 'POST action-bets threw', requestId, eventId, err: String(err) });
      return c.json({ error: 'internal', code: 'bet_create_failed', requestId }, 500);
    }

    return c.json({ ok: true, betId, requestId }, 200);
  },
);
