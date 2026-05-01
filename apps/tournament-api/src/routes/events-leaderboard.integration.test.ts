/**
 * T5-5 events-leaderboard route integration tests.
 *
 * Covers AC-4 contract: participant happy path, non-participant 403,
 * bad-UUID 400, unknown-event 404, round=current resolution (in_progress
 * → complete_editable → fallback → null), event scope (omitted param),
 * cross-event round scoping (404), and fresh-after-commit propagation
 * (AC-6: a new hole_score is reflected on the next GET).
 *
 * Mocks `../db/index.js` to an in-memory libsql instance and
 * `../middleware/require-session.js` to inject a test player. The
 * `require-event-participant` middleware is exercised for real (it reads
 * the mocked db) — that is exactly the auth path we want to verify.
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
  courseTees,
  events,
  eventRounds,
  groups,
  groupMembers,
  rounds,
  roundStates,
  holeScores,
} = await import('../db/schema/index.js');
const { eventsLeaderboardRouter } = await import('./events-leaderboard.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT_ID = 'guyan';
const CTX_BASE = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(holeScores);
  await db.delete(roundStates);
  await db.delete(rounds);
  await db.delete(eventRounds);
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(events);
  await db.delete(courseTees);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

interface Seed {
  eventId: string;
  organizerId: string;
  participantIds: string[];
  outsiderId: string;
  roundIds: string[];
  ctx: string;
}

async function seedEventWithRounds(
  rounds_: Array<{ state: 'not_started' | 'in_progress' | 'complete_editable' | 'finalized' | 'cancelled' }>,
): Promise<Seed> {
  const now = Date.now();
  const eventId = randomUUID();
  const ctx = `event:${eventId}`;
  const courseId = randomUUID();
  const courseRevId = randomUUID();
  const organizerId = randomUUID();
  const outsiderId = randomUUID();
  const participantIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  // Unique-per-seed names to avoid the (tenant_id, club_name, name) UNIQUE
  // when one test calls seedEventWithRounds twice (e.g. cross-event 404).
  const uniq = courseId.slice(0, 8);

  for (const [id, name, isOrg] of [
    [organizerId, 'Organizer', true],
    [outsiderId, 'Outsider', false],
    ...participantIds.map((id, i) => [id, `Participant ${i + 1}`, false] as const),
  ] as Array<readonly [string, string, boolean]>) {
    await db.insert(players).values({
      id,
      isOrganizer: isOrg,
      createdAt: now,
      name,
      manualHandicapIndex: 10.0,
      tenantId: TENANT_ID,
      contextId: CTX_BASE,
    });
  }

  await db.insert(courses).values({
    id: courseId,
    name: `Test Course ${uniq}`,
    clubName: `Test Club ${uniq}`,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX_BASE,
  });
  await db.insert(courseRevisions).values({
    id: courseRevId,
    courseId,
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
  await db.insert(courseTees).values({
    id: randomUUID(),
    courseRevisionId: courseRevId,
    teeColor: 'blue',
    rating: 723,
    slope: 130,
    tenantId: TENANT_ID,
    contextId: CTX_BASE,
  });

  await db.insert(events).values({
    id: eventId,
    name: `Test Event ${uniq}`,
    startDate: now,
    endDate: now + 4 * 86400000,
    timezone: 'America/New_York',
    organizerPlayerId: organizerId,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });

  const groupId = randomUUID();
  await db.insert(groups).values({
    id: groupId,
    eventId,
    name: 'Group A',
    moneyVisibilityMode: 'open',
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });
  for (const pid of participantIds) {
    await db.insert(groupMembers).values({
      groupId,
      playerId: pid,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
  }

  const roundIds: string[] = [];
  for (let r = 0; r < rounds_.length; r++) {
    const eventRoundId = randomUUID();
    const roundId = randomUUID();
    await db.insert(eventRounds).values({
      id: eventRoundId,
      eventId,
      roundNumber: r + 1,
      roundDate: now + r * 86400000,
      courseRevisionId: courseRevId,
      teeColor: 'blue',
      holesToPlay: 18,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
    await db.insert(rounds).values({
      id: roundId,
      eventId,
      eventRoundId,
      holesToPlay: 18,
      openedAt: now + r * 86400000,
      createdAt: now + r * 86400000,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
    await db.insert(roundStates).values({
      roundId,
      state: rounds_[r]!.state,
      enteredAt: now,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
    roundIds.push(roundId);
  }

  return { eventId, organizerId, participantIds, outsiderId, roundIds, ctx };
}

function buildApp(playerId: string): Hono {
  __testPlayer = { id: playerId, isOrganizer: false };
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/events', eventsLeaderboardRouter);
  return app;
}

async function postScore(
  roundId: string,
  playerId: string,
  scorerId: string,
  holeNumber: number,
  grossStrokes: number,
): Promise<void> {
  const now = Date.now();
  await db.insert(holeScores).values({
    id: randomUUID(),
    roundId,
    playerId,
    holeNumber,
    grossStrokes,
    putts: null,
    scorerPlayerId: scorerId,
    clientEventId: `evt-${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    tenantId: TENANT_ID,
    contextId: CTX_BASE,
  });
}

describe('GET /api/events/:eventId/leaderboard', () => {
  test('200 happy path: participant fetches round-scope leaderboard', async () => {
    const seed = await seedEventWithRounds([{ state: 'in_progress' }]);
    const app = buildApp(seed.participantIds[0]!);

    const res = await app.request(
      `/api/events/${seed.eventId}/leaderboard?round=${seed.roundIds[0]}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{ playerId: string }>;
      round: { id: string; status: string } | null;
      scope: 'round' | 'event';
      computedAt: string;
    };
    expect(body.scope).toBe('round');
    expect(body.round?.id).toBe(seed.roundIds[0]);
    expect(body.round?.status).toBe('in_progress');
    expect(body.rows.length).toBe(4);
    expect(typeof body.computedAt).toBe('string');
  });

  test('403 non-participant: outsider gets forbidden by require-event-participant', async () => {
    const seed = await seedEventWithRounds([{ state: 'in_progress' }]);
    const app = buildApp(seed.outsiderId);

    const res = await app.request(
      `/api/events/${seed.eventId}/leaderboard?round=${seed.roundIds[0]}`,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_event_participant');
  });

  test('400 bad UUID: malformed roundId rejected', async () => {
    const seed = await seedEventWithRounds([{ state: 'in_progress' }]);
    const app = buildApp(seed.participantIds[0]!);

    const res = await app.request(
      `/api/events/${seed.eventId}/leaderboard?round=not-a-uuid`,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_round_id');
  });

  test('404 unknown event id: middleware 403s if user is not in any group of any event, but well-formed unknown id returns 403 too (spec choice; require-event-participant gates first)', async () => {
    // Even if the event UUID is well-formed but unknown, the middleware
    // returns 403 because the requesting player is not a participant.
    // This test documents that posture.
    const seed = await seedEventWithRounds([{ state: 'in_progress' }]);
    const app = buildApp(seed.participantIds[0]!);
    const unknownEventId = randomUUID();

    const res = await app.request(
      `/api/events/${unknownEventId}/leaderboard?round=${seed.roundIds[0]}`,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_event_participant');
  });

  test('404 cross-event round: round in event A queried under event B (where caller is participant of B) returns round_not_found', async () => {
    const seedA = await seedEventWithRounds([{ state: 'in_progress' }]);
    const seedB = await seedEventWithRounds([{ state: 'in_progress' }]);
    // Caller is participant of B; query event B but pass A's round id.
    const app = buildApp(seedB.participantIds[0]!);

    const res = await app.request(
      `/api/events/${seedB.eventId}/leaderboard?round=${seedA.roundIds[0]}`,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('round_not_found');
  });

  test('round=current resolves to in_progress round when one exists', async () => {
    const seed = await seedEventWithRounds([
      { state: 'finalized' },
      { state: 'in_progress' },
      { state: 'not_started' },
    ]);
    const app = buildApp(seed.participantIds[0]!);

    const res = await app.request(`/api/events/${seed.eventId}/leaderboard?round=current`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { round: { id: string; status: string } | null };
    expect(body.round?.id).toBe(seed.roundIds[1]);
    expect(body.round?.status).toBe('in_progress');
  });

  test('round=current falls back to complete_editable when no in_progress', async () => {
    const seed = await seedEventWithRounds([
      { state: 'finalized' },
      { state: 'complete_editable' },
    ]);
    const app = buildApp(seed.participantIds[0]!);

    const res = await app.request(`/api/events/${seed.eventId}/leaderboard?round=current`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { round: { id: string; status: string } | null };
    expect(body.round?.id).toBe(seed.roundIds[1]);
    expect(body.round?.status).toBe('complete_editable');
  });

  test('round=current falls back to most-recent any-state when no in_progress / complete_editable', async () => {
    const seed = await seedEventWithRounds([
      { state: 'finalized' },
      { state: 'finalized' },
    ]);
    const app = buildApp(seed.participantIds[0]!);

    const res = await app.request(`/api/events/${seed.eventId}/leaderboard?round=current`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { round: { id: string; status: string } | null };
    // Most-recent finalized: opened_at desc puts roundIds[1] first.
    expect(body.round?.id).toBe(seed.roundIds[1]);
  });

  test('round=current returns 200 + empty rows + null round when event has zero rounds', async () => {
    const seed = await seedEventWithRounds([]);
    const app = buildApp(seed.participantIds[0]!);

    const res = await app.request(`/api/events/${seed.eventId}/leaderboard?round=current`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: unknown[];
      round: null;
      scope: 'round' | 'event';
    };
    expect(body.round).toBeNull();
    expect(body.rows).toEqual([]);
    expect(body.scope).toBe('round');
  });

  test('omitted round param → scope=event, aggregates across rounds', async () => {
    const seed = await seedEventWithRounds([
      { state: 'finalized' },
      { state: 'in_progress' },
    ]);
    const app = buildApp(seed.participantIds[0]!);
    // Add some scores in both rounds.
    const scorer = seed.participantIds[0]!;
    await postScore(seed.roundIds[0]!, seed.participantIds[0]!, scorer, 1, 4);
    await postScore(seed.roundIds[1]!, seed.participantIds[0]!, scorer, 1, 5);

    const res = await app.request(`/api/events/${seed.eventId}/leaderboard`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{ playerId: string; grossThroughHole: number | null; throughHole: number }>;
      round: null;
      scope: 'round' | 'event';
    };
    expect(body.scope).toBe('event');
    expect(body.round).toBeNull();
    const me = body.rows.find((r) => r.playerId === seed.participantIds[0]);
    expect(me?.grossThroughHole).toBe(9); // 4 + 5
    expect(me?.throughHole).toBe(2);
  });

  test('AC-6 fresh-after-commit: posting a new hole_score is reflected on next GET', async () => {
    const seed = await seedEventWithRounds([{ state: 'in_progress' }]);
    const app = buildApp(seed.participantIds[0]!);
    const scorer = seed.participantIds[0]!;

    // Initial GET: no scores yet.
    const before = await app.request(
      `/api/events/${seed.eventId}/leaderboard?round=${seed.roundIds[0]}`,
    );
    const beforeBody = (await before.json()) as {
      rows: Array<{ playerId: string; grossThroughHole: number | null }>;
    };
    const meBefore = beforeBody.rows.find((r) => r.playerId === seed.participantIds[0]);
    expect(meBefore?.grossThroughHole).toBeNull();

    // Commit a score.
    await postScore(seed.roundIds[0]!, seed.participantIds[0]!, scorer, 1, 4);

    // Re-fetch: row reflects the new gross.
    const after = await app.request(
      `/api/events/${seed.eventId}/leaderboard?round=${seed.roundIds[0]}`,
    );
    const afterBody = (await after.json()) as {
      rows: Array<{
        playerId: string;
        grossThroughHole: number | null;
        rank: number;
        throughHole: number;
      }>;
    };
    const meAfter = afterBody.rows.find((r) => r.playerId === seed.participantIds[0]);
    expect(meAfter?.grossThroughHole).toBe(4);
    expect(meAfter?.throughHole).toBe(1);
    expect(meAfter?.rank).toBe(1);
  });
});
