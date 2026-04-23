# Codex Review

- Generated: 2026-04-23T16:44:23.727Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T2-1-courses-revisions-schema.md

## Summary

Spec is concrete and implementable for a pure-schema story: table shapes, FK directions, migration ordinal rationale, and a clear ≥8-test plan are all spelled out. The main correctness/data-integrity gap is that tenant/context scoping is duplicated onto child rows but not enforced in FK relationships, allowing cross-tenant/context mismatches. Secondarily, skipping a uniqueness constraint on courses creates real duplicate/race risk for seed/re-import workflows. CASCADE-on-root is an intentional tradeoff but is a data-loss footgun worth revalidating for v1.

Overall risk: medium

## Findings

1. [high] Tenant/context integrity is not enforceable with current FK design (child rows can claim different tenant/context than their parent)
   - File: _bmad-output/implementation-artifacts/tournament/T2-1-courses-revisions-schema.md:44-120
   - Confidence: high
   - Why it matters: The spec requires every table to include NOT NULL `tenant_id` + `context_id` via `ecosystemColumns()` (lines 44-45, 63-64, 81-82, 102-103; plus explicit requirement lines 116-120). However, all foreign keys reference only the parent `id` (e.g., `course_revisions.course_id -> courses.id` lines 52-55; `course_tees.course_revision_id -> course_revisions.id` lines 75-78; `course_holes.course_revision_id -> course_revisions.id` lines 95-98). This permits inserting a child row that references a parent in tenant A while the child row’s `tenant_id/context_id` says tenant B. In a multi-tenant system, that’s both a data-integrity bug and a potential authorization boundary hazard: tenant-filtered queries can silently omit/strand rows, or joins can pull in “foreign” parent data if queries aren’t consistently scoped.
   - Suggested fix: Pick one enforcement strategy in v1:
- Strong DB enforcement: add a UNIQUE key on the parent like `(id, tenant_id)` (and possibly `(id, tenant_id, context_id)`) and make child FKs reference the composite key; also index accordingly.
- Or simplify: remove `tenant_id/context_id` from child tables and derive scope by joining to the parent (only keep scope columns at the root you query by). 
- If you intentionally defer enforcement, add at least one test demonstrating that mismatched tenant_id is possible today (to make the risk explicit), and document a follow-up story to harden it.

2. [medium] No DB-level uniqueness for courses can cause duplicates and race conditions during seed/re-import
   - File: _bmad-output/implementation-artifacts/tournament/T2-1-courses-revisions-schema.md:37-121
   - Confidence: high
   - Why it matters: The spec explicitly omits UNIQUE on `(courses.name, courses.club_name)` (Key decision #5 in the request; schema shown lines 39-45). Relying on “read-then-insert” idempotency in T2-2 is vulnerable to concurrency (two processes can read “missing” and both insert), and it also allows accidental duplicates from manual admin tooling (T2-5) or retries. Once duplicates exist, downstream references (events selecting a course) can become ambiguous and hard to clean up, especially with CASCADE deletes.
   - Suggested fix: If duplicates are truly acceptable, document how consumers disambiguate (by `id` only) and how admin UI prevents/selects. Otherwise add a tenant-scoped uniqueness constraint such as `uniqueIndex(...).on(t.tenantId, t.clubName, t.name)` (and possibly normalize/case-fold inputs or define a collation strategy). If you keep it out of v1, add a test that demonstrates the duplicate possibility and a follow-up AC for T2-2/T2-5 to prevent duplicates in code.

3. [medium] ON DELETE CASCADE from courses is a high-impact data-loss footgun if a course is ever deleted
   - File: _bmad-output/implementation-artifacts/tournament/T2-1-courses-revisions-schema.md:13-125
   - Confidence: high
   - Why it matters: The spec intentionally selects CASCADE everywhere (lines 15-26) and repeats the behavior as AC #4 (lines 122-125). While consistent with a prior auth FK, deleting a `courses` row will delete *all* revisions, tees, and holes. Even if “admin-only,” accidental deletes (manual SQL, future tooling, or a bug) will irreversibly wipe the library data. In v1, this is often where systems prefer RESTRICT at the root to force deliberate multi-step deletion.
   - Suggested fix: Reconfirm this is the intended v1 posture. A common compromise is “mixed”: RESTRICT on `course_revisions -> courses`, CASCADE on `course_tees/course_holes -> course_revisions` (your option #3). If you keep full CASCADE, consider requiring soft-delete in future, and ensure there is no planned codepath/UI that might delete courses unintentionally.

4. [low] UNIQUE-violation assertion via `err.cause?.extendedCode === 'SQLITE_CONSTRAINT_UNIQUE'` may be brittle across libsql/drizzle versions
   - File: _bmad-output/implementation-artifacts/tournament/T2-1-courses-revisions-schema.md:142-151
   - Confidence: medium
   - Why it matters: AC #8 specifies asserting `err.cause?.extendedCode === 'SQLITE_CONSTRAINT_UNIQUE'` (line 146). In many SQLite bindings, `extendedCode` is numeric (e.g., 2067) or exposed differently; drizzle error wrapping can also change. If this assertion shape drifts, tests will fail even though the constraint works, creating noisy CI failures.
   - Suggested fix: Prefer asserting on a stable surface:
- Check that the error message contains `SQLITE_CONSTRAINT_UNIQUE` (less strict but stable), or
- Assert `cause.code`/`sqliteErrorCode` if your chosen binding provides it consistently, or
- Accept either string or numeric forms in the matcher.
Since you cite an existing pinned pattern in T1-6b, ensure the new tests import and reuse the same helper/matcher (or copy the exact assertion) to avoid divergence.

5. [low] No schema-level CHECKs for hole_number/si ranges and rating/slope bounds; invalid data can be inserted until T2-4 exists
   - File: _bmad-output/implementation-artifacts/tournament/T2-1-courses-revisions-schema.md:91-107
   - Confidence: high
   - Why it matters: `holeNumber` is documented as 1..18 and `si` as 1..18 (lines 98-101), but there are no CHECK constraints. The spec notes validation is deferred to T2-4 (line 99). Until that lands, nothing prevents inserting hole 0/19, duplicate SI values, negative yardages, etc., which can break downstream aggregates and handicap logic.
   - Suggested fix: If deferring is intentional, add at least one minimal DB CHECK for the most fundamental invariants (e.g., `hole_number between 1 and 18`) to prevent catastrophic shapes. Otherwise, explicitly call out in the spec that the DB will accept out-of-range values until T2-4, and ensure seed/import code validates before insert.

## Strengths

- Acceptance criteria are specific (column names/types, indexes, FK directions) and should be implementable without guesswork (AC #1, #2).
- Explicitly documenting deviations (CASCADE choice, migration ordinal 0001) reduces “mystery drift” and makes reviewable tradeoffs (lines 13-30).
- Good test coverage intent for a schema-only story: composite UNIQUEs, cascade behavior, JSON round-trip, and multi-revision re-import pattern are all directly exercised (lines 142-152).
- Path isolation is clear: changes constrained to `apps/tournament-api/src/db/**` plus drizzle migration outputs, consistent with the stated allowlist (lines 221-246).

## Warnings

None.
