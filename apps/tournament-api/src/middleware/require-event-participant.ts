import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { and, eq } from 'drizzle-orm';
import { logger as moduleLogger } from '../lib/log.js';
import { db } from '../db/index.js';
import { events, groupMembers, groups } from '../db/schema/index.js';

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
 * Organizer exemption (T13-1): a player who is THIS event's organizer
 * (`events.organizer_player_id`, tenant-scoped) passes WITHOUT a
 * group_members row — you may view events you organize. This is
 * event-specific, NOT the global `players.is_organizer` flag (a global
 * organizer who does not organize this event is still 403'd).
 *
 * Responses:
 *   - 403 { code: 'not_event_participant' } — authenticated but neither a
 *     group_members row for the requested event NOR its organizer
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
    // T13-1: event-specific organizer exemption. A player who is THIS event's
    // organizer may view it without a group_members row (closes the prod trap
    // where the event's organizer is 403'd off their own event home). Scoped to
    // event id + this player as organizer + tenant — the tenant conjunct is the
    // no-existence-leak guard, so a nonexistent OR foreign-tenant event yields
    // no row and falls through to the same 403. Keyed on events.organizer_player_id
    // (event-specific), NOT the global players.is_organizer flag — per the
    // multi-organizer model: you may view events you organize, not anyone's.
    const orgRows = await db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.id, eventId),
          eq(events.organizerPlayerId, player.id),
          eq(events.tenantId, TENANT_ID),
        ),
      )
      .limit(1);
    if (orgRows.length === 0) {
      return c.json({ error: 'forbidden', code: 'not_event_participant', requestId }, 403);
    }
  }

  await next();
  return;
};
