# Codex Review

- Generated: 2026-04-27T18:36:29.253Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T3-8-permissions-middleware-event-level-role-matrix.md

## Summary

(1) AC #2 + Risk §5 + AC #6 are aligned: missing/empty `:token` => 500 `middleware_misuse_no_token`; malformed token shape => 401 `invite_token_invalid`.

(2) There are a few other spec-internal inconsistencies worth fixing before dev starts (below).

(3) “Consumer routes wired in T3-8 = ZERO” is clearly and repeatedly stated (Risk §3, AC #10, Dev Notes). A future dev is unlikely to “helpfully” mount these in `app.ts` without knowingly violating AC #10.

(4) Path allowlist looks clear; no obvious allowlist foot-guns beyond one test-count mismatch that could lead to under-testing.

(5) No clearly missing AC beyond resolving the contradictions noted.

Overall risk: medium

## Findings

1. [medium] Top-level Story bullet still says missing invite token returns 401, contradicting later 500-misuse taxonomy
   - File: _bmad-output/implementation-artifacts/tournament/T3-8-permissions-middleware-event-level-role-matrix.md:13-16
   - Confidence: high
   - Why it matters: Line 15 states “on invalid/expired/missing returns 401,” but Risk §5 + AC #2 + AC #6 explicitly classify missing/empty `:token` as developer misuse => 500 `middleware_misuse_no_token`. This is exactly the kind of early-summary mismatch that causes regressions or wrong implementation/tests.
   - Suggested fix: Edit line 15 to reflect the finalized taxonomy: missing/empty path param => 500 `middleware_misuse_no_token`; invalid/expired/not-found => 401 with the specified codes.

2. [medium] `requireEventParticipant` missing-`:eventId` error code inconsistent between Risk §4 and AC #1
   - File: _bmad-output/implementation-artifacts/tournament/T3-8-permissions-middleware-event-level-role-matrix.md:42-46
   - Confidence: high
   - Why it matters: Risk §4 says missing `eventId` returns 500 `middleware_misuse` (line 44), while AC #1 requires 500 `middleware_misuse_no_event_id` (line 85) and the test plan asserts that code (line 116). This could easily yield the wrong status/code in the implementation or mismatched tests.
   - Suggested fix: Update Risk §4 to name `middleware_misuse_no_event_id` for missing/empty `eventId`, reserving plain `middleware_misuse` for “no session middleware ahead / no player in ctx.”

3. [medium] Event-participant test minimum/count is internally inconsistent (6 vs 7) and affects AC #7’s +13 math
   - File: _bmad-output/implementation-artifacts/tournament/T3-8-permissions-middleware-event-level-role-matrix.md:109-158
   - Confidence: high
   - Why it matters: AC #5 says “at least 6 tests” but enumerates 7 distinct cases (including two separate cross-tenant variants). AC #7’s baseline math assumes 7 for AC #5 (line 132). Task 5 also says “with 6 tests” (line 156). This can lead to shipping fewer tests than the spec’s own math/coverage intends.
   - Suggested fix: Pick one: (a) make AC #5/Task 5 explicitly “at least 7 tests” (matching the enumerated list and AC #7), or (b) reduce/merge cases and update AC #7’s +13 calculation accordingly.

## Strengths

- AC #2 / Risk §5 / AC #6 now consistently treat missing `:token` as 500 misuse and malformed token shape as 401 (good taxonomy separation).
- The “no consumer routes wired yet” decision is reinforced in multiple places (Risk §3, AC #10, Dev Notes), reducing the chance of accidental route mounting in T3-8.
- Tenant-scoping requirements are explicitly load-bearing and backed by cross-tenant test cases for both middlewares.

## Warnings

None.
