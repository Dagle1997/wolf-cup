import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { and, eq } from 'drizzle-orm';
import { logger as moduleLogger } from '../lib/log.js';
import { db } from '../db/index.js';
import { groupMembers, groups } from '../db/schema/index.js';

/**
 * Requires that the authenticated player is a participant of the event
 * referenced in the URL path's `:eventId` parameter. T3-8.
 *
 * MUST be mounted AFTER `requireSession` — this middleware reads the
 * `player` variable set by the session-validation path. If
 * `c.get('player')` is undefined, the chain was misused; return 500
 * rather than silently 401/403, so the misuse is loud and visible in
 * logs. Same posture as `require-organizer.ts`.
 *
 * MUST be mounted on a route parameterized with `:eventId`. If the
 * parameter is missing/empty, the middleware returns 500 — same
 * misuse-class signal: a developer mounted the middleware on a route
 * that can't supply an event id, no user request can ever satisfy it.
 *
 * Tenant-scoped: both `groups.tenant_id` AND `group_members.tenant_id`
 * must match `TENANT_ID`. Defensive against cross-tenant cookie leakage
 * when v1.5+ multi-tenant lands; matches the post-T3-7 hardening pattern.
 *
 * Example mount:
 *   app.route('/api/events/:eventId/pairings',
 *             requireSession, requireEventParticipant, pairingsRouter);
 *
 * Responses:
 *   - 403 { code: 'not_event_participant' } — authenticated but not in
 *     any group_members row for the requested event
 *   - 500 { code: 'middleware_misuse' } — `requireSession` not ahead of
 *     this middleware in the chain (developer bug)
 *   - 500 { code: 'middleware_misuse_no_event_id' } — route mounted
 *     without `:eventId` path param (developer bug)
 *   - next() — authenticated AND a participant
 */
const TENANT_ID = 'guyan';

export const requireEventParticipant: MiddlewareHandler = async (c, next) => {
  const requestId = c.get('requestId') ?? randomUUID();
  const player = c.get('player');

  if (!player) {
    const log = c.get('logger') ?? moduleLogger;
    log.error({
      msg: 'requireEventParticipant invoked without requireSession ahead of it',
      requestId,
    });
    return c.json({ error: 'internal', code: 'middleware_misuse', requestId }, 500);
  }

  const eventId = c.req.param('eventId');
  if (!eventId) {
    const log = c.get('logger') ?? moduleLogger;
    log.error({
      msg: 'requireEventParticipant invoked on route without :eventId path param',
      requestId,
    });
    return c.json(
      { error: 'internal', code: 'middleware_misuse_no_event_id', requestId },
      500,
    );
  }

  // Tenant-scoped on BOTH joined tables. A foreign-tenant groups row OR a
  // foreign-tenant group_members row will not satisfy the predicate, even
  // if the other table's row is in the correct tenant.
  const rows = await db
    .select({ playerId: groupMembers.playerId })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(
      and(
        eq(groups.eventId, eventId),
        eq(groupMembers.playerId, player.id),
        eq(groups.tenantId, TENANT_ID),
        eq(groupMembers.tenantId, TENANT_ID),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'forbidden', code: 'not_event_participant', requestId }, 403);
  }

  await next();
  return;
};
