import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { vi } from 'vitest';
import { eq } from 'drizzle-orm';
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

import leaderboardApp from './leaderboard.js';
import { db } from '../db/index.js';
import {
  seasons,
  rounds,
  groups,
  roundPlayers,
  players,
  holeScores,
  roundResults,
  harveyResults,
  sideGames,
} from '../db/schema.js';
import { migrate } from 'drizzle-orm/libsql/migrator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

const TODAY = new Date().toISOString().slice(0, 10);

// Fixed season/round IDs shared across all tests
let seasonId: number;
let roundId: number;
let groupId: number;
let p1Id: number;
let p2Id: number;
let p3Id: number;
let p4Id: number;

beforeAll(async () => {
  await migrate(db, { migrationsFolder });

  const [season] = await db
    .insert(seasons)
    .values({
      name: '2026',
      year: 3020,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      totalRounds: 15,
      playoffFormat: 'top-8',
      harveyLiveEnabled: 0,
      createdAt: Date.now(),
    })
    .returning({ id: seasons.id });
  seasonId = season!.id;

  const [round] = await db
    .insert(rounds)
    .values({
      seasonId,
      type: 'official',
      status: 'active',
      scheduledDate: TODAY,
      entryCodeHash: null,
      autoCalculateMoney: 1,
      createdAt: Date.now(),
    })
    .returning({ id: rounds.id });
  roundId = round!.id;

  const [group] = await db
    .insert(groups)
    .values({ roundId, groupNumber: 1, battingOrder: null })
    .returning({ id: groups.id });
  groupId = group!.id;

  const playerInserts = await db
    .insert(players)
    .values([
      { name: 'Alice', ghinNumber: null, isActive: 1, createdAt: Date.now() },
      { name: 'Bob', ghinNumber: null, isActive: 1, createdAt: Date.now() },
      { name: 'Carol', ghinNumber: null, isActive: 1, createdAt: Date.now() },
      { name: 'Dan', ghinNumber: null, isActive: 1, createdAt: Date.now() },
    ])
    .returning({ id: players.id });
  [p1Id, p2Id, p3Id, p4Id] = playerInserts.map((p) => p.id) as [number, number, number, number];

  await db.insert(roundPlayers).values([
    { roundId, groupId, playerId: p1Id, handicapIndex: 10, isSub: 0 },
    { roundId, groupId, playerId: p2Id, handicapIndex: 12, isSub: 0 },
    { roundId, groupId, playerId: p3Id, handicapIndex: 8, isSub: 0 },
    { roundId, groupId, playerId: p4Id, handicapIndex: 15, isSub: 0 },
  ]);
});

afterEach(async () => {
  // Clean per-test data — preserve season, round, group, players, round_players
  await db.delete(holeScores).where(eq(holeScores.roundId, roundId));
  await db.delete(roundResults).where(eq(roundResults.roundId, roundId));
  await db.delete(harveyResults).where(eq(harveyResults.roundId, roundId));
  await db.delete(sideGames).where(eq(sideGames.seasonId, seasonId));
  // Restore round status/date in case a test changed them
  await db
    .update(rounds)
    .set({ status: 'active', scheduledDate: TODAY, seasonId })
    .where(eq(rounds.id, roundId));
  await db
    .update(seasons)
    .set({ harveyLiveEnabled: 0 })
    .where(eq(seasons.id, seasonId));
});

// ---------------------------------------------------------------------------
// GET /leaderboard/live
// ---------------------------------------------------------------------------

describe('GET /leaderboard/live', () => {
  it('returns 200 with round: null when no scheduled/active round today', async () => {
    // Temporarily mark round as finalized
    await db.update(rounds).set({ status: 'finalized' }).where(eq(rounds.id, roundId));
    const res = await leaderboardApp.request('/leaderboard/live');
    expect(res.status).toBe(200);
    const body = await res.json() as { round: null; leaderboard: unknown[] };
    expect(body.round).toBeNull();
    expect(body.leaderboard).toHaveLength(0);
  });

  it('returns 200 with all 4 players, totals=0, thruHole=0 when round has no scores', async () => {
    const res = await leaderboardApp.request('/leaderboard/live');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      round: { id: number };
      leaderboard: Array<{ playerId: number; stablefordTotal: number; moneyTotal: number; thruHole: number }>;
    };
    expect(body.round?.id).toBe(roundId);
    expect(body.leaderboard).toHaveLength(4);
    for (const row of body.leaderboard) {
      expect(row.stablefordTotal).toBe(0);
      expect(row.moneyTotal).toBe(0);
      expect(row.thruHole).toBe(0);
    }
  });

  it('returns correct thruHole from hole_scores MAX per group — all players in group show same value', async () => {
    const now = Date.now();
    // Only Alice has scores, but thruHole is group-scoped (MAX for the group)
    await db.insert(holeScores).values([
      { roundId, groupId, playerId: p1Id, holeNumber: 1, grossScore: 4, createdAt: now, updatedAt: now },
      { roundId, groupId, playerId: p1Id, holeNumber: 5, grossScore: 5, createdAt: now, updatedAt: now },
    ]);
    const res = await leaderboardApp.request('/leaderboard/live');
    const body = await res.json() as {
      leaderboard: Array<{ playerId: number; thruHole: number }>;
    };
    // All 4 players in the same group must show thruHole=5 (group-scoped, not per-player)
    for (const row of body.leaderboard) {
      expect(row.thruHole).toBe(5);
    }
  });

  it('returns stablefordTotal and moneyTotal from round_results', async () => {
    const now = Date.now();
    await db.insert(roundResults).values([
      { roundId, playerId: p1Id, stablefordTotal: 22, moneyTotal: 3, updatedAt: now },
      { roundId, playerId: p2Id, stablefordTotal: 18, moneyTotal: -1, updatedAt: now },
      { roundId, playerId: p3Id, stablefordTotal: 18, moneyTotal: 2, updatedAt: now },
      { roundId, playerId: p4Id, stablefordTotal: 15, moneyTotal: -4, updatedAt: now },
    ]);
    const res = await leaderboardApp.request('/leaderboard/live');
    const body = await res.json() as {
      leaderboard: Array<{ playerId: number; stablefordTotal: number; moneyTotal: number }>;
    };
    const alice = body.leaderboard.find((r) => r.playerId === p1Id)!;
    expect(alice.stablefordTotal).toBe(22);
    expect(alice.moneyTotal).toBe(3);
    const bob = body.leaderboard.find((r) => r.playerId === p2Id)!;
    expect(bob.stablefordTotal).toBe(18);
  });

  it('assigns correct dense ranks: ties get same rank, next rank skips', async () => {
    const now = Date.now();
    // p1=22, p2=18, p3=18, p4=15 → ranks: 1, 2, 2, 4
    await db.insert(roundResults).values([
      { roundId, playerId: p1Id, stablefordTotal: 22, moneyTotal: 0, updatedAt: now },
      { roundId, playerId: p2Id, stablefordTotal: 18, moneyTotal: 0, updatedAt: now },
      { roundId, playerId: p3Id, stablefordTotal: 18, moneyTotal: 0, updatedAt: now },
      { roundId, playerId: p4Id, stablefordTotal: 15, moneyTotal: 0, updatedAt: now },
    ]);
    const res = await leaderboardApp.request('/leaderboard/live');
    const body = await res.json() as {
      leaderboard: Array<{ playerId: number; stablefordRank: number; stablefordTotal: number }>;
    };
    const alice = body.leaderboard.find((r) => r.playerId === p1Id)!;
    const bob = body.leaderboard.find((r) => r.playerId === p2Id)!;
    const carol = body.leaderboard.find((r) => r.playerId === p3Id)!;
    const dan = body.leaderboard.find((r) => r.playerId === p4Id)!;
    expect(alice.stablefordRank).toBe(1);
    expect(bob.stablefordRank).toBe(2);
    expect(carol.stablefordRank).toBe(2);
    expect(dan.stablefordRank).toBe(4); // gap skip (dense)
  });

  it('returns sorted by stablefordRank then name ascending', async () => {
    const now = Date.now();
    await db.insert(roundResults).values([
      { roundId, playerId: p1Id, stablefordTotal: 18, moneyTotal: 0, updatedAt: now },
      { roundId, playerId: p2Id, stablefordTotal: 22, moneyTotal: 0, updatedAt: now },
      { roundId, playerId: p3Id, stablefordTotal: 18, moneyTotal: 0, updatedAt: now },
      { roundId, playerId: p4Id, stablefordTotal: 15, moneyTotal: 0, updatedAt: now },
    ]);
    const res = await leaderboardApp.request('/leaderboard/live');
    const body = await res.json() as { leaderboard: Array<{ playerId: number; name: string }> };
    // Bob=22 (rank 1), then Alice+Carol=18 (rank 2, alphabetical), then Dan=15 (rank 4)
    expect(body.leaderboard[0]!.playerId).toBe(p2Id); // Bob
    expect(body.leaderboard[1]!.name).toBe('Alice');
    expect(body.leaderboard[2]!.name).toBe('Carol');
    expect(body.leaderboard[3]!.playerId).toBe(p4Id); // Dan
  });

  it('returns harveyLiveEnabled: false and no harvey fields when disabled', async () => {
    const res = await leaderboardApp.request('/leaderboard/live');
    const body = await res.json() as {
      harveyLiveEnabled: boolean;
      leaderboard: Array<{ harveyStableford: unknown; harveyMoney: unknown }>;
    };
    expect(body.harveyLiveEnabled).toBe(false);
    for (const row of body.leaderboard) {
      expect(row.harveyStableford).toBeNull();
      expect(row.harveyMoney).toBeNull();
    }
  });

  it('returns harvey fields when harveyLiveEnabled: true', async () => {
    await db.update(seasons).set({ harveyLiveEnabled: 1 }).where(eq(seasons.id, seasonId));
    const now = Date.now();
    await db.insert(harveyResults).values([
      {
        roundId,
        playerId: p1Id,
        stablefordRank: 1,
        moneyRank: 1,
        stablefordPoints: 4,
        moneyPoints: 4,
        updatedAt: now,
      },
      {
        roundId,
        playerId: p2Id,
        stablefordRank: 2,
        moneyRank: 2,
        stablefordPoints: 3,
        moneyPoints: 2.5,
        updatedAt: now,
      },
    ]);
    const res = await leaderboardApp.request('/leaderboard/live');
    const body = await res.json() as {
      harveyLiveEnabled: boolean;
      leaderboard: Array<{ playerId: number; harveyStableford: number | null; harveyMoney: number | null }>;
    };
    expect(body.harveyLiveEnabled).toBe(true);
    const alice = body.leaderboard.find((r) => r.playerId === p1Id)!;
    expect(alice.harveyStableford).toBe(4);
    expect(alice.harveyMoney).toBe(4);
    // Players without harvey_results get null
    const carol = body.leaderboard.find((r) => r.playerId === p3Id)!;
    expect(carol.harveyStableford).toBeNull();
    expect(carol.harveyMoney).toBeNull();
  });

  it('returns sideGame when scheduledRoundIds includes current round', async () => {
    await db.insert(sideGames).values({
      seasonId,
      name: 'Skins',
      format: 'Low net per hole wins pot',
      scheduledRoundIds: JSON.stringify([roundId]),
      createdAt: Date.now(),
    });
    const res = await leaderboardApp.request('/leaderboard/live');
    const body = await res.json() as { sideGame: { name: string; format: string } | null };
    expect(body.sideGame).not.toBeNull();
    expect(body.sideGame!.name).toBe('Skins');
    expect(body.sideGame!.format).toBe('Low net per hole wins pot');
  });

  it('returns sideGame: null when scheduledRoundIds does not include current round', async () => {
    await db.insert(sideGames).values({
      seasonId,
      name: 'Closest to Pin',
      format: 'Par 3s',
      scheduledRoundIds: JSON.stringify([999]),
      createdAt: Date.now(),
    });
    const res = await leaderboardApp.request('/leaderboard/live');
    const body = await res.json() as { sideGame: null };
    expect(body.sideGame).toBeNull();
  });

  it('returns sideGame: null when no side games exist for season', async () => {
    const res = await leaderboardApp.request('/leaderboard/live');
    const body = await res.json() as { sideGame: null };
    expect(body.sideGame).toBeNull();
  });

  it('response contains lastUpdated ISO string', async () => {
    const res = await leaderboardApp.request('/leaderboard/live');
    const body = await res.json() as { lastUpdated: string };
    expect(typeof body.lastUpdated).toBe('string');
    expect(() => new Date(body.lastUpdated)).not.toThrow();
  });

  it('includes round info with correct shape', async () => {
    const res = await leaderboardApp.request('/leaderboard/live');
    const body = await res.json() as {
      round: {
        id: number;
        type: string;
        status: string;
        scheduledDate: string;
        autoCalculateMoney: boolean;
      };
    };
    expect(body.round?.id).toBe(roundId);
    expect(body.round?.type).toBe('official');
    expect(body.round?.status).toBe('active');
    expect(body.round?.scheduledDate).toBe(TODAY);
    expect(body.round?.autoCalculateMoney).toBe(true);
  });
});
