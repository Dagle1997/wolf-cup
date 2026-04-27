import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
const {
  players,
  sessions,
  courses,
  courseRevisions,
  events,
  eventRounds,
  invites,
  groups,
} = await import('../db/schema/index.js');
const { adminEventsRouter } = await import('./admin-events.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const testApp = new Hono();
testApp.use('*', requestIdMiddleware);
testApp.route('/api/admin', adminEventsRouter);

const SESSION_COOKIE = 'tournament_session';
const TENANT_ID = 'guyan';

async function seedSession(opts: { isOrganizer: boolean }): Promise<string> {
  const now = Date.now();
  const playerId = randomUUID();
  await db.insert(players).values({
    id: playerId,
    isOrganizer: opts.isOrganizer,
    createdAt: now,
    name: 'Organizer',
    tenantId: TENANT_ID,
    contextId: 'league:guyan-wolf-cup-friday',
  });
  const sessionId = randomUUID().replace(/-/g, '');
  await db.insert(sessions).values({
    sessionId,
    playerId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    deviceInfo: null,
    tenantId: TENANT_ID,
    contextId: 'league:guyan-wolf-cup-friday',
  });
  return sessionId;
}

function cookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}`;
}

async function seedCourseRevision(
  courseId = 'c1',
  revisionId = 'cr1',
): Promise<string> {
  await db.insert(courses).values({
    id: courseId,
    name: 'Pinehurst No. 2',
    clubName: 'Pinehurst Resort',
    createdAt: Date.now(),
    tenantId: TENANT_ID,
    contextId: 'library:guyan',
  });
  await db.insert(courseRevisions).values({
    id: revisionId,
    courseId,
    revisionNumber: 1,
    outTotal: 36,
    inTotal: 36,
    courseTotal: 72,
    verified: true,
    createdAt: Date.now(),
    tenantId: TENANT_ID,
    contextId: 'library:guyan',
  });
  return revisionId;
}

const VALID_TZ = 'America/New_York';
const START = 1_715_040_000_000; // 2026-05-07
const END = 1_715_300_000_000; // 2026-05-10
const ROUND1_DATE = 1_715_040_000_000; // 2026-05-07

function validEventRequest(courseRevisionId = 'cr1') {
  return {
    name: 'Pinehurst 2026',
    start_date: START,
    end_date: END,
    timezone: VALID_TZ,
    rounds: [
      {
        round_date: ROUND1_DATE,
        course_revision_id: courseRevisionId,
        tee_color: 'blue',
        holes_to_play: 18 as const,
      },
    ],
  };
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  // Reverse FK dependency order. CASCADE handles event-children; explicit
  // truncation keeps test isolation loud.
  await db.delete(invites);
  await db.delete(eventRounds);
  await db.delete(groups);
  await db.delete(events);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(sessions);
  await db.delete(players);
});

describe('POST /api/admin/events', () => {
  it('happy path: organizer POSTs valid payload → 201, all 4 tables populated', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    await seedCourseRevision();

    const res = await testApp.request('/api/admin/events', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(validEventRequest()),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { eventId: string; inviteToken: string; requestId: string };
    expect(typeof body.eventId).toBe('string');
    expect(typeof body.inviteToken).toBe('string');

    // Invite token shape: 32 random bytes → 43 base64url chars (no padding).
    expect(body.inviteToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(body.inviteToken).toHaveLength(43);

    // events row
    const eventRows = await db.select().from(events).where(eq(events.id, body.eventId));
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]!.name).toBe('Pinehurst 2026');
    expect(eventRows[0]!.tenantId).toBe('guyan');
    // context_id stamping discipline
    expect(eventRows[0]!.contextId).toBe(`event:${body.eventId}`);

    // event_rounds rows (1 round, round_number = 1)
    const roundRows = await db
      .select()
      .from(eventRounds)
      .where(eq(eventRounds.eventId, body.eventId));
    expect(roundRows).toHaveLength(1);
    expect(roundRows[0]!.roundNumber).toBe(1);
    expect(roundRows[0]!.holesToPlay).toBe(18);
    expect(roundRows[0]!.contextId).toBe(`event:${body.eventId}`);

    // invites row (1, with the returned token)
    const inviteRows = await db
      .select()
      .from(invites)
      .where(eq(invites.eventId, body.eventId));
    expect(inviteRows).toHaveLength(1);
    expect(inviteRows[0]!.token).toBe(body.inviteToken);
    expect(inviteRows[0]!.contextId).toBe(`event:${body.eventId}`);

    // groups row (1 default Group, "{event name} Crew")
    const groupRows = await db.select().from(groups).where(eq(groups.eventId, body.eventId));
    expect(groupRows).toHaveLength(1);
    expect(groupRows[0]!.name).toBe('Pinehurst 2026 Crew');
    expect(groupRows[0]!.moneyVisibilityMode).toBe('open');
    expect(groupRows[0]!.contextId).toBe(`event:${body.eventId}`);
  });

  it('Zod rejection: end_date < start_date → 400 invalid_body, no rows written', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    await seedCourseRevision();
    const payload = { ...validEventRequest(), end_date: START - 1 };

    const res = await testApp.request('/api/admin/events', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
    expect(await db.select().from(events)).toHaveLength(0);
  });

  it('Zod rejection: round_date outside [start, end] → 400 invalid_body, no rows written', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    await seedCourseRevision();
    const payload = validEventRequest();
    payload.rounds[0]!.round_date = END + 86_400_000; // 1 day after end

    const res = await testApp.request('/api/admin/events', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
    expect(await db.select().from(events)).toHaveLength(0);
  });

  it('Zod rejection: empty rounds array → 400 invalid_body', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    await seedCourseRevision();
    const payload = { ...validEventRequest(), rounds: [] };

    const res = await testApp.request('/api/admin/events', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });

  it('Zod rejection: invalid IANA timezone → 400 invalid_body', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    await seedCourseRevision();
    const payload = { ...validEventRequest(), timezone: 'foo/bar' };

    const res = await testApp.request('/api/admin/events', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });

  it('Pre-flight rejection: unknown course_revision_id → 400 unknown_course_revision with missing list', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    // No course_revisions seeded.
    const payload = validEventRequest('does-not-exist');

    const res = await testApp.request('/api/admin/events', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; missing: string[] };
    expect(body.code).toBe('unknown_course_revision');
    expect(body.missing).toEqual(['does-not-exist']);
    // Pre-flight fires BEFORE the transaction → no events row.
    expect(await db.select().from(events)).toHaveLength(0);
  });

  it('unauthenticated POST → 401 session_missing', async () => {
    await seedCourseRevision();
    const res = await testApp.request('/api/admin/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validEventRequest()),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('session_missing');
  });

  it('non-organizer POST → 403 not_organizer', async () => {
    const sessionId = await seedSession({ isOrganizer: false });
    await seedCourseRevision();

    const res = await testApp.request('/api/admin/events', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(validEventRequest()),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_organizer');
  });

  it('body > 16 KiB → 400 body_too_large', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    await seedCourseRevision();
    const payload = { ...validEventRequest(), name: 'x'.repeat(20_000) };
    const bodyStr = JSON.stringify(payload);

    const res = await testApp.request('/api/admin/events', {
      method: 'POST',
      headers: {
        cookie: cookie(sessionId),
        'content-type': 'application/json',
        'content-length': String(bodyStr.length),
      },
      body: bodyStr,
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toBe('bad_request');
    expect(body.code).toBe('body_too_large');
  });

  it('transactional rollback (db.transaction throws generic Error) → 500 create_failed, no rows written', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    await seedCourseRevision();

    // Mirror T2-5's spy pattern: force a non-UNIQUE generic failure
    // inside the transaction. The pre-flight check passes (course_revision
    // exists), so the failure happens during INSERT, exercising the
    // rollback path.
    const transactionSpy = vi
      .spyOn(db, 'transaction')
      .mockRejectedValueOnce(new Error('disk full'));

    const res = await testApp.request('/api/admin/events', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(validEventRequest()),
    });

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toBe('internal');
    expect(body.code).toBe('create_failed');

    transactionSpy.mockRestore();

    // No rows landed.
    expect(await db.select().from(events)).toHaveLength(0);
    expect(await db.select().from(eventRounds)).toHaveLength(0);
    expect(await db.select().from(invites)).toHaveLength(0);
    expect(await db.select().from(groups)).toHaveLength(0);
  });

  it('multi-round event: 4 rounds → 4 event_rounds with sequential round_number 1..4', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    await seedCourseRevision();
    const payload = {
      ...validEventRequest(),
      rounds: [START, START + 86_400_000, START + 2 * 86_400_000, END].map((d) => ({
        round_date: d,
        course_revision_id: 'cr1',
        tee_color: 'blue',
        holes_to_play: 18 as const,
      })),
    };

    const res = await testApp.request('/api/admin/events', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { eventId: string };
    const roundRows = await db
      .select()
      .from(eventRounds)
      .where(eq(eventRounds.eventId, body.eventId));
    expect(roundRows).toHaveLength(4);
    const sortedNumbers = roundRows.map((r) => r.roundNumber).sort((a, b) => a - b);
    expect(sortedNumbers).toEqual([1, 2, 3, 4]);
  });
});
