/**
 * Real-auth E2E (T14-3) — the one path every other test mocks away.
 *
 * Every integration/e2e test in this repo stubs `requireSession` via a
 * `__testPlayer` global. This test exercises the REAL session machinery
 * end to end, mocking ONLY arctic's network token exchange:
 *
 *   invite-claim (anonymous, binds device, session_id NULL)
 *     → Google OAuth callback (arctic stubbed → fake id_token)
 *     → device_binding consolidates onto the new real session (T3-7)
 *     → a gated route authenticates via the UNMOCKED requireSession.
 *
 * `extractSubFromIdToken` only base64-decodes the payload (Google already
 * validated the token via arctic), so a crafted JWT with valid iss/aud/exp/sub
 * passes without a signature.
 */
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

vi.mock('../db/index.js', async () => {
  // Unique temp FILE db per worker process — fully isolated from other files
  // regardless of vitest's fork reuse (see lifecycle-full.e2e for the detail).
  const { tmpdir } = await import('node:os');
  const { rmSync } = await import('node:fs');
  const dbPath = `${tmpdir()}/e2e-auth-invite-rebind-${process.pid}.db`.replace(/\\/g, '/');
  for (const s of ['', '-wal', '-shm']) rmSync(`${dbPath}${s}`, { force: true });
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

// Mock ONLY the arctic token exchange — NOT requireSession.
const validateAuthorizationCode = vi.fn();
vi.mock('../lib/arctic.js', () => ({
  googleOAuth: {
    validateAuthorizationCode,
    createAuthorizationURL: () => new URL('https://accounts.google.com/o/oauth2/v2/auth'),
  },
}));

const { db } = await import('../db/index.js');
const { players, events, groups, groupMembers, invites, deviceBindings } = await import(
  '../db/schema/index.js'
);
const { inviteRouter } = await import('./invites.js');
const { authRouter } = await import('./auth.js');
const { eventsRouter } = await import('./events.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT_ID = 'guyan';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(deviceBindings);
  await db.delete(invites);
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(events);
  await db.delete(players);
  validateAuthorizationCode.mockReset();
});

function buildApp(): Hono {
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/invites', inviteRouter);
  app.route('/api/auth', authRouter);
  app.route('/api/events', eventsRouter);
  return app;
}

/** A crafted id_token — payload only (extractSubFromIdToken skips the sig). */
function fakeIdToken(sub: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: 'test-client-id', // = GOOGLE_OAUTH_CLIENT_ID in test-setup.ts
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub,
    }),
  ).toString('base64url');
  return `${header}.${payload}.signature`;
}

/** Collect Set-Cookie header(s) → value for a given cookie name. */
function cookieFromResponse(res: Response, name: string): string | null {
  const getter = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const headers = typeof getter === 'function' ? getter.call(res.headers) : [];
  const all = headers.length > 0 ? headers : [res.headers.get('set-cookie') ?? ''];
  for (const h of all) {
    const m = new RegExp(`(?:^|, )${name}=([^;]+)`).exec(h);
    if (m && m[1] && m[1].length > 0) return m[1];
  }
  return null;
}

async function seedEventWithInvitee(): Promise<{ eventId: string; token: string; inviteeId: string }> {
  const now = Date.now();
  const organizerId = randomUUID();
  const inviteeId = randomUUID();
  const eventId = randomUUID();
  const ctx = `event:${eventId}`;
  await db.insert(players).values([
    { id: organizerId, isOrganizer: true, createdAt: now, name: 'Org', tenantId: TENANT_ID, contextId: ctx },
    { id: inviteeId, isOrganizer: false, createdAt: now, name: 'Invitee', tenantId: TENANT_ID, contextId: ctx },
  ]);
  await db.insert(events).values({
    id: eventId, name: 'Auth E2E', startDate: now, endDate: now + 86400000,
    timezone: 'America/New_York', organizerPlayerId: organizerId, createdAt: now,
    tenantId: TENANT_ID, contextId: ctx,
  });
  const groupId = randomUUID();
  await db.insert(groups).values({
    id: groupId, eventId, name: 'G', moneyVisibilityMode: 'open', createdAt: now,
    tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(groupMembers).values({
    groupId, playerId: inviteeId, tenantId: TENANT_ID, contextId: ctx,
  });
  const token = randomUUID().replace(/-/g, '');
  await db.insert(invites).values({
    id: randomUUID(), eventId, token, expiresAt: now + 7 * 86400000,
    createdByPlayerId: organizerId, createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  return { eventId, token, inviteeId };
}

describe('E2E: invite-claim → OAuth rebind → real session (requireSession unmocked)', () => {
  test('claims a device, consolidates it onto a real Google session, and authenticates a gated route', async () => {
    const app = buildApp();
    const { eventId, token, inviteeId } = await seedEventWithInvitee();

    // --- 1. Anonymous invite-claim binds the device (session_id NULL). ---
    const claimRes = await app.request(`/api/invites/${token}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId: inviteeId }),
    });
    expect(claimRes.status, await claimRes.clone().text()).toBe(201);
    const deviceId = cookieFromResponse(claimRes, 'tournament_device_id');
    expect(deviceId, 'claim sets a device cookie').toBeTruthy();

    const boundBefore = await db
      .select()
      .from(deviceBindings)
      .where(eq(deviceBindings.id, deviceId!));
    expect(boundBefore.length).toBe(1);
    expect(boundBefore[0]!.playerId).toBe(inviteeId);
    expect(boundBefore[0]!.sessionId).toBeNull(); // not yet consolidated

    // --- 2. OAuth callback (arctic stubbed) issues a real session + rebinds. ---
    validateAuthorizationCode.mockResolvedValue({ idToken: () => fakeIdToken('google-sub-xyz') });
    const state = 'e2e-state-value-0123456789abcdef';
    const cbRes = await app.request(`/api/auth/google/callback?code=authcode&state=${state}`, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        cookie: [
          `tournament_oauth_state=${state}`,
          `tournament_oauth_code_verifier=verifier-0123456789abcdef`,
          `tournament_device_id=${deviceId}`,
        ].join('; '),
      },
    });
    expect(cbRes.status, await cbRes.clone().text()).toBe(302);
    const sessionId = cookieFromResponse(cbRes, 'tournament_session');
    expect(sessionId, 'callback issues a real session cookie').toBeTruthy();

    // Device binding consolidated onto the new session (T3-7).
    const boundAfter = await db
      .select()
      .from(deviceBindings)
      .where(eq(deviceBindings.id, deviceId!));
    expect(boundAfter[0]!.sessionId).toBe(sessionId);
    expect(boundAfter[0]!.playerId).toBe(inviteeId);

    // --- 3. The real (UNMOCKED) requireSession authenticates a gated route. ---
    const meRes = await app.request(`/api/events/${eventId}`, {
      headers: { cookie: `tournament_session=${sessionId}` },
    });
    expect(meRes.status).toBe(200);

    // And a bogus session is rejected by the same real middleware.
    const badRes = await app.request(`/api/events/${eventId}`, {
      headers: { cookie: `tournament_session=not-a-real-session` },
    });
    expect(badRes.status).toBe(401);
  });
});
