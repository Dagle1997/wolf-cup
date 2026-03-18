import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
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

import roundsApp from './rounds.js';
import { db } from '../../db/index.js';
import { seasons, rounds, groups, roundPlayers, players, holeScores } from '../../db/schema.js';
import { migrate } from 'drizzle-orm/libsql/migrator';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, '../../db/migrations');

const TEST_DATE = '2026-06-06';

let testSeasonId: number;
let testRoundId: number;
let testGroupId: number;
let testPlayerId: number;

beforeAll(async () => {
  await migrate(db, { migrationsFolder });

  // Seed a baseline season
  const [season] = await db
    .insert(seasons)
    .values({
      name: 'Test Season',
      year: 3060,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      totalRounds: 17,
      playoffFormat: 'top8',
      createdAt: Date.now(),
    })
    .returning();
  testSeasonId = season!.id;

  // Seed a baseline round for group/player tests
  const [round] = await db
    .insert(rounds)
    .values({
      seasonId: testSeasonId,
      type: 'official',
      status: 'scheduled',
      scheduledDate: TEST_DATE,
      entryCodeHash: null,
      autoCalculateMoney: 1,
      createdAt: Date.now(),
    })
    .returning();
  testRoundId = round!.id;

  // Seed a baseline group
  const [group] = await db
    .insert(groups)
    .values({ roundId: testRoundId, groupNumber: 1, battingOrder: null })
    .returning();
  testGroupId = group!.id;

  // Seed a baseline player
  const [player] = await db
    .insert(players)
    .values({ name: 'Test Player', createdAt: Date.now() })
    .returning();
  testPlayerId = player!.id;
});

afterEach(async () => {
  // Clean up test-created round_players (keep baseline)
  await db
    .delete(roundPlayers)
    .where(and(eq(roundPlayers.roundId, testRoundId), eq(roundPlayers.playerId, testPlayerId)));
  // Clean up extra groups (keep baseline group 1)
  await db.delete(groups).where(and(eq(groups.roundId, testRoundId), eq(groups.groupNumber, 99)));
  // Clean up extra rounds (keep baseline)
  await db.delete(rounds).where(eq(rounds.scheduledDate, '2027-01-01'));
  // Reset baseline round to known state (including autoCalculateMoney)
  await db
    .update(rounds)
    .set({ status: 'scheduled', headcount: null, entryCodeHash: null, autoCalculateMoney: 1 })
    .where(eq(rounds.id, testRoundId));
});

// ---------------------------------------------------------------------------
// GET /rounds
// ---------------------------------------------------------------------------

describe('GET /rounds', () => {
  it('returns items array', async () => {
    const res = await roundsApp.request('/rounds', { method: 'GET' });

    expect(res.status).toBe(200);
    const body = await res.json() as { items: Record<string, unknown>[] };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
  });

  it('does not include entryCodeHash in items', async () => {
    const res = await roundsApp.request('/rounds', { method: 'GET' });
    const body = await res.json() as { items: Record<string, unknown>[] };
    for (const round of body.items) {
      expect(round).not.toHaveProperty('entryCodeHash');
    }
  });
});

// ---------------------------------------------------------------------------
// POST /rounds
// ---------------------------------------------------------------------------

describe('POST /rounds', () => {
  it('creates an official round and returns 201', async () => {
    const res = await roundsApp.request('/rounds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonId: testSeasonId, type: 'official', scheduledDate: '2027-01-01' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { round: Record<string, unknown> };
    expect(body.round['type']).toBe('official');
    expect(body.round['status']).toBe('scheduled');
    expect(body.round).not.toHaveProperty('entryCodeHash');
  });

  it('hashes entryCode before storage — hash not in response, hash in DB is non-null', async () => {
    const res = await roundsApp.request('/rounds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonId: testSeasonId, type: 'official', scheduledDate: '2027-01-01', entryCode: 'WOLF26' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { round: Record<string, unknown> };
    expect(body.round).not.toHaveProperty('entryCodeHash');

    // Verify DB has the hash
    const roundId = body.round['id'] as number;
    const dbRow = await db.select({ entryCodeHash: rounds.entryCodeHash }).from(rounds).where(eq(rounds.id, roundId)).get();
    expect(dbRow?.entryCodeHash).not.toBeNull();
    expect(dbRow?.entryCodeHash).not.toBe('WOLF26'); // must be hashed, not plain text
  });

  it('returns 400 VALIDATION_ERROR for invalid type', async () => {
    const res = await roundsApp.request('/rounds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonId: testSeasonId, type: 'tournament', scheduledDate: '2027-01-01' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for invalid scheduledDate format', async () => {
    const res = await roundsApp.request('/rounds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonId: testSeasonId, type: 'official', scheduledDate: 'June 6 2026' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 NOT_FOUND for unknown seasonId', async () => {
    const res = await roundsApp.request('/rounds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonId: 99999, type: 'official', scheduledDate: '2027-01-01' }),
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// PATCH /rounds/:id
// ---------------------------------------------------------------------------

describe('PATCH /rounds/:id', () => {
  it('updates headcount and returns 200', async () => {
    const res = await roundsApp.request(`/rounds/${testRoundId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headcount: 16 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { round: { headcount: number } };
    expect(body.round.headcount).toBe(16);
  });

  it('cancels round and clears entry_code_hash in DB', async () => {
    // First set an entry code
    await db.update(rounds).set({ entryCodeHash: 'some-hash' }).where(eq(rounds.id, testRoundId));

    const res = await roundsApp.request(`/rounds/${testRoundId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { round: { status: string } };
    expect(body.round.status).toBe('cancelled');
    expect(body.round).not.toHaveProperty('entryCodeHash');

    // Verify DB cleared the hash
    const dbRow = await db
      .select({ entryCodeHash: rounds.entryCodeHash })
      .from(rounds)
      .where(eq(rounds.id, testRoundId))
      .get();
    expect(dbRow?.entryCodeHash).toBeNull();
  });

  it('updates entryCode by hashing new value', async () => {
    const res = await roundsApp.request(`/rounds/${testRoundId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryCode: 'NEWCODE' }),
    });

    expect(res.status).toBe(200);
    expect((await res.json() as Record<string, unknown>)['round']).not.toHaveProperty('entryCodeHash');

    const dbRow = await db
      .select({ entryCodeHash: rounds.entryCodeHash })
      .from(rounds)
      .where(eq(rounds.id, testRoundId))
      .get();
    expect(dbRow?.entryCodeHash).not.toBeNull();
    expect(dbRow?.entryCodeHash).not.toBe('NEWCODE');
  });

  it('returns 404 NOT_FOUND for unknown round ID', async () => {
    const res = await roundsApp.request('/rounds/99999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headcount: 8 }),
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR when body has no fields', async () => {
    const res = await roundsApp.request(`/rounds/${testRoundId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('disables auto-calculate money (autoCalculateMoney: false → 200, DB auto_calculate_money = 0)', async () => {
    const res = await roundsApp.request(`/rounds/${testRoundId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoCalculateMoney: false }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { round: { autoCalculateMoney: number } };
    expect(body.round.autoCalculateMoney).toBe(0);

    // Verify DB updated
    const row = await db
      .select({ autoCalculateMoney: rounds.autoCalculateMoney })
      .from(rounds)
      .where(eq(rounds.id, testRoundId))
      .get();
    expect(row?.autoCalculateMoney).toBe(0);
  });

  it('returns 400 VALIDATION_ERROR when autoCalculateMoney is non-boolean', async () => {
    const res = await roundsApp.request(`/rounds/${testRoundId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoCalculateMoney: 'yes' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('enables auto-calculate money (autoCalculateMoney: true → 200, DB auto_calculate_money = 1)', async () => {
    // First disable it
    await db.update(rounds).set({ autoCalculateMoney: 0 }).where(eq(rounds.id, testRoundId));

    const res = await roundsApp.request(`/rounds/${testRoundId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoCalculateMoney: true }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { round: { autoCalculateMoney: number } };
    expect(body.round.autoCalculateMoney).toBe(1);

    // Verify DB updated
    const row = await db
      .select({ autoCalculateMoney: rounds.autoCalculateMoney })
      .from(rounds)
      .where(eq(rounds.id, testRoundId))
      .get();
    expect(row?.autoCalculateMoney).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GET /rounds/:roundId/groups
// ---------------------------------------------------------------------------

describe('GET /rounds/:roundId/groups', () => {
  it('returns items array (empty or with seeded group)', async () => {
    const res = await roundsApp.request(`/rounds/${testRoundId}/groups`, { method: 'GET' });

    expect(res.status).toBe(200);
    const body = await res.json() as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('returns 404 NOT_FOUND for unknown roundId', async () => {
    const res = await roundsApp.request('/rounds/99999/groups', { method: 'GET' });

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/groups
// ---------------------------------------------------------------------------

describe('POST /rounds/:roundId/groups', () => {
  it('creates a group and returns 201', async () => {
    const res = await roundsApp.request(`/rounds/${testRoundId}/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupNumber: 99 }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { group: { id: number; roundId: number; groupNumber: number } };
    expect(body.group.groupNumber).toBe(99);
    expect(body.group.roundId).toBe(testRoundId);
    expect(body.group.id).toBeTypeOf('number');
  });

  it('returns 404 NOT_FOUND for unknown roundId', async () => {
    const res = await roundsApp.request('/rounds/99999/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupNumber: 1 }),
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR when groupNumber is missing', async () => {
    const res = await roundsApp.request(`/rounds/${testRoundId}/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/groups/:groupId/players
// ---------------------------------------------------------------------------

describe('POST /rounds/:roundId/groups/:groupId/players', () => {
  it('adds a player to a group and returns 201', async () => {
    const res = await roundsApp.request(
      `/rounds/${testRoundId}/groups/${testGroupId}/players`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: testPlayerId, handicapIndex: 14.2 }),
      },
    );

    expect(res.status).toBe(201);
    const body = await res.json() as {
      roundPlayer: { roundId: number; groupId: number; playerId: number; handicapIndex: number; isSub: number };
    };
    expect(body.roundPlayer.playerId).toBe(testPlayerId);
    expect(body.roundPlayer.handicapIndex).toBe(14.2);
    expect(body.roundPlayer.isSub).toBe(0);
    expect(body.roundPlayer.roundId).toBe(testRoundId);
    expect(body.roundPlayer.groupId).toBe(testGroupId);
  });

  it('returns 409 CONFLICT when player is already in the round', async () => {
    // First insertion
    await db.insert(roundPlayers).values({
      roundId: testRoundId,
      groupId: testGroupId,
      playerId: testPlayerId,
      handicapIndex: 10.0,
      isSub: 0,
    });

    const res = await roundsApp.request(
      `/rounds/${testRoundId}/groups/${testGroupId}/players`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: testPlayerId, handicapIndex: 12.0 }),
      },
    );

    expect(res.status).toBe(409);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('CONFLICT');
  });

  it('returns 404 NOT_FOUND for unknown roundId', async () => {
    const res = await roundsApp.request(
      `/rounds/99999/groups/${testGroupId}/players`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: testPlayerId, handicapIndex: 10.0 }),
      },
    );

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 404 NOT_FOUND for unknown groupId', async () => {
    const res = await roundsApp.request(
      `/rounds/${testRoundId}/groups/99999/players`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: testPlayerId, handicapIndex: 10.0 }),
      },
    );

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 404 NOT_FOUND for unknown playerId', async () => {
    const res = await roundsApp.request(
      `/rounds/${testRoundId}/groups/${testGroupId}/players`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: 99999, handicapIndex: 10.0 }),
      },
    );

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// GET /rounds — groupCompletion field
// ---------------------------------------------------------------------------

describe('GET /rounds — groupCompletion', () => {
  it('returns groupCompletion with complete=0 for a round with no scored holes', async () => {
    const res = await roundsApp.request('/rounds', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json() as { items: { id: number; groupCompletion: { total: number; complete: number } }[] };
    const item = body.items.find((r) => r.id === testRoundId);
    expect(item).toBeDefined();
    expect(item!.groupCompletion.total).toBeGreaterThanOrEqual(1);
    expect(item!.groupCompletion.complete).toBe(0);
  });

  it('counts a group as complete when it has 18 distinct hole scores', async () => {
    await db.insert(roundPlayers).values({
      roundId: testRoundId, groupId: testGroupId, playerId: testPlayerId,
      handicapIndex: 10.0, isSub: 0,
    });
    const now = Date.now();
    for (let h = 1; h <= 18; h++) {
      await db.insert(holeScores).values({
        roundId: testRoundId, groupId: testGroupId, playerId: testPlayerId,
        holeNumber: h, grossScore: 4, createdAt: now, updatedAt: now,
      });
    }

    const res = await roundsApp.request('/rounds', { method: 'GET' });
    const body = await res.json() as { items: { id: number; groupCompletion: { total: number; complete: number } }[] };
    const item = body.items.find((r) => r.id === testRoundId);
    expect(item!.groupCompletion.complete).toBe(1);

    // Clean up
    await db.delete(holeScores).where(eq(holeScores.roundId, testRoundId));
  });
});

// ---------------------------------------------------------------------------
// POST /rounds/:id/finalize
// ---------------------------------------------------------------------------

describe('POST /rounds/:id/finalize', () => {
  it('finalizes an active official round and returns 200', async () => {
    await db.update(rounds).set({ status: 'active', type: 'official' }).where(eq(rounds.id, testRoundId));

    const res = await roundsApp.request(`/rounds/${testRoundId}/finalize`, { method: 'POST' });

    expect(res.status).toBe(200);
    const body = await res.json() as { id: number; status: string };
    expect(body.status).toBe('finalized');
    expect(body.id).toBe(testRoundId);

    const row = await db.select({ status: rounds.status }).from(rounds).where(eq(rounds.id, testRoundId)).get();
    expect(row?.status).toBe('finalized');
  });

  it('returns 422 ROUND_NOT_ACTIVE when round is scheduled', async () => {
    const res = await roundsApp.request(`/rounds/${testRoundId}/finalize`, { method: 'POST' });

    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('ROUND_NOT_ACTIVE');
  });

  it('returns 422 ROUND_NOT_ACTIVE when round is already finalized', async () => {
    await db.update(rounds).set({ status: 'finalized' }).where(eq(rounds.id, testRoundId));

    const res = await roundsApp.request(`/rounds/${testRoundId}/finalize`, { method: 'POST' });

    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('ROUND_NOT_ACTIVE');
  });

  it('returns 422 CASUAL_ROUND for a casual round', async () => {
    await db.update(rounds).set({ status: 'active', type: 'casual' }).where(eq(rounds.id, testRoundId));

    const res = await roundsApp.request(`/rounds/${testRoundId}/finalize`, { method: 'POST' });

    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('CASUAL_ROUND');
  });

  it('returns 404 NOT_FOUND for unknown round ID', async () => {
    const res = await roundsApp.request('/rounds/99999/finalize', { method: 'POST' });

    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// GET /rounds/:roundId/players
// ---------------------------------------------------------------------------

describe('GET /rounds/:roundId/players', () => {
  beforeEach(async () => {
    // Ensure the test player is in the round for each test
    await db
      .insert(roundPlayers)
      .values({ roundId: testRoundId, groupId: testGroupId, playerId: testPlayerId, handicapIndex: 12.5, isSub: 0 })
      .onConflictDoNothing();
  });

  it('returns 200 with player list including HI for a round with players', async () => {
    const res = await roundsApp.request(`/rounds/${testRoundId}/players`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      items: {
        playerId: number;
        name: string;
        ghinNumber: string | null;
        groupId: number;
        groupNumber: number;
        handicapIndex: number;
        isSub: number;
      }[];
    };
    expect(Array.isArray(body.items)).toBe(true);
    // testPlayerId was added to the round in the global beforeAll
    const row = body.items.find((p) => p.playerId === testPlayerId);
    expect(row).toBeDefined();
    expect(typeof row!.handicapIndex).toBe('number');
    expect(typeof row!.groupNumber).toBe('number');
  });

  it('returns 200 with empty items for a round with no players', async () => {
    const [emptyRound] = await db
      .insert(rounds)
      .values({
        seasonId: testSeasonId,
        type: 'official',
        scheduledDate: '2026-07-01',
        status: 'scheduled',
        entryCodeHash: null,
        autoCalculateMoney: 1,
        createdAt: Date.now(),
      })
      .returning();
    const res = await roundsApp.request(`/rounds/${emptyRound!.id}/players`);
    expect(res.status).toBe(200);
    const body = await res.json() as { items: unknown[] };
    expect(body.items).toHaveLength(0);
    await db.delete(rounds).where(eq(rounds.id, emptyRound!.id));
  });

  it('returns 404 for unknown round', async () => {
    const res = await roundsApp.request('/rounds/99999/players');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /rounds/:roundId/players/:playerId/handicap
// ---------------------------------------------------------------------------

describe('PATCH /rounds/:roundId/players/:playerId/handicap', () => {
  beforeEach(async () => {
    // Ensure the test player is in the round for each test
    await db
      .insert(roundPlayers)
      .values({ roundId: testRoundId, groupId: testGroupId, playerId: testPlayerId, handicapIndex: 12.5, isSub: 0 })
      .onConflictDoNothing();
  });

  it('updates handicapIndex and returns 200', async () => {
    const res = await roundsApp.request(
      `/rounds/${testRoundId}/players/${testPlayerId}/handicap`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handicapIndex: 18.5 }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      playerId: number;
      roundId: number;
      handicapIndex: number;
    };
    expect(body.handicapIndex).toBe(18.5);
    expect(body.playerId).toBe(testPlayerId);
    expect(body.roundId).toBe(testRoundId);

    // Verify persisted
    const rp = await db
      .select({ handicapIndex: roundPlayers.handicapIndex })
      .from(roundPlayers)
      .where(and(eq(roundPlayers.roundId, testRoundId), eq(roundPlayers.playerId, testPlayerId)))
      .get();
    expect(rp?.handicapIndex).toBe(18.5);
  });

  it('returns 422 ROUND_FINALIZED for a finalized round', async () => {
    await db.update(rounds).set({ status: 'finalized' }).where(eq(rounds.id, testRoundId));
    const res = await roundsApp.request(
      `/rounds/${testRoundId}/players/${testPlayerId}/handicap`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handicapIndex: 10.0 }),
      },
    );
    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('ROUND_FINALIZED');
    await db.update(rounds).set({ status: 'scheduled' }).where(eq(rounds.id, testRoundId));
  });

  it('returns 400 for handicapIndex out of range', async () => {
    const res = await roundsApp.request(
      `/rounds/${testRoundId}/players/${testPlayerId}/handicap`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handicapIndex: 99 }),
      },
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for player not in round', async () => {
    const res = await roundsApp.request(
      `/rounds/${testRoundId}/players/99999/handicap`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handicapIndex: 12.0 }),
      },
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 404 for unknown round', async () => {
    const res = await roundsApp.request(
      `/rounds/99999/players/${testPlayerId}/handicap`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handicapIndex: 12.0 }),
      },
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });
});
