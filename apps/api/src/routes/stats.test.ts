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
  wolfCallsAlone: number;
  wolfCallsPartner: number;
  wolfWins: number;
  wolfLosses: number;
  wolfPushes: number;
  netBirdies: number;
  netEagles: number;
  greenies: number;
  polies: number;
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
    expect(alice.wolfCallsAlone).toBe(0);
    expect(alice.wolfCallsPartner).toBe(0);
    expect(alice.wolfWins).toBe(0);
    expect(alice.wolfLosses).toBe(0);
    expect(alice.wolfPushes).toBe(0);
    expect(alice.netBirdies).toBe(0);
    expect(alice.netEagles).toBe(0);
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
    expect(alice.wolfCallsAlone).toBe(2);
    expect(alice.wolfCallsPartner).toBe(1);
    expect(alice.wolfWins).toBe(1);
    expect(alice.wolfLosses).toBe(1);
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
    expect(alice.wolfCallsAlone).toBe(1);
    expect(alice.wolfCallsPartner).toBe(0);
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
      bonusesJson: JSON.stringify({ greenies: [p1Id], polies: [p1Id, p2Id] }),
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
      bonusesJson: JSON.stringify({ greenies: [p1Id], polies: [p1Id] }),
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

  it('computes net birdies correctly (gross - handicap strokes === par - 1)', async () => {
    const now = Date.now();
    // Bob has handicapIndex=0 (set in beforeAll round_players)
    // Hole 6: par 3, strokeIndex 17 → getHandicapStrokes(0, 17)=0 strokes
    // gross=2, net=2, par-1=2 → birdie
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
    expect(bob.netBirdies).toBe(1);
    expect(bob.netEagles).toBe(0);
  });

  it('computes net eagles correctly (net score <= par - 2)', async () => {
    const now = Date.now();
    // Bob has handicapIndex=0
    // Hole 6: par 3, strokeIndex 17 → 0 strokes
    // gross=1, net=1, par-2=1 → eagle
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
    expect(bob.netEagles).toBe(1);
    expect(bob.netBirdies).toBe(0);
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
