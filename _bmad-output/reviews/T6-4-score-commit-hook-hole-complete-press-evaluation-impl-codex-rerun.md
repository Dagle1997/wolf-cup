# Codex Review

- Generated: 2026-05-04T14:43:35.344Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/press-orchestrator.ts

## Summary

Re-review confirms the requested fixes are present: rule-set selection is now deterministic (rule_sets ordered by createdAt/id), tenant scoping has been added to the previously-missing queries (eventRounds/courseRevisions/players), and course holes are ordered by holeNumber. Two remaining correctness risks are still visible in the current file: (1) UNIQUE-violation detection is still potentially incomplete if a libsql/drizzle error reports the numeric code via `extendedCode` (not `rawCode`), and (2) hole-complete detection claims “distinct” but does not enforce distinctness, which can false-trigger if duplicates exist. Also, the team-pairing logic/comment are inconsistent and could mis-assign teams if real team membership is not alphabetical.

Overall risk: medium

## Findings

1. [high] UNIQUE-violation detection may still miss numeric `extendedCode` variants (can abort tx instead of log+continue)
   - File: apps/tournament-api/src/services/press-orchestrator.ts:536-560
   - Confidence: medium
   - Why it matters: The orchestrator’s spec says UNIQUE collisions during `team_press_log` insert should be swallowed (log + continue). If `isUniqueConstraintError` fails to recognize a UNIQUE violation in some driver versions, the catch block will rethrow (line 514), causing the surrounding score-commit transaction to fail/rollback for a benign concurrency race.
   - Suggested fix: Broaden detection to also treat numeric codes as UNIQUE, e.g. check `src['extendedCode'] === 2067` in addition to `rawCode === 2067`, and consider also handling `src['code'] === 'SQLITE_CONSTRAINT'` plus numeric extended code if that’s an observed shape. (Keep the wrapper+cause scan you added.)

2. [medium] Hole-complete detection says “distinct” but does not enforce distinctness; duplicates could false-trigger completion
   - File: apps/tournament-api/src/services/press-orchestrator.ts:239-254
   - Confidence: medium
   - Why it matters: The code uses `scoredRows.length < 4` as the completion gate (line 251), but the query does not select distinct playerIds. If the schema ever allows multiple `hole_scores` rows per (roundId, holeNumber, playerId) (e.g., corrections as new rows), a single player with multiple rows could inflate the count to 4 and incorrectly trigger press evaluation before all 4 players have scored.
   - Suggested fix: Make the query distinct/grouped (e.g., `selectDistinct({ playerId: holeScores.playerId })`) or compute a Set of returned playerIds and compare `set.size` to 4.

3. [medium] Team assignment logic and comment disagree; current pairing may not match intended “slot 1+3 vs 2+4” convention
   - File: apps/tournament-api/src/services/press-orchestrator.ts:407-413
   - Confidence: medium
   - Why it matters: The comment states the convention is “slot 1+3 = teamA; slot 2+4 = teamB”, but the implementation uses alphabetical sorting and assigns teamA to indices 0+1 and teamB to 2+3. If actual teams are defined by pairing slots (or any non-alphabetical rule), presses could be evaluated for the wrong teams, producing incorrect press firing/logging.
   - Suggested fix: Either (a) update the comment to match the real v1 behavior if alphabetical pairing is intentional, or (b) fetch/use an explicit slot/order/team field from `pairing_members` to build the correct (1,3) vs (2,4) teams deterministically.

## Strengths

- Deterministic rule_set selection implemented via `.orderBy(desc(ruleSets.createdAt), desc(ruleSets.id))` (lines 111-116), eliminating nondeterministic “pick any row” behavior.
- Tenant scoping was added to the previously-unscoped queries: eventRounds (lines 289-295), courseRevisions (lines 316-324), and players (lines 390-401), reducing cross-tenant data leakage risk.
- Course holes now have an explicit order (`.orderBy(courseHoles.holeNumber)`, line 345), preventing hole-order-dependent engine behavior.
- UNIQUE-violation handling now checks wrapper + cause and multiple fields (code/extendedCode/rawCode), which is a meaningful robustness improvement over a single-field check.

## Warnings

None.
