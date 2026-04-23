# Codex Review

- Generated: 2026-04-23T16:48:46.377Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T2-1-courses-revisions-schema.md

## Summary

Fix A (FK delete posture note) is consistent across the spec. Fix B (11-test consistency) is not fully converged: AC #8’s enumerated test list appears to contain 12 distinct tests, while multiple places still claim 11 total and even reference an older “minimum of 8.”

Overall risk: medium

## Findings

1. [medium] AC #8 test-count still inconsistent (list reads as 12 tests; text claims 11; lingering “minimum of 8”)
   - File: _bmad-output/implementation-artifacts/tournament/T2-1-courses-revisions-schema.md:172-190
   - Confidence: high
   - Why it matters: This creates an execution ambiguity for the dev agent (implement 11 vs 12 tests) and undermines the intended regression guard around test-count deltas (AC #10 / Subtask 5.2). It also signals that parts of the spec weren’t fully updated, increasing the chance of missed acceptance checks.
   - Suggested fix: Pick one truth and make every reference match it:
- If the intended set is 11 tests: merge/remove one bullet from AC #8’s list (lines 176–187) and keep Subtask 5.2/other references at 11.
- If the intended set is 12 tests: update AC #8’s “≥11” to “≥12” (or keep ≥11 but set the stated total to 12), update Subtask 5.2 to 12, and update the “Total: 11 tests” line to 12.
Also fix the stale sentence at line 189 (“Exceeds the AC #8 minimum of 8”) to reference the current minimum (11 or 12). If you change the committed-new-tests expectation, consider whether AC #10’s arithmetic should be updated (≥84 vs ≥85), even if it remains technically true as a minimum.

## Strengths

- FK delete posture is now clearly described as MIXED (RESTRICT courses→revisions, CASCADE revisions→tees/holes) and consistently repeated (lines 15–28, 152–156, 251–252).
- The migration ordinal rationale is explicit and internally consistent with the stated existing 0000 migration (lines 43–46, 160–170, 253–254).
- The spec documents the tenant/context composite-FK gap and ties it to an explicit v1 posture and a future hardening plan (lines 30–41), which reduces surprise for downstream work.

## Warnings

None.
