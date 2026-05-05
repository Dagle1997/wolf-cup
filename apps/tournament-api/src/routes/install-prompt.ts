/**
 * T7-6 in-app install prompt — POST endpoint to stamp
 * `device_bindings.install_prompt_shown_at` once per (player, device).
 *
 * Effective URL: POST /api/events/:eventId/devices/me/install-prompt-shown
 *
 * Auth chain: requireSession only. NOT requireEventParticipant — :eventId is
 * audit-payload-only; a spectator browsing a read-only event should still
 * be able to stamp their own device.
 *
 * Atomicity: a single conditional UPDATE inside db.transaction; the audit
 * row is only written when the UPDATE actually flipped the column from
 * NULL to now() (codex spec round-1 High #1). Concurrent POSTs cannot
 * produce duplicate audit rows.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { logger as moduleLogger } from '../lib/log.js';
import { deviceBindings } from '../db/schema/index.js';
import {
  writeAudit,
  AUDIT_EVENT_TYPES,
  AUDIT_ENTITY_TYPES,
} from '../lib/audit-log.js';
import { requireSession } from '../middleware/require-session.js';

const TENANT_ID = 'guyan';
const DEVICE_COOKIE_NAME = 'tournament_device_id';

// Cookie value shape guard (UUID-shape lite — same as require-session.ts:40).
const COOKIE_SHAPE_RE = /^[A-Za-z0-9_-]+$/;
const COOKIE_MIN = 16;
const COOKIE_MAX = 128;

// :eventId shape guard (defense-in-depth; eventId is audit-payload only).
const EVENT_ID_SHAPE_RE = /^[A-Za-z0-9_-]+$/;
const EVENT_ID_MIN = 16;
const EVENT_ID_MAX = 128;

function extractCookie(header: string, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const value = trimmed.slice(eq + 1);
    return value.length === 0 ? null : value;
  }
  return null;
}

export const installPromptRouter = new Hono();

installPromptRouter.post(
  '/:eventId/devices/me/install-prompt-shown',
  requireSession,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const player = c.get('player')!;
    const eventId = c.req.param('eventId') ?? '';

    // :eventId shape guard.
    if (
      eventId.length < EVENT_ID_MIN ||
      eventId.length > EVENT_ID_MAX ||
      !EVENT_ID_SHAPE_RE.test(eventId)
    ) {
      return c.json({ error: 'invalid_event_id', requestId }, 400);
    }

    // Read + validate device cookie.
    const cookieHeader = c.req.header('cookie') ?? '';
    const deviceId = extractCookie(cookieHeader, DEVICE_COOKIE_NAME);
    if (
      deviceId === null ||
      deviceId.length < COOKIE_MIN ||
      deviceId.length > COOKIE_MAX ||
      !COOKIE_SHAPE_RE.test(deviceId)
    ) {
      return c.json({ error: 'device_binding_not_found', requestId }, 404);
    }

    try {
      await db.transaction(async (tx) => {
        // Atomic conditional UPDATE: only flip NULL → now(); player-scoped to
        // prevent cross-player cookie reuse (codex spec round-1 High #1).
        const stamped = await tx
          .update(deviceBindings)
          .set({ installPromptShownAt: Date.now() })
          .where(
            and(
              eq(deviceBindings.id, deviceId),
              eq(deviceBindings.playerId, player.id),
              eq(deviceBindings.tenantId, TENANT_ID),
              isNull(deviceBindings.installPromptShownAt),
            ),
          )
          .returning({ id: deviceBindings.id });

        if (stamped.length === 0) {
          // Either the row doesn't exist (cross-player or missing), already
          // stamped (idempotent), or all of the above. Distinguishing
          // "doesn't exist" from "already stamped" requires a second query;
          // we only do that when returning 404 for missing rows.
          //
          // Idempotent path: if a row matches (id, player_id, tenant_id),
          // it already has install_prompt_shown_at non-null → 204 with no
          // audit. Otherwise it doesn't exist for this player → 404.
          const existing = await tx
            .select({ id: deviceBindings.id })
            .from(deviceBindings)
            .where(
              and(
                eq(deviceBindings.id, deviceId),
                eq(deviceBindings.playerId, player.id),
                eq(deviceBindings.tenantId, TENANT_ID),
              ),
            )
            .limit(1);

          if (existing.length === 0) {
            // Roll back the (no-op) tx by throwing a sentinel; the route
            // catch maps it to 404. We don't write an audit row in this
            // path either.
            throw new NotFoundError();
          }
          return; // already stamped, idempotent 204
        }

        // UPDATE flipped the column → write audit row in same tx.
        await writeAudit(tx, {
          eventType: AUDIT_EVENT_TYPES.INSTALL_PROMPT_SHOWN,
          entityType: AUDIT_ENTITY_TYPES.DEVICE_BINDING,
          entityId: stamped[0]!.id,
          actorPlayerId: player.id,
          payload: { eventId, deviceBindingId: stamped[0]!.id },
        });
      });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return c.json({ error: 'device_binding_not_found', requestId }, 404);
      }
      log.error({
        msg: 'POST /install-prompt-shown threw',
        requestId,
        eventId,
        err: String(err),
      });
      return c.json(
        { error: 'internal', code: 'install_prompt_shown_failed', requestId },
        500,
      );
    }

    return c.body(null, 204);
  },
);

class NotFoundError extends Error {
  constructor() {
    super('device_binding_not_found');
    this.name = 'NotFoundError';
  }
}
