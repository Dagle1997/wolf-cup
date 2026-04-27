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

const { db } = await import('../db/index.js');
const { players, events, invites } = await import('../db/schema/index.js');
const { requireInviteToken } = await import('./require-invite-token.js');
const { requestIdMiddleware } = await import('./request-id.js');

const TENANT_ID = 'guyan';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(invites);
  await db.delete(events);
  await db.delete(players);
});

/**
 * Seed a player + event + invite. Returns IDs the tests need.
 */
async function seedInvite(opts: {
  token: string;
  expiresAt: number;
  tenantId?: string;
}): Promise<{ eventId: string; inviteId: string }> {
  const now = Date.now();
  const organizerId = randomUUID();
  await db.insert(players).values({
    id: organizerId,
    isOrganizer: true,
    createdAt: now,
    tenantId: opts.tenantId ?? TENANT_ID,
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
    tenantId: opts.tenantId ?? TENANT_ID,
    contextId: `event:${eventId}`,
  });

  const inviteId = randomUUID();
  await db.insert(invites).values({
    id: inviteId,
    eventId,
    token: opts.token,
    expiresAt: opts.expiresAt,
    createdByPlayerId: organizerId,
    createdAt: now,
    tenantId: opts.tenantId ?? TENANT_ID,
    contextId: `event:${eventId}`,
  });

  return { eventId, inviteId };
}

describe('requireInviteToken middleware', () => {
  test('next() called + c.get("invite") set when token is valid + non-expired', async () => {
    const token = 'a'.repeat(43); // matches base64url shape
    const { eventId, inviteId } = await seedInvite({
      token,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    const app = new Hono();
    app.use('*', requestIdMiddleware);
    app.use('/spectator/:token/*', requireInviteToken);
    app.get('/spectator/:token/x', (c) => {
      const invite = c.get('invite');
      return c.json({ invite });
    });

    const res = await app.request(`/spectator/${token}/x`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      invite: { eventId: string; inviteId: string };
    };
    expect(body.invite).toEqual({ eventId, inviteId });
  });

  test('500 middleware_misuse_no_token when route lacks :token param', async () => {
    const app = new Hono();
    app.use('*', requestIdMiddleware);
    app.use('/notoken/*', requireInviteToken);
    app.get('/notoken/x', (c) => c.json({ ok: true }));

    const res = await app.request('/notoken/x');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('middleware_misuse_no_token');
  });

  test('401 invite_token_invalid when token is malformed (too short)', async () => {
    const app = new Hono();
    app.use('*', requestIdMiddleware);
    app.use('/spectator/:token/*', requireInviteToken);
    app.get('/spectator/:token/x', (c) => c.json({ ok: true }));

    // 5 chars — below TOKEN_MIN_LEN.
    const res = await app.request('/spectator/short/x');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invite_token_invalid');
  });

  test('401 invite_token_invalid when token contains illegal chars', async () => {
    const app = new Hono();
    app.use('*', requestIdMiddleware);
    app.use('/spectator/:token/*', requireInviteToken);
    app.get('/spectator/:token/x', (c) => c.json({ ok: true }));

    // 20 chars but with a `.` (not in base64url charset).
    const res = await app.request('/spectator/aaaaaaaaaa.aaaaaaaaa/x');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invite_token_invalid');
  });

  test('401 invite_not_found when token is well-shaped but no row matches', async () => {
    // Don't seed any invite.
    const token = 'b'.repeat(43);

    const app = new Hono();
    app.use('*', requestIdMiddleware);
    app.use('/spectator/:token/*', requireInviteToken);
    app.get('/spectator/:token/x', (c) => c.json({ ok: true }));

    const res = await app.request(`/spectator/${token}/x`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invite_not_found');
  });

  test('401 invite_expired when row has expires_at <= now', async () => {
    const token = 'c'.repeat(43);
    await seedInvite({
      token,
      expiresAt: Date.now() - 1000, // already expired
    });

    const app = new Hono();
    app.use('*', requestIdMiddleware);
    app.use('/spectator/:token/*', requireInviteToken);
    app.get('/spectator/:token/x', (c) => c.json({ ok: true }));

    const res = await app.request(`/spectator/${token}/x`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invite_expired');
  });

  test('cross-tenant: invite row in foreign tenant → 401 invite_not_found', async () => {
    const token = 'd'.repeat(43);
    await seedInvite({
      token,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      tenantId: 'other-tenant',
    });

    const app = new Hono();
    app.use('*', requestIdMiddleware);
    app.use('/spectator/:token/*', requireInviteToken);
    app.get('/spectator/:token/x', (c) => c.json({ ok: true }));

    const res = await app.request(`/spectator/${token}/x`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invite_not_found');
  });
});
