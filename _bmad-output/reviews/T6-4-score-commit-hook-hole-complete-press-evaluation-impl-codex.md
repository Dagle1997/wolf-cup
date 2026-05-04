# Codex Review

- Generated: 2026-05-04T14:41:25.109Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/db/schema/press.ts, apps/tournament-api/src/db/migrations/0006_team_press_log.sql, apps/tournament-api/src/services/press-orchestrator.ts, apps/tournament-api/src/services/press-orchestrator.test.ts, apps/tournament-api/src/routes/scores.ts, apps/tournament-api/src/routes/scores.integration.test.ts, _bmad-output/implementation-artifacts/tournament/T6-4-score-commit-hook-hole-complete-press-evaluation.md

## Summary

Implements T6-4 end-to-end wiring (scores route → press orchestrator → team_press_log) with hole-complete gating, 4-player guard rail, persistence + UNIQUE-dedupe protection, and 422 mapping for press engine failures. The overall shape matches the spec intent, but there are a few correctness/defense-in-depth gaps (rule-set selection, UNIQUE error detection, tenant scoping, potential ordering sensitivity) and some notable AC test coverage drift (activity emission, engine-error/UNIQUE paths, AC-7(e) score-correction case).

Overall risk: medium

## Findings

1. [high] UNIQUE-violation detection in orchestrator may miss libsql/Drizzle error shapes (extendedCode) → tx abort instead of log+continue
   - File: apps/tournament-api/src/services/press-orchestrator.ts:516-527
   - Confidence: high
   - Why it matters: Spec requires UNIQUE collisions on team_press_log insert to be caught/logged/continued without aborting the score-commit transaction. Your helper only checks `code` and `rawCode` (and recurses into `cause`) but does not check `extendedCode` (which the codebase explicitly documents as possible in scores.ts). If a UNIQUE violation arrives with only `extendedCode`, the catch block will rethrow and rollback the entire score commit—violating AC-5/Section 5 behavior.
   - Suggested fix: Update `isUniqueConstraintError` here to mirror the robust check used in routes/scores.ts: check `code === 'SQLITE_CONSTRAINT_UNIQUE' || extendedCode === 'SQLITE_CONSTRAINT_UNIQUE' || rawCode === 2067` on the error and (recursively) its `cause`. Consider centralizing this helper to avoid drift.

2. [high] Rule-set lookup is not actually “most recent revision in tenant” and is nondeterministic when multiple rule_sets exist
   - File: apps/tournament-api/src/services/press-orchestrator.ts:108-126
   - Confidence: high
   - Why it matters: `fetchActivePressConfig` selects an arbitrary rule_set for the tenant with `.limit(1)` and no ordering, then picks the latest revision within that rule_set. If the tenant has >1 rule_set (now or later), which one gets used is undefined and can silently change as data grows. This can cause presses to fire (or not) based on the wrong configuration, breaking determinism and violating the stated v1 decision of "most recent revision in tenant".
   - Suggested fix: Select the rule_set_revision directly by tenant with `orderBy(desc(createdAt or revisionNumber))` (and join to rule_sets if needed), or at least order ruleSets by createdAt desc (or id) to make selection deterministic. Add a unit test that seeds two ruleSets with different configs and asserts the newest one is used.

3. [medium] Several orchestrator reads are missing tenantId filters (eventRounds/courseRevisions/players) → cross-tenant leakage or wrong course/config under data-integrity faults
   - File: apps/tournament-api/src/services/press-orchestrator.ts:280-385
   - Confidence: high
   - Why it matters: The orchestrator filters `rounds` by tenant, but then reads `eventRounds` (lines 280-287) and `courseRevisions` (lines 307-312) without tenant constraints, and reads `players` (lines 375-381) without tenant constraints. In normal operation UUID collisions are unlikely, but if there is any data-integrity bug (wrong FK reference) this can pull course/tee/player data from a different tenant, affecting scoring/press results and leaking data across tenants.
   - Suggested fix: Add `eq(eventRounds.tenantId, tenantId)` to the eventRound query; add `eq(courseRevisions.tenantId, tenantId)` to course revision lookup; add `and(inArray(players.id,...), eq(players.tenantId, tenantId))` to player HI lookup. Consider also tenant-filtering `ruleSets`/`ruleSetRevisions` already done; keep consistent defense-in-depth.

4. [medium] Course holes query is unordered; engine behavior may depend on hole ordering
   - File: apps/tournament-api/src/services/press-orchestrator.ts:318-339
   - Confidence: medium
   - Why it matters: You build `courseShape.holes` from `courseHoles` without `orderBy(courseHoles.holeNumber)`. If `compute2v2BestBall` assumes holes are ordered (common for per-hole arrays), results can be nondeterministic across SQLite query plans, which risks incorrect press triggers and flaky behavior/tests.
   - Suggested fix: Add `.orderBy(courseHoles.holeNumber)` to the courseHoles query (and consider validating holeNumbers 1..18 exist as expected).

5. [medium] AC/test drift: orchestrator unit tests don’t actually cover engine-error mapping or UNIQUE-collision handling as claimed
   - File: apps/tournament-api/src/services/press-orchestrator.test.ts:1-449
   - Confidence: high
   - Why it matters: The test header claims coverage for AC-6 (engine error → BusinessRuleError) and UNIQUE-violation handling, but the provided tests only cover hole-complete gating, idempotent re-run, member-count guard, missing pairing, disabled/no ruleset. There is no test that forces `compute2v2BestBall`/`evaluatePresses` to throw and asserts `BusinessRuleError('press_engine_error')`, and no test that simulates a UNIQUE insert collision to ensure the orchestrator logs+continues without throwing. This leaves two of the highest-risk behaviors unverified.
   - Suggested fix: Add tests that (1) monkeypatch/mock `compute2v2BestBall` or `evaluatePresses` to throw and assert `BusinessRuleError` code/status; (2) pre-insert a conflicting `team_press_log` row (same roundId/team/startHole/triggerType) and assert orchestrator completes without throwing and doesn’t insert duplicates.

6. [medium] AC/test drift: integration tests verify DB wiring but do not assert press activity emission (AC-7 expects it) and omit the score-correction-after-hole-complete case
   - File: apps/tournament-api/src/routes/scores.integration.test.ts:591-836
   - Confidence: high
   - Why it matters: Per the spec’s AC-7, integration tests should validate not only team_press_log writes but also that `press.auto_fired` is emitted exactly once when a press fires, and that a score correction after hole-complete does not refire. The new tests only check `team_press_log` row counts/fields and do not spy/assert activity emission, and they do not implement AC-7(e) (score correction path). This reduces confidence that route → orchestrator activity side effects are wired correctly and stable.
   - Suggested fix: Spy/mock `emitActivity` (similar to existing patterns) and assert `press.auto_fired` emission counts/payload shape. Add an integration test that performs a score correction on a hole after the press has fired (using the existing score-corrections route if present) and asserts no new press log rows/activities.

## Strengths

- Schema + migration for team_press_log match the spec: correct columns, checks, CASCADE/RESTRICT FKs, and UNIQUE(round_id, team, start_hole, trigger_type).
- Orchestrator correctly scopes foursome membership via rounds.eventRoundId → pairings.eventRoundId join, addressing the “foursomeNumber collision across rounds” hazard.
- 4-player guard rail is explicit and early, preventing invalid engine invocations for non-2v2 shapes.
- scores.ts change is minimal and correctly maps BusinessRuleError('press_engine_error') to a 422 response while allowing other errors to surface normally.
- Activity emission is gated on successful insert (post-UNIQUE handling), which avoids emitting events for skipped/duplicate press fires.

## Warnings

None.
