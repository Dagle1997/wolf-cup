import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

// Mock the shared db module BEFORE importing anything that uses it.
// Shared in-memory DB so schema stays consistent across the test file.
vi.mock('../db/index.js', async () => {
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client);
  return { client, db };
});

// Imports AFTER the mock so session.ts picks up the in-memory db.
const { db } = await import('../db/index.js');
const { players, sessions } = await import('../db/schema/index.js');
const {
  createSession,
  validateSession,
  deleteSession,
  sessionCookieHeader,
} = await import('./session.js');

const ALICE = 'player-alice-0001';
const ORGANIZER = 'player-org-0002';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(sessions);
  await db.delete(players);
  const now = Date.now();
  await db.insert(players).values([
    { id: ALICE, isOrganizer: false, createdAt: now, contextId: 'ctx:test' },
    { id: ORGANIZER, isOrganizer: true, createdAt: now, contextId: 'ctx:test' },
  ]);
});

describe('session helpers', () => {
  test('createSession persists a row and returns a Set-Cookie header with the cookie value', async () => {
    const now = () => 1_700_000_000_000;
    const { sessionId, setCookieHeader } = await createSession(
      ALICE,
      { userAgent: 'Mozilla/5.0 Vitest', ip: '127.0.0.1' },
      now,
    );
    expect(sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/); // base64url, 32 bytes → 43 chars
    expect(setCookieHeader).toContain(`tournament_session=${sessionId}`);
    expect(setCookieHeader).toContain('HttpOnly');
    expect(setCookieHeader).toContain('SameSite=Strict');
    expect(setCookieHeader).toContain('Max-Age=604800');

    const rows = await db.select().from(sessions).where(eq(sessions.sessionId, sessionId));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.playerId).toBe(ALICE);
    expect(row.createdAt).toBe(1_700_000_000_000);
    expect(row.expiresAt).toBe(1_700_000_000_000 + 7 * 86400 * 1000);
    expect(row.deviceInfo).toBe('Mozilla/5.0 Vitest|127.0.0.1');
  });

  test('createSession truncates device_info to 128 chars', async () => {
    const longUa = 'a'.repeat(300);
    const { sessionId } = await createSession(ALICE, { userAgent: longUa, ip: '::1' });
    const rows = await db.select().from(sessions).where(eq(sessions.sessionId, sessionId));
    expect(rows[0]!.deviceInfo!.length).toBe(128);
  });

  test('validateSession rolls lastSeenAt and expiresAt forward on a valid session', async () => {
    const created = () => 1_700_000_000_000;
    const { sessionId } = await createSession(
      ALICE,
      { userAgent: 'ua', ip: 'ip' },
      created,
    );

    const later = () => 1_700_000_000_000 + 60 * 60 * 1000; // +1h
    const result = await validateSession(sessionId, later);
    expect(result).toEqual({ playerId: ALICE, isOrganizer: false });

    const rows = await db.select().from(sessions).where(eq(sessions.sessionId, sessionId));
    const row = rows[0]!;
    expect(row.lastSeenAt).toBe(later());
    expect(row.expiresAt).toBe(later() + 7 * 86400 * 1000);
  });

  test('validateSession rejects a session expired past the rolling 7-day window', async () => {
    const created = () => 1_700_000_000_000;
    const { sessionId } = await createSession(
      ALICE,
      { userAgent: 'ua', ip: 'ip' },
      created,
    );
    // Skip ahead 7 days + 1ms — past the rolling expiration.
    const expired = () => created() + 7 * 86400 * 1000 + 1;
    expect(await validateSession(sessionId, expired)).toBeNull();
  });

  test('validateSession rejects a session past the 30-day hard cap even if rolling is fresh', async () => {
    const created = () => 1_700_000_000_000;
    const { sessionId } = await createSession(
      ALICE,
      { userAgent: 'ua', ip: 'ip' },
      created,
    );

    // Roll the session forward several times within the 30-day window — this
    // would leave expiresAt well past 30 days from createdAt via normal
    // rolling, but the hard cap should still reject.
    await validateSession(sessionId, () => created() + 5 * 86400 * 1000);
    await validateSession(sessionId, () => created() + 15 * 86400 * 1000);
    await validateSession(sessionId, () => created() + 25 * 86400 * 1000);

    // Day 30 + 1ms: hard cap triggered.
    const past = () => created() + 30 * 86400 * 1000 + 1;
    expect(await validateSession(sessionId, past)).toBeNull();
  });

  test('validateSession returns isOrganizer: true when the bound player is an organizer', async () => {
    const { sessionId } = await createSession(ORGANIZER, { userAgent: 'ua', ip: 'ip' });
    const result = await validateSession(sessionId);
    expect(result).toEqual({ playerId: ORGANIZER, isOrganizer: true });
  });

  test('deleteSession removes the row', async () => {
    const { sessionId } = await createSession(ALICE, { userAgent: 'ua', ip: 'ip' });
    await deleteSession(sessionId);
    expect(await validateSession(sessionId)).toBeNull();
  });

  test('sessionCookieHeader emits dev attributes under NODE_ENV=test (no Secure, no Domain)', () => {
    // Default in test-setup is NODE_ENV=test.
    const header = sessionCookieHeader('abc123');
    expect(header).toContain('tournament_session=abc123');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=604800');
    expect(header).not.toContain('Secure');
    expect(header).not.toContain('Domain=');
  });

  test('sessionCookieHeader emits clear-cookie (Max-Age=0) when value is null', () => {
    const header = sessionCookieHeader(null);
    expect(header).toContain('tournament_session=');
    expect(header).toContain('Max-Age=0');
  });

  test('sessionCookieHeader rejects non-base64url values with a throw (header-injection guard)', () => {
    // Any attempt to pass a semicolon or other attribute-delimiter
    // character must throw rather than silently emit a malformed
    // header.
    expect(() => sessionCookieHeader('abc; Path=/evil')).toThrow();
    expect(() => sessionCookieHeader('has space')).toThrow();
    expect(() => sessionCookieHeader('has\nnewline')).toThrow();
  });

  test('sessionCookieHeader emits production attributes (Secure + Domain) when NODE_ENV=production', async () => {
    // vi.stubEnv affects process.env at the time of read, but env.ts has
    // already parsed it at module-load time. To test the production
    // branch we mock the env module before the test runs and dynamically
    // import sessionCookieHeader against the mocked env.
    //
    // try/finally around the mock → unmock → resetModules cleanup ensures
    // subsequent tests (in this file or others) don't inherit the mocked
    // env.js even if an expect() throws mid-test.
    vi.resetModules();
    vi.doMock('./env.js', () => ({
      env: {
        NODE_ENV: 'production',
        DB_PATH: 'unused-in-this-test',
        PORT: 3000,
        AUTH_COOKIE_DOMAIN: 'tournament.dagle.cloud',
        PUBLIC_APP_URL: 'https://tournament.dagle.cloud',
      },
    }));
    try {
      const { sessionCookieHeader: prodHeader } = await import('./session.js');
      const header = prodHeader('A'.repeat(43));
      expect(header).toContain('Secure');
      expect(header).toContain('Domain=tournament.dagle.cloud');
      expect(header).toContain('HttpOnly');
      expect(header).toContain('SameSite=Strict');
      expect(header).toContain('Max-Age=604800');
    } finally {
      vi.doUnmock('./env.js');
      vi.resetModules();
    }
  });
});
