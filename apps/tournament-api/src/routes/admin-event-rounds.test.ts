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
  events,
  eventRounds,
  groups,
  groupMembers,
  courses,
  courseRevisions,
  courseTees,
  courseHoles,
  subGames,
  subGameParticipants,
  sessions,
} = await import('../db/schema/index.js');
const { adminEventRoundsRouter } = await import('./admin-event-rounds.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');
const { requireSession } = await import('../middleware/require-session.js');

const TENANT_ID = 'guyan';
const CONTEXT_LEAGUE = 'league:guyan-wolf-cup-friday';

// Build a test app with the same mount pattern as production: requestId
// middleware first, then mount adminEventRoundsRouter at /api/admin.
const testApp = new Hono();
testApp.use('*', requestIdMiddleware);
testApp.route('/api/admin', adminEventRoundsRouter);

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(subGameParticipants);
  await db.delete(subGames);
  await db.delete(sessions);
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(courseHoles);
  await db.delete(courseTees);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

interface SeedResult {
  organizerId: string;
  organizerSessionId: string;
  nonOrganizerId: string;
  nonOrganizerSessionId: string;
  eventId: string;
  eventRoundId: string;
  groupId: string;
  playerIds: string[];
}

/**
 * Seed an organizer + non-organizer (each with a valid session), an event,
 * one event_round, one group, and N players (members of the group).
 */
async function seed(opts: { playerCount: number }): Promise<SeedResult> {
  const now = Date.now();
  const organizerId = randomUUID();
  const nonOrganizerId = randomUUID();

  await db.insert(players).values({
    id: organizerId,
    isOrganizer: true,
    createdAt: now,
    name: 'Organizer',
    tenantId: TENANT_ID,
    contextId: CONTEXT_LEAGUE,
  });
  await db.insert(players).values({
    id: nonOrganizerId,
    isOrganizer: false,
    createdAt: now,
    name: 'Non-Organizer',
    tenantId: TENANT_ID,
    contextId: CONTEXT_LEAGUE,
  });

  const organizerSessionId = randomUUID().replace(/-/g, '') + 'a'.repeat(8);
  const nonOrganizerSessionId = randomUUID().replace(/-/g, '') + 'b'.repeat(8);
  await db.insert(sessions).values({
    sessionId: organizerSessionId,
    playerId: organizerId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    deviceInfo: null,
    contextId: CONTEXT_LEAGUE,
  });
  await db.insert(sessions).values({
    sessionId: nonOrganizerSessionId,
    playerId: nonOrganizerId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    deviceInfo: null,
    contextId: CONTEXT_LEAGUE,
  });

  // Need a course + revision for the event_round FK.
  const courseId = randomUUID();
  await db.insert(courses).values({
    id: courseId,
    name: 'Test Course',
    clubName: 'Test Club',
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: 'library:guyan',
  });
  const courseRevisionId = randomUUID();
  await db.insert(courseRevisions).values({
    id: courseRevisionId,
    courseId,
    revisionNumber: 1,
    outTotal: 36,
    inTotal: 35,
    courseTotal: 71,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: 'library:guyan',
  });

  const eventId = randomUUID();
  await db.insert(events).values({
    id: eventId,
    name: 'Test Event',
    startDate: 1_715_040_000_000,
    endDate: 1_715_300_000_000,
    timezone: 'America/New_York',
    organizerPlayerId: organizerId,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: `event:${eventId}`,
  });

  const eventRoundId = randomUUID();
  await db.insert(eventRounds).values({
    id: eventRoundId,
    eventId,
    roundNumber: 1,
    roundDate: 1_715_040_000_000,
    courseRevisionId,
    teeColor: 'blue',
    holesToPlay: 18,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: `event:${eventId}`,
  });

  const groupId = randomUUID();
  await db.insert(groups).values({
    id: groupId,
    eventId,
    name: 'Test Group',
    moneyVisibilityMode: 'open',
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: `event:${eventId}`,
  });

  const playerIds: string[] = [];
  for (let i = 0; i < opts.playerCount; i++) {
    const id = randomUUID();
    playerIds.push(id);
    await db.insert(players).values({
      id,
      isOrganizer: false,
      createdAt: now,
      name: `Player ${String.fromCharCode(65 + i)}`,
      tenantId: TENANT_ID,
      contextId: CONTEXT_LEAGUE,
    });
    await db.insert(groupMembers).values({
      groupId,
      playerId: id,
      tenantId: TENANT_ID,
      contextId: `event:${eventId}`,
    });
  }

  return {
    organizerId,
    organizerSessionId,
    nonOrganizerId,
    nonOrganizerSessionId,
    eventId,
    eventRoundId,
    groupId,
    playerIds,
  };
}

function organizerCookie(sessionId: string): string {
  return `tournament_session=${sessionId}`;
}

describe('GET /api/admin/event-rounds/:eventRoundId/sub-games', () => {
  it('happy path: returns event_round + event + roster + empty sub-games', async () => {
    const s = await seed({ playerCount: 3 });
    const res = await testApp.request(
      `/api/admin/event-rounds/${s.eventRoundId}/sub-games`,
      { headers: { cookie: organizerCookie(s.organizerSessionId) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      eventRound: { id: string; eventId: string };
      event: { id: string; name: string };
      roster: Array<{ playerId: string; name: string }>;
      subGames: unknown[];
    };
    expect(body.eventRound.id).toBe(s.eventRoundId);
    expect(body.event.id).toBe(s.eventId);
    expect(body.roster).toHaveLength(3);
    expect(body.subGames).toHaveLength(0);
  });

  it('happy path with existing config: returns the saved sub-game + participants', async () => {
    const s = await seed({ playerCount: 3 });
    // Manually insert a sub_game + 2 participants.
    const sgId = randomUUID();
    await db.insert(subGames).values({
      id: sgId,
      eventRoundId: s.eventRoundId,
      type: 'skins',
      configJson: '{}',
      buyInPerParticipant: 500,
      createdAt: Date.now(),
      tenantId: TENANT_ID,
      contextId: `event:${s.eventId}`,
    });
    await db.insert(subGameParticipants).values({
      subGameId: sgId,
      playerId: s.playerIds[0]!,
      optedInAt: Date.now(),
      tenantId: TENANT_ID,
      contextId: `event:${s.eventId}`,
    });
    await db.insert(subGameParticipants).values({
      subGameId: sgId,
      playerId: s.playerIds[1]!,
      optedInAt: Date.now(),
      tenantId: TENANT_ID,
      contextId: `event:${s.eventId}`,
    });

    const res = await testApp.request(
      `/api/admin/event-rounds/${s.eventRoundId}/sub-games`,
      { headers: { cookie: organizerCookie(s.organizerSessionId) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      subGames: Array<{
        type: string;
        buyInPerParticipant: number;
        participantPlayerIds: string[];
      }>;
    };
    expect(body.subGames).toHaveLength(1);
    expect(body.subGames[0]!.type).toBe('skins');
    expect(body.subGames[0]!.buyInPerParticipant).toBe(500);
    expect(body.subGames[0]!.participantPlayerIds).toHaveLength(2);
  });

  it('404 event_round_not_found: unknown id', async () => {
    const s = await seed({ playerCount: 1 });
    const res = await testApp.request(
      `/api/admin/event-rounds/${randomUUID()}/sub-games`,
      { headers: { cookie: organizerCookie(s.organizerSessionId) } },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('event_round_not_found');
  });

  it('404 cross-tenant: foreign-tenant event_round → not found', async () => {
    const s = await seed({ playerCount: 1 });
    // Re-tenant the event_round to 'other-tenant'.
    await db
      .update(eventRounds)
      .set({ tenantId: 'other-tenant' })
      .where(eq(eventRounds.id, s.eventRoundId));

    const res = await testApp.request(
      `/api/admin/event-rounds/${s.eventRoundId}/sub-games`,
      { headers: { cookie: organizerCookie(s.organizerSessionId) } },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('event_round_not_found');
  });

  it('401 anonymous → session_missing', async () => {
    const s = await seed({ playerCount: 1 });
    const res = await testApp.request(
      `/api/admin/event-rounds/${s.eventRoundId}/sub-games`,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('session_missing');
  });

  it('403 non-organizer → not_organizer', async () => {
    const s = await seed({ playerCount: 1 });
    const res = await testApp.request(
      `/api/admin/event-rounds/${s.eventRoundId}/sub-games`,
      { headers: { cookie: organizerCookie(s.nonOrganizerSessionId) } },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_organizer');
  });
});

describe('POST /api/admin/event-rounds/:eventRoundId/sub-games', () => {
  it('happy path: 1 skins entry with 2 participants → creates 1 sub_games + 2 sub_game_participants rows', async () => {
    const s = await seed({ playerCount: 3 });
    const res = await testApp.request(
      `/api/admin/event-rounds/${s.eventRoundId}/sub-games`,
      {
        method: 'POST',
        headers: {
          cookie: organizerCookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          subGames: [
            {
              type: 'skins',
              buyInPerParticipant: 500,
              participantPlayerIds: [s.playerIds[0]!, s.playerIds[1]!],
            },
          ],
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subGameCount: number; participantCount: number };
    expect(body.subGameCount).toBe(1);
    expect(body.participantCount).toBe(2);

    const sgRows = await db.select().from(subGames);
    expect(sgRows).toHaveLength(1);
    expect(sgRows[0]!.type).toBe('skins');
    expect(sgRows[0]!.buyInPerParticipant).toBe(500);
    expect(sgRows[0]!.contextId).toBe(`event:${s.eventId}`);

    const partRows = await db.select().from(subGameParticipants);
    expect(partRows).toHaveLength(2);
  });

  it('upsert REPLACES (not accumulates): re-save with different participants drops old', async () => {
    const s = await seed({ playerCount: 4 });
    // First save: players 0+1
    await testApp.request(`/api/admin/event-rounds/${s.eventRoundId}/sub-games`, {
      method: 'POST',
      headers: {
        cookie: organizerCookie(s.organizerSessionId),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        subGames: [
          {
            type: 'skins',
            buyInPerParticipant: 500,
            participantPlayerIds: [s.playerIds[0]!, s.playerIds[1]!],
          },
        ],
      }),
    });
    // Second save: players 2+3 only
    const res = await testApp.request(
      `/api/admin/event-rounds/${s.eventRoundId}/sub-games`,
      {
        method: 'POST',
        headers: {
          cookie: organizerCookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          subGames: [
            {
              type: 'skins',
              buyInPerParticipant: 1000,
              participantPlayerIds: [s.playerIds[2]!, s.playerIds[3]!],
            },
          ],
        }),
      },
    );
    expect(res.status).toBe(200);

    const sgRows = await db.select().from(subGames);
    expect(sgRows).toHaveLength(1);
    expect(sgRows[0]!.buyInPerParticipant).toBe(1000);
    const partRows = await db.select().from(subGameParticipants);
    expect(partRows).toHaveLength(2);
    const pids = new Set(partRows.map((r) => r.playerId));
    expect(pids.has(s.playerIds[2]!)).toBe(true);
    expect(pids.has(s.playerIds[3]!)).toBe(true);
    expect(pids.has(s.playerIds[0]!)).toBe(false);
  });

  it('empty subGames array: clears all existing sub_games + cascade-clears participants', async () => {
    const s = await seed({ playerCount: 3 });
    // Seed an existing sub_game.
    await testApp.request(`/api/admin/event-rounds/${s.eventRoundId}/sub-games`, {
      method: 'POST',
      headers: {
        cookie: organizerCookie(s.organizerSessionId),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        subGames: [
          {
            type: 'skins',
            buyInPerParticipant: 500,
            participantPlayerIds: [s.playerIds[0]!, s.playerIds[1]!],
          },
        ],
      }),
    });
    // Empty save.
    const res = await testApp.request(
      `/api/admin/event-rounds/${s.eventRoundId}/sub-games`,
      {
        method: 'POST',
        headers: {
          cookie: organizerCookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ subGames: [] }),
      },
    );
    expect(res.status).toBe(200);
    expect((await db.select().from(subGames)).length).toBe(0);
    expect((await db.select().from(subGameParticipants)).length).toBe(0);
  });

  it('empty participantPlayerIds within skins entry: 1 sub_games row, 0 sub_game_participants rows', async () => {
    const s = await seed({ playerCount: 3 });
    const res = await testApp.request(
      `/api/admin/event-rounds/${s.eventRoundId}/sub-games`,
      {
        method: 'POST',
        headers: {
          cookie: organizerCookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          subGames: [{ type: 'skins', buyInPerParticipant: 0, participantPlayerIds: [] }],
        }),
      },
    );
    expect(res.status).toBe(200);
    expect((await db.select().from(subGames)).length).toBe(1);
    expect((await db.select().from(subGameParticipants)).length).toBe(0);
  });

  it('resave-to-empty: prior save had 5 participants → resave with empty array → drops all', async () => {
    const s = await seed({ playerCount: 5 });
    await testApp.request(`/api/admin/event-rounds/${s.eventRoundId}/sub-games`, {
      method: 'POST',
      headers: {
        cookie: organizerCookie(s.organizerSessionId),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        subGames: [
          {
            type: 'skins',
            buyInPerParticipant: 500,
            participantPlayerIds: s.playerIds,
          },
        ],
      }),
    });
    expect((await db.select().from(subGameParticipants)).length).toBe(5);

    await testApp.request(`/api/admin/event-rounds/${s.eventRoundId}/sub-games`, {
      method: 'POST',
      headers: {
        cookie: organizerCookie(s.organizerSessionId),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        subGames: [{ type: 'skins', buyInPerParticipant: 500, participantPlayerIds: [] }],
      }),
    });
    expect((await db.select().from(subGames)).length).toBe(1);
    expect((await db.select().from(subGameParticipants)).length).toBe(0);
  });

  it('400 sub_game_type_not_enabled: ctp rejected in v1', async () => {
    const s = await seed({ playerCount: 1 });
    const res = await testApp.request(
      `/api/admin/event-rounds/${s.eventRoundId}/sub-games`,
      {
        method: 'POST',
        headers: {
          cookie: organizerCookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          subGames: [{ type: 'ctp', buyInPerParticipant: 0, participantPlayerIds: [] }],
        }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('sub_game_type_not_enabled');
  });

  it('400 player_not_in_event: participantPlayerIds includes a non-member', async () => {
    const s = await seed({ playerCount: 2 });
    const outsiderId = randomUUID();
    await db.insert(players).values({
      id: outsiderId,
      isOrganizer: false,
      createdAt: Date.now(),
      tenantId: TENANT_ID,
      contextId: CONTEXT_LEAGUE,
    });
    const res = await testApp.request(
      `/api/admin/event-rounds/${s.eventRoundId}/sub-games`,
      {
        method: 'POST',
        headers: {
          cookie: organizerCookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          subGames: [
            {
              type: 'skins',
              buyInPerParticipant: 0,
              participantPlayerIds: [s.playerIds[0]!, outsiderId],
            },
          ],
        }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('player_not_in_event');
  });

  it('400 duplicate_sub_game_type: two skins entries', async () => {
    const s = await seed({ playerCount: 1 });
    const res = await testApp.request(
      `/api/admin/event-rounds/${s.eventRoundId}/sub-games`,
      {
        method: 'POST',
        headers: {
          cookie: organizerCookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          subGames: [
            { type: 'skins', buyInPerParticipant: 0, participantPlayerIds: [] },
            { type: 'skins', buyInPerParticipant: 100, participantPlayerIds: [] },
          ],
        }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('duplicate_sub_game_type');
  });

  it('400 duplicate_participant: same playerId listed twice', async () => {
    const s = await seed({ playerCount: 1 });
    const res = await testApp.request(
      `/api/admin/event-rounds/${s.eventRoundId}/sub-games`,
      {
        method: 'POST',
        headers: {
          cookie: organizerCookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          subGames: [
            {
              type: 'skins',
              buyInPerParticipant: 0,
              participantPlayerIds: [s.playerIds[0]!, s.playerIds[0]!],
            },
          ],
        }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('duplicate_participant');
  });

  it('400 invalid_body: negative buy-in', async () => {
    const s = await seed({ playerCount: 1 });
    const res = await testApp.request(
      `/api/admin/event-rounds/${s.eventRoundId}/sub-games`,
      {
        method: 'POST',
        headers: {
          cookie: organizerCookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          subGames: [
            { type: 'skins', buyInPerParticipant: -100, participantPlayerIds: [] },
          ],
        }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });

  it('error precedence: duplicate_sub_game_type fires before player_not_in_event', async () => {
    const s = await seed({ playerCount: 1 });
    const outsiderId = randomUUID();
    await db.insert(players).values({
      id: outsiderId,
      isOrganizer: false,
      createdAt: Date.now(),
      tenantId: TENANT_ID,
      contextId: CONTEXT_LEAGUE,
    });
    const res = await testApp.request(
      `/api/admin/event-rounds/${s.eventRoundId}/sub-games`,
      {
        method: 'POST',
        headers: {
          cookie: organizerCookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          subGames: [
            // Duplicate type AND outsider participant — duplicate fires first.
            { type: 'skins', buyInPerParticipant: 0, participantPlayerIds: [outsiderId] },
            { type: 'skins', buyInPerParticipant: 0, participantPlayerIds: [] },
          ],
        }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('duplicate_sub_game_type');
  });

  it('404 event_round_not_found on POST', async () => {
    const s = await seed({ playerCount: 1 });
    const res = await testApp.request(
      `/api/admin/event-rounds/${randomUUID()}/sub-games`,
      {
        method: 'POST',
        headers: {
          cookie: organizerCookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ subGames: [] }),
      },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('event_round_not_found');
  });

  it('cross-tenant: foreign-tenant event_round → 404', async () => {
    const s = await seed({ playerCount: 1 });
    await db
      .update(eventRounds)
      .set({ tenantId: 'other-tenant' })
      .where(eq(eventRounds.id, s.eventRoundId));

    const res = await testApp.request(
      `/api/admin/event-rounds/${s.eventRoundId}/sub-games`,
      {
        method: 'POST',
        headers: {
          cookie: organizerCookie(s.organizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ subGames: [] }),
      },
    );
    expect(res.status).toBe(404);
  });

  it('403 non-organizer on POST', async () => {
    const s = await seed({ playerCount: 1 });
    const res = await testApp.request(
      `/api/admin/event-rounds/${s.eventRoundId}/sub-games`,
      {
        method: 'POST',
        headers: {
          cookie: organizerCookie(s.nonOrganizerSessionId),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ subGames: [] }),
      },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_organizer');
  });
});

// Quiet lint warnings on imports used only in seed().
void requireSession;
