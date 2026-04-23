# Story T1.6b: Arctic Google SSO (sign-in + callback slice)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want Google OAuth sign-in + callback wired into the tournament-api via `arctic`, binding each Google identity to a new or existing `players` row through the `oauth_identities` table, emitting the `tournament_session` cookie on success,
so that Pinehurst users can sign in with their Google account, and organizer-only routes (T2.3 / T2.5) can enforce auth behind `requireSession` + `requireOrganizer` without further auth infrastructure churn.

**Scope context:** This is the SSO half of the 2026-04-20 T1-6 split. T1-6a shipped the ecosystem-neutral infrastructure (players/oauth_identities/sessions schema, `requireSession` + `requireOrganizer` middleware, `env.ts`, `hono/csrf` globally mounted, Dockerfile migrate+seed+index CMD, `AUTH_COOKIE_DOMAIN` + `PUBLIC_APP_URL` docker-compose env vars, an `authRouter` stub at `src/routes/auth.ts` **not yet mounted**). T1-6b drops arctic-based Google OAuth into that stub and mounts it. Magic-link remains deferred to a future T3.x story once `players.email` lands.

## Explicit Risk Acceptance (spec-gate decision)

**Skipping RS256 signature verification on Google's `id_token`.** This spec's AC #6 step 6 extracts and validates the `sub`, `iss`, `aud`, and `exp` claims from the JWT payload segment but deliberately does NOT verify the RS256 signature against Google's JWKS.

**The honest threat model** (round-6 correction: my earlier framing overstated what signature verification actually buys):

*What the skip DOES still protect against* — arctic's HTTPS fetch to `https://oauth2.googleapis.com/token` uses Node's system trust store (standard HTTPS, no CA pinning). Under a normal network, the token bytes we receive came from Google and weren't altered in flight. Claim-level checks (`iss=accounts.google.com`, `aud=OUR_CLIENT_ID`, `exp>now`) block the obvious reuse cases: another Google-OAuth app's leaked token, an expired token replayed later.

*What signature verification would ADD — with a critical caveat.* The defense signature verification would add ONLY materializes if the JWKS (Google's public keys, fetched from `https://www.googleapis.com/oauth2/v3/certs`) can't be tampered with by the same attacker who's tampering with the token. In practice:

- **Sustained TLS-trust compromise** (attacker has a persistent fraudulent cert for `*.googleapis.com`, OR a compromised CA, OR a compromised outbound proxy on our VPS): attacker MITMs BOTH the token fetch AND the JWKS fetch. They serve a token signed by a key they control and JWKS containing that public key. Signature verification passes. **No defense.**
- **Brief / transient TLS compromise** where the attacker's window is shorter than our JWKS cache TTL (`jose` ships a configurable cache TTL): if the JWKS was last refreshed BEFORE the attacker's window AND the token is verified with those cached keys, forgery fails. **Partial defense** — depends on cache timing.
- **Preloaded/pinned JWKS** (hardcoded Google public keys in our source, updated manually on key rotation): signature verification is fully effective. **Full defense** — but this is maintenance burden Google explicitly discourages (keys rotate on an unpublished cadence).

So: RS256 verification against a dynamically-fetched JWKS is **not a strong defense against the TLS-trust scenarios**. Under sustained compromise it's theater. Under transient compromise it's a cache-timing lottery. Full defense requires key pinning, which is uncommon in practice because Google rotates signing keys on an unpublished cadence and explicitly discourages hardcoding them.

*What signature verification is ACTUALLY strong against* — a scenario the token-only-TLS argument misses:

- **In-process tampering of a cached id_token.** If future code ever stores an id_token and re-reads it later (e.g., persisting raw OAuth response to disk for debugging, or passing it through a message queue), signature verification catches any post-fetch mutation. T1-6b doesn't do this — we consume the token immediately in the callback and only persist the derived `sub` in `oauth_identities` — so this scenario doesn't apply today. But it's the canonical "why signatures exist" argument for defense-in-depth in richer flows.

*Cost of adding verification* — new `jose` (or equivalent) devDep; JWKS cache layer with configurable TTL; ~150 LOC + 4-6 tests. Implementation time: ~3 hours. **Not half a day; prior estimate was padded.**

*Default recommendation for this story* — **skip signature verification.** The defense it adds is (a) fragile under the TLS-trust scenarios that would otherwise motivate it, and (b) unused in our narrow consume-and-derive-sub flow. Tournament app's context (8-player private event, Josh's VPS, `sub` used only for identity binding) makes the marginal security benefit not worth the 3 hours + ongoing dep maintenance.

**Revisit signature verification if:** (a) the app opens to a wider audience, (b) a future story caches/persists raw id_tokens or uses claims beyond `sub` for authorization (e.g., `email_verified`, `hd` for G Suite domain restrictions), or (c) a threat-model review explicitly names TLS-trust-compromise as in-scope (it's not today per the spec's "private tournament" framing).

**Josh's call at spec-gate.** This is a real decision, not a formality. Both options (skip / verify) are defensible. Skip is the path of least resistance for Pinehurst.

## Acceptance Criteria

1. **Given** `apps/tournament-api/package.json`
   **When** inspected post-T1-6b
   **Then** `arctic` is added to `dependencies` at a **concrete caret-ranged version** determined at install time (e.g. `"arctic": "^2.0.0"` if `pnpm view arctic version` reports `2.0.x` as current stable, or whatever the current published major.minor is at impl time). Explicit disallow: `"arctic": "latest"`, `"arctic": "*"`, `"arctic": "next"`. A caret range to the current stable major is the version-pin posture in architecture D2-1 — it locks the major line while still accepting patch/minor updates. Resend and magic-link deps are NOT added (deferred). `pnpm-lock.yaml` is updated by the `pnpm install` that follows — **this is a SHARED gate** (lockfile). No other dep fields change. The `devDependencies` block is byte-unchanged.

2. **Given** `apps/tournament-api/src/lib/env.ts`
   **When** inspected post-T1-6b
   **Then** the Zod schema is EXTENDED (not rewritten) with two new REQUIRED keys:
   - `GOOGLE_OAUTH_CLIENT_ID: z.string().min(1)`
   - `GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1)`
   No defaults on either — same fail-fast posture as T1-6a's `AUTH_COOKIE_DOMAIN` / `PUBLIC_APP_URL`. Existing keys (`NODE_ENV`, `DB_PATH`, `PORT`, `AUTH_COOKIE_DOMAIN`, `PUBLIC_APP_URL`) and their validations are byte-unchanged. `src/test-setup.ts` is extended with placeholder values for both so Vitest module-load continues to pass.

3. **Given** `apps/tournament-api/src/lib/arctic.ts` (new file)
   **When** inspected
   **Then** it instantiates a singleton `Google` OAuth client from `arctic` and exports it. Constructor args: `env.GOOGLE_OAUTH_CLIENT_ID`, `env.GOOGLE_OAUTH_CLIENT_SECRET`, callback URL built via `new URL('/api/auth/google/callback', env.PUBLIC_APP_URL).toString()` — the WHATWG `URL` constructor normalizes away every kind of trailing-slash / double-slash / path-component ambiguity (it's what browsers and Node's http client use). A plain `.replace(/\/$/, '')` only strips ONE trailing slash and would leave `https://example.com//` → `https://example.com/` still malformed; `URL` handles all cases. Export shape: `export const googleOAuth: Google` (or whatever the arctic `Google` type is named at install time — spec is loose here because arctic's export shape has shifted across major versions). No handler logic in this file — pure factory + export.

4. **Given** `apps/tournament-api/src/routes/auth.ts` (already exists as T1-6a stub)
   **When** inspected post-T1-6b
   **Then** the file is AUGMENTED (not rewritten) with two new handlers:
   - `GET /google` — sign-in entry. Generates `state` via `arctic.generateState()` and `codeVerifier` via `arctic.generateCodeVerifier()`. Writes them as short-lived cookies (see AC #5) and redirects 302 to the Google authorization URL (`googleOAuth.createAuthorizationURL(state, codeVerifier, ['openid'])`). **Scope is `'openid'` ONLY** — we never read `email`, `name`, or `picture` claims (the story binds identity by `sub` only). Requesting minimal scope produces a simpler Google consent screen + matches data-minimization best practice. If a future story needs email (e.g., magic-link T3.x), that story adds `'email'` to the scope list at that time.
   - `GET /google/callback` — OAuth callback. See AC #6 for the full flow.
   The existing `GET /status` stub route stays byte-identical.

5. **Given** OAuth state + PKCE intermediate cookies
   **When** emitted by `GET /google` before the redirect
   **Then** two cookies are set on the response:
   - `tournament_oauth_state=<state>; HttpOnly; SameSite=Lax; Path=/; Max-Age=600` (10 min TTL)
   - `tournament_oauth_code_verifier=<codeVerifier>; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`
   Under `env.NODE_ENV === 'production'`: ADD `Secure` AND `Domain=${env.AUTH_COOKIE_DOMAIN}`. **SameSite=Lax (not Strict)** is required per architecture section 404-437: OAuth providers redirect the browser back via a top-level GET navigation from a cross-site origin, and `SameSite=Strict` would strip these cookies on the return. This is the one place in the auth realm that intentionally uses `Lax` — the long-lived `tournament_session` cookie stays `Strict` per T1-6a AC #9.

   **Helper location:** a new `src/lib/oauth-cookies.ts` module owns the emit + clear logic. Exports TWO functions:
   - `oauthFlowCookieHeader(name: 'tournament_oauth_state' | 'tournament_oauth_code_verifier', value: string): string` — emits the set-cookie with Max-Age=600 and the attributes above.
   - `oauthFlowClearHeader(name: 'tournament_oauth_state' | 'tournament_oauth_code_verifier'): string` — emits a clear-cookie with `Max-Age=0` and **the SAME Domain / Secure / Path / SameSite attributes** as the set header. Browsers only remove a cookie when every attribute matches; if the clear omits Domain or Secure in production the original cookie persists. This attribute parity is **required**, not a nice-to-have.

   **Value validation:** PKCE verifier per RFC 7636 uses the charset `[A-Z][a-z][0-9]-._~` (43-128 chars). State from `arctic.generateState()` is base64url. Both `oauthFlowCookieHeader` inputs are validated against `/^[A-Za-z0-9._~-]{16,256}$/` (superset that accepts both) and throw on mismatch — header-injection defense-in-depth. Using the stricter `/^[A-Za-z0-9_-]+$/` from `sessionCookieHeader` would WRONGLY reject valid PKCE verifiers with dots or tildes, so this is a dedicated validator.

6. **Given** `GET /google/callback`
   **When** the handler runs with the provider response
   **Then** the flow is:
   1. **Provider error branch:** If the query string contains `error=`, classify by the specific error code (per OAuth 2.0 RFC 6749 §4.1.2.1):
      - `error=access_denied` → the user clicked Cancel or declined consent. Emit clear-cookies for both intermediates and respond with HTTP 302 redirect to `new URL('/auth/declined', env.PUBLIC_APP_URL).toString()`. Tournament-web ships a matching stub route at `/auth/declined` per AC #19. Do NOT emit a 400 — user intent was "back out," not "bad request."
      - `error=server_error` OR `error=temporarily_unavailable` → Google is having issues. Emit clear-cookies + return 503 `{ error: 'auth_unavailable', code: 'auth_provider_outage', requestId }`. Same treatment as the validateAuthorizationCode fetch-class failure at step 5.
      - Any other `error=` value (e.g., `invalid_request`, `invalid_scope`, `unauthorized_client`, `unsupported_response_type`, `invalid_client` — all indicate misconfiguration on OUR side per OAuth 2.0 RFC) → emit clear-cookies + return 500 `{ error: 'internal', code: 'oauth_provider_error', requestId }` + LOG the raw `error` + `error_description` + `error_uri` query params with the requestId. These codes mean our OAuth client registration is broken and require admin intervention, not a user-facing redirect to a "try again" page (which would loop forever).
   2. **Missing-param branch:** If `code` or `state` is absent from the query (and `error` is also absent), emit clear-cookies for both intermediates and return 400 `{ error: 'bad_request', code: 'oauth_missing_params', requestId }`.
   3. Read both `tournament_oauth_state` + `tournament_oauth_code_verifier` cookies. If either missing → 400 `{ error: 'bad_request', code: 'oauth_cookies_missing', requestId }`. (No clear needed — they were never set.)
   4. If query `state` mismatches the cookie state → emit clear-cookies for both intermediates AND return 400 `{ error: 'bad_request', code: 'oauth_state_mismatch', requestId }`. Plain string equality is sufficient — state has ≥128 bits of entropy; timing attacks are infeasible. Clearing the stale cookies on mismatch prevents a confusing replay on subsequent sign-in attempts.
   5. Call `googleOAuth.validateAuthorizationCode(code, codeVerifier)`. On failure classify:
      - Fetch/network failure OR Google 5xx response (arctic's `ArcticFetchError` or equivalent network-shaped error at install time) → 503 `{ error: 'auth_unavailable', code: 'auth_provider_outage', requestId }` per architecture validation gap #3 + original epic AC #8.
      - Invalid code / state / client error (arctic's `OAuth2RequestError` or equivalent 4xx-shaped error at install time) → 400 `{ error: 'bad_request', code: 'oauth_exchange_failed', requestId }`.
      - Unknown error shape → 503 (fail closed on ambiguity) BUT log at `level: 'error'` with the full error object, `err.stack`, `err.cause` (if present), and requestId. This gives operators a signal that an unknown arctic error shape slipped through — likely a library-version drift or a genuine bug on our side masquerading as a provider outage. The 503 user experience is acceptable for the rare case; the log is the feedback loop for upgrading our classification.
   6. **Extract + validate Google claims from the ID token.** Arctic's token response exposes the raw `id_token` string (exact property name/accessor depends on arctic version — at impl time, check `tokens.idToken` property OR `tokens.idToken()` method; both have existed across arctic majors). The `id_token` is a JWT with three dot-separated base64url segments: `header.payload.signature`. Validate and extract:
      ```ts
      const segs = idToken.split('.');
      if (segs.length !== 3) throw new Error('malformed_jwt');
      // Node's Buffer supports the 'base64url' encoding from v16+. The runtime
      // Dockerfile uses node:22-alpine (per apps/tournament-api/Dockerfile
      // builder + runtime stages), so base64url is guaranteed present.
      const payloadJson = Buffer.from(segs[1], 'base64url').toString('utf-8');
      const claims = JSON.parse(payloadJson) as {
        sub?: unknown; iss?: unknown; aud?: unknown; exp?: unknown;
      };

      // Issuer must be Google
      if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') {
        throw new Error('invalid_iss');
      }
      // Audience must be OUR client ID (prevents stolen-from-other-app tokens).
      // OIDC spec permits `aud` to be a string OR string[]; Google typically
      // returns a single string for id_tokens but the handler must accept both.
      const audMatches = typeof claims.aud === 'string'
        ? claims.aud === env.GOOGLE_OAUTH_CLIENT_ID
        : Array.isArray(claims.aud) && claims.aud.includes(env.GOOGLE_OAUTH_CLIENT_ID);
      if (!audMatches) {
        throw new Error('invalid_aud');
      }
      // Expiration must be in the future (unix seconds, not ms)
      if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) {
        throw new Error('expired');
      }
      // sub: stable user id, the column we bind by
      if (typeof claims.sub !== 'string' || claims.sub.length === 0 || claims.sub.length > 256) {
        throw new Error('malformed_sub');
      }
      const sub = claims.sub;
      ```
      The `iss` + `aud` + `exp` checks are **required**, not optional. Without `aud` check a leaked id_token from any other Google-OAuth app could be replayed against us. Without `exp` check an ancient token could be replayed. The `iss` check is belt-and-suspenders (arctic's HTTPS fetch to Google should already guarantee provenance, but cheap paranoia).

      **RS256 signature verification is INTENTIONALLY SKIPPED.** See the top-level "Explicit Risk Acceptance (spec-gate decision)" section for the honest threat model, the four attack scenarios signature verification would defend against, the realistic cost of adding it (~3 hours), and the triggers that should cause us to revisit. Do not repeat that text here; the risk-acceptance section is the single source of truth for the tradeoff rationale.

      On any validation failure → 502 `{ error: 'upstream_invalid', code: 'oauth_invalid_id_token', requestId }`. Do NOT leak the specific reason (iss/aud/exp/sub) in the response body — log it with requestId but respond generically.
   7. Look up `oauth_identities` by `(tenant_id, provider, provider_sub)` using the composite UNIQUE index (tenant_id = `'guyan'`, provider = `'google'`, provider_sub = `sub`).
      - **Match found** → reuse `player_id` from the matched row.
      - **No match** (first SSO for this Google account) → see AC #9 for the race-safe bind-insert path.
   8. Call `createSession(playerId, { userAgent: c.req.header('user-agent') ?? '', ip: c.req.header('x-forwarded-for') ?? '' })` from T1-6a's `src/lib/session.ts` to create the session row + generate the opaque session token. The returned `Set-Cookie` header is the long-lived Strict session cookie.
   9. Response: HTTP 302 redirect to `new URL('/', env.PUBLIC_APP_URL).toString()` with THREE `Set-Cookie` headers — the session cookie plus the two intermediate-cookie clears emitted via `oauthFlowClearHeader(...)` (AC #5). The `new URL('/', ...)` constructor normalizes away any trailing-slash ambiguity in `PUBLIC_APP_URL`.

   **Emitting multiple Set-Cookie headers in Hono (implementation note, applies to every step above that emits a cookie):** Hono's `c.header(name, value)` by default **overwrites** any prior header with the same name. To emit multiple `Set-Cookie` headers on one response, use the append option: `c.header('Set-Cookie', value, { append: true })`. The first cookie can use the default (no `{ append: true }`) or also use append for consistency — just be sure that *after the first call* every subsequent Set-Cookie uses `{ append: true }`. Alternative: use Hono's `setCookie()` helper from `hono/cookie` which handles append correctly internally. All three cookies in step 9 (session set + state clear + verifier clear) MUST appear in the response.

   **Testing the multi-cookie response:** at least one test in AC #11 must assert all three appear. The ideal API is `res.headers.getSetCookie()` which returns an array — supported in Node 19.7+ (undici response), Vitest's default fetch environment, and the WHATWG Fetch spec as of 2023. If the test runtime doesn't expose it, fall back to iterating the response headers and filtering: `const cookies = [...res.headers.entries()].filter(([k]) => k.toLowerCase() === 'set-cookie').map(([,v]) => v)`. Either approach produces an array; `res.headers.get('set-cookie')` does NOT — it returns a comma-joined string that's ambiguous when cookie values contain expiration dates (which contain commas) and is not a safe assertion target.

7. **Given** `apps/tournament-api/src/app.ts`
   **When** inspected post-T1-6b
   **Then** the `authRouter` is now mounted: `app.route('/api/auth', authRouter)`. The mount path is `/api/auth` so routes appear at `/api/auth/status`, `/api/auth/google`, `/api/auth/google/callback` — consistent with Wolf Cup's `/api/...` convention. CSRF middleware is already mounted globally from T1-6a; it applies to POST/PUT/PATCH/DELETE only so the GET-based OAuth flow is unaffected. No other changes to `app.ts`.

8. **Given** `docker-compose.yml` at repo root (SHARED — explicit user approval required before editing)
   **When** inspected post-T1-6b
   **Then** the `tournament-api` service's `environment:` block is expanded ADDITIVELY with TWO new entries:
   - `GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID}`
   - `GOOGLE_OAUTH_CLIENT_SECRET=${GOOGLE_OAUTH_CLIENT_SECRET}`
   No compose fallback defaults — matches the `AUTH_COOKIE_DOMAIN` / `PUBLIC_APP_URL` posture from T1-6a. Missing `.env.production` values fail fast at Zod parse on container boot. Existing env entries byte-unchanged. Wolf Cup services, tournament-web, networks, and volumes byte-unchanged. **Second and final SHARED edit of this story.**

9. **Given** the first-time SSO bind flow
   **When** Google returns a previously-unseen `sub`
   **Then** the bind is race-safe via a read-then-conditional-write pattern inside a `db.transaction(async (tx) => {...})`:
   1. Inside the transaction, re-SELECT `oauth_identities` by `(tenant_id, provider, provider_sub)` (re-check in case a concurrent request inserted the row between the outer lookup and this tx).
   2. If the SELECT returns a row → reuse its `player_id`, skip both inserts, commit.
   3. If the SELECT returns no row → INSERT `players` row with `id = crypto.randomUUID()` + INSERT `oauth_identities` row binding that player_id to the sub.
   4. **Error classification on INSERT failure:** libsql throws `LibsqlError` with fields observed in practice as `{ code: 'SQLITE_CONSTRAINT', extendedCode: 'SQLITE_CONSTRAINT_UNIQUE', rawCode: 2067 }` on a UNIQUE-index violation. Depending on libsql version, the specific-UNIQUE sentinel may live in `code` OR `extendedCode`. Catch predicate must match **any of**:
      - `err.name === 'LibsqlError'` AND (
          `err.code === 'SQLITE_CONSTRAINT_UNIQUE'` OR
          `err.extendedCode === 'SQLITE_CONSTRAINT_UNIQUE'` OR
          `err.rawCode === 2067`
        )
      The dev agent should verify the exact field shape against libsql's current version at implementation time by triggering a UNIQUE violation in an ad-hoc test and reading the thrown error — DO NOT rely solely on this spec's strings. Any non-matching error → re-throw and let the handler return 500.
   5. On matched UNIQUE violation: re-SELECT once (step 1) and return the found row's `player_id`. If the re-SELECT still returns no row (pathological — means the UNIQUE fired on a column other than the composite, e.g., players.id UUID collision, vanishingly rare), bubble to handler as 500 `{ error: 'internal', code: 'oauth_bind_race', requestId }` + log with context `{ sub, provider: 'google', rawCode }`.

   The composite UNIQUE on `(tenant_id, provider, provider_sub)` + SQLite's write serialization + the re-SELECT-on-conflict pattern is the standard shape for first-write-wins with graceful loser-retry. The UNIQUE also prevents orphaned `players` rows that have no `oauth_identities` binding — the `players` INSERT and `oauth_identities` INSERT are both inside the transaction, so either both land or both roll back.

10. **Given** the returning-user SSO flow
    **When** Google returns a previously-seen `sub`
    **Then** NO new `players` or `oauth_identities` rows are created — the existing `oauth_identities.player_id` is reused. A new `sessions` row IS created (one row per sign-in event). Note: this means a user who signs in from two devices accumulates one session row per device, which is the intended shape — device-specific session revocation becomes possible without cross-device impact.

11. **Given** `apps/tournament-api/src/routes/auth.test.ts` (exists from T1-6a)
    **When** inspected post-T1-6b
    **Then** the existing `GET /status` test stays byte-identical. New tests added (≥12 cases; Vitest unit tests with `arctic` mocked via `vi.mock`):
    - `GET /google` sets both intermediate cookies with correct attributes (dev + prod branches each, including Secure + Domain under prod).
    - `GET /google` redirects 302 to a URL starting with `https://accounts.google.com/` — looser prefix match, not the full `/o/oauth2/v2/auth?` path (arctic may use a different Google auth endpoint path across versions).
    - `GET /google/callback?error=access_denied` → 302 redirect to `${PUBLIC_APP_URL}/auth/declined` + clear-cookie headers for both intermediates.
    - `GET /google/callback` with no `code` and no `error` → 400 `oauth_missing_params`.
    - `GET /google/callback` with missing state cookie → 400 `oauth_cookies_missing`.
    - `GET /google/callback` with state mismatch → 400 `oauth_state_mismatch`.
    - `GET /google/callback` with arctic throwing a fetch-class error → 503 `auth_provider_outage`.
    - `GET /google/callback` with arctic throwing an OAuth2-request-class error → 400 `oauth_exchange_failed`.
    - `GET /google/callback` with malformed `id_token` (missing `sub` claim) → 502 `oauth_invalid_id_token`.
    - `GET /google/callback` happy path, new user: creates exactly 1 player row + 1 oauth_identity row + 1 session row; 302 redirects to `PUBLIC_APP_URL/`; emits 3 Set-Cookie headers (session + 2 clears); each clear carries Max-Age=0 with matching Domain/Secure/Path attribute parity.
    - `GET /google/callback` happy path, returning user: creates 0 new player/oauth_identity rows; creates 1 new session row.
    - `GET /google/callback` race: same `sub` already in oauth_identities when the bind-insert fires → LibsqlError caught → retry SELECT succeeds → reuse player_id; 0 new players rows created; no 500.

12. **Given** `apps/tournament-api/src/lib/arctic.test.ts` (new file)
    **When** inspected
    **Then** at least 2 smoke tests exist:
    - `googleOAuth` is constructable when env is loaded (module-load check).
    - The callback URL is built with no trailing slash regardless of whether `PUBLIC_APP_URL` has one. (Seed `PUBLIC_APP_URL=http://localhost:5173/` via a mocked env module and assert the constructor arg.)

13. **Given** test env plumbing
    **When** `src/test-setup.ts` runs before any test code imports `src/lib/env.ts`
    **Then** it seeds `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` alongside the existing keys. No real credentials — `'test-client-id'` and `'test-client-secret'` placeholder literals.

14. **Given** local execution
    **When** `pnpm -F @tournament/api build` runs
    **Then** it exits 0 and emits `dist/routes/auth.js`, `dist/lib/arctic.js`, and the existing `dist/db/migrate.js` / `dist/db/seed.js` / `dist/index.js` all unchanged in shape.

15. **Given** `pnpm -F @tournament/api typecheck` + `pnpm -F @tournament/api lint`
    **When** run
    **Then** both exit 0 under the existing tsconfig strictness flags.

16. **Given** `pnpm -F @tournament/api test`
    **When** run
    **Then** all T1-6a tests (38) continue to pass AND all new T1-6b tests (≥12 auth route + ≥2 arctic smoke = ≥14) pass. Total ≥52. The buffer above the AC #11 minimum of 12 leaves room for party-review-surfaced extras without having to re-bound the AC.

17. **Given** Wolf Cup workspaces
    **When** `pnpm -F @wolf-cup/engine test` and `pnpm -F @wolf-cup/api test` run post-T1-6b
    **Then** both continue to pass with zero net-negative test count change. Same regression guard as all prior Epic T1 stories.

18. **Given** the first-deploy of T1-6b to production
    **When** the tournament-api container starts
    **Then** migrations are idempotent (no new migrations in this story; T1-6a's 0000 is already applied in prod). The `.env.production` on the VPS MUST contain both `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` before `docker compose up -d --build` runs — missing either → Zod fail-fast → container crash loop → Traefik can't route → `tournament.dagle.cloud` returns 502 until resolved. This is the intended fail-fast behavior; documented as a post-deploy followup.

19. **Given** `apps/tournament-web/src/routes/` (ALLOWED — tournament-web path)
    **When** inspected post-T1-6b
    **Then** a stub route at `/auth/declined` exists that renders a minimal "Sign-in cancelled — try again" message with a single link back to `/`. Shape matches tournament-web's existing TanStack Router conventions (check `apps/tournament-web/src/routes/index.tsx` for the pattern). This page is the 302 target from the callback's provider-declined branch (AC #6 step 1). It can be purely static — no data fetching, no state. The stub ensures that a declined sign-in doesn't land the user on a 404. Polish (better copy, styling) is a future tournament-web story.

## Tasks / Subtasks

- [ ] Task 1: Add `arctic` dep (AC #1) — **SHARED HARD STOP** on pnpm-lock.yaml
  - [ ] Subtask 1.1: Announce intent to add `arctic` to `apps/tournament-api/package.json`'s `dependencies` at a pinned version + run `pnpm install` which will update pnpm-lock.yaml. Wait for Josh's explicit approval.
  - [ ] Subtask 1.2: On approval, pick the current stable arctic version (check `pnpm view arctic version` or similar), add to dependencies with a caret range, run `pnpm install`.

- [ ] Task 2: Extend env.ts (AC #2, #13)
  - [ ] Subtask 2.1: Add GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET to the Zod schema in `src/lib/env.ts`.
  - [ ] Subtask 2.2: Add placeholder values to `src/test-setup.ts`.

- [ ] Task 3: Arctic client singleton (AC #3, #12)
  - [ ] Subtask 3.1: Create `src/lib/arctic.ts` with `googleOAuth` export.
  - [ ] Subtask 3.2: Create `src/lib/arctic.test.ts` with 2 smoke tests.

- [ ] Task 4: OAuth sign-in + callback handlers (AC #4, #5, #6, #9, #10)
  - [ ] Subtask 4.1: Extend `src/routes/auth.ts` with `GET /google` handler.
  - [ ] Subtask 4.2: Extend `src/routes/auth.ts` with `GET /google/callback` handler.
  - [ ] Subtask 4.3: Add the intermediate-cookie helper (either in `src/lib/session.ts` as a peer to `sessionCookieHeader`, or a new `src/lib/oauth-cookies.ts` — dev picks).

- [ ] Task 5: Mount auth router (AC #7)
  - [ ] Subtask 5.1: Add `app.route('/api/auth', authRouter)` to `src/app.ts` after the CSRF mount.

- [ ] Task 6: docker-compose env additions (AC #8) — **SHARED HARD STOP**
  - [ ] Subtask 6.1: Announce the 2 new env-var additions on `tournament-api` service. Wait for Josh's explicit approval before editing.

- [ ] Task 7: Route tests (AC #11)
  - [ ] Subtask 7.1: Extend `src/routes/auth.test.ts` with the 12+ cases from AC #11 (mock arctic via `vi.mock`). Count aligns with AC #11's explicit list; don't stop at 8.

- [ ] Task 8: Local verification (AC #14, #15, #16)
  - [ ] Subtask 8.1: `pnpm -F @tournament/api typecheck` → 0.
  - [ ] Subtask 8.2: `pnpm -F @tournament/api lint` → 0.
  - [ ] Subtask 8.3: `pnpm -F @tournament/api test` → ≥48.
  - [ ] Subtask 8.4: `pnpm -F @tournament/api build` → 0; dist/routes/auth.js + dist/lib/arctic.js emit.

- [ ] Task 9: Wolf Cup regression (AC #17)
  - [ ] Subtask 9.1: `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` → both green, counts unchanged.

- [ ] Task 10: tournament-web /auth/declined stub route (AC #19)
  - [ ] Subtask 10.1: Inspect `apps/tournament-web/src/routes/` for the TanStack Router convention (index.tsx, __root.tsx patterns from T1-3).
  - [ ] Subtask 10.2: Create `apps/tournament-web/src/routes/auth.declined.tsx` with a minimal component rendering a "Sign-in cancelled" message + link to `/`.
  - [ ] Subtask 10.3: Run `pnpm -F @tournament/web build` to verify TSR picks up the new route.

## Dev Notes

- **Why arctic (not a hand-rolled OAuth client):** architecture D2-1 decision — arctic's scope is OAuth flow plumbing only (state, PKCE, token exchange). It does NOT ship a session store (we have our own from T1-6a), does NOT force a specific framework (it's Hono-compatible via generic Request/Response), and has aggressive tree-shaking. Hand-rolling the PKCE + state + token exchange correctly is a foot-gun; arctic handles the tedious parts.

- **Why `SameSite=Lax` on oauth_state + oauth_code_verifier (the ONLY Lax cookies in the auth realm):** OAuth providers redirect the browser back via a top-level GET navigation from a cross-site origin. `SameSite=Strict` would strip these cookies on the return and the callback would 400 `oauth_cookies_missing`. This is a well-known pitfall; the Lax scope is correct and matches the original Story T1.6 AC #4 from the epic. Once the session is bound, the long-lived `tournament_session` cookie stays `SameSite=Strict` (set by T1-6a's `sessionCookieHeader`).

- **Why `/api/auth/*` mount path (not `/auth/*`):** Wolf Cup convention is `/api/...` for all HTTP surfaces. Traefik routes `tournament.dagle.cloud/api/*` to tournament-api. The original epic called it `/auth/*` but that's inconsistent with Wolf Cup + would require Traefik label changes. `/api/auth/*` is the better fit.

- **Why NOT magic-link in T1-6b:** per the 2026-04-20 split + party advisory. Magic-link earns its keep when Thursday-league older members need a sign-in path that doesn't require a Google account. That's v1.5+. T3.1 adds `players.email`; magic-link returns as a T3.x story after that column lands.

- **Why the oauth_identities race retry (AC #9):** Two near-simultaneous first-time sign-ins for the SAME Google account (unlikely but possible — Josh signs in on phone + tablet in the same second) both hit the "no existing row" branch. One wins the UNIQUE insert; the other hits a constraint violation. A single retry-lookup-after-conflict resolves this cleanly. Without the retry, one of the two sign-ins would 500 — bad UX.

- **Why `x-forwarded-for` for IP (AC #6 step 6):** Traefik injects this header with the client IP. Raw `c.req.raw.socket.remoteAddress` would return Traefik's internal Docker IP. The existing `createSession` truncates `(ua + '|' + ip)` to 128 chars, so worst-case over-long X-Forwarded-For values just truncate safely.

- **No `State`/`Code-verifier` helpers in arctic.ts:** the `generateState` / `generateCodeVerifier` functions are pure exports from `arctic` top-level and can be imported directly into `auth.ts`. Putting them in `arctic.ts` would add a layer for no benefit.

- **Callback URL normalization (AC #3):** Critical because Google's OAuth console requires an EXACT redirect URI match. If `PUBLIC_APP_URL` is set with a trailing slash (e.g., `https://tournament.dagle.cloud/`) and we concatenate `/api/auth/google/callback`, naive string concat produces `https://tournament.dagle.cloud//api/auth/google/callback` — double slash, different URI, OAuth registration mismatch, `invalid_grant`. The spec uses `new URL('/api/auth/google/callback', env.PUBLIC_APP_URL).toString()` (WHATWG URL constructor) because it normalizes all trailing-slash, double-slash, and path-component edge cases in one call. A bare `.replace(/\/$/, '')` only handles single trailing slashes and misses `https://example.com//` → `https://example.com/` still-malformed.

- **Wolf Cup isolation (FD-1/FD-2):** T1-6b writes under `apps/tournament-api/**` only, plus TWO SHARED edits — pnpm-lock.yaml (via `pnpm install`) and docker-compose.yml (env vars). Zero writes to `apps/api/**`, `apps/web/**`, `packages/engine/**`.

- **Production readiness assumes Josh has registered `tournament.dagle.cloud` with Google's OAuth console** and populated `.env.production` with the client ID + secret. The first post-merge deploy WILL fail-fast at container boot if those aren't set — that's the intended behavior per the T1-6a `env.ts` posture.

### Project Structure Notes

Shape after T1-6b:
```
apps/tournament-api/
  package.json            # MODIFIED: +arctic dep (caret-ranged)
  src/
    app.ts                # MODIFIED: +app.route('/api/auth', authRouter) mount
    lib/
      arctic.ts           # NEW (googleOAuth singleton + callback URL factory)
      arctic.test.ts      # NEW (2 smoke tests)
      env.ts              # MODIFIED: +GOOGLE_OAUTH_CLIENT_ID + _SECRET keys
      oauth-cookies.ts    # NEW (oauthFlowCookieHeader + oauthFlowClearHeader)
      oauth-cookies.test.ts # NEW (attribute parity tests)
    routes/
      auth.ts             # MODIFIED: +GET /google, +GET /google/callback
      auth.test.ts        # MODIFIED: +12 cases
    test-setup.ts         # MODIFIED: +2 placeholder env values
apps/tournament-web/
  src/routes/
    auth.declined.tsx     # NEW (stub page for OAuth-declined redirect)
docker-compose.yml        # MODIFIED (SHARED, +2 env vars on tournament-api)
pnpm-lock.yaml            # MODIFIED (SHARED, +arctic transitive deps)
```

**Explicitly NOT in T1-6b (reserved for future):**
- Magic-link (`magic_link_tokens` table, Resend SDK dep, rate limiting, `/auth/magic-link/send` + `/auth/magic-link/consume` routes) — deferred past Epic T1
- Apple SSO (would add a second arctic provider + `'apple'` to the oauth_identities provider enum)
- Organizer-role promotion UI (T2.2 writes the Josh-as-organizer row; in-app admin flip is a future admin-tools story)
- Sign-out endpoint — low priority until the PWA has a sign-out button; can live in a T3.x story or be added here if the 30-min cost is acceptable

### References

- T1-6a shipped: `apps/tournament-api/src/db/schema/{players,oauth_identities,auth}.ts`, `src/lib/{env,session}.ts`, `src/middleware/require-*.ts`, `src/routes/auth.ts` (stub), migration 0000.
- Supersession context: `_bmad-output/implementation-artifacts/tournament/T1-6-auth-realm-sso-magic-link.md` (banner-only).
- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` lines 486-544 (unified T1.6; T1-6b inherits the SSO-specific ACs: #3 session cookie scope, #4 intermediate cookies, #8 provider-outage 503, #10 first-bind player creation, part of #11 deps posture).
- Architecture §Authentication & Security: `_bmad-output/planning-artifacts/tournament/architecture.md` lines 404-437 (SameSite matrix, session cookie scoping).
- D2-1 (arctic selection): architecture.md step-04.
- D2-4 (session lifetime — already implemented in T1-6a).
- FD-4 (identity anchor shape), FD-6 (ecosystem tenant/context).
- Arctic library: https://arctic.js.org — use the Google provider.
- T1-6a spec codex rounds 1-4 that shaped the infrastructure this story builds on: `_bmad-output/reviews/T1-6a-auth-schema-middleware-env-spec-codex*.md`.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
