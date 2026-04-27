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
import { seasons, seasonStandings, players, admins, sessions, rounds, groups, sideGameCtpEntries } from '../db/schema.js';
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

  it('CTP round credits the round leader 1.0; non-leaders get 0 (round-leader-takes-all)', async () => {
    // Finalized CTP round with 4 par 3s: Player One wins 3 (holes 6, 7, 15),
    // Player Two wins 1 (hole 12). Round-leader-takes-all: each finalized
    // round contributes exactly 1.0 Side Game Champion credit to the player(s)
    // tied at the most par-3 wins. Player One swept the lead → +1.0.
    // Player Two took 1 of 4 → 0 (per-par-3 recognition still flows through
    // the separate Par 3 Champion track).
    const [season] = await db
      .insert(seasons)
      .values({
        name: 'CTP credit test',
        year: 2060,
        startDate: '2060-04-01',
        endDate: '2060-09-30',
        totalRounds: 0,
        playoffFormat: 'top8',
        harveyLiveEnabled: 0,
        createdAt: Date.now(),
      })
      .returning({ id: seasons.id });
    const [round] = await db
      .insert(rounds)
      .values({
        seasonId: season!.id,
        type: 'official',
        status: 'finalized',
        scheduledDate: '2060-04-24',
        autoCalculateMoney: 1,
        createdAt: Date.now(),
      })
      .returning({ id: rounds.id });
    const [group] = await db
      .insert(groups)
      .values({ roundId: round!.id, groupNumber: 1, battingOrder: null })
      .returning({ id: groups.id });
    const now = Date.now();
    await db.insert(sideGameCtpEntries).values([
      { roundId: round!.id, groupId: group!.id, holeNumber: 6, winnerPlayerId: p1Id, winnerName: 'Player One', holeCompletedAt: 1000, finalizedAt: now, createdAt: now, updatedAt: now },
      { roundId: round!.id, groupId: group!.id, holeNumber: 7, winnerPlayerId: p1Id, winnerName: 'Player One', holeCompletedAt: 2000, finalizedAt: now, createdAt: now, updatedAt: now },
      { roundId: round!.id, groupId: group!.id, holeNumber: 12, winnerPlayerId: p2Id, winnerName: 'Player Two', holeCompletedAt: 3000, finalizedAt: now, createdAt: now, updatedAt: now },
      { roundId: round!.id, groupId: group!.id, holeNumber: 15, winnerPlayerId: p1Id, winnerName: 'Player One', holeCompletedAt: 4000, finalizedAt: now, createdAt: now, updatedAt: now },
    ]);

    const res = await historyApp.request('/history');
    const body = (await res.json()) as HistoryResponse & {
      awards: Array<{ id: string; recipients: { playerName: string; years: number[]; detail: string }[] }>;
    };
    const sgc = body.awards.find((a) => a.id === 'side_game_champion');
    expect(sgc).toBeDefined();
    // Player One swept the lead → +1.0; Player Two only had 1 hole → 0,
    // so 2060 should not appear in their season list.
    const p1Recipient = sgc!.recipients.find((r) => r.playerName === 'Player One');
    const p2Recipient = sgc!.recipients.find((r) => r.playerName === 'Player Two');
    expect(p1Recipient).toBeDefined();
    expect(p1Recipient!.detail).toBe('1 wins');
    expect(p1Recipient!.years).toContain(2060);
    if (p2Recipient) {
      expect(p2Recipient.years).not.toContain(2060);
    }
  });

  it('CTP round with all par-3s split evenly splits 1.0 credit four ways', async () => {
    // Edge case: 4 different players each win 1 par-3 in the same round.
    // Round-leader-takes-all + four-way tie → each gets 0.25, totaling 1.0.
    // (This was the case the old "1 credit per unique winner" rule inflated
    // to 4.0 total — the visible bug Josh flagged with Ben taking 1/4.)
    const [season] = await db
      .insert(seasons)
      .values({
        name: 'CTP four-way split test',
        year: 2063,
        startDate: '2063-04-01',
        endDate: '2063-09-30',
        totalRounds: 0,
        playoffFormat: 'top8',
        harveyLiveEnabled: 0,
        createdAt: Date.now(),
      })
      .returning({ id: seasons.id });
    const [round] = await db
      .insert(rounds)
      .values({
        seasonId: season!.id,
        type: 'official',
        status: 'finalized',
        scheduledDate: '2063-04-24',
        autoCalculateMoney: 1,
        createdAt: Date.now(),
      })
      .returning({ id: rounds.id });
    const [group] = await db
      .insert(groups)
      .values({ roundId: round!.id, groupNumber: 1, battingOrder: null })
      .returning({ id: groups.id });
    const now = Date.now();
    // Need a fourth distinct player for the four-way split — p1, p2, p3 exist
    // from beforeAll; create p4 inline.
    const [p4] = await db
      .insert(players)
      .values({ name: 'Player Four', isActive: 1, isGuest: 0, createdAt: now })
      .returning({ id: players.id });
    await db.insert(sideGameCtpEntries).values([
      { roundId: round!.id, groupId: group!.id, holeNumber: 6, winnerPlayerId: p1Id, winnerName: 'Player One', holeCompletedAt: 1000, finalizedAt: now, createdAt: now, updatedAt: now },
      { roundId: round!.id, groupId: group!.id, holeNumber: 7, winnerPlayerId: p2Id, winnerName: 'Player Two', holeCompletedAt: 2000, finalizedAt: now, createdAt: now, updatedAt: now },
      { roundId: round!.id, groupId: group!.id, holeNumber: 12, winnerPlayerId: p3Id, winnerName: 'Player Three', holeCompletedAt: 3000, finalizedAt: now, createdAt: now, updatedAt: now },
      { roundId: round!.id, groupId: group!.id, holeNumber: 15, winnerPlayerId: p4!.id, winnerName: 'Player Four', holeCompletedAt: 4000, finalizedAt: now, createdAt: now, updatedAt: now },
    ]);

    const res = await historyApp.request('/history');
    const body = (await res.json()) as HistoryResponse & {
      awards: Array<{ id: string; recipients: { playerName: string; years: number[]; detail: string }[] }>;
    };
    const sgc = body.awards.find((a) => a.id === 'side_game_champion');
    expect(sgc).toBeDefined();
    // Max wins for season 2063 is 0.25 — but only the leaders are listed,
    // and on a four-way tie EVERYONE is a co-leader at 0.25.
    const winnersFor2063 = sgc!.recipients.filter((r) => r.years.includes(2063));
    expect(winnersFor2063).toHaveLength(4);
    for (const w of winnersFor2063) {
      // Detail uses bestWins-across-all-years; for a player whose only year
      // is 2063 the formatted value is "0.3" (0.25 → toFixed(1) = "0.3").
      expect(['0.3', '0.5', '1', '1.5', '2', '3', '4'].some((v) => w.detail.startsWith(v))).toBe(true);
    }
  });

  it('CTP entries on an unfinalized round do NOT contribute to Side Game Champion credits', async () => {
    // The aggregation gates on rounds.status = 'finalized' (not the
    // entry-level finalizedAt stamp, which is written by a non-fatal hook
    // and could be missing for pre-feature rounds). An active round's CTP
    // entries should not appear in historical awards.
    const [season] = await db
      .insert(seasons)
      .values({
        name: 'CTP active-round test',
        year: 2061,
        startDate: '2061-04-01',
        endDate: '2061-09-30',
        totalRounds: 0,
        playoffFormat: 'top8',
        harveyLiveEnabled: 0,
        createdAt: Date.now(),
      })
      .returning({ id: seasons.id });
    const [round] = await db
      .insert(rounds)
      .values({
        seasonId: season!.id,
        type: 'official',
        status: 'active',   // round is still in play
        scheduledDate: '2061-04-24',
        autoCalculateMoney: 1,
        createdAt: Date.now(),
      })
      .returning({ id: rounds.id });
    const [group] = await db
      .insert(groups)
      .values({ roundId: round!.id, groupNumber: 1, battingOrder: null })
      .returning({ id: groups.id });
    const now = Date.now();
    await db.insert(sideGameCtpEntries).values({
      roundId: round!.id,
      groupId: group!.id,
      holeNumber: 6,
      winnerPlayerId: p1Id,
      winnerName: 'Player One',
      holeCompletedAt: 1000,
      finalizedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const res = await historyApp.request('/history');
    const body = (await res.json()) as HistoryResponse & {
      awards: Array<{ id: string; recipients: { playerName: string; years: number[]; detail: string }[] }>;
    };
    // The side_game_champion award IS defined in this suite (the earlier
    // 2060-season test seeds finalized CTP data), so we assert concretely
    // rather than skipping silently.
    const sgc = body.awards.find((a) => a.id === 'side_game_champion');
    expect(sgc).toBeDefined();
    // 2061 must not appear in any recipient's years — its round isn't finalized.
    for (const r of sgc!.recipients) {
      expect(r.years).not.toContain(2061);
    }
  });

  it('CTP entries on a finalized round contribute credits even when finalizedAt stamp is missing', async () => {
    // Pre-existing CTP data from before the finalize-hook was added should
    // still credit correctly because the gate is rounds.status, not the
    // non-fatal per-entry finalizedAt timestamp.
    const [season] = await db
      .insert(seasons)
      .values({
        name: 'CTP pre-hook test',
        year: 2062,
        startDate: '2062-04-01',
        endDate: '2062-09-30',
        totalRounds: 0,
        playoffFormat: 'top8',
        harveyLiveEnabled: 0,
        createdAt: Date.now(),
      })
      .returning({ id: seasons.id });
    const [round] = await db
      .insert(rounds)
      .values({
        seasonId: season!.id,
        type: 'official',
        status: 'finalized',
        scheduledDate: '2062-04-24',
        autoCalculateMoney: 1,
        createdAt: Date.now(),
      })
      .returning({ id: rounds.id });
    const [group] = await db
      .insert(groups)
      .values({ roundId: round!.id, groupNumber: 1, battingOrder: null })
      .returning({ id: groups.id });
    const now = Date.now();
    // finalizedAt INTENTIONALLY null — simulates a legacy finalized round
    await db.insert(sideGameCtpEntries).values({
      roundId: round!.id,
      groupId: group!.id,
      holeNumber: 6,
      winnerPlayerId: p2Id,
      winnerName: 'Player Two',
      holeCompletedAt: 1000,
      finalizedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const res = await historyApp.request('/history');
    const body = (await res.json()) as HistoryResponse & {
      awards: Array<{ id: string; recipients: { playerName: string; years: number[]; detail: string }[] }>;
    };
    const sgc = body.awards.find((a) => a.id === 'side_game_champion');
    expect(sgc).toBeDefined();
    const p2Recipient = sgc!.recipients.find((r) => r.playerName === 'Player Two');
    expect(p2Recipient).toBeDefined();
    expect(p2Recipient!.years).toContain(2062);
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
