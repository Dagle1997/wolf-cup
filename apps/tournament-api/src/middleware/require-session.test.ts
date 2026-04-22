import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

vi.mock('../db/index.js', async () => {
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client);
  return { client, db };
});

const { db } = await import('../db/index.js');
const { players, sessions } = await import('../db/schema/index.js');
const { createSession } = await import('../lib/session.js');
const { requireSession } = await import('./require-session.js');

const ALICE = 'player-alice-req-session';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(sessions);
  await db.delete(players);
  await db.insert(players).values({
    id: ALICE,
    isOrganizer: false,
    createdAt: Date.now(),
    contextId: 'ctx:test',
  });
});

function makeApp() {
  const app = new Hono();
  app.use('*', requireSession);
  app.get('/protected', (c) => {
    const session = c.get('session');
    const player = c.get('player');
    return c.json({ ok: true, sessionPlayerId: session.playerId, playerId: player.id });
  });
  return app;
}

describe('requireSession middleware', () => {
  test('401 session_missing when no cookie is present', async () => {
    const app = makeApp();
    const res = await app.request('/protected');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string; requestId: string };
    expect(body.code).toBe('session_missing');
    expect(typeof body.requestId).toBe('string');
    expect(body.requestId.length).toBeGreaterThan(0);
  });

  test('401 session_invalid + Set-Cookie clear when the cookie is present but the row is gone', async () => {
    const app = makeApp();
    const res = await app.request('/protected', {
      headers: { Cookie: 'tournament_session=ghost-session-id' },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('session_invalid');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('tournament_session=');
    expect(setCookie).toContain('Max-Age=0');
  });

  test('next() called and context set when cookie is valid', async () => {
    const { sessionId } = await createSession(ALICE, { userAgent: 'vitest', ip: '::1' });
    const app = makeApp();
    const res = await app.request('/protected', {
      headers: { Cookie: `tournament_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; sessionPlayerId: string; playerId: string };
    expect(body.ok).toBe(true);
    expect(body.sessionPlayerId).toBe(ALICE);
    expect(body.playerId).toBe(ALICE);
  });

  test('typing: c.get("session").sessionId is string (compile-time via Variables augmentation)', async () => {
    const { sessionId } = await createSession(ALICE, { userAgent: 'vitest', ip: '::1' });
    const app = new Hono();
    app.use('*', requireSession);
    app.get('/typed', (c) => {
      // TypeScript: the `.sessionId` access below must compile without
      // `as any`. If Variables augmentation was missing this would error
      // at compile time, which is caught by `pnpm -F @tournament/api
      // typecheck`. The runtime assertion below mirrors the compile-time
      // check — both must hold.
      const s = c.get('session');
      const typed: string = s.sessionId;
      return c.json({ sessionIdLen: typed.length });
    });
    const res = await app.request('/typed', {
      headers: { Cookie: `tournament_session=${sessionId}` },
    });
    const body = (await res.json()) as { sessionIdLen: number };
    expect(body.sessionIdLen).toBe(sessionId.length);
  });
});
