import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

vi.mock('../db/index.js', async () => {
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

const { db } = await import('../db/index.js');
const { courses, courseRevisions, courseTees, courseHoles } = await import(
  '../db/schema/index.js'
);
const { coursesRouter } = await import('./courses.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');
const { runSeed, loadSeedData } = await import('../db/seed.js');

// Wrap the router under the full production middleware chain so the
// route gets its requestId + logger context (same pattern as auth.test).
const testApp = new Hono();
testApp.use('*', requestIdMiddleware);
testApp.route('/', coursesRouter);

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(courseHoles);
  await db.delete(courseTees);
  await db.delete(courseRevisions);
  await db.delete(courses);
});

type CoursesResponse = {
  courses: Array<{
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
  }>;
};

describe('GET /api/courses (T2-2)', () => {
  test('empty DB → 200 with { courses: [] }', async () => {
    const res = await testApp.request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as CoursesResponse;
    expect(body.courses).toEqual([]);
  });

  test('after seeding 5 real courses → 5 entries ordered by name ASC', async () => {
    const data = loadSeedData();
    await runSeed(data);

    const res = await testApp.request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as CoursesResponse;
    expect(body.courses).toHaveLength(5);

    const names = body.courses.map((c) => c.name);
    const sortedNames = [...names].sort();
    expect(names).toEqual(sortedNames);
    // Actual order from the real data:
    expect(names).toEqual([
      'Mid Pines Inn & Golf Club',
      'Pine Needles Lodge & Golf Club',
      'Pinehurst No. 2',
      'Talamore Golf Resort',
      'Tobacco Road Golf Club',
    ]);
  });

  test('latestRevision shape is camelCase; rating is integer × 10', async () => {
    const data = loadSeedData();
    await runSeed(data);

    const res = await testApp.request('/');
    const body = (await res.json()) as CoursesResponse;

    const midPines = body.courses.find((c) => c.name === 'Mid Pines Inn & Golf Club');
    expect(midPines).toBeDefined();
    expect(midPines!.clubName).toBe('Mid Pines Inn & Golf Club');
    expect(midPines!.latestRevision).not.toBeNull();
    expect(midPines!.latestRevision!.revisionNumber).toBe(1);
    expect(midPines!.latestRevision!.verified).toBe(true);
    expect(midPines!.latestRevision!.courseTotal).toBe(72);
    expect(midPines!.latestRevision!.extractionDate).toBe(1776038400000);
    // Mid Pines source data: Medal tee has rating 73.5 → integer 735.
    const medal = midPines!.latestRevision!.tees.find((t) => t.color === 'Medal');
    expect(medal?.rating).toBe(735);
    expect(medal?.slope).toBe(142);

    // Pinehurst No. 2 honors the honest par-sum divergence.
    const pin2 = body.courses.find((c) => c.name === 'Pinehurst No. 2');
    expect(pin2?.latestRevision?.verified).toBe(false);
    expect(pin2?.latestRevision?.courseTotal).toBe(73);
  });

  test('tees array ordered by teeColor ASC', async () => {
    const data = loadSeedData();
    await runSeed(data);

    const res = await testApp.request('/');
    const body = (await res.json()) as CoursesResponse;
    for (const course of body.courses) {
      const tees = course.latestRevision?.tees ?? [];
      const teeColors = tees.map((t) => t.color);
      const sorted = [...teeColors].sort();
      expect(teeColors).toEqual(sorted);
    }
  });

  test('multi-revision course: latestRevision is the highest revisionNumber', async () => {
    // Seed real data → Pine Needles gets revision 1.
    const data = loadSeedData();
    await runSeed(data);

    // Re-run with a different extraction date to create revision 2 per course.
    const bumped: Parameters<typeof runSeed>[0] = {
      ...data,
      _meta: { ...data._meta, extracted: '2026-05-01' },
    };
    await runSeed(bumped);

    const res = await testApp.request('/');
    const body = (await res.json()) as CoursesResponse;

    for (const course of body.courses) {
      expect(course.latestRevision?.revisionNumber).toBe(2);
      expect(course.latestRevision?.extractionDate).toBe(
        Date.parse('2026-05-01T00:00:00.000Z'),
      );
    }
  });
});
