# Codex Review

- Generated: 2026-04-22T20:58:35.113Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T1-6b-arctic-google-sso.md

## Summary

Spec is broadly coherent and within FD-1/FD-2 scope (tournament-api + two SHARED edits only). Main correctness/implementability risks are around (1) how `sub` is extracted from Google’s response (AC#6 step 4) and what Arctic actually returns, (2) cookie clearing semantics (must match Domain/Secure/Path or clears can fail in prod), and (3) incomplete callback error handling (e.g., `error=access_denied`). Race-retry (AC#9) is directionally correct but underspecified for Drizzle/SQLite error detection and transactional behavior.

Requested checkpoints:
- A (race retry): intent is fine, but the “retry once on UNIQUE violation” path needs concrete error identification and transaction semantics spelled out for Drizzle/SQLite.
- B (decode `sub`): base64url-decoding JWT payload is only possible if you have the raw `id_token` string; the spec asserts an Arctic API surface (`tokens.idToken()`) that may not match reality and omits any claim checks. This is the biggest “may not be implementable as written” area.
- C (SameSite=Lax): correct for top-level GET OAuth callbacks; matrix rationale is sound.
- D (tests): missing explicit handling/tests for provider callback `error` params (user declined), plus some common missing-param cases.
- E (pinned vs ranged): spec language is ambiguous; `^2.0.0` is not a pin.
- F (SHARED order): acceptable, but note docker-compose change may be needed earlier for anyone testing via compose.
- G (callback URL normalization): `replace(/\/$/, '')` only fixes a single trailing slash and doesn’t validate/normalize other malformed bases; redirect construction has similar double-slash risk.
- H (redirect to `${PUBLIC_APP_URL}/`): assumes a `/` route and can create `//` if PUBLIC_APP_URL already ends with `/`.
- I (test count): exact 10-new-tests budget leaves no buffer; not a bug but a planning risk.
- J (allowlist): OK.
- K (sign-out deferred): acceptable per scope, but if “Pinehurst May-7 readiness” truly requires it, that’s a product call.
- L (layering): spec assumes T1-6a shapes (`createSession` signature, oauth_identities UNIQUE, etc.); if any differ, dev will hit friction—consider tightening to the actual exported signatures/types from T1-6a.

Overall risk: medium

## Findings

1. [high] AC#6 step 4 likely mismodels Arctic token API + ID token handling; spec may be non-implementable as written
   - File: _bmad-output/implementation-artifacts/tournament/T1-6b-arctic-google-sso.md:52-56
   - Confidence: medium
   - Why it matters: The spec asserts: `validateAuthorizationCode` returns `tokens` with `.idToken()` and instructs base64url-decoding the JWT middle segment to extract `sub`. If Arctic’s returned token object does not expose the raw `id_token` via that method name/signature (library APIs vary), the handler can’t be implemented as specified. Even if `id_token` is available, blindly decoding without checking basic claims (at least presence, JSON parse, possibly `iss`/`aud`/`exp`) can create brittle behavior and unclear failure modes. This is the most likely area to cause dev churn or incorrect auth binding.
   - Suggested fix: Confirm Arctic’s actual Google provider return type/methods (e.g., whether it exposes `id_token` as a property, a method with a different name, or not at all). Update AC#6.4 to match the real API surface. If Arctic does not provide parsed claims, explicitly specify: (a) decode `id_token` payload from the raw string (with robust base64url + JSON parse), and (b) minimally validate expected JWT shape and required claims (at least `sub` presence; ideally also check `iss`/`aud` matches client id and `exp` not expired). Alternatively, use Google’s UserInfo endpoint with the access token to obtain a stable subject identifier and avoid JWT parsing in-app.

2. [high] Intermediate cookie clearing in callback is underspecified; missing Domain/Secure/Path parity can prevent deletion in production
   - File: _bmad-output/implementation-artifacts/tournament/T1-6b-arctic-google-sso.md:39-61
   - Confidence: high
   - Why it matters: AC#6 step 6/7 requires “two clearing cookies (state + code_verifier set to `Max-Age=0`)”, but does not require that the clear cookies use the same `Domain`, `Path`, and `Secure` attributes as the originals from AC#5. In browsers, a cookie delete must match the original cookie’s scoping attributes; otherwise the old cookie can persist. That can lead to repeated `oauth_state_mismatch` / `oauth_cookies_missing` loops and, worse, stale-state reuse across attempts.
   - Suggested fix: Amend AC#6 to require the clear cookies be emitted via the same helper as set-cookies (same `Path=/`, and in production also same `Domain=${AUTH_COOKIE_DOMAIN}` and `Secure`). Consider clearing on *all* terminal callback outcomes (success and error) to avoid sticky/broken flows.

3. [medium] Callback does not specify handling of provider-declined flows (`error=access_denied`); missing ACs + tests
   - File: _bmad-output/implementation-artifacts/tournament/T1-6b-arctic-google-sso.md:47-93
   - Confidence: high
   - Why it matters: OAuth providers commonly redirect back with `?error=access_denied` (and no `code`) when the user declines consent. The spec currently only addresses `code/state` and Arctic exchange errors. Without explicit handling, the implementation will likely return a generic 400 (or even misclassify), and may not clear intermediate cookies, leaving the user stuck until TTL expiry.
   - Suggested fix: Add an explicit step early in AC#6: if `error` query param exists, return a deterministic response (either 302 back to `PUBLIC_APP_URL` with an error indicator, or a 400 with a specific code like `oauth_denied`) and clear intermediate cookies. Add a dedicated test case for `error=access_denied` (and optionally `error_description`).

4. [medium] AC#9 race retry is conceptually fine but underspecified for Drizzle/SQLite error detection and transaction behavior
   - File: _bmad-output/implementation-artifacts/tournament/T1-6b-arctic-google-sso.md:73-76
   - Confidence: medium
   - Why it matters: “Retry once on UNIQUE constraint violation” depends on reliably detecting the unique constraint error thrown by the underlying SQLite driver used by Drizzle (error codes/messages vary), and ensuring the transaction fully rolled back (so no orphan `players` row). The spec doesn’t define which error(s) qualify for retry, how to distinguish from other failures, nor where the retry occurs relative to `db.transaction(...)` boundaries.
   - Suggested fix: Tighten AC#9 to specify: catch only UNIQUE violations on `(tenant_id, provider, provider_sub)` (e.g., SQLite `SQLITE_CONSTRAINT_UNIQUE` / constraint name if available), then perform exactly one subsequent `SELECT` lookup outside the failed transaction; otherwise rethrow and return 500. Explicitly note that the transaction inserts `players` first, then `oauth_identities`, and relies on rollback to avoid orphan rows.

5. [medium] Callback/redirect URL normalization is incomplete; `.replace(/\/$/, '')` does not fully prevent double-slash issues and redirect target can produce `//`
   - File: _bmad-output/implementation-artifacts/tournament/T1-6b-arctic-google-sso.md:28-31
   - Confidence: high
   - Why it matters: AC#3 claims `.replace(/\/$/, '')` ensures concatenation “never produces `//api/auth/...`”, but it only removes one trailing slash and does nothing for malformed bases (e.g., `https://example.com//`). Separately, AC#6 step 7 redirects to `${PUBLIC_APP_URL}/` which can itself produce a double slash if `PUBLIC_APP_URL` already ends with `/`. Redirect URI exact-match sensitivity is a known Google OAuth pitfall, so normalization needs to be correct and symmetric.
   - Suggested fix: Use a more robust normalization (e.g., `replace(/\/+$/, '')`) or construct via `new URL('/api/auth/google/callback', env.PUBLIC_APP_URL).toString()` with an explicit constraint that `PUBLIC_APP_URL` must be an origin (no path). Apply the same normalization when building the post-login redirect (either redirect to normalized base without forcing a trailing `/`, or normalize before appending). Update smoke test(s) accordingly.

6. [medium] Dependency version requirement is ambiguous: “pinned/ranged” conflicts with the example `^2.0.0` (not pinned)
   - File: _bmad-output/implementation-artifacts/tournament/T1-6b-arctic-google-sso.md:17-20
   - Confidence: high
   - Why it matters: AC#1 mixes two different policies: “pinned” (exact) and “ranged” (caret/tilde). The example explicitly uses a caret range (`^2.0.0`). If architecture/D2-1 actually requires pinned versions for prod stability, the story as written permits non-pins. Conversely, if ranges are acceptable, calling them “pinned” will create review friction.
   - Suggested fix: Get a decision from Josh/architecture owner: either require an exact version (e.g., `"arctic": "2.0.0"`) or explicitly allow caret/tilde ranges while banning `latest/*`. Update AC#1 language to match the chosen policy unambiguously.

7. [low] Cookie value regex guard may be too strict for PKCE verifier/state depending on Arctic implementation
   - File: _bmad-output/implementation-artifacts/tournament/T1-6b-arctic-google-sso.md:45-46
   - Confidence: medium
   - Why it matters: AC#5 requires a cookie-value regex `/^[A-Za-z0-9_-]+$/`. PKCE code verifiers are allowed to include additional unreserved characters (notably `.` and `~`). If Arctic ever emits verifiers/states outside this restricted base64url alphabet, the helper would throw and break sign-in.
   - Suggested fix: Verify Arctic’s `generateCodeVerifier()` / `generateState()` output character set. If not guaranteed base64url-only, widen the allowlist to RFC7636 unreserved (e.g., `/^[A-Za-z0-9\-._~]+$/`) while still rejecting semicolons/whitespace to prevent header injection.

8. [low] Test plan misses several realistic callback input-shape cases and cleanup behavior
   - File: _bmad-output/implementation-artifacts/tournament/T1-6b-arctic-google-sso.md:81-93
   - Confidence: high
   - Why it matters: AC#11 covers many key paths but omits: missing `code` query param, missing `state` query param, missing `tournament_oauth_code_verifier` cookie specifically, and any assertions that intermediate cookies are cleared on error paths (not just success). These are common regressions in OAuth flows and directly impact UX and supportability.
   - Suggested fix: Add tests for: (1) missing `code` -> 400 deterministic code, (2) missing query `state` -> 400 deterministic code, (3) missing verifier cookie -> 400 `oauth_cookies_missing`, and (4) verify intermediate cookies are cleared on at least the major error outcomes (state mismatch, exchange failed, access_denied if added).

9. [low] Post-login redirect assumes front-end `/` route exists and forces trailing slash; may conflict with `PUBLIC_APP_URL` semantics
   - File: _bmad-output/implementation-artifacts/tournament/T1-6b-arctic-google-sso.md:60-61
   - Confidence: medium
   - Why it matters: AC#6 step 7 hardcodes redirect to `${PUBLIC_APP_URL}/`. If `PUBLIC_APP_URL` is already a fully-qualified base with a trailing slash, this can generate `//`. If `PUBLIC_APP_URL` is ever configured with a path (e.g., `https://host/app`), appending `/` might not be desired. Also, if tournament-web doesn’t serve `/`, users will land on 404 after successful auth.
   - Suggested fix: Clarify whether `PUBLIC_APP_URL` is (a) an origin only, or (b) may include a path. If origin-only, normalize and redirect to the normalized base without forcing an extra `/`. If a path is allowed, use `new URL('.', PUBLIC_APP_URL)` or similar. Add an AC note confirming tournament-web has a landing route at `/` (or specify the correct landing route).

## Strengths

- Clear FD-1/FD-2 scoping: tournament-api only plus explicitly gated SHARED edits (lockfile + docker-compose), and no Wolf Cup surface touches.
- SameSite rationale is correct for OAuth callback behavior; explicitly keeps the long-lived session cookie Strict while allowing only the short-lived OAuth intermediates to be Lax.
- Error taxonomy is mostly concrete (400 vs 503) and aligns with an outage posture; test gates and total-test-count guardrails are explicit.
- Transaction + composite UNIQUE constraint approach for first-bind is the right direction and avoids orphan identity bindings when implemented with proper rollback/error matching.

## Warnings

None.
