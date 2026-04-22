import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sessions, players } from '../db/schema/index.js';
import { env } from './env.js';

/**
 * Session lifecycle helpers shared by OAuth callback routes (T1-6b) and
 * the require-session middleware (T1-6a).
 *
 * Time injection: every helper accepts an optional `now?: () => number`
 * defaulting to `Date.now`. Tests pass a fixed-time fn to exercise the
 * 7-day rolling / 30-day hard-cap boundaries deterministically. Direct
 * `Date.now()` calls inside helpers are forbidden — they break the
 * boundary tests in AC #18.
 *
 * Storage model: the cookie value IS the server-side-stored `session_id`
 * (a 256-bit opaque token from `crypto.randomBytes(32).toString('base64url')`).
 * No HMAC signing — the token's entropy is the entire authentication story.
 */

const SESSION_COOKIE_NAME = 'tournament_session';

// 7 days rolling expiration; each validateSession call pushes expires_at
// forward by this amount. Per D2-4.
const SESSION_ROLLING_MS = 7 * 24 * 60 * 60 * 1000;

// 30 days hard cap; even with continuous use a session is invalidated
// once createdAt + SESSION_HARD_CAP_MS is past. Per D2-4.
const SESSION_HARD_CAP_MS = 30 * 24 * 60 * 60 * 1000;

// Device-info column length cap — truncated at store time, asserted by
// `session.test.ts` (codex round-1 #8 — guards against unbounded storage).
const DEVICE_INFO_MAX_LEN = 128;

// Default tenant/context until multi-tenant auth arrives; see FD-6.
const DEFAULT_TENANT_ID = 'guyan';
const DEFAULT_CONTEXT_ID = 'league:guyan-wolf-cup-friday';

type CreateSessionRequest = {
  userAgent: string;
  ip: string;
};

type CreateSessionResult = {
  sessionId: string;
  setCookieHeader: string;
};

/**
 * Creates a new session row and returns the session id + Set-Cookie header.
 * Caller (OAuth callback in T1-6b) is responsible for ensuring the playerId
 * exists; no FK check here beyond SQLite's own enforcement.
 */
export async function createSession(
  playerId: string,
  req: CreateSessionRequest,
  now: () => number = Date.now,
): Promise<CreateSessionResult> {
  const sessionId = randomBytes(32).toString('base64url');
  const t = now();

  // Truncate AT storage — keeps the 128-char cap regardless of header size.
  const deviceInfo = `${req.userAgent}|${req.ip}`.slice(0, DEVICE_INFO_MAX_LEN);

  await db.insert(sessions).values({
    sessionId,
    playerId,
    createdAt: t,
    lastSeenAt: t,
    expiresAt: t + SESSION_ROLLING_MS,
    deviceInfo,
    tenantId: DEFAULT_TENANT_ID,
    contextId: DEFAULT_CONTEXT_ID,
  });

  return {
    sessionId,
    setCookieHeader: sessionCookieHeader(sessionId),
  };
}

type ValidateSessionResult = {
  playerId: string;
  isOrganizer: boolean;
} | null;

/**
 * Validates a session token. Returns the bound player + isOrganizer flag,
 * or null if the session is missing, expired (past rolling 7-day), or
 * over the 30-day hard cap.
 *
 * Side effect: a valid session has its `lastSeenAt` + `expiresAt` rolled
 * forward (the rolling lifetime).
 */
export async function validateSession(
  sessionId: string,
  now: () => number = Date.now,
): Promise<ValidateSessionResult> {
  const rows = await db
    .select({
      playerId: sessions.playerId,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(eq(sessions.sessionId, sessionId));
  const row = rows[0];
  if (!row) return null;

  const t = now();
  const hardCapDeadline = row.createdAt + SESSION_HARD_CAP_MS;

  // Expired by rolling OR past the hard cap — both invalidate.
  if (row.expiresAt <= t || hardCapDeadline <= t) {
    return null;
  }

  // Valid — roll the session forward. Hard cap still applies (computed at
  // read time from createdAt); we never move createdAt.
  await db
    .update(sessions)
    .set({
      lastSeenAt: t,
      expiresAt: t + SESSION_ROLLING_MS,
    })
    .where(eq(sessions.sessionId, sessionId));

  // Look up isOrganizer from players — fetched separately because
  // `sessions` deliberately doesn't cache organizer state (stale risk on
  // role toggles). At 8 players the extra round trip is unmeasurable.
  const playerRows = await db
    .select({ isOrganizer: players.isOrganizer })
    .from(players)
    .where(eq(players.id, row.playerId));
  const isOrganizer = playerRows[0]?.isOrganizer ?? false;

  return { playerId: row.playerId, isOrganizer };
}

/**
 * Removes a session row. Used on logout and when a cookie is present but
 * the session row is gone (opportunistic cleanup — the cookie itself is
 * cleared by the middleware via sessionCookieHeader(null)).
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.sessionId, sessionId));
}

// Regex used to validate cookie values before they hit the Set-Cookie
// header — defensive guard against header-injection via an untrusted
// session_id path. Non-empty base64url only — the clear-cookie path
// uses `null` explicitly, so bare empty strings are a programmer error
// (would set a long-lived cookie with empty value instead of clearing).
const COOKIE_VALUE_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Builds the `Set-Cookie` header value for the session cookie.
 *
 * Production (env.NODE_ENV === 'production'):
 *   HttpOnly; Secure; SameSite=Strict; Domain=${AUTH_COOKIE_DOMAIN}; Path=/; Max-Age=604800
 *
 * Development / test (env.NODE_ENV !== 'production'):
 *   HttpOnly; SameSite=Strict; Path=/; Max-Age=604800
 *   (no Secure, no Domain — cookie-jar tests against localhost work)
 *
 * Pass `null` as the value to emit a clear-cookie header (Max-Age=0) that
 * matches all the other attributes so the browser removes the exact cookie.
 *
 * Input validation: the value (if non-null) must match the base64url
 * charset used by `createSession`. `AUTH_COOKIE_DOMAIN` is already
 * regex-validated in `env.ts` against header-attribute injection chars.
 * These are defense-in-depth — the code paths that feed this function
 * already emit safe values, but callers that pass arbitrary strings
 * should be rejected loudly.
 */
export function sessionCookieHeader(value: string | null): string {
  if (value !== null && !COOKIE_VALUE_RE.test(value)) {
    throw new Error('sessionCookieHeader: value must be non-empty base64url or null');
  }
  const isProd = env.NODE_ENV === 'production';
  const cookieValue = value ?? '';
  const maxAge = value === null ? 0 : Math.floor(SESSION_ROLLING_MS / 1000);

  const parts = [
    `${SESSION_COOKIE_NAME}=${cookieValue}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${maxAge}`,
  ];
  if (isProd) {
    parts.splice(1, 0, 'Secure');
    parts.push(`Domain=${env.AUTH_COOKIE_DOMAIN}`);
  }
  return parts.join('; ');
}

/**
 * Exported for middleware that reads the cookie by name.
 */
export { SESSION_COOKIE_NAME };
