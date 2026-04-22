import type { MiddlewareHandler } from 'hono';
import { randomUUID } from 'node:crypto';

/**
 * Requires that the authenticated player is an organizer (`isOrganizer === true`).
 *
 * MUST be mounted AFTER `requireSession` — this middleware reads the
 * `player` variable set by the session-validation path. If `c.get('player')`
 * is undefined the chain was misused; return 500 rather than silently
 * 401/403, so the misuse is loud and visible in logs.
 *
 * Example mount:
 *   app.use('/admin/*', requireSession, requireOrganizer);
 *
 * Responses:
 *   - 403 { code: 'not_organizer' } — authenticated but not an organizer
 *   - 500 { code: 'middleware_misuse' } — `requireSession` not ahead of
 *     this middleware in the chain (developer bug)
 *   - next() — authenticated AND organizer
 */
export const requireOrganizer: MiddlewareHandler = async (c, next) => {
  const requestId = randomUUID();
  const player = c.get('player');

  if (!player) {
    console.error('requireOrganizer invoked without requireSession ahead of it');
    return c.json({ error: 'internal', code: 'middleware_misuse', requestId }, 500);
  }

  if (!player.isOrganizer) {
    return c.json({ error: 'forbidden', code: 'not_organizer', requestId }, 403);
  }

  await next();
  return;
};
