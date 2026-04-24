import { Hono } from 'hono';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { courseRevisions, courseTees, courses } from '../db/schema/index.js';

// Tenant scoping — v1 single-tenant. Every query in this route filters
// by `tenantId` to prevent cross-tenant leakage once multi-tenant
// onboarding happens (codex impl round-1 HIGH fix).
const TENANT_ID = 'guyan';

/**
 * T2-2 course-library read API.
 *
 * `GET /api/courses` returns every course with its latest revision +
 * that revision's tees. Ordering:
 *   - courses ASC by `name`
 *   - tees ASC by `teeColor` (stable rendering for admin UI and
 *     event-creation pickers)
 *
 * Response shape is camelCase (consistent with Wolf Cup's API posture).
 * `rating` is emitted as the raw integer × 10; client-side display
 * transforms divide by 10. `extractionDate` is milliseconds since epoch.
 *
 * When a course has multiple revisions (T2-3/T2-5 re-import case),
 * `latestRevision` is the one with the highest `revisionNumber`. Older
 * revisions are NOT included — a future story adds a history endpoint
 * if needed.
 */

export const coursesRouter = new Hono();

coursesRouter.get('/', async (c) => {
  const courseRows = await db
    .select({
      id: courses.id,
      name: courses.name,
      clubName: courses.clubName,
    })
    .from(courses)
    .where(eq(courses.tenantId, TENANT_ID))
    .orderBy(asc(courses.name));

  const result: Array<{
    id: string;
    name: string;
    clubName: string;
    latestRevision: {
      id: string;
      revisionNumber: number;
      verified: boolean;
      sourceUrl: string | null;
      extractionDate: number | null;
      outTotal: number;
      inTotal: number;
      courseTotal: number;
      tees: Array<{ color: string; rating: number; slope: number }>;
    } | null;
  }> = [];

  for (const course of courseRows) {
    // Highest revision_number wins. Tenant-scoped for defense-in-depth
    // against the v1 cross-tenant mismatch gap (same gap documented in
    // T2-1 risk acceptance).
    const latestRevRows = await db
      .select({
        id: courseRevisions.id,
        revisionNumber: courseRevisions.revisionNumber,
        verified: courseRevisions.verified,
        sourceUrl: courseRevisions.sourceUrl,
        extractionDate: courseRevisions.extractionDate,
        outTotal: courseRevisions.outTotal,
        inTotal: courseRevisions.inTotal,
        courseTotal: courseRevisions.courseTotal,
      })
      .from(courseRevisions)
      .where(
        and(
          eq(courseRevisions.courseId, course.id),
          eq(courseRevisions.tenantId, TENANT_ID),
        ),
      )
      .orderBy(desc(courseRevisions.revisionNumber))
      .limit(1);

    if (!latestRevRows[0]) {
      // Course without a revision is a data-shape anomaly (every
      // course should have at least revision 1 from the seed).
      // Emit a null latestRevision so the client can render "no
      // data" rather than 500.
      result.push({
        id: course.id,
        name: course.name,
        clubName: course.clubName,
        latestRevision: null,
      });
      continue;
    }
    const rev = latestRevRows[0];

    const teeRows = await db
      .select({
        color: courseTees.teeColor,
        rating: courseTees.rating,
        slope: courseTees.slope,
      })
      .from(courseTees)
      .where(
        and(
          eq(courseTees.courseRevisionId, rev.id),
          eq(courseTees.tenantId, TENANT_ID),
        ),
      )
      .orderBy(asc(courseTees.teeColor));

    result.push({
      id: course.id,
      name: course.name,
      clubName: course.clubName,
      latestRevision: {
        id: rev.id,
        revisionNumber: rev.revisionNumber,
        verified: rev.verified,
        sourceUrl: rev.sourceUrl,
        extractionDate: rev.extractionDate,
        outTotal: rev.outTotal,
        inTotal: rev.inTotal,
        courseTotal: rev.courseTotal,
        tees: teeRows,
      },
    });
  }

  return c.json({ courses: result });
});
