/**
 * Internal end-to-end smoke for the ORGANIZER ONBOARDING / ROSTER-BUILD flow.
 *
 * Unlike the per-route integration tests (which seed events/groups/members via
 * direct DB inserts), this drives the REAL admin HTTP endpoints in sequence —
 * the exact "how do I onboard 16 people" path that has never run in prod
 * (Pinehurst shipped with 0 group_members). It chains:
 *   1. POST /api/admin/events                 (create event — organizer)
 *   2. (verify create side-effects: 1 group "<name> Crew", event_rounds, invite)
 *   3. POST /api/admin/groups/:id/members ×N  (add accountless players: manual + GHIN modes)
 *   4. GET  /api/admin/groups/:id             (roster read-back)
 *   5. GET  /api/events/:eventId              (participant view + T13-1 organizer exemption + outsider 403)
 *   6. GET  /api/events/:eventId/leaderboard  (empty-event edge: members, no rounds/scores)
 *
 * Auth: requireSession is mocked (switchable __testPlayer) per the established
 * integration-test pattern; requireOrganizer + requireEventParticipant run for
 * real against the in-memory DB. GHIN add-member mode does NOT hit the network
 * (resolveOrInsertGhinPlayer only SELECT/INSERTs by the provided ghin+name).
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
  requireSession: async (c: import('hono').Context, next: () => Promise<void>) => {
    if (!__testPlayer) {
      return c.json({ error: 'unauthorized', code: 'no_test_player' }, 401);
    }
    c.set('player', __testPlayer);
    c.set('session', { sessionId: 'test-session', playerId: __testPlayer.id });
    await next();
  },
}));

const { db } = await import('../db/index.js');
const { players, courses, courseRevisions, events, eventRounds, groups, groupMembers, invites } =
  await import('../db/schema/index.js');
const { adminEventsRouter } = await import('./admin-events.js');
const { adminGroupsRouter } = await import('./admin-groups.js');
const { eventsRouter } = await import('./events.js');
const { eventsLeaderboardRouter } = await import('./events-leaderboard.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT_ID = 'guyan';
const CTX = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(invites);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
  __testPlayer = null;
});

function buildApp(): Hono {
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/admin', adminEventsRouter);
  app.route('/api/admin', adminGroupsRouter);
  app.route('/api/events', eventsRouter);
  app.route('/api/events', eventsLeaderboardRouter);
  return app;
}

function asOrganizer(id: string) {
  __testPlayer = { id, isOrganizer: true };
}
function asPlayer(id: string) {
  __testPlayer = { id, isOrganizer: false };
}

async function postJson(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Seed the prerequisite organizer player + course revision (NOT the path under test). */
async function seedPrereqs(): Promise<{ organizerId: string; courseRevId: string }> {
  const now = Date.now();
  const organizerId = randomUUID();
  await db.insert(players).values({
    id: organizerId, isOrganizer: true, createdAt: now, name: 'Organizer',
    tenantId: TENANT_ID, contextId: CTX,
  });
  const courseId = randomUUID();
  const courseRevId = randomUUID();
  await db.insert(courses).values({
    id: courseId, name: 'Pinehurst No. 2', clubName: 'Pinehurst Resort',
    createdAt: now, tenantId: TENANT_ID, contextId: CTX,
  });
  await db.insert(courseRevisions).values({
    id: courseRevId, courseId, revisionNumber: 1, sourceUrl: null, extractionDate: null,
    verified: true, outTotal: 36, inTotal: 36, courseTotal: 72,
    createdAt: now, tenantId: TENANT_ID, contextId: CTX,
  });
  return { organizerId, courseRevId };
}

describe('E2E: organizer onboarding / roster build (real HTTP build flow)', () => {
  test('create event → add accountless players (manual + GHIN) → roster → views → empty leaderboard', async () => {
    const app = buildApp();
    const { organizerId, courseRevId } = await seedPrereqs();
    const startDate = Date.UTC(2026, 4, 8, 4);
    const endDate = Date.UTC(2026, 4, 10, 4);

    // --- 1. Create event (organizer) ---
    asOrganizer(organizerId);
    const createRes = await postJson(app, '/api/admin/events', {
      name: '71 at Pinehurst',
      start_date: startDate,
      end_date: endDate,
      timezone: 'America/New_York',
      rounds: [
        { round_date: startDate, course_revision_id: courseRevId, tee_color: 'blue', holes_to_play: 18 },
      ],
    });
    expect(createRes.status).toBe(201);
    const { eventId } = (await createRes.json()) as { eventId: string };
    expect(eventId).toBeTruthy();

    // --- 2. Verify create side-effects (the group is what onboarding needs) ---
    const grpRows = await db.select().from(groups).where(eq(groups.eventId, eventId));
    expect(grpRows.length).toBe(1);
    expect(grpRows[0]!.name).toBe('71 at Pinehurst Crew');
    const groupId = grpRows[0]!.id;
    const erRows = await db.select().from(eventRounds).where(eq(eventRounds.eventId, eventId));
    expect(erRows.length).toBe(1);
    const invRows = await db.select().from(invites).where(eq(invites.eventId, eventId));
    expect(invRows.length).toBe(1);

    // --- 3. Add 5 accountless players: 3 manual + 2 GHIN (no network) ---
    const manualAdds = [
      { mode: 'manual', name: 'Matt Jaquint', manualHandicapIndex: 8.4 },
      { mode: 'manual', name: 'Chris McNeely', manualHandicapIndex: 12.1 },
      { mode: 'manual', name: 'Ronnie', manualHandicapIndex: 2.0 },
    ];
    const ghinAdds = [
      { mode: 'ghin', ghin: 1234567, firstName: 'Ben', lastName: 'McGinnis' },
      { mode: 'ghin', ghin: 7654321, firstName: 'Harvey', lastName: 'Smith' },
    ];
    for (const add of [...manualAdds, ...ghinAdds]) {
      const res = await postJson(app, `/api/admin/groups/${groupId}/members`, add);
      expect([200, 201]).toContain(res.status);
    }

    // --- 4. Roster read-back ---
    const groupRes = await app.request(`/api/admin/groups/${groupId}`);
    expect(groupRes.status).toBe(200);
    const groupBody = (await groupRes.json()) as {
      members: Array<{ playerId: string; name: string | null; ghin: string | null; manualHandicapIndex: number | null }>;
    };
    expect(groupBody.members.length).toBe(5);
    const matt = groupBody.members.find((m) => m.name === 'Matt Jaquint');
    expect(matt?.manualHandicapIndex).toBe(8.4);
    const ben = groupBody.members.find((m) => m.name === 'Ben McGinnis');
    expect(ben?.ghin).toBe('1234567');
    // None of the added players has an account/session — confirm via no oauth dependency:
    expect(groupBody.members.every((m) => m.playerId)).toBe(true);

    // --- 5a. A rostered (accountless) player can be viewed as a participant ---
    asPlayer(matt!.playerId);
    const memberView = await app.request(`/api/events/${eventId}`);
    expect(memberView.status).toBe(200);

    // --- 5b. The organizer (NOT a group member) can view (T13-1 exemption) ---
    asOrganizer(organizerId);
    const orgView = await app.request(`/api/events/${eventId}`);
    expect(orgView.status).toBe(200);

    // --- 5c. An outsider (non-member, non-organizer) is blocked ---
    const outsiderId = randomUUID();
    await db.insert(players).values({
      id: outsiderId, isOrganizer: false, createdAt: Date.now(), name: 'Outsider',
      tenantId: TENANT_ID, contextId: CTX,
    });
    asPlayer(outsiderId);
    const outsiderView = await app.request(`/api/events/${eventId}`);
    expect(outsiderView.status).toBe(403);

    // --- 6. Leaderboard on a freshly-built event (members, no rounds/scores) ---
    //     This is the empty-event edge (Pinehurst's exact state). Must not 500.
    asPlayer(matt!.playerId);
    // Empty-event leaderboard (members, no rounds/scores — Pinehurst's exact
    // state) returns 200 with the roster listed and null scores, NOT an error.
    const lbRes = await app.request(`/api/events/${eventId}/leaderboard`);
    expect(lbRes.status).toBe(200);
    const lb = (await lbRes.json()) as { rows: Array<{ playerName: string; grossThroughHole: number | null }> };
    expect(lb.rows.length).toBe(5);
    expect(lb.rows.every((r) => r.grossThroughHole === null)).toBe(true);
  });

  test('duplicate GHIN add resolves to the same player (no dup row)', async () => {
    const app = buildApp();
    const { organizerId, courseRevId } = await seedPrereqs();
    const startDate = Date.UTC(2026, 4, 8, 4);
    asOrganizer(organizerId);
    const createRes = await postJson(app, '/api/admin/events', {
      name: 'Dup Test', start_date: startDate, end_date: startDate,
      timezone: 'America/New_York',
      rounds: [{ round_date: startDate, course_revision_id: courseRevId, tee_color: 'blue', holes_to_play: 18 }],
    });
    const { eventId } = (await createRes.json()) as { eventId: string };
    const groupId = (await db.select().from(groups).where(eq(groups.eventId, eventId)))[0]!.id;

    const add = { mode: 'ghin', ghin: 9999999, firstName: 'Solo', lastName: 'Player' };
    const first = await postJson(app, `/api/admin/groups/${groupId}/members`, add);
    expect([200, 201]).toContain(first.status);
    // Adding the SAME ghin again to the SAME group should not create a 2nd player
    // and should be rejected as already-in-group (or idempotent), never a 500.
    const second = await postJson(app, `/api/admin/groups/${groupId}/members`, add);
    expect(second.status).toBeLessThan(500);

    const ghinPlayers = await db.select().from(players).where(eq(players.ghin, '9999999'));
    expect(ghinPlayers.length).toBe(1); // exactly one player row for that GHIN
  });
});
