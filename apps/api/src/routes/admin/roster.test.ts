import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { Context, Next } from 'hono';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { eq, and } from 'drizzle-orm';

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

import rosterApp from './roster.js';
import { db } from '../../db/index.js';
import { players, seasons, rounds, groups, roundPlayers } from '../../db/schema.js';
import { migrate } from 'drizzle-orm/libsql/migrator';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, '../../db/migrations');

// Baseline test data IDs (set in beforeAll)
let testPlayerId: number;
let testRoundId: number;
let testGroupId: number;

beforeAll(async () => {
  await migrate(db, { migrationsFolder });

  // Seed season
  const seasonRows = await db
    .insert(seasons)
    .values({
      name: 'Test Season',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      totalRounds: 17,
      playoffFormat: 'top8',
      createdAt: Date.now(),
    })
    .returning();
  const season = seasonRows[0]!;

  // Seed round
  const roundRows = await db
    .insert(rounds)
    .values({
      seasonId: season.id,
      type: 'official',
      status: 'scheduled',
      scheduledDate: '2026-06-06',
      createdAt: Date.now(),
    })
    .returning();
  const round = roundRows[0]!;
  testRoundId = round.id;

  // Seed group
  const groupRows = await db
    .insert(groups)
    .values({ roundId: round.id, groupNumber: 1 })
    .returning();
  const group = groupRows[0]!;
  testGroupId = group.id;

  // Seed baseline player
  const playerRows = await db
    .insert(players)
    .values({ name: 'Baseline Player', createdAt: Date.now() })
    .returning();
  const player = playerRows[0]!;
  testPlayerId = player.id;

  // Seed round_players row for handicap tests
  await db.insert(roundPlayers).values({
    roundId: testRoundId,
    playerId: testPlayerId,
    groupId: testGroupId,
    handicapIndex: 15.0,
  });
});

afterEach(async () => {
  // Delete players added during tests (keep baseline player)
  await db.delete(players).where(eq(players.name, 'New Player'));
  // Reset baseline player to known state so tests don't bleed into each other
  await db
    .update(players)
    .set({ name: 'Baseline Player', isActive: 1 })
    .where(eq(players.id, testPlayerId));
  // Reset round_players to known state (for sub tests)
  await db
    .update(roundPlayers)
    .set({ isSub: 0 })
    .where(and(eq(roundPlayers.roundId, testRoundId), eq(roundPlayers.playerId, testPlayerId)));
});

// ---------------------------------------------------------------------------
// GET /players
// ---------------------------------------------------------------------------

describe('GET /players', () => {
  it('returns all players including inactive', async () => {
    // Add an inactive player
    await db.insert(players).values({ name: 'New Player', isActive: 0, createdAt: Date.now() });

    const res = await rosterApp.request('/players', { method: 'GET' });

    expect(res.status).toBe(200);
    const body = await res.json() as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(2); // baseline + inactive
  });
});

// ---------------------------------------------------------------------------
// POST /players
// ---------------------------------------------------------------------------

describe('POST /players', () => {
  it('creates a player and returns 201 with player object', async () => {
    const res = await rosterApp.request('/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Player', ghinNumber: '1234567' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { player: { id: number; name: string; ghinNumber: string } };
    expect(body.player.name).toBe('New Player');
    expect(body.player.ghinNumber).toBe('1234567');
    expect(body.player.id).toBeTypeOf('number');
  });

  it('creates a player without ghinNumber', async () => {
    const res = await rosterApp.request('/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Player' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { player: { ghinNumber: null } };
    expect(body.player.ghinNumber).toBeNull();
  });

  it('returns 400 VALIDATION_ERROR when name is missing', async () => {
    const res = await rosterApp.request('/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ghinNumber: '123' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when name is empty string', async () => {
    const res = await rosterApp.request('/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// PATCH /players/:id
// ---------------------------------------------------------------------------

describe('PATCH /players/:id', () => {
  it('updates player name successfully', async () => {
    const res = await rosterApp.request(`/players/${testPlayerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Name' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { player: { name: string } };
    expect(body.player.name).toBe('Updated Name');
  });

  it('soft-deletes player with isActive: 0', async () => {
    const res = await rosterApp.request(`/players/${testPlayerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: 0 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { player: { isActive: number } };
    expect(body.player.isActive).toBe(0);

    // Verify still in DB
    const row = await db.select().from(players).where(eq(players.id, testPlayerId)).get();
    expect(row).toBeDefined();
    expect(row!.isActive).toBe(0);
  });

  it('returns 400 VALIDATION_ERROR when body has no fields', async () => {
    const res = await rosterApp.request(`/players/${testPlayerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 NOT_FOUND for unknown player ID', async () => {
    const res = await rosterApp.request('/players/99999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ghost' }),
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// PATCH /rounds/:roundId/players/:playerId/handicap
// ---------------------------------------------------------------------------

describe('PATCH /rounds/:roundId/players/:playerId/handicap', () => {
  it('updates handicap index and returns 200', async () => {
    const res = await rosterApp.request(
      `/rounds/${testRoundId}/players/${testPlayerId}/handicap`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handicapIndex: 12.4 }),
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { roundPlayer: { roundId: number; playerId: number; handicapIndex: number } };
    expect(body.roundPlayer.handicapIndex).toBe(12.4);
    expect(body.roundPlayer.roundId).toBe(testRoundId);
    expect(body.roundPlayer.playerId).toBe(testPlayerId);

    // Verify DB update
    const row = await db
      .select({ handicapIndex: roundPlayers.handicapIndex })
      .from(roundPlayers)
      .where(and(eq(roundPlayers.roundId, testRoundId), eq(roundPlayers.playerId, testPlayerId)))
      .get();
    expect(row?.handicapIndex).toBe(12.4);
  });

  it('returns 404 NOT_FOUND when player not in round', async () => {
    const res = await rosterApp.request(
      `/rounds/${testRoundId}/players/99999/handicap`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handicapIndex: 10.0 }),
      },
    );

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR when handicapIndex is missing', async () => {
    const res = await rosterApp.request(
      `/rounds/${testRoundId}/players/${testPlayerId}/handicap`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when handicapIndex is out of range', async () => {
    const res = await rosterApp.request(
      `/rounds/${testRoundId}/players/${testPlayerId}/handicap`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handicapIndex: 55 }),
      },
    );

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// PATCH /rounds/:roundId/players/:playerId/sub
// ---------------------------------------------------------------------------

describe('PATCH /rounds/:roundId/players/:playerId/sub', () => {
  it('marks player as sub (isSub: true → 200, DB is_sub = 1)', async () => {
    const res = await rosterApp.request(
      `/rounds/${testRoundId}/players/${testPlayerId}/sub`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isSub: true }),
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { roundPlayer: { roundId: number; playerId: number; isSub: number } };
    expect(body.roundPlayer.isSub).toBe(1);
    expect(body.roundPlayer.roundId).toBe(testRoundId);
    expect(body.roundPlayer.playerId).toBe(testPlayerId);

    // Verify DB updated
    const row = await db
      .select({ isSub: roundPlayers.isSub })
      .from(roundPlayers)
      .where(and(eq(roundPlayers.roundId, testRoundId), eq(roundPlayers.playerId, testPlayerId)))
      .get();
    expect(row?.isSub).toBe(1);
  });

  it('converts sub to full member (isSub: false → 200, DB is_sub = 0)', async () => {
    // First mark as sub
    await db
      .update(roundPlayers)
      .set({ isSub: 1 })
      .where(and(eq(roundPlayers.roundId, testRoundId), eq(roundPlayers.playerId, testPlayerId)));

    const res = await rosterApp.request(
      `/rounds/${testRoundId}/players/${testPlayerId}/sub`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isSub: false }),
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { roundPlayer: { isSub: number } };
    expect(body.roundPlayer.isSub).toBe(0);

    // Verify DB updated
    const row = await db
      .select({ isSub: roundPlayers.isSub })
      .from(roundPlayers)
      .where(and(eq(roundPlayers.roundId, testRoundId), eq(roundPlayers.playerId, testPlayerId)))
      .get();
    expect(row?.isSub).toBe(0);
  });

  it('returns 404 NOT_FOUND for unknown roundId', async () => {
    const res = await rosterApp.request(
      `/rounds/99999/players/${testPlayerId}/sub`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isSub: true }),
      },
    );

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 404 NOT_FOUND when player not in round', async () => {
    const res = await rosterApp.request(
      `/rounds/${testRoundId}/players/99999/sub`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isSub: true }),
      },
    );

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR when isSub is missing', async () => {
    const res = await rosterApp.request(
      `/rounds/${testRoundId}/players/${testPlayerId}/sub`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    );

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});
