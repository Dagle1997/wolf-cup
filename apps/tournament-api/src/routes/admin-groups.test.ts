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
  events,
  groups,
  groupMembers,
  courses,
  courseRevisions,
} = await import('../db/schema/index.js');
const { adminGroupsRouter } = await import('./admin-groups.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const testApp = new Hono();
testApp.use('*', requestIdMiddleware);
testApp.route('/api/admin', adminGroupsRouter);

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

async function seedEventAndGroup(): Promise<{ eventId: string; groupId: string; organizerId: string }> {
  const organizerId = randomUUID();
  await db.insert(players).values({
    id: organizerId,
    isOrganizer: true,
    createdAt: Date.now(),
    name: 'Organizer',
    tenantId: TENANT_ID,
    contextId: 'league:guyan-wolf-cup-friday',
  });
  // Need a course revision for the event_round (T3-1 RESTRICT FK), but
  // T3-3 doesn't need event_rounds; events FK to players (organizer)
  // suffices.
  const eventId = randomUUID();
  await db.insert(events).values({
    id: eventId,
    name: 'Pinehurst 2026',
    startDate: Date.now(),
    endDate: Date.now() + 86_400_000,
    timezone: 'America/New_York',
    organizerPlayerId: organizerId,
    createdAt: Date.now(),
    tenantId: TENANT_ID,
    contextId: `event:${eventId}`,
  });
  const groupId = randomUUID();
  await db.insert(groups).values({
    id: groupId,
    eventId,
    name: 'Pinehurst Crew',
    moneyVisibilityMode: 'open',
    createdAt: Date.now(),
    tenantId: TENANT_ID,
    contextId: `event:${eventId}`,
  });
  return { eventId, groupId, organizerId };
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  // Reverse FK dependency order: members first, then groups, events,
  // course_revisions, courses, sessions, players.
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(events);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(sessions);
  await db.delete(players);
});

describe('GET /api/admin/groups/:groupId', () => {
  it('happy path: organizer fetches group → 200 with members sorted by name ASC', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const { groupId, eventId } = await seedEventAndGroup();

    // Add 2 members in non-alphabetical insertion order: Charlie, Alice.
    const charlieId = randomUUID();
    const aliceId = randomUUID();
    await db.insert(players).values([
      {
        id: charlieId,
        isOrganizer: false,
        createdAt: Date.now(),
        name: 'Charlie',
        tenantId: TENANT_ID,
        contextId: 'league:guyan-wolf-cup-friday',
      },
      {
        id: aliceId,
        isOrganizer: false,
        createdAt: Date.now(),
        name: 'Alice',
        tenantId: TENANT_ID,
        contextId: 'league:guyan-wolf-cup-friday',
      },
    ]);
    await db.insert(groupMembers).values([
      { groupId, playerId: charlieId, tenantId: TENANT_ID, contextId: `event:${eventId}` },
      { groupId, playerId: aliceId, tenantId: TENANT_ID, contextId: `event:${eventId}` },
    ]);

    const res = await testApp.request(`/api/admin/groups/${groupId}`, {
      headers: { cookie: cookie(sessionId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      name: string;
      eventId: string;
      moneyVisibilityMode: string;
      members: Array<{ playerId: string; name: string }>;
    };
    expect(body.id).toBe(groupId);
    expect(body.name).toBe('Pinehurst Crew');
    expect(body.eventId).toBe(eventId);
    expect(body.moneyVisibilityMode).toBe('open');
    // Sorted ASC by name: Alice before Charlie.
    expect(body.members.map((m) => m.name)).toEqual(['Alice', 'Charlie']);
  });

  it('404 group_not_found: unknown groupId', async () => {
    const sessionId = await seedSession({ isOrganizer: true });

    const res = await testApp.request(`/api/admin/groups/${randomUUID()}`, {
      headers: { cookie: cookie(sessionId) },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('group_not_found');
  });

  it('anonymous → 401 session_missing', async () => {
    const { groupId } = await seedEventAndGroup();

    const res = await testApp.request(`/api/admin/groups/${groupId}`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('session_missing');
  });

  it('non-organizer → 403 not_organizer', async () => {
    const sessionId = await seedSession({ isOrganizer: false });
    const { groupId } = await seedEventAndGroup();

    const res = await testApp.request(`/api/admin/groups/${groupId}`, {
      headers: { cookie: cookie(sessionId) },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_organizer');
  });
});

describe('PATCH /api/admin/groups/:groupId', () => {
  it('happy path: name change → 200 + DB updated', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const { groupId } = await seedEventAndGroup();

    const res = await testApp.request(`/api/admin/groups/${groupId}`, {
      method: 'PATCH',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed Crew' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe('Renamed Crew');
    const rows = await db.select().from(groups).where(eq(groups.id, groupId));
    expect(rows[0]!.name).toBe('Renamed Crew');
  });

  it('moneyVisibilityMode=open → 200', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const { groupId } = await seedEventAndGroup();

    const res = await testApp.request(`/api/admin/groups/${groupId}`, {
      method: 'PATCH',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ moneyVisibilityMode: 'open' }),
    });
    expect(res.status).toBe(200);
  });

  it('moneyVisibilityMode=participant → 400 mode_not_v1', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const { groupId } = await seedEventAndGroup();

    const res = await testApp.request(`/api/admin/groups/${groupId}`, {
      method: 'PATCH',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ moneyVisibilityMode: 'participant' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('mode_not_v1');
  });

  it('moneyVisibilityMode=self_only → 400 mode_not_v1', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const { groupId } = await seedEventAndGroup();

    const res = await testApp.request(`/api/admin/groups/${groupId}`, {
      method: 'PATCH',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ moneyVisibilityMode: 'self_only' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('mode_not_v1');
  });

  it('body > 4 KiB → 400 body_too_large (bodyLimit middleware)', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const { groupId } = await seedEventAndGroup();
    const payload = { name: 'x'.repeat(5_000) }; // > 4 KiB
    const bodyStr = JSON.stringify(payload);

    const res = await testApp.request(`/api/admin/groups/${groupId}`, {
      method: 'PATCH',
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

  it('empty body (no fields) → 400 invalid_body', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const { groupId } = await seedEventAndGroup();

    const res = await testApp.request(`/api/admin/groups/${groupId}`, {
      method: 'PATCH',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });
});

describe('POST /api/admin/groups/:groupId/members', () => {
  it('add by GHIN (new player) → 201; players + group_members rows persisted', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const { groupId } = await seedEventAndGroup();

    const res = await testApp.request(`/api/admin/groups/${groupId}/members`, {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'ghin', ghin: 1234567, firstName: 'Josh', lastName: 'Stoll' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      player: { id: string; name: string; ghin: string | null };
      groupMember: { groupId: string; playerId: string };
    };
    expect(body.player.name).toBe('Josh Stoll');
    expect(body.player.ghin).toBe('1234567');

    const playerRows = await db.select().from(players).where(eq(players.ghin, '1234567'));
    expect(playerRows).toHaveLength(1);
    const memberRows = await db
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId));
    expect(memberRows).toHaveLength(1);
  });

  it('add by GHIN (existing player with same GHIN) → 201, REUSES player_id', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const { groupId } = await seedEventAndGroup();

    // First add: creates the player.
    const first = await testApp.request(`/api/admin/groups/${groupId}/members`, {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'ghin', ghin: 7777777, firstName: 'A', lastName: 'B' }),
    });
    const firstBody = (await first.json()) as { player: { id: string } };
    const firstPlayerId = firstBody.player.id;

    // Now remove from the group (so the second add isn't player_already_in_group).
    await db
      .delete(groupMembers)
      .where(eq(groupMembers.groupId, groupId));

    // Second add: same GHIN → reuses the existing player.
    const second = await testApp.request(`/api/admin/groups/${groupId}/members`, {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'ghin', ghin: 7777777, firstName: 'A', lastName: 'B' }),
    });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { player: { id: string } };
    expect(secondBody.player.id).toBe(firstPlayerId);

    // Only one players row with this GHIN.
    const playerRows = await db.select().from(players).where(eq(players.ghin, '7777777'));
    expect(playerRows).toHaveLength(1);
  });

  it('add manual → 201; new players row with ghin=null', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const { groupId } = await seedEventAndGroup();

    const res = await testApp.request(`/api/admin/groups/${groupId}/members`, {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'manual', name: 'Manual Mike', manualHandicapIndex: 12.4 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { player: { name: string; ghin: string | null; manualHandicapIndex: number | null } };
    expect(body.player.name).toBe('Manual Mike');
    expect(body.player.ghin).toBeNull();
    expect(body.player.manualHandicapIndex).toBe(12.4);
  });

  it('add manual with phone → 201; phone persisted on players row + echoed in response', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const { groupId } = await seedEventAndGroup();

    const res = await testApp.request(`/api/admin/groups/${groupId}/members`, {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'manual',
        name: 'Phone Phil',
        phone: '(304) 555-0123',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { player: { id: string; phone: string | null } };
    expect(body.player.phone).toBe('(304) 555-0123');

    const playerRows = await db.select().from(players).where(eq(players.id, body.player.id));
    expect(playerRows[0]!.phone).toBe('(304) 555-0123');
  });

  it('add manual without phone → 201; players.phone is null', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const { groupId } = await seedEventAndGroup();

    const res = await testApp.request(`/api/admin/groups/${groupId}/members`, {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'manual', name: 'No Phone Ned' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { player: { id: string; phone: string | null } };
    expect(body.player.phone).toBeNull();

    const playerRows = await db.select().from(players).where(eq(players.id, body.player.id));
    expect(playerRows[0]!.phone).toBeNull();
  });

  it('add manual: phone gets trimmed; empty-after-trim stored as null', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const { groupId } = await seedEventAndGroup();

    const res = await testApp.request(`/api/admin/groups/${groupId}/members`, {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'manual', name: 'Trim Tim', phone: '   ' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { player: { id: string; phone: string | null } };
    expect(body.player.phone).toBeNull();
  });

  it('add manual: phone > 32 chars → 400 invalid_body', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const { groupId } = await seedEventAndGroup();

    const res = await testApp.request(`/api/admin/groups/${groupId}/members`, {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'manual', name: 'Long Lou', phone: '1'.repeat(33) }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });

  it('duplicate add (same GHIN, same group) → 409 player_already_in_group', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const { groupId } = await seedEventAndGroup();

    const payload = { mode: 'ghin', ghin: 5555555, firstName: 'Dup', lastName: 'Player' };
    const first = await testApp.request(`/api/admin/groups/${groupId}/members`, {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);

    const second = await testApp.request(`/api/admin/groups/${groupId}/members`, {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { code: string };
    expect(body.code).toBe('player_already_in_group');
  });

  it('group_not_found pre-flight: unknown groupId → 404 (no FK violation)', async () => {
    const sessionId = await seedSession({ isOrganizer: true });

    const res = await testApp.request(`/api/admin/groups/${randomUUID()}/members`, {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'manual', name: 'Manual' }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('group_not_found');
  });

  it('Zod miss: missing mode discriminator → 400 invalid_body', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const { groupId } = await seedEventAndGroup();

    const res = await testApp.request(`/api/admin/groups/${groupId}/members`, {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ ghin: 1234567, firstName: 'A', lastName: 'B' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });
});

describe('DELETE /api/admin/groups/:groupId/members/:playerId', () => {
  it('happy path → 204; group_members row gone, players row INTACT', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const { groupId, eventId } = await seedEventAndGroup();
    const playerId = randomUUID();
    await db.insert(players).values({
      id: playerId,
      isOrganizer: false,
      createdAt: Date.now(),
      name: 'P',
      tenantId: TENANT_ID,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    await db.insert(groupMembers).values({
      groupId,
      playerId,
      tenantId: TENANT_ID,
      contextId: `event:${eventId}`,
    });

    const res = await testApp.request(`/api/admin/groups/${groupId}/members/${playerId}`, {
      method: 'DELETE',
      headers: { cookie: cookie(sessionId) },
    });
    expect(res.status).toBe(204);

    // group_member row gone.
    const memberRows = await db
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId));
    expect(memberRows).toHaveLength(0);

    // players row intact (the load-bearing semantic).
    const playerRows = await db.select().from(players).where(eq(players.id, playerId));
    expect(playerRows).toHaveLength(1);
  });

  it('member not in group → 404 member_not_found', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const { groupId } = await seedEventAndGroup();

    const res = await testApp.request(
      `/api/admin/groups/${groupId}/members/${randomUUID()}`,
      {
        method: 'DELETE',
        headers: { cookie: cookie(sessionId) },
      },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('member_not_found');
  });
});
