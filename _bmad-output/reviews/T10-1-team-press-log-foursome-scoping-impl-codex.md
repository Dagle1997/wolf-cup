# Codex Review

- Generated: 2026-05-20T19:41:34.851Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/db/schema/press.ts, apps/tournament-api/src/db/migrations/0012_team_press_log_foursome_scoping.sql, apps/tournament-api/src/db/migrations/meta/0012_snapshot.json, apps/tournament-api/src/db/migrations/meta/_journal.json, apps/tournament-api/src/services/press-orchestrator.ts, apps/tournament-api/src/services/press-orchestrator.test.ts, apps/tournament-api/src/routes/presses.ts, apps/tournament-api/src/routes/presses.integration.test.ts, apps/tournament-api/src/services/export.ts, apps/tournament-api/src/routes/export.integration.test.ts

## Summary

Implementation largely matches T10-1 spec: migration 0012 adds foursome_number with DEFAULT 1 + NOT NULL and rewrites UNIQUE; Drizzle schema matches; orchestrator and manual press INSERT/SELECT/DELETE are correctly foursome-scoped; export projection includes foursomeNumber; and multi-foursome regression tests cover both the orchestrator cross-suppression/UNIQUE-collision bug and the cross-foursome undo gap.

Remaining issues are mainly spec-drift in comments and a small robustness gap in the new export test’s row lookup predicate.

Overall risk: low

## Findings

1. [low] Manual-press route header comments still describe the old foursome-blind UNIQUE + old rationale for the kill switch
   - File: apps/tournament-api/src/routes/presses.ts:12-24
   - Confidence: high
   - Why it matters: The file-level docs still claim the UNIQUE key is `UNIQUE(round_id, team, fired_at_hole, trigger_type)` and the kill-switch comments still imply it’s needed to avoid a “foursome-blind UNIQUE” (even though 0012 fixes this). This is now misleading and conflicts with the updated schema/spec intent, increasing the chance of future regressions or incorrect assumptions when debugging presses behavior.
   - Suggested fix: Update the comments to reflect the new UNIQUE key `(round_id, foursome_number, team, start_hole, trigger_type)` and describe TOURNAMENT_PRESSES_DISABLED as an operational override (similar to the updated comment in services/press-orchestrator.ts). Also consider correcting the column name reference (`start_hole` vs `fired_at_hole`).

2. [low] New export integration test’s `.find()` predicate is less deterministic than the spec/comment claims (contextId not included)
   - File: apps/tournament-api/src/routes/export.integration.test.ts:930-980
   - Confidence: high
   - Why it matters: The test comment says the inserted team_press_log row is located via a deterministic tuple including `contextId`, but the predicate only matches `(team, startHole, triggerType)` and then asserts `id`. If another row with the same tuple ever appears in the fixture (e.g., future seeds or added tests), `.find()` could return the wrong row and fail unexpectedly, making the test brittle.
   - Suggested fix: Make the `.find()` predicate deterministic by including `id === knownPressId` (simplest) or include `contextId === eventCtx` (to match the comment/spec), and/or include `foursomeNumber === 2` in the predicate.

## Strengths

- Migration 0012 matches AC-1: adds `foursome_number integer DEFAULT 1 NOT NULL`, uses `DROP INDEX IF EXISTS`, and recreates UNIQUE on `(round_id,foursome_number,team,start_hole,trigger_type)` with statement breakpoints (apps/tournament-api/src/db/migrations/0012_team_press_log_foursome_scoping.sql:1-3).
- Drizzle schema matches migration (notNull + default(1) + uniqueIndex includes foursomeNumber) (apps/tournament-api/src/db/schema/press.ts:56-96).
- press-orchestrator correctly filters existingPressLog by foursomeNumber and includes foursomeNumber in INSERT (apps/tournament-api/src/services/press-orchestrator.ts:480-544).
- Manual press POST correctly threads foursomeNumber into INSERT; computeMaxCompleteHole returns `{maxComplete, foursomeNumber}` and throws `BusinessRuleError('scorer_assignment_missing', 422)` on missing assignment as required (apps/tournament-api/src/routes/presses.ts:103-192, 287-330).
- Manual press DELETE now resolves scorer assignment first and scopes the press-row lookup by foursomeNumber, returning 404 without leaking sibling-foursome existence (apps/tournament-api/src/routes/presses.ts:412-456).
- Export projection includes `foursomeNumber` (apps/tournament-api/src/services/export.ts:752-765) and a non-default export assertion is added (apps/tournament-api/src/routes/export.integration.test.ts hunk @ ~930).
- Added multi-foursome regression coverage for both manual presses (POST no UNIQUE collision; DELETE cross-foursome undo blocked) and auto-press orchestration (two foursomes each fire their own auto-press) (apps/tournament-api/src/routes/presses.integration.test.ts:545-614; apps/tournament-api/src/services/press-orchestrator.test.ts:525-701).

## Warnings

- Truncated file content for review: apps/tournament-api/src/db/migrations/meta/0012_snapshot.json
- Truncated file content for review: apps/tournament-api/src/routes/export.integration.test.ts
