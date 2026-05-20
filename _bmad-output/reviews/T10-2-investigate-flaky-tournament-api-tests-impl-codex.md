# Codex Review

- Generated: 2026-05-20T20:53:10.391Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/lib/activity.eslint-rule.test.ts, apps/tournament-api/src/routes/round-lifecycle.integration.test.ts

## Summary

Diff is confined to test files under apps/tournament-api/** and largely matches T10-2’s stated goals: hoist ESLint construction into beforeAll and apply Vitest option-form timeouts; add a single retry + triage comment to the handoff regression test. Two correctness concerns remain: (1) the retry comment contains a mathematically incorrect claim that could mislead future diagnosis, and (2) the shared ESLint singleton relies on sequential execution but isn’t enforced in-code (only documented). Also, AC-3 (sprint-status.yaml flip) is not evidenced in the provided diff.

Overall risk: medium

## Findings

1. [medium] Retry comment is technically incorrect about which bug rates can be “masked” by retry: 1
   - File: apps/tournament-api/src/routes/round-lifecycle.integration.test.ts:518-522
   - Confidence: high
   - Why it matters: The comment claims retry: 1 “does NOT mask a bug whose failure rate exceeds 50% (BOTH iterations would fail…)”. That’s false: with two attempts, the test passes whenever at least one attempt passes; even with a 60% failure rate, the probability both attempts fail is 0.6^2 = 36%, so the test will still pass ~64% of runs. This undermines the stated intent/risks of the triage change and may cause future readers to underestimate how much signal is being suppressed.
   - Suggested fix: Adjust the comment to reflect actual retry behavior/probabilities (e.g., passes if any attempt succeeds; probability of a false-pass is 1 - p^2 for per-attempt failure probability p). If you want to bound masking, consider logging on first failure or using a targeted stabilization (ensure isolation) rather than retries.

2. [medium] Hoisted shared ESLint instance assumes sequential execution but does not enforce it
   - File: apps/tournament-api/src/lib/activity.eslint-rule.test.ts:166-223
   - Confidence: medium
   - Why it matters: The file documents “Safe under sequential execution” (lines 175–181) but does not enforce sequential behavior. Vitest can be configured to run tests concurrently within a file (e.g., sequence.concurrent) or a future refactor could add test.concurrent. ESLint instances are not guaranteed to be re-entrant/thread-safe across concurrent lint runs, so this change could reintroduce flakes if concurrency is enabled later.
   - Suggested fix: If the intent is to rely on sequential execution, enforce it in-code (e.g., wrap this block in describe.sequential(...) or make the individual tests test.sequential(...)). Alternatively, keep per-test ESLint instances if concurrency is expected.

3. [low] Inline triage comment references an incorrect line number for __testPlayer reassignment
   - File: apps/tournament-api/src/routes/round-lifecycle.integration.test.ts:509-512
   - Confidence: high
   - Why it matters: The comment says the __testPlayer reassign is “on line ~508”, but in the provided file the relevant reassignment inside this test is at line 535, and __testPlayer is also set in buildApp at line 208. Incorrect pointers reduce the comment’s usefulness during future investigation.
   - Suggested fix: Update the reference to the actual location(s) (e.g., “set in buildApp (line 208) and reassigned in this test (line 535)”) or remove the line-number estimate.

4. [medium] Spec AC-3 (sprint-status.yaml flip lands atomically) is not evidenced in the provided diff
   - File: _bmad-output/implementation-artifacts/tournament/T10-2-investigate-flaky-tournament-api-tests.md:0
   - Confidence: medium
   - Why it matters: Per the review request, AC-3 requires a sprint-status.yaml status flip in the same commit. The provided diff only changes two test files and shows no status-file change. If AC-3 is still a requirement, this may block story acceptance (even if the code changes are correct).
   - Suggested fix: If AC-3 is still in force, include the sprint-status.yaml update in this same change set (or confirm it was included elsewhere and provide that diff).

## Strengths

- AC-1 appears satisfied: ESLint instance is hoisted into beforeAll and both end-to-end tests use Vitest option-form { timeout: 15000 } (apps/tournament-api/src/lib/activity.eslint-rule.test.ts lines 182–188 and 193, 207).
- AC-2 appears satisfied in-code: the finalize-before-handoff test uses option-form { retry: 1 } and includes an explicit triage comment with hypotheses plus the T10-3 followup key (apps/tournament-api/src/routes/round-lifecycle.integration.test.ts lines 498–525).
- All code changes are within apps/tournament-api/**, consistent with the stated allowlist for this commit.

## Warnings

None.
