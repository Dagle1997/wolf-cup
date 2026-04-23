# Codex Review

- Generated: 2026-04-23T13:52:12.089Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/auth.ts, apps/tournament-api/src/routes/auth.test.ts, apps/tournament-api/src/lib/oauth-cookies.ts, apps/tournament-api/src/lib/oauth-cookies.test.ts, apps/tournament-api/src/lib/arctic.ts, apps/tournament-api/src/lib/arctic.test.ts, apps/tournament-api/src/lib/env.ts, apps/tournament-api/src/test-setup.ts, apps/tournament-api/src/app.ts, apps/tournament-api/package.json, apps/tournament-web/src/routes/auth.declined.tsx, docker-compose.yml

## Summary

All 4 round-1 fixes appear correctly applied:
- UNIQUE predicate widened with a generic `code === 'SQLITE_CONSTRAINT'` fallback (auth.ts) and pinned by stricter error-shape tests including generic-only + drizzle-wrapped variants (auth.test.ts).
- `/google/callback` now clears intermediate cookies on token-exchange failures (all catch branches) and on id_token-claim validation failure; tests assert clear-cookie behavior for OAuth2RequestError.
- New callback error-branch tests for `temporarily_unavailable → 503 auth_provider_outage` and for unknown validateAuthorizationCode error → 503 + console.error.

No new High/Medium issues are evident in the provided diff/content. PASS (zero new High/Med findings).

Overall risk: low

## Findings

1. [low] Test helper `getSetCookies` fallback can miss cookies if runtime merges multiple Set-Cookie headers and lacks `headers.getSetCookie()`
   - File: apps/tournament-api/src/routes/auth.test.ts:100-122
   - Confidence: medium
   - Why it matters: Several assertions use `cookies.find((c) => c.startsWith('cookie_name='))`. If the underlying `Headers` implementation merges multiple `Set-Cookie` headers into a single comma-joined string and does not expose `getSetCookie()`, the second cookie will not start at index 0 and these tests can fail (or, worse, silently not assert what they think they are asserting). This is a test reliability/portability risk across Node/undici versions and other fetch implementations.
   - Suggested fix: Prefer `headers.getSetCookie()` when available (already done), but make the fallback robust. Options: (1) require a Node/undici version that supports `getSetCookie()` in CI via an engines field / CI config, or (2) use a dedicated Set-Cookie parser (e.g. `set-cookie-parser`) to split the merged header safely (handling `Expires=...` commas), or (3) in the fallback, avoid `startsWith` and instead search for `;`-delimited cookie name occurrences within the merged string.

2. [low] Intermediate OAuth cookies are not cleared on bind/session issuance failures (500 paths)
   - File: apps/tournament-api/src/routes/auth.ts:199-221
   - Confidence: high
   - Why it matters: You now clear cookies on provider errors, missing params, state mismatch, token-exchange failures, and id_token validation failures. However, if `lookupOrBindOAuthIdentity` throws (oauth_bind_race 500) or `createSession` were to throw, the response does not clear the intermediate cookies. This can leave stale state/verifier cookies in the browser for up to 10 minutes, potentially confusing retries or causing harder-to-debug behavior during intermittent DB outages.
   - Suggested fix: In the `catch` for lookup/bind (and optionally around `createSession`), call `appendClearCookies(c)` before returning the error response. This keeps the “clear on any failure past state validation” policy consistent.

## Strengths

- The UNIQUE-violation predicate is now both more robust (generic fallback) and tightly pinned by tests to the libsql@0.17 observed error shape, including drizzle wrapping via `.cause` and a negative case for SQLITE_BUSY.
- Cookie-clearing behavior is now covered for the previously-missed failure paths (token exchange + id_token validation), reducing stale-cookie retry bugs.
- Good branch coverage on OAuth callback error taxonomy, including provider `temporarily_unavailable` and unknown error-shape logging assertions.
- Env schema now fails fast for required Google OAuth credentials; docker-compose wiring matches that posture.

## Warnings

- Git diff was truncated for the review request.
