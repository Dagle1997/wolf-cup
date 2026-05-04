# Codex Review

- Generated: 2026-05-04T21:19:04.380Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/events.ts, apps/tournament-api/src/routes/events.integration.test.ts, apps/tournament-web/src/routes/events.$eventId.index.tsx, apps/tournament-web/src/routes/events.$eventId.index.test.tsx

## Summary

Implements the requested API endpoint and event home page with generally good invariants (403 no-existence-leak, rounds ordered by round_number, hero/cards render, countdown computed without an interval). Main residual risks are: (1) hard-coded tenant selection in the API route, (2) non-idiomatic/fragile auth redirect in TanStack Router beforeLoad, and (3) a few correctness/test gaps around countdown boundaries and timezone assertions (one test is misleading and doesn’t cover what it claims).

Overall risk: medium

## Findings

1. [high] API route hard-codes tenantId ('guyan') instead of deriving from session/context
   - File: apps/tournament-api/src/routes/events.ts:26-76
   - Confidence: high
   - Why it matters: The handler filters both events and eventRounds by a constant TENANT_ID. In a multi-tenant schema (tenantId exists on tables), this can cause incorrect authorization/visibility:
- Legitimate participants in other tenants will always get 403.
- If middleware authorization uses a different tenant derivation than this handler, you can get inconsistent outcomes (middleware passes but handler 403s, or vice versa), complicating the no-existence-leak guarantee and potentially creating confusing behavior.
Even if today you only run one tenant, this is a footgun that tends to regress silently when onboarding another tenant/env.
   - Suggested fix: Read tenantId from trusted request context (e.g., session, subdomain, header validated by upstream middleware) and use that in both middleware and route queries. If the app is intentionally single-tenant, consider making that explicit in config and/or removing tenantId predicates elsewhere to avoid accidental divergence.

2. [medium] TanStack Router beforeLoad uses window.location.assign + thrown Error instead of router redirect; can break SSR/tests and may surface an error UI
   - File: apps/tournament-web/src/routes/events.$eventId.index.tsx:251-263
   - Confidence: high
   - Why it matters: Using `window.location.assign` inside `beforeLoad` assumes a browser environment. If you ever introduce SSR/prerendering or run route loaders in non-DOM contexts, this will throw (`window is not defined`). Also, throwing a generic Error to abort navigation can produce visible error boundaries/console noise depending on router configuration.
   - Suggested fix: Use TanStack Router’s redirect mechanism (e.g. `throw redirect({ to: '/api/auth/google' })` or the router-recommended pattern for external redirects). If external navigation is required, consider guarding `typeof window !== 'undefined'` and using a dedicated redirect error type that your app suppresses.

3. [medium] Countdown boundary at exactly “1 day” can be surprising; missing explicit test for diff == ONE_DAY_MS
   - File: apps/tournament-web/src/routes/events.$eventId.index.tsx:131-154
   - Confidence: medium
   - Why it matters: `computeCountdown` uses `diffMs < ONE_DAY_MS` for “starts today” and `Math.floor(diffMs / ONE_DAY_MS)` otherwise. That means exactly 24h away renders “starts in 1 day” (not “today”), and near-boundary values can undercount days (e.g., 2.9 days -> 2). Depending on product expectations, this may be off by one around day boundaries and could confuse users if the event is defined in local midnights.
   - Suggested fix: Decide intended semantics (floor vs ceil vs calendar-day difference in event timezone). If you want “calendar days until”, compute day-delta using the event timezone’s date parts. At minimum, add a test for `diffMs === ONE_DAY_MS` to lock desired behavior.

4. [low] Test labeled as “≥ 1 day to round 2” does not assert that scenario (misleading coverage)
   - File: apps/tournament-web/src/routes/events.$eventId.index.test.tsx:184-193
   - Confidence: high
   - Why it matters: The test name/comment claims it covers a mid-event case with ≥ 1 day to round 2, but it calls `computeCountdown(rounds, MAY_8_NY_MIDNIGHT - 1)` and expects “Round 1 starts today”. This doesn’t exercise the intended branch and can give a false sense of coverage for countdown logic.
   - Suggested fix: Either remove/rename the test or update it to actually pin `now` between round 1 and round 2 with `diffMs >= ONE_DAY_MS` to validate the intended output. Consider adding a case where `now` is exactly at round 1 start to lock boundary behavior.

5. [low] Timezone formatting is pinned correctly in code, but tests don’t actually validate “not viewer’s local timezone”
   - File: apps/tournament-web/src/routes/events.$eventId.index.test.tsx:28-163
   - Confidence: medium
   - Why it matters: `formatDateRange` correctly passes `{ timeZone }`, but the test suite doesn’t force a differing local TZ, so it won’t catch regressions where timeZone is accidentally omitted. JSDOM/Node often run in UTC, making this easy to miss.
   - Suggested fix: In the test, set `process.env.TZ` (where supported) to a different zone (e.g., `Pacific/Honolulu`) before importing the module, or assert with a fixture where omitting `timeZone` would change the rendered date (e.g., a timestamp near midnight UTC). Add a regression test that fails if `timeZone` is removed from Intl.DateTimeFormat options.

## Strengths

- API route returns minimal event metadata + rounds and explicitly orders rounds by roundNumber asc (apps/tournament-api/src/routes/events.ts:62-76).
- No-existence-leak behavior is preserved: unknown/malformed eventId still results in 403 via middleware, and handler returns 403 when the event row is missing (apps/tournament-api/src/routes/events.ts:52-60).
- Integration tests cover happy path ordering and 403 cases for non-participant/unknown/malformed IDs (apps/tournament-api/src/routes/events.integration.test.ts:176-218).
- UI renders semantic navigation (`nav` with aria-label) and uses `role="alert"` for error/forbidden states (apps/tournament-web/src/routes/events.$eventId.index.tsx:187-203, 222-244).
- Countdown is pure and testable via an explicit `nowMs` seam, avoiding flaky timer-based tests (apps/tournament-web/src/routes/events.$eventId.index.tsx:131-154, 158-163; test file uses nowMs).

## Warnings

None.
