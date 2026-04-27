# Codex Review

- Generated: 2026-04-27T13:48:11.317Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/db/schema/events.test.ts, apps/tournament-api/src/db/schema/subgames.test.ts, apps/tournament-api/src/db/schema/rules.test.ts, apps/tournament-api/src/db/schema/players-t3-extension.test.ts

## Summary

Round-1 fixes largely look in place: migration content is additive and includes the intended FK actions + CHECKs + partial unique index; and the new FK/CHECK/UNIQUE tests are much more comprehensive.

Two remaining issues are test-quality/isolation related: a couple of the new “NOT NULL” tests assert only “throws” (can mask unrelated failures), and all schema test files use the same shared in-memory SQLite URI which can introduce cross-file interference/flakiness depending on Vitest worker/threading configuration.

Overall risk: medium

## Findings

1. [medium] Some new NOT NULL tests assert only `.toThrow()`, which can mask wrong failure modes (or even failures unrelated to NOT NULL)
   - File: apps/tournament-api/src/db/schema/rules.test.ts:134-144
   - Confidence: high
   - Why it matters: The goal of the AC #11-style matrix tests is to prove specific constraints (NOT NULL, UNIQUE, CHECK, FK actions) are actually enforced. Using a broad `.rejects.toThrow()` will pass for any error (including schema/migration issues, wrong column mapping, wrong table, etc.), which reduces the regression-detection value of these tests.
   - Suggested fix: Reuse the `isConstraintError(..., 'NOTNULL')` helper pattern used in `events.test.ts` and assert the actual SQLite constraint type/message. Concretely: extend `isConstraintError` in this file to include NOTNULL and assert `.rejects.toSatisfy(err => isConstraintError(err, 'NOTNULL'))` for the missing-name case.

2. [medium] Schema tests share the same `file::memory:?cache=shared` database name across files, risking cross-file interference/flakiness
   - File: apps/tournament-api/src/db/schema/events.test.ts:14-18
   - Confidence: medium
   - Why it matters: Each test file mocks `../index.js` to open `file::memory:?cache=shared`. With SQLite shared-cache mode, separate connections using the same URI can share the same in-memory database within a process. Depending on Vitest’s threading/pooling, this can cause non-deterministic interactions (migrations running concurrently, deletes from one suite affecting another, order-dependent failures).
   - Suggested fix: Give each test file a unique in-memory DB name (e.g., `file:events-test?mode=memory&cache=shared`) or drop shared-cache entirely (`file::memory:`) if not needed. Do the same change consistently in `subgames.test.ts`, `rules.test.ts`, and `players-t3-extension.test.ts` (each currently uses the same URI).

3. [low] Device bindings NOT NULL test also asserts only `.toThrow()` instead of verifying NOT NULL constraint
   - File: apps/tournament-api/src/db/schema/players-t3-extension.test.ts:242-261
   - Confidence: high
   - Why it matters: Same underlying issue as the rule_sets NOT NULL test: the assertion can succeed for unrelated errors, reducing confidence that the NOT NULL constraint on `device_bindings.device_info` is what’s being tested.
   - Suggested fix: Add a NOTNULL-capable `isConstraintError` helper in this file (or share one) and assert the thrown error matches NOT NULL (code/message).

## Strengths

- Migration content provided here appears additive-only and includes the intended FK ON DELETE actions, CHECK constraints, and partial unique index on players(ghin) WHERE ghin IS NOT NULL.
- The new tests cover important FK behaviors (CASCADE/RESTRICT/SET NULL) and CHECK/UNIQUE constraints, including a load-bearing multi-hop cascade chain test (AC #12b).
- Cleanup order in beforeEach blocks is generally in reverse FK-dependency order, which helps keep suites isolated when run serially.

## Warnings

None.
