import { Hono, type Context } from 'hono';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { ArcticFetchError, OAuth2RequestError, generateCodeVerifier, generateState } from 'arctic';
import { googleOAuth } from '../lib/arctic.js';
import { env } from '../lib/env.js';
import { createSession } from '../lib/session.js';
import {
  oauthFlowCookieHeader,
  oauthFlowClearHeader,
  STATE_COOKIE_NAME,
  VERIFIER_COOKIE_NAME,
} from '../lib/oauth-cookies.js';
import { db } from '../db/index.js';
import { oauthIdentities, players } from '../db/schema/index.js';

/**
 * Auth sub-router. T1-6a shipped the infrastructure (schema, middleware,
 * env, session helpers). T1-6b adds the Google OAuth sign-in + callback
 * that binds Google `sub` → `players.id` via `oauth_identities`, then
 * issues a `tournament_session` cookie.
 *
 * Mount: `app.route('/api/auth', authRouter)` in src/app.ts.
 *
 * Routes after T1-6b:
 *   GET /status           — T1-6a liveness stub (kept byte-identical)
 *   GET /google           — OAuth sign-in entry (redirect to Google)
 *   GET /google/callback  — OAuth callback (bind + session + redirect home)
 */
export const authRouter = new Hono();

// Defaults for new players / oauth_identity rows. These match the
// constants in src/lib/session.ts; duplicated here intentionally rather
// than exported across modules — FD-6 plan calls for a proper tenant
// resolver in a future story, at which point both duplicates get
// replaced.
const DEFAULT_TENANT_ID = 'guyan';
const DEFAULT_CONTEXT_ID = 'league:guyan-wolf-cup-friday';

// Google's accepted `iss` values. Google's OIDC docs list both forms;
// accepting either matches the OIDC spec-compliant validator pattern.
const GOOGLE_ISS = new Set(['https://accounts.google.com', 'accounts.google.com']);

// libsql UNIQUE-violation sentinel. Observed in libsql@0.17 as rawCode
// 2067 with extendedCode 'SQLITE_CONSTRAINT_UNIQUE'; `code` may be the
// generic 'SQLITE_CONSTRAINT' depending on version. Catch-predicate
// matches any of the three to stay robust across patch upgrades.
const SQLITE_UNIQUE_RAW_CODE = 2067;

authRouter.get('/status', (c) =>
  c.json({ auth: 'infrastructure-ready', oauth: 'pending-t1-6b' }),
);

/**
 * GET /google — sign-in entry. Generates state + PKCE verifier, stores
 * them in short-lived SameSite=Lax cookies, redirects to Google's
 * authorization endpoint. Scope is `'openid'` only — we bind identity
 * by `sub`, never read email/name/picture.
 */
authRouter.get('/google', (c) => {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const authURL = googleOAuth.createAuthorizationURL(state, codeVerifier, ['openid']);

  // Emit both intermediate cookies. First cookie uses append too so the
  // append-or-overwrite ambiguity from Hono's `c.header` default never
  // bites us — if we ever add a third cookie, the pattern stays uniform.
  c.header('Set-Cookie', oauthFlowCookieHeader(STATE_COOKIE_NAME, state), { append: true });
  c.header('Set-Cookie', oauthFlowCookieHeader(VERIFIER_COOKIE_NAME, codeVerifier), {
    append: true,
  });

  return c.redirect(authURL.toString(), 302);
});

/**
 * GET /google/callback — OAuth callback. See spec AC #6 for the full
 * flow. The handler is intentionally long-form (no helper-function
 * splitting) so each branch is visible in isolation and the error-code
 * taxonomy is easy to audit in one read.
 */
authRouter.get('/google/callback', async (c) => {
  const requestId = c.get('requestId');
  const log = c.get('logger');
  const q = c.req.query();

  // ---- 1. Provider error branch (user declined / upstream config error)
  if (typeof q['error'] === 'string' && q['error'].length > 0) {
    const err = q['error'];
    // Emit clear-cookies for both intermediates in every provider-error
    // branch — we hold the cookies on the sign-in side, so clearing them
    // on abort prevents stale state leaking into a subsequent retry.
    appendClearCookies(c);

    if (err === 'access_denied') {
      // User clicked Cancel / declined consent. Redirect to a user-facing
      // "you cancelled" page rather than surfacing a 400.
      const declinedURL = new URL('/auth/declined', env.PUBLIC_APP_URL).toString();
      return c.redirect(declinedURL, 302);
    }

    if (err === 'server_error' || err === 'temporarily_unavailable') {
      return c.json(
        { error: 'auth_unavailable', code: 'auth_provider_outage', requestId },
        503,
      );
    }

    // Any other provider error code (invalid_request, invalid_scope,
    // unauthorized_client, etc.) indicates misconfiguration on our side.
    // Log the raw provider payload for ops diagnosis; respond generically
    // so a broken console config doesn't leak to users. The child logger
    // already carries `requestId`.
    log.error({
      event: 'oauth_provider_error',
      providerErr: err,
      errorDescription: q['error_description'] ?? null,
      errorUri: q['error_uri'] ?? null,
    });
    return c.json(
      { error: 'internal', code: 'oauth_provider_error', requestId },
      500,
    );
  }

  // ---- 2. Missing required params branch
  const code = typeof q['code'] === 'string' ? q['code'] : null;
  const stateFromQuery = typeof q['state'] === 'string' ? q['state'] : null;
  if (!code || !stateFromQuery) {
    appendClearCookies(c);
    return c.json(
      { error: 'bad_request', code: 'oauth_missing_params', requestId },
      400,
    );
  }

  // ---- 3. Read intermediate cookies
  const cookieHeader = c.req.header('cookie') ?? '';
  const stateFromCookie = extractCookie(cookieHeader, STATE_COOKIE_NAME);
  const verifierFromCookie = extractCookie(cookieHeader, VERIFIER_COOKIE_NAME);
  if (!stateFromCookie || !verifierFromCookie) {
    // No clear needed — cookies were never set (or already expired).
    return c.json(
      { error: 'bad_request', code: 'oauth_cookies_missing', requestId },
      400,
    );
  }

  // ---- 4. State match
  if (stateFromCookie !== stateFromQuery) {
    appendClearCookies(c);
    return c.json(
      { error: 'bad_request', code: 'oauth_state_mismatch', requestId },
      400,
    );
  }

  // ---- 5. Token exchange with arctic
  let idToken: string;
  try {
    const tokens = await googleOAuth.validateAuthorizationCode(code, verifierFromCookie);
    idToken = tokens.idToken();
  } catch (err) {
    // Clear intermediate cookies on every token-exchange failure path —
    // a stale state/verifier left behind would confuse a retry until the
    // 10-min TTL expires (codex round-1 medium #3).
    appendClearCookies(c);
    if (err instanceof ArcticFetchError) {
      return c.json(
        { error: 'auth_unavailable', code: 'auth_provider_outage', requestId },
        503,
      );
    }
    if (err instanceof OAuth2RequestError) {
      return c.json(
        { error: 'bad_request', code: 'oauth_exchange_failed', requestId },
        400,
      );
    }
    // Unknown error shape — fail closed (503) but log at error level with
    // full context so operators can classify and upgrade the handler.
    const e = err as { message?: unknown; stack?: unknown; cause?: unknown } | null;
    log.error({
      event: 'oauth_unknown_error',
      message: e?.message ?? null,
      stack: e?.stack ?? null,
      cause: e?.cause ? String(e.cause) : null,
    });
    return c.json(
      { error: 'auth_unavailable', code: 'auth_provider_outage', requestId },
      503,
    );
  }

  // ---- 6. Extract + validate id_token claims (iss, aud, exp, sub)
  let sub: string;
  try {
    sub = extractSubFromIdToken(idToken);
  } catch {
    // Same reasoning as the token-exchange catch above — once the flow
    // has failed past state validation, the intermediates have served
    // their purpose and should not linger.
    appendClearCookies(c);
    // Generic response; specific reason stays in the server log.
    // Redact the raw id_token — record only its length for triage.
    log.warn({
      event: 'oauth_invalid_id_token',
      idTokenLength: idToken.length,
    });
    return c.json(
      { error: 'upstream_invalid', code: 'oauth_invalid_id_token', requestId },
      502,
    );
  }

  // ---- 7. Look up or bind oauth_identity, with race-safe insert
  let playerId: string;
  try {
    playerId = await lookupOrBindOAuthIdentity(sub);
  } catch (err) {
    // Same hygiene as the upstream catches — once the flow is past state
    // validation, intermediates have served their purpose. Clearing on
    // 500 here keeps a botched DB write from leaving stale cookies.
    appendClearCookies(c);
    const e = err as { message?: unknown; rawCode?: unknown } | null;
    log.error({
      event: 'oauth_bind_error',
      message: e?.message ?? null,
      rawCode: e?.rawCode ?? null,
      // `sub` is a Google opaque id — not PII by itself, useful for correlation.
      sub,
      provider: 'google',
    });
    return c.json(
      { error: 'internal', code: 'oauth_bind_race', requestId },
      500,
    );
  }

  // ---- 8. Issue session
  const { setCookieHeader } = await createSession(playerId, {
    userAgent: c.req.header('user-agent') ?? '',
    ip: c.req.header('x-forwarded-for') ?? '',
  });

  // ---- 9. Emit 3 Set-Cookie headers (session + 2 clears) + 302 home
  c.header('Set-Cookie', setCookieHeader, { append: true });
  appendClearCookies(c);
  const homeURL = new URL('/', env.PUBLIC_APP_URL).toString();
  return c.redirect(homeURL, 302);
});

// ---------------------------------------------------------------------
// Helpers — private to this module.
// ---------------------------------------------------------------------

/**
 * Appends clear-cookie headers for BOTH oauth flow cookies. Safe to call
 * multiple times per response (each call adds additional Set-Cookie
 * headers; browsers tolerate multiple clears for the same cookie name).
 */
function appendClearCookies(c: Context): void {
  c.header('Set-Cookie', oauthFlowClearHeader(STATE_COOKIE_NAME), { append: true });
  c.header('Set-Cookie', oauthFlowClearHeader(VERIFIER_COOKIE_NAME), { append: true });
}

/**
 * Parses a JWT id_token's payload segment (no signature verification —
 * see spec "Explicit Risk Acceptance" section), validates iss/aud/exp/sub,
 * and returns the `sub` claim. Throws on any validation failure.
 *
 * Signature verification is intentionally skipped; under the tournament
 * app's threat model (private 8-player event, narrow consume-and-derive-
 * sub flow, no id_token persistence), the signature check adds fragile
 * defense against TLS-trust scenarios and zero defense against the
 * scenarios we actually face. See spec lines 14-41 for the full rationale.
 */
function extractSubFromIdToken(idToken: string): string {
  const segs = idToken.split('.');
  if (segs.length !== 3) {
    throw new Error('malformed_jwt');
  }
  // `segs[1]` is a string — narrow via the length check above. TS
  // strictIndex treats this as string | undefined without the assertion.
  const payloadSeg = segs[1]!;
  const payloadJson = Buffer.from(payloadSeg, 'base64url').toString('utf-8');
  const claims = JSON.parse(payloadJson) as {
    sub?: unknown;
    iss?: unknown;
    aud?: unknown;
    exp?: unknown;
  };

  // iss: Google-specific (accounts.google.com or https://accounts.google.com)
  if (typeof claims.iss !== 'string' || !GOOGLE_ISS.has(claims.iss)) {
    throw new Error('invalid_iss');
  }

  // aud: must match our client ID. OIDC permits string OR string[]; Google
  // typically sends a string but the handler accepts both.
  const audMatches =
    typeof claims.aud === 'string'
      ? claims.aud === env.GOOGLE_OAUTH_CLIENT_ID
      : Array.isArray(claims.aud) && claims.aud.includes(env.GOOGLE_OAUTH_CLIENT_ID);
  if (!audMatches) {
    throw new Error('invalid_aud');
  }

  // exp: unix seconds, must be in the future.
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) {
    throw new Error('expired');
  }

  // sub: stable Google user id.
  if (typeof claims.sub !== 'string' || claims.sub.length === 0 || claims.sub.length > 256) {
    throw new Error('malformed_sub');
  }
  return claims.sub;
}

/**
 * Look up `oauth_identities` by (tenant_id, provider, provider_sub).
 * On a hit, return the bound `player_id`. On a miss, insert `players` +
 * `oauth_identities` inside a transaction. If a concurrent first-SSO
 * hits the UNIQUE constraint, retry the lookup once — the winning
 * insert's row is now readable.
 */
async function lookupOrBindOAuthIdentity(sub: string): Promise<string> {
  // Outer lookup: single round-trip path for returning users.
  const outer = await db
    .select({ playerId: oauthIdentities.playerId })
    .from(oauthIdentities)
    .where(
      and(
        eq(oauthIdentities.tenantId, DEFAULT_TENANT_ID),
        eq(oauthIdentities.provider, 'google'),
        eq(oauthIdentities.providerSub, sub),
      ),
    );
  if (outer[0]) {
    return outer[0].playerId;
  }

  // Miss: bind inside a transaction. Re-select inside the tx to catch the
  // case where a concurrent first-SSO already inserted between our outer
  // lookup and entering this tx.
  return db.transaction(async (tx) => {
    const inner = await tx
      .select({ playerId: oauthIdentities.playerId })
      .from(oauthIdentities)
      .where(
        and(
          eq(oauthIdentities.tenantId, DEFAULT_TENANT_ID),
          eq(oauthIdentities.provider, 'google'),
          eq(oauthIdentities.providerSub, sub),
        ),
      );
    if (inner[0]) {
      return inner[0].playerId;
    }

    const newPlayerId = randomUUID();
    const now = Date.now();
    try {
      await tx.insert(players).values({
        id: newPlayerId,
        isOrganizer: false,
        createdAt: now,
        tenantId: DEFAULT_TENANT_ID,
        contextId: DEFAULT_CONTEXT_ID,
      });
      await tx.insert(oauthIdentities).values({
        id: randomUUID(),
        provider: 'google',
        providerSub: sub,
        playerId: newPlayerId,
        createdAt: now,
        tenantId: DEFAULT_TENANT_ID,
        contextId: DEFAULT_CONTEXT_ID,
      });
      return newPlayerId;
    } catch (err) {
      // If the UNIQUE on (tenant_id, provider, provider_sub) fired, a
      // concurrent first-SSO won the race. Re-SELECT — the winner's row
      // is now visible. Any other error shape re-throws.
      if (!isUniqueConstraintError(err)) {
        throw err;
      }
      const retry = await tx
        .select({ playerId: oauthIdentities.playerId })
        .from(oauthIdentities)
        .where(
          and(
            eq(oauthIdentities.tenantId, DEFAULT_TENANT_ID),
            eq(oauthIdentities.provider, 'google'),
            eq(oauthIdentities.providerSub, sub),
          ),
        );
      if (retry[0]) {
        return retry[0].playerId;
      }
      // Pathological — the UNIQUE fired on a different column (e.g.,
      // players.id UUID collision, ~0 probability). Bubble to the handler
      // as the `oauth_bind_race` 500.
      throw new Error('oauth_bind_race_retry_empty');
    }
  });
}

/**
 * LibsqlError shape matcher — robust across wrapping layers.
 *
 * Drizzle 0.45+ wraps every libsql driver error in a `DrizzleQueryError`
 * (name: 'Error', constructor: 'DrizzleQueryError') and stashes the
 * original `LibsqlError` on `err.cause`. Older drizzle versions bubbled
 * the raw LibsqlError. Some backends may also report the sentinel
 * in `code`, `extendedCode`, or `rawCode` depending on libsql version.
 *
 * Strategy: check the error itself AND its `cause` chain (one level is
 * sufficient for drizzle's current wrapping depth; extra defensive reads
 * cost nothing). Match on ANY of the three sentinels.
 *
 * The unit test in auth.test.ts pins this contract by triggering a real
 * UNIQUE violation through drizzle and asserting the predicate matches.
 * If a future drizzle upgrade changes the wrapping shape, that test
 * fails and this function needs a corresponding update.
 */
function isUniqueConstraintError(err: unknown): boolean {
  if (checkUniqueSentinels(err)) return true;
  if (err && typeof err === 'object') {
    const cause = (err as { cause?: unknown }).cause;
    if (checkUniqueSentinels(cause)) return true;
  }
  return false;
}

function checkUniqueSentinels(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; extendedCode?: unknown; rawCode?: unknown };
  if (
    e.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    e.extendedCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
    e.rawCode === SQLITE_UNIQUE_RAW_CODE
  ) {
    return true;
  }
  // Future-proofing: if a libsql upgrade drops the extended sentinel and
  // only exposes the generic `SQLITE_CONSTRAINT`, treat that as a match
  // too. In our bind path the only realistic constraint failure is the
  // composite UNIQUE on oauth_identities — players is just-inserted in
  // the same transaction so its FK can't break, and the random UUID
  // collision space is ~0. A generic-code match here is safe because
  // any miss falls through to the same retry-SELECT path which itself
  // throws `oauth_bind_race_retry_empty` if no row is found.
  return e.code === 'SQLITE_CONSTRAINT';
}

/**
 * Test-only re-export so the AC #9 "verify-at-impl" unit test can
 * confirm the predicate still matches real libsql errors after drizzle
 * or libsql upgrades. Not imported anywhere else in production code.
 */
export const isUniqueConstraintErrorForTests = isUniqueConstraintError;

/**
 * Cookie extractor — mirrors the private helper in middleware/require-session.ts.
 * Intentionally duplicated (10 lines) rather than exported from the
 * middleware module, per the project's "no refactor beyond the task"
 * rule. The next story that needs a third copy should promote this to a
 * shared util.
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

// Logging was centralized in T1-7 — the four log helper functions that
// used `console.error(JSON.stringify(...))` in T1-6b are now inline
// `c.get('logger').error(...)` / `.warn(...)` calls at each call-site.
// The request-scoped child logger already carries `requestId`.
