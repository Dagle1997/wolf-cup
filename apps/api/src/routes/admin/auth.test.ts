import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { vi } from 'vitest';
import bcrypt from 'bcrypt';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { eq } from 'drizzle-orm';

vi.mock('../../db/index.js', async () => {
  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../../db/schema.js');
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client, { schema });
  return { db };
});

import authApp from './auth.js';
import { db } from '../../db/index.js';
import { admins, sessions } from '../../db/schema.js';
import { migrate } from 'drizzle-orm/libsql/migrator';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, '../../db/migrations');

const TEST_USERNAME = 'testadmin';
const TEST_PASSWORD = 'testpass123';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  await db.insert(admins).values({
    username: TEST_USERNAME,
    passwordHash,
    createdAt: Date.now(),
  });
});

afterEach(async () => {
  await db.delete(sessions);
});

describe('POST /login', () => {
  it('returns 200 and sets session cookie on valid credentials', async () => {
    const res = await authApp.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { adminId: number; username: string };
    expect(body).toHaveProperty('adminId');
    expect(body.username).toBe(TEST_USERNAME);
    const cookie = res.headers.get('set-cookie');
    expect(cookie).toContain('session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('returns 401 on wrong password', async () => {
    const res = await authApp.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: 'wrongpassword' }),
    });

    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 401 on unknown username', async () => {
    const res = await authApp.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'unknownuser', password: 'anypassword' }),
    });

    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 400 on missing body fields', async () => {
    const res = await authApp.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 on malformed JSON body', async () => {
    const res = await authApp.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not json',
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /logout', () => {
  it('returns 200 and deletes session with valid session cookie', async () => {
    // Login to get a session
    const loginRes = await authApp.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    });
    const setCookieHeader = loginRes.headers.get('set-cookie') ?? '';
    const sessionMatch = setCookieHeader.match(/session=([^;]+)/);
    expect(sessionMatch).not.toBeNull();
    const sessionId = sessionMatch![1]!;

    const logoutRes = await authApp.request('/logout', {
      method: 'POST',
      headers: { Cookie: `session=${sessionId}` },
    });

    expect(logoutRes.status).toBe(200);
    const body = await logoutRes.json() as { success: boolean };
    expect(body.success).toBe(true);

    // Verify session cookie is cleared in response
    const clearCookie = logoutRes.headers.get('set-cookie');
    expect(clearCookie).toContain('session=');
    expect(clearCookie).toMatch(/Max-Age=0|Expires=/);

    // Verify session deleted from DB
    const session = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();
    expect(session).toBeUndefined();
  });

  it('returns 401 without session cookie', async () => {
    const res = await authApp.request('/logout', {
      method: 'POST',
    });

    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('UNAUTHORIZED');
  });
});
