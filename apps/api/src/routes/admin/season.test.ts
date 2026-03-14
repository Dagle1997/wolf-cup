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

import seasonApp from './season.js';
import { db } from '../../db/index.js';
import {
  seasons, seasonWeeks, rounds, groups, roundPlayers, players,
  holeScores, roundResults, harveyResults, wolfDecisions, scoreCorrections,
  sideGames, sideGameResults, pairingHistory, attendance,
} from '../../db/schema.js';
import { inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/libsql/migrator';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, '../../db/migrations');

let testSeasonId: number;

beforeAll(async () => {
  await migrate(db, { migrationsFolder });

  // Seed test players (needed for roundPlayers FK)
  await db.insert(players).values([
    { id: 1, name: 'Player A', createdAt: Date.now() },
    { id: 2, name: 'Player B', createdAt: Date.now() },
  ]).onConflictDoNothing();

  // Seed a baseline season
  const rows = await db
    .insert(seasons)
    .values({
      name: 'Baseline Season',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      totalRounds: 17,
      playoffFormat: 'top8',
      createdAt: Date.now(),
    })
    .returning();
  testSeasonId = rows[0]!.id;
});

afterEach(async () => {
  // Cascade-delete test-created seasons (same logic as DELETE endpoint)
  const testSeasons = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(eq(seasons.name, 'Test Season'));

  for (const s of testSeasons) {
    const seasonRounds = await db.select({ id: rounds.id }).from(rounds).where(eq(rounds.seasonId, s.id));
    const roundIds = seasonRounds.map((r) => r.id);
    if (roundIds.length > 0) {
      await db.delete(scoreCorrections).where(inArray(scoreCorrections.roundId, roundIds));
      await db.delete(wolfDecisions).where(inArray(wolfDecisions.roundId, roundIds));
      await db.delete(harveyResults).where(inArray(harveyResults.roundId, roundIds));
      await db.delete(roundResults).where(inArray(roundResults.roundId, roundIds));
      await db.delete(holeScores).where(inArray(holeScores.roundId, roundIds));
      await db.delete(roundPlayers).where(inArray(roundPlayers.roundId, roundIds));
      await db.delete(groups).where(inArray(groups.roundId, roundIds));
      await db.delete(sideGameResults).where(inArray(sideGameResults.roundId, roundIds));
      await db.delete(rounds).where(eq(rounds.seasonId, s.id));
    }
    await db.delete(sideGames).where(eq(sideGames.seasonId, s.id));
    await db.delete(pairingHistory).where(eq(pairingHistory.seasonId, s.id));
    // Delete attendance before season_weeks (FK dependency)
    const weekIds = (await db.select({ id: seasonWeeks.id }).from(seasonWeeks).where(eq(seasonWeeks.seasonId, s.id))).map((w) => w.id);
    if (weekIds.length > 0) {
      await db.delete(attendance).where(inArray(attendance.seasonWeekId, weekIds));
    }
    await db.delete(seasonWeeks).where(eq(seasonWeeks.seasonId, s.id));
    await db.delete(seasons).where(eq(seasons.id, s.id));
  }

  // Reset baseline season to known state
  await db
    .update(seasons)
    .set({ name: 'Baseline Season', totalRounds: 17, harveyLiveEnabled: 0 })
    .where(eq(seasons.id, testSeasonId));
});

// ---------------------------------------------------------------------------
// GET /seasons
// ---------------------------------------------------------------------------

describe('GET /seasons', () => {
  it('returns items array with all seasons', async () => {
    const res = await seasonApp.request('/seasons', { method: 'GET' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// POST /seasons — atomic create with weeks
// ---------------------------------------------------------------------------

describe('POST /seasons', () => {
  it('creates a season with auto-generated weeks and returns 201', async () => {
    const res = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Season',
        startDate: '2026-04-10', // Friday
        endDate: '2026-05-01', // Friday
        playoffFormat: 'top4',
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      season: { id: number; name: string; totalRounds: number };
      weeks: { id: number; friday: string; isActive: number }[];
      totalFridays: number;
    };
    expect(body.season.name).toBe('Test Season');
    expect(body.season.totalRounds).toBe(4); // 4 Fridays: Apr 10, 17, 24, May 1
    expect(body.weeks.length).toBe(4);
    expect(body.totalFridays).toBe(4);
    expect(body.weeks[0]!.friday).toBe('2026-04-10');
    expect(body.weeks[3]!.friday).toBe('2026-05-01');
    expect(body.weeks.every((w) => w.isActive === 1)).toBe(true);
  });

  it('creates a season with 1 week when start === end (same Friday)', async () => {
    const res = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Season',
        startDate: '2026-04-10',
        endDate: '2026-04-10',
        playoffFormat: 'top4',
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      season: { totalRounds: number };
      weeks: { friday: string }[];
    };
    expect(body.season.totalRounds).toBe(1);
    expect(body.weeks.length).toBe(1);
    expect(body.weeks[0]!.friday).toBe('2026-04-10');
  });

  it('returns 400 VALIDATION_ERROR when name is missing', async () => {
    const res = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDate: '2026-04-10',
        endDate: '2026-05-01',
        playoffFormat: 'top4',
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when start date is not a Friday', async () => {
    const res = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Season',
        startDate: '2026-04-11', // Saturday
        endDate: '2026-05-01',
        playoffFormat: 'top4',
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when end date is not a Friday', async () => {
    const res = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Season',
        startDate: '2026-04-10',
        endDate: '2026-05-02', // Saturday
        playoffFormat: 'top4',
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when date format is invalid', async () => {
    const res = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Season',
        startDate: 'January 1 2027',
        endDate: '2027-12-31',
        playoffFormat: 'top4',
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('creating two seasons with same dates produces independent weeks', async () => {
    // Create first season
    const res1 = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Season',
        startDate: '2026-04-10',
        endDate: '2026-04-17',
        playoffFormat: 'top4',
      }),
    });
    const body1 = (await res1.json()) as {
      season: { id: number };
      weeks: { id: number; seasonId: number }[];
    };

    // Create second season (different name to avoid cleanup collision)
    const res2 = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Season',
        startDate: '2026-04-10',
        endDate: '2026-04-17',
        playoffFormat: 'top4',
      }),
    });
    const body2 = (await res2.json()) as {
      season: { id: number };
      weeks: { id: number; seasonId: number }[];
    };

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(body1.season.id).not.toBe(body2.season.id);
    expect(body1.weeks.length).toBe(2);
    expect(body2.weeks.length).toBe(2);
    // Weeks belong to their respective seasons
    expect(body1.weeks.every((w) => w.seasonId === body1.season.id)).toBe(true);
    expect(body2.weeks.every((w) => w.seasonId === body2.season.id)).toBe(true);
    // Week IDs are distinct
    const allIds = [...body1.weeks.map((w) => w.id), ...body2.weeks.map((w) => w.id)];
    expect(new Set(allIds).size).toBe(4);
  });

  it('returns 400 when start date is after end date', async () => {
    const res = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Season',
        startDate: '2026-08-28',
        endDate: '2026-04-10',
        playoffFormat: 'top4',
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// PATCH /seasons/:id
// ---------------------------------------------------------------------------

describe('PATCH /seasons/:id', () => {
  it('updates a season field and returns 200', async () => {
    const res = await seasonApp.request(`/seasons/${testSeasonId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totalRounds: 15 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { season: { totalRounds: number } };
    expect(body.season.totalRounds).toBe(15);
  });

  it('returns 404 NOT_FOUND for unknown season ID', async () => {
    const res = await seasonApp.request('/seasons/99999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ghost' }),
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR when body has no fields', async () => {
    const res = await seasonApp.request(`/seasons/${testSeasonId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// PATCH /seasons/:id — Harvey live toggle (FR41)
// ---------------------------------------------------------------------------

describe('PATCH /seasons/:id — harveyLiveEnabled toggle', () => {
  it('enables Harvey live display (harveyLiveEnabled: true → 200, DB harvey_live_enabled = 1)', async () => {
    const res = await seasonApp.request(`/seasons/${testSeasonId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ harveyLiveEnabled: true }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      season: { id: number; harveyLiveEnabled: number };
    };
    expect(body.season.harveyLiveEnabled).toBe(1);
    expect(body.season.id).toBe(testSeasonId);

    // Verify DB updated
    const row = await db
      .select({ harveyLiveEnabled: seasons.harveyLiveEnabled })
      .from(seasons)
      .where(eq(seasons.id, testSeasonId))
      .get();
    expect(row?.harveyLiveEnabled).toBe(1);
  });

  it('disables Harvey live display (harveyLiveEnabled: false → 200, DB harvey_live_enabled = 0)', async () => {
    // First enable it
    await db
      .update(seasons)
      .set({ harveyLiveEnabled: 1 })
      .where(eq(seasons.id, testSeasonId));

    const res = await seasonApp.request(`/seasons/${testSeasonId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ harveyLiveEnabled: false }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { season: { harveyLiveEnabled: number } };
    expect(body.season.harveyLiveEnabled).toBe(0);

    // Verify DB updated
    const row = await db
      .select({ harveyLiveEnabled: seasons.harveyLiveEnabled })
      .from(seasons)
      .where(eq(seasons.id, testSeasonId))
      .get();
    expect(row?.harveyLiveEnabled).toBe(0);
  });

  it('returns 400 VALIDATION_ERROR when harveyLiveEnabled is non-boolean', async () => {
    const res = await seasonApp.request(`/seasons/${testSeasonId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ harveyLiveEnabled: 'on' }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// GET /seasons/:seasonId/weeks
// ---------------------------------------------------------------------------

describe('GET /seasons/:seasonId/weeks', () => {
  it('returns weeks with computed weekNumber ordered by friday', async () => {
    // Create a season with weeks
    const createRes = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Season',
        startDate: '2026-04-10',
        endDate: '2026-05-01',
        playoffFormat: 'top4',
      }),
    });
    const created = (await createRes.json()) as { season: { id: number } };
    const seasonId = created.season.id;

    const res = await seasonApp.request(`/seasons/${seasonId}/weeks`, {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { weekNumber: number; friday: string; isActive: number }[];
      totalFridays: number;
      activeRounds: number;
    };
    expect(body.items.length).toBe(4);
    expect(body.totalFridays).toBe(4);
    expect(body.activeRounds).toBe(4);
    expect(body.items[0]!.weekNumber).toBe(1);
    expect(body.items[0]!.friday).toBe('2026-04-10');
    expect(body.items[3]!.weekNumber).toBe(4);
    expect(body.items[3]!.friday).toBe('2026-05-01');
  });

  it('returns 404 for unknown season', async () => {
    const res = await seasonApp.request('/seasons/99999/weeks', {
      method: 'GET',
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// PATCH /seasons/:seasonId/weeks/:weekId — toggle week
// ---------------------------------------------------------------------------

describe('PATCH /seasons/:seasonId/weeks/:weekId', () => {
  async function createTestSeason(): Promise<{
    seasonId: number;
    weekIds: number[];
  }> {
    const createRes = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Season',
        startDate: '2026-04-10',
        endDate: '2026-05-01',
        playoffFormat: 'top4',
      }),
    });
    const created = (await createRes.json()) as {
      season: { id: number };
      weeks: { id: number }[];
    };
    return {
      seasonId: created.season.id,
      weekIds: created.weeks.map((w) => w.id),
    };
  }

  it('toggles a week inactive and updates activeRounds', async () => {
    const { seasonId, weekIds } = await createTestSeason();

    const res = await seasonApp.request(
      `/seasons/${seasonId}/weeks/${weekIds[1]}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      week: { isActive: number; weekNumber: number };
      activeRounds: number;
      totalFridays: number;
    };
    expect(body.week.isActive).toBe(0);
    expect(body.week.weekNumber).toBe(2);
    expect(body.activeRounds).toBe(3);
    expect(body.totalFridays).toBe(4);

    // Verify season totalRounds updated
    const season = await db
      .select({ totalRounds: seasons.totalRounds })
      .from(seasons)
      .where(eq(seasons.id, seasonId))
      .get();
    expect(season?.totalRounds).toBe(3);
  });

  it('toggles a week back to active', async () => {
    const { seasonId, weekIds } = await createTestSeason();

    // First toggle off
    await seasonApp.request(`/seasons/${seasonId}/weeks/${weekIds[0]}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    });

    // Then toggle back on
    const res = await seasonApp.request(
      `/seasons/${seasonId}/weeks/${weekIds[0]}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      week: { isActive: number };
      activeRounds: number;
    };
    expect(body.week.isActive).toBe(1);
    expect(body.activeRounds).toBe(4);
  });

  it('warns when all weeks are toggled inactive (zero active rounds)', async () => {
    const { seasonId, weekIds } = await createTestSeason();

    // Toggle all off
    for (const wId of weekIds) {
      await seasonApp.request(`/seasons/${seasonId}/weeks/${wId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      });
    }

    // Check last toggle response
    const res = await seasonApp.request(
      `/seasons/${seasonId}/weeks/${weekIds[weekIds.length - 1]}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      activeRounds: number;
      warning?: string;
    };
    expect(body.activeRounds).toBe(0);
    expect(body.warning).toBe('No active rounds remaining');
  });

  it('warns when toggling a week that has an existing round', async () => {
    const { seasonId, weekIds } = await createTestSeason();

    // Get the friday for the first week
    const weeks = await db
      .select()
      .from(seasonWeeks)
      .where(eq(seasonWeeks.id, weekIds[0]!));
    const friday = weeks[0]!.friday;

    // Insert a round matching that Friday
    await db.insert(rounds).values({
      seasonId,
      type: 'official',
      status: 'scheduled',
      scheduledDate: friday,
      createdAt: Date.now(),
    });

    const res = await seasonApp.request(
      `/seasons/${seasonId}/weeks/${weekIds[0]}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { hasRound?: boolean };
    expect(body.hasRound).toBe(true);

    // Clean up the round
    await db.delete(rounds).where(eq(rounds.seasonId, seasonId));
  });

  it('returns 404 for unknown week', async () => {
    const { seasonId } = await createTestSeason();

    const res = await seasonApp.request(
      `/seasons/${seasonId}/weeks/99999`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      },
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR for invalid body', async () => {
    const { seasonId, weekIds } = await createTestSeason();

    const res = await seasonApp.request(
      `/seasons/${seasonId}/weeks/${weekIds[0]}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: 'yes' }),
      },
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Tee rotation — season create + week toggle
// ---------------------------------------------------------------------------

describe('Tee rotation', () => {
  it('POST /seasons assigns tees on creation (blue, black, white, blue)', async () => {
    const res = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Season',
        startDate: '2026-04-10',
        endDate: '2026-05-01',
        playoffFormat: 'top4',
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      weeks: { tee: string | null; friday: string }[];
    };
    expect(body.weeks.map((w) => w.tee)).toEqual([
      'blue', 'black', 'white', 'blue',
    ]);
  });

  it('GET weeks includes tee field', async () => {
    const createRes = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Season',
        startDate: '2026-04-10',
        endDate: '2026-04-24',
        playoffFormat: 'top4',
      }),
    });
    const { season } = (await createRes.json()) as { season: { id: number } };

    const res = await seasonApp.request(`/seasons/${season.id}/weeks`, {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { tee: string | null }[];
    };
    expect(body.items.map((w) => w.tee)).toEqual(['blue', 'black', 'white']);
  });

  it('toggle week inactive recalculates tees — skipped week gets null, rotation holds', async () => {
    // Create 4-week season: blue, black, white, blue
    const createRes = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Season',
        startDate: '2026-04-10',
        endDate: '2026-05-01',
        playoffFormat: 'top4',
      }),
    });
    const created = (await createRes.json()) as {
      season: { id: number };
      weeks: { id: number }[];
    };
    const seasonId = created.season.id;

    // Toggle week 2 inactive
    await seasonApp.request(
      `/seasons/${seasonId}/weeks/${created.weeks[1]!.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      },
    );

    // Check all weeks via GET
    const res = await seasonApp.request(`/seasons/${seasonId}/weeks`, {
      method: 'GET',
    });
    const body = (await res.json()) as {
      items: { tee: string | null; isActive: number }[];
    };

    expect(body.items.map((w) => w.tee)).toEqual([
      'blue',  // week 1 active
      null,    // week 2 skipped
      'black', // week 3 active (rotation held)
      'white', // week 4 active
    ]);
  });

  it('toggle week back to active recalculates tees normally', async () => {
    const createRes = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Season',
        startDate: '2026-04-10',
        endDate: '2026-05-01',
        playoffFormat: 'top4',
      }),
    });
    const created = (await createRes.json()) as {
      season: { id: number };
      weeks: { id: number }[];
    };
    const seasonId = created.season.id;

    // Toggle week 2 off then back on
    await seasonApp.request(
      `/seasons/${seasonId}/weeks/${created.weeks[1]!.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      },
    );
    await seasonApp.request(
      `/seasons/${seasonId}/weeks/${created.weeks[1]!.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      },
    );

    const res = await seasonApp.request(`/seasons/${seasonId}/weeks`, {
      method: 'GET',
    });
    const body = (await res.json()) as {
      items: { tee: string | null }[];
    };

    // Back to normal cycle
    expect(body.items.map((w) => w.tee)).toEqual([
      'blue', 'black', 'white', 'blue',
    ]);
  });

  it('PATCH toggle response includes tee on the toggled week', async () => {
    const createRes = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Season',
        startDate: '2026-04-10',
        endDate: '2026-04-24',
        playoffFormat: 'top4',
      }),
    });
    const created = (await createRes.json()) as {
      season: { id: number };
      weeks: { id: number }[];
    };
    const seasonId = created.season.id;

    // Toggle week 2 off
    const res = await seasonApp.request(
      `/seasons/${seasonId}/weeks/${created.weeks[1]!.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      week: { tee: string | null; isActive: number };
    };
    expect(body.week.isActive).toBe(0);
    expect(body.week.tee).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Harvey live default
// ---------------------------------------------------------------------------

describe('Harvey live default', () => {
  it('POST /seasons defaults harveyLiveEnabled to 1 (ON)', async () => {
    const res = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Season',
        startDate: '2026-04-10',
        endDate: '2026-04-10',
        playoffFormat: 'top4',
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { season: { harveyLiveEnabled: number } };
    expect(body.season.harveyLiveEnabled).toBe(1);
  });

  it('POST /seasons with harveyLiveEnabled: false → stored as 0', async () => {
    const res = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Season',
        startDate: '2026-04-10',
        endDate: '2026-04-10',
        playoffFormat: 'top4',
        harveyLiveEnabled: false,
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { season: { harveyLiveEnabled: number } };
    expect(body.season.harveyLiveEnabled).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// DELETE /seasons/:id — cascading delete
// ---------------------------------------------------------------------------

describe('DELETE /seasons/:id', () => {
  it('deletes an empty season (no rounds)', async () => {
    const createRes = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Season',
        startDate: '2026-04-10',
        endDate: '2026-04-10',
        playoffFormat: 'top4',
      }),
    });
    const { season } = (await createRes.json()) as { season: { id: number } };

    const res = await seasonApp.request(`/seasons/${season.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean; seasonName: string };
    expect(body.deleted).toBe(true);
    expect(body.seasonName).toBe('Test Season');

    // Verify season is gone
    const checkRes = await seasonApp.request(`/seasons/${season.id}/weeks`, {
      method: 'GET',
    });
    expect(checkRes.status).toBe(404);
  });

  it('deletes a season with rounds and all dependent data', async () => {
    // Create season
    const createRes = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Season',
        startDate: '2026-04-10',
        endDate: '2026-04-10',
        playoffFormat: 'top4',
      }),
    });
    const { season } = (await createRes.json()) as { season: { id: number } };

    // Insert a round with dependent data
    const [round] = await db
      .insert(rounds)
      .values({
        seasonId: season.id,
        type: 'official',
        status: 'scheduled',
        scheduledDate: '2026-04-10',
        createdAt: Date.now(),
      })
      .returning();

    const [group] = await db
      .insert(groups)
      .values({ roundId: round!.id, groupNumber: 1 })
      .returning();

    await db.insert(roundPlayers).values({
      roundId: round!.id,
      playerId: 1,
      groupId: group!.id,
      handicapIndex: 10.0,
    });

    // Add side game + pairing history
    await db.insert(sideGames).values({
      seasonId: season.id,
      name: 'Closest to Pin',
      format: 'weekly',
      createdAt: Date.now(),
    });

    await db.insert(pairingHistory).values({
      seasonId: season.id,
      playerAId: 1,
      playerBId: 2,
      pairCount: 3,
    });

    // Delete season
    const res = await seasonApp.request(`/seasons/${season.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean };
    expect(body.deleted).toBe(true);

    // Verify round is gone
    const roundCheck = await db
      .select()
      .from(rounds)
      .where(eq(rounds.seasonId, season.id));
    expect(roundCheck.length).toBe(0);

    // Verify weeks are gone
    const weekCheck = await db
      .select()
      .from(seasonWeeks)
      .where(eq(seasonWeeks.seasonId, season.id));
    expect(weekCheck.length).toBe(0);

    // Verify side games are gone
    const sideGameCheck = await db
      .select()
      .from(sideGames)
      .where(eq(sideGames.seasonId, season.id));
    expect(sideGameCheck.length).toBe(0);

    // Verify pairing history is gone
    const pairingCheck = await db
      .select()
      .from(pairingHistory)
      .where(eq(pairingHistory.seasonId, season.id));
    expect(pairingCheck.length).toBe(0);
  });

  it('returns 404 for non-existent season', async () => {
    const res = await seasonApp.request('/seasons/99999', {
      method: 'DELETE',
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// GET /seasons/:id/stats
// ---------------------------------------------------------------------------

describe('GET /seasons/:id/stats', () => {
  it('returns correct round and player counts', async () => {
    const createRes = await seasonApp.request('/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Season',
        startDate: '2026-04-10',
        endDate: '2026-04-10',
        playoffFormat: 'top4',
      }),
    });
    const { season } = (await createRes.json()) as { season: { id: number } };

    // Add a round with 2 players
    const [round] = await db
      .insert(rounds)
      .values({
        seasonId: season.id,
        type: 'official',
        status: 'finalized',
        scheduledDate: '2026-04-10',
        createdAt: Date.now(),
      })
      .returning();

    const [group] = await db
      .insert(groups)
      .values({ roundId: round!.id, groupNumber: 1 })
      .returning();

    await db.insert(roundPlayers).values([
      { roundId: round!.id, playerId: 1, groupId: group!.id, handicapIndex: 10.0 },
      { roundId: round!.id, playerId: 2, groupId: group!.id, handicapIndex: 15.0 },
    ]);

    const res = await seasonApp.request(`/seasons/${season.id}/stats`, {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      seasonName: string;
      roundCount: number;
      playerCount: number;
      hasFinalized: boolean;
    };
    expect(body.seasonName).toBe('Test Season');
    expect(body.roundCount).toBe(1);
    expect(body.playerCount).toBe(2);
    expect(body.hasFinalized).toBe(true);
  });

  it('returns 404 for non-existent season', async () => {
    const res = await seasonApp.request('/seasons/99999/stats', {
      method: 'GET',
    });

    expect(res.status).toBe(404);
  });
});
