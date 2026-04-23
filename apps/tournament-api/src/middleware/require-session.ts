import type { MiddlewareHandler } from 'hono';
import { SESSION_COOKIE_NAME, sessionCookieHeader, validateSession } from '../lib/session.js';

/**
 * Requires a valid `tournament_session` cookie.
 *
 * Responses:
 *   - 401 { code: 'session_missing', ... } — no cookie present
 *   - 401 { code: 'session_invalid', ... } + clear-cookie Set-Cookie — cookie
 *     present but session is missing, expired, or past the hard cap. The
 *     clear-cookie header helps the browser drop the stale cookie so the
 *     next request cleanly hits `session_missing` instead of repeating.
 *   - next() — valid; `c.get('session')` and `c.get('player')` are set.
 *
 * `requestId` is read from the context variable populated by the global
 * request-id middleware (T1-7). The middleware runs before auth and
 * guarantees a string id; no local generation is needed here.
 *
 * Typing: the Hono Variables augmentation lives in `src/types/hono.d.ts`.
 * Downstream handlers can write `const { playerId } = c.get('session')`
 * with full type safety, no `as any` casts.
 */
export const requireSession: MiddlewareHandler = async (c, next) => {
  const requestId = c.get('requestId');

  // Read the session cookie. Hono's getCookie would work but we avoid the
  // extra import — the raw Cookie header is fine and handles the one name
  // we care about.
  const cookieHeader = c.req.header('cookie') ?? '';
  const sessionId = extractCookie(cookieHeader, SESSION_COOKIE_NAME);

  if (!sessionId) {
    return c.json({ error: 'unauthenticated', code: 'session_missing', requestId }, 401);
  }

  // Cheap shape check — session IDs created by `createSession` are 43-char
  // base64url. Reject anything wildly off-shape before hitting the DB.
  // Prevents oversized/garbage cookies from turning into SELECT attempts
  // that might surprise SQLite, and keeps the 401 fast on bot traffic.
  if (sessionId.length < 16 || sessionId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    c.header('Set-Cookie', sessionCookieHeader(null));
    return c.json({ error: 'unauthenticated', code: 'session_invalid', requestId }, 401);
  }

  const validated = await validateSession(sessionId);
  if (!validated) {
    // Clear the cookie so the browser drops the stale value.
    c.header('Set-Cookie', sessionCookieHeader(null));
    return c.json({ error: 'unauthenticated', code: 'session_invalid', requestId }, 401);
  }

  c.set('session', { sessionId, playerId: validated.playerId });
  c.set('player', { id: validated.playerId, isOrganizer: validated.isOrganizer });
  await next();
  return;
};

/**
 * Extracts a single cookie value from a `Cookie` header string. Handles
 * the `name=value; name2=value2` format with whitespace tolerance.
 * Returns null when the named cookie is absent.
 */
function extractCookie(header: string, name: string): string | null {
  if (!header) return null;
  const parts = header.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const value = trimmed.slice(eq + 1);
    return value.length === 0 ? null : value;
  }
  return null;
}
