import type { MiddlewareHandler } from 'hono';
import { SESSION_COOKIE_NAME, sessionCookieHeader, validateSession } from '../lib/session.js';
import { DEVICE_COOKIE_NAME, validateDeviceBinding } from '../lib/device-auth.js';

/**
 * Requires an authenticated player — via a Google `tournament_session` cookie
 * OR (B0) a non-Google `tournament_device_id` device binding (the join-code /
 * invite-link path). Either way, on success `c.get('session')` and
 * `c.get('player')` are set, so every downstream route + authz middleware
 * (requireOrganizer, requireEventParticipant, requireScorerForRound) works
 * unchanged — they read the same `player`. Device-bound players are normally
 * non-organizers, so requireOrganizer still gates admin routes.
 *
 * Responses:
 *   - 401 { code: 'session_missing' } — no usable cookie at all
 *   - 401 { code: 'session_invalid' } (+ clear-cookie) — a cookie was present
 *     but neither the session nor a device binding validated
 *   - next() — authenticated
 *
 * For device auth, `session.sessionId` carries the device-binding id (so the
 * `c.get('session').playerId` readers keep working); there is no `sessions`
 * row to roll/expire — the 90-day device cookie is the lifetime.
 */
export const requireSession: MiddlewareHandler = async (c, next) => {
  const requestId = c.get('requestId');
  const cookieHeader = c.req.header('cookie') ?? '';
  const sessionId = extractCookie(cookieHeader, SESSION_COOKIE_NAME);

  // 1. Google session cookie path (primary).
  if (sessionId) {
    const wellShaped =
      sessionId.length >= 16 && sessionId.length <= 128 && /^[A-Za-z0-9_-]+$/.test(sessionId);
    if (wellShaped) {
      const validated = await validateSession(sessionId);
      if (validated) {
        c.set('session', { sessionId, playerId: validated.playerId });
        c.set('player', { id: validated.playerId, isOrganizer: validated.isOrganizer });
        await next();
        return;
      }
    }
    // Present but unusable — clear it so the browser drops the stale value,
    // then fall through to the device-binding path.
    c.header('Set-Cookie', sessionCookieHeader(null));
  }

  // 2. Device-binding path (B0 — non-Google join via code / invite link).
  const deviceId = extractCookie(cookieHeader, DEVICE_COOKIE_NAME);
  if (deviceId && deviceId.length >= 8 && deviceId.length <= 128) {
    const dev = await validateDeviceBinding(deviceId);
    if (dev) {
      c.set('session', { sessionId: deviceId, playerId: dev.playerId });
      c.set('player', { id: dev.playerId, isOrganizer: dev.isOrganizer });
      await next();
      return;
    }
  }

  // 3. Neither path authenticated.
  const code = sessionId || deviceId ? 'session_invalid' : 'session_missing';
  return c.json({ error: 'unauthenticated', code, requestId }, 401);
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
