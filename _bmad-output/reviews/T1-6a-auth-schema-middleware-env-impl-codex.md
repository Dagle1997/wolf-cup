# Codex Review

- Generated: 2026-04-22T20:33:44.648Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/lib/env.ts, apps/tournament-api/src/lib/session.ts, apps/tournament-api/src/lib/session.test.ts, apps/tournament-api/src/db/schema/players.ts, apps/tournament-api/src/db/schema/oauth_identities.ts, apps/tournament-api/src/db/schema/auth.ts, apps/tournament-api/src/db/schema/index.ts, apps/tournament-api/src/db/migrate.ts, apps/tournament-api/src/db/seed.ts, apps/tournament-api/src/db/migrations/0000_medical_typhoid_mary.sql, apps/tournament-api/src/middleware/require-session.ts, apps/tournament-api/src/middleware/require-session.test.ts

## Summary

Auth schema/session/middleware slice is largely correct and matches the spec-sensitive points you called out (time injection is honored; device_info truncation is enforced + tested; oauth_identities composite UNIQUE index ordering in the generated SQL is correct; FK ON DELETE CASCADE is present). The main concrete issues visible in the provided files are (1) env validation gaps that defeat fail-fast in the exact “compose missing var → empty string” case, and (2) lack of sanitization/validation for cookie Domain/value when constructing Set-Cookie, which can enable header/cookie attribute injection if misconfigured.

Overall risk: medium

## Findings

1. [high] env.ts does not fail-fast on empty DB_PATH and can accept empty PORT as 0
   - File: apps/tournament-api/src/lib/env.ts:40-46
   - Confidence: high
   - Why it matters: Your module comment explicitly relies on docker-compose `${VAR}` with no fallback producing an empty string, which Zod should reject to crash the container at boot. That works for AUTH_COOKIE_DOMAIN (min(1)) and PUBLIC_APP_URL (url()), but DB_PATH is only `z.string()` so an empty string will pass validation. Also, `z.coerce.number().default(3000)` will coerce an empty string (`''`) to `0` (Number('') === 0), which will also pass validation and can lead to binding on an ephemeral port or otherwise surprising behavior instead of failing fast.
   - Suggested fix: Harden the schema for these two fields:
- `DB_PATH: z.string().min(1)` (and/or add a refine to reject whitespace-only)
- `PORT: z.preprocess(v => v === '' ? undefined : v, z.coerce.number().int().min(1).max(65535).default(3000))`
Add a small unit test that sets `process.env.DB_PATH=''` and/or `PORT=''` and asserts env parsing throws, to lock in the compose empty-string behavior.

2. [medium] Set-Cookie header construction does not validate/sanitize Domain (and accepts arbitrary value)
   - File: apps/tournament-api/src/lib/session.ts:163-180
   - Confidence: high
   - Why it matters: `sessionCookieHeader()` concatenates `Domain=${env.AUTH_COOKIE_DOMAIN}` directly into the Set-Cookie header (line 177). If AUTH_COOKIE_DOMAIN is misconfigured to include illegal characters (e.g., `example.com; Path=/; SameSite=None` or CRLF), this becomes cookie attribute/header injection. While the cookie value is currently generated from base64url in createSession, `sessionCookieHeader(value: string | null)` is a general helper and will emit the value unescaped into the header (line 169), which is risky if it is ever called with non-generated input in future changes.
   - Suggested fix: Constrain AUTH_COOKIE_DOMAIN at the env layer and/or sanitize at emit time:
- In env schema: enforce a conservative domain regex (no scheme, no port, no whitespace/control chars, no semicolons), e.g. `z.string().regex(/^[A-Za-z0-9.-]+$/).refine(v => !v.includes('..') && !v.startsWith('.') && !v.endsWith('.'))` as appropriate for your domain policy.
- In `sessionCookieHeader`, consider validating `value` is base64url (or at least does not contain `;` or control chars) before concatenation.
Add a test that proves invalid AUTH_COOKIE_DOMAIN is rejected (or that sessionCookieHeader throws) to prevent regressions.

3. [low] requireSession accepts arbitrarily long/odd cookie values without quick rejection
   - File: apps/tournament-api/src/middleware/require-session.ts:24-47
   - Confidence: medium
   - Why it matters: `extractCookie()` returns whatever substring follows `name=` (lines 55–65) and `validateSession(sessionId)` is called with it (line 37) without any format/length check. This isn’t SQL injection (drizzle `eq` is parameterized), but allowing unbounded cookie values can be used for avoidable work (large header parsing + DB query) and makes behavior around malformed cookies less explicit.
   - Suggested fix: Add a cheap guard in middleware before hitting the DB, e.g. `if (sessionId.length > 128 || !/^[A-Za-z0-9_-]{10,}$/u.test(sessionId)) { clear cookie + 401 session_invalid }` (pick exact bounds to match your 32-byte base64url token length of 43 chars). Add a test for a malformed/oversized cookie resulting in `session_invalid` + clear-cookie.

4. [low] No test locks in production cookie attributes (Secure + Domain) behavior
   - File: apps/tournament-api/src/lib/session.test.ts:140-156
   - Confidence: medium
   - Why it matters: Current tests only assert the non-production branch (NODE_ENV=test) omits Secure/Domain. A future change could accidentally drop Secure/Domain in production without test coverage. Given cookie hardening is a stated concern, this is worth pinning.
   - Suggested fix: Add a test that runs `sessionCookieHeader()` under a mocked `env` where `NODE_ENV='production'` and `AUTH_COOKIE_DOMAIN` is set, and assert `Secure` and `Domain=...` are present. Because env is parsed at module load, this may require importing the module in an isolated module context after setting process.env, or mocking `./env.js` in Vitest.

## Strengths

- AC #8/#9 time-injection requirement appears correctly implemented: helpers accept `now: () => number = Date.now` and use `now()` internally (apps/tournament-api/src/lib/session.ts:55–139), with deterministic boundary tests (session.test.ts:96–126).
- Device info is truncated at storage time to 128 chars (session.ts:63–65) and covered by a dedicated test (session.test.ts:71–76).
- Composite UNIQUE index ordering is correct and matches the spec requirement: migration creates `uniq_oauth_identities_tenant_provider_sub` on (`tenant_id`,`provider`,`provider_sub`) (0000 SQL:12).
- FKs include `ON DELETE cascade` for both oauth_identities.player_id and sessions.player_id (0000 SQL:9,31).
- Middleware behavior matches the described contract: sets `c.set('session', ...)` and `c.set('player', ...)` on success and clears cookie on invalid session (require-session.ts:37–46), with coverage for missing/invalid/valid flows (require-session.test.ts:53–88).

## Warnings

None.
