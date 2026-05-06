/**
 * T8-2 GET /api/events/:eventId/activity — paginated activity feed for
 * an Event. Drives T8-2's singleton ActivityFeedProvider on the web,
 * and (future T8-3) the player-home feed.
 *
 * Auth: requireSession + requireEventParticipant (T3-8). Outsiders
 * always 403, never 404.
 *
 * Pagination: opaque compound cursor `base64url({createdAt, id})`.
 * - `?after=<cursor>` → rows strictly newer in ASC order
 * - `?before=<cursor>` → rows strictly older in DESC order
 * - neither → newest 100 in DESC order
 * - both → 400 cursor_params_mutually_exclusive
 *
 * Cursor advancement uses the PHYSICAL last/first row from the SQL
 * result, NOT the surviving decoded count — corrupt rows are filtered
 * from `rows` but still count toward cursor advance, so they aren't
 * re-fetched on every cycle.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { events } from '../db/schema/index.js';
import { logger as moduleLogger } from '../lib/log.js';
import { requireSession } from '../middleware/require-session.js';
import { requireEventParticipant } from '../middleware/require-event-participant.js';
import {
  getActivityPage,
  parseActivityQueryMode,
} from '../services/activity-feed.js';
import { InvalidCursorError } from '../services/activity-cursor.js';

const TENANT_ID = 'guyan';

export const activityRouter = new Hono();

activityRouter.get(
  '/:eventId/activity',
  requireSession,
  requireEventParticipant,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const eventId = c.req.param('eventId');

    if (!eventId) {
      return c.json(
        { error: 'internal', code: 'middleware_misuse_no_event_id', requestId },
        500,
      );
    }

    // Defensive event existence check. In practice this branch is
    // UNREACHABLE for normal traffic: requireEventParticipant runs
    // ahead of the handler and 403s any caller who isn't in a
    // group_members row for the event — including all callers
    // pointing at a non-existent eventId. The check below is kept for
    // parity with events-leaderboard.ts (mirrors that pattern) and as
    // a defense if the participant middleware is ever moved off this
    // route. Integration test "404 when eventId does not exist"
    // therefore asserts 403, not 404 — the test name documents
    // observed behavior, not aspirational behavior. (codex impl-codex
    // round-1 High #2 + Med #4.)
    const eventRow = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.tenantId, TENANT_ID)))
      .limit(1);
    if (eventRow.length === 0) {
      return c.json({ error: 'not_found', code: 'event_not_found', requestId }, 404);
    }

    const afterParam = c.req.query('after');
    const beforeParam = c.req.query('before');

    // Mode parse can throw InvalidCursorError on malformed cursor.
    let mode;
    try {
      mode = parseActivityQueryMode({ afterParam, beforeParam });
    } catch (err) {
      if (err instanceof InvalidCursorError) {
        return c.json(
          { error: 'bad_request', code: 'invalid_cursor', requestId },
          400,
        );
      }
      throw err;
    }

    if (mode.kind === 'both') {
      return c.json(
        {
          error: 'bad_request',
          code: 'cursor_params_mutually_exclusive',
          requestId,
        },
        400,
      );
    }

    const response = await getActivityPage(db, eventId, mode, log);
    return c.json(response, 200);
  },
);
