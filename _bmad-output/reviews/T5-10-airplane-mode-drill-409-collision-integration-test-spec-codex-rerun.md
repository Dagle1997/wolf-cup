# Codex Review

- Generated: 2026-05-02T13:05:46.889Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-10-airplane-mode-drill-409-collision-integration-test.md

## Summary

The spec updates reflect the stated 1H + 3M + 2L fixes: AC-1 now asserts surviving `clientEventId === 'evt-A'`; AC-2 scopes the audit assertion to `entityId`; the drill now has a dedicated Setup section, clearer offline verification, a two-path step-6, and a developer/organizer-owned step-7 with concrete `docker exec ... sqlite3` commands and “Pending” guidance.

Main remaining concern: AC-2’s new audit assertion is now narrow enough that it may no longer fully prove “no audit row on the 409 path” (it proves no extra audit row for the surviving entity, but could miss an erroneous audit emitted under a different entity id).

Overall risk: medium

## Findings

1. [medium] AC-2 audit assertion may be too narrow to guarantee “no audit row on 409 path” (could miss audits logged under other entityIds)
   - File: _bmad-output/implementation-artifacts/tournament/T5-10-airplane-mode-drill-409-collision-integration-test.md:103-125
   - Confidence: high
   - Why it matters: The epic intent is “409 path MUST NOT emit a second audit row.” The proposed query filters `audit_log` by `eventType='score.committed'` and `entityId = surviving.id` (lines 114–122). This will catch an extra audit row that incorrectly reuses the surviving hole_score id, but it will not catch a bug where the 409 path emits an audit row keyed to some other `entityId` (e.g., a transient/attempt entity, a different row id, or a mismapped identifier). Also, the comment claims scoping to “THIS round’s entityIds” (lines 108–112) but the code scopes to a single entityId, which is a weaker check than described.
   - Suggested fix: If you need determinism while still enforcing the stronger contract, count audits for *all* hole_scores in the seeded round, not just the surviving id. Example pattern (deterministic and round-scoped): `WHERE event_type='score.committed' AND entity_id IN (SELECT id FROM hole_scores WHERE round_id = seed.roundId)` and expect 1. You can keep the existing `entityId = surviving.id` assertion as an additional check if you want (both should be true). Alternatively, ensure test DB isolation (fresh DB per test / transaction rollback) so a global count is reliable.

2. [low] Potential casing mismatch risk: DB row uses `clientEventId` but existing response assertion uses `client_event_id`
   - File: _bmad-output/implementation-artifacts/tournament/T5-10-airplane-mode-drill-409-collision-integration-test.md:82-101
   - Confidence: medium
   - Why it matters: AC-1’s new assertion uses `rows[0]!.clientEventId` (line 99), while the spec references an existing assertion `body.conflictingEntry!.client_event_id` (line 208). If the Drizzle row shape actually uses snake_case (or the test currently references a different property name), this could cause a compile/runtime failure when implementing the test tightening.
   - Suggested fix: Before implementing, confirm the actual Drizzle model property name for the selected row (`clientEventId` vs `client_event_id`) by checking the existing dedupe test in the same file (which the spec says already asserts clientEventId echo) and align the new assertion accordingly.

## Strengths

- AC-1’s added `clientEventId === 'evt-A'` assertion materially strengthens the first-writer-wins guarantee beyond value-based checks alone.
- The drill’s Setup section (prod env, provisioning expectations, iOS Safari-only constraint, time budget) makes execution much more operationally reliable and reduces ambiguity.
- Step 6’s preferred + fallback paths are clearly documented, and the limitation of the fallback is explicitly recorded.
- Step 7 is now clearly assigned to organizer/developer, includes exact commands, and introduces a “Pending until verified” workflow that matches real-world access constraints.

## Warnings

None.
