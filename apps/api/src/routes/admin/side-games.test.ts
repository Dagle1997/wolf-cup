import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { Context, Next } from 'hono';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { eq } from 'drizzle-orm';

// Mock db before any imports that use it
vi.mock('../../db/index.js', async () => {
  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../../db/schema.js');
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client, { schema });
  return { db };
});

// Mock adminAuthMiddleware to bypass auth
vi.mock('../../middleware/admin-auth.js', () => ({
  adminAuthMiddleware: async (c: Context, next: Next) => {
    c.set('adminId' as never, 1 as never);
    await next();
  },
}));

import sideGamesApp from './side-games.js';
import { db } from '../../db/index.js';
import { seasons, rounds, players, sideGames, sideGameResults } from '../../db/schema.js';
import { migrate } from 'drizzle-orm/libsql/migrator';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, '../../db/migrations');

let testSeasonId: number;
let testRoundId: number;
let testPlayerId: number;
let testSideGameId: number;

beforeAll(async () => {
  await migrate(db, { migrationsFolder });

  const [season] = await db
    .insert(seasons)
    .values({
      name: 'Test Season SG',
      year: 3080,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      totalRounds: 17,
      playoffFormat: 'top8',
      createdAt: Date.now(),
    })
    .returning();
  testSeasonId = season!.id;

  const [round] = await db
    .insert(rounds)
    .values({
      seasonId: testSeasonId,
      type: 'official',
      status: 'scheduled',
      scheduledDate: '2026-06-06',
      autoCalculateMoney: 1,
      createdAt: Date.now(),
    })
    .returning();
  testRoundId = round!.id;

  const [player] = await db
    .insert(players)
    .values({
      name: 'Test Player SG',
      createdAt: Date.now(),
    })
    .returning();
  testPlayerId = player!.id;

  // Seed baseline side game for result tests (scheduledRoundIds includes testRoundId)
  const [game] = await db
    .insert(sideGames)
    .values({
      seasonId: testSeasonId,
      name: 'Closest to Pin',
      format: 'manual',
      scheduledRoundIds: JSON.stringify([testRoundId]),
      createdAt: Date.now(),
    })
    .returning();
  testSideGameId = game!.id;
});

afterEach(async () => {
  // Delete results first (FK constraint: sideGameResults → sideGames)
  await db.delete(sideGameResults).where(eq(sideGameResults.roundId, testRoundId));
  // Delete test-created side games (keep baseline 'Closest to Pin')
  await db.delete(sideGames).where(eq(sideGames.name, 'Test Game'));
  // L1 fix: also clean up 'Updated Name' in case the PATCH rename test fails mid-assertion
  await db.delete(sideGames).where(eq(sideGames.name, 'Updated Name'));
});

// ---------------------------------------------------------------------------
// GET /seasons/:seasonId/side-games
// ---------------------------------------------------------------------------

describe('GET /seasons/:seasonId/side-games', () => {
  it('returns items array with baseline side game', async () => {
    const res = await sideGamesApp.request(`/seasons/${testSeasonId}/side-games`, {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty items array for a season with no side games', async () => {
    // L4 fix: create a fresh season with zero side games
    const [emptySeason] = await db
      .insert(seasons)
      .values({
        name: 'Empty Season SG',
        year: 3081,
        startDate: '2027-01-01',
        endDate: '2027-12-31',
        totalRounds: 10,
        playoffFormat: 'top4',
        createdAt: Date.now(),
      })
      .returning();

    const res = await sideGamesApp.request(`/seasons/${emptySeason!.id}/side-games`, {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { items: unknown[] };
    expect(body.items).toEqual([]);

    await db.delete(seasons).where(eq(seasons.id, emptySeason!.id));
  });

  it('returns 404 NOT_FOUND for unknown season', async () => {
    const res = await sideGamesApp.request('/seasons/99999/side-games', {
      method: 'GET',
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// POST /seasons/:seasonId/side-games
// ---------------------------------------------------------------------------

describe('POST /seasons/:seasonId/side-games', () => {
  it('creates a side game and returns 201', async () => {
    const res = await sideGamesApp.request(`/seasons/${testSeasonId}/side-games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Game', format: 'manual' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { sideGame: { id: number; seasonId: number; name: string; format: string; scheduledRoundIds: number[] } };
    expect(body.sideGame.name).toBe('Test Game');
    expect(body.sideGame.format).toBe('manual');
    expect(body.sideGame.scheduledRoundIds).toEqual([]);
    expect(body.sideGame.id).toBeTypeOf('number');
    expect(body.sideGame.seasonId).toBe(testSeasonId); // M1 fix: AC#1 requires seasonId in response
  });

  it('stores and returns scheduledRoundIds as parsed array', async () => {
    const res = await sideGamesApp.request(`/seasons/${testSeasonId}/side-games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Game', format: 'manual', scheduledRoundIds: [1, 2, 3] }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { sideGame: { scheduledRoundIds: number[] } };
    expect(body.sideGame.scheduledRoundIds).toEqual([1, 2, 3]);
  });

  it('returns 404 NOT_FOUND for unknown season', async () => {
    const res = await sideGamesApp.request('/seasons/99999/side-games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Game', format: 'manual' }),
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR when name is missing', async () => {
    const res = await sideGamesApp.request(`/seasons/${testSeasonId}/side-games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'manual' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when format is missing', async () => {
    const res = await sideGamesApp.request(`/seasons/${testSeasonId}/side-games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Game' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// PATCH /side-games/:id
// ---------------------------------------------------------------------------

describe('PATCH /side-games/:id', () => {
  it('updates name and returns 200', async () => {
    // Create a game to update
    const [game] = await db
      .insert(sideGames)
      .values({ seasonId: testSeasonId, name: 'Test Game', format: 'manual', createdAt: Date.now() })
      .returning();

    const res = await sideGamesApp.request(`/side-games/${game!.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Name' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { sideGame: { name: string; seasonId: number } };
    expect(body.sideGame.name).toBe('Updated Name');
    expect(body.sideGame.seasonId).toBe(testSeasonId); // L2 fix: AC#6 requires seasonId in response
    // L1 fix: no in-test rename needed — afterEach now cleans up 'Updated Name' rows
  });

  it('updates scheduledRoundIds and returns 200 with parsed array', async () => {
    const [game] = await db
      .insert(sideGames)
      .values({ seasonId: testSeasonId, name: 'Test Game', format: 'manual', createdAt: Date.now() })
      .returning();

    const res = await sideGamesApp.request(`/side-games/${game!.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledRoundIds: [10, 20] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { sideGame: { seasonId: number; scheduledRoundIds: number[] } };
    expect(body.sideGame.scheduledRoundIds).toEqual([10, 20]);
    expect(body.sideGame.seasonId).toBe(testSeasonId); // L2 fix: AC#6 requires seasonId in response
  });

  it('returns 404 NOT_FOUND for unknown side game', async () => {
    const res = await sideGamesApp.request('/side-games/99999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ghost' }),
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR when body is empty', async () => {
    const res = await sideGamesApp.request(`/side-games/${testSideGameId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/side-game-results
// ---------------------------------------------------------------------------

describe('POST /rounds/:roundId/side-game-results', () => {
  it('creates result with winnerPlayerId and returns 201', async () => {
    const res = await sideGamesApp.request(`/rounds/${testRoundId}/side-game-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sideGameId: testSideGameId, winnerPlayerId: testPlayerId }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { result: { id: number; sideGameId: number; roundId: number; winnerPlayerId: number; winnerName: null } };
    expect(body.result.sideGameId).toBe(testSideGameId);
    expect(body.result.roundId).toBe(testRoundId);
    expect(body.result.winnerPlayerId).toBe(testPlayerId);
    expect(body.result.id).toBeTypeOf('number');
  });

  it('creates result with winnerName (guest) and returns 201', async () => {
    const res = await sideGamesApp.request(`/rounds/${testRoundId}/side-game-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sideGameId: testSideGameId, winnerName: 'Guest Player' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { result: { winnerName: string; winnerPlayerId: null } };
    expect(body.result.winnerName).toBe('Guest Player');
    expect(body.result.winnerPlayerId).toBeNull();
  });

  it('returns 404 NOT_FOUND for unknown round', async () => {
    const res = await sideGamesApp.request('/rounds/99999/side-game-results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sideGameId: testSideGameId, winnerPlayerId: testPlayerId }),
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 404 NOT_FOUND for unknown sideGameId', async () => {
    const res = await sideGamesApp.request(`/rounds/${testRoundId}/side-game-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sideGameId: 99999, winnerPlayerId: testPlayerId }),
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 404 NOT_FOUND for unknown winnerPlayerId', async () => {
    const res = await sideGamesApp.request(`/rounds/${testRoundId}/side-game-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sideGameId: testSideGameId, winnerPlayerId: 99999 }),
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR when neither winnerPlayerId nor winnerName provided', async () => {
    const res = await sideGamesApp.request(`/rounds/${testRoundId}/side-game-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sideGameId: testSideGameId, notes: 'some note' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// GET /rounds/:roundId/side-game-results
// ---------------------------------------------------------------------------

describe('GET /rounds/:roundId/side-game-results', () => {
  it('returns items array for round', async () => {
    // Seed a result first
    await db.insert(sideGameResults).values({
      sideGameId: testSideGameId,
      roundId: testRoundId,
      winnerPlayerId: null,
      winnerName: 'Test Winner',
      notes: null,
      createdAt: Date.now(),
    });

    const res = await sideGamesApp.request(`/rounds/${testRoundId}/side-game-results`, {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
  });

  it('returns 404 NOT_FOUND for unknown round', async () => {
    const res = await sideGamesApp.request('/rounds/99999/side-game-results', {
      method: 'GET',
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });
});
