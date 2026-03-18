import { describe, it, expect, beforeAll } from 'vitest';
import { vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

vi.mock('../db/index.js', async () => {
  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../db/schema.js');
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client, { schema });
  return { db };
});

import historyApp from './history.js';
import adminHistoryApp from './admin/history.js';
import { db } from '../db/index.js';
import { seasons, seasonStandings, players, admins, sessions } from '../db/schema.js';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

let adminSessionId: string;
let p1Id: number;
let p2Id: number;
let p3Id: number;

type HistoryResponse = {
  seasons: {
    id: number;
    name: string;
    year: number;
    champion: { playerId: number; name: string; wins: number } | null;
    standings: { playerId: number; name: string; rank: number; points: number | null }[];
  }[];
  championshipCounts: { playerId: number; name: string; wins: number }[];
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder });

  // Create admin + session for auth
  const hash = await bcrypt.hash('test', 4);
  await db.insert(admins).values({ username: 'admin', passwordHash: hash, createdAt: Date.now() });
  const admin = await db.select().from(admins).get();
  adminSessionId = 'test-session-history';
  await db.insert(sessions).values({
    id: adminSessionId,
    adminId: admin!.id,
    createdAt: Date.now(),
    expiresAt: Date.now() + 86400000,
  });

  // Create test players
  const playerInserts = await db
    .insert(players)
    .values([
      { name: 'Player One', ghinNumber: null, isActive: 1, isGuest: 0, createdAt: Date.now() },
      { name: 'Player Two', ghinNumber: null, isActive: 1, isGuest: 0, createdAt: Date.now() },
      { name: 'Player Three', ghinNumber: null, isActive: 0, isGuest: 0, createdAt: Date.now() },
    ])
    .returning({ id: players.id });
  [p1Id, p2Id, p3Id] = playerInserts.map((p) => p.id) as [number, number, number];
});

// ---------------------------------------------------------------------------
// GET /history — public endpoint
// ---------------------------------------------------------------------------

describe('GET /history', () => {
  it('returns empty seasons array when none exist', async () => {
    const res = await historyApp.request('/history');
    expect(res.status).toBe(200);
    const body = (await res.json()) as HistoryResponse;
    expect(body.seasons).toEqual([]);
    expect(body.championshipCounts).toEqual([]);
  });

  it('returns seasons ordered by year DESC', async () => {
    // Seed two seasons
    await db.insert(seasons).values([
      { name: '2020 Season', year: 2040, startDate: '2020-04-01', endDate: '2020-09-30', totalRounds: 0, playoffFormat: 'top8', harveyLiveEnabled: 0, createdAt: Date.now() },
      { name: '2023 Season', year: 2043, startDate: '2023-04-01', endDate: '2023-09-30', totalRounds: 0, playoffFormat: 'top8', harveyLiveEnabled: 0, createdAt: Date.now() },
    ]);

    const res = await historyApp.request('/history');
    expect(res.status).toBe(200);
    const body = (await res.json()) as HistoryResponse;
    expect(body.seasons.length).toBeGreaterThanOrEqual(2);
    const years = body.seasons.map((s) => s.year);
    // Check descending order
    for (let i = 1; i < years.length; i++) {
      expect(years[i - 1]).toBeGreaterThanOrEqual(years[i]!);
    }
  });

  it('includes champion name and win count', async () => {
    // Set champion on the 2023 season
    const season = await db.select().from(seasons).where(
      eq(seasons.year, 2043),
    ).get();
    await db.update(seasons).set({ championPlayerId: p1Id }).where(
      eq(seasons.id, season!.id),
    );

    const res = await historyApp.request('/history');
    const body = (await res.json()) as HistoryResponse;
    const s2023 = body.seasons.find((s) => s.year === 2043);
    expect(s2023).toBeDefined();
    expect(s2023!.champion).not.toBeNull();
    expect(s2023!.champion!.name).toBe('Player One');
    expect(s2023!.champion!.wins).toBe(1);
  });

  it('includes standings ordered by rank ASC', async () => {
    const season = await db.select().from(seasons).where(
      eq(seasons.year, 2043),
    ).get();
    const now = Date.now();
    await db.insert(seasonStandings).values([
      { seasonId: season!.id, playerId: p2Id, rank: 1, points: 285.5, createdAt: now },
      { seasonId: season!.id, playerId: p1Id, rank: 2, points: 273.5, createdAt: now },
    ]);

    const res = await historyApp.request('/history');
    const body = (await res.json()) as HistoryResponse;
    const s2023 = body.seasons.find((s) => s.year === 2043);
    expect(s2023!.standings.length).toBe(2);
    expect(s2023!.standings[0]!.rank).toBe(1);
    expect(s2023!.standings[0]!.name).toBe('Player Two');
    expect(s2023!.standings[1]!.rank).toBe(2);
  });

  it('returns championshipCounts with correct win tallies', async () => {
    // P1 already has 1 win (2023). Give P1 another (2020).
    const season2020 = await db.select().from(seasons).where(
      eq(seasons.year, 2040),
    ).get();
    await db.update(seasons).set({ championPlayerId: p1Id }).where(
      eq(seasons.id, season2020!.id),
    );

    const res = await historyApp.request('/history');
    const body = (await res.json()) as HistoryResponse;
    const p1Count = body.championshipCounts.find((c) => c.playerId === p1Id);
    expect(p1Count).toBeDefined();
    expect(p1Count!.wins).toBe(2);
  });

  it('season with no champion returns champion: null', async () => {
    await db.insert(seasons).values({
      name: '2017 Season', year: 2037, startDate: '2017-04-01', endDate: '2017-09-30',
      totalRounds: 0, playoffFormat: 'top8', harveyLiveEnabled: 0, createdAt: Date.now(),
    });

    const res = await historyApp.request('/history');
    const body = (await res.json()) as HistoryResponse;
    const s2017 = body.seasons.find((s) => s.year === 2037);
    expect(s2017!.champion).toBeNull();
  });

  it('season with no standings returns empty standings array', async () => {
    const res = await historyApp.request('/history');
    const body = (await res.json()) as HistoryResponse;
    const s2017 = body.seasons.find((s) => s.year === 2037);
    expect(s2017!.standings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Admin history endpoints — require auth
// ---------------------------------------------------------------------------

function authHeaders(): Record<string, string> {
  return { Cookie: `session=${adminSessionId}`, 'Content-Type': 'application/json' };
}

describe('POST /admin/history', () => {
  it('creates a historical season (requires auth)', async () => {
    const res = await adminHistoryApp.request('/', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        year: 2050,
        name: '2050 Test Season',
        startDate: '2050-04-01',
        endDate: '2050-09-30',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: number; name: string };
    expect(body.id).toBeGreaterThan(0);
    expect(body.name).toBe('2050 Test Season');
  });

  it('returns 401 without session cookie', async () => {
    const res = await adminHistoryApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        year: 2051,
        name: 'Unauthorized',
        startDate: '2051-04-01',
        endDate: '2051-09-30',
      }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid body', async () => {
    const res = await adminHistoryApp.request('/', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ year: 'not-a-number' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

describe('PATCH /admin/history/:seasonId/champion', () => {
  it('sets champion for existing season (requires auth)', async () => {
    const season = await db.select().from(seasons).where(
      eq(seasons.year, 2050),
    ).get();

    const res = await adminHistoryApp.request(`/${season!.id}/champion`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ championPlayerId: p2Id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  it('returns 401 without session cookie', async () => {
    const res = await adminHistoryApp.request('/1/champion', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ championPlayerId: p1Id }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-existent season', async () => {
    const res = await adminHistoryApp.request('/99999/champion', {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ championPlayerId: p1Id }),
    });
    expect(res.status).toBe(404);
  });
});

describe('PUT /admin/history/:seasonId/standings', () => {
  it('upserts standings for a season (requires auth)', async () => {
    const season = await db.select().from(seasons).where(
      eq(seasons.year, 2050),
    ).get();

    const res = await adminHistoryApp.request(`/${season!.id}/standings`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({
        standings: [
          { playerId: p1Id, rank: 1, points: 300 },
          { playerId: p2Id, rank: 2, points: 280.5 },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; count: number };
    expect(body.success).toBe(true);
    expect(body.count).toBe(2);
  });

  it('returns 401 without session cookie', async () => {
    const res = await adminHistoryApp.request('/1/standings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ standings: [{ playerId: p1Id, rank: 1 }] }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for empty standings array', async () => {
    const season = await db.select().from(seasons).where(
      eq(seasons.year, 2050),
    ).get();

    const res = await adminHistoryApp.request(`/${season!.id}/standings`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ standings: [] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});
