# Codex Review

- Generated: 2026-04-28T12:51:47.182Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/db/schema/scoring.ts, apps/tournament-api/src/db/schema/scoring.test.ts, apps/tournament-api/src/db/schema/audit.ts, apps/tournament-api/src/db/schema/audit.test.ts, apps/tournament-api/src/db/schema/index.ts, apps/tournament-api/src/db/migrations/0004_supreme_gambit.sql, apps/tournament-api/src/db/migrations/meta/_journal.json, apps/tournament-api/PORTS.md

## Summary

Round-1 items (DESC index order + cross-file test DB isolation + added CHECK tests) appear implemented correctly in schema and reflected in the regenerated migration. Main remaining concern is the safety of “delete-and-regen” migration churn if any environments already applied the prior 0004/0005, plus a smaller risk that switching to `:memory:` could surprise future tests/codepaths that open multiple DB connections.

Overall risk: medium

## Findings

1. [high] Potentially breaking migration-history rewrite: new 0004 creates tables/indexes and will fail if an earlier 0004/0005 was already applied anywhere
   - File: apps/tournament-api/src/db/migrations/0004_supreme_gambit.sql:1-106
   - Confidence: medium
   - Why it matters: This migration is a full CREATE of the scoring/audit tables and indexes. If any developer DB, preview env, or prod-like env already ran a previous migration that created these tables (even with slightly different index definitions), the next `migrate()` run will attempt to apply `0004_supreme_gambit` (because its name/tag differs) and will error on existing tables/indexes. That risk is amplified by the accompanying journal update that now points at `0004_supreme_gambit` (apps/tournament-api/src/db/migrations/meta/_journal.json).
   - Suggested fix: If there is any chance prior versions of 0004/0005 have been applied, do not replace them. Instead: (1) restore the old migration files so existing DBs can still match repo history, and add a new additive migration (e.g., 0005/0006) to adjust indexes to DESC; or (2) if this is truly unreleased and no DBs applied it, document that assumption explicitly in the PR/story and ensure all environments are rebuilt from scratch.

2. [medium] `:memory:` test DB choice improves isolation but may break future multi-connection patterns (diverges from existing shared-cache approach)
   - File: apps/tournament-api/src/db/schema/scoring.test.ts:13-23
   - Confidence: medium
   - Why it matters: Using `createClient({ url: ':memory:' })` ensures each client gets a private in-memory DB, which fixes cross-file bleed. However, it also means any future code under test that opens an additional libsql client/connection will see a different empty DB (no schema, no data). Other test files reportedly use `file::memory:?cache=shared` specifically to allow multiple connections to share the same in-memory DB. This divergence can cause hard-to-diagnose failures when test helpers or codepaths start creating their own clients.
   - Suggested fix: Consider standardizing on a helper that creates a per-test-file unique shared-cache URI, e.g. `file:vitest-${process.pid}-${fileHash}?mode=memory&cache=shared`, so you keep cross-file isolation while preserving same-DB semantics across multiple clients within a file. If you keep `:memory:`, add a short comment that tests assume a single connection and will need refactor if multi-client code is introduced.

3. [low] Test cleanup in scoring.test.ts doesn’t clear new scoring-domain tables, which can create future intra-file coupling
   - File: apps/tournament-api/src/db/schema/scoring.test.ts:62-72
   - Confidence: high
   - Why it matters: The migration creates `score_corrections`, `round_states`, and `scorer_assignments` (0004_supreme_gambit.sql), but `beforeEach` only deletes from `hole_scores`, `rounds`, `event_rounds`, `events`, `course_revisions`, `courses`, `players`. If later tests in this file start inserting into those other tables, leftover rows could cause unexpected FK/UNIQUE/CHECK failures or make tests order-dependent.
   - Suggested fix: Either delete from `scoreCorrections`, `roundStates`, and `scorerAssignments` in `beforeEach` (in correct FK order), or switch to wrapping each test in a transaction + rollback if libsql/drizzle setup supports it.

## Strengths

- DESC-ordered indexes are now expressed in the Drizzle schema via `desc(t.createdAt)` and are reflected in the generated SQL (e.g., `"created_at" desc` in 0004).
- Cross-file DB isolation intent is clear and implemented consistently in both scoring.test.ts and audit.test.ts by using a per-file in-memory DB client.
- Added CHECK-constraint tests for `gross_strokes >= 1` and `hole_number` bounds directly exercise DB-enforced invariants.

## Warnings

None.
