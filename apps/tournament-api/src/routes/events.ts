/**
 * T7-1 events route — minimal event-detail endpoint for home page.
 *
 * Mount: `app.route('/api/events', eventsRouter)`. Effective URL:
 *   GET /api/events/:eventId
 *
 * Auth chain: `requireSession` → `requireEventParticipant`. Malformed
 * or unknown :eventId returns 403 from the participant middleware
 * (no-existence-leak invariant — the SQL predicate evaluates to "not a
 * participant" for both cases).
 *
 * Returns event metadata + rounds list (ordered by round_number) for the
 * Event home page hero/countdown/entry-cards UI. No money, no scores,
 * no bets — those have dedicated routes.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { eventRounds, events } from '../db/schema/index.js';
import { logger as moduleLogger } from '../lib/log.js';
import { requireSession } from '../middleware/require-session.js';
import { requireEventParticipant } from '../middleware/require-event-participant.js';

const TENANT_ID = 'guyan';

export const eventsRouter = new Hono();

eventsRouter.get(
  '/:eventId',
  requireSession,
  requireEventParticipant,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const eventId = c.req.param('eventId')!;

    try {
      const eventRows = await db
        .select({
          id: events.id,
          name: events.name,
          startDate: events.startDate,
          endDate: events.endDate,
          timezone: events.timezone,
        })
        .from(events)
        .where(and(eq(events.id, eventId), eq(events.tenantId, TENANT_ID)))
        .limit(1);

      // Defense-in-depth: middleware already returned 403 for unknown
      // eventId, but if a participant row exists for an event that was
      // hard-deleted, the join would still pass. Treat as 403 no-existence-leak.
      if (eventRows.length === 0) {
        return c.json(
          { error: 'forbidden', code: 'not_event_participant', requestId },
          403,
        );
      }

      const roundRows = await db
        .select({
          id: eventRounds.id,
          roundNumber: eventRounds.roundNumber,
          roundDate: eventRounds.roundDate,
          holesToPlay: eventRounds.holesToPlay,
        })
        .from(eventRounds)
        .where(
          and(
            eq(eventRounds.eventId, eventId),
            eq(eventRounds.tenantId, TENANT_ID),
          ),
        )
        .orderBy(asc(eventRounds.roundNumber));

      c.header('cache-control', 'no-store');
      return c.json(
        {
          event: eventRows[0]!,
          rounds: roundRows,
        },
        200,
      );
    } catch (err) {
      log.error({
        msg: 'GET /events/:eventId threw',
        requestId,
        eventId,
        err: String(err),
      });
      return c.json(
        { error: 'internal', code: 'event_get_failed', requestId },
        500,
      );
    }
  },
);
