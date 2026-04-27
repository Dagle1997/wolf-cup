import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { Hono } from 'hono';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

vi.mock('../db/index.js', async () => {
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

// Mutable mock wrapper: tests reassign `mockGhinClient` to either a stub
// instance (default — methods are vi.fn()) or `null` (the "no env vars"
// case). The vi.mock factory returns a getter so each access reads the
// CURRENT value of mockGhinClient at the time the route handler runs.
type MockGhinClient = {
  searchByName: ReturnType<typeof vi.fn>;
  getHandicap: ReturnType<typeof vi.fn>;
};

let mockGhinClient: MockGhinClient | null = {
  searchByName: vi.fn(),
  getHandicap: vi.fn(),
};

vi.mock('../lib/ghin-client.js', () => ({
  get ghinClient() {
    return mockGhinClient;
  },
}));

const { db } = await import('../db/index.js');
const { players, sessions } = await import('../db/schema/index.js');
const { playersRouter } = await import('./players.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const testApp = new Hono();
testApp.use('*', requestIdMiddleware);
testApp.route('/api/players', playersRouter);

const SESSION_COOKIE = 'tournament_session';

async function seedSession(): Promise<string> {
  const now = Date.now();
  const playerId = randomUUID();
  await db.insert(players).values({
    id: playerId,
    isOrganizer: false,
    createdAt: now,
    name: 'Test Player',
    tenantId: 'guyan',
    contextId: 'league:guyan-wolf-cup-friday',
  });
  const sessionId = randomUUID().replace(/-/g, '');
  await db.insert(sessions).values({
    sessionId,
    playerId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    deviceInfo: null,
    tenantId: 'guyan',
    contextId: 'league:guyan-wolf-cup-friday',
  });
  return sessionId;
}

function cookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}`;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  // Reset the mock client to the stub default before every test. Tests
  // that need null assign `mockGhinClient = null` after this resets.
  mockGhinClient = {
    searchByName: vi.fn(),
    getHandicap: vi.fn(),
  };
  await db.delete(sessions);
  await db.delete(players);
});

afterEach(() => {
  // Restore default in case a test set it to null.
  mockGhinClient = {
    searchByName: vi.fn(),
    getHandicap: vi.fn(),
  };
});

describe('GET /api/players/search', () => {
  it('happy path: authenticated player + valid name + mocked results → 200 { results: [...] }', async () => {
    const sessionId = await seedSession();
    const fixture = [
      {
        ghinNumber: 1234567,
        firstName: 'Josh',
        lastName: 'Stoll',
        handicapIndex: 8.4,
        club: 'Guyan G&CC',
        state: 'WV',
      },
    ];
    mockGhinClient!.searchByName.mockResolvedValueOnce(fixture);

    const res = await testApp.request('/api/players/search?name=Stoll', {
      headers: { cookie: cookie(sessionId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: typeof fixture };
    expect(body.results).toEqual(fixture);
    expect(mockGhinClient!.searchByName).toHaveBeenCalledWith('Stoll');
  });

  it('search with no upstream matches → 200 { results: [] } (NOT 404)', async () => {
    const sessionId = await seedSession();
    mockGhinClient!.searchByName.mockResolvedValueOnce([]);

    const res = await testApp.request('/api/players/search?name=NoSuchName', {
      headers: { cookie: cookie(sessionId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });

  it('Zod miss: empty name → 400 invalid_query', async () => {
    const sessionId = await seedSession();

    const res = await testApp.request('/api/players/search?name=', {
      headers: { cookie: cookie(sessionId) },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_query');
    expect(mockGhinClient!.searchByName).not.toHaveBeenCalled();
  });

  it('anonymous → 401 session_missing', async () => {
    const res = await testApp.request('/api/players/search?name=Stoll');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('session_missing');
  });

  it('GHIN client null (env vars unset) → 503 ghin_unavailable', async () => {
    const sessionId = await seedSession();
    mockGhinClient = null;

    const res = await testApp.request('/api/players/search?name=Stoll', {
      headers: { cookie: cookie(sessionId) },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toBe('service_unavailable');
    expect(body.code).toBe('ghin_unavailable');
  });

  it('upstream throws GHIN_UNAVAILABLE → 503 ghin_unavailable', async () => {
    const sessionId = await seedSession();
    mockGhinClient!.searchByName.mockRejectedValueOnce(new Error('GHIN_UNAVAILABLE'));

    const res = await testApp.request('/api/players/search?name=Stoll', {
      headers: { cookie: cookie(sessionId) },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('ghin_unavailable');
  });

  it('state=NY query param is IGNORED — client called with name only (KNOWN LIMITATION pinned)', async () => {
    const sessionId = await seedSession();
    mockGhinClient!.searchByName.mockResolvedValueOnce([]);

    await testApp.request('/api/players/search?name=Stoll&state=NY', {
      headers: { cookie: cookie(sessionId) },
    });
    // The route delegates to ghinClient.searchByName(name) WITHOUT
    // passing state. The client itself hardcodes state='WV' upstream.
    // A future "promote ?state= to flow through" change has to update
    // this test (regression guard for the v1 limitation).
    expect(mockGhinClient!.searchByName).toHaveBeenCalledWith('Stoll');
    expect(mockGhinClient!.searchByName).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/players/lookup', () => {
  it('happy path: valid ghin + mocked result → 200 { ghinNumber, handicapIndex }', async () => {
    const sessionId = await seedSession();
    mockGhinClient!.getHandicap.mockResolvedValueOnce({ handicapIndex: 8.4 });

    const res = await testApp.request('/api/players/lookup?ghin=1234567', {
      headers: { cookie: cookie(sessionId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ghinNumber: number; handicapIndex: number };
    expect(body.ghinNumber).toBe(1234567);
    expect(body.handicapIndex).toBe(8.4);
    expect(mockGhinClient!.getHandicap).toHaveBeenCalledWith(1234567);
  });

  it('NOT_FOUND from upstream → 404 ghin_not_found', async () => {
    const sessionId = await seedSession();
    mockGhinClient!.getHandicap.mockRejectedValueOnce(new Error('NOT_FOUND'));

    const res = await testApp.request('/api/players/lookup?ghin=9999999', {
      headers: { cookie: cookie(sessionId) },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toBe('not_found');
    expect(body.code).toBe('ghin_not_found');
  });

  it('GHIN client null → 503 ghin_unavailable', async () => {
    const sessionId = await seedSession();
    mockGhinClient = null;

    const res = await testApp.request('/api/players/lookup?ghin=1234567', {
      headers: { cookie: cookie(sessionId) },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('ghin_unavailable');
  });

  it('Zod miss: missing ghin query param → 400 invalid_query', async () => {
    const sessionId = await seedSession();

    const res = await testApp.request('/api/players/lookup', {
      headers: { cookie: cookie(sessionId) },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_query');
    expect(mockGhinClient!.getHandicap).not.toHaveBeenCalled();
  });

  it('Zod miss: ghin=abc (non-numeric) → 400 invalid_query', async () => {
    const sessionId = await seedSession();

    const res = await testApp.request('/api/players/lookup?ghin=abc', {
      headers: { cookie: cookie(sessionId) },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_query');
  });

  it('anonymous lookup → 401 session_missing', async () => {
    const res = await testApp.request('/api/players/lookup?ghin=1234567');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('session_missing');
  });

  it('upstream throws generic error → 503 ghin_unavailable', async () => {
    const sessionId = await seedSession();
    mockGhinClient!.getHandicap.mockRejectedValueOnce(new Error('GHIN_AUTH_FAILED'));

    const res = await testApp.request('/api/players/lookup?ghin=1234567', {
      headers: { cookie: cookie(sessionId) },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('ghin_unavailable');
  });
});
