import { integer, sqliteTable, text, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { ecosystemColumns } from './_columns.js';

/**
 * Course library schema (T2-1, FD-8 revisioning).
 *
 * Four-table shape: one row per logical course, one row per revision of
 * that course, one row per tee color per revision, one row per hole per
 * revision. Per-tee yardages are stored as JSON on each hole row rather
 * than a fifth table — per-hole scoring aggregations query rows, while
 * per-tee yardages are rarely queried standalone.
 *
 * **FK delete posture (MIXED, per spec risk-acceptance):**
 *   - `course_revisions.course_id → courses.id`: **RESTRICT**. Deleting
 *     a course with revisions fails loudly. Accidental `DELETE FROM
 *     courses` can't silently wipe revision history + tees + holes.
 *   - `course_tees.course_revision_id → course_revisions.id`: **CASCADE**.
 *     Tees are revision-exclusive; orphan tees are useless.
 *   - `course_holes.course_revision_id → course_revisions.id`: **CASCADE**.
 *     Same reasoning as tees.
 *
 * **Tenant scoping:** all four tables carry `tenant_id` + `context_id`
 * via the `ecosystemColumns()` factory per FD-6. `context_id` is stamped
 * at insert as `'library:{tenant_id}'` (e.g. `'library:guyan'`) —
 * inserter's responsibility; `context_id` has NO default. `tenant_id`
 * intentionally DOES default to `'guyan'` per FD-6 v1 single-tenant
 * posture (inherited from `ecosystemColumns()`; same posture as T1-6a's
 * `players`, `oauth_identities`, `sessions`). Codex impl-round-1 flagged
 * this as a multi-tenant correctness risk for v2+; acknowledged as an
 * across-the-board v1 gap to be addressed when the first second-tenant
 * onboarding or cross-tenant leak incident triggers a hardening story.
 *
 * **Integer-cents rating:** `course_tees.rating` stores USGA rating × 10
 * (e.g. 72.3 → 723) to match the engine's integer-cents discipline and
 * sidestep floating-point equality bugs. T2-5's form layer handles the
 * display transform (show 72.3, send 723).
 *
 * **v1 integrity gap (acknowledged):** FKs reference parent `id` only,
 * NOT composite `(id, tenant_id)`. A buggy inserter can write a child
 * row whose `tenant_id` doesn't match its parent's. Same gap T1-6a has
 * on `oauth_identities.player_id`. Future hardening story would upgrade
 * both tables in a sweep. See spec risk-acceptance section.
 */

export const courses = sqliteTable(
  'courses',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    clubName: text('club_name').notNull(),
    createdAt: integer('created_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    // UNIQUE per-tenant on (club_name, name) prevents duplicate courses
    // from concurrent seed runs or admin double-submits. Tenant-scoped
    // so future multi-tenant deployments can coexist with same-named
    // courses across tenants.
    tenantClubNameUniq: uniqueIndex('uniq_courses_tenant_club_name').on(
      t.tenantId,
      t.clubName,
      t.name,
    ),
  }),
);

export type Course = typeof courses.$inferSelect;

export const courseRevisions = sqliteTable(
  'course_revisions',
  {
    id: text('id').primaryKey(),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'restrict' }),
    revisionNumber: integer('revision_number').notNull(),
    // Nullable — seed JSON may omit source metadata.
    sourceUrl: text('source_url'),
    extractionDate: integer('extraction_date'),
    verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
    // Printed totals (from the scorecard). T2-4 validator compares
    // against computed sum of holes 1-9, 10-18, 1-18 par values.
    outTotal: integer('out_total').notNull(),
    inTotal: integer('in_total').notNull(),
    courseTotal: integer('course_total').notNull(),
    createdAt: integer('created_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    courseIdx: index('idx_course_revisions_course_id').on(t.courseId),
    courseRevisionUniq: uniqueIndex(
      'uniq_course_revisions_course_id_revision_number',
    ).on(t.courseId, t.revisionNumber),
  }),
);

export type CourseRevision = typeof courseRevisions.$inferSelect;

export const courseTees = sqliteTable(
  'course_tees',
  {
    id: text('id').primaryKey(),
    courseRevisionId: text('course_revision_id')
      .notNull()
      .references(() => courseRevisions.id, { onDelete: 'cascade' }),
    teeColor: text('tee_color').notNull(),
    // Rating stored as integer × 10 (e.g. 72.3 → 723) per integer-cents
    // discipline. Form layer handles display transform.
    rating: integer('rating').notNull(),
    slope: integer('slope').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    revIdx: index('idx_course_tees_course_revision_id').on(t.courseRevisionId),
    revColorUniq: uniqueIndex('uniq_course_tees_revision_color').on(
      t.courseRevisionId,
      t.teeColor,
    ),
  }),
);

export type CourseTee = typeof courseTees.$inferSelect;

export const courseHoles = sqliteTable(
  'course_holes',
  {
    id: text('id').primaryKey(),
    courseRevisionId: text('course_revision_id')
      .notNull()
      .references(() => courseRevisions.id, { onDelete: 'cascade' }),
    holeNumber: integer('hole_number').notNull(),
    par: integer('par').notNull(),
    si: integer('si').notNull(),
    // JSON object: { blue: 420, white: 390, red: 340, ... }. Per-tee
    // yardages are rarely queried standalone; row-per-tee would be
    // overkill. Consumers parse via JSON.parse at read time.
    yardagePerTeeJson: text('yardage_per_tee_json').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    revIdx: index('idx_course_holes_course_revision_id').on(t.courseRevisionId),
    revHoleUniq: uniqueIndex('uniq_course_holes_revision_hole_number').on(
      t.courseRevisionId,
      t.holeNumber,
    ),
    // DB-level CHECK constraints for the most fundamental ranges.
    // Defense-in-depth until T2-4's app-level validator lands.
    checkHoleNumber: check(
      'check_course_holes_hole_number',
      sql`${t.holeNumber} BETWEEN 1 AND 18`,
    ),
    checkSi: check('check_course_holes_si', sql`${t.si} BETWEEN 1 AND 18`),
  }),
);

export type CourseHole = typeof courseHoles.$inferSelect;
