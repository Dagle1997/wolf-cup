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
const { adminEventRoundsRouter } = await import('./admin-event-rounds.js');
const { eventsRouter } = await import('./events.js');
const { eventsLeaderboardRouter } = await import('./events-leaderboard.js');
const { scoresRouter } = await import('./scores.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');
const { rounds, roundStates, scorerAssignments, pairings, pairingMembers, holeScores, activity, auditLog } =
  await import('../db/schema/index.js');

const TENANT_ID = 'guyan';
const CTX = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  // Score commit emits an activity row + a state-transition audit row that
  // reference players (RESTRICT) — clear them before the player delete.
  // eslint-disable-next-line no-restricted-syntax -- test-cleanup truncate only; the T8-1 rule targets production emit paths, not beforeEach teardown
  await db.delete(activity);
  await db.delete(auditLog);
  await db.delete(holeScores);
  await db.delete(scorerAssignments);
  await db.delete(roundStates);
  await db.delete(rounds);
  await db.delete(pairingMembers);
  await db.delete(pairings);
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
  app.route('/api/admin', adminEventRoundsRouter);
  app.route('/api/events', eventsRouter);
  app.route('/api/events', eventsLeaderboardRouter);
  app.route('/api/rounds', scoresRouter);
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

// =====================================================================
// T13-2: Start round (instantiate scoring) — the previously-missing path.
// Builds through the real HTTP flow to LOCKED pairings, then exercises
// start-round + the score chain + leaderboard, plus validation + idempotency.
// =====================================================================

interface BuiltEvent {
  eventId: string;
  eventRoundId: string;
  organizerId: string;
  /** member ids per foursome, index 0 = foursome 1, etc. */
  foursomeMembers: string[][];
}

/** Build event -> roster -> N LOCKED foursomes (3 distinct manual players each). */
async function buildToLockedPairings(app: Hono, foursomeCount = 1, lockAll = true): Promise<BuiltEvent> {
  const { organizerId, courseRevId } = await seedPrereqs();
  const startDate = Date.UTC(2026, 4, 8, 4);
  asOrganizer(organizerId);
  const createRes = await postJson(app, '/api/admin/events', {
    name: 'Lifecycle', start_date: startDate, end_date: startDate,
    timezone: 'America/New_York',
    rounds: [{ round_date: startDate, course_revision_id: courseRevId, tee_color: 'blue', holes_to_play: 18 }],
  });
  expect(createRes.status).toBe(201);
  const { eventId } = (await createRes.json()) as { eventId: string };
  const groupId = (await db.select().from(groups).where(eq(groups.eventId, eventId)))[0]!.id;
  const eventRoundId = (await db.select().from(eventRounds).where(eq(eventRounds.eventId, eventId)))[0]!.id;

  const foursomeMembers: string[][] = [];
  const pairingsPayload: Array<{ foursomeNumber: number; locked: boolean; memberPlayerIds: string[] }> = [];
  let added = 0;
  for (let f = 1; f <= foursomeCount; f++) {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const name = `P${added++}`;
      const r = await postJson(app, `/api/admin/groups/${groupId}/members`, { mode: 'manual', name });
      expect([200, 201]).toContain(r.status);
    }
    // collect the most recent 3 member ids by name order is unreliable; pull all then slice per foursome below.
    void ids;
  }
  // Pull all members, assign 3 per foursome deterministically by created order.
  const allMembers = await db
    .select({ playerId: groupMembers.playerId, name: players.name })
    .from(groupMembers)
    .innerJoin(players, eq(groupMembers.playerId, players.id))
    .where(eq(groupMembers.groupId, groupId));
  const ordered = allMembers
    .slice()
    .sort((a, b) => Number((a.name ?? '').slice(1)) - Number((b.name ?? '').slice(1)))
    .map((m) => m.playerId);
  for (let f = 1; f <= foursomeCount; f++) {
    const slice = ordered.slice((f - 1) * 3, f * 3);
    foursomeMembers.push(slice);
    pairingsPayload.push({ foursomeNumber: f, locked: lockAll, memberPlayerIds: slice });
  }
  const pairRes = await postJson(app, `/api/admin/events/${eventId}/pairings`, {
    rounds: [{ eventRoundId, pairings: pairingsPayload }],
  });
  expect(pairRes.status).toBeLessThan(300);

  return { eventId, eventRoundId, organizerId, foursomeMembers };
}

function startBody(scorers: Array<{ foursomeNumber: number; scorerPlayerId: string }>) {
  return { scorers };
}

describe('E2E: T13-2 start round + score lifecycle', () => {
  test('full lifecycle: start -> score -> leaderboard reflects the score (the gap closes)', async () => {
    const app = buildApp();
    const { eventId, eventRoundId, organizerId, foursomeMembers } = await buildToLockedPairings(app, 1);

    // Start: organizer is the designated scorer for foursome 1.
    asOrganizer(organizerId);
    const startRes = await postJson(app, `/api/admin/event-rounds/${eventRoundId}/start`,
      startBody([{ foursomeNumber: 1, scorerPlayerId: organizerId }]));
    expect(startRes.status).toBe(201);
    const { roundId } = (await startRes.json()) as { roundId: string };
    expect(roundId).toBeTruthy();

    // AC-1: all three row types created.
    expect((await db.select().from(rounds).where(eq(rounds.id, roundId))).length).toBe(1);
    expect((await db.select().from(roundStates).where(eq(roundStates.roundId, roundId))).length).toBe(1);
    expect((await db.select().from(scorerAssignments).where(eq(scorerAssignments.roundId, roundId))).length).toBe(1);

    // AC-2: scoring is now REACHABLE — organizer (the scorer) posts a gross.
    const scoredPlayer = foursomeMembers[0]![0]!;
    const scoreRes = await postJson(app, `/api/rounds/${roundId}/holes/1/scores`,
      { playerId: scoredPlayer, grossStrokes: 4, clientEventId: 'evt-1' });
    expect(scoreRes.status).toBeLessThan(300);
    const scored = await db.select().from(holeScores)
      .where(and(eq(holeScores.roundId, roundId), eq(holeScores.playerId, scoredPlayer)));
    expect(scored.length).toBe(1);

    // AC-6: leaderboard reflects the live score.
    asPlayer(scoredPlayer);
    const lbRes = await app.request(`/api/events/${eventId}/leaderboard`);
    expect(lbRes.status).toBe(200);
    const lb = (await lbRes.json()) as { rows: Array<{ playerId: string; throughHole: number }> };
    const row = lb.rows.find((r) => r.playerId === scoredPlayer);
    expect(row).toBeTruthy();
    expect(row!.throughHole).toBeGreaterThanOrEqual(1);
  });

  test('idempotent: starting twice returns the same round, one row (UNIQUE-recover branch)', async () => {
    const app = buildApp();
    const { eventRoundId, organizerId } = await buildToLockedPairings(app, 1);
    asOrganizer(organizerId);
    const body = startBody([{ foursomeNumber: 1, scorerPlayerId: organizerId }]);
    const first = await postJson(app, `/api/admin/event-rounds/${eventRoundId}/start`, body);
    expect(first.status).toBe(201);
    const { roundId } = (await first.json()) as { roundId: string };
    const second = await postJson(app, `/api/admin/event-rounds/${eventRoundId}/start`, body);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { roundId: string; alreadyStarted: boolean };
    expect(secondBody.roundId).toBe(roundId);
    expect(secondBody.alreadyStarted).toBe(true);
    expect((await db.select().from(rounds).where(eq(rounds.eventRoundId, eventRoundId))).length).toBe(1);
    expect((await db.select().from(scorerAssignments).where(eq(scorerAssignments.roundId, roundId))).length).toBe(1);
  });

  test('403 for a non-organizer', async () => {
    const app = buildApp();
    const { eventRoundId, foursomeMembers } = await buildToLockedPairings(app, 1);
    asPlayer(foursomeMembers[0]![0]!); // a rostered, non-organizer player
    const res = await postJson(app, `/api/admin/event-rounds/${eventRoundId}/start`,
      startBody([{ foursomeNumber: 1, scorerPlayerId: foursomeMembers[0]![0]! }]));
    expect(res.status).toBe(403);
  });

  test('404 for an unknown event_round', async () => {
    const app = buildApp();
    const { organizerId } = await buildToLockedPairings(app, 1);
    asOrganizer(organizerId);
    const res = await postJson(app, `/api/admin/event-rounds/${randomUUID()}/start`,
      startBody([{ foursomeNumber: 1, scorerPlayerId: organizerId }]));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('event_round_not_found');
  });

  test('422 pairings_not_ready when pairings are unlocked', async () => {
    const app = buildApp();
    const { eventRoundId, organizerId } = await buildToLockedPairings(app, 1, /* lockAll */ false);
    asOrganizer(organizerId);
    const res = await postJson(app, `/api/admin/event-rounds/${eventRoundId}/start`,
      startBody([{ foursomeNumber: 1, scorerPlayerId: organizerId }]));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('pairings_not_ready');
  });

  test('400 invalid_scorer when the designated scorer is neither a foursome member nor the organizer', async () => {
    const app = buildApp();
    const { eventRoundId, organizerId } = await buildToLockedPairings(app, 1);
    asOrganizer(organizerId);
    const res = await postJson(app, `/api/admin/event-rounds/${eventRoundId}/start`,
      startBody([{ foursomeNumber: 1, scorerPlayerId: randomUUID() }]));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_scorer');
  });

  test('400 duplicate_foursome', async () => {
    const app = buildApp();
    const { eventRoundId, organizerId } = await buildToLockedPairings(app, 1);
    asOrganizer(organizerId);
    const res = await postJson(app, `/api/admin/event-rounds/${eventRoundId}/start`,
      startBody([
        { foursomeNumber: 1, scorerPlayerId: organizerId },
        { foursomeNumber: 1, scorerPlayerId: organizerId },
      ]));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('duplicate_foursome');
  });

  test('400 unknown_foursome', async () => {
    const app = buildApp();
    const { eventRoundId, organizerId } = await buildToLockedPairings(app, 1);
    asOrganizer(organizerId);
    const res = await postJson(app, `/api/admin/event-rounds/${eventRoundId}/start`,
      startBody([{ foursomeNumber: 99, scorerPlayerId: organizerId }]));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('unknown_foursome');
  });

  test('400 missing_scorer_for_foursome when a locked foursome has no entry', async () => {
    const app = buildApp();
    const { eventRoundId, organizerId } = await buildToLockedPairings(app, 2); // two foursomes
    asOrganizer(organizerId);
    // Supply a scorer for foursome 1 only — foursome 2 is left uncovered.
    const res = await postJson(app, `/api/admin/event-rounds/${eventRoundId}/start`,
      startBody([{ foursomeNumber: 1, scorerPlayerId: organizerId }]));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('missing_scorer_for_foursome');
  });

  test('400 invalid_body on a strict-violating body', async () => {
    const app = buildApp();
    const { eventRoundId, organizerId } = await buildToLockedPairings(app, 1);
    asOrganizer(organizerId);
    const res = await postJson(app, `/api/admin/event-rounds/${eventRoundId}/start`, { bogus: true });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_body');
  });

  test('422 pairings_not_ready when no pairings exist for the event_round', async () => {
    const app = buildApp();
    const { organizerId, courseRevId } = await seedPrereqs();
    const startDate = Date.UTC(2026, 4, 8, 4);
    asOrganizer(organizerId);
    const createRes = await postJson(app, '/api/admin/events', {
      name: 'NoPairings', start_date: startDate, end_date: startDate, timezone: 'America/New_York',
      rounds: [{ round_date: startDate, course_revision_id: courseRevId, tee_color: 'blue', holes_to_play: 18 }],
    });
    const { eventId } = (await createRes.json()) as { eventId: string };
    const eventRoundId = (await db.select().from(eventRounds).where(eq(eventRounds.eventId, eventId)))[0]!.id;
    const res = await postJson(app, `/api/admin/event-rounds/${eventRoundId}/start`,
      startBody([{ foursomeNumber: 1, scorerPlayerId: organizerId }]));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('pairings_not_ready');
  });
});
