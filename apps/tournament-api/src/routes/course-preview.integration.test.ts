/**
 * T7-3 GET /api/events/:eventId/courses/:courseId integration tests.
 *
 * Covers AC-1..AC-7 (api):
 *  (a) 200 happy path — 18 holes, 3 tees, defaultTeeColor matches.
 *  (b) 200 multi-revision pinning — round 1 uses R2, round 2 uses R1; response is R2.
 *  (c) 200 tees ordered by lowercase(teeColor).
 *  (d) 200 defaultTeeColor null when round's tee_color doesn't match any tees row.
 *  (e) 403 course not in event (uniform shape).
 *  (f) 403 unknown courseId (uniform shape).
 *  (g) 403 non-participant.
 *  (h) 403 malformed eventId.
 */
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

vi.mock('../db/index.js', async () => {
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

let __testPlayer: { id: string; isOrganizer: boolean } | null = null;
vi.mock('../middleware/require-session.js', () => ({
  requireSession: async (
    c: import('hono').Context,
    next: () => Promise<void>,
  ) => {
    if (!__testPlayer) {
      return c.json({ error: 'unauthorized', code: 'no_test_player' }, 401);
    }
    c.set('player', __testPlayer);
    c.set('session', { sessionId: 'test', playerId: __testPlayer.id });
    await next();
  },
}));

const { db } = await import('../db/index.js');
const {
  players,
  courses,
  courseRevisions,
  courseTees,
  courseHoles,
  events,
  eventRounds,
  groups,
  groupMembers,
} = await import('../db/schema/index.js');
const { coursePreviewRouter } = await import('./course-preview.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT_ID = 'guyan';
const CTX_BASE = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(eventRounds);
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(events);
  await db.delete(courseHoles);
  await db.delete(courseTees);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

interface SeedOpts {
  /** Add a second course not used by any event round (tests "course not in event"). */
  withOrphanCourse?: boolean;
  /** Insert two revisions for the primary course; round 1 uses R2, round 2 uses R1. Tests pinning. */
  multiRevisionPinning?: boolean;
  /** Set round 1's tee_color to a value not in courseTees (tests defaultTeeColor null). */
  unknownDefaultTee?: boolean;
  /** Use mixed-case tee colors for ordering test. */
  mixedCaseTees?: boolean;
}

interface SeedResult {
  organizerId: string;
  participantId: string;
  outsiderId: string;
  eventId: string;
  primaryCourseId: string;
  orphanCourseId: string;       // present iff opts.withOrphanCourse
}

async function seed(opts: SeedOpts = {}): Promise<SeedResult> {
  const now = Date.now();
  const ids = {
    organizerId: randomUUID(),
    participantId: randomUUID(),
    outsiderId: randomUUID(),
    eventId: randomUUID(),
    primaryCourseId: randomUUID(),
    orphanCourseId: randomUUID(),
    rev1Id: randomUUID(),
    rev2Id: randomUUID(),
    orphanRevId: randomUUID(),
    er1Id: randomUUID(),
    er2Id: randomUUID(),
    groupId: randomUUID(),
  };
  const ctx = `event:${ids.eventId}`;

  for (const [id, name] of [
    [ids.organizerId, 'Organizer'],
    [ids.participantId, 'Participant'],
    [ids.outsiderId, 'Outsider'],
  ] as Array<[string, string]>) {
    await db.insert(players).values({
      id, isOrganizer: false, createdAt: now, name,
      tenantId: TENANT_ID, contextId: CTX_BASE,
    });
  }

  // Primary course + revisions + tees + holes.
  await db.insert(courses).values({
    id: ids.primaryCourseId, name: 'Pinehurst No. 2', clubName: 'Pinehurst Resort',
    createdAt: now, tenantId: TENANT_ID, contextId: CTX_BASE,
  });
  // Revision 1.
  await db.insert(courseRevisions).values({
    id: ids.rev1Id, courseId: ids.primaryCourseId, revisionNumber: 1,
    sourceUrl: null, extractionDate: null, verified: true,
    outTotal: 36, inTotal: 36, courseTotal: 72,
    createdAt: now, tenantId: TENANT_ID, contextId: CTX_BASE,
  });
  // 18 holes for rev1.
  for (let h = 1; h <= 18; h++) {
    await db.insert(courseHoles).values({
      id: randomUUID(), courseRevisionId: ids.rev1Id,
      holeNumber: h, par: 4, si: ((h * 7) % 18) + 1,
      yardagePerTeeJson: JSON.stringify({ blue: 400 + h, white: 380 + h, red: 340 + h }),
      tenantId: TENANT_ID, contextId: CTX_BASE,
    });
  }
  // Tees for rev1 (mixed-case if opts).
  const teeColors = opts.mixedCaseTees
    ? ['Blue', 'white', 'RED']
    : ['blue', 'red', 'white'];
  for (const tc of teeColors) {
    await db.insert(courseTees).values({
      id: randomUUID(), courseRevisionId: ids.rev1Id, teeColor: tc,
      rating: 720, slope: 113,
      tenantId: TENANT_ID, contextId: CTX_BASE,
    });
  }

  if (opts.multiRevisionPinning) {
    // Revision 2 — newer, slightly different totals to distinguish.
    await db.insert(courseRevisions).values({
      id: ids.rev2Id, courseId: ids.primaryCourseId, revisionNumber: 2,
      sourceUrl: null, extractionDate: null, verified: true,
      outTotal: 35, inTotal: 36, courseTotal: 71,    // distinguishable
      createdAt: now + 1, tenantId: TENANT_ID, contextId: CTX_BASE,
    });
    for (let h = 1; h <= 18; h++) {
      await db.insert(courseHoles).values({
        id: randomUUID(), courseRevisionId: ids.rev2Id,
        holeNumber: h, par: h === 1 ? 3 : 4, si: ((h * 7) % 18) + 1,
        yardagePerTeeJson: JSON.stringify({ blue: 500 + h }),
        tenantId: TENANT_ID, contextId: CTX_BASE,
      });
    }
    await db.insert(courseTees).values({
      id: randomUUID(), courseRevisionId: ids.rev2Id, teeColor: 'blue',
      rating: 720, slope: 113,
      tenantId: TENANT_ID, contextId: CTX_BASE,
    });
  }

  // Orphan course — exists but not referenced by any event_round.
  if (opts.withOrphanCourse) {
    await db.insert(courses).values({
      id: ids.orphanCourseId, name: 'Orphan Course', clubName: 'Orphan Club',
      createdAt: now, tenantId: TENANT_ID, contextId: CTX_BASE,
    });
    await db.insert(courseRevisions).values({
      id: ids.orphanRevId, courseId: ids.orphanCourseId, revisionNumber: 1,
      sourceUrl: null, extractionDate: null, verified: false,
      outTotal: 36, inTotal: 36, courseTotal: 72,
      createdAt: now, tenantId: TENANT_ID, contextId: CTX_BASE,
    });
  }

  // Event + 2 rounds.
  await db.insert(events).values({
    id: ids.eventId, name: 'Pinehurst 2026',
    startDate: now, endDate: now + 4 * 86400000,
    timezone: 'America/New_York', organizerPlayerId: ids.organizerId,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  // Round 1: revision 2 if multi-rev (so pinning picks R2 by lowest round_number); else revision 1.
  // Round 2: revision 1 if multi-rev (so pinning rule picks the lowest round_number's rev).
  const round1RevId = opts.multiRevisionPinning ? ids.rev2Id : ids.rev1Id;
  const round2RevId = opts.multiRevisionPinning ? ids.rev1Id : ids.rev1Id;
  const round1TeeColor = opts.unknownDefaultTee ? 'green' : (opts.mixedCaseTees ? 'Blue' : 'blue');
  await db.insert(eventRounds).values({
    id: ids.er1Id, eventId: ids.eventId, roundNumber: 1, roundDate: now,
    courseRevisionId: round1RevId, teeColor: round1TeeColor, holesToPlay: 18,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(eventRounds).values({
    id: ids.er2Id, eventId: ids.eventId, roundNumber: 2, roundDate: now + 86400000,
    courseRevisionId: round2RevId, teeColor: 'white', holesToPlay: 18,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });

  // Group + participant.
  await db.insert(groups).values({
    id: ids.groupId, eventId: ids.eventId, name: 'G',
    moneyVisibilityMode: 'open', createdAt: now,
    tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(groupMembers).values({
    groupId: ids.groupId, playerId: ids.participantId,
    tenantId: TENANT_ID, contextId: ctx,
  });

  return {
    organizerId: ids.organizerId,
    participantId: ids.participantId,
    outsiderId: ids.outsiderId,
    eventId: ids.eventId,
    primaryCourseId: ids.primaryCourseId,
    orphanCourseId: ids.orphanCourseId,
  };
}

function buildApp(playerId: string): Hono {
  __testPlayer = { id: playerId, isOrganizer: false };
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/events', coursePreviewRouter);
  return app;
}

async function getCourse(app: Hono, eventId: string, courseId: string): Promise<Response> {
  return await app.request(`/api/events/${eventId}/courses/${courseId}`);
}

interface CourseBody {
  course: { id: string; name: string; clubName: string };
  revision: { id: string; revisionNumber: number; outTotal: number; inTotal: number; courseTotal: number };
  tees: Array<{ teeColor: string; rating: number; slope: number }>;
  holes: Array<{ holeNumber: number; par: number; si: number; yardageByTee: Record<string, number> }>;
  defaultTeeColor: string | null;
}

describe('GET /api/events/:eventId/courses/:courseId', () => {
  test('(a) happy path — 18 holes, 3 tees, defaultTeeColor matches round 1 tee_color', async () => {
    const s = await seed();
    const app = buildApp(s.participantId);
    const res = await getCourse(app, s.eventId, s.primaryCourseId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CourseBody;
    expect(body.course.name).toBe('Pinehurst No. 2');
    expect(body.revision.revisionNumber).toBe(1);
    expect(body.revision.courseTotal).toBe(72);
    expect(body.tees.length).toBe(3);
    expect(body.holes.length).toBe(18);
    expect(body.defaultTeeColor).toBe('blue');
    // Yardage parsed from JSON.
    expect(body.holes[0]!.yardageByTee['blue']).toBe(401);
  });

  test('(b) multi-revision pinning — round 1 uses R2, round 2 uses R1; response is R2', async () => {
    const s = await seed({ multiRevisionPinning: true });
    const app = buildApp(s.participantId);
    const res = await getCourse(app, s.eventId, s.primaryCourseId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CourseBody;
    // R2 had courseTotal: 71, hole 1 par: 3.
    expect(body.revision.revisionNumber).toBe(2);
    expect(body.revision.courseTotal).toBe(71);
    expect(body.holes[0]!.par).toBe(3);
  });

  test('(c) tees ordered by lowercase(teeColor) ASC even with mixed case', async () => {
    const s = await seed({ mixedCaseTees: true });
    const app = buildApp(s.participantId);
    const res = await getCourse(app, s.eventId, s.primaryCourseId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CourseBody;
    expect(body.tees.map((t) => t.teeColor)).toEqual(['Blue', 'RED', 'white']);
    // defaultTeeColor matches round 1's "Blue" (case-insensitive lookup).
    expect(body.defaultTeeColor).toBe('Blue');
  });

  test('(d) defaultTeeColor null when round tee_color does not match any tees row', async () => {
    const s = await seed({ unknownDefaultTee: true });
    const app = buildApp(s.participantId);
    const res = await getCourse(app, s.eventId, s.primaryCourseId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CourseBody;
    expect(body.defaultTeeColor).toBeNull();
  });

  test('(e) 403 for course not referenced by any event_round (uniform shape)', async () => {
    const s = await seed({ withOrphanCourse: true });
    const app = buildApp(s.participantId);
    const res = await getCourse(app, s.eventId, s.orphanCourseId);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_event_participant');
  });

  test('(f) 403 for unknown courseId (uniform shape)', async () => {
    const s = await seed();
    const app = buildApp(s.participantId);
    const res = await getCourse(app, s.eventId, randomUUID());
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_event_participant');
  });

  test('(g) 403 non-participant (outsider)', async () => {
    const s = await seed();
    const app = buildApp(s.outsiderId);
    const res = await getCourse(app, s.eventId, s.primaryCourseId);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_event_participant');
  });

  test('(h) 403 malformed eventId', async () => {
    const s = await seed();
    const app = buildApp(s.participantId);
    const res = await getCourse(app, 'not-a-uuid', s.primaryCourseId);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_event_participant');
  });
});
