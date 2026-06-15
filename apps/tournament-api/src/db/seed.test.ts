import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, './migrations');

vi.mock('./index.js', async () => {
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

const { db } = await import('./index.js');
const { courses, courseRevisions, courseTees, courseHoles, oauthIdentities, players } =
  await import('./schema/index.js');
const { runSeed, promoteOrganizer, loadSeedData, SeedDataSchema } = await import('./seed.js');

// Minimal valid fixture — 1 course, 1 tee, 18 holes with pars summing to 72.
function makeFixture(opts: { extracted?: string; source?: string; verified?: boolean } = {}): unknown {
  const holes = [] as Array<{ hole: number; par: number; si: number; yardages: Record<string, number> }>;
  // Pars: 9 × 4 = 36 front, 9 × 4 = 36 back — simple par-72 layout.
  for (let i = 1; i <= 18; i++) {
    holes.push({
      hole: i,
      par: 4,
      si: i,
      yardages: { Blue: 400 + i, White: 370 + i },
    });
  }
  return {
    _meta: {
      trip: 'Test trip',
      extracted: opts.extracted ?? '2026-04-13',
    },
    courses: [
      {
        name: 'Test Course',
        location: 'Testville, NC',
        par: 72,
        source: opts.source ?? 'https://example.com/scorecard.pdf',
        verified: opts.verified,
        tees: [
          { name: 'Blue', rating: 72.0, slope: 130 },
          { name: 'White', rating: 70.5, slope: 125 },
        ],
        holes,
      },
    ],
  };
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(courseHoles);
  await db.delete(courseTees);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(oauthIdentities);
  await db.delete(players);
});

// ---------------------------------------------------------------------
// runSeed
// ---------------------------------------------------------------------

describe('runSeed (T2-2)', () => {
  test('fresh DB: inserts 1 course + 1 revision + 2 tees + 18 holes, report matches', async () => {
    const fixture = makeFixture();
    const data = fixture as Parameters<typeof runSeed>[0];
    const report = await runSeed(data);

    expect(report.coursesInserted).toBe(1);
    expect(report.coursesSkipped).toBe(0);
    expect(report.revisionsInserted).toBe(1);
    expect(report.revisionsSkipped).toBe(0);
    expect(report.teesInserted).toBe(2);
    expect(report.holesInserted).toBe(18);

    expect((await db.select().from(courses)).length).toBe(1);
    expect((await db.select().from(courseRevisions)).length).toBe(1);
    expect((await db.select().from(courseTees)).length).toBe(2);
    expect((await db.select().from(courseHoles)).length).toBe(18);
  });

  test('re-run on same JSON: report shows 1 course + 1 revision skipped; counts unchanged', async () => {
    const fixture = makeFixture() as Parameters<typeof runSeed>[0];
    await runSeed(fixture);
    const beforeCourseCount = (await db.select().from(courses)).length;
    const beforeRevCount = (await db.select().from(courseRevisions)).length;
    const beforeTeeCount = (await db.select().from(courseTees)).length;
    const beforeHoleCount = (await db.select().from(courseHoles)).length;

    const report2 = await runSeed(fixture);
    expect(report2.coursesInserted).toBe(0);
    expect(report2.coursesSkipped).toBe(1);
    expect(report2.revisionsInserted).toBe(0);
    expect(report2.revisionsSkipped).toBe(1);
    expect(report2.teesInserted).toBe(0);
    expect(report2.holesInserted).toBe(0);

    // Counts unchanged.
    expect((await db.select().from(courses)).length).toBe(beforeCourseCount);
    expect((await db.select().from(courseRevisions)).length).toBe(beforeRevCount);
    expect((await db.select().from(courseTees)).length).toBe(beforeTeeCount);
    expect((await db.select().from(courseHoles)).length).toBe(beforeHoleCount);
  });

  test('new revision on re-import: different extractionDate → +1 revision, old revision kept', async () => {
    const first = makeFixture({ extracted: '2026-04-13' }) as Parameters<typeof runSeed>[0];
    await runSeed(first);
    const second = makeFixture({ extracted: '2026-04-20' }) as Parameters<typeof runSeed>[0];
    const report2 = await runSeed(second);

    expect(report2.coursesInserted).toBe(0);
    expect(report2.coursesSkipped).toBe(1);
    expect(report2.revisionsInserted).toBe(1);

    const allRevs = await db.select().from(courseRevisions);
    expect(allRevs).toHaveLength(2);
    const revNumbers = allRevs.map((r) => r.revisionNumber).sort();
    expect(revNumbers).toEqual([1, 2]);
  });

  test('Zod schema rejects invalid shape (17 holes, not 18)', () => {
    const bad = makeFixture() as { courses: Array<{ holes: unknown[] }> };
    bad.courses[0]!.holes = bad.courses[0]!.holes.slice(0, 17); // chop to 17
    const result = SeedDataSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  test('invariant check rejects duplicate SI values', async () => {
    const fixture = makeFixture() as Parameters<typeof runSeed>[0];
    // Force two holes to share SI=5.
    fixture.courses[0]!.holes[0]!.si = 5;
    fixture.courses[0]!.holes[4]!.si = 5;
    await expect(runSeed(fixture)).rejects.toThrow(/stroke indexes/);
  });

  test('invariant check rejects duplicate hole numbers (codex impl round-1 MED)', async () => {
    const fixture = makeFixture() as Parameters<typeof runSeed>[0];
    // Force two holes to share hole number 1.
    fixture.courses[0]!.holes[0]!.hole = 1;
    fixture.courses[0]!.holes[4]!.hole = 1;
    await expect(runSeed(fixture)).rejects.toThrow(/hole numbers/);
  });

  test('defensive sort: shuffled holes still produce correct totals', async () => {
    const fixture = makeFixture() as Parameters<typeof runSeed>[0];
    // Shuffle the holes array — hole numbers are correct (1..18) but
    // the array order isn't. The seed must sort by hole number before
    // computing out/in totals.
    const original = [...fixture.courses[0]!.holes];
    fixture.courses[0]!.holes = [
      original[17]!, original[0]!, original[9]!, original[5]!, original[12]!,
      original[1]!, original[6]!, original[13]!, original[2]!, original[16]!,
      original[10]!, original[3]!, original[14]!, original[7]!, original[4]!,
      original[11]!, original[8]!, original[15]!,
    ];
    await runSeed(fixture);
    const revs = await db.select().from(courseRevisions);
    expect(revs).toHaveLength(1);
    // All holes par 4 → out 36, in 36, total 72 regardless of input order.
    expect(revs[0]!.outTotal).toBe(36);
    expect(revs[0]!.inTotal).toBe(36);
    expect(revs[0]!.courseTotal).toBe(72);
  });

  test('honest par-sum divergence: claimed 72 but holes sum 73 → courseTotal stored as 73', async () => {
    const fixture = makeFixture() as Parameters<typeof runSeed>[0];
    // Bump one par from 4 to 5 so sum becomes 73, but keep claimed par at 72.
    fixture.courses[0]!.holes[0]!.par = 5;
    // Recompute SI-1..18 is still valid.

    await runSeed(fixture);
    const revs = await db.select().from(courseRevisions);
    expect(revs).toHaveLength(1);
    expect(revs[0]!.courseTotal).toBe(73);
    // Out-total computed from holes 1-9 (par 5 + 8 × par 4 = 37).
    expect(revs[0]!.outTotal).toBe(37);
    expect(revs[0]!.inTotal).toBe(36);
  });
});

// ---------------------------------------------------------------------
// promoteOrganizer
// ---------------------------------------------------------------------

describe('promoteOrganizer (T2-2)', () => {
  const VALID_SUB = '123456789012345678901'; // 21 digits

  test('no existing oauth_identities row: pre-seeds player + oauth row, is_organizer=true', async () => {
    const result = await promoteOrganizer(VALID_SUB);
    expect(result.action).toBe('preseeded');

    const playerRow = await db
      .select({ id: players.id, isOrganizer: players.isOrganizer })
      .from(players)
      .where(eq(players.id, result.playerId));
    expect(playerRow[0]?.isOrganizer).toBe(true);

    const oauthRow = await db
      .select({ playerId: oauthIdentities.playerId })
      .from(oauthIdentities)
      .where(eq(oauthIdentities.providerSub, VALID_SUB));
    expect(oauthRow[0]?.playerId).toBe(result.playerId);
  });

  test('existing oauth_identities with is_organizer=false → promotes to true', async () => {
    const playerId = 'existing-player-1';
    const now = Date.now();
    await db.insert(players).values({
      id: playerId,
      isOrganizer: false,
      createdAt: now,
      contextId: 'library:guyan',
    });
    await db.insert(oauthIdentities).values({
      id: 'oauth-1',
      provider: 'google',
      providerSub: VALID_SUB,
      playerId,
      createdAt: now,
      contextId: 'library:guyan',
    });

    const result = await promoteOrganizer(VALID_SUB);
    expect(result.action).toBe('promoted');
    expect(result.playerId).toBe(playerId);

    const playerRow = await db
      .select({ isOrganizer: players.isOrganizer })
      .from(players)
      .where(eq(players.id, playerId));
    expect(playerRow[0]?.isOrganizer).toBe(true);
  });

  test('already is_organizer=true → no-op (action: already_set)', async () => {
    const playerId = 'existing-player-2';
    const now = Date.now();
    await db.insert(players).values({
      id: playerId,
      isOrganizer: true,
      createdAt: now,
      contextId: 'library:guyan',
    });
    await db.insert(oauthIdentities).values({
      id: 'oauth-2',
      provider: 'google',
      providerSub: VALID_SUB,
      playerId,
      createdAt: now,
      contextId: 'library:guyan',
    });

    const result = await promoteOrganizer(VALID_SUB);
    expect(result.action).toBe('already_set');
    expect(result.playerId).toBe(playerId);
  });

  test('idempotency: running twice on an empty DB → second call is already_set', async () => {
    const first = await promoteOrganizer(VALID_SUB);
    expect(first.action).toBe('preseeded');
    const second = await promoteOrganizer(VALID_SUB);
    expect(second.action).toBe('already_set');
    // Still only one player + one oauth row.
    expect((await db.select().from(players)).length).toBe(1);
    expect((await db.select().from(oauthIdentities)).length).toBe(1);
  });

  test('orphaned oauth_identities row (cross-tenant mismatch): throws rather than silently no-op (codex impl round-2 MED)', async () => {
    // Simulate the cross-tenant mismatch gap: oauth_identities has a
    // row with tenantId='guyan' pointing at a player whose tenantId is
    // 'other-tenant' (or doesn't exist). The tenant-scoped player
    // lookup returns nothing; promoteOrganizer must throw rather than
    // fire a zero-row UPDATE and claim 'promoted'.
    const orphanPlayerId = 'orphan-player-1';
    const now = Date.now();
    await db.insert(players).values({
      id: orphanPlayerId,
      isOrganizer: false,
      createdAt: now,
      tenantId: 'other-tenant', // NOT 'guyan'
      contextId: 'library:other-tenant',
    });
    await db.insert(oauthIdentities).values({
      id: 'oauth-orphan',
      provider: 'google',
      providerSub: VALID_SUB,
      playerId: orphanPlayerId,
      createdAt: now,
      tenantId: 'guyan',
      contextId: 'library:guyan',
    });

    await expect(promoteOrganizer(VALID_SUB)).rejects.toThrow(
      /no matching player in tenant/,
    );
  });

  test('invalid sub shape throws (redacted log, no DB writes)', async () => {
    const badSubs = ['abc', 'abc123', 'josh@gmail.com', '', '1'.repeat(65)];
    for (const bad of badSubs) {
      await expect(promoteOrganizer(bad)).rejects.toThrow(/invalid shape/);
    }
    // No rows created.
    expect((await db.select().from(players)).length).toBe(0);
    expect((await db.select().from(oauthIdentities)).length).toBe(0);
  });
});

// ---------------------------------------------------------------------
// loadSeedData (real reference file)
// ---------------------------------------------------------------------

describe('loadSeedData (T2-2 — real reference file)', () => {
  test('loads reference/pinehurst-may-2026-courses.json successfully with all 5 courses', () => {
    const data = loadSeedData();
    expect(data._meta.trip).toBe('Pinehurst May 2026');
    expect(data._meta.extracted).toBe('2026-04-13');
    expect(data.courses).toHaveLength(5);
    const names = data.courses.map((c) => c.name).sort();
    expect(names).toEqual([
      'Mid Pines Inn & Golf Club',
      'Pine Needles Lodge & Golf Club',
      'Pinehurst No. 2',
      'Talamore Golf Resort',
      'Tobacco Road Golf Club',
    ]);
  });

  test('running runSeed against the real file produces expected totals: 5 courses / 5 revisions / 20 tees / 90 holes', async () => {
    const data = loadSeedData();
    const report = await runSeed(data);
    expect(report.coursesInserted).toBe(5);
    expect(report.revisionsInserted).toBe(5);
    expect(report.teesInserted).toBe(20);
    expect(report.holesInserted).toBe(90);

    // Pinehurst No. 2 should have courseTotal === 73 (honest hole-par sum),
    // not 72 (claimed par).
    const pin2 = await db
      .select({
        courseId: courses.id,
        revId: courseRevisions.id,
        courseTotal: courseRevisions.courseTotal,
        verified: courseRevisions.verified,
      })
      .from(courses)
      .innerJoin(courseRevisions, eq(courseRevisions.courseId, courses.id))
      .where(eq(courses.name, 'Pinehurst No. 2'));
    expect(pin2).toHaveLength(1);
    expect(pin2[0]!.courseTotal).toBe(73);
    expect(pin2[0]!.verified).toBe(false);

    // A verified=true course: Mid Pines (par 72, hole-par-sum 72 matches).
    const midPines = await db
      .select({ verified: courseRevisions.verified, courseTotal: courseRevisions.courseTotal })
      .from(courses)
      .innerJoin(courseRevisions, eq(courseRevisions.courseId, courses.id))
      .where(eq(courses.name, 'Mid Pines Inn & Golf Club'));
    expect(midPines[0]?.verified).toBe(true);
    expect(midPines[0]?.courseTotal).toBe(72);
  });

  test('loads reference/pete-dye-golf-club.json: 1 course / 6 tees / 18 holes, ratings stored ×10', async () => {
    const peteDyePath = resolve(__dirname, '../../../../reference/pete-dye-golf-club.json');
    const data = loadSeedData(peteDyePath); // throws if schema-invalid
    expect(data.courses).toHaveLength(1);
    expect(data.courses[0]!.name).toBe('Pete Dye Golf Club');
    expect(data.courses[0]!.tees.map((t) => t.name)).toEqual([
      'Championship',
      'Back',
      'Dye',
      'Middle',
      'Forward',
      'Dye/Middle',
    ]);

    const report = await runSeed(data);
    expect(report.coursesInserted).toBe(1);
    expect(report.teesInserted).toBe(6);
    expect(report.holesInserted).toBe(18);

    // courseTotal = honest hole-par sum = 72 (matches claimed par → verified).
    const row = await db
      .select({ courseTotal: courseRevisions.courseTotal, verified: courseRevisions.verified })
      .from(courses)
      .innerJoin(courseRevisions, eq(courseRevisions.courseId, courses.id))
      .where(eq(courses.name, 'Pete Dye Golf Club'));
    expect(row[0]!.courseTotal).toBe(72);
    expect(row[0]!.verified).toBe(true);

    // Championship rating is stored as USGA rating × 10 (75.5 → 755).
    const champ = await db
      .select({ rating: courseTees.rating, slope: courseTees.slope })
      .from(courseTees)
      .innerJoin(courseRevisions, eq(courseRevisions.id, courseTees.courseRevisionId))
      .innerJoin(courses, eq(courses.id, courseRevisions.courseId))
      .where(and(eq(courses.name, 'Pete Dye Golf Club'), eq(courseTees.teeColor, 'Championship')));
    expect(champ[0]!.rating).toBe(755);
    expect(champ[0]!.slope).toBe(141);
  });
});

