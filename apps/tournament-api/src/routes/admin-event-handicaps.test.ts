import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
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

// Controllable GHIN stub — the route branches on `ghinClient` being non-null,
// so we expose vi.fn()s and configure their return values per test.
vi.mock('../lib/ghin-client.js', () => ({
  ghinClient: {
    getHandicap: vi.fn(),
    getHandicapHistory: vi.fn(),
  },
}));

const { db } = await import('../db/index.js');
const { players, events, groups, groupMembers, eventHandicaps, sessions } =
  await import('../db/schema/index.js');
const { ghinClient } = await import('../lib/ghin-client.js');
const { adminEventHandicapsRouter } = await import('./admin-event-handicaps.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const ghin = ghinClient as unknown as {
  getHandicap: ReturnType<typeof vi.fn>;
  getHandicapHistory: ReturnType<typeof vi.fn>;
};

const TENANT_ID = 'guyan';
const CONTEXT_LEAGUE = 'league:guyan-wolf-cup-friday';

const testApp = new Hono();
testApp.use('*', requestIdMiddleware);
testApp.route('/api/admin', adminEventHandicapsRouter);

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(eventHandicaps);
  await db.delete(sessions);
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(events);
  await db.delete(players);
});

interface SeedResult {
  organizerId: string;
  organizerSessionId: string;
  otherOrganizerSessionId: string;
  nonOrganizerSessionId: string;
  eventId: string;
  groupId: string;
  ghinPlayerId: string;
  manualPlayerId: string;
}

async function seedPlayerWithSession(
  name: string,
  isOrganizer: boolean,
): Promise<{ id: string; sessionId: string }> {
  const now = Date.now();
  const id = randomUUID();
  await db.insert(players).values({
    id,
    isOrganizer,
    createdAt: now,
    name,
    tenantId: TENANT_ID,
    contextId: CONTEXT_LEAGUE,
  });
  const sessionId = randomUUID().replace(/-/g, '') + 'a'.repeat(8);
  await db.insert(sessions).values({
    sessionId,
    playerId: id,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    deviceInfo: null,
    contextId: CONTEXT_LEAGUE,
  });
  return { id, sessionId };
}

/**
 * Seed an event whose organizer is `organizerId`, a group, and two roster
 * players: one with a GHIN number (10.0 manual fallback) and one manual-only
 * (12.5). Also seeds a non-organizer + a second organizer who does NOT own
 * this event (for the event-scoped 403 case).
 */
async function seed(opts: { withRoster: boolean }): Promise<SeedResult> {
  const now = Date.now();
  const organizer = await seedPlayerWithSession('Organizer', true);
  const otherOrganizer = await seedPlayerWithSession('Other Organizer', true);
  const nonOrganizer = await seedPlayerWithSession('Non-Organizer', false);

  const eventId = randomUUID();
  await db.insert(events).values({
    id: eventId,
    name: 'Test Event',
    startDate: 1_715_040_000_000,
    endDate: 1_715_300_000_000,
    timezone: 'America/New_York',
    organizerPlayerId: organizer.id,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: `event:${eventId}`,
  });

  const groupId = randomUUID();
  let ghinPlayerId = '';
  let manualPlayerId = '';
  if (opts.withRoster) {
    await db.insert(groups).values({
      id: groupId,
      eventId,
      name: 'Test Group',
      moneyVisibilityMode: 'open',
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: `event:${eventId}`,
    });
    ghinPlayerId = randomUUID();
    manualPlayerId = randomUUID();
    await db.insert(players).values({
      id: ghinPlayerId,
      isOrganizer: false,
      createdAt: now,
      name: 'Ghin Player',
      ghin: '1111111',
      manualHandicapIndex: 10.0,
      tenantId: TENANT_ID,
      contextId: CONTEXT_LEAGUE,
    });
    await db.insert(players).values({
      id: manualPlayerId,
      isOrganizer: false,
      createdAt: now,
      name: 'Manual Player',
      ghin: null,
      manualHandicapIndex: 12.5,
      tenantId: TENANT_ID,
      contextId: CONTEXT_LEAGUE,
    });
    await db.insert(groupMembers).values({
      groupId,
      playerId: ghinPlayerId,
      tenantId: TENANT_ID,
      contextId: `event:${eventId}`,
    });
    await db.insert(groupMembers).values({
      groupId,
      playerId: manualPlayerId,
      tenantId: TENANT_ID,
      contextId: `event:${eventId}`,
    });
  }

  return {
    organizerId: organizer.id,
    organizerSessionId: organizer.sessionId,
    otherOrganizerSessionId: otherOrganizer.sessionId,
    nonOrganizerSessionId: nonOrganizer.sessionId,
    eventId,
    groupId,
    ghinPlayerId,
    manualPlayerId,
  };
}

function cookie(sessionId: string): string {
  return `tournament_session=${sessionId}`;
}

describe('GET /api/admin/events/:eventId/handicaps', () => {
  it('returns roster with live (GHIN) + manual current HI', async () => {
    const s = await seed({ withRoster: true });
    ghin.getHandicap.mockResolvedValue({ handicapIndex: 9.3 });

    const res = await testApp.request(`/api/admin/events/${s.eventId}/handicaps`, {
      headers: { cookie: cookie(s.organizerSessionId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      lockDate: number | null;
      ghinConfigured: boolean;
      players: Array<{
        playerId: string;
        hasGhin: boolean;
        currentHandicapIndex: number | null;
        lockedHandicapIndex: number | null;
      }>;
    };
    expect(body.lockDate).toBeNull();
    expect(body.ghinConfigured).toBe(true);
    expect(body.players).toHaveLength(2);
    const ghinRow = body.players.find((p) => p.playerId === s.ghinPlayerId)!;
    const manualRow = body.players.find((p) => p.playerId === s.manualPlayerId)!;
    expect(ghinRow.hasGhin).toBe(true);
    expect(ghinRow.currentHandicapIndex).toBe(9.3);
    expect(manualRow.hasGhin).toBe(false);
    expect(manualRow.currentHandicapIndex).toBe(12.5);
  });

  it('tolerates a GHIN failure for one player (null, not a 500)', async () => {
    const s = await seed({ withRoster: true });
    ghin.getHandicap.mockRejectedValue(new Error('GHIN_UNAVAILABLE'));

    const res = await testApp.request(`/api/admin/events/${s.eventId}/handicaps`, {
      headers: { cookie: cookie(s.organizerSessionId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      players: Array<{ playerId: string; currentHandicapIndex: number | null }>;
    };
    expect(body.players.find((p) => p.playerId === s.ghinPlayerId)!.currentHandicapIndex).toBeNull();
    // The manual player is unaffected.
    expect(body.players.find((p) => p.playerId === s.manualPlayerId)!.currentHandicapIndex).toBe(12.5);
  });

  it('401 anonymous → session_missing', async () => {
    const s = await seed({ withRoster: true });
    const res = await testApp.request(`/api/admin/events/${s.eventId}/handicaps`);
    expect(res.status).toBe(401);
  });

  it('403 non-organizer → not_organizer', async () => {
    const s = await seed({ withRoster: true });
    const res = await testApp.request(`/api/admin/events/${s.eventId}/handicaps`, {
      headers: { cookie: cookie(s.nonOrganizerSessionId) },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_organizer');
  });

  it('403 organizer-of-another-event → not_event_organizer', async () => {
    const s = await seed({ withRoster: true });
    const res = await testApp.request(`/api/admin/events/${s.eventId}/handicaps`, {
      headers: { cookie: cookie(s.otherOrganizerSessionId) },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_event_organizer');
  });
});

describe('POST /api/admin/events/:eventId/handicaps/lock', () => {
  function lock(eventId: string, sessionId: string, body: unknown) {
    return testApp.request(`/api/admin/events/${eventId}/handicaps/lock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookie(sessionId) },
      body: JSON.stringify(body),
    });
  }

  it('snapshots GHIN as-of HI + manual fallback, sets lock date', async () => {
    const s = await seed({ withRoster: true });
    // GHIN history: the as-of pick for 2026-06-10 is the 2026-06-01 revision (8.4).
    ghin.getHandicapHistory.mockResolvedValue([
      { revisionDate: '2026-06-15', value: 7.9, displayValue: '7.9' },
      { revisionDate: '2026-06-01', value: 8.4, displayValue: '8.4' },
      { revisionDate: '2026-05-01', value: 9.1, displayValue: '9.1' },
    ]);

    const res = await lock(s.eventId, s.organizerSessionId, { lockDate: '2026-06-10' });
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(eventHandicaps)
      .where(and(eq(eventHandicaps.eventId, s.eventId), eq(eventHandicaps.tenantId, TENANT_ID)));
    expect(rows).toHaveLength(2);
    const ghinRow = rows.find((r) => r.playerId === s.ghinPlayerId)!;
    const manualRow = rows.find((r) => r.playerId === s.manualPlayerId)!;
    expect(ghinRow.source).toBe('ghin');
    expect(ghinRow.handicapIndex).toBe(8.4);
    expect(ghinRow.ghinValueDate).toBe('2026-06-01');
    expect(manualRow.source).toBe('manual');
    expect(manualRow.handicapIndex).toBe(12.5);

    const evt = (await db.select().from(events).where(eq(events.id, s.eventId)))[0]!;
    expect(evt.handicapLockDate).toBe(Date.parse('2026-06-10T00:00:00.000Z'));
  });

  it('falls back to manual when GHIN has no revision on/before the cutoff', async () => {
    const s = await seed({ withRoster: true });
    ghin.getHandicapHistory.mockResolvedValue([
      { revisionDate: '2026-07-01', value: 7.0, displayValue: '7.0' }, // after cutoff
    ]);
    const res = await lock(s.eventId, s.organizerSessionId, { lockDate: '2026-06-10' });
    expect(res.status).toBe(200);
    const ghinRow = (
      await db.select().from(eventHandicaps).where(eq(eventHandicaps.playerId, s.ghinPlayerId))
    )[0]!;
    expect(ghinRow.source).toBe('manual');
    expect(ghinRow.handicapIndex).toBe(10.0); // the GHIN player's manual fallback
  });

  it('re-locking overwrites the prior snapshot', async () => {
    const s = await seed({ withRoster: true });
    ghin.getHandicapHistory.mockResolvedValue([
      { revisionDate: '2026-06-01', value: 8.4, displayValue: '8.4' },
    ]);
    await lock(s.eventId, s.organizerSessionId, { lockDate: '2026-06-10' });
    ghin.getHandicapHistory.mockResolvedValue([
      { revisionDate: '2026-04-01', value: 9.9, displayValue: '9.9' },
    ]);
    await lock(s.eventId, s.organizerSessionId, { lockDate: '2026-04-15' });

    const rows = await db.select().from(eventHandicaps).where(eq(eventHandicaps.eventId, s.eventId));
    expect(rows).toHaveLength(2); // not 4 — overwrite, not append
    expect(rows.find((r) => r.playerId === s.ghinPlayerId)!.handicapIndex).toBe(9.9);
  });

  it('400 on a malformed lock date', async () => {
    const s = await seed({ withRoster: true });
    const res = await lock(s.eventId, s.organizerSessionId, { lockDate: '06/10/2026' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_lock_date');
  });

  it('422 when the roster is empty', async () => {
    const s = await seed({ withRoster: false });
    const res = await lock(s.eventId, s.organizerSessionId, { lockDate: '2026-06-10' });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('empty_roster');
  });

  it('403 non-organizer cannot lock', async () => {
    const s = await seed({ withRoster: true });
    const res = await lock(s.eventId, s.nonOrganizerSessionId, { lockDate: '2026-06-10' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/events/:eventId/handicaps/unlock', () => {
  it('clears the snapshot + lock date', async () => {
    const s = await seed({ withRoster: true });
    ghin.getHandicapHistory.mockResolvedValue([
      { revisionDate: '2026-06-01', value: 8.4, displayValue: '8.4' },
    ]);
    await testApp.request(`/api/admin/events/${s.eventId}/handicaps/lock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookie(s.organizerSessionId) },
      body: JSON.stringify({ lockDate: '2026-06-10' }),
    });
    expect((await db.select().from(eventHandicaps).where(eq(eventHandicaps.eventId, s.eventId))).length).toBe(2);

    const res = await testApp.request(`/api/admin/events/${s.eventId}/handicaps/unlock`, {
      method: 'POST',
      headers: { cookie: cookie(s.organizerSessionId) },
    });
    expect(res.status).toBe(200);
    expect((await db.select().from(eventHandicaps).where(eq(eventHandicaps.eventId, s.eventId))).length).toBe(0);
    const evt = (await db.select().from(events).where(eq(events.id, s.eventId)))[0]!;
    expect(evt.handicapLockDate).toBeNull();
  });

  it('403 non-organizer cannot unlock', async () => {
    const s = await seed({ withRoster: true });
    const res = await testApp.request(`/api/admin/events/${s.eventId}/handicaps/unlock`, {
      method: 'POST',
      headers: { cookie: cookie(s.nonOrganizerSessionId) },
    });
    expect(res.status).toBe(403);
  });
});
