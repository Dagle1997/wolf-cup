# Codex Review

- Generated: 2026-04-23T13:47:53.908Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/package.json, apps/tournament-api/src/app.ts, apps/tournament-api/src/lib/env.ts, apps/tournament-api/src/lib/arctic.ts, apps/tournament-api/src/lib/arctic.test.ts, apps/tournament-api/src/lib/oauth-cookies.ts, apps/tournament-api/src/lib/oauth-cookies.test.ts, apps/tournament-api/src/routes/auth.ts, apps/tournament-api/src/routes/auth.test.ts, apps/tournament-api/src/test-setup.ts, apps/tournament-web/src/routes/auth.declined.tsx, docker-compose.yml

## Summary

Implements Google OAuth sign-in + callback with Arctic, intermediate PKCE/state cookies, and session issuance. Cookie attribute parity and multi-Set-Cookie handling look correct. Main shipping risk is the UNIQUE-violation predicate: it likely won’t match the libsql/drizzle error shape described in the spec (code='SQLITE_CONSTRAINT' + extendedCode='SQLITE_CONSTRAINT_UNIQUE'), which can break the race-safe bind retry path. Some AC #6 branches are implemented but not covered by tests (notably temporarily_unavailable and unknown validateAuthorizationCode error).

Overall risk: medium

## Findings

1. [high] UNIQUE-violation detection likely wrong for the spec’s real libsql error shape (code='SQLITE_CONSTRAINT')
   - File: apps/tournament-api/src/routes/auth.ts:44-408
   - Confidence: high
   - Why it matters: AC #9/critical focus area #1: Drizzle 0.45 wraps the LibsqlError on `.cause`, and the spec calls out the real sentinels as `code='SQLITE_CONSTRAINT'`, `extendedCode='SQLITE_CONSTRAINT_UNIQUE'`, `rawCode=2067`. Your predicate only matches `code === 'SQLITE_CONSTRAINT_UNIQUE'` OR `extendedCode === 'SQLITE_CONSTRAINT_UNIQUE'` OR `rawCode === 2067` (lines 400-407). If libsql/drizzle reports the generic `code='SQLITE_CONSTRAINT'` without `rawCode` (or with a different rawCode exposure), the handler will fail to recognize the race, won’t re-SELECT, and will bubble as a 500 `oauth_bind_race` instead of successfully binding to the concurrently-created identity.
   - Suggested fix: Broaden `checkUniqueSentinels` to accept the generic code case too, e.g. treat `code === 'SQLITE_CONSTRAINT'` as a match when `extendedCode === 'SQLITE_CONSTRAINT_UNIQUE'`, and consider also matching common libsql message patterns as a last resort. Also consider walking `.cause` recursively (a small loop) since wrapping depth can change. Update the error-shape test to assert the spec’s exact shape (code generic + extendedCode unique + rawCode 2067) rather than allowing only the current “any one sentinel” heuristic.

2. [medium] The UNIQUE-violation test does not actually pin the spec’s “code=SQLITE_CONSTRAINT” scenario; it may allow a false sense of safety
   - File: apps/tournament-api/src/routes/auth.test.ts:404-488
   - Confidence: high
   - Why it matters: Critical focus area #1 asks to verify drizzle/libsql wrapping and sentinels. The test asserts that at least one of `{code, extendedCode, rawCode}` equals the UNIQUE sentinel (lines 477-481) and then asserts the handler predicate matches. But it does not assert the presence of the spec-called-out shape `code='SQLITE_CONSTRAINT'` (generic) with `extendedCode='SQLITE_CONSTRAINT_UNIQUE'` on `err.cause`. If a future libsql version returns the generic code without `rawCode`, this test may start failing in production while still passing in CI depending on the driver/runtime.
   - Suggested fix: Make the test assert the *actual* fields observed in this repo’s libsql version, including verifying whether `cause.code` is generic or unique-specific. If it is generic as the spec states, add explicit assertions and update `isUniqueConstraintError` accordingly. If it’s unique-specific today, add a targeted unit test that simulates the generic-code shape and ensure the predicate still matches it.

3. [medium] Callback does not clear oauth intermediate cookies on token-exchange failures (ArcticFetchError/OAuth2RequestError/unknown), leaving stale state/verifier until overwrite/TTL
   - File: apps/tournament-api/src/routes/auth.ts:151-176
   - Confidence: medium
   - Why it matters: Not strictly forbidden by the acceptance text, but it’s a real operational footgun: if the callback fails during `validateAuthorizationCode` (bad code, transient provider issue), the state/verifier cookies remain set. Subsequent callbacks can hit confusing mismatches or repeat failures until the user restarts the flow or the 10-minute TTL expires. You already clear cookies on provider errors, missing params, and state mismatch; clearing here would make behavior consistent and reduce support issues.
   - Suggested fix: In each `catch` branch for `validateAuthorizationCode` (and possibly on id_token validation failure), call `appendClearCookies(c)` before returning. Ensure you keep `append: true` so the clear headers don’t clobber other Set-Cookie values.

4. [medium] Some AC #6 branches are implemented but not covered by route tests (temporarily_unavailable, unknown error)
   - File: apps/tournament-api/src/routes/auth.test.ts:124-534
   - Confidence: high
   - Why it matters: AC #11/critical focus area #8: while you have 17 tests, a couple of specified branches aren’t exercised: provider error `temporarily_unavailable` should yield 503; the “unknown error from validateAuthorizationCode” branch should yield 503 and log. These are exactly the branches that tend to drift/regress during upgrades (Arctic/drizzle/env refactors).
   - Suggested fix: Add targeted tests:
- `/google/callback?error=temporarily_unavailable` → 503 `auth_provider_outage`.
- Make `mockValidateAuthorizationCode` reject with a plain `Error` and assert 503 `auth_provider_outage` (and optionally spy on `console.error` to ensure a log happened).

## Strengths

- Cookie attribute parity for set vs clear is centralized in `oauth-cookies.ts` (single `buildCookie` path) and is explicitly tested in production-mode.
- Multi-cookie `Set-Cookie` emission uses `c.header(..., { append: true })` consistently for both `/google` (2 cookies) and callback success (session + 2 clears).
- id_token claim checks cover iss (both documented Google values), aud (string or array), exp (future), and sub (bounded length), aligning with the intentional “no signature verification” risk acceptance.
- Race-safe bind flow uses outer SELECT, inner SELECT inside transaction, insert, and UNIQUE-catch retry SELECT, including a guard for the pathological retry-empty case.

## Warnings

- Git diff was truncated for the review request.
