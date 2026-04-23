# Story T2.1: Courses + Revisions Schema

Status: ready-for-dev

## Story

As a developer,
I want `courses` + `course_revisions` + `course_tees` + `course_holes` tables defined with revision-aware referential integrity,
So that course data persists durably across re-tees and resurfacings (FD-8 revisioning; brief §4.2 `source_url` + `extraction_date`) AND downstream stories (T2-2 seed, T2-5 admin UI, T3-2 event creation) have a canonical schema to target.

**Scope context:** First story of Epic T2. Pure schema + migration + shape-tests. No data seeding (that's T2-2), no parser (T2-3), no validator (T2-4), no UI (T2-5). This story establishes the tenant-scoped course-library shape and the revision-chain integrity contract.

## Explicit Risk Acceptance (spec-gate decision)

### FK cascade rules — MIXED posture (updated from round-1)

The epic text specifies foreign keys but is silent on ON DELETE behavior. Three defensible choices:

1. **CASCADE everywhere** — deleting a `courses` row deletes all `course_revisions`, and each revision deletion cascades to `course_tees` + `course_holes`.
2. **RESTRICT everywhere** — deleting a `courses` row fails if any `course_revisions` reference it. Operator must explicitly delete revisions first.
3. **Mixed** — RESTRICT on `course_revisions → courses` (defensive against accidental wipes), CASCADE on `course_tees` / `course_holes → course_revisions` (revisions exclusively own their holes/tees).

**This spec picks option 3 (MIXED), updated from initial CASCADE-everywhere after round-1 codex feedback.** Reasoning:
- RESTRICT on `course_revisions → courses` prevents an accidental `DELETE FROM courses WHERE id = ?` from irrecoverably wiping revision history + tees + holes. The operator has to explicitly drop revisions first, which is loud enough to catch a mistake.
- CASCADE on `course_tees + course_holes → course_revisions` is still correct — tees and holes are revision-exclusive; no other table references them; orphan rows are useless; and an explicit revision deletion is an operator action that should propagate.
- Matches codex round-1's MED recommendation (option 3). Cost: v1 admin-DB operations need two deletes instead of one; acceptable friction for data-loss protection.

Note: the T1-6a auth schema used CASCADE on `oauth_identities.player_id → players.id`. That pattern is NOT being changed; this decision applies only to the new course tables.

### Tenant/context integrity — v1 gap acknowledged

Every table in the schema carries `tenant_id` + `context_id` per FD-6. The foreign keys reference ONLY the parent's `id` — NOT a composite `(id, tenant_id)` — so **a buggy inserter can write a child row whose `tenant_id` doesn't match its parent's `tenant_id`**. DB-level enforcement would require either (a) composite FKs like `FOREIGN KEY (course_id, tenant_id) REFERENCES courses(id, tenant_id)` (raw SQL; drizzle's `references()` API doesn't cleanly support composite FKs at T0.45) or (b) removing `tenant_id/context_id` from child tables and scoping via JOIN to the parent.

**This gap is NOT new in T2-1** — the same gap exists in T1-6a's `oauth_identities` table (ecosystem columns + FK to `players.id` by id only). T2-1 inherits the same posture.

**Related v1 gap (surfaced by impl-codex round 1):** `tenant_id` has a DEFAULT value of `'guyan'` (inherited from the `ecosystemColumns()` factory — same default applies to T1-6a's `players`, `oauth_identities`, `sessions`). An inserter that forgets to pass `tenantId` silently defaults to 'guyan' rather than failing with NOT NULL. In v1 single-tenant this is intentional (simplifies seed + admin UI inserts); for v2+ multi-tenant this enables silent cross-tenant writes. Same future-hardening concern as the composite-FK gap — both address v1→v2 tenant-enforcement, both should land in the same sweep.

**v1 posture:** accept both gaps. Rationale:
- Epic T2's ONLY inserters are T2-2 (seed script) and T2-5 (admin UI POST handler), both controlled code paths under our ownership.
- Multi-tenant deployment is not a v1 or v2 concern (single tenant `'guyan'` for all of Pinehurst-era work; ecosystem columns are forward-planning per FD-6).
- AC #8 includes a test that captures the cross-tenant mismatch behavior as a regression-guard assertion-flip point for the eventual hardening.

When to revisit: if a second tenant is ever onboarded OR an incident occurs traceable to a mismatched `tenant_id` row. At that point the hardening story should upgrade BOTH `oauth_identities` AND all four course tables in one sweep — AND drop the `tenant_id DEFAULT 'guyan'` from `ecosystemColumns()`, forcing every inserter to be explicit.

### Migration ordinal: 0001 (not 0002 as the epic text suggests)

The epic text (line 612) says "`0002_<descriptive_name>.sql` (or current ordinal — sequence starts at 0001 from T1.6 auth schema)". **Observed reality: T1-6a shipped migration `0000_medical_typhoid_mary.sql`.** So T2-1's migration is `0001_*.sql`. The spec is authoritative; the epic text is stale.

## Acceptance Criteria

1. **Given** `apps/tournament-api/src/db/schema/courses.ts` (new file)
   **When** inspected
   **Then** it defines four `sqliteTable`s with the following shapes (column types cite drizzle's `sqlite-core` helpers):

   **`courses`**:
   ```ts
   export const courses = sqliteTable('courses', {
     id: text('id').primaryKey(),                         // app-generated UUID
     name: text('name').notNull(),
     clubName: text('club_name').notNull(),
     createdAt: integer('created_at').notNull(),          // Date.now() ms at insert
     ...ecosystemColumns(),                               // tenant_id + context_id
   }, (t) => ({
     // UNIQUE per-tenant on (club_name, name) prevents duplicate courses
     // from concurrent seed runs or admin double-submits. Tenant-scoped
     // so future multi-tenant deployments can coexist with same-named
     // courses across tenants. Codex round-1 MED fix.
     tenantClubNameUniq: uniqueIndex('uniq_courses_tenant_club_name')
       .on(t.tenantId, t.clubName, t.name),
   }));
   ```

   **`course_revisions`**:
   ```ts
   export const courseRevisions = sqliteTable('course_revisions', {
     id: text('id').primaryKey(),
     courseId: text('course_id')
       .notNull()
       .references(() => courses.id, { onDelete: 'restrict' }),
     revisionNumber: integer('revision_number').notNull(),
     sourceUrl: text('source_url'),                       // nullable — seeds may omit
     extractionDate: integer('extraction_date'),          // nullable — seeds may omit
     verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
     outTotal: integer('out_total').notNull(),            // printed out total (par sum holes 1-9)
     inTotal: integer('in_total').notNull(),              // printed in total (par sum holes 10-18)
     courseTotal: integer('course_total').notNull(),      // printed course total
     createdAt: integer('created_at').notNull(),
     ...ecosystemColumns(),
   }, (t) => ({
     courseIdx: index('idx_course_revisions_course_id').on(t.courseId),
     courseRevisionUniq: uniqueIndex('uniq_course_revisions_course_id_revision_number')
       .on(t.courseId, t.revisionNumber),
   }));
   ```

   **`course_tees`**:
   ```ts
   export const courseTees = sqliteTable('course_tees', {
     id: text('id').primaryKey(),
     courseRevisionId: text('course_revision_id')
       .notNull()
       .references(() => courseRevisions.id, { onDelete: 'cascade' }),
     teeColor: text('tee_color').notNull(),               // e.g. 'blue', 'white', 'red'
     rating: integer('rating').notNull(),                 // USGA course rating × 10 (integer cents pattern)
     slope: integer('slope').notNull(),
     ...ecosystemColumns(),
   }, (t) => ({
     revIdx: index('idx_course_tees_course_revision_id').on(t.courseRevisionId),
     revColorUniq: uniqueIndex('uniq_course_tees_revision_color')
       .on(t.courseRevisionId, t.teeColor),
   }));
   ```

   **Rating stored as integer × 10 (e.g. rating 72.3 → 723)** matches the integer-cents discipline used elsewhere in the engine for stableford math. Dev Notes elaborates.

   **`course_holes`**:
   ```ts
   export const courseHoles = sqliteTable('course_holes', {
     id: text('id').primaryKey(),
     courseRevisionId: text('course_revision_id')
       .notNull()
       .references(() => courseRevisions.id, { onDelete: 'cascade' }),
     holeNumber: integer('hole_number').notNull(),        // 1..18 (CHECK constraint below)
     par: integer('par').notNull(),                       // typically 3/4/5; T2-4 validator enforces
     si: integer('si').notNull(),                         // stroke index 1..18 (CHECK constraint below)
     yardagePerTeeJson: text('yardage_per_tee_json').notNull(),  // JSON object: {blue: 420, white: 390, ...}
     ...ecosystemColumns(),
   }, (t) => ({
     revIdx: index('idx_course_holes_course_revision_id').on(t.courseRevisionId),
     revHoleUniq: uniqueIndex('uniq_course_holes_revision_hole_number')
       .on(t.courseRevisionId, t.holeNumber),
     // DB-level CHECK constraints for the most fundamental ranges.
     // Defense-in-depth until T2-4's validator lands. Codex round-1 LOW fix.
     // Drizzle 0.45 exposes `check()` from drizzle-orm/sqlite-core.
     checkHoleNumber: check('check_course_holes_hole_number', sql`hole_number BETWEEN 1 AND 18`),
     checkSi: check('check_course_holes_si', sql`si BETWEEN 1 AND 18`),
   }));
   ```

   The `check` + `sql` imports come from `drizzle-orm/sqlite-core` and `drizzle-orm` respectively. If drizzle's check-API differs at install time (ORM minor-version drift), the dev agent may emit raw CHECK constraints in the migration SQL instead; functional outcome must be identical (inserting hole_number=0 or 19 is rejected at DB level with a CONSTRAINT error).

   Matching `type Course = typeof courses.$inferSelect;` (etc.) exports at the bottom of the file.

2. **Given** `apps/tournament-api/src/db/schema/index.ts`
   **When** inspected post-T2-1
   **Then** the existing re-exports (`players`, `oauthIdentities`, `sessions`) remain byte-unchanged AND four new re-exports are added: `courses`, `courseRevisions`, `courseTees`, `courseHoles` (plus their `type ...` exports). Ordering: existing exports first, then new course-library block — matches the file's current pattern of one-export-per-line.

3. **Given** all four tables
   **When** inspected
   **Then** each includes `tenant_id` + `context_id` NOT NULL columns via the existing `ecosystemColumns()` factory in `apps/tournament-api/src/db/schema/_columns.ts`. The factory's `tenant_id` default (`'guyan'`) is inherited; the `context_id` column is NOT NULL and has no default — callers (T2-2 seed, T2-5 handler) MUST stamp it explicitly at insert as `'library:{tenant_id}'` (e.g. `'library:guyan'`). This is the most-specific owning scope for course library rows per FD-6.

   **Explicit non-goal for T2-1:** this story does NOT add a runtime guard (Zod refinement, DB CHECK constraint, or trigger) that enforces `context_id LIKE 'library:%'`. Downstream stories (T2-2 seed, T2-5 insert handler) are responsible for stamping the correct context_id; if they stamp the wrong thing the bug surfaces at query time in T3+ when event-scoped rows are expected to be event-scoped. Spec-level trust in the inserter is acceptable for v1.

4. **Given** FK cascade behavior (MIXED posture per risk-acceptance)
   **When** a `courses` row is deleted AND any `course_revisions` reference it
   **Then** the delete fails with a FOREIGN KEY constraint violation (RESTRICT). The operator must explicitly delete the revisions first.
   **When** a `course_revisions` row is deleted
   **Then** all `course_tees` + `course_holes` pointing at it cascade-delete. AC #8 includes tests for BOTH the RESTRICT path (on courses) and the CASCADE path (on revisions).

5. **Given** `pnpm -F @tournament/api db:generate` (the portable drizzle-kit wrapper from T1-6a)
   **When** run after schema additions
   **Then** a migration file `apps/tournament-api/src/db/migrations/0001_<drizzle-auto-name>.sql` is produced — the `0001` ordinal is mandatory (T1-6a occupied `0000_medical_typhoid_mary.sql`). The migration contains `CREATE TABLE` statements for all four new tables, all composite indexes from AC #1, AND `PRAGMA foreign_keys=ON` enforcement is already on per T1-6a's migration (no change needed here — drizzle-kit emits migrations that respect the existing pragma).

   **Do NOT rename the auto-generated `_<name>` suffix manually.** Drizzle's naming scheme is stable (adjectival + noun derived from a dictionary seed); renaming breaks the `meta/_journal.json` correlation.

6. **Given** `pnpm -F @tournament/api db:migrate`
   **When** run against a fresh DB (`DB_PATH=:memory:` or a blank file)
   **Then** both `0000_*.sql` (auth schema) and `0001_*.sql` (courses schema) apply in order with zero errors. Exit 0.

7. **Given** the existing migration `0000_medical_typhoid_mary.sql`
   **When** inspected post-T2-1
   **Then** it is byte-unchanged. T2-1 is strictly additive; touching 0000 would be a schema-drift bug.

8. **Given** `apps/tournament-api/src/db/schema/courses.test.ts` (new file)
   **When** `pnpm -F @tournament/api test` runs
   **Then** the following tests exist (≥12 total) and pass, using the established mock-db + migrate + in-memory libsql pattern from `session.test.ts`:

   - Insert a `courses` row with ecosystem cols (`tenant_id='guyan'`, `context_id='library:guyan'`) and read it back; verify all fields persist round-trip.
   - Insert a `course_revisions` row with `courseId` referencing the inserted course; verify `revisionNumber`, `verified`, `outTotal`/`inTotal`/`courseTotal` persist; nullable `sourceUrl` + `extractionDate` accept `null`.
   - Composite UNIQUE on `(course_id, revision_number)` — inserting two revisions with the same `(courseId, revisionNumber)` throws a UNIQUE-constraint error. (Exercises the same error path as T1-6b's oauth_identities UNIQUE — drizzle wraps in `DrizzleQueryError` with real `LibsqlError` on `err.cause`; test inspects `.cause?.extendedCode === 'SQLITE_CONSTRAINT_UNIQUE'`.)
   - Courses UNIQUE on `(tenant_id, club_name, name)` — inserting a second `courses` row with identical tenant+club+name throws. Codex round-1 MED fix.
   - Insert `course_tees` rows with distinct tee colors for a revision; composite UNIQUE on `(course_revision_id, tee_color)` rejects a duplicate color.
   - Insert 18 `course_holes` rows for a revision with hole_numbers 1-18 and per-tee yardages stored as JSON. `JSON.parse(row.yardagePerTeeJson)` round-trips the tee-color-to-yardage object.
   - Composite UNIQUE on `(course_revision_id, hole_number)` — inserting two holes with the same `(revisionId, holeNumber)` throws.
   - CHECK constraint on `course_holes.hole_number` — inserting `hole_number = 0` OR `hole_number = 19` throws a CHECK constraint violation. Same shape on `course_holes.si`. Codex round-1 LOW fix.
   - FK RESTRICT on courses: delete the `courses` row while revisions exist → throws a FOREIGN KEY constraint error; courses + revisions are all still present after the failed delete.
   - FK CASCADE on revisions: delete a `course_revisions` row → all `course_tees` + `course_holes` pointing at it are gone; the parent `courses` row remains; other revisions of the same course remain.
   - Re-import pattern (the epic AC #4 case): insert a course + revision 1, then insert revision 2 for the SAME course with a NEW `sourceUrl` + `extractionDate`. Revision 1 remains intact; revision 2 is readable; both are returned by a `SELECT * FROM course_revisions WHERE course_id = ?` ordered by `revision_number`.
   - **Tenant/context mismatch IS POSSIBLE today (v1 posture assertion)** — codex round-1 HIGH acknowledgment. Insert a `courses` row with `tenant_id='guyan'`, then insert a `course_revisions` row with `courseId` referencing it BUT with `tenant_id='other-tenant'`. Assert the insert succeeds without error. This test documents the current behavior and serves as a regression-guard assertion-flip point when a future hardening story adds composite-FK enforcement. Test name clearly marks it as `[v1-gap]` so a future dev knows to flip the assertion.

   Total: 12 enumerated tests. All are required — not "minimum of 8"; the list above is the full contract.

9. **Given** `pnpm -F @tournament/api typecheck` + `pnpm -F @tournament/api lint`
   **When** run post-T2-1
   **Then** both exit 0 under the existing strictness flags. `no-console` rule from T1-7 is respected (schema module writes nothing).

10. **Given** `pnpm -F @tournament/api test`
    **When** run
    **Then** total tests ≥ 85 (73 at start of T2-1 + ≥12 new from AC #8). Existing T1 tests continue to pass with no count loss.

11. **Given** Wolf Cup workspaces
    **When** `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` run post-T2-1
    **Then** both continue to pass with zero net-negative test count change. Same regression guard as every T1 story.

12. **Given** `apps/tournament-api/src/db/schema/courses.ts`
    **When** inspected
    **Then** NO runtime logic lives in this file — it is a pure schema declaration module. No utility functions, no constants beyond schema. The `revisionNumber` sequencing logic (auto-increment per course) is the SEED/INSERTER's responsibility (T2-2), not this module's.

13. **Given** the integer-cents posture for rating
    **When** inspected
    **Then** `course_tees.rating` is stored as `integer` with units "rating × 10" (e.g. rating 72.3 → 723). This mirrors the integer-cents discipline in the engine's money/bets math (documented in tournament architecture D2-3). The corresponding Zod / form schema in T2-5 will handle the display transform (show 72.3, send 723). AC #8 tests confirm round-trip integer storage.

## Tasks / Subtasks

- [ ] Task 1: Create `src/db/schema/courses.ts` with 4 tables (AC #1, #3, #4, #12, #13).
  - [ ] Subtask 1.1: Import `integer`, `sqliteTable`, `text`, `index`, `uniqueIndex` from `drizzle-orm/sqlite-core`.
  - [ ] Subtask 1.2: Import `ecosystemColumns` from `./_columns.js`.
  - [ ] Subtask 1.3: Define the four tables in dependency order (`courses`, `courseRevisions`, `courseTees`, `courseHoles`) so forward FKs compile.
  - [ ] Subtask 1.4: Export `$inferSelect` types for each.

- [ ] Task 2: Update `src/db/schema/index.ts` re-exports (AC #2).
  - [ ] Subtask 2.1: Add 4 re-export lines (`courses`, `courseRevisions`, `courseTees`, `courseHoles`) + their types.

- [ ] Task 3: Generate migration 0001 (AC #5).
  - [ ] Subtask 3.1: Run `pnpm -F @tournament/api db:generate` (uses the portable `scripts/drizzle-kit.mjs` wrapper).
  - [ ] Subtask 3.2: Verify the generated file lives at `src/db/migrations/0001_*.sql` and contains CREATE TABLE for all four tables + all indexes.
  - [ ] Subtask 3.3: Commit the migration file AS-GENERATED — do not rename, do not hand-edit.

- [ ] Task 4: Verify migration runs clean (AC #6, #7).
  - [ ] Subtask 4.1: `rm -f apps/tournament-api/data/tournament.db` (or use `:memory:`) to ensure fresh DB.
  - [ ] Subtask 4.2: `pnpm -F @tournament/api db:migrate` → exits 0 with both migrations applied.
  - [ ] Subtask 4.3: Confirm `src/db/migrations/0000_medical_typhoid_mary.sql` is byte-unchanged (`git diff` returns nothing for that file).

- [ ] Task 5: Write schema tests (AC #8).
  - [ ] Subtask 5.1: Create `src/db/schema/courses.test.ts` using the mock-db + migrate pattern established in `session.test.ts`.
  - [ ] Subtask 5.2: Implement all 12 test cases enumerated in AC #8.
  - [ ] Subtask 5.3: Reuse the drizzle-`.cause`-unwrap pattern from `auth.test.ts` for the UNIQUE-violation assertions.

- [ ] Task 6: Run regressions (AC #9, #10, #11).
  - [ ] Subtask 6.1: `pnpm -F @tournament/api typecheck` → 0.
  - [ ] Subtask 6.2: `pnpm -F @tournament/api lint` → 0.
  - [ ] Subtask 6.3: `pnpm -F @tournament/api test` → ≥85.
  - [ ] Subtask 6.4: `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` → counts unchanged.

## Dev Notes

- **Why tenant-scoped courses, not event-scoped:** course library pre-exists events. A single course (e.g. Pinehurst No. 2) may be referenced by many events across many years. `context_id = 'library:{tenant_id}'` is the correct scope — most-specific owning scope at insert time, per FD-6. Future multi-tenant deployments would have distinct `tenant_id` values, each with their own isolated library.

- **Why 18 holes as rows, not a JSON blob:** future queries will include per-hole aggregations (e.g. "handicap-stroke-dots per player per hole", "average score per hole across tournaments"). Rows are queryable; JSON blobs are not (without sqlite's json1 functions, which drizzle abstracts but at query-ergonomic cost). Per-tee yardages GO in a JSON blob (AC #1's `yardagePerTeeJson`) because they're rarely queried and the cardinality (4-6 tees per hole) doesn't justify a fifth table.

- **Why `rating × 10` as integer:** USGA course ratings are published to 1 decimal place (e.g. 72.3, 70.8). Storing as integer × 10 sidesteps floating-point equality bugs in tests and keeps the integer-cents discipline consistent across the codebase. T2-5's form layer handles the display transform (72.3 ↔ 723).

- **Why MIXED FK delete posture (RESTRICT on courses → revisions, CASCADE on revisions → tees/holes):** see spec "Explicit Risk Acceptance" section. Updated from CASCADE-everywhere after round-1 codex feedback.

- **Migration ordinal:** T1-6a shipped `0000_medical_typhoid_mary.sql`. T2-1 generates `0001_<auto>.sql`. The epic's text (line 612) that says "0002" is stale — that text was written before T1-6a's migration was committed. Spec overrides epic text.

- **Why no `is_pinehurst` flag or similar:** course library is generic. Pinehurst-specific flags (verified=true for the 4 confirmed courses) live on `course_revisions.verified`, NOT on `courses.name`. The seed script (T2-2) knows which courses to mark verified.

- **Wolf Cup isolation (FD-1/FD-2):** T2-1 writes only to `apps/tournament-api/src/db/**` (schema + migration + test). Zero writes to `apps/api/**`, `apps/web/**`, `packages/engine/**`, or any root-level file. Zero SHARED gates anticipated.

- **Test-pattern reuse:** the `session.test.ts` + `auth.test.ts` mock-db-with-migrate pattern is the canonical shape. Copy it. The drizzle-`.cause`-unwrap for UNIQUE assertions is pinned in `auth.test.ts`'s libsql-error-shape test — same approach here.

### Project Structure Notes

Shape after T2-1:
```
apps/tournament-api/
  src/
    db/
      schema/
        _columns.ts        # unchanged (ecosystemColumns factory)
        auth.ts            # unchanged (T1-6a sessions)
        courses.ts         # NEW — 4 tables
        courses.test.ts    # NEW — 12 tests
        index.ts           # MODIFIED — +4 re-exports
        oauth_identities.ts # unchanged (T1-6a)
        players.ts         # unchanged (T1-6a)
      migrations/
        0000_medical_typhoid_mary.sql  # byte-unchanged
        0001_<auto-name>.sql            # NEW — drizzle-generated
        meta/
          _journal.json    # MODIFIED (drizzle appends to it automatically)
          0001_snapshot.json # NEW (drizzle auto-writes)
```

**Explicitly NOT in T2-1 (reserved for future stories):**
- Pinehurst seed JSON (`reference/pinehurst-may-2026-courses.json`) — T2-2's concern.
- `GET /api/courses` route — T2-2.
- Seed script / `pnpm seed` — T2-2.
- PDF parser — T2-3 (target-miss-tolerable).
- Course validator — T2-4.
- Admin UI — T2-5.
- Course deletion endpoint — not in Epic T2 at all; DB-level operation if ever needed.
- Soft-delete columns (`archived_at`, etc.) — not in v1.

### References

- T1-6a schemas + migration pattern: `apps/tournament-api/src/db/schema/{players,oauth_identities,auth}.ts`, `src/db/migrations/0000_medical_typhoid_mary.sql`.
- T1-6a portable drizzle-kit wrapper: `apps/tournament-api/scripts/drizzle-kit.mjs`.
- Test pattern: `apps/tournament-api/src/lib/session.test.ts` (mock-db + migrate + in-memory libsql).
- UNIQUE-violation `.cause` unwrap pattern: `apps/tournament-api/src/routes/auth.test.ts` "libsql UNIQUE-violation error shape" test.
- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` lines 594-616 (4 ACs).
- FD-6 ecosystem columns: tournament architecture.
- FD-8 revisioning rationale: tournament PRD brief §4.2.
- T1 retrospective action items AI-4, AI-6: reuse ecosystem factory + drizzle-kit wrapper, don't reinvent.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
