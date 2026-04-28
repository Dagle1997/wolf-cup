import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
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
    c.set('session', {
      sessionId: 'test-session',
      playerId: __testPlayer.id,
    });
    await next();
  },
}));

const { db } = await import('../db/index.js');
const {
  players,
  courses,
  courseRevisions,
  courseHoles,
  courseTees,
  events,
  eventRounds,
  groups,
  groupMembers,
  rounds,
} = await import('../db/schema/index.js');
const { eventRoundsCourseRouter } = await import('./scores.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT_ID = 'guyan';
const CTX_BASE = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(courseHoles);
  await db.delete(courseTees);
  await db.delete(rounds);
  await db.delete(eventRounds);
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(events);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

interface SeedOpts {
  multipleTees?: boolean;
}

interface SeedResult {
  organizerId: string;
  participantId: string;
  outsiderId: string;
  eventId: string;
  eventRoundId: string;
  roundId: string;
  courseRevisionId: string;
  ctx: string;
}

async function seed(opts: SeedOpts = {}): Promise<SeedResult> {
  const now = Date.now();
  const ids = {
    organizerId: randomUUID(),
    participantId: randomUUID(),
    outsiderId: randomUUID(),
    eventId: randomUUID(),
    eventRoundId: randomUUID(),
    roundId: randomUUID(),
    courseId: randomUUID(),
    courseRevId: randomUUID(),
    groupId: randomUUID(),
  };
  const ctx = `event:${ids.eventId}`;

  for (const [id, name, isOrg] of [
    [ids.organizerId, 'Organizer', true],
    [ids.participantId, 'Participant', false],
    [ids.outsiderId, 'Outsider', false],
  ] as const) {
    await db.insert(players).values({
      id,
      isOrganizer: isOrg,
      createdAt: now,
      name,
      tenantId: TENANT_ID,
      contextId: CTX_BASE,
    });
  }

  await db.insert(courses).values({
    id: ids.courseId,
    name: 'Pinehurst No. 2',
    clubName: 'Pinehurst Resort',
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX_BASE,
  });
  await db.insert(courseRevisions).values({
    id: ids.courseRevId,
    courseId: ids.courseId,
    revisionNumber: 1,
    sourceUrl: null,
    extractionDate: null,
    verified: true,
    outTotal: 36,
    inTotal: 36,
    courseTotal: 72,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX_BASE,
  });
  // 18 holes: par 4 / SI 1..18 / yardages
  for (let h = 1; h <= 18; h++) {
    const yardagePerTee: Record<string, number> = { blue: 350 + h * 5 };
    if (opts.multipleTees) {
      yardagePerTee['white'] = 320 + h * 5;
      yardagePerTee['red'] = 280 + h * 5;
    }
    await db.insert(courseHoles).values({
      id: randomUUID(),
      courseRevisionId: ids.courseRevId,
      holeNumber: h,
      par: 4,
      si: h, // SI 1..18 maps to hole 1..18 for simplicity
      yardagePerTeeJson: JSON.stringify(yardagePerTee),
      tenantId: TENANT_ID,
      contextId: CTX_BASE,
    });
  }
  await db.insert(courseTees).values({
    id: randomUUID(),
    courseRevisionId: ids.courseRevId,
    teeColor: 'blue',
    rating: 723, // 72.3
    slope: 130,
    tenantId: TENANT_ID,
    contextId: CTX_BASE,
  });
  if (opts.multipleTees) {
    await db.insert(courseTees).values([
      {
        id: randomUUID(),
        courseRevisionId: ids.courseRevId,
        teeColor: 'white',
        rating: 705,
        slope: 125,
        tenantId: TENANT_ID,
        contextId: CTX_BASE,
      },
      {
        id: randomUUID(),
        courseRevisionId: ids.courseRevId,
        teeColor: 'red',
        rating: 690,
        slope: 120,
        tenantId: TENANT_ID,
        contextId: CTX_BASE,
      },
    ]);
  }

  await db.insert(events).values({
    id: ids.eventId,
    name: 'Test Event',
    startDate: now,
    endDate: now + 86400000,
    timezone: 'America/New_York',
    organizerPlayerId: ids.organizerId,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });
  await db.insert(eventRounds).values({
    id: ids.eventRoundId,
    eventId: ids.eventId,
    roundNumber: 1,
    roundDate: now,
    courseRevisionId: ids.courseRevId,
    teeColor: 'blue',
    holesToPlay: 18,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });
  await db.insert(rounds).values({
    id: ids.roundId,
    eventId: ids.eventId,
    eventRoundId: ids.eventRoundId,
    holesToPlay: 18,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });

  // requireEventParticipant needs a group + group_members row.
  await db.insert(groups).values({
    id: ids.groupId,
    eventId: ids.eventId,
    name: 'Group A',
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });
  await db.insert(groupMembers).values({
    groupId: ids.groupId,
    playerId: ids.participantId,
    tenantId: TENANT_ID,
    contextId: ctx,
  });

  return {
    organizerId: ids.organizerId,
    participantId: ids.participantId,
    outsiderId: ids.outsiderId,
    eventId: ids.eventId,
    eventRoundId: ids.eventRoundId,
    roundId: ids.roundId,
    courseRevisionId: ids.courseRevId,
    ctx,
  };
}

function buildApp(playerId: string): Hono {
  __testPlayer = { id: playerId, isOrganizer: false };
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/events', eventRoundsCourseRouter);
  return app;
}

async function getCourse(
  app: Hono,
  eventId: string,
  roundId: string,
): Promise<Response> {
  return await app.request(
    `/api/events/${eventId}/rounds/${roundId}/course`,
    { method: 'GET' },
  );
}

describe('GET /api/events/:eventId/rounds/:roundId/course', () => {
  test('200 happy path: 18 holes + 1 tee + selectedTeeColor', async () => {
    const s = await seed();
    const app = buildApp(s.participantId);
    const res = await getCourse(app, s.eventId, s.roundId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      roundId: string;
      courseRevisionId: string;
      course: { name: string; clubName: string };
      holes: Array<{
        holeNumber: number;
        par: number;
        si: number;
        yardagePerTee: Record<string, number>;
      }>;
      tees: Array<{ teeColor: string; rating: number; slope: number }>;
      selectedTeeColor: string;
    };
    expect(body.roundId).toBe(s.roundId);
    expect(body.courseRevisionId).toBe(s.courseRevisionId);
    expect(body.course.name).toBe('Pinehurst No. 2');
    expect(body.course.clubName).toBe('Pinehurst Resort');
    expect(body.holes.length).toBe(18);
    expect(body.holes[0]!.holeNumber).toBe(1);
    expect(body.holes[17]!.holeNumber).toBe(18);
    expect(body.holes[0]!.par).toBe(4);
    expect(body.holes[0]!.yardagePerTee).toEqual({ blue: 355 });
    expect(body.tees.length).toBe(1);
    expect(body.tees[0]!.teeColor).toBe('blue');
    expect(body.tees[0]!.rating).toBe(723);
    expect(body.tees[0]!.slope).toBe(130);
    expect(body.selectedTeeColor).toBe('blue');
  });

  test('200 with multiple tees (blue + white + red)', async () => {
    const s = await seed({ multipleTees: true });
    const app = buildApp(s.participantId);
    const res = await getCourse(app, s.eventId, s.roundId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tees: Array<{ teeColor: string }>;
      holes: Array<{ yardagePerTee: Record<string, number> }>;
    };
    expect(body.tees.length).toBe(3);
    expect(body.tees.map((t) => t.teeColor).sort()).toEqual(['blue', 'red', 'white']);
    // First hole's yardagePerTee carries all three.
    expect(Object.keys(body.holes[0]!.yardagePerTee).sort()).toEqual([
      'blue',
      'red',
      'white',
    ]);
  });

  test('400 invalid_round_id: non-UUID path param', async () => {
    const s = await seed();
    const app = buildApp(s.participantId);
    const res = await getCourse(app, s.eventId, 'not-a-uuid');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_round_id');
  });

  test('401 no session', async () => {
    const s = await seed();
    __testPlayer = null;
    const app = new Hono();
    app.use('*', (await import('../middleware/request-id.js')).requestIdMiddleware);
    app.route('/api/events', eventRoundsCourseRouter);
    const res = await getCourse(app, s.eventId, s.roundId);
    expect(res.status).toBe(401);
  });

  test('400 invalid_event_id: non-UUID :eventId fires BEFORE participant lookup', async () => {
    const s = await seed();
    const app = buildApp(s.participantId);
    const res = await getCourse(app, 'not-a-uuid', s.roundId);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_event_id');
  });

  test('404 round_not_found: round.event_id does NOT match URL :eventId', async () => {
    const s = await seed();
    // Create a second event in the same tenant + move the round to it.
    // The participant is in s.eventId's group (so requireEventParticipant
    // passes when the URL :eventId is s.eventId), but the round now
    // points at otherEventId — handler-level event_id mismatch fires.
    const otherEventId = randomUUID();
    const now = Date.now();
    await db.insert(events).values({
      id: otherEventId,
      name: 'Other Event',
      startDate: now,
      endDate: now + 86400000,
      timezone: 'America/New_York',
      organizerPlayerId: s.organizerId,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: `event:${otherEventId}`,
    });
    await db
      .update(rounds)
      .set({ eventId: otherEventId })
      .where(eq(rounds.id, s.roundId));
    const app = buildApp(s.participantId);
    const res = await getCourse(app, s.eventId, s.roundId);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('round_not_found');
  });

  test('404 round_not_found: foreign-tenant defense', async () => {
    const s = await seed();
    await db
      .update(rounds)
      .set({ tenantId: 'foreign-tenant' })
      .where(eq(rounds.id, s.roundId));
    const app = buildApp(s.participantId);
    const res = await getCourse(app, s.eventId, s.roundId);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('round_not_found');
  });
});
