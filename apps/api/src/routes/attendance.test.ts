import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { Context, Next } from 'hono';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { eq, inArray } from 'drizzle-orm';

// Mock db before any imports that use it
vi.mock('../db/index.js', async () => {
  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../db/schema.js');
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client, { schema });
  return { db };
});

// Mock adminAuthMiddleware to bypass auth
vi.mock('../middleware/admin-auth.js', () => ({
  adminAuthMiddleware: async (c: Context, next: Next) => {
    c.set('adminId' as never, 1 as never);
    await next();
  },
}));

import { Hono } from 'hono';
import attendanceRouter from './attendance.js';
import adminAttendanceRouter from './admin/attendance.js';
import adminRoundsRouter from './admin/rounds.js';
import adminPairingRouter from './admin/pairing.js';
import pairingsRouter from './pairings.js';
import { db } from '../db/index.js';
import { seasons, seasonWeeks, players, attendance, subBench, rounds, groups, roundPlayers } from '../db/schema.js';
import { migrate } from 'drizzle-orm/libsql/migrator';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, '../db/migrations');

// Create a combined app for testing
const app = new Hono();
app.route('/api', attendanceRouter);
app.route('/api/admin', adminAttendanceRouter);
app.route('/api/admin', adminRoundsRouter);
app.route('/api/admin', adminPairingRouter);
app.route('/api', pairingsRouter);

let seasonId: number;
let weekId: number;
let player1Id: number;
let player2Id: number;
let player3Id: number;
let player4Id: number;

beforeAll(async () => {
  await migrate(db, { migrationsFolder });

  // Seed players
  const [p1] = await db.insert(players).values({ name: 'Alice', handicapIndex: 10.2, createdAt: Date.now() }).returning();
  const [p2] = await db.insert(players).values({ name: 'Bob', handicapIndex: 15.0, createdAt: Date.now() }).returning();
  const [p3] = await db.insert(players).values({ name: 'Carol', handicapIndex: 8.5, createdAt: Date.now() }).returning();
  const [p4] = await db.insert(players).values({ name: 'Dave', handicapIndex: 12.0, createdAt: Date.now() }).returning();
  player1Id = p1!.id;
  player2Id = p2!.id;
  player3Id = p3!.id;
  player4Id = p4!.id;

  // Seed season with weeks
  const [s] = await db
    .insert(seasons)
    .values({
      name: 'Test Season',
      year: 3001,
      startDate: '2026-04-10',
      endDate: '2026-05-01',
      totalRounds: 4,
      playoffFormat: 'top4',
      createdAt: Date.now(),
    })
    .returning();
  seasonId = s!.id;

  // Create weeks (all active, with tees)
  const fridays = ['2026-04-10', '2026-04-17', '2026-04-24', '2026-05-01'];
  const tees = ['blue', 'black', 'white', 'blue'] as const;
  for (let i = 0; i < fridays.length; i++) {
    await db.insert(seasonWeeks).values({
      seasonId,
      friday: fridays[i]!,
      isActive: 1,
      tee: tees[i]!,
      createdAt: Date.now(),
    });
  }

  const weeks = await db.select().from(seasonWeeks).where(eq(seasonWeeks.seasonId, seasonId)).orderBy(seasonWeeks.friday);
  weekId = weeks[0]!.id;
});

afterEach(async () => {
  // Clean up rounds + round dependencies first
  const seasonRounds = await db.select({ id: rounds.id }).from(rounds).where(eq(rounds.seasonId, seasonId));
  const roundIds = seasonRounds.map((r) => r.id);
  if (roundIds.length > 0) {
    await db.delete(roundPlayers).where(inArray(roundPlayers.roundId, roundIds));
    await db.delete(groups).where(inArray(groups.roundId, roundIds));
    await db.delete(rounds).where(eq(rounds.seasonId, seasonId));
  }

  // Clean up attendance + sub bench
  const weekIds = (await db.select({ id: seasonWeeks.id }).from(seasonWeeks).where(eq(seasonWeeks.seasonId, seasonId))).map((w) => w.id);
  if (weekIds.length > 0) {
    await db.delete(attendance).where(inArray(attendance.seasonWeekId, weekIds));
  }
  await db.delete(subBench).where(eq(subBench.seasonId, seasonId));
  // Delete test-created players (not the seeded Alice/Bob/Carol/Dave)
  const seededIds = [player1Id, player2Id, player3Id, player4Id];
  const allPlayers = await db.select({ id: players.id }).from(players);
  for (const p of allPlayers) {
    if (!seededIds.includes(p.id)) {
      // Clean up any attendance/roundPlayers refs first
      await db.delete(attendance).where(eq(attendance.playerId, p.id)).catch(() => {});
      await db.delete(roundPlayers).where(eq(roundPlayers.playerId, p.id)).catch(() => {});
      await db.delete(subBench).where(eq(subBench.playerId, p.id)).catch(() => {});
      await db.delete(players).where(eq(players.id, p.id)).catch(() => {});
    }
  }
});

// ---------------------------------------------------------------------------
// GET /attendance — public
// ---------------------------------------------------------------------------

describe('GET /attendance', () => {
  it('returns current week with full roster and unset statuses', async () => {
    const res = await app.request('/api/attendance', { method: 'GET' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as AttendanceResponse;
    expect(body.week).not.toBeNull();
    expect(body.week!.tee).toBeTruthy();
    expect(body.players.length).toBeGreaterThanOrEqual(2);
    expect(body.confirmed).toBe(0);
    expect(body.total).toBeGreaterThanOrEqual(2);
    // All statuses should be unset initially
    expect(body.players.every((p) => p.status === 'unset')).toBe(true);
  });

  it('returns graceful empty response when no season exists', async () => {
    // Delete all seasons temporarily
    await db.delete(seasonWeeks).where(eq(seasonWeeks.seasonId, seasonId));
    await db.delete(seasons).where(eq(seasons.id, seasonId));

    const res = await app.request('/api/attendance', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AttendanceResponse;
    expect(body.week).toBeNull();
    expect(body.players).toEqual([]);

    // Restore season + weeks
    const [s] = await db
      .insert(seasons)
      .values({ id: seasonId, name: 'Test Season', year: 3002, startDate: '2026-04-10', endDate: '2026-05-01', totalRounds: 4, playoffFormat: 'top4', createdAt: Date.now() })
      .returning();
    const fridays = ['2026-04-10', '2026-04-17', '2026-04-24', '2026-05-01'];
    const tees = ['blue', 'black', 'white', 'blue'] as const;
    for (let i = 0; i < fridays.length; i++) {
      await db.insert(seasonWeeks).values({
        seasonId: s!.id,
        friday: fridays[i]!,
        isActive: 1,
        tee: tees[i]!,
        createdAt: Date.now(),
      });
    }
    const weeks = await db.select().from(seasonWeeks).where(eq(seasonWeeks.seasonId, seasonId)).orderBy(seasonWeeks.friday);
    weekId = weeks[0]!.id;
  });
});

// ---------------------------------------------------------------------------
// PATCH /admin/attendance/:weekId/players/:playerId — toggle
// ---------------------------------------------------------------------------

describe('PATCH /admin/attendance/:weekId/players/:playerId', () => {
  it('creates attendance record (upsert — first toggle)', async () => {
    const res = await app.request(
      `/api/admin/attendance/${weekId}/players/${player1Id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in' }),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; confirmed: number; total: number };
    expect(body.status).toBe('in');
    expect(body.confirmed).toBe(1);
    expect(body.total).toBeGreaterThanOrEqual(2);
  });

  it('updates existing attendance record (upsert — second toggle)', async () => {
    // First set to 'in'
    await app.request(`/api/admin/attendance/${weekId}/players/${player1Id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in' }),
    });

    // Then toggle to 'out'
    const res = await app.request(
      `/api/admin/attendance/${weekId}/players/${player1Id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'out' }),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; confirmed: number };
    expect(body.status).toBe('out');
    expect(body.confirmed).toBe(0); // was in, now out
  });

  it('returns correct confirmed count with multiple players', async () => {
    // Set both players to 'in'
    await app.request(`/api/admin/attendance/${weekId}/players/${player1Id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in' }),
    });
    const res = await app.request(`/api/admin/attendance/${weekId}/players/${player2Id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in' }),
    });

    const body = (await res.json()) as { confirmed: number };
    expect(body.confirmed).toBe(2);
  });

  it('returns 404 for non-existent week', async () => {
    const res = await app.request(`/api/admin/attendance/99999/players/${player1Id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid status', async () => {
    const res = await app.request(`/api/admin/attendance/${weekId}/players/${player1Id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'maybe' }),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/attendance/:weekId — admin view
// ---------------------------------------------------------------------------

describe('GET /admin/attendance/:weekId', () => {
  it('returns attendance for specific week with statuses', async () => {
    // Set a player to 'in'
    await app.request(`/api/admin/attendance/${weekId}/players/${player1Id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in' }),
    });

    const res = await app.request(`/api/admin/attendance/${weekId}`, {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as AttendanceResponse;
    expect(body.week!.id).toBe(weekId);
    expect(body.confirmed).toBe(1);

    const alice = body.players.find((p) => p.id === player1Id);
    expect(alice?.status).toBe('in');

    const bob = body.players.find((p) => p.id === player2Id);
    expect(bob?.status).toBe('unset');
  });

  it('returns 404 for non-existent week', async () => {
    const res = await app.request('/api/admin/attendance/99999', {
      method: 'GET',
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Sub bench endpoints
// ---------------------------------------------------------------------------

describe('Sub bench', () => {
  it('POST /admin/seasons/:id/subs creates new sub + bench + attendance', async () => {
    const res = await app.request(`/api/admin/seasons/${seasonId}/subs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Charlie Sub',
        ghinNumber: '9999999',
        handicapIndex: 20.5,
        seasonWeekId: weekId,
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { sub: { name: string; ghinNumber: string; handicapIndex: number } };
    expect(body.sub.name).toBe('Charlie Sub');
    expect(body.sub.ghinNumber).toBe('9999999');
    expect(body.sub.handicapIndex).toBe(20.5);

    // Verify sub appears in attendance as 'in'
    const attRes = await app.request(`/api/admin/attendance/${weekId}`, { method: 'GET' });
    const attBody = (await attRes.json()) as AttendanceResponse;
    const charlie = attBody.players.find((p) => p.name === 'Charlie Sub');
    expect(charlie?.status).toBe('in');
  });

  it('GET /admin/seasons/:id/subs returns bench subs', async () => {
    // First add a sub
    await app.request(`/api/admin/seasons/${seasonId}/subs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Charlie Sub',
        ghinNumber: '9999999',
        handicapIndex: 20.5,
        seasonWeekId: weekId,
      }),
    });

    const res = await app.request(`/api/admin/seasons/${seasonId}/subs`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { name: string; roundCount: number }[] };
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    const charlie = body.items.find((s) => s.name === 'Charlie Sub');
    expect(charlie).toBeDefined();
    expect(charlie!.roundCount).toBe(0);
  });

  it('POST /admin/seasons/:id/subs/:subId/add-to-week marks sub in on week', async () => {
    // Add a sub first
    await app.request(`/api/admin/seasons/${seasonId}/subs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Charlie Sub',
        ghinNumber: '9999999',
        handicapIndex: 20.5,
        seasonWeekId: weekId,
      }),
    });

    // Get bench sub id
    const benchRes = await app.request(`/api/admin/seasons/${seasonId}/subs`, { method: 'GET' });
    const benchBody = (await benchRes.json()) as { items: { id: number; name: string }[] };
    const charlie = benchBody.items.find((s) => s.name === 'Charlie Sub');

    // Get a different week
    const allWeeks = await db.select().from(seasonWeeks).where(eq(seasonWeeks.seasonId, seasonId)).orderBy(seasonWeeks.friday);
    const week2Id = allWeeks[1]!.id;

    // Add to week 2
    const res = await app.request(
      `/api/admin/seasons/${seasonId}/subs/${charlie!.id}/add-to-week`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seasonWeekId: week2Id }),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { added: boolean };
    expect(body.added).toBe(true);
  });

  it('duplicate sub creation upserts bench entry', async () => {
    // Add same sub twice
    await app.request(`/api/admin/seasons/${seasonId}/subs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Charlie Sub', ghinNumber: '9999999', handicapIndex: 20.5, seasonWeekId: weekId }),
    });
    const res = await app.request(`/api/admin/seasons/${seasonId}/subs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Charlie Sub', ghinNumber: '9999999', handicapIndex: 21.0, seasonWeekId: weekId }),
    });

    expect(res.status).toBe(201);

    // Should still be just one bench entry
    const benchRes = await app.request(`/api/admin/seasons/${seasonId}/subs`, { method: 'GET' });
    const benchBody = (await benchRes.json()) as { items: { name: string }[] };
    const charlies = benchBody.items.filter((s) => s.name === 'Charlie Sub');
    expect(charlies.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// POST /admin/rounds/from-attendance — create round from confirmed
// ---------------------------------------------------------------------------

describe('POST /admin/rounds/from-attendance', () => {
  async function confirmPlayers(ids: number[]) {
    for (const id of ids) {
      await app.request(`/api/admin/attendance/${weekId}/players/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in' }),
      });
    }
  }

  it('creates round with 4 confirmed players → 1 group + 4 round_players', async () => {
    await confirmPlayers([player1Id, player2Id, player3Id, player4Id]);

    const res = await app.request('/api/admin/rounds/from-attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonWeekId: weekId }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      round: { scheduledDate: string; tee: string };
      entryCode: string;
      groupCount: number;
      playerCount: number;
    };
    expect(body.groupCount).toBe(1);
    expect(body.playerCount).toBe(4);
    expect(body.entryCode).toMatch(/^\d{4}$/); // entry code = year (e.g. "2026")
    expect(body.round.tee).toBe('blue'); // first week = blue
    expect(body.round.scheduledDate).toBe('2026-04-10');
  });

  it('rejects when confirmed count is not multiple of 4', async () => {
    await confirmPlayers([player1Id, player2Id, player3Id]); // only 3

    const res = await app.request('/api/admin/rounds/from-attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonWeekId: weekId }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; issues: { message: string }[] };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.issues[0]!.message).toContain('more');
  });

  it('flags sub_bench players with isSub=1', async () => {
    // Add player1 as a sub on the bench
    await db.insert(subBench).values({
      seasonId,
      playerId: player1Id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await confirmPlayers([player1Id, player2Id, player3Id, player4Id]);

    const res = await app.request('/api/admin/rounds/from-attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonWeekId: weekId }),
    });

    expect(res.status).toBe(201);

    // Check round_players for isSub
    const allRounds = await db.select().from(rounds).where(eq(rounds.seasonId, seasonId));
    const rps = await db.select().from(roundPlayers).where(eq(roundPlayers.roundId, allRounds[0]!.id));
    const alice = rps.find((rp) => rp.playerId === player1Id);
    expect(alice?.isSub).toBe(1);
    const bob = rps.find((rp) => rp.playerId === player2Id);
    expect(bob?.isSub).toBe(0);
  });

  it('rejects when round already exists for this date', async () => {
    await confirmPlayers([player1Id, player2Id, player3Id, player4Id]);

    // Create first round
    await app.request('/api/admin/rounds/from-attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonWeekId: weekId }),
    });

    // Try creating duplicate
    const res = await app.request('/api/admin/rounds/from-attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonWeekId: weekId }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// POST /admin/rounds/:roundId/groups/:groupId/swap — player swap
// ---------------------------------------------------------------------------

describe('POST /admin/rounds/:roundId/groups/:groupId/swap', () => {
  async function createRoundWith4Players() {
    for (const id of [player1Id, player2Id, player3Id, player4Id]) {
      await app.request(`/api/admin/attendance/${weekId}/players/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in' }),
      });
    }
    const res = await app.request('/api/admin/rounds/from-attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonWeekId: weekId }),
    });
    const body = (await res.json()) as { round: { id: number }; groupCount: number };
    // Get group IDs
    const grps = await db.select().from(groups).where(eq(groups.roundId, body.round.id));
    return { roundId: body.round.id, groupId: grps[0]!.id };
  }

  it('swaps a player in a group and updates attendance', async () => {
    const { roundId, groupId } = await createRoundWith4Players();

    // Create a 5th player as replacement
    const [p5] = await db.insert(players).values({ name: 'Eve', handicapIndex: 11.0, createdAt: Date.now() }).returning();

    const res = await app.request(`/api/admin/rounds/${roundId}/groups/${groupId}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        removePlayerId: player1Id,
        addPlayerId: p5!.id,
        handicapIndex: 11.0,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { players: { playerId: number; name: string }[] };
    expect(body.players.find((p) => p.playerId === p5!.id)).toBeDefined();
    expect(body.players.find((p) => p.playerId === player1Id)).toBeUndefined();
    // Eve cleanup handled by afterEach (rounds + attendance cascade)
  });

  it('rejects swap when replacement is already in round', async () => {
    const { roundId, groupId } = await createRoundWith4Players();

    const res = await app.request(`/api/admin/rounds/${roundId}/groups/${groupId}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        removePlayerId: player1Id,
        addPlayerId: player2Id, // already in round
        handicapIndex: 15.0,
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// GET /pairings/:roundId — public pairings with course handicaps
// ---------------------------------------------------------------------------

describe('GET /pairings/:roundId', () => {
  it('returns groups with course handicaps', async () => {
    // Confirm 4 players and create round
    for (const id of [player1Id, player2Id, player3Id, player4Id]) {
      await app.request(`/api/admin/attendance/${weekId}/players/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in' }),
      });
    }
    const createRes = await app.request('/api/admin/rounds/from-attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonWeekId: weekId }),
    });
    const { round } = (await createRes.json()) as { round: { id: number } };

    const res = await app.request(`/api/pairings/${round.id}`, { method: 'GET' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      round: { tee: string; handicapUpdatedAt: number; scheduledDate: string };
      groups: { groupNumber: number; players: { name: string; courseHandicap: number; handicapIndex: number }[] }[];
    };

    expect(body.round.tee).toBe('blue');
    expect(body.round.scheduledDate).toBe('2026-04-10');
    expect(body.round.handicapUpdatedAt).toBeTypeOf('number');
    expect(body.groups.length).toBe(1);
    expect(body.groups[0]!.players.length).toBe(4);

    // Verify course handicap is calculated (not same as HI)
    const alice = body.groups[0]!.players.find((p) => p.name === 'Alice');
    expect(alice).toBeDefined();
    expect(alice!.courseHandicap).toBeTypeOf('number');
    // Alice HI=10.2, blue tees: round(10.2 * (126/113) + (69.9-71)) = round(11.37 - 1.1) = round(10.27) = 10
    expect(alice!.courseHandicap).toBe(10);
  });

  it('returns 404 for non-existent round', async () => {
    const res = await app.request('/api/pairings/99999', { method: 'GET' });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /admin/rounds/:roundId/suggest-groups — honors attendance group_request
// ---------------------------------------------------------------------------

describe('Suggest groups honors attendance group_request', () => {
  async function seedEightInPlayersWithRequest(lastPid: number) {
    // Seed 4 more players so we have 8 total (= 2 groups of 4)
    const [p5] = await db.insert(players).values({ name: 'Eve', handicapIndex: 14.0, createdAt: Date.now() }).returning();
    const [p6] = await db.insert(players).values({ name: 'Frank', handicapIndex: 9.3, createdAt: Date.now() }).returning();
    const [p7] = await db.insert(players).values({ name: 'Grace', handicapIndex: 18.1, createdAt: Date.now() }).returning();
    const [p8] = await db.insert(players).values({ name: 'Hank', handicapIndex: 11.6, createdAt: Date.now() }).returning();
    const extraIds = [p5!.id, p6!.id, p7!.id, p8!.id];
    const all = [player1Id, player2Id, player3Id, player4Id, ...extraIds];

    for (const id of all) {
      await app.request(`/api/admin/attendance/${weekId}/players/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in' }),
      });
    }

    // Set the requested player to 'last'
    const reqRes = await app.request(
      `/api/admin/attendance/${weekId}/players/${lastPid}/group-request`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupRequest: 'last' }),
      },
    );
    expect(reqRes.status).toBe(200);

    // Create the round from attendance
    const rRes = await app.request('/api/admin/rounds/from-attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonWeekId: weekId }),
    });
    expect(rRes.status).toBe(201);
    const { round } = (await rRes.json()) as { round: { id: number } };

    return { roundId: round.id, allPlayerIds: all };
  }

  it('pins a player with groupRequest=last into the last group', async () => {
    // Bonner-analog: player1 is the one requesting "last"
    const { roundId, allPlayerIds } = await seedEightInPlayersWithRequest(player1Id);

    const res = await app.request(`/api/admin/rounds/${roundId}/suggest-groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerIds: allPlayerIds }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      groups: { groupNumber: number; playerIds: number[] }[];
      honoredRequests: { playerId: number; groupNumber: number }[];
      requestWarnings: string[];
    };

    expect(body.groups.length).toBe(2);
    const lastGroup = body.groups.find((g) => g.groupNumber === 2)!;
    expect(lastGroup.playerIds).toContain(player1Id);
    expect(body.honoredRequests).toEqual([{ playerId: player1Id, groupNumber: 2 }]);
    expect(body.requestWarnings).toEqual([]);
  });

  it('pins last-requested player into group 3 when 12 players (3 groups)', async () => {
    // Seed 8 more players so we have 12 total (= 3 groups of 4)
    const extras: number[] = [];
    for (const name of ['Eve', 'Frank', 'Grace', 'Hank', 'Ivy', 'Jack', 'Kate', 'Leo']) {
      const [p] = await db
        .insert(players)
        .values({ name, handicapIndex: 12.0, createdAt: Date.now() })
        .returning();
      extras.push(p!.id);
    }
    const all = [player1Id, player2Id, player3Id, player4Id, ...extras];

    for (const id of all) {
      await app.request(`/api/admin/attendance/${weekId}/players/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in' }),
      });
    }

    // Bonner-analog requests last group
    await app.request(
      `/api/admin/attendance/${weekId}/players/${player1Id}/group-request`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupRequest: 'last' }),
      },
    );

    const rRes = await app.request('/api/admin/rounds/from-attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonWeekId: weekId }),
    });
    const { round } = (await rRes.json()) as { round: { id: number } };

    const res = await app.request(`/api/admin/rounds/${round.id}/suggest-groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerIds: all }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      groups: { groupNumber: number; playerIds: number[] }[];
      honoredRequests: { playerId: number; groupNumber: number }[];
    };

    expect(body.groups.length).toBe(3);
    const lastGroup = body.groups.find((g) => g.groupNumber === 3)!;
    expect(lastGroup.playerIds).toContain(player1Id);
    expect(body.honoredRequests).toEqual([{ playerId: player1Id, groupNumber: 3 }]);
  });

  it('lets explicit admin pin override an attendance group_request', async () => {
    const { roundId, allPlayerIds } = await seedEightInPlayersWithRequest(player1Id);

    // Admin explicitly pins player1 to group 1 (index 0), overriding "last"
    const res = await app.request(`/api/admin/rounds/${roundId}/suggest-groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerIds: allPlayerIds,
        pins: { [String(player1Id)]: 0 },
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      groups: { groupNumber: number; playerIds: number[] }[];
    };
    const firstGroup = body.groups.find((g) => g.groupNumber === 1)!;
    expect(firstGroup.playerIds).toContain(player1Id);
  });

  it('warns when more than 4 players request the same position', async () => {
    // Mark all 8 in, then flag 5 of them as "first"
    const { roundId, allPlayerIds } = await seedEightInPlayersWithRequest(player1Id);

    // Override the initial "last" for player1 and set 5 others to "first"
    for (const pid of allPlayerIds.slice(0, 5)) {
      await app.request(
        `/api/admin/attendance/${weekId}/players/${pid}/group-request`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupRequest: 'first' }),
        },
      );
    }

    const res = await app.request(`/api/admin/rounds/${roundId}/suggest-groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerIds: allPlayerIds }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      honoredRequests: { playerId: number; groupNumber: number }[];
      requestWarnings: string[];
    };

    expect(body.requestWarnings.length).toBe(1);
    expect(body.requestWarnings[0]).toContain('5 players requested First');
    // Only 4 honored
    const firstHonored = body.honoredRequests.filter((h) => h.groupNumber === 1);
    expect(firstHonored.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AttendanceResponse = {
  week: { id: number; friday: string; weekNumber: number; tee: string | null } | null;
  players: { id: number; name: string; handicapIndex: number | null; status: string }[];
  confirmed: number;
  total: number;
};
