/**
 * T6-5 GET /api/events/:eventId/money — head-to-head money matrix.
 *
 * Auth chain: requireSession → requireEventParticipant.
 * Malformed/nonexistent eventId returns 403 from middleware (no-existence-leak).
 *
 * Calls services/money.ts computeMoneyMatrix; returns the MoneyMatrix payload.
 * Sets cache-control: no-store header per spec AC-5.
 *
 * Read-only: no audit, no activity, no DB writes.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { logger as moduleLogger } from '../lib/log.js';
import { requireSession } from '../middleware/require-session.js';
import { requireEventParticipant } from '../middleware/require-event-participant.js';
import { computeMoneyMatrix } from '../services/money.js';

const TENANT_ID = 'guyan';

export const moneyRouter = new Hono();

moneyRouter.get(
  '/:eventId/money',
  requireSession,
  requireEventParticipant,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const player = c.get('player')!;
    const eventId = c.req.param('eventId');

    try {
      const matrix = await computeMoneyMatrix(db, eventId, player.id, TENANT_ID);
      c.header('cache-control', 'no-store');
      return c.json(matrix, 200);
    } catch (err) {
      log.error({
        msg: 'GET /money threw',
        requestId,
        eventId,
        err: String(err),
      });
      return c.json(
        { error: 'internal', code: 'money_compute_failed', requestId },
        500,
      );
    }
  },
);
