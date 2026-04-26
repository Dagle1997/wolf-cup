# Codex Review

- Generated: 2026-04-26T17:13:46.713Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T2-3a-scorecard-image-input.md, _bmad-output/reviews/T2-3a-scorecard-image-input-spec-codex-round3.md

## Summary

AC #8 now explicitly includes a WebP happy-path route test and the route-test minimum is bumped to 6, which closes the Round-3 MED and aligns with Risk Acceptance §7’s requirement that WebP be covered at the route level. AC #10’s arithmetic correction to +11 (5 parser + 6 route) is also correct. However, the spec now contains new internal inconsistencies in the Tasks/Project-Structure sections that still refer to “5 new route tests” / “baseline + ≥10”, which could lead an implementer to under-deliver tests despite AC #8/#10.

Overall risk: medium

## Findings

1. [medium] Task list still instructs writing 5 route tests even though AC #8 now requires 6 (including WebP)
   - File: _bmad-output/implementation-artifacts/tournament/T2-3a-scorecard-image-input.md:244-247
   - Confidence: high
   - Why it matters: A dev agent following the Tasks section may implement only 5 route tests, reintroducing the original gap (WebP untested) or omitting another required case, while mistakenly believing they satisfied the plan. This undermines the “mandatory” test-coverage posture and the Round-3 fix intent.
   - Suggested fix: Update Task 8 / Subtask 8.2 to say “Write the 6 new tests per AC #8” (or “at least 6”), matching AC #8’s six bullets.

2. [medium] Regression task still references baseline + ≥10 tests, but AC #10 now requires baseline + 11
   - File: _bmad-output/implementation-artifacts/tournament/T2-3a-scorecard-image-input.md:248-252
   - Confidence: high
   - Why it matters: This is a direct contradiction between the execution checklist (Tasks) and the binding acceptance criteria (AC #10). It increases the chance the implementation stops at +10 tests and fails the spec gate or silently misses a required test.
   - Suggested fix: Update Subtask 9.3 to “total = baseline + ≥11” to match AC #10’s updated requirement.

3. [low] Project structure notes still claim admin-courses.test.ts adds +5 new tests, but AC #8 now requires +6
   - File: _bmad-output/implementation-artifacts/tournament/T2-3a-scorecard-image-input.md:295-308
   - Confidence: high
   - Why it matters: This is a smaller documentation mismatch, but it can confuse reviewers and implementers about the expected delta and can mask under-testing during verification.
   - Suggested fix: Update the structure note at line ~307 to “+6 new tests” (or “+6 route tests”).

## Strengths

- AC #8 now contains an explicit WebP happy-path route test asserting `parseCoursePdf` receives `{ kind: 'image', mime: 'image/webp' }`, resolving the Round-3 MED inconsistency and matching Risk Acceptance §7’s WebP mandate.
- AC #10’s updated test-count delta (+11 = 5 parser + 6 route) is arithmetically correct and consistent with the updated AC #8.

## Warnings

None.
