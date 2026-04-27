import { Hono, type Context } from 'hono';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { ArcticFetchError, OAuth2RequestError, generateCodeVerifier, generateState } from 'arctic';
import { googleOAuth } from '../lib/arctic.js';
import { env } from '../lib/env.js';
import {
  SESSION_COOKIE_NAME,
  createSession,
  sessionCookieHeader,
  validateSession,
} from '../lib/session.js';
import {
  oauthFlowCookieHeader,
  oauthFlowClearHeader,
  STATE_COOKIE_NAME,
  VERIFIER_COOKIE_NAME,
} from '../lib/oauth-cookies.js';
import { requireSession } from '../middleware/require-session.js';
import { db } from '../db/index.js';
import { deviceBindings, oauthIdentities, players, sessions } from '../db/schema/index.js';
import {
  DEVICE_COOKIE_NAME,
  TENANT_ID as DEVICE_TENANT_ID,
  deviceCookieClearHeader,
} from './invites.js';

/**
 * Auth sub-router. T1-6a shipped the infrastructure (schema, middleware,
 * env, session helpers). T1-6b adds the Google OAuth sign-in + callback
 * that binds Google `sub` → `players.id` via `oauth_identities`, then
 * issues a `tournament_session` cookie. T2-3b rewrites `GET /status` from
 * the T1-6a stub into a real auth-state endpoint for the SPA loader.
 *
 * Mount: `app.route('/api/auth', authRouter)` in src/app.ts.
 *
 * Routes after T2-3b:
 *   GET /status           — auth state for SPA loaders: returns
 *                           `{ player: null }` (anonymous / invalid session)
 *                           OR `{ player: { id, isOrganizer } }`. Anonymous-
 *                           tolerant; does NOT use require-session middleware.
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

// Cheap shape guard for the device cookie value (T3-7). The cookie value
// is the device_bindings.id UUID as set by T3-6's invite-claim flow.
// Anything off-shape is treated as no-cookie before any DB lookup —
// keeps malformed/attacker-controlled values from generating noisy
// SELECT log lines and codifies the "safe no-op" behavior.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Thrown by `lookupOrBindOAuthIdentity` (T3-7) when an invite-claimed
 * device's player already has a Google `oauth_identities` row bound to
 * a DIFFERENT `provider_sub`. Callers redirect to /auth/conflict; no
 * session is created and no device_binding row is mutated.
 */
export class OAuthRebindConflictError extends Error {
  constructor(message = 'oauth_rebind_conflict') {
    super(message);
    this.name = 'OAuthRebindConflictError';
  }
}

/**
 * GET /status — current authentication state for the SPA's route loaders
 * (T2-3b). Returns `{ player: null }` for anonymous OR invalid-session
 * requests; returns `{ player: { id, isOrganizer } }` for valid sessions.
 *
 * Replaces the T1-6a stub that returned `{ auth, oauth }` debugging
 * strings — those had no consumers and were stale post-T1-6b.
 *
 * Anonymous-tolerant: does NOT use `requireSession` middleware. A missing
 * cookie or stale session_id (deleted from sessions table, or expired)
 * yields `{ player: null }` with HTTP 200 — the client can then redirect
 * to the OAuth flow. Treating stale sessions as 200-with-null is gentler
 * UX than 401 (avoids the SPA needing two distinct error-paths).
 *
 * Side effect on valid sessions: validateSession rolls expires_at forward
 * (rolling 7-day lifetime). Status checks during normal SPA navigation
 * thus extend the session — desired behavior for an actively-used tab.
 */
authRouter.get('/status', async (c) => {
  const cookieHeader = c.req.header('cookie') ?? '';
  const sessionId = extractCookieValue(cookieHeader, SESSION_COOKIE_NAME);

  if (!sessionId) {
    return c.json({ player: null });
  }

  // Cheap shape guard before hitting the DB — same idiom as
  // require-session middleware. base64url session IDs are 16-128 chars.
  if (sessionId.length < 16 || sessionId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    return c.json({ player: null });
  }

  const validated = await validateSession(sessionId);
  if (!validated) {
    return c.json({ player: null });
  }

  // T3-10 — additive shape: read the player row to surface ghin +
  // manual_handicap_index for the /profile page. Tenant-scoped per the
  // post-T3-7/T3-9 hardening pattern. Existing T2-3b consumers extract
  // only `id` + `isOrganizer` and ignore unknown keys, so this is
  // forward-compat (verified at spec-time, see T3-10 Risk §2.2).
  const playerRows = await db
    .select({
      id: players.id,
      ghin: players.ghin,
      manualHandicapIndex: players.manualHandicapIndex,
    })
    .from(players)
    .where(
      and(
        eq(players.id, validated.playerId),
        eq(players.tenantId, DEFAULT_TENANT_ID),
      ),
    );
  const profile = playerRows[0];

  return c.json({
    player: {
      id: validated.playerId,
      isOrganizer: validated.isOrganizer,
      ghin: profile?.ghin ?? null,
      manualHandicapIndex: profile?.manualHandicapIndex ?? null,
    },
  });
});

/** Extracts a single cookie value from a Cookie header. Returns null if absent or empty. */
function extractCookieValue(header: string, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const value = trimmed.slice(eq + 1);
    return value.length === 0 ? null : value;
  }
  return null;
}

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

  // ---- 7. Look up or bind oauth_identity, with race-safe insert + T3-7
  //         device-binding rebind branch.
  //
  // Read the `tournament_device_id` cookie ONCE here and pass into
  // lookupOrBindOAuthIdentity. The function returns `consolidatableDeviceBindingId`
  // which gates the post-session UPDATE step below. Critically, the
  // callback does NOT independently re-read the cookie later — that
  // would risk drift from the rebind decision (T3-7 High #1 regression
  // class).
  const deviceCookieValue = extractCookie(cookieHeader, DEVICE_COOKIE_NAME);
  let lookupResult: LookupOrBindResult;
  try {
    lookupResult = await lookupOrBindOAuthIdentity(sub, deviceCookieValue);
  } catch (err) {
    // T3-7: rebind conflict redirects to a SPA error page rather than
    // returning JSON (the user is mid-OAuth-redirect; JSON would break
    // the browser flow).
    if (err instanceof OAuthRebindConflictError) {
      appendClearCookies(c);
      log.info({
        event: 'oauth_rebind_conflict',
        sub,
      });
      const conflictURL = new URL(
        '/auth/conflict?reason=device_binding_conflict',
        env.PUBLIC_APP_URL,
      ).toString();
      return c.redirect(conflictURL, 302);
    }
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
  const { playerId, consolidatableDeviceBindingId, rebindOccurred } = lookupResult;

  // ---- 8. Issue session
  const session = await createSession(playerId, {
    userAgent: c.req.header('user-agent') ?? '',
    ip: c.req.header('x-forwarded-for') ?? '',
  });

  // ---- 8.5. T3-7 device_binding consolidation — UPDATE the row's
  // session_id ONLY if the lookup function returned a non-null
  // `consolidatableDeviceBindingId`. Quadruple-WHERE guard is
  // defense-in-depth: under any race (concurrent UPDATE, foreign tenant
  // leak, rebind theft) the UPDATE becomes a no-op rather than
  // overwriting another player's binding.
  if (consolidatableDeviceBindingId !== null) {
    const updateRes = await db
      .update(deviceBindings)
      .set({ sessionId: session.sessionId })
      .where(
        and(
          eq(deviceBindings.id, consolidatableDeviceBindingId),
          eq(deviceBindings.playerId, playerId),
          eq(deviceBindings.tenantId, DEVICE_TENANT_ID),
          // session_id IS NULL — the rebind candidate state. If a racer
          // already set session_id, do nothing.
          isNull(deviceBindings.sessionId),
        ),
      );
    // Drizzle/libsql exposes `rowsAffected` on update results; defensively
    // coerce in case the field name differs across libsql patch versions.
    const affected =
      typeof (updateRes as { rowsAffected?: unknown }).rowsAffected === 'number'
        ? (updateRes as { rowsAffected: number }).rowsAffected
        : null;
    log.info({
      event: 'device_binding_consolidated',
      playerId,
      deviceBindingId: consolidatableDeviceBindingId,
      sessionId: session.sessionId,
      rebindOccurred,
      affectedRows: affected,
    });
  }

  // ---- 9. Emit 3 Set-Cookie headers (session + 2 clears) + 302 home
  c.header('Set-Cookie', session.setCookieHeader, { append: true });
  appendClearCookies(c);
  const homeURL = new URL('/', env.PUBLIC_APP_URL).toString();
  return c.redirect(homeURL, 302);
});

// ---------------------------------------------------------------------
// POST /api/auth/that-is-not-me — T3-7 escape hatch.
//
// Deletes the current session row + the device_binding row referenced by
// the device cookie (if any), then emits clear-cookie Set-Cookies for both
// session + device cookies. Tenant-scoped per spec to avoid cross-tenant
// device-binding deletion via leaked UUIDs (defense for v1.5+ multi-tenant).
// ---------------------------------------------------------------------
authRouter.post('/that-is-not-me', requireSession, async (c) => {
  const log = c.get('logger');
  const sessionData = c.get('session');
  const currentSessionId = sessionData.sessionId;

  // 1. DELETE the current session row.
  await db.delete(sessions).where(eq(sessions.sessionId, currentSessionId));

  // 2. Read device cookie + DELETE matching device_binding row (tenant-scoped).
  const deviceCookieValue = extractCookie(
    c.req.header('cookie') ?? '',
    DEVICE_COOKIE_NAME,
  );
  let deviceDeleted = false;
  if (deviceCookieValue !== null && UUID_RE.test(deviceCookieValue)) {
    const deleteRes = await db
      .delete(deviceBindings)
      .where(
        and(
          eq(deviceBindings.id, deviceCookieValue),
          eq(deviceBindings.tenantId, DEVICE_TENANT_ID),
        ),
      );
    const affected =
      typeof (deleteRes as { rowsAffected?: unknown }).rowsAffected === 'number'
        ? (deleteRes as { rowsAffected: number }).rowsAffected
        : 0;
    deviceDeleted = affected > 0;
  }

  // 3. Emit clear-cookie Set-Cookies for BOTH cookies. Append semantics
  // mandatory — Hono's default `c.header` SETS (overwrites), so the
  // second call would clobber the first without `{ append: true }`.
  c.header('Set-Cookie', sessionCookieHeader(null), { append: true });
  c.header('Set-Cookie', deviceCookieClearHeader(), { append: true });

  log.info({
    event: 'that_is_not_me',
    playerId: sessionData.playerId,
    sessionId: currentSessionId,
    deviceCookiePresent: deviceCookieValue !== null,
    deviceBindingDeleted: deviceDeleted,
  });

  // 4. 204 No Content — the client redirects from the success branch.
  return c.body(null, 204);
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

interface LookupOrBindResult {
  playerId: string;
  rebindOccurred: boolean;
  consolidatableDeviceBindingId: string | null;
}

/**
 * Look up `oauth_identities` by (tenant_id, provider, provider_sub).
 *
 * **Existing T1-6b behavior** (preserved):
 * 1. Outer lookup — returning user → return early.
 * 2. Inside `db.transaction`: inner re-select (race-safe).
 * 3. (Falls through to) INSERT new player + new oauth_identity.
 *
 * **T3-7 step 2.5 — device-binding rebind branch** (NEW):
 * Between the inner re-select miss and the INSERT-new-player path, if
 * `deviceBindingCookieValue` is non-null AND UUID-shaped, look up the
 * `device_bindings` row scoped to (id, tenant_id). If 1 row exists with
 * `session_id IS NULL` (the rebind candidate from T3-6's invite-claim
 * flow), check the player's google identity:
 *   - **Case A** (no google identity): INSERT new oauth_identity binding
 *     the device's player to the SSO sub. UNIQUE-collision retry checks
 *     for race winner; if winner's player_id differs, throw
 *     OAuthRebindConflictError.
 *   - **Case B** (google identity matches the incoming sub): no-op INSERT,
 *     return the device's player as already-bound. Caller still consolidates
 *     session_id (the row's session_id was NULL).
 *   - **Case C** (google identity exists but with a DIFFERENT sub): throw
 *     OAuthRebindConflictError. Two different Google accounts on the same
 *     player is an identity-merge scenario, admin-only.
 *
 * Returns `{ playerId, rebindOccurred, consolidatableDeviceBindingId }`.
 * The caller uses `consolidatableDeviceBindingId !== null` to decide
 * whether to fire the post-session `device_bindings.session_id = ...`
 * UPDATE — gating on the function's return rather than re-reading the
 * cookie keeps the rebind decision and consolidation decision in sync,
 * preventing stale-cookie leak bugs.
 *
 * The `deviceBindingCookieValue` parameter is the cookie's raw string
 * value as extracted by the caller. Pre-validation by the caller is OK
 * but not required — this function applies the UUID-shape guard before
 * any SELECT.
 */
async function lookupOrBindOAuthIdentity(
  sub: string,
  deviceBindingCookieValue: string | null,
): Promise<LookupOrBindResult> {
  // Outer lookup: single round-trip path for returning users.
  // CRITICAL (T3-7 High #1 regression guard): on this branch
  // `consolidatableDeviceBindingId` MUST be null. Even if the device
  // cookie points at some unrelated device_binding row, that row MUST
  // NOT be consolidated under the returning user's session.
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
    return {
      playerId: outer[0].playerId,
      rebindOccurred: false,
      consolidatableDeviceBindingId: null,
    };
  }

  // Cheap UUID-shape guard before any DB lookup. Anything off-shape is
  // treated as no-cookie. SQLite's TEXT-id semantics don't 500 on a
  // malformed value (just returns 0 rows), but the guard keeps bot/garbage
  // traffic from generating noisy SELECT log lines and codifies the
  // "safe no-op" intent for malformed cookies.
  const validatedCookie =
    deviceBindingCookieValue !== null && UUID_RE.test(deviceBindingCookieValue)
      ? deviceBindingCookieValue
      : null;

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
      return {
        playerId: inner[0].playerId,
        rebindOccurred: false,
        consolidatableDeviceBindingId: null,
      };
    }

    // ---- T3-7 step 2.5 — device-binding rebind branch.
    if (validatedCookie !== null) {
      const dbRows = await tx
        .select()
        .from(deviceBindings)
        .where(
          and(
            eq(deviceBindings.id, validatedCookie),
            eq(deviceBindings.tenantId, DEVICE_TENANT_ID),
          ),
        );
      const candidate = dbRows[0];
      if (candidate && candidate.sessionId === null) {
        // Candidate row exists with no session yet — the T3-6 invite-claim
        // path. Check what oauth identities the player already has,
        // scoped to provider='google' (per spec, multi-provider per
        // player is allowed — only Google-vs-Google sub conflicts block).
        const existing = await tx
          .select()
          .from(oauthIdentities)
          .where(
            and(
              eq(oauthIdentities.playerId, candidate.playerId),
              eq(oauthIdentities.provider, 'google'),
              eq(oauthIdentities.tenantId, DEFAULT_TENANT_ID),
            ),
          );
        if (existing.length === 0) {
          // Case A — INSERT a new identity binding the device's player to
          // the SSO sub. Catch UNIQUE → check for race-winner conflict.
          try {
            await tx.insert(oauthIdentities).values({
              id: randomUUID(),
              provider: 'google',
              providerSub: sub,
              playerId: candidate.playerId,
              createdAt: Date.now(),
              tenantId: DEFAULT_TENANT_ID,
              contextId: DEFAULT_CONTEXT_ID,
            });
            return {
              playerId: candidate.playerId,
              rebindOccurred: true,
              consolidatableDeviceBindingId: candidate.id,
            };
          } catch (err) {
            if (!isUniqueConstraintError(err)) {
              throw err;
            }
            // A concurrent first-SSO inserted ahead of us. Re-SELECT
            // and decide: idempotent (same player) or conflict.
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
            const winner = retry[0];
            if (!winner) {
              // Pathological — UNIQUE fired but no row visible.
              throw new Error('oauth_bind_race_retry_empty');
            }
            if (winner.playerId !== candidate.playerId) {
              // The race winner bound the sub to a DIFFERENT player.
              // Treat as Case C — conflict.
              throw new OAuthRebindConflictError();
            }
            // Idempotent — winner is the same player. Treat as Case B.
            return {
              playerId: candidate.playerId,
              rebindOccurred: false,
              consolidatableDeviceBindingId: candidate.id,
            };
          }
        }
        // Case B/C — player already has a Google identity. Compare subs.
        const matching = existing.find((row) => row.providerSub === sub);
        if (matching) {
          // Case B — already bound to this sub. No-op INSERT. Caller
          // still consolidates session_id (still NULL on the device row).
          return {
            playerId: candidate.playerId,
            rebindOccurred: false,
            consolidatableDeviceBindingId: candidate.id,
          };
        }
        // Case C — player has a Google identity with a different sub.
        // Two distinct Google accounts on one player is an identity-merge
        // scenario, admin-only. Reject.
        throw new OAuthRebindConflictError();
      }
      // Either no row found, or the row already has session_id (already
      // consolidated). Fall through to INSERT-new-player path.
    }

    // ---- Step 3 — existing INSERT-new-player path (T1-6b unchanged
    // semantics; just the return shape is wider now).
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
      return {
        playerId: newPlayerId,
        rebindOccurred: false,
        consolidatableDeviceBindingId: null,
      };
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
        return {
          playerId: retry[0].playerId,
          rebindOccurred: false,
          consolidatableDeviceBindingId: null,
        };
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
