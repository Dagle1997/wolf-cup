/**
 * T7-5 GET /api/events/:eventId/export/raw — organizer-only event archive.
 *
 * Auth chain: requireSession → requireOrganizer.
 *
 * `requireEventParticipant` is intentionally NOT in the chain — an organizer
 * running an event they're not playing in should still be able to export it.
 * This matches admin-events / admin-rule-sets posture.
 *
 * Auth-vs-existence resolution order: 401 (anonymous) < 403 (not organizer)
 * < 404 (event not found). Only an authenticated organizer asking for a
 * non-existent eventId sees 404 — acceptable since organizers are presumed
 * to know which events exist.
 *
 * Single-shot JSON.stringify is fine at v1 trip-scale (low MB worst case).
 * Streaming is followup T7-5c.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { logger as moduleLogger } from '../lib/log.js';
import { requireSession } from '../middleware/require-session.js';
import { requireOrganizer } from '../middleware/require-organizer.js';
import {
  buildEventExport,
  exportFilename,
} from '../services/export.js';

const TENANT_ID = 'guyan';

export const exportRouter = new Hono();

exportRouter.get(
  '/:eventId/export/raw',
  requireSession,
  requireOrganizer,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const eventId = c.req.param('eventId')!;

    try {
      const payload = await buildEventExport(db, eventId, TENANT_ID);

      if (payload === null) {
        return c.json({ error: 'event_not_found', requestId }, 404);
      }

      // Filename construction inside the try/catch: `exportFilename` calls
      // `Intl.DateTimeFormat` which throws RangeError on a malformed
      // timezone string. A misconfigured event row would otherwise leak a
      // 500 with an uncaught exception (codex impl-round-1 High #1).
      const filename = exportFilename(
        String(payload.event['name'] ?? ''),
        String(payload.event['timezone'] ?? 'UTC'),
      );

      c.header('Content-Type', 'application/json');
      c.header('Content-Disposition', `attachment; filename="${filename}"`);
      c.header('Cache-Control', 'no-store');

      return c.body(JSON.stringify(payload));
    } catch (err) {
      log.error({
        msg: 'GET /export/raw threw',
        requestId,
        eventId,
        err: String(err),
      });
      return c.json(
        { error: 'internal', code: 'export_failed', requestId },
        500,
      );
    }
  },
);
