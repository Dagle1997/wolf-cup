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
// GHIN unconfigured in tests (join doesn't use it, but admin-groups/roster do not run here).
vi.mock('../lib/ghin-client.js', () => ({ ghinClient: null }));

const { db } = await import('../db/index.js');
const {
  players, events, groups, groupMembers, playerJoinCodes, deviceBindings, sessions,
} = await import('../db/schema/index.js');
const { joinRouter, adminJoinCodesRouter } = await import('./join.js');
const { requireSession } = await import('../middleware/require-session.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT_ID = 'guyan';
const CTX = 'league:guyan-wolf-cup-friday';

const app = new Hono();
app.use('*', requestIdMiddleware);
app.route('/api/join', joinRouter);
app.route('/api/admin', adminJoinCodesRouter);
// Probe route on the REAL requireSession — proves the device-binding bridge.
app.get('/probe', requireSession, (c) => c.json({ playerId: c.get('player')!.id }));

async function seed() {
  const now = Date.now();
  const orgId = randomUUID();
  const playerId = randomUUID();
  const eventId = randomUUID();
  const groupId = randomUUID();
  for (const [id, name, isOrg] of [[orgId, 'Organizer', true], [playerId, 'Ronnie Adkins', false]] as Array<[string, string, boolean]>) {
    await db.insert(players).values({ id, isOrganizer: isOrg, createdAt: now, name, tenantId: TENANT_ID, contextId: CTX });
  }
  await db.insert(events).values({
    id: eventId, name: 'Pete Dye 26', startDate: now, endDate: now + 4 * 86400000,
    timezone: 'America/New_York', organizerPlayerId: orgId, createdAt: now, tenantId: TENANT_ID, contextId: `event:${eventId}`,
  });
  await db.insert(groups).values({ id: groupId, eventId, name: 'Crew', moneyVisibilityMode: 'open', createdAt: now, tenantId: TENANT_ID, contextId: `event:${eventId}` });
  await db.insert(groupMembers).values({ groupId, playerId, tenantId: TENANT_ID, contextId: `event:${eventId}` });
  return { orgId, playerId, eventId, groupId };
}

async function seedSession(playerId: string): Promise<string> {
  const now = Date.now();
  const sessionId = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  await db.insert(sessions).values({
    sessionId, playerId, createdAt: now, lastSeenAt: now, expiresAt: now + 7 * 86400000,
    deviceInfo: null, tenantId: TENANT_ID, contextId: CTX,
  });
  return sessionId;
}

function deviceCookieFrom(res: Response): string | null {
  const sc = res.headers.get('set-cookie');
  if (!sc) return null;
  const m = sc.match(/tournament_device_id=([^;]+)/);
  return m ? m[1]! : null;
}

beforeAll(async () => { await migrate(db, { migrationsFolder }); });
beforeEach(async () => {
  await db.delete(deviceBindings); await db.delete(sessions); await db.delete(playerJoinCodes);
  await db.delete(groupMembers); await db.delete(groups); await db.delete(events); await db.delete(players);
});

describe('POST /api/join', () => {
  it('valid code → 200, binds device, returns event + player; device cookie then authenticates (the bridge)', async () => {
    const s = await seed();
    await db.insert(playerJoinCodes).values({ eventId: s.eventId, playerId: s.playerId, code: 'K7M4PQ', createdAt: Date.now(), tenantId: TENANT_ID, contextId: `event:${s.eventId}` });

    const res = await app.request('/api/join', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'k7m-4pq' }), // lowercase + dash → normalized
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { eventId: string; player: { id: string; name: string } };
    expect(body.eventId).toBe(s.eventId);
    expect(body.player.id).toBe(s.playerId);
    expect(body.player.name).toBe('Ronnie Adkins');

    const deviceId = deviceCookieFrom(res);
    expect(deviceId).toBeTruthy();
    // device_binding row created for the player
    const binding = await db.select().from(deviceBindings).where(eq(deviceBindings.id, deviceId!));
    expect(binding[0]?.playerId).toBe(s.playerId);

    // THE BRIDGE: a request carrying only the device cookie authenticates.
    const probe = await app.request('/probe', { headers: { cookie: `tournament_device_id=${deviceId}` } });
    expect(probe.status).toBe(200);
    expect(((await probe.json()) as { playerId: string }).playerId).toBe(s.playerId);
  });

  it('unknown code → 404 invalid_code', async () => {
    await seed();
    const res = await app.request('/api/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'ZZZZZZ' }) });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_code');
  });

  it('cancelled event → 410 event_cancelled', async () => {
    const s = await seed();
    await db.update(events).set({ cancelledAt: Date.now() }).where(eq(events.id, s.eventId));
    await db.insert(playerJoinCodes).values({ eventId: s.eventId, playerId: s.playerId, code: 'ABC234', createdAt: Date.now(), tenantId: TENANT_ID, contextId: `event:${s.eventId}` });
    const res = await app.request('/api/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'ABC234' }) });
    expect(res.status).toBe(410);
    expect(((await res.json()) as { code: string }).code).toBe('event_cancelled');
  });

  it('no device cookie present → 401 session_missing on an authed route (bridge requires a valid binding)', async () => {
    const probe = await app.request('/probe');
    expect(probe.status).toBe(401);
  });
});

describe('GET /api/admin/events/:eventId/join-codes', () => {
  it('organizer → 200, generates a code per roster player', async () => {
    const s = await seed();
    const sid = await seedSession(s.orgId);
    const res = await app.request(`/api/admin/events/${s.eventId}/join-codes`, { headers: { cookie: `tournament_session=${sid}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { players: Array<{ playerId: string; name: string; code: string | null }> };
    expect(body.players).toHaveLength(1);
    expect(body.players[0]!.playerId).toBe(s.playerId);
    expect(body.players[0]!.code).toMatch(/^[A-Z2-9]{6}$/);

    // Idempotent: a second call returns the SAME code (not regenerated).
    const res2 = await app.request(`/api/admin/events/${s.eventId}/join-codes`, { headers: { cookie: `tournament_session=${sid}` } });
    const body2 = (await res2.json()) as { players: Array<{ code: string }> };
    expect(body2.players[0]!.code).toBe(body.players[0]!.code);
  });

  it('non-organizer roster player → 403 (blocked by requireOrganizer)', async () => {
    const s = await seed();
    const sid = await seedSession(s.playerId); // a roster player, not an organizer
    const res = await app.request(`/api/admin/events/${s.eventId}/join-codes`, { headers: { cookie: `tournament_session=${sid}` } });
    expect(res.status).toBe(403);
    const code = ((await res.json()) as { code: string }).code;
    expect(['not_organizer', 'not_event_organizer']).toContain(code);
  });
});
