/**
 * admin-event-game-config.test.ts (Story 1.3) — route-level contract.
 *
 * Organizer-gated (401 anon / 403 non-organizer / 403 organizer-of-another-
 * event). PUT seeds the event default (and a lock-only PUT preserves the
 * schedule); GET game-config returns the row or null; GET resolved-config
 * returns { ok:true, config } for the seeded default and 404 for a cross-event
 * round.
 */
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
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
  players, events, eventRounds, rounds, pairings, sessions, gameConfig, ruleSets, ruleSetRevisions,
  activity, auditLog, courses, courseRevisions,
} = await import('../db/schema/index.js');
const { adminEventGameConfigRouter } = await import('./admin-event-game-config.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT_ID = 'guyan';
const CTX = 'league:guyan';

const testApp = new Hono();
testApp.use('*', requestIdMiddleware);
testApp.route('/api/admin', adminEventGameConfigRouter);

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  // eslint-disable-next-line no-restricted-syntax -- test-cleanup truncate only; the T8-1 rule targets production emit paths, not beforeEach teardown
  await db.delete(activity);
  await db.delete(auditLog);
  await db.delete(gameConfig);
  await db.delete(ruleSetRevisions);
  await db.delete(ruleSets);
  await db.delete(pairings);
  await db.delete(rounds);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(sessions);
  await db.delete(players);
});

async function seedPlayerWithSession(name: string, isOrganizer: boolean) {
  const now = Date.now();
  const id = randomUUID();
  await db.insert(players).values({ id, isOrganizer, createdAt: now, name, tenantId: TENANT_ID, contextId: CTX });
  const sessionId = randomUUID().replace(/-/g, '') + 'a'.repeat(8);
  await db.insert(sessions).values({
    sessionId, playerId: id, createdAt: now, lastSeenAt: now,
    expiresAt: now + 7 * 86_400_000, deviceInfo: null, contextId: CTX,
  });
  return { id, sessionId };
}

interface Seed {
  organizerSessionId: string;
  otherOrganizerSessionId: string;
  nonOrganizerSessionId: string;
  organizerId: string;
  eventId: string;
  roundId: string;
  courseRevisionId: string;
}

/** Seed the shared course revision once (UNIQUE-safe across the per-test seed). */
async function seedCourseRevision(): Promise<string> {
  const now = Date.now();
  const courseId = randomUUID();
  const courseRevisionId = randomUUID();
  await db.insert(courses).values({ id: courseId, name: 'Pete Dye', clubName: 'Resort', createdAt: now, tenantId: TENANT_ID, contextId: `library:${TENANT_ID}` });
  await db.insert(courseRevisions).values({
    id: courseRevisionId, courseId, revisionNumber: 1, outTotal: 36, inTotal: 36, courseTotal: 72,
    createdAt: now, tenantId: TENANT_ID, contextId: `library:${TENANT_ID}`,
  });
  return courseRevisionId;
}

/** Seed an event + one event_round + scoring round against a given course rev. */
async function seedEvent(organizerId: string, courseRevisionId: string): Promise<{ eventId: string; roundId: string }> {
  const now = Date.now();
  const eventId = randomUUID();
  await db.insert(events).values({
    id: eventId, name: 'Test Event', startDate: 1, endDate: 2, timezone: 'America/New_York',
    organizerPlayerId: organizerId, createdAt: now, tenantId: TENANT_ID, contextId: `event:${eventId}`,
  });
  const eventRoundId = randomUUID();
  await db.insert(eventRounds).values({
    id: eventRoundId, eventId, roundNumber: 1, roundDate: 1, courseRevisionId, teeColor: 'Dye',
    holesToPlay: 18, createdAt: now, tenantId: TENANT_ID, contextId: `event:${eventId}`,
  });
  const roundId = randomUUID();
  await db.insert(rounds).values({
    id: roundId, eventId, eventRoundId, holesToPlay: 18, createdAt: now, tenantId: TENANT_ID, contextId: `event:${eventId}`,
  });
  return { eventId, roundId };
}

async function seed(): Promise<Seed> {
  const organizer = await seedPlayerWithSession('Organizer', true);
  const otherOrganizer = await seedPlayerWithSession('Other Organizer', true);
  const nonOrganizer = await seedPlayerWithSession('Non-Organizer', false);
  const courseRevisionId = await seedCourseRevision();
  const { eventId, roundId } = await seedEvent(organizer.id, courseRevisionId);

  return {
    organizerSessionId: organizer.sessionId,
    otherOrganizerSessionId: otherOrganizer.sessionId,
    nonOrganizerSessionId: nonOrganizer.sessionId,
    organizerId: organizer.id,
    eventId,
    roundId,
    courseRevisionId,
  };
}

const cookie = (sid: string) => `tournament_session=${sid}`;

function put(eventId: string, sid: string, body: unknown) {
  return testApp.request(`/api/admin/events/${eventId}/game-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: cookie(sid) },
    body: JSON.stringify(body),
  });
}

// ── Epic 6: per-foursome config routes ───────────────────────────────────
async function eventRoundIdFor(eventId: string): Promise<string> {
  const rows = await db.select({ id: eventRounds.id }).from(eventRounds).where(eq(eventRounds.eventId, eventId)).limit(1);
  return rows[0]!.id;
}
async function seedPairing(eventRoundId: string, foursomeNumber: number): Promise<void> {
  await db.insert(pairings).values({ id: randomUUID(), eventRoundId, foursomeNumber, createdAt: Date.now(), tenantId: TENANT_ID, contextId: CTX });
}
function foursomeUrl(eventId: string, erId: string, n: number) {
  return `/api/admin/events/${eventId}/rounds/${erId}/foursomes/${n}/game-config`;
}

describe('foursome game-config routes (Epic 6)', () => {
  it('PUT creates a foursome override (sandie off) inheriting the event base; GET returns it; DELETE clears it', async () => {
    const s = await seed();
    await put(s.eventId, s.organizerSessionId, { pointValueSchedule: { kind: 'flat', cents: 500 } }); // event base
    const erId = await eventRoundIdFor(s.eventId);
    await seedPairing(erId, 1);

    // PUT the foursome's pills: net-skins on, sandie OFF, $10 stake.
    const putRes = await testApp.request(foursomeUrl(s.eventId, erId, 1), {
      method: 'PUT', headers: { 'content-type': 'application/json', cookie: cookie(s.organizerSessionId) },
      body: JSON.stringify({
        modifiers: [
          { type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single' } },
          { type: 'sandie', enabled: false },
        ],
        pointValueSchedule: { kind: 'flat', cents: 1000 },
      }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await testApp.request(foursomeUrl(s.eventId, erId, 1), { headers: { cookie: cookie(s.organizerSessionId) } });
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as { foursomeConfig: { configJson: string } | null; eventConfig: unknown };
    expect(body.foursomeConfig).not.toBeNull();
    const cfg = JSON.parse(body.foursomeConfig!.configJson) as { pointValueSchedule: { cents: number }; modifiers: Array<{ type: string; enabled: boolean }> };
    expect(cfg.pointValueSchedule.cents).toBe(1000);
    expect(cfg.modifiers.find((m) => m.type === 'sandie')!.enabled).toBe(false);

    const delRes = await testApp.request(foursomeUrl(s.eventId, erId, 1), { method: 'DELETE', headers: { cookie: cookie(s.organizerSessionId) } });
    expect(delRes.status).toBe(200);
    const afterDel = await testApp.request(foursomeUrl(s.eventId, erId, 1), { headers: { cookie: cookie(s.organizerSessionId) } });
    expect(((await afterDel.json()) as { foursomeConfig: unknown }).foursomeConfig).toBeNull();
  });

  it('404 when the event has no event-level config (cannot override a non-F1 event)', async () => {
    const s = await seed();
    const erId = await eventRoundIdFor(s.eventId);
    await seedPairing(erId, 1);
    const res = await testApp.request(foursomeUrl(s.eventId, erId, 1), {
      method: 'PUT', headers: { 'content-type': 'application/json', cookie: cookie(s.organizerSessionId) },
      body: JSON.stringify({ modifiers: [{ type: 'sandie', enabled: false }], pointValueSchedule: { kind: 'flat', cents: 500 } }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('no_event_config');
  });

  it('403 for an organizer of another event', async () => {
    const s = await seed();
    const erId = await eventRoundIdFor(s.eventId);
    await seedPairing(erId, 1);
    const res = await testApp.request(foursomeUrl(s.eventId, erId, 1), {
      method: 'PUT', headers: { 'content-type': 'application/json', cookie: cookie(s.otherOrganizerSessionId) },
      body: JSON.stringify({ modifiers: [], pointValueSchedule: { kind: 'flat', cents: 500 } }),
    });
    expect(res.status).toBe(403);
  });

  it('404 when the foursome number does not exist in the round', async () => {
    const s = await seed();
    await put(s.eventId, s.organizerSessionId, { pointValueSchedule: { kind: 'flat', cents: 500 } });
    const erId = await eventRoundIdFor(s.eventId);
    // no pairing seeded → foursome 1 not found
    const res = await testApp.request(foursomeUrl(s.eventId, erId, 1), {
      method: 'PUT', headers: { 'content-type': 'application/json', cookie: cookie(s.organizerSessionId) },
      body: JSON.stringify({ modifiers: [{ type: 'sandie', enabled: false }], pointValueSchedule: { kind: 'flat', cents: 500 } }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('foursome_not_found');
  });
});

describe('GET /api/admin/events/:eventId/game-config', () => {
  it('returns null when unseeded; the row once seeded', async () => {
    const s = await seed();
    const before = await testApp.request(`/api/admin/events/${s.eventId}/game-config`, { headers: { cookie: cookie(s.organizerSessionId) } });
    expect(before.status).toBe(200);
    expect(((await before.json()) as { config: unknown }).config).toBeNull();

    await put(s.eventId, s.organizerSessionId, { pointValueSchedule: { kind: 'flat', cents: 500 } });

    const after = await testApp.request(`/api/admin/events/${s.eventId}/game-config`, { headers: { cookie: cookie(s.organizerSessionId) } });
    const body = (await after.json()) as { config: { lockState: string; configVersion: number } | null };
    expect(body.config).not.toBeNull();
    expect(body.config!.lockState).toBe('locked');
  });

  it('401 anonymous', async () => {
    const s = await seed();
    const res = await testApp.request(`/api/admin/events/${s.eventId}/game-config`);
    expect(res.status).toBe(401);
  });

  it('403 non-organizer', async () => {
    const s = await seed();
    const res = await testApp.request(`/api/admin/events/${s.eventId}/game-config`, { headers: { cookie: cookie(s.nonOrganizerSessionId) } });
    expect(res.status).toBe(403);
  });

  it('403 organizer-of-another-event', async () => {
    const s = await seed();
    const res = await testApp.request(`/api/admin/events/${s.eventId}/game-config`, { headers: { cookie: cookie(s.otherOrganizerSessionId) } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_event_organizer');
  });
});

describe('PUT /api/admin/events/:eventId/game-config', () => {
  it('seeds the event default (locked, $5)', async () => {
    const s = await seed();
    const res = await put(s.eventId, s.organizerSessionId, { pointValueSchedule: { kind: 'flat', cents: 500 } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { config: { lockState: string; configJson: string } };
    expect(body.config.lockState).toBe('locked');
    expect(JSON.parse(body.config.configJson).pointValueSchedule.cents).toBe(500);
  });

  it('400 on the first seed with no point value', async () => {
    const s = await seed();
    const res = await put(s.eventId, s.organizerSessionId, { lockState: 'unlocked' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { reason: string }).reason).toBe('point_value_required_on_seed');
  });

  it('a lock-only PUT preserves the schedule + emits an update', async () => {
    const s = await seed();
    await put(s.eventId, s.organizerSessionId, { pointValueSchedule: { kind: 'flat', cents: 500 } });
    const res = await put(s.eventId, s.organizerSessionId, { lockState: 'unlocked' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { config: { lockState: string; configJson: string } };
    expect(body.config.lockState).toBe('unlocked');
    expect(JSON.parse(body.config.configJson).pointValueSchedule.cents).toBe(500);
  });

  it('400 on an odd-cents (invalid) point value', async () => {
    const s = await seed();
    const res = await put(s.eventId, s.organizerSessionId, { pointValueSchedule: { kind: 'flat', cents: 501 } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_config');
  });

  it('403 non-organizer cannot PUT', async () => {
    const s = await seed();
    const res = await put(s.eventId, s.nonOrganizerSessionId, { pointValueSchedule: { kind: 'flat', cents: 500 } });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/events/:eventId/resolved-config', () => {
  it('returns the seeded event default', async () => {
    const s = await seed();
    await put(s.eventId, s.organizerSessionId, { pointValueSchedule: { kind: 'flat', cents: 500 } });
    const res = await testApp.request(`/api/admin/events/${s.eventId}/resolved-config`, { headers: { cookie: cookie(s.organizerSessionId) } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; config: { game: string } };
    expect(body.ok).toBe(true);
    expect(body.config.game).toBe('guyan-2v2');
  });

  it('200 { ok:false } when unseeded (orphan/unsettleable, not a 500)', async () => {
    const s = await seed();
    const res = await testApp.request(`/api/admin/events/${s.eventId}/resolved-config`, { headers: { cookie: cookie(s.organizerSessionId) } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; reason: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('no_event_level_config');
  });

  it('404 when roundId is not under the event', async () => {
    const s = await seed();
    await put(s.eventId, s.organizerSessionId, { pointValueSchedule: { kind: 'flat', cents: 500 } });
    // A second event (reusing the shared course rev) with its own round.
    const other = await seedEvent(s.organizerId, s.courseRevisionId);
    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/resolved-config?roundId=${other.roundId}`,
      { headers: { cookie: cookie(s.organizerSessionId) } },
    );
    expect(res.status).toBe(404);
  });

  it('400 when foursomeNumber is supplied without roundId', async () => {
    const s = await seed();
    await put(s.eventId, s.organizerSessionId, { pointValueSchedule: { kind: 'flat', cents: 500 } });
    const res = await testApp.request(
      `/api/admin/events/${s.eventId}/resolved-config?foursomeNumber=1`,
      { headers: { cookie: cookie(s.organizerSessionId) } },
    );
    expect(res.status).toBe(400);
  });
});
