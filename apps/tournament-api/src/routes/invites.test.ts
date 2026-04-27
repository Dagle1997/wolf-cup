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
  groups,
  groupMembers,
  invites,
  deviceBindings,
  courses,
  courseRevisions,
} = await import('../db/schema/index.js');
const { inviteRouter } = await import('./invites.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const testApp = new Hono();
testApp.use('*', requestIdMiddleware);
testApp.route('/api/invites', inviteRouter);

const TENANT_ID = 'guyan';

/**
 * Seeds an event + 1 group + N players (with group_members for each) +
 * 1 invite. Returns IDs needed for tests.
 */
async function seedEventWithRoster(opts: { playerCount: number; expiresAt?: number }): Promise<{
  eventId: string;
  groupId: string;
  inviteToken: string;
  organizerId: string;
  playerIds: string[];
}> {
  const now = Date.now();
  const organizerId = randomUUID();
  await db.insert(players).values({
    id: organizerId,
    isOrganizer: true,
    createdAt: now,
    name: 'Organizer',
    tenantId: TENANT_ID,
    contextId: 'league:guyan-wolf-cup-friday',
  });

  const eventId = randomUUID();
  await db.insert(events).values({
    id: eventId,
    name: 'Pinehurst 2026',
    startDate: 1_715_040_000_000,
    endDate: 1_715_300_000_000,
    timezone: 'America/New_York',
    organizerPlayerId: organizerId,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: `event:${eventId}`,
  });

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
  for (let i = 0; i < opts.playerCount; i++) {
    const id = randomUUID();
    playerIds.push(id);
    // Names with predictable ASC sort: 'Player A', 'Player B', etc.
    const name = `Player ${String.fromCharCode(65 + i)}`;
    await db.insert(players).values({
      id,
      isOrganizer: false,
      createdAt: now,
      name,
      tenantId: TENANT_ID,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    await db.insert(groupMembers).values({
      groupId,
      playerId: id,
      tenantId: TENANT_ID,
      contextId: `event:${eventId}`,
    });
  }

  const inviteToken = `invite-tok-${randomUUID()}`;
  await db.insert(invites).values({
    id: randomUUID(),
    eventId,
    token: inviteToken,
    expiresAt: opts.expiresAt ?? now + 7 * 24 * 60 * 60 * 1000,
    createdByPlayerId: organizerId,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: `event:${eventId}`,
  });

  return { eventId, groupId, inviteToken, organizerId, playerIds };
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(deviceBindings);
  await db.delete(invites);
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(events);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

describe('GET /api/invites/:token', () => {
  it('happy path: returns event + roster sorted by name ASC', async () => {
    const { inviteToken } = await seedEventWithRoster({ playerCount: 3 });

    const res = await testApp.request(`/api/invites/${inviteToken}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      event: { name: string };
      roster: Array<{ playerId: string; name: string }>;
    };
    expect(body.event.name).toBe('Pinehurst 2026');
    expect(body.roster).toHaveLength(3);
    expect(body.roster.map((r) => r.name)).toEqual(['Player A', 'Player B', 'Player C']);
  });

  it('404 invite_not_found for unknown token', async () => {
    const res = await testApp.request('/api/invites/no-such-token');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invite_not_found');
  });

  it('410 invite_expired when expires_at < now', async () => {
    const { inviteToken } = await seedEventWithRoster({
      playerCount: 1,
      expiresAt: Date.now() - 1000, // 1 second ago
    });
    const res = await testApp.request(`/api/invites/${inviteToken}`);
    expect(res.status).toBe(410);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invite_expired');
  });

  it('roster dedupe: player in 2 groups under one event → returned ONCE', async () => {
    const { eventId, inviteToken, playerIds } = await seedEventWithRoster({ playerCount: 1 });
    // Add a 2nd group with the SAME player.
    const group2Id = randomUUID();
    await db.insert(groups).values({
      id: group2Id,
      eventId,
      name: 'Second Crew',
      moneyVisibilityMode: 'open',
      createdAt: Date.now(),
      tenantId: TENANT_ID,
      contextId: `event:${eventId}`,
    });
    await db.insert(groupMembers).values({
      groupId: group2Id,
      playerId: playerIds[0]!,
      tenantId: TENANT_ID,
      contextId: `event:${eventId}`,
    });

    const res = await testApp.request(`/api/invites/${inviteToken}`);
    const body = (await res.json()) as { roster: Array<{ playerId: string }> };
    expect(body.roster).toHaveLength(1);
  });
});

describe('POST /api/invites/:token/claim', () => {
  it('happy path (no prior cookie): 201 + Set-Cookie + new device_bindings row with session_id NULL', async () => {
    const { eventId, inviteToken, playerIds } = await seedEventWithRoster({ playerCount: 1 });

    const res = await testApp.request(`/api/invites/${inviteToken}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: playerIds[0]! }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      player: { id: string; name: string };
      event: { id: string; name: string };
      deviceBindingId: string;
    };
    expect(body.player.id).toBe(playerIds[0]);
    expect(body.event.id).toBe(eventId);
    expect(typeof body.deviceBindingId).toBe('string');

    // device_bindings row inserted with session_id=NULL
    const rows = await db
      .select()
      .from(deviceBindings)
      .where(eq(deviceBindings.id, body.deviceBindingId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sessionId).toBeNull();
    expect(rows[0]!.playerId).toBe(playerIds[0]);
    expect(rows[0]!.contextId).toBe(`event:${eventId}`);
  });

  it('Set-Cookie attributes: HttpOnly, SameSite=Lax, Path=/, Max-Age=7776000; no Secure in test env', async () => {
    const { inviteToken, playerIds } = await seedEventWithRoster({ playerCount: 1 });

    const res = await testApp.request(`/api/invites/${inviteToken}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: playerIds[0]! }),
    });
    expect(res.status).toBe(201);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('tournament_device_id=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toMatch(/Max-Age=7776000/);
    // NODE_ENV=test in vitest setup; Secure should be ABSENT
    expect(setCookie).not.toContain('Secure');
    // host-only — no Domain attribute
    expect(setCookie).not.toMatch(/Domain=/);
  });

  it('UPDATE branch: cookie + existing row in same event → 200, player_id updated, created_at preserved', async () => {
    const { eventId, inviteToken, playerIds } = await seedEventWithRoster({ playerCount: 2 });

    // First claim → INSERT
    const first = await testApp.request(`/api/invites/${inviteToken}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: playerIds[0]! }),
    });
    const firstBody = (await first.json()) as { deviceBindingId: string };
    const firstRows = await db
      .select()
      .from(deviceBindings)
      .where(eq(deviceBindings.id, firstBody.deviceBindingId));
    const originalCreatedAt = firstRows[0]!.createdAt;

    // Wait briefly so a setting `created_at = now` would visibly differ.
    await new Promise((r) => setTimeout(r, 10));

    // Second claim with the cookie → UPDATE (same event)
    const second = await testApp.request(`/api/invites/${inviteToken}/claim`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `tournament_device_id=${firstBody.deviceBindingId}`,
      },
      body: JSON.stringify({ playerId: playerIds[1]! }),
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { deviceBindingId: string };
    expect(secondBody.deviceBindingId).toBe(firstBody.deviceBindingId);

    const updatedRows = await db
      .select()
      .from(deviceBindings)
      .where(eq(deviceBindings.id, firstBody.deviceBindingId));
    expect(updatedRows).toHaveLength(1);
    expect(updatedRows[0]!.playerId).toBe(playerIds[1]);
    // created_at PRESERVED — original-bind audit timestamp.
    expect(updatedRows[0]!.createdAt).toBe(originalCreatedAt);
    expect(updatedRows[0]!.contextId).toBe(`event:${eventId}`);
  });

  it('Cross-event: cookie row from event A + claim for event B → INSERT new row (NOT update)', async () => {
    // Event A
    const a = await seedEventWithRoster({ playerCount: 1 });
    // Event B (different event)
    const b = await seedEventWithRoster({ playerCount: 1 });

    // First claim in event A → INSERT
    const first = await testApp.request(`/api/invites/${a.inviteToken}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: a.playerIds[0]! }),
    });
    const firstBody = (await first.json()) as { deviceBindingId: string };

    // Second claim in event B with the SAME cookie → INSERT new row
    // (cross-event protection).
    const second = await testApp.request(`/api/invites/${b.inviteToken}/claim`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `tournament_device_id=${firstBody.deviceBindingId}`,
      },
      body: JSON.stringify({ playerId: b.playerIds[0]! }),
    });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { deviceBindingId: string };
    // Different deviceBindingId — new row
    expect(secondBody.deviceBindingId).not.toBe(firstBody.deviceBindingId);

    // Both rows now exist (the old one is orphaned but not deleted).
    const all = await db.select().from(deviceBindings);
    expect(all).toHaveLength(2);
    const rowA = all.find((r) => r.id === firstBody.deviceBindingId)!;
    const rowB = all.find((r) => r.id === secondBody.deviceBindingId)!;
    expect(rowA.contextId).toBe(`event:${a.eventId}`);
    expect(rowB.contextId).toBe(`event:${b.eventId}`);
  });

  it('Cookie value bogus (no matching row) → INSERT new row (treats as no-cookie)', async () => {
    const { inviteToken, playerIds } = await seedEventWithRoster({ playerCount: 1 });

    const res = await testApp.request(`/api/invites/${inviteToken}/claim`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `tournament_device_id=bogus-uuid-not-in-db`,
      },
      body: JSON.stringify({ playerId: playerIds[0]! }),
    });
    expect(res.status).toBe(201);
  });

  it('400 invalid_body: missing playerId', async () => {
    const { inviteToken } = await seedEventWithRoster({ playerCount: 1 });
    const res = await testApp.request(`/api/invites/${inviteToken}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });

  it('404 invite_not_found on POST', async () => {
    await seedEventWithRoster({ playerCount: 1 });
    const res = await testApp.request('/api/invites/no-such-token/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: 'whatever' }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invite_not_found');
  });

  it('410 invite_expired on POST', async () => {
    const { inviteToken, playerIds } = await seedEventWithRoster({
      playerCount: 1,
      expiresAt: Date.now() - 1000,
    });
    const res = await testApp.request(`/api/invites/${inviteToken}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: playerIds[0]! }),
    });
    expect(res.status).toBe(410);
  });

  it('400 player_not_in_event: playerId exists but not in event roster', async () => {
    const { inviteToken } = await seedEventWithRoster({ playerCount: 1 });
    // Seed a SEPARATE player not in the event.
    const orphanId = randomUUID();
    await db.insert(players).values({
      id: orphanId,
      isOrganizer: false,
      createdAt: Date.now(),
      name: 'Orphan',
      tenantId: TENANT_ID,
      contextId: 'league:guyan-wolf-cup-friday',
    });

    const res = await testApp.request(`/api/invites/${inviteToken}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: orphanId }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('player_not_in_event');
  });

  it('Same playerId on multiple devices: each device gets its own row', async () => {
    const { inviteToken, playerIds } = await seedEventWithRoster({ playerCount: 1 });

    // Device 1 (no cookie)
    const d1 = await testApp.request(`/api/invites/${inviteToken}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: playerIds[0]! }),
    });
    const d1Body = (await d1.json()) as { deviceBindingId: string };

    // Device 2 (no cookie — simulating different device)
    const d2 = await testApp.request(`/api/invites/${inviteToken}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: playerIds[0]! }),
    });
    const d2Body = (await d2.json()) as { deviceBindingId: string };

    expect(d1Body.deviceBindingId).not.toBe(d2Body.deviceBindingId);

    // Two rows for the same player on different devices.
    const rows = await db
      .select()
      .from(deviceBindings)
      .where(eq(deviceBindings.playerId, playerIds[0]!));
    expect(rows).toHaveLength(2);
  });

  it('body > 8 KiB → 400 body_too_large', async () => {
    const { inviteToken, playerIds } = await seedEventWithRoster({ playerCount: 1 });
    const huge = JSON.stringify({ playerId: playerIds[0]!, _pad: 'x'.repeat(10_000) });

    const res = await testApp.request(`/api/invites/${inviteToken}/claim`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(huge.length),
      },
      body: huge,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('body_too_large');
  });
});
