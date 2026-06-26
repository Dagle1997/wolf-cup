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
  courseTees,
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
  // Seed two tees so per-player-tee tests have valid colors to choose
  // from + an obviously-invalid color to use as the negative case.
  await db.insert(courseTees).values([
    {
      id: `${revisionId}-blue`,
      courseRevisionId: revisionId,
      teeColor: 'blue',
      slope: 130,
      rating: 720,
      tenantId: TENANT_ID,
      contextId: 'library:guyan',
    },
    {
      id: `${revisionId}-forward`,
      courseRevisionId: revisionId,
      teeColor: 'forward',
      slope: 110,
      rating: 640,
      tenantId: TENANT_ID,
      contextId: 'library:guyan',
    },
  ]);
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
  await db.delete(courseTees);
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

  it('Pre-flight rejection: tee_color not a real tee of the course → 400 unknown_tee_color, no rows written', async () => {
    // Regression guard: the wizard's free-text tee fallback once persisted a
    // bogus tee like "1" (no matching course_tees row → broken slope-aware
    // course handicap → wrong net/money). Creation must now reject it, the
    // same way the pairings save + edit-round-course PATCH already do.
    const sessionId = await seedSession({ isOrganizer: true });
    await seedCourseRevision(); // seeds 'blue' + 'forward' tees on cr1
    const payload = validEventRequest();
    payload.rounds[0]!.tee_color = '1'; // not blue/forward

    const res = await testApp.request('/api/admin/events', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; teeColor: string };
    expect(body.code).toBe('unknown_tee_color');
    expect(body.teeColor).toBe('1');
    // Pre-flight fires BEFORE the transaction → no events row.
    expect(await db.select().from(events)).toHaveLength(0);
  });

  it('tee-less course revision: any tee_color allowed (can\'t validate) → 201', async () => {
    // A bare manually-added course with no course_tees rows can't be
    // validated; creation must keep working (free-text tee path preserved).
    const sessionId = await seedSession({ isOrganizer: true });
    await db.insert(courses).values({
      id: 'c-no-tees',
      name: 'Bare Course',
      clubName: 'Bare Club',
      createdAt: Date.now(),
      tenantId: TENANT_ID,
      contextId: 'library:guyan',
    });
    await db.insert(courseRevisions).values({
      id: 'cr-no-tees',
      courseId: 'c-no-tees',
      revisionNumber: 1,
      outTotal: 36,
      inTotal: 36,
      courseTotal: 72,
      verified: true,
      createdAt: Date.now(),
      tenantId: TENANT_ID,
      contextId: 'library:guyan',
    });
    const payload = validEventRequest('cr-no-tees');
    payload.rounds[0]!.tee_color = 'whatever';

    const res = await testApp.request('/api/admin/events', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
  });

  it('cross-tenant course_revision_id → 400 unknown_course_revision (existence is tenant-scoped)', async () => {
    // codex high finding: existence check must be tenant-scoped so a foreign-
    // tenant revision can't pass existence, have its tees filtered out, and
    // slip through the tee-less carve-out with an unvalidated cross-tenant id.
    const sessionId = await seedSession({ isOrganizer: true });
    await db.insert(courses).values({
      id: 'c-foreign',
      name: 'Foreign Course',
      clubName: 'Foreign Club',
      createdAt: Date.now(),
      tenantId: 'other-tenant',
      contextId: 'library:other-tenant',
    });
    await db.insert(courseRevisions).values({
      id: 'cr-foreign',
      courseId: 'c-foreign',
      revisionNumber: 1,
      outTotal: 36,
      inTotal: 36,
      courseTotal: 72,
      verified: true,
      createdAt: Date.now(),
      tenantId: 'other-tenant',
      contextId: 'library:other-tenant',
    });
    const payload = validEventRequest('cr-foreign');

    const res = await testApp.request('/api/admin/events', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; missing: string[] };
    expect(body.code).toBe('unknown_course_revision');
    expect(body.missing).toEqual(['cr-foreign']);
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

// =====================================================================
// T4-2: pairings
// =====================================================================

const { groupMembers, pairings, pairingMembers, rounds } = await import(
  '../db/schema/index.js'
);

interface PairingsSeedResult {
  eventId: string;
  eventRoundIds: string[];
  groupId: string;
  playerIds: string[];
  organizerSessionId: string;
  nonOrganizerSessionId: string;
}

/**
 * Seed an event with N rounds + 1 group with M players. Both organizer
 * and non-organizer sessions are created.
 */
async function seedEventForPairings(opts: {
  numRounds: number;
  numPlayers: number;
}): Promise<PairingsSeedResult> {
  const organizerSessionId = await seedSession({ isOrganizer: true });
  const nonOrganizerSessionId = await seedSession({ isOrganizer: false });
  // Get the organizer's playerId from the session.
  const organizerSessionRows = await db
    .select({ playerId: sessions.playerId })
    .from(sessions)
    .where(eq(sessions.sessionId, organizerSessionId));
  const organizerPlayerId = organizerSessionRows[0]!.playerId;

  await seedCourseRevision();
  const eventId = randomUUID();
  const now = Date.now();
  await db.insert(events).values({
    id: eventId,
    name: 'Pinehurst Test',
    startDate: 1_715_040_000_000,
    endDate: 1_715_300_000_000,
    timezone: VALID_TZ,
    organizerPlayerId,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: `event:${eventId}`,
  });

  const eventRoundIds: string[] = [];
  for (let i = 0; i < opts.numRounds; i++) {
    const erId = randomUUID();
    eventRoundIds.push(erId);
    await db.insert(eventRounds).values({
      id: erId,
      eventId,
      roundNumber: i + 1,
      roundDate: now,
      courseRevisionId: 'cr1',
      teeColor: 'blue',
      holesToPlay: 18,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: `event:${eventId}`,
    });
  }

  const groupId = randomUUID();
  await db.insert(groups).values({
    id: groupId,
    eventId,
    name: 'Pinehurst Crew',
    moneyVisibilityMode: 'open',
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: `event:${eventId}`,
  });

  const playerIds: string[] = [];
  for (let i = 0; i < opts.numPlayers; i++) {
    const pid = randomUUID();
    playerIds.push(pid);
    await db.insert(players).values({
      id: pid,
      isOrganizer: false,
      createdAt: now,
      name: `Player ${String.fromCharCode(65 + i)}`,
      tenantId: TENANT_ID,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    await db.insert(groupMembers).values({
      groupId,
      playerId: pid,
      tenantId: TENANT_ID,
      contextId: `event:${eventId}`,
    });
  }

  return {
    eventId,
    eventRoundIds,
    groupId,
    playerIds,
    organizerSessionId,
    nonOrganizerSessionId,
  };
}

describe('GET /api/admin/events/:eventId/pairings', () => {
  it('happy path: returns event + rounds + empty pairings + roster', async () => {
    const s = await seedEventForPairings({ numRounds: 4, numPlayers: 8 });
    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings`,
      { headers: { cookie: cookie(s.organizerSessionId) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      event: { id: string; name: string };
      rounds: Array<{ eventRoundId: string; pairings: unknown[] }>;
      roster: Array<{ playerId: string; name: string }>;
    };
    expect(body.event.id).toBe(s.eventId);
    expect(body.rounds).toHaveLength(4);
    for (const r of body.rounds) {
      expect(r.pairings).toEqual([]);
    }
    expect(body.roster).toHaveLength(8);
  });

  it('happy path with persisted pairings: members ASC by slot', async () => {
    const s = await seedEventForPairings({ numRounds: 1, numPlayers: 8 });
    const pairingId = randomUUID();
    await db.insert(pairings).values({
      id: pairingId,
      eventRoundId: s.eventRoundIds[0]!,
      foursomeNumber: 1,
      locked: false,
      createdAt: Date.now(),
      tenantId: TENANT_ID,
      contextId: `event:${s.eventId}`,
    });
    for (let i = 0; i < 4; i++) {
      await db.insert(pairingMembers).values({
        pairingId,
        playerId: s.playerIds[i]!,
        slotNumber: i + 1,
        tenantId: TENANT_ID,
        contextId: `event:${s.eventId}`,
      });
    }

    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings`,
      { headers: { cookie: cookie(s.organizerSessionId) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rounds: Array<{
        pairings: Array<{
          foursomeNumber: number;
          locked: boolean;
          members: Array<{ playerId: string; slotNumber: number }>;
        }>;
      }>;
    };
    expect(body.rounds[0]!.pairings).toHaveLength(1);
    expect(body.rounds[0]!.pairings[0]!.foursomeNumber).toBe(1);
    expect(body.rounds[0]!.pairings[0]!.members).toHaveLength(4);
    const slots = body.rounds[0]!.pairings[0]!.members.map((m) => m.slotNumber);
    expect(slots).toEqual([1, 2, 3, 4]);
  });

  it('404 event_not_found: unknown id', async () => {
    const s = await seedEventForPairings({ numRounds: 1, numPlayers: 1 });
    const res = await testApp.request(
      `/api/admin/events/${randomUUID()}/pairings`,
      { headers: { cookie: cookie(s.organizerSessionId) } },
    );
    expect(res.status).toBe(404);
  });

  it('cross-tenant: foreign-tenant event → 404', async () => {
    const s = await seedEventForPairings({ numRounds: 1, numPlayers: 1 });
    await db
      .update(events)
      .set({ tenantId: 'other-tenant' })
      .where(eq(events.id, s.eventId));
    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings`,
      { headers: { cookie: cookie(s.organizerSessionId) } },
    );
    expect(res.status).toBe(404);
  });

  it('401 anonymous', async () => {
    const s = await seedEventForPairings({ numRounds: 1, numPlayers: 1 });
    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings`,
    );
    expect(res.status).toBe(401);
  });

  it('403 non-organizer', async () => {
    const s = await seedEventForPairings({ numRounds: 1, numPlayers: 1 });
    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings`,
      { headers: { cookie: cookie(s.nonOrganizerSessionId) } },
    );
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/events/:eventId/pairings', () => {
  it('happy path: 1 round × 2 foursomes × 4 members → 2 pairings + 8 members', async () => {
    const s = await seedEventForPairings({ numRounds: 1, numPlayers: 8 });
    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings`,
      {
        method: 'POST',
        headers: {
          cookie: cookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          rounds: [
            {
              eventRoundId: s.eventRoundIds[0],
              pairings: [
                {
                  foursomeNumber: 1,
                  locked: false,
                  memberPlayerIds: s.playerIds.slice(0, 4),
                },
                {
                  foursomeNumber: 2,
                  locked: false,
                  memberPlayerIds: s.playerIds.slice(4, 8),
                },
              ],
            },
          ],
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pairingCount: number; memberCount: number };
    expect(body.pairingCount).toBe(2);
    expect(body.memberCount).toBe(8);

    const pRows = await db.select().from(pairings);
    expect(pRows).toHaveLength(2);
    const mRows = await db.select().from(pairingMembers);
    expect(mRows).toHaveLength(8);
  });

  it('upsert REPLACES: re-save with different members drops old', async () => {
    const s = await seedEventForPairings({ numRounds: 1, numPlayers: 8 });
    // First save.
    await testApp.request(`/api/admin/events/${s.eventId}/pairings`, {
      method: 'POST',
      headers: {
        cookie: cookie(s.organizerSessionId),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        rounds: [
          {
            eventRoundId: s.eventRoundIds[0],
            pairings: [
              {
                foursomeNumber: 1,
                locked: false,
                memberPlayerIds: s.playerIds.slice(0, 4),
              },
            ],
          },
        ],
      }),
    });
    expect((await db.select().from(pairings)).length).toBe(1);

    // Second save with different members.
    await testApp.request(`/api/admin/events/${s.eventId}/pairings`, {
      method: 'POST',
      headers: {
        cookie: cookie(s.organizerSessionId),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        rounds: [
          {
            eventRoundId: s.eventRoundIds[0],
            pairings: [
              {
                foursomeNumber: 1,
                locked: false,
                memberPlayerIds: s.playerIds.slice(4, 8),
              },
            ],
          },
        ],
      }),
    });
    const pRows = await db.select().from(pairings);
    expect(pRows).toHaveLength(1);
    const mRows = await db.select().from(pairingMembers);
    expect(mRows).toHaveLength(4);
    const newPlayerIds = new Set(mRows.map((m) => m.playerId));
    expect(newPlayerIds.has(s.playerIds[4]!)).toBe(true);
    expect(newPlayerIds.has(s.playerIds[0]!)).toBe(false);
  });

  it('422 player_in_multiple_pairings_per_round: same player in 2 foursomes', async () => {
    const s = await seedEventForPairings({ numRounds: 1, numPlayers: 8 });
    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings`,
      {
        method: 'POST',
        headers: {
          cookie: cookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          rounds: [
            {
              eventRoundId: s.eventRoundIds[0],
              pairings: [
                {
                  foursomeNumber: 1,
                  locked: false,
                  memberPlayerIds: [
                    s.playerIds[0]!,
                    s.playerIds[1]!,
                    s.playerIds[2]!,
                    s.playerIds[3]!,
                  ],
                },
                {
                  foursomeNumber: 2,
                  locked: false,
                  memberPlayerIds: [
                    s.playerIds[0]!, // duplicate across foursomes
                    s.playerIds[5]!,
                    s.playerIds[6]!,
                    s.playerIds[7]!,
                  ],
                },
              ],
            },
          ],
        }),
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      code: string;
      conflicts: Array<{
        playerId: string;
        eventRoundId: string;
        foursomeNumbers: number[];
      }>;
    };
    expect(body.code).toBe('player_in_multiple_pairings_per_round');
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0]!.playerId).toBe(s.playerIds[0]!);
    expect(body.conflicts[0]!.foursomeNumbers).toEqual([1, 2]);
  });

  it('400 duplicate_player_in_foursome: same playerId twice in one memberPlayerIds', async () => {
    const s = await seedEventForPairings({ numRounds: 1, numPlayers: 4 });
    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings`,
      {
        method: 'POST',
        headers: {
          cookie: cookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          rounds: [
            {
              eventRoundId: s.eventRoundIds[0],
              pairings: [
                {
                  foursomeNumber: 1,
                  locked: false,
                  memberPlayerIds: [
                    s.playerIds[0]!,
                    s.playerIds[0]!,
                    s.playerIds[1]!,
                    s.playerIds[2]!,
                  ],
                },
              ],
            },
          ],
        }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('duplicate_player_in_foursome');
  });

  it('400 unknown_event_round', async () => {
    const s = await seedEventForPairings({ numRounds: 1, numPlayers: 4 });
    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings`,
      {
        method: 'POST',
        headers: {
          cookie: cookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          rounds: [
            {
              eventRoundId: randomUUID(),
              pairings: [
                {
                  foursomeNumber: 1,
                  locked: false,
                  memberPlayerIds: s.playerIds.slice(0, 4),
                },
              ],
            },
          ],
        }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('unknown_event_round');
  });

  it('400 unknown_player', async () => {
    const s = await seedEventForPairings({ numRounds: 1, numPlayers: 4 });
    const outsiderId = randomUUID();
    await db.insert(players).values({
      id: outsiderId,
      isOrganizer: false,
      createdAt: Date.now(),
      tenantId: TENANT_ID,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings`,
      {
        method: 'POST',
        headers: {
          cookie: cookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          rounds: [
            {
              eventRoundId: s.eventRoundIds[0],
              pairings: [
                {
                  foursomeNumber: 1,
                  locked: false,
                  memberPlayerIds: [
                    s.playerIds[0]!,
                    s.playerIds[1]!,
                    s.playerIds[2]!,
                    outsiderId,
                  ],
                },
              ],
            },
          ],
        }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('unknown_player');
  });

  it('400 invalid_body: missing required field', async () => {
    const s = await seedEventForPairings({ numRounds: 1, numPlayers: 4 });
    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings`,
      {
        method: 'POST',
        headers: {
          cookie: cookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ rounds: [] }), // empty rounds
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });

  it('400 invalid_body: memberPlayerIds.length > 4', async () => {
    const s = await seedEventForPairings({ numRounds: 1, numPlayers: 5 });
    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings`,
      {
        method: 'POST',
        headers: {
          cookie: cookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          rounds: [
            {
              eventRoundId: s.eventRoundIds[0],
              pairings: [
                {
                  foursomeNumber: 1,
                  locked: false,
                  memberPlayerIds: s.playerIds.slice(0, 5), // 5 > foursomeSize 4
                },
              ],
            },
          ],
        }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });

  it('404 event_not_found on POST', async () => {
    const s = await seedEventForPairings({ numRounds: 1, numPlayers: 4 });
    const res = await testApp.request(
      `/api/admin/events/${randomUUID()}/pairings`,
      {
        method: 'POST',
        headers: {
          cookie: cookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          rounds: [
            {
              eventRoundId: s.eventRoundIds[0],
              pairings: [
                {
                  foursomeNumber: 1,
                  locked: false,
                  memberPlayerIds: s.playerIds.slice(0, 4),
                },
              ],
            },
          ],
        }),
      },
    );
    expect(res.status).toBe(404);
  });

  it('cross-tenant POST: foreign-tenant event → 404', async () => {
    const s = await seedEventForPairings({ numRounds: 1, numPlayers: 4 });
    await db
      .update(events)
      .set({ tenantId: 'other-tenant' })
      .where(eq(events.id, s.eventId));
    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings`,
      {
        method: 'POST',
        headers: {
          cookie: cookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          rounds: [
            {
              eventRoundId: s.eventRoundIds[0],
              pairings: [
                {
                  foursomeNumber: 1,
                  locked: false,
                  memberPlayerIds: s.playerIds.slice(0, 4),
                },
              ],
            },
          ],
        }),
      },
    );
    expect(res.status).toBe(404);
  });

  it('partial-payload upsert: preserves rounds NOT in body (party-codex round-1 High)', async () => {
    const s = await seedEventForPairings({ numRounds: 2, numPlayers: 8 });
    // Round 1: persist pairings via first POST.
    await testApp.request(`/api/admin/events/${s.eventId}/pairings`, {
      method: 'POST',
      headers: {
        cookie: cookie(s.organizerSessionId),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        rounds: [
          {
            eventRoundId: s.eventRoundIds[0],
            pairings: [
              {
                foursomeNumber: 1,
                locked: false,
                memberPlayerIds: s.playerIds.slice(0, 4),
              },
            ],
          },
        ],
      }),
    });
    // Round 2: persist pairings via second POST.
    await testApp.request(`/api/admin/events/${s.eventId}/pairings`, {
      method: 'POST',
      headers: {
        cookie: cookie(s.organizerSessionId),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        rounds: [
          {
            eventRoundId: s.eventRoundIds[1],
            pairings: [
              {
                foursomeNumber: 1,
                locked: false,
                memberPlayerIds: s.playerIds.slice(4, 8),
              },
            ],
          },
        ],
      }),
    });
    // Both rounds should now have pairings.
    const allPairings = await db.select().from(pairings);
    expect(allPairings).toHaveLength(2);
    // Round 1 pairings should still exist (not wiped by round-2 save).
    const round1 = allPairings.find(
      (p) => p.eventRoundId === s.eventRoundIds[0],
    );
    expect(round1).toBeDefined();
  });

  it('locked=true preserved across upsert', async () => {
    const s = await seedEventForPairings({ numRounds: 1, numPlayers: 4 });
    await testApp.request(`/api/admin/events/${s.eventId}/pairings`, {
      method: 'POST',
      headers: {
        cookie: cookie(s.organizerSessionId),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        rounds: [
          {
            eventRoundId: s.eventRoundIds[0],
            pairings: [
              {
                foursomeNumber: 1,
                locked: true,
                memberPlayerIds: s.playerIds.slice(0, 4),
              },
            ],
          },
        ],
      }),
    });
    const pRows = await db.select().from(pairings);
    expect(pRows).toHaveLength(1);
    expect(pRows[0]!.locked).toBe(true);
  });

  it('403 non-organizer on POST', async () => {
    const s = await seedEventForPairings({ numRounds: 1, numPlayers: 4 });
    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings`,
      {
        method: 'POST',
        headers: {
          cookie: cookie(s.nonOrganizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          rounds: [
            {
              eventRoundId: s.eventRoundIds[0],
              pairings: [],
            },
          ],
        }),
      },
    );
    expect(res.status).toBe(403);
  });

  it('per-player tee: object form persists tee_color, GET round-trips it', async () => {
    const s = await seedEventForPairings({ numRounds: 1, numPlayers: 4 });
    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings`,
      {
        method: 'POST',
        headers: {
          cookie: cookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          rounds: [
            {
              eventRoundId: s.eventRoundIds[0],
              pairings: [
                {
                  foursomeNumber: 1,
                  locked: false,
                  // First member has a forward-tee override; the rest are
                  // string-form (no override → falls back to round default).
                  memberPlayerIds: [
                    { playerId: s.playerIds[0], teeColor: 'forward' },
                    s.playerIds[1],
                    s.playerIds[2],
                    s.playerIds[3],
                  ],
                },
              ],
            },
          ],
        }),
      },
    );
    expect(res.status).toBe(200);

    // GET round-trip: tee_color should appear on the first member, null
    // on the rest.
    const getRes = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings`,
      { headers: { cookie: cookie(s.organizerSessionId) } },
    );
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as {
      rounds: Array<{
        pairings: Array<{
          members: Array<{ playerId: string; teeColor: string | null }>;
        }>;
      }>;
    };
    const members = body.rounds[0]!.pairings[0]!.members;
    const byId = new Map(members.map((m) => [m.playerId, m.teeColor]));
    expect(byId.get(s.playerIds[0]!)).toBe('forward');
    expect(byId.get(s.playerIds[1]!)).toBeNull();
    expect(byId.get(s.playerIds[2]!)).toBeNull();
    expect(byId.get(s.playerIds[3]!)).toBeNull();
  });

  it('per-player tee: invalid tee_color rejected with 400 unknown_tee_color', async () => {
    const s = await seedEventForPairings({ numRounds: 1, numPlayers: 4 });
    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings`,
      {
        method: 'POST',
        headers: {
          cookie: cookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          rounds: [
            {
              eventRoundId: s.eventRoundIds[0],
              pairings: [
                {
                  foursomeNumber: 1,
                  locked: false,
                  memberPlayerIds: [
                    { playerId: s.playerIds[0], teeColor: 'platinum' },
                    s.playerIds[1],
                    s.playerIds[2],
                    s.playerIds[3],
                  ],
                },
              ],
            },
          ],
        }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; teeColor: string };
    expect(body.code).toBe('unknown_tee_color');
    expect(body.teeColor).toBe('platinum');
  });
});

describe('POST /api/admin/events/:eventId/pairings/suggest', () => {
  it('happy path 8x4x4: returns grid + empty warnings', async () => {
    const s = await seedEventForPairings({ numRounds: 4, numPlayers: 8 });
    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings/suggest`,
      {
        method: 'POST',
        headers: {
          cookie: cookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          numRounds: 4,
          foursomesPerRound: 2,
          pins: [],
          lockedRounds: [],
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      grid: { rounds: unknown[] };
      warnings: string[];
    };
    expect(body.grid.rounds).toHaveLength(4);
    expect(body.warnings).toEqual([]);
  });

  it('honors lockedRounds: replaces engine output with persisted pairings', async () => {
    const s = await seedEventForPairings({ numRounds: 4, numPlayers: 8 });
    // Persist a custom pairing for round 1 that is NOT what the engine
    // would return.
    const pairingId = randomUUID();
    await db.insert(pairings).values({
      id: pairingId,
      eventRoundId: s.eventRoundIds[0]!,
      foursomeNumber: 1,
      locked: true,
      createdAt: Date.now(),
      tenantId: TENANT_ID,
      contextId: `event:${s.eventId}`,
    });
    // Use a custom slot order: players 7,6,5,4 in foursome 1.
    const customSlot = [7, 6, 5, 4];
    for (let i = 0; i < customSlot.length; i++) {
      await db.insert(pairingMembers).values({
        pairingId,
        playerId: s.playerIds[customSlot[i]!]!,
        slotNumber: i + 1,
        tenantId: TENANT_ID,
        contextId: `event:${s.eventId}`,
      });
    }
    // Also persist foursome 2 of round 1.
    const pairingId2 = randomUUID();
    await db.insert(pairings).values({
      id: pairingId2,
      eventRoundId: s.eventRoundIds[0]!,
      foursomeNumber: 2,
      locked: true,
      createdAt: Date.now(),
      tenantId: TENANT_ID,
      contextId: `event:${s.eventId}`,
    });
    for (let i = 0; i < 4; i++) {
      await db.insert(pairingMembers).values({
        pairingId: pairingId2,
        playerId: s.playerIds[i]!, // 0,1,2,3
        slotNumber: i + 1,
        tenantId: TENANT_ID,
        contextId: `event:${s.eventId}`,
      });
    }

    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings/suggest`,
      {
        method: 'POST',
        headers: {
          cookie: cookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          numRounds: 4,
          foursomesPerRound: 2,
          pins: [],
          lockedRounds: [1],
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      grid: {
        rounds: Array<{
          round: number;
          foursomes: Array<{ foursome: number; playerIds: string[] }>;
        }>;
      };
    };
    // Round 1 should match the persisted state (custom slot order).
    expect(body.grid.rounds[0]!.foursomes[0]!.playerIds).toEqual(
      customSlot.map((idx) => s.playerIds[idx]!),
    );
  });

  it('400 foursomes_per_round_mismatch: body value disagrees with roster-derived (party-codex round-1 High)', async () => {
    const s = await seedEventForPairings({ numRounds: 4, numPlayers: 8 });
    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings/suggest`,
      {
        method: 'POST',
        headers: {
          cookie: cookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          numRounds: 4,
          foursomesPerRound: 3, // 8 players / 4 size = 2, not 3
          pins: [],
          lockedRounds: [],
        }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('foursomes_per_round_mismatch');
  });

  it('lockedRounds with NO persisted pairings: warning emitted, engine output kept', async () => {
    const s = await seedEventForPairings({ numRounds: 4, numPlayers: 8 });
    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings/suggest`,
      {
        method: 'POST',
        headers: {
          cookie: cookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          numRounds: 4,
          foursomesPerRound: 2,
          pins: [],
          lockedRounds: [2], // round 2 has NO persisted pairings
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      grid: { rounds: unknown[] };
      warnings: string[];
    };
    expect(
      body.warnings.some((w) =>
        w.includes('locked round 2 has no persisted pairings'),
      ),
    ).toBe(true);
  });
});

describe('POST /api/admin/events/:eventId/pairings/copy', () => {
  async function seedRoundOneFoursome(
    s: PairingsSeedResult,
    opts: { roundIdx: number; locked: boolean },
  ): Promise<string> {
    const pid = randomUUID();
    await db.insert(pairings).values({
      id: pid,
      eventRoundId: s.eventRoundIds[opts.roundIdx]!,
      foursomeNumber: 1,
      locked: opts.locked,
      createdAt: Date.now(),
      tenantId: TENANT_ID,
      contextId: `event:${s.eventId}`,
    });
    for (let i = 0; i < 4; i++) {
      await db.insert(pairingMembers).values({
        pairingId: pid,
        playerId: s.playerIds[i]!,
        slotNumber: i + 1,
        tenantId: TENANT_ID,
        contextId: `event:${s.eventId}`,
      });
    }
    return pid;
  }

  it('copies a round\'s foursomes (same partnerships, same slots) to the other rounds, unlocked', async () => {
    const s = await seedEventForPairings({ numRounds: 2, numPlayers: 4 });
    await seedRoundOneFoursome(s, { roundIdx: 0, locked: true });

    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings/copy`,
      {
        method: 'POST',
        headers: { cookie: cookie(s.organizerSessionId), 'content-type': 'application/json' },
        body: JSON.stringify({ sourceEventRoundId: s.eventRoundIds[0] }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { copiedRounds: number; copiedPairings: number; skippedLocked: string[] };
    expect(body.copiedRounds).toBe(1);
    expect(body.copiedPairings).toBe(1);
    expect(body.skippedLocked).toEqual([]);

    // Round 2 now has the same foursome, same slot→player mapping, UNLOCKED.
    const r2 = await db.select().from(pairings).where(eq(pairings.eventRoundId, s.eventRoundIds[1]!));
    expect(r2).toHaveLength(1);
    expect(r2[0]!.locked).toBe(false);
    const r2members = (
      await db.select().from(pairingMembers).where(eq(pairingMembers.pairingId, r2[0]!.id))
    ).sort((a, b) => a.slotNumber - b.slotNumber);
    expect(r2members.map((m) => m.playerId)).toEqual(s.playerIds.slice(0, 4));
  });

  it('skips a target round that already has locked pairings', async () => {
    const s = await seedEventForPairings({ numRounds: 2, numPlayers: 4 });
    await seedRoundOneFoursome(s, { roundIdx: 0, locked: false }); // source
    const lockedP2 = await seedRoundOneFoursome(s, { roundIdx: 1, locked: true }); // target locked

    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings/copy`,
      {
        method: 'POST',
        headers: { cookie: cookie(s.organizerSessionId), 'content-type': 'application/json' },
        body: JSON.stringify({ sourceEventRoundId: s.eventRoundIds[0] }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { copiedRounds: number; skippedLocked: string[] };
    expect(body.copiedRounds).toBe(0);
    expect(body.skippedLocked).toEqual([s.eventRoundIds[1]]);

    // The locked round's original pairing is untouched.
    const r2 = await db.select().from(pairings).where(eq(pairings.eventRoundId, s.eventRoundIds[1]!));
    expect(r2).toHaveLength(1);
    expect(r2[0]!.id).toBe(lockedP2);
    expect(r2[0]!.locked).toBe(true);
  });

  it('never overwrites a STARTED round (rounds row exists), even if its pairings are unlocked', async () => {
    const s = await seedEventForPairings({ numRounds: 2, numPlayers: 4 });
    await seedRoundOneFoursome(s, { roundIdx: 0, locked: false }); // source
    // Target round 2: pairings present but UNLOCKED, yet a runtime round exists
    // (the round has been started → scores/money hang off it). Must be skipped.
    const targetPairingId = await seedRoundOneFoursome(s, { roundIdx: 1, locked: false });
    await db.insert(rounds).values({
      id: randomUUID(),
      eventId: s.eventId,
      eventRoundId: s.eventRoundIds[1]!,
      holesToPlay: 18,
      createdAt: Date.now(),
      tenantId: TENANT_ID,
      contextId: `event:${s.eventId}`,
    });

    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings/copy`,
      {
        method: 'POST',
        headers: { cookie: cookie(s.organizerSessionId), 'content-type': 'application/json' },
        body: JSON.stringify({ sourceEventRoundId: s.eventRoundIds[0] }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { copiedRounds: number; skippedLocked: string[] };
    expect(body.copiedRounds).toBe(0);
    expect(body.skippedLocked).toEqual([s.eventRoundIds[1]]);

    // The started round's pairing is untouched.
    const r2 = await db.select().from(pairings).where(eq(pairings.eventRoundId, s.eventRoundIds[1]!));
    expect(r2).toHaveLength(1);
    expect(r2[0]!.id).toBe(targetPairingId);
  });

  it('422 when the source round has no pairings', async () => {
    const s = await seedEventForPairings({ numRounds: 2, numPlayers: 4 });
    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/pairings/copy`,
      {
        method: 'POST',
        headers: { cookie: cookie(s.organizerSessionId), 'content-type': 'application/json' },
        body: JSON.stringify({ sourceEventRoundId: s.eventRoundIds[0] }),
      },
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('source_has_no_pairings');
  });
});
