# Codex Review

- Generated: 2026-05-20T20:42:37.195Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T10-2-investigate-flaky-tournament-api-tests.md

## Summary

Spec is largely within the intended blast radius (test-only changes in ALLOWED paths) and is explicit about triage vs. true fix. Main gaps are (a) Vitest API/usage ambiguity around timeouts/retry that could be implemented incorrectly, (b) overstated claim that retry “does not mask genuine bugs,” and (c) verification/AC mismatches (sprint-status edit not reflected; “3 runs” is a weak flake check).

Overall risk: medium

## Findings

1. [high] Vitest timeout/retry API guidance is internally inconsistent and may be wrong depending on actual Vitest v3 signatures
   - File: _bmad-output/implementation-artifacts/tournament/T10-2-investigate-flaky-tournament-api-tests.md:46-99
   - Confidence: medium
   - Why it matters: This story’s only deliverable is test edits. If the spec points the dev at an invalid or ambiguous API shape, the implementation can break the suite (TypeScript compile errors or silently not applying the timeout/retry). The spec currently suggests multiple forms, including a “third arg to describe.skip/describe.runIf” and also claims “describe doesn’t accept timeout directly,” which can’t both be reliably actionable without confirming the exact supported signature in the repo.
   - Suggested fix: Pick ONE blessed, repo-verified pattern and put it in both Tasks and ACs. For Vitest 3, verify in local types/docs (e.g., `node_modules/vitest/dist/index.d.ts`) and then specify exactly:
- Timeout: either `describe('...', { timeout: 15000 }, () => {})` (if supported) OR `test('...', { timeout: 15000 }, async () => {})` on the two tests.
- Retry: either `test('...', { retry: 1 }, async () => {})` OR `test.retry(1)('...', async () => {})`.
Remove/replace the “third arg to describe.*” guidance unless you can cite it working in this repo.

2. [medium] Spec overstates that per-test retry “does NOT mask genuine bugs”; it can hide intermittent real 500s
   - File: _bmad-output/implementation-artifacts/tournament/T10-2-investigate-flaky-tournament-api-tests.md:42-47
   - Confidence: high
   - Why it matters: If the production code has a real race that intermittently returns 500, `retry: 1` will convert some real failures into CI passes, reducing the chance of detecting a regression. The spec’s claim may mislead reviewers into accepting a risk they didn’t intend.
   - Suggested fix: Reword to be honest about the tradeoff: retry reduces CI noise but can mask intermittent real bugs. Add a mitigation AC/task such as: ensure the test output makes retries visible (Vitest usually logs retries), and add a TODO/followup link in the comment to remove retry once root-caused. Optionally require capturing/logging the first failure’s response body/status to aid later diagnosis.

3. [medium] ESLint instance reuse may introduce shared mutable state risk if tests ever become concurrent; spec doesn’t constrain concurrency
   - File: _bmad-output/implementation-artifacts/tournament/T10-2-investigate-flaky-tournament-api-tests.md:27-33
   - Confidence: medium
   - Why it matters: Hoisting `new ESLint(...)` into `beforeAll` is likely fine for sequential tests, but if these tests are (now or later) marked `concurrent`/run in parallel, sharing a single ESLint instance could cause cross-test interference or nondeterminism (especially if plugins/config resolution caches or uses process-wide state). That can trade one flake for another.
   - Suggested fix: Add an explicit note/constraint: keep the two ESLint tests non-concurrent (default) and do not convert them to `test.concurrent`. If the file uses concurrency elsewhere, consider `describe.sequential(...)` for this block, or keep per-test ESLint instances but move cold-start to a shared warm-up step (e.g., `beforeAll` does one dummy `lintText`).

4. [low] Acceptance Criteria omit the declared edit to sprint-status.yaml and don’t require recording retry events/followup link
   - File: _bmad-output/implementation-artifacts/tournament/T10-2-investigate-flaky-tournament-api-tests.md:55-131
   - Confidence: high
   - Why it matters: The spec declares `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml` will be edited (line 129) but no AC or task requires it. That’s a common source of process drift (file touched “because we always do” vs. required outcome). Similarly, AC-2 asks for a followup-story candidate name in a comment, but doesn’t require updating sprint status with that followup, which is where it’s most actionable.
   - Suggested fix: Add a small AC/task: update `sprint-status.yaml` to reflect T10-2 progress and record the followup story candidate (ID/title) referenced in the inline test comment.

5. [low] Verification plan (‘3 consecutive runs’) is weak for flake prevention and not well-scoped to CI-like conditions
   - File: _bmad-output/implementation-artifacts/tournament/T10-2-investigate-flaky-tournament-api-tests.md:77-106
   - Confidence: medium
   - Why it matters: Three runs can easily miss low-probability flakes, especially those driven by parallelism, cold-start, or load. This risks declaring success without materially improving CI reliability.
   - Suggested fix: Tighten verification to be more “flake-hunting” while staying lightweight: e.g., run only the two affected tests with `--repeat N` (if available) or loop them 20–50 times; run with CI-like pool/threads settings; and/or run the specific test files in isolation and then under full-suite parallel load. Update AC-3 wording to match the chosen approach.

## Strengths

- Paths listed in “Files this story will edit” are all in the tournament-director ALLOWED set (apps/tournament-api/**, _bmad-output/implementation-artifacts/tournament/**) (lines 125-130).
- Spec is explicit about blast radius: no production code changes, no global vitest retry, no broad fixture isolation rewrite (lines 48-53).
- Triage discipline is clearly stated: mechanical fix for ESLint cold-start; retry-1 only for the uncertain 500-with-422 expectation, with hypotheses and followup direction (lines 33-45, 119-123).
- ACs capture the essential intended behaviors for each flake (ESLint constructed once; retry applied to exactly one test) (lines 57-76).

## Warnings

None.
