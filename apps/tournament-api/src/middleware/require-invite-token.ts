import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { and, eq } from 'drizzle-orm';
import { logger as moduleLogger } from '../lib/log.js';
import { db } from '../db/index.js';
import { invites } from '../db/schema/index.js';

/**
 * Validates an invite token from `:token` URL param. T3-8.
 *
 * Does NOT call `requireSession` upstream — invite tokens are an
 * UNAUTHENTICATED gating primitive. The token IS the auth, per T3-6's
 * FR-E1 contract.
 *
 * MUST be mounted on a route parameterized with `:token`. If the parameter
 * is missing/empty, the middleware returns 500 — developer-error class:
 * mounting the middleware on a route that can't supply a token is a code
 * bug, not a user error.
 *
 * On valid + non-expired token, sets `c.set('invite', { eventId, inviteId })`.
 * Type augmentation lives in `src/types/hono.d.ts` (`ContextVariableMap.invite`).
 *
 * Example mount:
 *   app.route('/api/spectator/:token', requireInviteToken, spectatorRouter);
 *
 * Responses:
 *   - 401 { code: 'invite_token_invalid' } — token shape (charset/length)
 *     fails the cheap pre-DB guard
 *   - 401 { code: 'invite_not_found' } — well-shaped token but no matching
 *     row in the current tenant
 *   - 401 { code: 'invite_expired' } — matching row but `expires_at <= now`
 *   - 500 { code: 'middleware_misuse_no_token' } — route mounted without
 *     `:token` path param (developer bug)
 *   - next() — token valid; `c.get('invite')` is `{ eventId, inviteId }`
 */
const TENANT_ID = 'guyan';

// Cheap shape guard. T3-2 generates tokens via
// `crypto.randomBytes(32).toString('base64url')` → 43 chars, base64url
// charset. The bounds [16, 128] tolerate format-specific length variation
// (legacy short tokens, future longer formats) without rejecting the v1
// shape. Same idiom as `require-session.ts:40`.
const TOKEN_CHARSET_RE = /^[A-Za-z0-9_-]+$/;
const TOKEN_MIN_LEN = 16;
const TOKEN_MAX_LEN = 128;

export const requireInviteToken: MiddlewareHandler = async (c, next) => {
  const requestId = c.get('requestId') ?? randomUUID();
  const token = c.req.param('token');

  if (!token) {
    const log = c.get('logger') ?? moduleLogger;
    log.error({
      msg: 'requireInviteToken invoked on route without :token path param',
      requestId,
    });
    return c.json(
      { error: 'internal', code: 'middleware_misuse_no_token', requestId },
      500,
    );
  }

  // Pre-DB shape guard. Catches malformed user-supplied tokens (hand-edited
  // links, old links, garbage from bots) without a SELECT round-trip.
  if (
    token.length < TOKEN_MIN_LEN ||
    token.length > TOKEN_MAX_LEN ||
    !TOKEN_CHARSET_RE.test(token)
  ) {
    return c.json(
      { error: 'unauthenticated', code: 'invite_token_invalid', requestId },
      401,
    );
  }

  const rows = await db
    .select({
      id: invites.id,
      eventId: invites.eventId,
      expiresAt: invites.expiresAt,
    })
    .from(invites)
    .where(and(eq(invites.token, token), eq(invites.tenantId, TENANT_ID)))
    .limit(1);

  if (rows.length === 0) {
    return c.json(
      { error: 'unauthenticated', code: 'invite_not_found', requestId },
      401,
    );
  }
  const row = rows[0]!;

  if (row.expiresAt <= Date.now()) {
    return c.json({ error: 'unauthenticated', code: 'invite_expired', requestId }, 401);
  }

  c.set('invite', { eventId: row.eventId, inviteId: row.id });
  await next();
  return;
};
