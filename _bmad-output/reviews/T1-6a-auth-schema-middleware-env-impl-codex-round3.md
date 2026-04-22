# Codex Review

- Generated: 2026-04-22T20:38:46.422Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/lib/env.ts, apps/tournament-api/src/lib/session.ts, apps/tournament-api/src/lib/session.test.ts, apps/tournament-api/src/middleware/require-session.ts

## Summary

A) Round-2 findings appear closed based on the provided contents:
- Prod-cookie test cleanup: now uses try/finally to always do `doUnmock` + `resetModules` (session.test.ts:176-197).
- `sessionCookieHeader` now rejects empty-string values via `COOKIE_VALUE_RE` tightening to `+` (session.ts:150-180).
- `DB_PATH` now rejects whitespace-only values via `.refine(v => v.trim().length > 0)` (env.ts:45-48).
- `AUTH_COOKIE_DOMAIN` regex no longer permits underscores (env.ts:67-73).

B) No clear new regressions introduced by the tightenings in the shown code/tests. One minor gap remains: `AUTH_COOKIE_DOMAIN` validation is still quite permissive (allows some invalid hostname shapes), which could allow a misconfig to pass validation but later be rejected by browsers.

C) PASS for this commit (with the low-risk note below).

Overall risk: low

## Findings

1. [low] AUTH_COOKIE_DOMAIN regex is permissive enough to allow some invalid hostnames that browsers may reject for cookie Domain
   - File: apps/tournament-api/src/lib/env.ts:67-73
   - Confidence: high
   - Why it matters: The current pattern `/^[A-Za-z0-9.-]+$/` blocks injection characters (good) and blocks underscores (as intended), but it still accepts malformed hostnames such as leading/trailing dots, consecutive dots (`a..b`), or labels starting/ending with hyphen (`-a.example`). If such a value is set in production, env parsing will succeed (fail-fast won’t trigger) but the browser may ignore the cookie, breaking auth in a way that’s harder to diagnose.
   - Suggested fix: If you want env validation to also catch common hostname-shape errors, add a stricter refinement (label-based) while still keeping the injection defense. Example approach: split on '.', ensure each label is 1–63 chars, matches `/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/`, and overall length <= 253. Optionally allow a single-label `localhost` explicitly if you ever run prod-like configs locally.

2. [low] Behavior change: sessionCookieHeader now throws on empty string; add an explicit test to lock in the intended contract
   - File: apps/tournament-api/src/lib/session.test.ts:152-165
   - Confidence: high
   - Why it matters: You intentionally made empty-string cookie values a programmer error (good). However, there’s no explicit test asserting `sessionCookieHeader('')` throws. Without it, a future regex tweak (or accidental regression back to `*`) could reintroduce the bug without failing tests.
   - Suggested fix: Add a small test: `expect(() => sessionCookieHeader('')).toThrow()` near the existing injection-guard test.

## Strengths

- The try/finally around module mocking cleanup in the production cookie test materially reduces cross-test contamination risk (session.test.ts:176-197).
- Good defense-in-depth: cookie value regex prevents delimiter/newline injection into Set-Cookie (session.ts:150-180) and env validation prevents obvious Domain attribute injection (env.ts:57-73).
- DB_PATH whitespace-only rejection closes an easy-to-miss misconfig class (env.ts:45-48).

## Warnings

None.
