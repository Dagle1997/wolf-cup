# Codex Review

- Generated: 2026-04-23T16:59:49.322Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/db/schema/courses.ts, apps/tournament-api/src/db/schema/courses.test.ts, apps/tournament-api/src/db/schema/index.ts, apps/tournament-api/src/db/migrations/0001_cloudy_chronomancer.sql

## Summary

The 4-table schema shape, FK onDelete posture (RESTRICT vs CASCADE), UNIQUE composites, and CHECK constraints appear consistent with the stated design decisions, and the test suite exercises the key invariants (including FK enforcement via PRAGMA). One concrete correctness risk is visible in the generated migration: `tenant_id` is created with a hard-coded DEFAULT 'guyan' across all four new tables, which conflicts with multi-tenant intent and the schema comments/tests that treat tenant stamping as the inserter’s responsibility.

Overall risk: high

## Findings

1. [high] Migration hard-codes tenant_id DEFAULT 'guyan' on all new tables (multi-tenant correctness/data isolation risk)
   - File: apps/tournament-api/src/db/migrations/0001_cloudy_chronomancer.sql:1-55
   - Confidence: high
   - Why it matters: All four tables (`courses`, `course_revisions`, `course_tees`, `course_holes`) are created with `tenant_id text DEFAULT 'guyan' NOT NULL` (e.g., lines 8, 28, 41, 53). This means inserts that omit `tenantId` will silently land in tenant 'guyan', which can cause cross-tenant data leakage and violates the stated design intent that tenant/context is “inserter’s responsibility” (and that future multi-tenant coexistence is supported). It also makes migrations/environment-dependent if 'guyan' is a dev seed tenant rather than a universal constant.
   - Suggested fix: Remove the DEFAULT from `tenant_id` for these new tables so callers must provide it (keep NOT NULL). Concretely: ensure `ecosystemColumns()` does not apply a default tenant_id (or override it in these table definitions), then re-run drizzle-kit to regenerate `0001_*.sql`. Add/adjust a test that an insert missing `tenantId` fails (NOT NULL) rather than defaulting.

2. [medium] Foreign key PRAGMA is connection-scoped; test setup assumes a single stable connection for all DB work
   - File: apps/tournament-api/src/db/schema/courses.test.ts:16-23
   - Confidence: medium
   - Why it matters: `PRAGMA foreign_keys = ON` is per-connection in SQLite/libsql. The mock enables it on the `client` connection (line 21) and then returns a `db` handle built on that client (line 18). This is fine as long as no other connections are introduced for migrations/queries. If a future refactor introduces a different client instance (pooling, separate migration client, etc.), FK enforcement could silently turn off and the RESTRICT/CASCADE tests would stop being meaningful.
   - Suggested fix: Keep enforcing FK PRAGMA in the same connection used by all operations. To make this robust, consider asserting FK state in `beforeAll` (e.g. query `PRAGMA foreign_keys` and expect 1) after `db` is constructed, or centralize PRAGMA enabling in the shared test DB factory used across test files.

## Strengths

- Schema definitions clearly encode the intended FK delete posture: RESTRICT on `course_revisions.course_id → courses.id` (courses.ts:70) and CASCADE on tees/holes → revisions (courses.ts:100,125), and the migration reflects those onDelete actions (0001 sql:10,30,43).
- Composite UNIQUE indexes are present for all specified pairs: (tenant_id, club_name, name) on `courses` (courses.ts:54-58 / migration:57), (course_id, revision_number) on `course_revisions` (courses.ts:86-88 / migration:34), (course_revision_id, tee_color) on `course_tees` (courses.ts:110-113 / migration:47), and (course_revision_id, hole_number) on `course_holes` (courses.ts:137-140 / migration:16).
- CHECK constraints for `hole_number` and `si` are implemented at the DB level (courses.ts:143-148) and appear in the migration (0001 sql:11-12), with tests explicitly asserting failures on out-of-range values.
- Tests explicitly enable `PRAGMA foreign_keys = ON` before running migrations and include both RESTRICT and CASCADE behavioral assertions, which protects against SQLite’s default FK-off footgun.
- Schema index.ts re-exports all four tables and their inferred types, matching the goal of making these available via the schema barrel.

## Warnings

None.
