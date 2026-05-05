/**
 * T7-2 GET /api/events/:eventId/schedule integration tests.
 *
 * Covers AC-1..AC-3, AC-6 (api):
 *  (a) 200 happy path — viewer in foursome of both rounds.
 *  (b) 200 round with no pairings → kind='no_pairings_set'.
 *  (c) 200 round with pairings but viewer not member → kind='viewer_not_in_foursome'.
 *  (d) 200 viewer in different foursomes across rounds.
 *  (e) 403 non-participant.
 *  (f) 403 malformed eventId.
 *  (g) 403 unknown eventId.
 *  (h) Rounds ordered by roundNumber asc.
 */
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { and, eq } from 'drizzle-orm';
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
  events,
  eventRounds,
  groups,
  groupMembers,
  pairings,
  pairingMembers,
} = await import('../db/schema/index.js');
const { scheduleRouter } = await import('./schedule.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT_ID = 'guyan';
const CTX_BASE = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(pairingMembers);
  await db.delete(pairings);
  await db.delete(eventRounds);
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(events);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

interface SeedResult {
  organizerId: string;
  viewerId: string;
  p2: string;
  p3: string;
  p4: string;
  outsiderId: string;
  eventId: string;
  eventRound1Id: string;
  eventRound2Id: string;
  pairing1Id: string;       // viewer in this pairing for round 1
  pairing2Id: string;       // viewer in this pairing for round 2
  courseId: string;
}

async function seed(): Promise<SeedResult> {
  const now = Date.now();
  const ids = {
    organizerId: randomUUID(),
    viewerId: randomUUID(),
    p2: randomUUID(),
    p3: randomUUID(),
    p4: randomUUID(),
    outsiderId: randomUUID(),
    eventId: randomUUID(),
    courseId: randomUUID(),
    courseRevId: randomUUID(),
    groupId: randomUUID(),
    er1: randomUUID(),
    er2: randomUUID(),
    pairing1Id: randomUUID(),
    pairing2Id: randomUUID(),
  };
  const ctx = `event:${ids.eventId}`;

  for (const [id, name, hi] of [
    [ids.organizerId, 'Organizer', 0],
    [ids.viewerId, 'Viewer Vince', 8.0],
    [ids.p2, 'Player Two', 12.0],
    [ids.p3, 'Player Three', 14.0],
    [ids.p4, 'Player Four', 22.0],
    [ids.outsiderId, 'Outsider', 0],
  ] as Array<[string, string, number]>) {
    await db.insert(players).values({
      id, isOrganizer: false, createdAt: now, name, manualHandicapIndex: hi,
      tenantId: TENANT_ID, contextId: CTX_BASE,
    });
  }

  await db.insert(courses).values({
    id: ids.courseId, name: 'Pinehurst No. 2', clubName: 'Pinehurst Resort',
    createdAt: now, tenantId: TENANT_ID, contextId: CTX_BASE,
  });
  await db.insert(courseRevisions).values({
    id: ids.courseRevId, courseId: ids.courseId, revisionNumber: 1,
    sourceUrl: null, extractionDate: null, verified: true,
    outTotal: 36, inTotal: 36, courseTotal: 72,
    createdAt: now, tenantId: TENANT_ID, contextId: CTX_BASE,
  });

  await db.insert(events).values({
    id: ids.eventId, name: 'Pinehurst 2026',
    startDate: now, endDate: now + 4 * 86400000,
    timezone: 'America/New_York', organizerPlayerId: ids.organizerId,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(eventRounds).values({
    id: ids.er1, eventId: ids.eventId, roundNumber: 1, roundDate: now,
    courseRevisionId: ids.courseRevId, teeColor: 'blue', holesToPlay: 18,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(eventRounds).values({
    id: ids.er2, eventId: ids.eventId, roundNumber: 2, roundDate: now + 86400000,
    courseRevisionId: ids.courseRevId, teeColor: 'white', holesToPlay: 18,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });

  await db.insert(groups).values({
    id: ids.groupId, eventId: ids.eventId, name: 'G',
    moneyVisibilityMode: 'open', createdAt: now,
    tenantId: TENANT_ID, contextId: ctx,
  });
  for (const pid of [ids.viewerId, ids.p2, ids.p3, ids.p4]) {
    await db.insert(groupMembers).values({
      groupId: ids.groupId, playerId: pid,
      tenantId: TENANT_ID, contextId: ctx,
    });
  }

  // Round 1 pairing: viewer + p2 + p3 + p4 in foursome 1.
  await db.insert(pairings).values({
    id: ids.pairing1Id, eventRoundId: ids.er1, foursomeNumber: 1,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  for (let i = 0; i < 4; i++) {
    const pid = [ids.viewerId, ids.p2, ids.p3, ids.p4][i]!;
    await db.insert(pairingMembers).values({
      pairingId: ids.pairing1Id, playerId: pid, slotNumber: i + 1,
      tenantId: TENANT_ID, contextId: ctx,
    });
  }
  // Round 2 pairing: viewer + p3 + p2 + p4 in foursome 1 (different slot order).
  await db.insert(pairings).values({
    id: ids.pairing2Id, eventRoundId: ids.er2, foursomeNumber: 1,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  for (let i = 0; i < 4; i++) {
    const pid = [ids.viewerId, ids.p3, ids.p2, ids.p4][i]!;
    await db.insert(pairingMembers).values({
      pairingId: ids.pairing2Id, playerId: pid, slotNumber: i + 1,
      tenantId: TENANT_ID, contextId: ctx,
    });
  }

  return {
    organizerId: ids.organizerId,
    viewerId: ids.viewerId,
    p2: ids.p2,
    p3: ids.p3,
    p4: ids.p4,
    outsiderId: ids.outsiderId,
    eventId: ids.eventId,
    eventRound1Id: ids.er1,
    eventRound2Id: ids.er2,
    pairing1Id: ids.pairing1Id,
    pairing2Id: ids.pairing2Id,
    courseId: ids.courseId,
  };
}

function buildApp(playerId: string): Hono {
  __testPlayer = { id: playerId, isOrganizer: false };
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/events', scheduleRouter);
  return app;
}

async function getSchedule(app: Hono, eventId: string): Promise<Response> {
  return await app.request(`/api/events/${eventId}/schedule`);
}

interface ScheduleBody {
  event: { id: string; name: string; timezone: string };
  rounds: Array<{
    id: string;
    roundNumber: number;
    roundDate: number;
    holesToPlay: number;
    teeColor: string;
    course: { id: string; name: string; clubName: string };
    pairing:
      | { kind: 'foursome'; foursomeNumber: number; members: Array<{ playerId: string; name: string; handicapIndex: number; isViewer: boolean }> }
      | { kind: 'no_pairings_set' }
      | { kind: 'viewer_not_in_foursome' };
  }>;
}

describe('GET /api/events/:eventId/schedule', () => {
  test('(a) happy path — viewer in foursome of both rounds; rounds ordered by roundNumber asc', async () => {
    const s = await seed();
    const app = buildApp(s.viewerId);
    const res = await getSchedule(app, s.eventId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ScheduleBody;
    expect(body.event.timezone).toBe('America/New_York');
    expect(body.rounds.length).toBe(2);
    expect(body.rounds.map((r) => r.roundNumber)).toEqual([1, 2]);
    expect(body.rounds[0]!.course.name).toBe('Pinehurst No. 2');
    expect(body.rounds[0]!.course.clubName).toBe('Pinehurst Resort');
    expect(body.rounds[0]!.teeColor).toBe('blue');
    expect(body.rounds[1]!.teeColor).toBe('white');

    // Pairing should be the viewer's foursome with isViewer flag set once.
    for (const r of body.rounds) {
      expect(r.pairing.kind).toBe('foursome');
      if (r.pairing.kind === 'foursome') {
        expect(r.pairing.members.length).toBe(4);
        const viewerCount = r.pairing.members.filter((m) => m.isViewer).length;
        expect(viewerCount).toBe(1);
        const viewer = r.pairing.members.find((m) => m.isViewer)!;
        expect(viewer.playerId).toBe(s.viewerId);
        expect(viewer.handicapIndex).toBe(8);
      }
    }
  });

  test('(b) round with NO pairings rows → kind="no_pairings_set"', async () => {
    const s = await seed();
    // Drop pairings for round 1 only — round 2 still has its pairing.
    await db.delete(pairingMembers).where(eq(pairingMembers.pairingId, s.pairing1Id));
    await db.delete(pairings).where(eq(pairings.id, s.pairing1Id));

    const app = buildApp(s.viewerId);
    const res = await getSchedule(app, s.eventId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ScheduleBody;
    expect(body.rounds[0]!.pairing.kind).toBe('no_pairings_set');
    expect(body.rounds[1]!.pairing.kind).toBe('foursome');
  });

  test('(c) pairings exist but viewer not member → kind="viewer_not_in_foursome"', async () => {
    const s = await seed();
    // Remove viewer from round 1 pairing only.
    await db
      .delete(pairingMembers)
      .where(
        and(
          eq(pairingMembers.pairingId, s.pairing1Id),
          eq(pairingMembers.playerId, s.viewerId),
        ),
      );
    // Group members still has viewer (so requireEventParticipant passes).

    const app = buildApp(s.viewerId);
    const res = await getSchedule(app, s.eventId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ScheduleBody;
    expect(body.rounds[0]!.pairing.kind).toBe('viewer_not_in_foursome');
    expect(body.rounds[1]!.pairing.kind).toBe('foursome');
  });

  test('(d) 403 non-participant', async () => {
    const s = await seed();
    const app = buildApp(s.outsiderId);
    const res = await getSchedule(app, s.eventId);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_event_participant');
  });

  test('(e) 403 malformed eventId', async () => {
    const s = await seed();
    const app = buildApp(s.viewerId);
    const res = await getSchedule(app, 'not-a-uuid');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_event_participant');
  });

  test('(f) 403 unknown eventId', async () => {
    const s = await seed();
    const app = buildApp(s.viewerId);
    const res = await getSchedule(app, randomUUID());
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_event_participant');
  });
});

