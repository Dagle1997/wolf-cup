import { env } from './env.js';

/**
 * OAuth flow intermediate cookies: `tournament_oauth_state` and
 * `tournament_oauth_code_verifier`.
 *
 * These carry the CSRF state and PKCE verifier between the `/auth/google`
 * sign-in entry and the `/auth/google/callback` handler. They are
 * SHORT-LIVED (10 min) and `SameSite=Lax` — the ONLY Lax cookies in the
 * auth realm. The long-lived `tournament_session` cookie stays Strict.
 *
 * Why Lax (not Strict): OAuth providers redirect the browser back via a
 * top-level GET navigation from a cross-site origin. `SameSite=Strict`
 * would strip these cookies on the return and the callback would 400
 * `oauth_cookies_missing`. See architecture §Auth 404-437 for the full
 * matrix.
 *
 * Value validation: PKCE verifier per RFC 7636 uses `[A-Z][a-z][0-9]-._~`
 * (43-128 chars). State from `arctic.generateState()` is base64url. The
 * combined regex `[A-Za-z0-9._~-]{16,256}` is a superset that accepts
 * both. Using the stricter `[A-Za-z0-9_-]` from `sessionCookieHeader`
 * would WRONGLY reject valid PKCE verifiers containing `.` or `~`, so
 * this is a dedicated validator — defense-in-depth against header-
 * injection via a compromised value.
 */

const STATE_COOKIE_NAME = 'tournament_oauth_state';
const VERIFIER_COOKIE_NAME = 'tournament_oauth_code_verifier';

const OAUTH_FLOW_MAX_AGE_SECONDS = 600; // 10 min

// Superset charset accepting both base64url state and PKCE verifier.
const OAUTH_VALUE_RE = /^[A-Za-z0-9._~-]{16,256}$/;

export type OAuthFlowCookieName = typeof STATE_COOKIE_NAME | typeof VERIFIER_COOKIE_NAME;

/**
 * Emits the `Set-Cookie` header value for a single OAuth flow cookie.
 *
 * Production: adds `Secure` and `Domain=${AUTH_COOKIE_DOMAIN}` in addition
 * to the base attributes.
 *
 * Throws on invalid value to surface header-injection attempts loudly
 * rather than emitting a malformed header. State + verifier values fed
 * by arctic always satisfy the regex — a throw here is a programmer
 * error, never a legitimate runtime case.
 */
export function oauthFlowCookieHeader(name: OAuthFlowCookieName, value: string): string {
  if (!OAUTH_VALUE_RE.test(value)) {
    throw new Error(
      `oauthFlowCookieHeader: value for ${name} must be 16-256 chars of [A-Za-z0-9._~-]`,
    );
  }
  return buildCookie(name, value, OAUTH_FLOW_MAX_AGE_SECONDS);
}

/**
 * Emits a clear-cookie header for one of the OAuth flow cookies.
 *
 * Critical: the clear header MUST carry the same Domain / Secure / Path /
 * SameSite attributes as the set header. Browsers only remove a cookie
 * when every attribute matches; if the clear omits Domain in production
 * the original cookie persists. This attribute parity is a correctness
 * requirement, not a nice-to-have.
 */
export function oauthFlowClearHeader(name: OAuthFlowCookieName): string {
  return buildCookie(name, '', 0);
}

/**
 * Shared builder. `value` is already validated (or empty for clear).
 * Centralizes the dev/prod attribute branch so set + clear can't drift.
 */
function buildCookie(name: OAuthFlowCookieName, value: string, maxAge: number): string {
  const isProd = env.NODE_ENV === 'production';
  const parts = [
    `${name}=${value}`,
    'HttpOnly',
    'SameSite=Lax',
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
 * Exported for the callback handler that reads these cookies by name.
 */
export { STATE_COOKIE_NAME, VERIFIER_COOKIE_NAME };
