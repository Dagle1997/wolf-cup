# Codex Review

- Generated: 2026-04-22T20:36:40.681Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/lib/env.ts, apps/tournament-api/src/lib/session.ts, apps/tournament-api/src/lib/session.test.ts, apps/tournament-api/src/middleware/require-session.ts

## Summary

Round-1 items #1–#4 appear closed as described: DB_PATH no longer accepts empty string; PORT no longer coerces empty string to 0 (whitespace-only is handled via trim); AUTH_COOKIE_DOMAIN is constrained to a safe attribute-like token; requireSession now cheap-rejects out-of-shape cookie values; and tests lock production cookie attributes + header-injection guard.

No new security regressions observed. Remaining notes are mostly low-risk footguns around (a) allowing non-null empty cookie values and (b) potential test pollution if the production-cookie test fails before cleanup, plus a small config-validation edge for whitespace-only DB_PATH.

Overall risk: low

## Findings

1. [medium] Production-cookie test can leak mocked env module if the test throws before cleanup
   - File: apps/tournament-api/src/lib/session.test.ts:167-191
   - Confidence: high
   - Why it matters: The test relies on inline cleanup (doUnmock + resetModules) at the end. If any assertion or the dynamic import throws before lines 189–190 run, the mocked ./env.js and/or reset module state may persist in the current Vitest worker, potentially impacting later tests executed in the same worker (including other files, depending on Vitest config). This is a correctness/stability risk for the test suite (order-dependent failures).
   - Suggested fix: Wrap the mocking/import/assert block in try/finally and always run cleanup in finally, or move cleanup into afterEach/afterAll. Example:

```ts
vi.resetModules();
vi.doMock('./env.js', ...);
try {
  const { sessionCookieHeader } = await import('./session.js');
  ...assert...
} finally {
  vi.doUnmock('./env.js');
  vi.resetModules();
}
```

2. [low] sessionCookieHeader permits non-null empty string, which sets a long-lived empty cookie instead of clearing
   - File: apps/tournament-api/src/lib/session.ts:154-183
   - Confidence: high
   - Why it matters: COOKIE_VALUE_RE uses `*`, so `sessionCookieHeader('')` is accepted and results in `Max-Age=604800` with an empty value (because only `null` triggers Max-Age=0). This isn’t a header-injection issue, but it is a behavioral footgun: a caller intending to clear the cookie but passing '' will instead set a persistent empty cookie. Your middleware treats an empty cookie value as missing (apps/tournament-api/src/middleware/require-session.ts:73), so this can create confusing client behavior (cookie persists but user is always unauthenticated).
   - Suggested fix: Either (a) treat '' as clear-cookie (same as null), or (b) disallow '' when value is non-null:

```ts
if (value === '') throw new Error(...);
// or
const COOKIE_VALUE_RE = /^[A-Za-z0-9_-]+$/; // and special-case null
```


3. [low] DB_PATH validation still allows whitespace-only values
   - File: apps/tournament-api/src/lib/env.ts:40-52
   - Confidence: high
   - Why it matters: `DB_PATH: z.string().min(1)` rejects '' but accepts '   '. In a misconfigured compose/env scenario, this could lead to opening/creating a database at a surprising path (e.g., a file literally named spaces) rather than failing fast like the comment intends.
   - Suggested fix: Apply a trim preprocess similar to PORT, e.g.:

```ts
DB_PATH: z.preprocess(v => typeof v === 'string' ? v.trim() : v, z.string().min(1))
```


4. [low] AUTH_COOKIE_DOMAIN allows underscores, which may cause cookies to be ignored by some clients
   - File: apps/tournament-api/src/lib/env.ts:58-65
   - Confidence: medium
   - Why it matters: The regex `^[A-Za-z0-9._-]+$` explicitly permits `_`. Many user agents treat underscores as invalid in hostnames/domain attributes, which can lead to the cookie not being set in production if someone configures an underscore-containing domain. This is not an injection vector (you’ve closed that), but it is a deploy-time correctness risk.
   - Suggested fix: If you don’t need underscores, remove them and consider a stricter hostname/domain validation (allow `localhost` explicitly if needed). At minimum, change the character class to exclude `_` and consider rejecting values that start/end with '.' or '-' or contain consecutive dots.

## Strengths

- PORT preprocessing correctly treats whitespace-only strings as undefined (apps/tournament-api/src/lib/env.ts:48-52), avoiding the empty-string→0 coercion pitfall.
- AUTH_COOKIE_DOMAIN is now constrained to a safe token and combined with cookie-value validation, closing the Set-Cookie attribute/header injection avenue (apps/tournament-api/src/lib/env.ts:58-65; apps/tournament-api/src/lib/session.ts:154-179).
- requireSession’s pre-DB shape check addresses the “arbitrarily long/odd cookie values” concern and clears the cookie on invalid shape (apps/tournament-api/src/middleware/require-session.ts:37-44).
- Added tests cover both the production attribute branch and the header-injection guard throw behavior (apps/tournament-api/src/lib/session.test.ts:158-191).

## Warnings

None.
