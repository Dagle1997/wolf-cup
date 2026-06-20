/**
 * "The Action" admin betting router (organizer-scoped, event-scoped).
 *
 *   POST /api/admin/events/:eventId/bets  — create one action bet (Story 1.1:
 *                                            h2h, net basis).
 *   GET  /api/admin/events/:eventId/bets  — list this event's action bets with
 *                                            each bet's derived state.
 *
 * Auth: requireSession + requireOrganizer (global gate), then per-handler
 * isEventOrganizerByEventId (the multi-organizer model) — `false` → 403,
 * covering both "not this event's organizer" and "no such event" (no
 * existence leak), mirroring admin-event-handicaps.ts.
 *
 * Creation runs in a single db.transaction so the bet + sides + audit +
 * activity rows commit atomically (P9). The pure settlement math is never
 * touched here — settlement is recompute-on-read in bets-query.ts.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { db } from '../db/index.js';
import { requireSession } from '../middleware/require-session.js';
import { requireOrganizer } from '../middleware/require-organizer.js';
import { isEventOrganizerByEventId } from '../services/index.js';
import {
  actionBetCreateSchema,
  createActionBet,
  BetWriteError,
} from '../services/bets-write.js';
import { listBetsForEvent } from '../services/bets-query.js';

export const adminEventBetsRouter = new Hono();
const TENANT_ID = 'guyan';
const BODY_LIMIT = 8 * 1024;

adminEventBetsRouter.use('/events/:eventId/bets', requireSession, requireOrganizer);

// GET — list this event's action bets with derived state.
adminEventBetsRouter.get('/events/:eventId/bets', async (c) => {
  const requestId = c.get('requestId') ?? randomUUID();
  const log = c.get('logger');
  const eventId = c.req.param('eventId');
  const player = c.get('player')!;

  if (!(await isEventOrganizerByEventId(db, eventId, player.id, TENANT_ID))) {
    return c.json({ error: 'forbidden', code: 'not_event_organizer', requestId }, 403);
  }

  try {
    const bets = await listBetsForEvent(db, eventId, TENANT_ID);
    c.header('cache-control', 'no-store');
    return c.json({ bets, requestId }, 200);
  } catch (err) {
    log?.error({ msg: 'GET admin bets threw', requestId, eventId, err: String(err) });
    return c.json({ error: 'internal', code: 'bets_list_failed', requestId }, 500);
  }
});

// POST — create one action bet.
adminEventBetsRouter.post(
  '/events/:eventId/bets',
  bodyLimit({
    maxSize: BODY_LIMIT,
    onError: (c) =>
      c.json({ error: 'bad_request', code: 'body_too_large', requestId: c.get('requestId') }, 400),
  }),
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger');
    const eventId = c.req.param('eventId');
    const player = c.get('player')!;

    if (!(await isEventOrganizerByEventId(db, eventId, player.id, TENANT_ID))) {
      return c.json({ error: 'forbidden', code: 'not_event_organizer', requestId }, 403);
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'bad_request', code: 'malformed_json', requestId }, 400);
    }
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
        createActionBet(tx, { eventId, actorPlayerId: player.id, input: parsed.data }),
      );
    } catch (err) {
      if (err instanceof BetWriteError) {
        return c.json(
          {
            error: err.status === 400 ? 'bad_request' : 'unprocessable',
            code: err.code,
            requestId,
          },
          err.status,
        );
      }
      log?.error({ msg: 'POST admin bets threw', requestId, eventId, err: String(err) });
      return c.json({ error: 'internal', code: 'bet_create_failed', requestId }, 500);
    }

    return c.json({ ok: true, betId, requestId }, 200);
  },
);
