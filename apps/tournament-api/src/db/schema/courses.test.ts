import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../migrations');

// Shared in-memory DB mock — mirrors session.test.ts + auth.test.ts so
// schema lives in one place across the file. Must be declared BEFORE
// any import that touches the db.
vi.mock('../index.js', async () => {
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client);
  // Enable foreign-key enforcement — SQLite defaults to OFF and our
  // RESTRICT/CASCADE tests below require it ON.
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

const { db } = await import('../index.js');
const { courses, courseRevisions, courseTees, courseHoles } = await import('./index.js');

const TENANT = 'guyan';
const LIBRARY_CONTEXT = 'library:guyan';

/**
 * Drizzle 0.45 wraps libsql errors in DrizzleQueryError with the real
 * LibsqlError on err.cause. Matches the pattern pinned by
 * auth.test.ts's libsql-UNIQUE-violation-shape test.
 */
function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object') {
    const c = cause as { extendedCode?: unknown; rawCode?: unknown };
    if (c.extendedCode === 'SQLITE_CONSTRAINT_UNIQUE' || c.rawCode === 2067) {
      return true;
    }
  }
  return false;
}

function isConstraintError(err: unknown, kind: 'FOREIGNKEY' | 'CHECK'): boolean {
  if (!err || typeof err !== 'object') return false;
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object') {
    const c = cause as { code?: unknown; extendedCode?: unknown; message?: unknown };
    const msg = typeof c.message === 'string' ? c.message : '';
    if (kind === 'FOREIGNKEY') {
      return (
        c.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' ||
        c.extendedCode === 'SQLITE_CONSTRAINT_FOREIGNKEY' ||
        msg.includes('FOREIGN KEY')
      );
    }
    return (
      c.code === 'SQLITE_CONSTRAINT_CHECK' ||
      c.extendedCode === 'SQLITE_CONSTRAINT_CHECK' ||
      msg.includes('CHECK')
    );
  }
  return false;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
  // Defense-in-depth: assert foreign_keys pragma is actually ON for
  // this connection. Codex impl-round-1 MED: PRAGMA is connection-scoped
  // and a future refactor introducing pooling could silently break the
  // RESTRICT / CASCADE tests. If this assertion fails, FK tests below
  // become meaningless.
  const { client } = (await import('../index.js')) as { client: { execute: (sql: string) => Promise<{ rows: unknown[] }> } };
  const result = await client.execute('PRAGMA foreign_keys');
  // libsql returns `{ rows: [{ foreign_keys: 1 }] }` (numeric) on most
  // versions, but older/alternate shapes may emit strings ('1') or
  // booleans. Coerce-and-truthy-check to survive both.
  const row = result.rows[0] as { foreign_keys?: unknown } | undefined;
  expect(row).toBeDefined();
  const fkState = row!['foreign_keys'];
  const fkOn = fkState === 1 || fkState === '1' || fkState === true;
  expect(fkOn).toBe(true);
});

beforeEach(async () => {
  // Clear all four course tables in dependency order (holes + tees
  // before revisions, revisions before courses). CASCADE handles some
  // of this but explicit truncation keeps test isolation loud.
  await db.delete(courseHoles);
  await db.delete(courseTees);
  await db.delete(courseRevisions);
  await db.delete(courses);
});

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

async function insertCourse(id: string, name = 'Pinehurst No. 2', clubName = 'Pinehurst Resort') {
  await db.insert(courses).values({
    id,
    name,
    clubName,
    createdAt: Date.now(),
    tenantId: TENANT,
    contextId: LIBRARY_CONTEXT,
  });
}

async function insertRevision(
  id: string,
  courseId: string,
  revisionNumber: number,
  overrides: Partial<{
    sourceUrl: string | null;
    extractionDate: number | null;
    verified: boolean;
    outTotal: number;
    inTotal: number;
    courseTotal: number;
    tenantId: string;
  }> = {},
) {
  await db.insert(courseRevisions).values({
    id,
    courseId,
    revisionNumber,
    sourceUrl: overrides.sourceUrl ?? null,
    extractionDate: overrides.extractionDate ?? null,
    verified: overrides.verified ?? true,
    outTotal: overrides.outTotal ?? 36,
    inTotal: overrides.inTotal ?? 36,
    courseTotal: overrides.courseTotal ?? 72,
    createdAt: Date.now(),
    tenantId: overrides.tenantId ?? TENANT,
    contextId: LIBRARY_CONTEXT,
  });
}

// ---------------------------------------------------------------------
// Tests (12 per AC #8)
// ---------------------------------------------------------------------

describe('courses schema (T2-1)', () => {
  // 1
  test('round-trip: insert a courses row with ecosystem cols and read it back', async () => {
    await db.insert(courses).values({
      id: 'c1',
      name: 'Pinehurst No. 2',
      clubName: 'Pinehurst Resort',
      createdAt: 1_700_000_000_000,
      tenantId: TENANT,
      contextId: LIBRARY_CONTEXT,
    });
    const rows = await db.select().from(courses).where(eq(courses.id, 'c1'));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.name).toBe('Pinehurst No. 2');
    expect(row.clubName).toBe('Pinehurst Resort');
    expect(row.createdAt).toBe(1_700_000_000_000);
    expect(row.tenantId).toBe(TENANT);
    expect(row.contextId).toBe(LIBRARY_CONTEXT);
  });

  // 2
  test('round-trip: course_revisions persists all fields including nullable source metadata', async () => {
    await insertCourse('c-rev-1');
    await db.insert(courseRevisions).values({
      id: 'rev-1',
      courseId: 'c-rev-1',
      revisionNumber: 1,
      sourceUrl: null, // nullable
      extractionDate: null, // nullable
      verified: true,
      outTotal: 35,
      inTotal: 37,
      courseTotal: 72,
      createdAt: 1_700_000_000_000,
      tenantId: TENANT,
      contextId: LIBRARY_CONTEXT,
    });
    const rows = await db
      .select()
      .from(courseRevisions)
      .where(eq(courseRevisions.id, 'rev-1'));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.revisionNumber).toBe(1);
    expect(row.verified).toBe(true);
    expect(row.outTotal).toBe(35);
    expect(row.inTotal).toBe(37);
    expect(row.courseTotal).toBe(72);
    expect(row.sourceUrl).toBeNull();
    expect(row.extractionDate).toBeNull();
  });

  // 3
  test('composite UNIQUE on course_revisions (course_id, revision_number)', async () => {
    await insertCourse('c-uniq-rev');
    await insertRevision('rev-a', 'c-uniq-rev', 1);
    let caught: unknown = null;
    try {
      await insertRevision('rev-b', 'c-uniq-rev', 1);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(isUniqueConstraintError(caught)).toBe(true);
  });

  // 4
  test('courses UNIQUE on (tenant_id, club_name, name)', async () => {
    await insertCourse('c-dup-1', 'Talamore', 'Talamore Golf Resort');
    let caught: unknown = null;
    try {
      await insertCourse('c-dup-2', 'Talamore', 'Talamore Golf Resort');
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(isUniqueConstraintError(caught)).toBe(true);
    // Sanity: a different name at the same club is NOT a duplicate.
    await insertCourse('c-dup-3', 'Talamore Championship', 'Talamore Golf Resort');
    const rows = await db
      .select()
      .from(courses)
      .where(eq(courses.clubName, 'Talamore Golf Resort'));
    expect(rows).toHaveLength(2);
  });

  // 5
  test('course_tees insert + composite UNIQUE on (course_revision_id, tee_color)', async () => {
    await insertCourse('c-tees-1');
    await insertRevision('rev-tees-1', 'c-tees-1', 1);
    await db.insert(courseTees).values([
      {
        id: 't-blue',
        courseRevisionId: 'rev-tees-1',
        teeColor: 'blue',
        rating: 723, // 72.3 × 10
        slope: 135,
        tenantId: TENANT,
        contextId: LIBRARY_CONTEXT,
      },
      {
        id: 't-white',
        courseRevisionId: 'rev-tees-1',
        teeColor: 'white',
        rating: 705,
        slope: 130,
        tenantId: TENANT,
        contextId: LIBRARY_CONTEXT,
      },
    ]);
    const rows = await db
      .select()
      .from(courseTees)
      .where(eq(courseTees.courseRevisionId, 'rev-tees-1'));
    expect(rows).toHaveLength(2);
    // Integer-cents rating round-trips.
    expect(rows.find((r) => r.teeColor === 'blue')?.rating).toBe(723);

    // Duplicate tee color rejected.
    let caught: unknown = null;
    try {
      await db.insert(courseTees).values({
        id: 't-blue-2',
        courseRevisionId: 'rev-tees-1',
        teeColor: 'blue',
        rating: 720,
        slope: 133,
        tenantId: TENANT,
        contextId: LIBRARY_CONTEXT,
      });
    } catch (err) {
      caught = err;
    }
    expect(isUniqueConstraintError(caught)).toBe(true);
  });

  // 6
  test('18 course_holes with per-tee yardages as JSON round-trip cleanly', async () => {
    await insertCourse('c-holes-1');
    await insertRevision('rev-holes-1', 'c-holes-1', 1);
    const yardagesByHole = Array.from({ length: 18 }, (_, i) => ({
      blue: 400 + i * 5,
      white: 370 + i * 5,
    }));
    for (let i = 1; i <= 18; i++) {
      await db.insert(courseHoles).values({
        id: `h-${i}`,
        courseRevisionId: 'rev-holes-1',
        holeNumber: i,
        par: i % 5 === 0 ? 5 : i % 3 === 0 ? 3 : 4,
        si: i,
        yardagePerTeeJson: JSON.stringify(yardagesByHole[i - 1]),
        tenantId: TENANT,
        contextId: LIBRARY_CONTEXT,
      });
    }
    const rows = await db
      .select()
      .from(courseHoles)
      .where(eq(courseHoles.courseRevisionId, 'rev-holes-1'));
    expect(rows).toHaveLength(18);
    // Spot-check hole 7's yardage JSON round-trip.
    const h7 = rows.find((r) => r.holeNumber === 7);
    expect(h7).toBeDefined();
    const yardages = JSON.parse(h7!.yardagePerTeeJson) as Record<string, number>;
    expect(yardages['blue']).toBe(yardagesByHole[6]!.blue);
    expect(yardages['white']).toBe(yardagesByHole[6]!.white);
  });

  // 7
  test('composite UNIQUE on course_holes (course_revision_id, hole_number)', async () => {
    await insertCourse('c-uniq-hole');
    await insertRevision('rev-uniq-hole', 'c-uniq-hole', 1);
    await db.insert(courseHoles).values({
      id: 'h-a',
      courseRevisionId: 'rev-uniq-hole',
      holeNumber: 1,
      par: 4,
      si: 5,
      yardagePerTeeJson: '{}',
      tenantId: TENANT,
      contextId: LIBRARY_CONTEXT,
    });
    let caught: unknown = null;
    try {
      await db.insert(courseHoles).values({
        id: 'h-b',
        courseRevisionId: 'rev-uniq-hole',
        holeNumber: 1,
        par: 3,
        si: 10,
        yardagePerTeeJson: '{}',
        tenantId: TENANT,
        contextId: LIBRARY_CONTEXT,
      });
    } catch (err) {
      caught = err;
    }
    expect(isUniqueConstraintError(caught)).toBe(true);
  });

  // 8
  test('CHECK constraints reject hole_number or si outside 1..18', async () => {
    await insertCourse('c-check-1');
    await insertRevision('rev-check-1', 'c-check-1', 1);

    // hole_number = 0 → CHECK fails
    let caught0: unknown = null;
    try {
      await db.insert(courseHoles).values({
        id: 'h-zero',
        courseRevisionId: 'rev-check-1',
        holeNumber: 0,
        par: 4,
        si: 5,
        yardagePerTeeJson: '{}',
        tenantId: TENANT,
        contextId: LIBRARY_CONTEXT,
      });
    } catch (err) {
      caught0 = err;
    }
    expect(isConstraintError(caught0, 'CHECK')).toBe(true);

    // hole_number = 19 → CHECK fails
    let caught19: unknown = null;
    try {
      await db.insert(courseHoles).values({
        id: 'h-nineteen',
        courseRevisionId: 'rev-check-1',
        holeNumber: 19,
        par: 4,
        si: 5,
        yardagePerTeeJson: '{}',
        tenantId: TENANT,
        contextId: LIBRARY_CONTEXT,
      });
    } catch (err) {
      caught19 = err;
    }
    expect(isConstraintError(caught19, 'CHECK')).toBe(true);

    // si = 0 → CHECK fails
    let caughtSi: unknown = null;
    try {
      await db.insert(courseHoles).values({
        id: 'h-si-zero',
        courseRevisionId: 'rev-check-1',
        holeNumber: 5,
        par: 4,
        si: 0,
        yardagePerTeeJson: '{}',
        tenantId: TENANT,
        contextId: LIBRARY_CONTEXT,
      });
    } catch (err) {
      caughtSi = err;
    }
    expect(isConstraintError(caughtSi, 'CHECK')).toBe(true);
  });

  // 9
  test('FK RESTRICT on courses: cannot delete a course while revisions exist', async () => {
    await insertCourse('c-restrict-1');
    await insertRevision('rev-restrict-1', 'c-restrict-1', 1);

    let caught: unknown = null;
    try {
      await db.delete(courses).where(eq(courses.id, 'c-restrict-1'));
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(isConstraintError(caught, 'FOREIGNKEY')).toBe(true);

    // Both rows still present after the failed delete.
    const courseRows = await db
      .select()
      .from(courses)
      .where(eq(courses.id, 'c-restrict-1'));
    expect(courseRows).toHaveLength(1);
    const revRows = await db
      .select()
      .from(courseRevisions)
      .where(eq(courseRevisions.courseId, 'c-restrict-1'));
    expect(revRows).toHaveLength(1);
  });

  // 10
  test('FK CASCADE on revisions: deleting a revision wipes its tees + holes', async () => {
    await insertCourse('c-cascade-1');
    await insertRevision('rev-cascade-1', 'c-cascade-1', 1);
    await insertRevision('rev-cascade-2', 'c-cascade-1', 2);

    await db.insert(courseTees).values({
      id: 't-cascade',
      courseRevisionId: 'rev-cascade-1',
      teeColor: 'blue',
      rating: 720,
      slope: 130,
      tenantId: TENANT,
      contextId: LIBRARY_CONTEXT,
    });
    await db.insert(courseHoles).values({
      id: 'h-cascade',
      courseRevisionId: 'rev-cascade-1',
      holeNumber: 1,
      par: 4,
      si: 5,
      yardagePerTeeJson: '{}',
      tenantId: TENANT,
      contextId: LIBRARY_CONTEXT,
    });

    // Delete revision 1 — its tees and holes cascade.
    await db.delete(courseRevisions).where(eq(courseRevisions.id, 'rev-cascade-1'));

    const teeRows = await db
      .select()
      .from(courseTees)
      .where(eq(courseTees.courseRevisionId, 'rev-cascade-1'));
    expect(teeRows).toHaveLength(0);

    const holeRows = await db
      .select()
      .from(courseHoles)
      .where(eq(courseHoles.courseRevisionId, 'rev-cascade-1'));
    expect(holeRows).toHaveLength(0);

    // Parent course remains.
    const courseRows = await db
      .select()
      .from(courses)
      .where(eq(courses.id, 'c-cascade-1'));
    expect(courseRows).toHaveLength(1);

    // Sibling revision remains.
    const siblingRevRows = await db
      .select()
      .from(courseRevisions)
      .where(eq(courseRevisions.id, 'rev-cascade-2'));
    expect(siblingRevRows).toHaveLength(1);
  });

  // 11
  test('re-import pattern: new revision on existing course preserves old revision', async () => {
    await insertCourse('c-reimport-1');
    await insertRevision('rev-reimport-1', 'c-reimport-1', 1, {
      sourceUrl: 'https://example.com/scorecard-v1.pdf',
      extractionDate: 1_700_000_000_000,
    });
    // Second "import" — same course, new revision number + new source.
    await insertRevision('rev-reimport-2', 'c-reimport-1', 2, {
      sourceUrl: 'https://example.com/scorecard-v2.pdf',
      extractionDate: 1_710_000_000_000,
    });

    const allRevs = await db
      .select()
      .from(courseRevisions)
      .where(eq(courseRevisions.courseId, 'c-reimport-1'));
    expect(allRevs).toHaveLength(2);

    const rev1 = allRevs.find((r) => r.revisionNumber === 1);
    const rev2 = allRevs.find((r) => r.revisionNumber === 2);
    expect(rev1?.sourceUrl).toBe('https://example.com/scorecard-v1.pdf');
    expect(rev2?.sourceUrl).toBe('https://example.com/scorecard-v2.pdf');
    expect(rev1?.extractionDate).toBe(1_700_000_000_000);
    expect(rev2?.extractionDate).toBe(1_710_000_000_000);
  });

  // 12 — [v1-gap] documents the current (unenforced) cross-tenant mismatch
  // possibility. When a future hardening story adds composite FK
  // enforcement, flip the expectation from "insert succeeds" to
  // "insert throws a FK constraint error."
  test('[v1-gap] cross-tenant mismatch IS POSSIBLE today (regression-guard assertion-flip)', async () => {
    // Course in tenant 'guyan'.
    await db.insert(courses).values({
      id: 'c-tenant-guyan',
      name: 'CrossTenant Probe',
      clubName: 'Probe Club',
      createdAt: Date.now(),
      tenantId: 'guyan',
      contextId: 'library:guyan',
    });
    // Revision references the course by id but claims tenant_id='other-tenant'.
    // TODAY this succeeds (no composite FK). Document the behavior.
    await db.insert(courseRevisions).values({
      id: 'rev-cross-tenant',
      courseId: 'c-tenant-guyan',
      revisionNumber: 1,
      verified: true,
      outTotal: 36,
      inTotal: 36,
      courseTotal: 72,
      createdAt: Date.now(),
      tenantId: 'other-tenant', // DOES NOT MATCH the course's tenant
      contextId: 'library:other-tenant',
    });
    const rows = await db
      .select()
      .from(courseRevisions)
      .where(
        and(
          eq(courseRevisions.id, 'rev-cross-tenant'),
          eq(courseRevisions.tenantId, 'other-tenant'),
        ),
      );
    expect(rows).toHaveLength(1);
    // When composite FK enforcement is added in a future hardening
    // story, this test should be INVERTED — assert the insert throws.
  });
});
