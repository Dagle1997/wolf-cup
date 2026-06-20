/**
 * "The Action" admin betting router (organizer-scoped, event-scoped).
 *
 *   POST  /api/admin/events/:eventId/bets             — create one action bet.
 *   GET   /api/admin/events/:eventId/bets             — list this event's bets
 *                                                       with each derived state.
 *   PATCH /api/admin/events/:eventId/bets/:betId      — edit a live bet's params
 *                                                       (Story 1.4; recompute
 *                                                       on read reflects it).
 *   POST  /api/admin/events/:eventId/bets/:betId/void — void a live bet (Story
 *                                                       1.4; drops out of
 *                                                       settle-up, audit kept).
 *
 * Auth: requireSession + requireOrganizer (global gate), then per-handler
 * isEventOrganizerByEventId (the multi-organizer model) — `false` → 403,
 * covering both "not this event's organizer" and "no such event" (no
 * existence leak), mirroring admin-event-handicaps.ts.
 *
 * Each mutation runs in a single db.transaction so the bet + sides + audit +
 * activity rows commit atomically (P9). The pure settlement math is never
 * touched here — settlement is recompute-on-read in bets-query.ts.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireSession } from '../middleware/require-session.js';
import { requireOrganizer } from '../middleware/require-organizer.js';
import { isEventOrganizerByEventId } from '../services/index.js';
import {
  actionBetCreateSchema,
  actionBetEditSchema,
  createActionBet,
  editActionBet,
  voidActionBet,
  BetWriteError,
} from '../services/bets-write.js';
import { listBetsForEvent } from '../services/bets-query.js';

export const adminEventBetsRouter = new Hono();
const TENANT_ID = 'guyan';
const BODY_LIMIT = 8 * 1024;

// FR49 admin override flag, accepted alongside the bet params on CREATE (a new
// bet after scoring started). Edits need no override — the organizer may correct
// a bet anytime (audited + UI-confirmed), so the edit body is the bare params.
const createBodySchema = actionBetCreateSchema.extend({ override: z.boolean().optional() });
const editBodySchema = actionBetEditSchema;

/** Map a BetWriteError status to a stable top-level error label. */
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

adminEventBetsRouter.use('/events/:eventId/bets', requireSession, requireOrganizer);
adminEventBetsRouter.use('/events/:eventId/bets/*', requireSession, requireOrganizer);

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
    const parsed = createBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { error: 'validation_error', code: 'invalid_body', issues: parsed.error.issues, requestId },
        400,
      );
    }
    const { override, ...input } = parsed.data;

    let betId: string;
    try {
      betId = await db.transaction((tx) =>
        createActionBet(tx, { eventId, actorPlayerId: player.id, input, override: override ?? false }),
      );
    } catch (err) {
      if (err instanceof BetWriteError) {
        return c.json({ error: errorLabelFor(err.status), code: err.code, requestId }, err.status);
      }
      log?.error({ msg: 'POST admin bets threw', requestId, eventId, err: String(err) });
      return c.json({ error: 'internal', code: 'bet_create_failed', requestId }, 500);
    }

    return c.json({ ok: true, betId, requestId }, 200);
  },
);

// PATCH — edit a live bet's parameters (Story 1.4).
adminEventBetsRouter.patch(
  '/events/:eventId/bets/:betId',
  bodyLimit({
    maxSize: BODY_LIMIT,
    onError: (c) =>
      c.json({ error: 'bad_request', code: 'body_too_large', requestId: c.get('requestId') }, 400),
  }),
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger');
    const eventId = c.req.param('eventId');
    const betId = c.req.param('betId');
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
    const parsed = editBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { error: 'validation_error', code: 'invalid_body', issues: parsed.error.issues, requestId },
        400,
      );
    }

    try {
      await db.transaction((tx) =>
        editActionBet(tx, { eventId, actorPlayerId: player.id, betId, input: parsed.data }),
      );
    } catch (err) {
      if (err instanceof BetWriteError) {
        return c.json({ error: errorLabelFor(err.status), code: err.code, requestId }, err.status);
      }
      log?.error({ msg: 'PATCH admin bets threw', requestId, eventId, betId, err: String(err) });
      return c.json({ error: 'internal', code: 'bet_edit_failed', requestId }, 500);
    }

    return c.json({ ok: true, betId, requestId }, 200);
  },
);

// POST .../void — void a live bet (Story 1.4). No body required.
adminEventBetsRouter.post('/events/:eventId/bets/:betId/void', async (c) => {
  const requestId = c.get('requestId') ?? randomUUID();
  const log = c.get('logger');
  const eventId = c.req.param('eventId');
  const betId = c.req.param('betId');
  const player = c.get('player')!;

  if (!(await isEventOrganizerByEventId(db, eventId, player.id, TENANT_ID))) {
    return c.json({ error: 'forbidden', code: 'not_event_organizer', requestId }, 403);
  }

  try {
    await db.transaction((tx) =>
      voidActionBet(tx, { eventId, actorPlayerId: player.id, betId }),
    );
  } catch (err) {
    if (err instanceof BetWriteError) {
      return c.json({ error: errorLabelFor(err.status), code: err.code, requestId }, err.status);
    }
    log?.error({ msg: 'POST admin bet void threw', requestId, eventId, betId, err: String(err) });
    return c.json({ error: 'internal', code: 'bet_void_failed', requestId }, 500);
  }

  return c.json({ ok: true, betId, requestId }, 200);
});
