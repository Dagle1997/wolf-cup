/**
 * T7-1 GET /api/events/:eventId integration tests.
 *
 * Covers AC-2 + AC-5 (api):
 *  (a) 200 happy path — event + rounds sorted by roundNumber.
 *  (b) 403 non-participant.
 *  (c) 403 unknown eventId (no-existence-leak).
 *  (d) 403 malformed eventId (no-existence-leak).
 */
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
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
} = await import('../db/schema/index.js');
const { eventsRouter } = await import('./events.js');
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
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

interface SeedResult {
  organizerId: string;
  participantId: string;
  outsiderId: string;
  eventId: string;
  eventRoundIds: [string, string, string];   // 3 rounds, intentionally inserted out of order
}

async function seed(): Promise<SeedResult> {
  const now = Date.now();
  const ids = {
    organizerId: randomUUID(),
    participantId: randomUUID(),
    outsiderId: randomUUID(),
    eventId: randomUUID(),
    courseId: randomUUID(),
    courseRevId: randomUUID(),
    groupId: randomUUID(),
    er1: randomUUID(),
    er2: randomUUID(),
    er3: randomUUID(),
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

  await db.insert(courses).values({
    id: ids.courseId, name: 'C', clubName: 'CC',
    createdAt: now, tenantId: TENANT_ID, contextId: CTX_BASE,
  });
  await db.insert(courseRevisions).values({
    id: ids.courseRevId, courseId: ids.courseId, revisionNumber: 1,
    sourceUrl: null, extractionDate: null, verified: false,
    outTotal: 36, inTotal: 36, courseTotal: 72,
    createdAt: now, tenantId: TENANT_ID, contextId: CTX_BASE,
  });

  await db.insert(events).values({
    id: ids.eventId, name: 'Pinehurst 2026',
    startDate: now, endDate: now + 4 * 86400000,
    timezone: 'America/New_York', organizerPlayerId: ids.organizerId,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });

  // Insert event_rounds intentionally out of order to verify ORDER BY in the route.
  await db.insert(eventRounds).values({
    id: ids.er2, eventId: ids.eventId, roundNumber: 2, roundDate: now + 86400000,
    courseRevisionId: ids.courseRevId, teeColor: 'blue', holesToPlay: 18,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(eventRounds).values({
    id: ids.er3, eventId: ids.eventId, roundNumber: 3, roundDate: now + 2 * 86400000,
    courseRevisionId: ids.courseRevId, teeColor: 'blue', holesToPlay: 9,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(eventRounds).values({
    id: ids.er1, eventId: ids.eventId, roundNumber: 1, roundDate: now,
    courseRevisionId: ids.courseRevId, teeColor: 'blue', holesToPlay: 18,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });

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
    eventRoundIds: [ids.er1, ids.er2, ids.er3],
  };
}

function buildApp(playerId: string): Hono {
  __testPlayer = { id: playerId, isOrganizer: false };
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/events', eventsRouter);
  return app;
}

async function getEvent(app: Hono, eventId: string): Promise<Response> {
  return await app.request(`/api/events/${eventId}`);
}

describe('GET /api/events/:eventId', () => {
  test('(a) happy path — returns event metadata + rounds ordered by roundNumber', async () => {
    const s = await seed();
    const app = buildApp(s.participantId);
    const res = await getEvent(app, s.eventId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      event: { id: string; name: string; startDate: number; endDate: number; timezone: string };
      rounds: Array<{ id: string; roundNumber: number; roundDate: number; holesToPlay: number }>;
    };
    expect(body.event.id).toBe(s.eventId);
    expect(body.event.name).toBe('Pinehurst 2026');
    expect(body.event.timezone).toBe('America/New_York');
    expect(body.rounds.length).toBe(3);
    // Ordered by roundNumber asc, even though we inserted 2/3/1.
    expect(body.rounds.map((r) => r.roundNumber)).toEqual([1, 2, 3]);
    // 9-hole round is round 3.
    expect(body.rounds[2]!.holesToPlay).toBe(9);
  });

  test('(f) returns viewerName + liveRound (null when no round is in progress)', async () => {
    const s = await seed();
    const app = buildApp(s.participantId);
    const res = await getEvent(app, s.eventId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      viewerName: string | null;
      liveRound: { roundId: string; roundNumber: number } | null;
    };
    // The participant player was seeded with name 'Participant'.
    expect(body.viewerName).toBe('Participant');
    // No scoring round started → no live CTA.
    expect(body.liveRound).toBeNull();
  });

  test('(b) 403 non-participant (outsider)', async () => {
    const s = await seed();
    const app = buildApp(s.outsiderId);
    const res = await getEvent(app, s.eventId);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_event_participant');
  });

  test('(c) 403 unknown eventId (no-existence-leak)', async () => {
    const s = await seed();
    const app = buildApp(s.participantId);
    const res = await getEvent(app, randomUUID());
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_event_participant');
  });

  test('(d) 403 malformed eventId (no-existence-leak)', async () => {
    const s = await seed();
    const app = buildApp(s.participantId);
    const res = await getEvent(app, 'not-a-uuid');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_event_participant');
  });

  test('(e) T13-1: 200 for THIS event organizer with NO group_members row (event-specific exemption)', async () => {
    const s = await seed();
    // organizerId is events.organizer_player_id but is NOT a group member —
    // exactly the prod trap state. buildApp stamps isOrganizer:false, so a 200
    // here proves the exemption is keyed on organizer_player_id, NOT the global
    // is_organizer flag.
    const app = buildApp(s.organizerId);
    const res = await getEvent(app, s.eventId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { event: { id: string } };
    expect(body.event.id).toBe(s.eventId);
  });
});

// ---------------------------------------------------------------------------
// Organizer-scoped soft-cancel / restore (multi-organizer lifecycle).
// ---------------------------------------------------------------------------
async function cancelEvent(app: Hono, eventId: string): Promise<Response> {
  return await app.request(`/api/events/${eventId}/cancel`, { method: 'POST' });
}
async function restoreEvent(app: Hono, eventId: string): Promise<Response> {
  return await app.request(`/api/events/${eventId}/restore`, { method: 'POST' });
}
async function listEvents(app: Hono): Promise<Response> {
  return await app.request('/api/events');
}

describe('POST /api/events/:eventId/cancel + /restore', () => {
  test('organizer cancels their event (200, audit stamped), idempotent on repeat', async () => {
    const s = await seed();
    const app = buildApp(s.organizerId); // isOrganizer:false → proves event-scoped auth
    const res = await cancelEvent(app, s.eventId);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, cancelled: true, idempotent: false });

    // Audit columns set on the row.
    const row = (
      await db
        .select({ cancelledAt: events.cancelledAt, cancelledBy: events.cancelledByPlayerId })
        .from(events)
        .where(eq(events.id, s.eventId))
    )[0]!;
    expect(row.cancelledAt).not.toBeNull();
    expect(row.cancelledBy).toBe(s.organizerId);

    // Second cancel is a no-op (idempotent), original timestamp preserved.
    const first = row.cancelledAt;
    const res2 = await cancelEvent(app, s.eventId);
    expect(res2.status).toBe(200);
    expect(await res2.json()).toMatchObject({ idempotent: true });
    const after = (
      await db.select({ cancelledAt: events.cancelledAt }).from(events).where(eq(events.id, s.eventId))
    )[0]!;
    expect(after.cancelledAt).toBe(first);
  });

  test('a participant (non-organizer) cannot cancel — 403 not_event_organizer', async () => {
    const s = await seed();
    const app = buildApp(s.participantId);
    const res = await cancelEvent(app, s.eventId);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_event_organizer');
    // Row untouched.
    const row = (
      await db.select({ cancelledAt: events.cancelledAt }).from(events).where(eq(events.id, s.eventId))
    )[0]!;
    expect(row.cancelledAt).toBeNull();
  });

  test('unknown eventId → 403 not_event_organizer (no-existence-leak)', async () => {
    const s = await seed();
    const app = buildApp(s.organizerId);
    const res = await cancelEvent(app, randomUUID());
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_event_organizer');
  });

  test('malformed eventId → 400 invalid_event_id', async () => {
    const s = await seed();
    const app = buildApp(s.organizerId);
    const res = await cancelEvent(app, 'not-a-uuid');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_event_id');
  });

  test('restore un-cancels (200, clears audit columns); idempotent when already active', async () => {
    const s = await seed();
    const app = buildApp(s.organizerId);
    await cancelEvent(app, s.eventId);

    const res = await restoreEvent(app, s.eventId);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, cancelled: false, idempotent: false });
    const row = (
      await db
        .select({ cancelledAt: events.cancelledAt, cancelledBy: events.cancelledByPlayerId })
        .from(events)
        .where(eq(events.id, s.eventId))
    )[0]!;
    expect(row.cancelledAt).toBeNull();
    expect(row.cancelledBy).toBeNull();

    // Restoring an already-active event is a no-op.
    const res2 = await restoreEvent(app, s.eventId);
    expect(res2.status).toBe(200);
    expect(await res2.json()).toMatchObject({ idempotent: true });
  });

  test('a participant cannot restore — 403', async () => {
    const s = await seed();
    const orgApp = buildApp(s.organizerId);
    await cancelEvent(orgApp, s.eventId);
    const app = buildApp(s.participantId);
    const res = await restoreEvent(app, s.eventId);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/events list — cancelled events are hidden from participants only', () => {
  test('after cancel: participant no longer sees it; organizer still sees it with cancelledAt', async () => {
    const s = await seed();
    const orgApp = buildApp(s.organizerId);
    await cancelEvent(orgApp, s.eventId);

    // Participant: cancelled event filtered out of their list.
    const pApp = buildApp(s.participantId);
    const pRes = await listEvents(pApp);
    expect(pRes.status).toBe(200);
    const pBody = (await pRes.json()) as { events: Array<{ id: string }> };
    expect(pBody.events.map((e) => e.id)).not.toContain(s.eventId);

    // Organizer: still present, flagged cancelled (so they can restore).
    const oApp = buildApp(s.organizerId);
    const oRes = await listEvents(oApp);
    const oBody = (await oRes.json()) as {
      events: Array<{ id: string; isOrganizer: boolean; cancelledAt: number | null }>;
    };
    const mine = oBody.events.find((e) => e.id === s.eventId);
    expect(mine).toBeDefined();
    expect(mine!.isOrganizer).toBe(true);
    expect(mine!.cancelledAt).not.toBeNull();
  });
});
