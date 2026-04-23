import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { logger as moduleLogger } from '../lib/log.js';

/**
 * Requires that the authenticated player is an organizer (`isOrganizer === true`).
 *
 * MUST be mounted AFTER `requireSession` — this middleware reads the
 * `player` variable set by the session-validation path. If `c.get('player')`
 * is undefined the chain was misused; return 500 rather than silently
 * 401/403, so the misuse is loud and visible in logs.
 *
 * `requestId` is normally read from the context variable populated by
 * the global request-id middleware (T1-7). If THAT middleware is also
 * missing from the chain (double misuse), fall back to a local UUID +
 * the module-level logger so the error response still carries a
 * correlation id and the misuse is still logged.
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
  const requestId = c.get('requestId') ?? randomUUID();
  const player = c.get('player');

  if (!player) {
    // Prefer the ctx child logger (carries requestId); fall back to the
    // module singleton if the request-id middleware is also missing.
    const log = c.get('logger') ?? moduleLogger;
    log.error({ msg: 'requireOrganizer invoked without requireSession ahead of it', requestId });
    return c.json({ error: 'internal', code: 'middleware_misuse', requestId }, 500);
  }

  if (!player.isOrganizer) {
    return c.json({ error: 'forbidden', code: 'not_organizer', requestId }, 403);
  }

  await next();
  return;
};
