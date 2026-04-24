import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './index.js';
import {
  courseHoles,
  courseRevisions,
  courseTees,
  courses,
  oauthIdentities,
  players,
} from './schema/index.js';
import { logger } from '../lib/log.js';

/**
 * T2-2 seed importer.
 *
 * Reads `reference/pinehurst-may-2026-courses.json` and loads 5 Pinehurst-
 * area courses into the course-library schema shipped by T2-1. Idempotent
 * across re-runs: match by `(tenantId, clubName, name)` for courses and
 * by `(courseId, sourceUrl, extractionDate)` for revisions.
 *
 * Bottom-of-file CLI guard runs runSeed + optional promoteOrganizer
 * ONLY when the module is invoked directly (not when imported by tests).
 *
 * Path resolution tolerates two runtime layouts:
 *   - Dev (`tsx src/db/seed.ts`): walks up 4 dirs from src/db/ to repo-root
 *     `reference/pinehurst-may-2026-courses.json`.
 *   - Prod (`node dist/db/seed.js`): walks up 1 dir from dist/db/ to
 *     `dist/reference/pinehurst-may-2026-courses.json` (placed there by
 *     the Dockerfile COPY per AC #17).
 */

const TENANT_ID = 'guyan';
const LIBRARY_CONTEXT_ID = 'library:guyan';

// ---------------------------------------------------------------------
// Zod schema — matches the observed shape of
// reference/pinehurst-may-2026-courses.json exactly.
// ---------------------------------------------------------------------

const SeedTeeSchema = z.object({
  name: z.string().min(1),
  rating: z.number().positive(), // FLOAT in source (e.g., 74.7)
  slope: z.number().int().positive(),
  yardage: z.number().int().nonnegative().optional(), // ignored at insert
  gender: z.string().optional(), // v1 skip
  ladies_rating: z.number().positive().optional(), // v1 skip
  ladies_slope: z.number().int().positive().optional(), // v1 skip
});

const SeedHoleSchema = z.object({
  hole: z.number().int().min(1).max(18),
  par: z.number().int().min(3).max(5),
  si: z.number().int().min(1).max(18),
  yardages: z.record(z.string(), z.number().int().nonnegative()),
  _note: z.string().optional(), // diagnostic; not persisted
});

const SeedCourseSchema = z.object({
  name: z.string().min(1),
  location: z.string().min(1),
  designer: z.string().optional(),
  par: z.number().int().positive(), // claimed par (may differ from hole-sum)
  source: z.string().url(),
  tees: z.array(SeedTeeSchema).min(1),
  holes: z.array(SeedHoleSchema).length(18),
  verified: z.boolean().optional(), // default true if absent
  tentative: z.boolean().optional(), // diagnostic; not persisted
  trip_role: z.string().optional(), // diagnostic; not persisted
  data_quality_note: z.string().optional(), // diagnostic; not persisted
});

export const SeedDataSchema = z.object({
  _meta: z.object({
    trip: z.string().min(1),
    extracted: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
    source_note: z.string().optional(),
    validation: z.string().optional(),
  }),
  courses: z.array(SeedCourseSchema).min(1),
});

export type SeedData = z.infer<typeof SeedDataSchema>;
type SeedCourse = z.infer<typeof SeedCourseSchema>;

// ---------------------------------------------------------------------
// Report types for structured CLI output + test assertions.
// ---------------------------------------------------------------------

export type SeedReport = {
  coursesInserted: number;
  coursesSkipped: number;
  revisionsInserted: number;
  revisionsSkipped: number;
  teesInserted: number;
  holesInserted: number;
};

export type OrganizerResult = {
  action: 'promoted' | 'preseeded' | 'already_set';
  playerId: string;
};

// ---------------------------------------------------------------------
// Invariant checks — run BEFORE any DB insert to catch bad seed JSON.
// Mirrors the invariants T2-4's app-level validator will enforce for
// admin-UI submissions.
// ---------------------------------------------------------------------

function assertInvariants(course: SeedCourse): void {
  const holePars = course.holes.map((h) => h.par);
  const outSum = holePars.slice(0, 9).reduce((a, b) => a + b, 0);
  const inSum = holePars.slice(9).reduce((a, b) => a + b, 0);
  const courseSum = outSum + inSum;

  if (outSum + inSum !== courseSum) {
    // Unreachable (algebraic identity), but keeps the shape obvious.
    throw new Error(`${course.name}: out + in (${outSum} + ${inSum}) != courseSum (${courseSum})`);
  }

  // SI must cover 1..18 without duplicates.
  const sis = course.holes.map((h) => h.si).sort((a, b) => a - b);
  for (let i = 0; i < 18; i++) {
    if (sis[i] !== i + 1) {
      throw new Error(
        `${course.name}: stroke indexes must cover 1..18 without duplicates (got ${JSON.stringify(sis)})`,
      );
    }
  }

  // Hole numbers must also cover 1..18 without duplicates. Zod enforces
  // each element is in 1..18 but not uniqueness nor completeness —
  // codex impl round-1 MED fix.
  const holeNumbers = course.holes.map((h) => h.hole).sort((a, b) => a - b);
  for (let i = 0; i < 18; i++) {
    if (holeNumbers[i] !== i + 1) {
      throw new Error(
        `${course.name}: hole numbers must cover 1..18 without duplicates (got ${JSON.stringify(holeNumbers)})`,
      );
    }
  }

  // Per tee: every hole has a yardage for that tee's name.
  for (const tee of course.tees) {
    for (const hole of course.holes) {
      const y = hole.yardages[tee.name];
      if (typeof y !== 'number') {
        throw new Error(
          `${course.name}: tee "${tee.name}" missing yardage on hole ${hole.hole}`,
        );
      }
    }
  }

  // Par-sum vs claimed par: log a warning when they diverge (Pinehurst
  // No. 2 case). Don't throw — courseTotal is stored from hole-sum, not
  // from the claimed par, so the divergence is honest.
  if (courseSum !== course.par) {
    logger.warn({
      event: 'seed_course_par_sum_divergence',
      course: course.name,
      claimedPar: course.par,
      actualHolePars: courseSum,
      action: 'storing_computed_value',
    });
  }
}

// ---------------------------------------------------------------------
// Main seed orchestration.
// ---------------------------------------------------------------------

export async function runSeed(data: SeedData): Promise<SeedReport> {
  // Parse the extraction date once; applies to every course's revision.
  const extractionDate = Date.parse(data._meta.extracted + 'T00:00:00.000Z');
  if (!Number.isFinite(extractionDate)) {
    throw new Error(`Invalid _meta.extracted: ${data._meta.extracted}`);
  }

  const report: SeedReport = {
    coursesInserted: 0,
    coursesSkipped: 0,
    revisionsInserted: 0,
    revisionsSkipped: 0,
    teesInserted: 0,
    holesInserted: 0,
  };

  for (const course of data.courses) {
    // Pre-validate before opening a transaction — fail-fast on bad JSON.
    assertInvariants(course);

    // Accumulate per-course deltas LOCALLY inside the transaction.
    // Merge into `report` only on successful commit — codex impl
    // round-1 MED fix (prevents misleading counts if a later insert
    // throws and rolls back the transaction).
    const delta = {
      coursesInserted: 0,
      coursesSkipped: 0,
      revisionsInserted: 0,
      revisionsSkipped: 0,
      teesInserted: 0,
      holesInserted: 0,
    };

    await db.transaction(async (tx) => {
      // 1. Read-first upsert on courses. clubName is the same as name
      // (simplified derivation per spec AC #4).
      const existingCourse = await tx
        .select({ id: courses.id })
        .from(courses)
        .where(
          and(
            eq(courses.tenantId, TENANT_ID),
            eq(courses.clubName, course.name),
            eq(courses.name, course.name),
          ),
        );

      let courseId: string;
      if (existingCourse[0]) {
        courseId = existingCourse[0].id;
        delta.coursesSkipped += 1;
      } else {
        courseId = randomUUID();
        await tx.insert(courses).values({
          id: courseId,
          name: course.name,
          clubName: course.name,
          createdAt: Date.now(),
          tenantId: TENANT_ID,
          contextId: LIBRARY_CONTEXT_ID,
        });
        delta.coursesInserted += 1;
      }

      // 2. Read-first on revisions. Match by (courseId, tenantId,
      // sourceUrl, extractionDate). The Zod schema requires `source` as
      // a non-null URL, so the match is straightforward equality — no
      // isNull handling needed for T2-2's data.
      const existingRevision = await tx
        .select({ id: courseRevisions.id })
        .from(courseRevisions)
        .where(
          and(
            eq(courseRevisions.courseId, courseId),
            eq(courseRevisions.tenantId, TENANT_ID),
            eq(courseRevisions.sourceUrl, course.source),
            eq(courseRevisions.extractionDate, extractionDate),
          ),
        );

      if (existingRevision[0]) {
        delta.revisionsSkipped += 1;
        return; // Skip tees/holes — existing revision already has them.
      }

      // 3. Compute totals from hole pars (honest over claimed `par`).
      // Sort-by-hole-number defensively — the invariant check above
      // asserts 1..18 uniqueness, but the JSON array is not guaranteed
      // to arrive in ascending order. Without this sort, slice(0,9) +
      // slice(9) would pair the wrong pars into out/in totals.
      const sortedHoles = [...course.holes].sort((a, b) => a.hole - b.hole);
      const holePars = sortedHoles.map((h) => h.par);
      const outTotal = holePars.slice(0, 9).reduce((a, b) => a + b, 0);
      const inTotal = holePars.slice(9).reduce((a, b) => a + b, 0);
      const courseTotal = outTotal + inTotal;

      // Next revision number: max(existing)+1, or 1 on first. Tenant-
      // scoped for consistency with the existingRevision lookup above.
      const existing = await tx
        .select({ revisionNumber: courseRevisions.revisionNumber })
        .from(courseRevisions)
        .where(
          and(
            eq(courseRevisions.courseId, courseId),
            eq(courseRevisions.tenantId, TENANT_ID),
          ),
        )
        .orderBy(desc(courseRevisions.revisionNumber))
        .limit(1);
      const nextRevisionNumber = (existing[0]?.revisionNumber ?? 0) + 1;

      const verified = course.verified ?? true;
      const revisionId = randomUUID();

      await tx.insert(courseRevisions).values({
        id: revisionId,
        courseId,
        revisionNumber: nextRevisionNumber,
        sourceUrl: course.source,
        extractionDate,
        verified,
        outTotal,
        inTotal,
        courseTotal,
        createdAt: Date.now(),
        tenantId: TENANT_ID,
        contextId: LIBRARY_CONTEXT_ID,
      });
      delta.revisionsInserted += 1;

      // 4. Insert tees. Skip ladies-specific fields (gender/ladies_*)
      // per v1 risk-acceptance §3a. Use Math.round to avoid FP drift.
      for (const tee of course.tees) {
        await tx.insert(courseTees).values({
          id: randomUUID(),
          courseRevisionId: revisionId,
          teeColor: tee.name,
          rating: Math.round(tee.rating * 10),
          slope: tee.slope,
          tenantId: TENANT_ID,
          contextId: LIBRARY_CONTEXT_ID,
        });
        delta.teesInserted += 1;
      }

      // 5. Insert 18 holes (using the sorted array so logs/inserts
      // proceed in 1..18 order — easier to debug on failure).
      for (const hole of sortedHoles) {
        await tx.insert(courseHoles).values({
          id: randomUUID(),
          courseRevisionId: revisionId,
          holeNumber: hole.hole,
          par: hole.par,
          si: hole.si,
          yardagePerTeeJson: JSON.stringify(hole.yardages),
          tenantId: TENANT_ID,
          contextId: LIBRARY_CONTEXT_ID,
        });
        delta.holesInserted += 1;
      }
    });

    // Transaction committed successfully — merge the per-course deltas
    // into the rolling report. On throw/rollback, deltas are discarded.
    report.coursesInserted += delta.coursesInserted;
    report.coursesSkipped += delta.coursesSkipped;
    report.revisionsInserted += delta.revisionsInserted;
    report.revisionsSkipped += delta.revisionsSkipped;
    report.teesInserted += delta.teesInserted;
    report.holesInserted += delta.holesInserted;
  }

  return report;
}

// ---------------------------------------------------------------------
// Organizer pre-seed / promote.
// ---------------------------------------------------------------------

const ORGANIZER_SUB_RE = /^\d{1,64}$/;

export async function promoteOrganizer(sub: string): Promise<OrganizerResult> {
  // Shape validation — caller is responsible for pre-checking, but the
  // redundant check here prevents any future code path from bypassing.
  if (!ORGANIZER_SUB_RE.test(sub)) {
    // Redact the raw value in any log; length alone is diagnostic.
    logger.error({
      event: 'seed_organizer_invalid_sub',
      subLength: sub.length,
      rawValue: '<redacted>',
    });
    throw new Error('ORGANIZER_GOOGLE_SUB invalid shape');
  }

  // 1. Look up existing oauth_identities row.
  const existing = await db
    .select({
      playerId: oauthIdentities.playerId,
    })
    .from(oauthIdentities)
    .where(
      and(
        eq(oauthIdentities.tenantId, TENANT_ID),
        eq(oauthIdentities.provider, 'google'),
        eq(oauthIdentities.providerSub, sub),
      ),
    );

  if (existing[0]) {
    const playerId = existing[0].playerId;
    // Check current is_organizer state to detect no-op. Tenant-scoped
    // for defense-in-depth against the cross-tenant mismatch gap
    // documented in T2-1 (codex impl round-1 LOW + round-2 MED fix).
    const playerRow = await db
      .select({ isOrganizer: players.isOrganizer })
      .from(players)
      .where(and(eq(players.id, playerId), eq(players.tenantId, TENANT_ID)));
    if (!playerRow[0]) {
      // oauth_identities row exists but the referenced player either
      // doesn't exist or lives in a different tenant — the cross-tenant
      // mismatch gap fired. Fail loudly rather than silently returning
      // 'promoted' after a zero-row UPDATE.
      logger.error({
        event: 'seed_organizer_player_not_found',
        playerId,
        sub,
        tenantId: TENANT_ID,
      });
      throw new Error(
        `promoteOrganizer: oauth_identities row references playerId=${playerId} but no matching player in tenant=${TENANT_ID}`,
      );
    }
    if (playerRow[0].isOrganizer === true) {
      logger.info({
        event: 'seed_organizer_already_set',
        playerId,
        sub,
      });
      return { action: 'already_set', playerId };
    }
    await db
      .update(players)
      .set({ isOrganizer: true })
      .where(and(eq(players.id, playerId), eq(players.tenantId, TENANT_ID)));
    logger.warn({
      event: 'seed_organizer_promoted',
      playerId,
      sub,
    });
    return { action: 'promoted', playerId };
  }

  // 2. Pre-seed path: create players row + oauth_identities row.
  const playerId = randomUUID();
  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx.insert(players).values({
      id: playerId,
      isOrganizer: true,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: LIBRARY_CONTEXT_ID,
    });
    await tx.insert(oauthIdentities).values({
      id: randomUUID(),
      provider: 'google',
      providerSub: sub,
      playerId,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: LIBRARY_CONTEXT_ID,
    });
  });
  logger.warn({
    event: 'seed_organizer_preseeded',
    playerId,
    sub,
  });
  return { action: 'preseeded', playerId };
}

// ---------------------------------------------------------------------
// Path resolution (dev vs prod) + JSON loader.
// ---------------------------------------------------------------------

function resolveSeedDataPath(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // Dev (tsx): from apps/tournament-api/src/db/ walk up 4 to repo root.
  const devPath = resolve(
    __dirname,
    '../../../../reference/pinehurst-may-2026-courses.json',
  );
  // Prod (node dist): from apps/tournament-api/dist/db/ walk up 1 to dist/.
  const prodPath = resolve(__dirname, '../reference/pinehurst-may-2026-courses.json');

  if (existsSync(devPath)) return devPath;
  if (existsSync(prodPath)) return prodPath;
  throw new Error(
    `Seed data not found. Tried:\n  dev:  ${devPath}\n  prod: ${prodPath}`,
  );
}

export function loadSeedData(path = resolveSeedDataPath()): SeedData {
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  const result = SeedDataSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    logger.error({
      event: 'seed_schema_invalid',
      path,
      zodPath: first?.path.join('.') ?? null,
      message: first?.message ?? 'unknown',
    });
    throw new Error(
      `Seed JSON schema validation failed at ${path}: ${first?.message ?? 'unknown error'}`,
    );
  }
  return result.data;
}

// ---------------------------------------------------------------------
// CLI entrypoint — runs ONLY when invoked directly (not on test imports).
// ---------------------------------------------------------------------

const isCli =
  process.argv[1] !== undefined &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isCli) {
  const data = loadSeedData();
  const report = await runSeed(data);
  logger.info({ event: 'seed_report', ...report });

  const organizerSub = process.env['ORGANIZER_GOOGLE_SUB'];
  if (organizerSub === undefined || organizerSub === '') {
    logger.info({ event: 'seed_organizer_skipped', reason: 'env_unset' });
  } else if (!ORGANIZER_SUB_RE.test(organizerSub)) {
    logger.error({
      event: 'seed_organizer_invalid_sub',
      subLength: organizerSub.length,
      rawValue: '<redacted>',
    });
    process.exit(1);
  } else {
    const result = await promoteOrganizer(organizerSub);
    logger.info({ event: 'seed_organizer_done', ...result });
  }

  process.exit(0);
}
