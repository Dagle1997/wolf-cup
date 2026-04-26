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

import statsApp from './stats.js';
import { db } from '../db/index.js';
import {
  seasons,
  rounds,
  groups,
  roundPlayers,
  players,
  wolfDecisions,
  holeScores,
  roundResults,
  sideGameCtpEntries,
} from '../db/schema.js';
import { migrate } from 'drizzle-orm/libsql/migrator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

// Fixed IDs shared across tests
let seasonId: number;
let roundId: number;
let groupId: number;
let p1Id: number;
let p2Id: number;

type PlayerStats = {
  playerId: number;
  name: string;
  wolfCallsTotal: number;
  wolfCallsWolf: number;
  wolfCallsBlindWolf: number;
  wolfWins: number;
  wolfLosses: number;
  wolfPushes: number;
  birdies: number;
  eagles: number;
  greenies: number;
  polies: number;
  totalMoney: number;
  biggestRoundWin: number;
  biggestRoundLoss: number;
};

type StatsResponse = {
  players: PlayerStats[];
  lastUpdated: string;
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder });

  const [season] = await db
    .insert(seasons)
    .values({
      name: '2026',
      year: 3040,
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
      status: 'finalized',
      scheduledDate: '2026-01-15',
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
      { name: 'Alice', ghinNumber: null, isActive: 1, isGuest: 0, createdAt: Date.now() },
      { name: 'Bob', ghinNumber: null, isActive: 1, isGuest: 0, createdAt: Date.now() },
    ])
    .returning({ id: players.id });
  [p1Id, p2Id] = playerInserts.map((p) => p.id) as [number, number];

  await db.insert(roundPlayers).values([
    { roundId, groupId, playerId: p1Id, handicapIndex: 10, isSub: 0 },
    { roundId, groupId, playerId: p2Id, handicapIndex: 0, isSub: 0 },
  ]);
});

afterEach(async () => {
  await db.delete(wolfDecisions).where(eq(wolfDecisions.roundId, roundId));
  await db.delete(holeScores).where(eq(holeScores.roundId, roundId));
  await db.delete(roundResults).where(eq(roundResults.roundId, roundId));
});

// ---------------------------------------------------------------------------
// GET /stats
// ---------------------------------------------------------------------------

describe('GET /stats', () => {
  it('returns 200 with correct shape (players array + lastUpdated)', async () => {
    const res = await statsApp.request('/stats');
    expect(res.status).toBe(200);
    const body = (await res.json()) as StatsResponse;
    expect(Array.isArray(body.players)).toBe(true);
    // Alice and Bob are seeded in beforeAll — both should appear
    expect(body.players.length).toBeGreaterThanOrEqual(2);
    expect(body.players.find((p) => p.name === 'Alice')).toBeDefined();
    expect(body.players.find((p) => p.name === 'Bob')).toBeDefined();
    expect(typeof body.lastUpdated).toBe('string');
  });

  it('returns player with all zeros when they have no rounds played', async () => {
    const res = await statsApp.request('/stats');
    expect(res.status).toBe(200);
    const body = (await res.json()) as StatsResponse;
    const alice = body.players.find((p) => p.playerId === p1Id)!;
    expect(alice).toBeDefined();
    expect(alice.wolfCallsTotal).toBe(0);
    expect(alice.wolfCallsWolf).toBe(0);
    expect(alice.wolfCallsBlindWolf).toBe(0);
    expect(alice.wolfWins).toBe(0);
    expect(alice.wolfLosses).toBe(0);
    expect(alice.wolfPushes).toBe(0);
    expect(alice.birdies).toBe(0);
    expect(alice.eagles).toBe(0);
    expect(alice.greenies).toBe(0);
    expect(alice.polies).toBe(0);
    expect(alice.biggestRoundWin).toBe(0);
    expect(alice.biggestRoundLoss).toBe(0);
  });

  it('counts wolf record correctly (alone / partner / win / loss / push)', async () => {
    const now = Date.now();
    await db.insert(wolfDecisions).values([
      // Alice is wolf — alone, wins
      {
        roundId,
        groupId,
        holeNumber: 3,
        wolfPlayerId: p1Id,
        decision: 'alone',
        partnerPlayerId: null,
        bonusesJson: null,
        outcome: 'win',
        createdAt: now,
      },
      // Alice is wolf — partner, loses
      {
        roundId,
        groupId,
        holeNumber: 4,
        wolfPlayerId: p1Id,
        decision: 'partner',
        partnerPlayerId: p2Id,
        bonusesJson: null,
        outcome: 'loss',
        createdAt: now,
      },
      // Alice is wolf — alone, push
      {
        roundId,
        groupId,
        holeNumber: 5,
        wolfPlayerId: p1Id,
        decision: 'alone',
        partnerPlayerId: null,
        bonusesJson: null,
        outcome: 'push',
        createdAt: now,
      },
    ]);

    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponse;
    const alice = body.players.find((p) => p.playerId === p1Id)!;
    expect(alice.wolfCallsTotal).toBe(3);
    expect(alice.wolfCallsWolf).toBe(2);
    expect(alice.wolfCallsBlindWolf).toBe(0);
    // W-L-T only counts alone/blind_wolf decisions — partner decision doesn't count
    expect(alice.wolfWins).toBe(1);
    expect(alice.wolfLosses).toBe(0);
    expect(alice.wolfPushes).toBe(1);
  });

  it('counts blind_wolf as wolfCallsAlone', async () => {
    const now = Date.now();
    await db.insert(wolfDecisions).values({
      roundId,
      groupId,
      holeNumber: 3,
      wolfPlayerId: p1Id,
      decision: 'blind_wolf',
      partnerPlayerId: null,
      bonusesJson: null,
      outcome: 'win',
      createdAt: now,
    });

    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponse;
    const alice = body.players.find((p) => p.playerId === p1Id)!;
    expect(alice.wolfCallsTotal).toBe(1);
    expect(alice.wolfCallsWolf).toBe(0);
    expect(alice.wolfCallsBlindWolf).toBe(1);
    expect(alice.wolfWins).toBe(1);
  });

  it('skips wolf_decisions rows with null wolfPlayerId (skins holes)', async () => {
    const now = Date.now();
    // Skins hole — wolfPlayerId is null
    await db.insert(wolfDecisions).values({
      roundId,
      groupId,
      holeNumber: 1,
      wolfPlayerId: null,
      decision: null,
      partnerPlayerId: null,
      bonusesJson: null,
      outcome: null,
      createdAt: now,
    });

    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponse;
    const alice = body.players.find((p) => p.playerId === p1Id)!;
    expect(alice.wolfCallsTotal).toBe(0);
  });

  it('extracts greenies and polies from bonusesJson', async () => {
    const now = Date.now();
    await db.insert(wolfDecisions).values({
      roundId,
      groupId,
      holeNumber: 3,
      wolfPlayerId: p1Id,
      decision: 'alone',
      partnerPlayerId: null,
      bonusesJson: JSON.stringify({ greenies: [p1Id], polies: [p1Id, p2Id], sandies: [] }),
      outcome: 'win',
      createdAt: now,
    });

    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponse;
    const alice = body.players.find((p) => p.playerId === p1Id)!;
    const bob = body.players.find((p) => p.playerId === p2Id)!;
    expect(alice.greenies).toBe(1);
    expect(alice.polies).toBe(1);
    expect(bob.greenies).toBe(0);
    expect(bob.polies).toBe(1);
  });

  it('counts greenies/polies from rows where the player is NOT the wolf', async () => {
    const now = Date.now();
    // Bob is the wolf; Alice appears in bonusesJson — should still count for Alice
    await db.insert(wolfDecisions).values({
      roundId,
      groupId,
      holeNumber: 3,
      wolfPlayerId: p2Id,
      decision: 'alone',
      partnerPlayerId: null,
      bonusesJson: JSON.stringify({ greenies: [p1Id], polies: [p1Id], sandies: [] }),
      outcome: 'win',
      createdAt: now,
    });

    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponse;
    const alice = body.players.find((p) => p.playerId === p1Id)!;
    const bob = body.players.find((p) => p.playerId === p2Id)!;
    expect(alice.greenies).toBe(1);
    expect(alice.polies).toBe(1);
    expect(bob.greenies).toBe(0);
    expect(bob.polies).toBe(0);
  });

  it('computes gross birdies correctly (gross score === par - 1)', async () => {
    const now = Date.now();
    // Hole 6: par 3 — gross=2 → birdie (1 under par)
    await db.insert(holeScores).values({
      roundId,
      groupId,
      playerId: p2Id,
      holeNumber: 6,
      grossScore: 2,
      createdAt: now,
      updatedAt: now,
    });

    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponse;
    const bob = body.players.find((p) => p.playerId === p2Id)!;
    expect(bob.birdies).toBe(1);
    expect(bob.eagles).toBe(0);
  });

  it('computes gross eagles correctly (gross score <= par - 2)', async () => {
    const now = Date.now();
    // Hole 6: par 3 — gross=1 → eagle (2 under par)
    await db.insert(holeScores).values({
      roundId,
      groupId,
      playerId: p2Id,
      holeNumber: 6,
      grossScore: 1,
      createdAt: now,
      updatedAt: now,
    });

    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponse;
    const bob = body.players.find((p) => p.playerId === p2Id)!;
    expect(bob.eagles).toBe(1);
    expect(bob.birdies).toBe(0);
  });

  it('computes biggest round win and loss from round_results', async () => {
    const now = Date.now();
    // Create a second round with a different result
    const [round2] = await db
      .insert(rounds)
      .values({
        seasonId,
        type: 'official',
        status: 'finalized',
        scheduledDate: '2026-02-01',
        entryCodeHash: null,
        autoCalculateMoney: 1,
        createdAt: now,
      })
      .returning({ id: rounds.id });

    await db.insert(roundResults).values([
      { roundId, playerId: p1Id, stablefordTotal: 10, moneyTotal: 5, updatedAt: now },
      { roundId: round2!.id, playerId: p1Id, stablefordTotal: 8, moneyTotal: -3, updatedAt: now },
    ]);

    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponse;
    const alice = body.players.find((p) => p.playerId === p1Id)!;
    expect(alice.biggestRoundWin).toBe(5);
    expect(alice.biggestRoundLoss).toBe(-3);

    // Cleanup
    await db.delete(roundResults).where(eq(roundResults.roundId, round2!.id));
    await db.delete(rounds).where(eq(rounds.id, round2!.id));
  });

  it('returns 0 for biggestRoundWin when player never won money', async () => {
    const now = Date.now();
    await db.insert(roundResults).values(
      { roundId, playerId: p1Id, stablefordTotal: 10, moneyTotal: -4, updatedAt: now },
    );

    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponse;
    const alice = body.players.find((p) => p.playerId === p1Id)!;
    expect(alice.biggestRoundWin).toBe(0);
    expect(alice.biggestRoundLoss).toBe(-4);
  });

  it('excludes casual rounds from all stats', async () => {
    const now = Date.now();
    const [casualRound] = await db
      .insert(rounds)
      .values({
        seasonId,
        type: 'casual',
        status: 'finalized',
        scheduledDate: '2026-01-20',
        entryCodeHash: null,
        autoCalculateMoney: 1,
        createdAt: now,
      })
      .returning({ id: rounds.id });

    const [casualGroup] = await db
      .insert(groups)
      .values({ roundId: casualRound!.id, groupNumber: 1, battingOrder: null })
      .returning({ id: groups.id });

    // Casual wolf decision should NOT count
    await db.insert(wolfDecisions).values({
      roundId: casualRound!.id,
      groupId: casualGroup!.id,
      holeNumber: 3,
      wolfPlayerId: p1Id,
      decision: 'alone',
      partnerPlayerId: null,
      bonusesJson: null,
      outcome: 'win',
      createdAt: now,
    });

    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponse;
    const alice = body.players.find((p) => p.playerId === p1Id)!;
    expect(alice.wolfCallsTotal).toBe(0);

    // Cleanup
    await db.delete(wolfDecisions).where(eq(wolfDecisions.roundId, casualRound!.id));
    await db.delete(groups).where(eq(groups.id, casualGroup!.id));
    await db.delete(rounds).where(eq(rounds.id, casualRound!.id));
  });

  it('excludes non-finalized official rounds (active round not counted)', async () => {
    const now = Date.now();
    const [activeRound] = await db
      .insert(rounds)
      .values({
        seasonId,
        type: 'official',
        status: 'active',
        scheduledDate: '2026-01-22',
        entryCodeHash: null,
        autoCalculateMoney: 1,
        createdAt: now,
      })
      .returning({ id: rounds.id });

    const [activeGroup] = await db
      .insert(groups)
      .values({ roundId: activeRound!.id, groupNumber: 1, battingOrder: null })
      .returning({ id: groups.id });

    await db.insert(wolfDecisions).values({
      roundId: activeRound!.id,
      groupId: activeGroup!.id,
      holeNumber: 3,
      wolfPlayerId: p1Id,
      decision: 'alone',
      partnerPlayerId: null,
      bonusesJson: null,
      outcome: 'win',
      createdAt: now,
    });

    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponse;
    const alice = body.players.find((p) => p.playerId === p1Id)!;
    expect(alice.wolfCallsTotal).toBe(0);

    // Cleanup
    await db.delete(wolfDecisions).where(eq(wolfDecisions.roundId, activeRound!.id));
    await db.delete(groups).where(eq(groups.id, activeGroup!.id));
    await db.delete(rounds).where(eq(rounds.id, activeRound!.id));
  });

  it('excludes guest players from results', async () => {
    const now = Date.now();
    const [guestPlayer] = await db
      .insert(players)
      .values({ name: 'Guest', ghinNumber: null, isActive: 1, isGuest: 1, createdAt: now })
      .returning({ id: players.id });

    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponse;
    const guest = body.players.find((p) => p.playerId === guestPlayer!.id);
    expect(guest).toBeUndefined();

    // Cleanup
    await db.delete(players).where(eq(players.id, guestPlayer!.id));
  });

  it('excludes inactive players (is_active=0) from results', async () => {
    const now = Date.now();
    const [inactivePlayer] = await db
      .insert(players)
      .values({ name: 'Inactive', ghinNumber: null, isActive: 0, isGuest: 0, createdAt: now })
      .returning({ id: players.id });

    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponse;
    const inactive = body.players.find((p) => p.playerId === inactivePlayer!.id);
    expect(inactive).toBeUndefined();

    // Cleanup
    await db.delete(players).where(eq(players.id, inactivePlayer!.id));
  });

  it('sorts players by name ascending', async () => {
    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponse;
    const names = body.players.map((p) => p.name);
    expect(names[0]).toBe('Alice');
    expect(names[1]).toBe('Bob');
  });

  it('response contains lastUpdated as ISO string', async () => {
    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponse;
    expect(typeof body.lastUpdated).toBe('string');
    expect(() => new Date(body.lastUpdated)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// GET /stats — Par 3 Champion (season)
// ---------------------------------------------------------------------------

type Par3Entry = { playerId: number; name: string; ctps: number; holes: number[] };
type StatsResponseWithCtp = StatsResponse & { par3Champion: Par3Entry[] };

describe('GET /stats — par3Champion', () => {
  afterEach(async () => {
    await db.delete(sideGameCtpEntries).where(eq(sideGameCtpEntries.roundId, roundId));
  });

  it('returns empty par3Champion array when no CTPs have been recorded', async () => {
    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponseWithCtp;
    expect(body.par3Champion).toEqual([]);
  });

  it('aggregates CTP wins across finalized rounds in the current season', async () => {
    // Alice wins holes 6 + 7 + 15 (3 CTPs), Bob wins hole 12 (1 CTP).
    const now = Date.now();
    await db.insert(sideGameCtpEntries).values([
      { roundId, groupId, holeNumber: 6, winnerPlayerId: p1Id, winnerName: 'Alice', holeCompletedAt: 1000, finalizedAt: now, createdAt: now, updatedAt: now },
      { roundId, groupId, holeNumber: 7, winnerPlayerId: p1Id, winnerName: 'Alice', holeCompletedAt: 2000, finalizedAt: now, createdAt: now, updatedAt: now },
      { roundId, groupId, holeNumber: 12, winnerPlayerId: p2Id, winnerName: 'Bob', holeCompletedAt: 3000, finalizedAt: now, createdAt: now, updatedAt: now },
      { roundId, groupId, holeNumber: 15, winnerPlayerId: p1Id, winnerName: 'Alice', holeCompletedAt: 4000, finalizedAt: now, createdAt: now, updatedAt: now },
    ]);
    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponseWithCtp;
    expect(body.par3Champion).toHaveLength(2);
    const alice = body.par3Champion.find((p) => p.playerId === p1Id)!;
    const bob = body.par3Champion.find((p) => p.playerId === p2Id)!;
    expect(alice.ctps).toBe(3);
    // holes list is built in PAR3_HOLES iteration order (6, 7, 12, 15)
    expect(alice.holes).toEqual([6, 7, 15]);
    expect(bob.ctps).toBe(1);
    expect(bob.holes).toEqual([12]);
    // Sort: highest CTPs first
    expect(body.par3Champion[0]!.playerId).toBe(p1Id);
  });

  it('ignores CTP entries on non-finalized rounds', async () => {
    // Create a second round in the same season, still active, with a CTP entry.
    const [activeRound] = await db
      .insert(rounds)
      .values({
        seasonId,
        type: 'official',
        status: 'active',
        scheduledDate: '2026-02-01',
        entryCodeHash: null,
        autoCalculateMoney: 1,
        createdAt: Date.now(),
      })
      .returning({ id: rounds.id });
    const [activeGroup] = await db
      .insert(groups)
      .values({ roundId: activeRound!.id, groupNumber: 1, battingOrder: null })
      .returning({ id: groups.id });
    const now = Date.now();
    // Active round — should NOT contribute
    await db.insert(sideGameCtpEntries).values({
      roundId: activeRound!.id,
      groupId: activeGroup!.id,
      holeNumber: 6,
      winnerPlayerId: p1Id,
      winnerName: 'Alice',
      holeCompletedAt: 1000,
      finalizedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    // Finalized round — should contribute (1 win to Alice)
    await db.insert(sideGameCtpEntries).values({
      roundId, // the finalized round from beforeAll
      groupId,
      holeNumber: 7,
      winnerPlayerId: p1Id,
      winnerName: 'Alice',
      holeCompletedAt: 2000,
      finalizedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponseWithCtp;
    const alice = body.par3Champion.find((p) => p.playerId === p1Id);
    expect(alice).toBeDefined();
    expect(alice!.ctps).toBe(1); // Only the finalized-round CTP counts

    await db.delete(sideGameCtpEntries).where(eq(sideGameCtpEntries.roundId, activeRound!.id));
    await db.delete(groups).where(eq(groups.id, activeGroup!.id));
    await db.delete(rounds).where(eq(rounds.id, activeRound!.id));
  });

  it('ignores "Nobody" CTP entries (winnerPlayerId null)', async () => {
    const now = Date.now();
    await db.insert(sideGameCtpEntries).values([
      { roundId, groupId, holeNumber: 6, winnerPlayerId: p1Id, winnerName: 'Alice', holeCompletedAt: 1000, finalizedAt: now, createdAt: now, updatedAt: now },
      { roundId, groupId, holeNumber: 7, winnerPlayerId: null, winnerName: null, holeCompletedAt: 2000, finalizedAt: now, createdAt: now, updatedAt: now },
      { roundId, groupId, holeNumber: 12, winnerPlayerId: null, winnerName: null, holeCompletedAt: 3000, finalizedAt: now, createdAt: now, updatedAt: now },
    ]);
    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponseWithCtp;
    expect(body.par3Champion).toHaveLength(1);
    expect(body.par3Champion[0]!.ctps).toBe(1);
  });

  it('scopes to the latest season by year — new season with NO finalized rounds hides a prior-season winner', async () => {
    // The regression this tests: at the start of a new season, a prior
    // season with CTP wins should NOT show up as "current Par 3 Champion".
    // An older implementation keyed on "most-recent finalized round's
    // seasonId" would incorrectly point at the prior season.
    //
    // Scenario:
    //   - NEW season (year 9999) created, has ZERO rounds.
    //   - The existing 3040 season has its beforeAll finalized round, with
    //     CTP wins seeded just for this test.
    // Expected: par3Champion is empty (current season = 9999, which has no
    // rounds, so no CTPs). An older regression would have shown the 3040
    // wins instead.
    const [newSeason] = await db
      .insert(seasons)
      .values({
        name: 'Future Season',
        year: 9999,
        startDate: '9999-04-01',
        endDate: '9999-09-30',
        totalRounds: 15,
        playoffFormat: 'top-8',
        harveyLiveEnabled: 0,
        createdAt: Date.now(),
      })
      .returning({ id: seasons.id });
    // Seed CTP wins in the OLDER (3040) season's finalized round
    const now = Date.now();
    await db.insert(sideGameCtpEntries).values({
      roundId, // 3040 season's finalized round from beforeAll
      groupId,
      holeNumber: 6,
      winnerPlayerId: p1Id,
      winnerName: 'Alice',
      holeCompletedAt: 1000,
      finalizedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponseWithCtp;
    expect(body.par3Champion).toEqual([]);

    // cleanup
    await db.delete(seasons).where(eq(seasons.id, newSeason!.id));
  });

  it('excludes CTP entries on casual rounds (defensive — matches rest of /stats)', async () => {
    const [casualRound] = await db
      .insert(rounds)
      .values({
        seasonId,
        type: 'casual',
        status: 'finalized',
        scheduledDate: '2026-02-15',
        entryCodeHash: null,
        autoCalculateMoney: 1,
        createdAt: Date.now(),
      })
      .returning({ id: rounds.id });
    const [casualGroup] = await db
      .insert(groups)
      .values({ roundId: casualRound!.id, groupNumber: 1, battingOrder: null })
      .returning({ id: groups.id });
    const now = Date.now();
    await db.insert(sideGameCtpEntries).values({
      roundId: casualRound!.id,
      groupId: casualGroup!.id,
      holeNumber: 6,
      winnerPlayerId: p1Id,
      winnerName: 'Alice',
      holeCompletedAt: 1000,
      finalizedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponseWithCtp;
    expect(body.par3Champion).toEqual([]);

    await db.delete(sideGameCtpEntries).where(eq(sideGameCtpEntries.roundId, casualRound!.id));
    await db.delete(groups).where(eq(groups.id, casualGroup!.id));
    await db.delete(rounds).where(eq(rounds.id, casualRound!.id));
  });

  it('upgrades name from stored snapshot to live player name', async () => {
    // Seed an entry with an outdated winner_name snapshot; the LEFT JOIN on
    // players picks up the current name, which we prefer via nameResolution
    // in the helper chain.
    const now = Date.now();
    await db.insert(sideGameCtpEntries).values({
      roundId,
      groupId,
      holeNumber: 6,
      winnerPlayerId: p1Id,
      winnerName: 'Alice (OLD)',
      holeCompletedAt: 1000,
      finalizedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponseWithCtp;
    const alice = body.par3Champion.find((p) => p.playerId === p1Id);
    expect(alice).toBeDefined();
    // Live players.name ("Alice") beats the stored "Alice (OLD)" snapshot.
    expect(alice!.name).toBe('Alice');
  });

  it('tied-at-cutoff rule: when more than 5 players qualify, includes everyone tied with rank 5', async () => {
    // Seed 6 distinct-player entries with 1 CTP each to exercise the tie rule.
    // Insert additional players first.
    const extras = await db
      .insert(players)
      .values([
        { name: 'E1', ghinNumber: null, isActive: 1, createdAt: Date.now() },
        { name: 'E2', ghinNumber: null, isActive: 1, createdAt: Date.now() },
        { name: 'E3', ghinNumber: null, isActive: 1, createdAt: Date.now() },
        { name: 'E4', ghinNumber: null, isActive: 1, createdAt: Date.now() },
      ])
      .returning({ id: players.id });
    const ids = [p1Id, p2Id, ...extras.map((e) => e.id)];

    // Each player wins 1 par 3 in a DIFFERENT round (so per-round resolution
    // doesn't collapse them). Seed 6 rounds, 1 CTP entry each.
    const roundIds: number[] = [];
    for (let i = 0; i < ids.length; i++) {
      const [r] = await db
        .insert(rounds)
        .values({
          seasonId,
          type: 'official',
          status: 'finalized',
          scheduledDate: `2026-03-${String(i + 1).padStart(2, '0')}`,
          entryCodeHash: null,
          autoCalculateMoney: 1,
          createdAt: Date.now(),
        })
        .returning({ id: rounds.id });
      const [g] = await db
        .insert(groups)
        .values({ roundId: r!.id, groupNumber: 1, battingOrder: null })
        .returning({ id: groups.id });
      roundIds.push(r!.id);
      const now = Date.now() + i;
      await db.insert(sideGameCtpEntries).values({
        roundId: r!.id,
        groupId: g!.id,
        holeNumber: 6,
        winnerPlayerId: ids[i]!,
        winnerName: null,
        holeCompletedAt: now,
        finalizedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    const res = await statsApp.request('/stats');
    const body = (await res.json()) as StatsResponseWithCtp;
    // All 6 players tied at 1 CTP → the "top 5 with ties" rule includes all 6.
    expect(body.par3Champion).toHaveLength(6);
    expect(body.par3Champion.every((p) => p.ctps === 1)).toBe(true);

    // Cleanup
    for (const rId of roundIds) {
      await db.delete(sideGameCtpEntries).where(eq(sideGameCtpEntries.roundId, rId));
      await db.delete(groups).where(eq(groups.roundId, rId));
      await db.delete(rounds).where(eq(rounds.id, rId));
    }
    for (const extra of extras) {
      await db.delete(players).where(eq(players.id, extra.id));
    }
  });
});

// ---------------------------------------------------------------------------
// GET /stats/:playerId/detail — chemistry (same-team) reconciliation
// ---------------------------------------------------------------------------
//
// Chemistry counts every wolf hole where two players ended up on the same
// team (2v2 partner pair, both on the 3-side of a 1v3, both non-wolf in a
// blind-wolf). Outcome is recorded from each player's team perspective —
// wolf-side keeps `d.outcome`, non-wolf-side inverts win↔loss.
//
// These tests use a dedicated 4-player round so the input shapes and
// outputs are fully controllable. They assert the rewritten aggregation
// in `apps/api/src/routes/stats.ts` chemistry block reconciles with the
// `getHoleTeamFor` helper across all decision types.

describe('GET /stats/:playerId/detail — chemistry', () => {
  let chemRoundId: number;
  let chemGroupId: number;
  let aId: number;
  let bId: number;
  let cId: number;
  let dId: number;

  type ChemEntry = {
    playerId: number;
    name: string;
    holes: number;
    wins: number;
    losses: number;
    pushes: number;
    winRate: number;
  };

  type DetailResponse = {
    chemistry: ChemEntry[];
  };

  beforeAll(async () => {
    const [round] = await db
      .insert(rounds)
      .values({
        seasonId,
        type: 'official',
        status: 'finalized',
        scheduledDate: '2026-02-15',
        entryCodeHash: null,
        autoCalculateMoney: 1,
        createdAt: Date.now(),
      })
      .returning({ id: rounds.id });
    chemRoundId = round!.id;

    const [group] = await db
      .insert(groups)
      .values({ roundId: chemRoundId, groupNumber: 1, battingOrder: null })
      .returning({ id: groups.id });
    chemGroupId = group!.id;

    const fourPlayers = await db
      .insert(players)
      .values([
        { name: 'ChemA', ghinNumber: null, isActive: 1, isGuest: 0, createdAt: Date.now() },
        { name: 'ChemB', ghinNumber: null, isActive: 1, isGuest: 0, createdAt: Date.now() },
        { name: 'ChemC', ghinNumber: null, isActive: 1, isGuest: 0, createdAt: Date.now() },
        { name: 'ChemD', ghinNumber: null, isActive: 1, isGuest: 0, createdAt: Date.now() },
      ])
      .returning({ id: players.id });
    [aId, bId, cId, dId] = fourPlayers.map((p) => p.id) as [number, number, number, number];

    await db.insert(roundPlayers).values([
      { roundId: chemRoundId, groupId: chemGroupId, playerId: aId, handicapIndex: 10, isSub: 0 },
      { roundId: chemRoundId, groupId: chemGroupId, playerId: bId, handicapIndex: 8, isSub: 0 },
      { roundId: chemRoundId, groupId: chemGroupId, playerId: cId, handicapIndex: 6, isSub: 0 },
      { roundId: chemRoundId, groupId: chemGroupId, playerId: dId, handicapIndex: 4, isSub: 0 },
    ]);
  });

  afterEach(async () => {
    await db.delete(wolfDecisions).where(eq(wolfDecisions.roundId, chemRoundId));
  });

  it('partner hole: wolf+partner counted as teammates with direct outcome; opp pair counted as teammates with inverted outcome', async () => {
    // A is wolf, picks B → A+B vs C+D, A's team wins
    await db.insert(wolfDecisions).values({
      roundId: chemRoundId,
      groupId: chemGroupId,
      holeNumber: 4,
      wolfPlayerId: aId,
      decision: 'partner',
      partnerPlayerId: bId,
      bonusesJson: null,
      outcome: 'win',
      createdAt: Date.now(),
    });

    // From A's drill-down: chemistry shows B as 1-hole, 1-win teammate
    const aRes = await statsApp.request(`/stats/${aId}/detail`);
    expect(aRes.status).toBe(200);
    const aBody = (await aRes.json()) as DetailResponse;
    const aB = aBody.chemistry.find((c) => c.playerId === bId);
    expect(aB).toBeDefined();
    expect(aB!.holes).toBe(1);
    expect(aB!.wins).toBe(1);
    expect(aB!.losses).toBe(0);
    expect(aB!.pushes).toBe(0);
    // A had no other teammates on this hole
    expect(aBody.chemistry.find((c) => c.playerId === cId)).toBeUndefined();
    expect(aBody.chemistry.find((c) => c.playerId === dId)).toBeUndefined();

    // From C's drill-down: chemistry shows D as 1-hole, 1-loss teammate (inverted)
    const cRes = await statsApp.request(`/stats/${cId}/detail`);
    const cBody = (await cRes.json()) as DetailResponse;
    const cD = cBody.chemistry.find((c) => c.playerId === dId);
    expect(cD).toBeDefined();
    expect(cD!.holes).toBe(1);
    expect(cD!.wins).toBe(0);
    expect(cD!.losses).toBe(1);
  });

  it('alone hole: wolf has no teammates; the 3-side counts each other as teammates with inverted outcome', async () => {
    // A goes alone, A wins → B/C/D are on the 3-side, all see A's "win" as their loss
    await db.insert(wolfDecisions).values({
      roundId: chemRoundId,
      groupId: chemGroupId,
      holeNumber: 5,
      wolfPlayerId: aId,
      decision: 'alone',
      partnerPlayerId: null,
      bonusesJson: null,
      outcome: 'win',
      createdAt: Date.now(),
    });

    // A is wolf, no chemistry rows for this hole
    const aRes = await statsApp.request(`/stats/${aId}/detail`);
    const aBody = (await aRes.json()) as DetailResponse;
    expect(aBody.chemistry).toHaveLength(0);

    // B sees C and D as 1-hole, 1-loss teammates
    const bRes = await statsApp.request(`/stats/${bId}/detail`);
    const bBody = (await bRes.json()) as DetailResponse;
    const bC = bBody.chemistry.find((c) => c.playerId === cId);
    const bD = bBody.chemistry.find((c) => c.playerId === dId);
    expect(bC?.holes).toBe(1);
    expect(bC?.losses).toBe(1);
    expect(bC?.wins).toBe(0);
    expect(bD?.holes).toBe(1);
    expect(bD?.losses).toBe(1);
    // B does NOT see A as a teammate (A was wolf)
    expect(bBody.chemistry.find((c) => c.playerId === aId)).toBeUndefined();
  });

  it('blind_wolf hole: same as alone — wolf has no teammates; the 3-side counts each other', async () => {
    // B goes blind_wolf, B loses → A/C/D are on the 3-side, all see B's "loss" as their win
    await db.insert(wolfDecisions).values({
      roundId: chemRoundId,
      groupId: chemGroupId,
      holeNumber: 7,
      wolfPlayerId: bId,
      decision: 'blind_wolf',
      partnerPlayerId: null,
      bonusesJson: null,
      outcome: 'loss',
      createdAt: Date.now(),
    });

    // B is wolf, no chemistry rows
    const bRes = await statsApp.request(`/stats/${bId}/detail`);
    const bBody = (await bRes.json()) as DetailResponse;
    expect(bBody.chemistry).toHaveLength(0);

    // A sees C and D as 1-hole, 1-win teammates (inverted from B's loss)
    const aRes = await statsApp.request(`/stats/${aId}/detail`);
    const aBody = (await aRes.json()) as DetailResponse;
    const aC = aBody.chemistry.find((c) => c.playerId === cId);
    const aD = aBody.chemistry.find((c) => c.playerId === dId);
    expect(aC?.wins).toBe(1);
    expect(aC?.losses).toBe(0);
    expect(aD?.wins).toBe(1);
  });

  it('skins-hole rows (wolfPlayerId null) do not contribute to chemistry', async () => {
    await db.insert(wolfDecisions).values({
      roundId: chemRoundId,
      groupId: chemGroupId,
      holeNumber: 1,
      wolfPlayerId: null,
      decision: null,
      partnerPlayerId: null,
      bonusesJson: null,
      outcome: null,
      createdAt: Date.now(),
    });

    const aRes = await statsApp.request(`/stats/${aId}/detail`);
    const aBody = (await aRes.json()) as DetailResponse;
    expect(aBody.chemistry).toHaveLength(0);
  });

  it('reconciliation across decision types — A perspective sums up correctly across mixed round', async () => {
    const now = Date.now();
    await db.insert(wolfDecisions).values([
      // Hole 4: A wolf, picks B → A+B teammates, win
      { roundId: chemRoundId, groupId: chemGroupId, holeNumber: 4, wolfPlayerId: aId, decision: 'partner', partnerPlayerId: bId, bonusesJson: null, outcome: 'win', createdAt: now },
      // Hole 5: A alone (1v3) → A has no teammates this hole
      { roundId: chemRoundId, groupId: chemGroupId, holeNumber: 5, wolfPlayerId: aId, decision: 'alone', partnerPlayerId: null, bonusesJson: null, outcome: 'loss', createdAt: now },
      // Hole 6: B blind_wolf (1v3) → A on 3-side with C, D, push
      { roundId: chemRoundId, groupId: chemGroupId, holeNumber: 6, wolfPlayerId: bId, decision: 'blind_wolf', partnerPlayerId: null, bonusesJson: null, outcome: 'push', createdAt: now },
      // Hole 8: C wolf, picks D → A+B teammates (the leftover non-wolf pair), loss for A's side
      { roundId: chemRoundId, groupId: chemGroupId, holeNumber: 8, wolfPlayerId: cId, decision: 'partner', partnerPlayerId: dId, bonusesJson: null, outcome: 'win', createdAt: now },
    ]);

    const aRes = await statsApp.request(`/stats/${aId}/detail`);
    const aBody = (await aRes.json()) as DetailResponse;

    const aB = aBody.chemistry.find((c) => c.playerId === bId);
    const aC = aBody.chemistry.find((c) => c.playerId === cId);
    const aD = aBody.chemistry.find((c) => c.playerId === dId);

    // A+B teammates on hole 4 (win, direct) and hole 8 (C/D won → A/B lost, inverted)
    expect(aB?.holes).toBe(2);
    expect(aB?.wins).toBe(1);
    expect(aB?.losses).toBe(1);
    expect(aB?.pushes).toBe(0);

    // A+C teammates on hole 6 (push) — and that's it
    expect(aC?.holes).toBe(1);
    expect(aC?.pushes).toBe(1);
    expect(aC?.wins).toBe(0);
    expect(aC?.losses).toBe(0);

    // A+D teammates on hole 6 (push) — same shape
    expect(aD?.holes).toBe(1);
    expect(aD?.pushes).toBe(1);
  });
});
