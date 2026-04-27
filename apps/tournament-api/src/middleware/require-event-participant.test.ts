import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { vi } from 'vitest';

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
const { players, events, groups, groupMembers } = await import('../db/schema/index.js');
const { requireEventParticipant } = await import('./require-event-participant.js');
const { requestIdMiddleware } = await import('./request-id.js');

const TENANT_ID = 'guyan';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(events);
  await db.delete(players);
});

/**
 * Plants `c.get('player')` directly so tests can exercise
 * requireEventParticipant in isolation without a real session. Mirror of
 * the pattern in `require-organizer.test.ts`.
 */
function stubPlayerMiddleware(player: { id: string; isOrganizer: boolean } | undefined) {
  return async (c: import('hono').Context, next: () => Promise<void>) => {
    if (player !== undefined) {
      c.set('player', player);
    }
    await next();
  };
}

/**
 * Seeds an event + 1 group + N players + group_members for each.
 * Returns the IDs needed by the tests.
 */
async function seedEventWithMembers(opts: {
  playerIds: string[];
  tenantIdForGroups?: string;
  tenantIdForGroupMembers?: string;
}): Promise<{ eventId: string; groupId: string; organizerId: string }> {
  const now = Date.now();
  const organizerId = randomUUID();
  await db.insert(players).values({
    id: organizerId,
    isOrganizer: true,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: 'league:guyan-wolf-cup-friday',
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

  const groupId = randomUUID();
  await db.insert(groups).values({
    id: groupId,
    eventId,
    name: 'Test Group',
    moneyVisibilityMode: 'open',
    createdAt: now,
    tenantId: opts.tenantIdForGroups ?? TENANT_ID,
    contextId: `event:${eventId}`,
  });

  for (const playerId of opts.playerIds) {
    await db.insert(players).values({
      id: playerId,
      isOrganizer: false,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    await db.insert(groupMembers).values({
      groupId,
      playerId,
      tenantId: opts.tenantIdForGroupMembers ?? TENANT_ID,
      contextId: `event:${eventId}`,
    });
  }

  return { eventId, groupId, organizerId };
}

describe('requireEventParticipant middleware', () => {
  test('next() called when player IS in group_members for the event', async () => {
    const playerId = randomUUID();
    const { eventId } = await seedEventWithMembers({ playerIds: [playerId] });

    const app = new Hono();
    app.use('*', requestIdMiddleware);
    app.use('*', stubPlayerMiddleware({ id: playerId, isOrganizer: false }));
    app.use('/events/:eventId/*', requireEventParticipant);
    app.get('/events/:eventId/x', (c) => c.json({ ok: true }));

    const res = await app.request(`/events/${eventId}/x`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test('403 not_event_participant when player is NOT in any group_members for the event', async () => {
    const memberId = randomUUID();
    const outsiderId = randomUUID();
    const { eventId } = await seedEventWithMembers({ playerIds: [memberId] });
    // Insert outsider player but NOT a member.
    await db.insert(players).values({
      id: outsiderId,
      isOrganizer: false,
      createdAt: Date.now(),
      tenantId: TENANT_ID,
      contextId: 'league:guyan-wolf-cup-friday',
    });

    const app = new Hono();
    app.use('*', requestIdMiddleware);
    app.use('*', stubPlayerMiddleware({ id: outsiderId, isOrganizer: false }));
    app.use('/events/:eventId/*', requireEventParticipant);
    app.get('/events/:eventId/x', (c) => c.json({ ok: true }));

    const res = await app.request(`/events/${eventId}/x`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_event_participant');
  });

  test('403 not_event_participant when player is in groups for a DIFFERENT event', async () => {
    const playerId = randomUUID();
    // Player is a member of event A.
    await seedEventWithMembers({ playerIds: [playerId] });
    // Create a separate event B with no member.
    const eventB = await seedEventWithMembers({ playerIds: [randomUUID()] });

    const app = new Hono();
    app.use('*', requestIdMiddleware);
    app.use('*', stubPlayerMiddleware({ id: playerId, isOrganizer: false }));
    app.use('/events/:eventId/*', requireEventParticipant);
    app.get('/events/:eventId/x', (c) => c.json({ ok: true }));

    // Hit event B — the player is in event A only.
    const res = await app.request(`/events/${eventB.eventId}/x`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_event_participant');
  });

  test('500 middleware_misuse when requireSession is not ahead in chain (player undefined)', async () => {
    const eventId = randomUUID();

    const app = new Hono();
    app.use('*', requestIdMiddleware);
    // Intentionally omit stubPlayerMiddleware.
    app.use('/events/:eventId/*', requireEventParticipant);
    app.get('/events/:eventId/x', (c) => c.json({ ok: true }));

    const res = await app.request(`/events/${eventId}/x`);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('middleware_misuse');
  });

  test('500 middleware_misuse_no_event_id when route lacks :eventId param', async () => {
    const playerId = randomUUID();

    const app = new Hono();
    app.use('*', requestIdMiddleware);
    app.use('*', stubPlayerMiddleware({ id: playerId, isOrganizer: false }));
    // Mount on a route WITHOUT :eventId.
    app.use('/notevents/*', requireEventParticipant);
    app.get('/notevents/x', (c) => c.json({ ok: true }));

    const res = await app.request('/notevents/x');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('middleware_misuse_no_event_id');
  });

  test('cross-tenant on groups.tenant_id: foreign-tenant group → 403', async () => {
    const playerId = randomUUID();
    const { eventId } = await seedEventWithMembers({
      playerIds: [playerId],
      tenantIdForGroups: 'other-tenant', // groups row in foreign tenant
    });

    const app = new Hono();
    app.use('*', requestIdMiddleware);
    app.use('*', stubPlayerMiddleware({ id: playerId, isOrganizer: false }));
    app.use('/events/:eventId/*', requireEventParticipant);
    app.get('/events/:eventId/x', (c) => c.json({ ok: true }));

    const res = await app.request(`/events/${eventId}/x`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_event_participant');
  });

  test('cross-tenant on group_members.tenant_id: foreign-tenant member row → 403', async () => {
    const playerId = randomUUID();
    const { eventId } = await seedEventWithMembers({
      playerIds: [playerId],
      tenantIdForGroupMembers: 'other-tenant', // group_members row in foreign tenant
    });

    const app = new Hono();
    app.use('*', requestIdMiddleware);
    app.use('*', stubPlayerMiddleware({ id: playerId, isOrganizer: false }));
    app.use('/events/:eventId/*', requireEventParticipant);
    app.get('/events/:eventId/x', (c) => c.json({ ok: true }));

    const res = await app.request(`/events/${eventId}/x`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_event_participant');
  });
});
