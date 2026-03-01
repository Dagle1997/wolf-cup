import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
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

import standingsApp from './standings.js';
import { db } from '../db/index.js';
import {
  seasons,
  rounds,
  groups,
  roundPlayers,
  players,
  harveyResults,
} from '../db/schema.js';
import { migrate } from 'drizzle-orm/libsql/migrator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

// Fixed season/round IDs shared across tests
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
      { name: 'Alice', ghinNumber: null, isActive: 1, createdAt: Date.now() },
      { name: 'Bob', ghinNumber: null, isActive: 1, createdAt: Date.now() },
      { name: 'Carol', ghinNumber: null, isActive: 1, createdAt: Date.now() },
      { name: 'Dan', ghinNumber: null, isActive: 1, createdAt: Date.now() },
    ])
    .returning({ id: players.id });
  [p1Id, p2Id, p3Id, p4Id] = playerInserts.map((p) => p.id) as [number, number, number, number];

  // Seed round_players — all full members by default
  await db.insert(roundPlayers).values([
    { roundId, groupId, playerId: p1Id, handicapIndex: 10, isSub: 0 },
    { roundId, groupId, playerId: p2Id, handicapIndex: 12, isSub: 0 },
    { roundId, groupId, playerId: p3Id, handicapIndex: 8, isSub: 0 },
    { roundId, groupId, playerId: p4Id, handicapIndex: 15, isSub: 0 },
  ]);
});

afterEach(async () => {
  // Clean per-test harvey_results; keep season/rounds/groups/players/round_players
  await db.delete(harveyResults).where(eq(harveyResults.roundId, roundId));
});

// ---------------------------------------------------------------------------
// GET /standings
// ---------------------------------------------------------------------------

describe('GET /standings', () => {
  it('returns 200 with correct shape when season exists but no rounds have harvey_results', async () => {
    // AC#2 code path (season: null) exists in standings.ts:53-55 but can't be triggered here
    // because beforeAll seeds a season. This test verifies the next early-exit path: season
    // present, official round present, but no harvey_results → empty fullMembers/subs.
    const res = await standingsApp.request('/standings');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      season: { id: number; name: string; totalRounds: number; roundsCompleted: number } | null;
      fullMembers: unknown[];
      subs: unknown[];
      lastUpdated: string;
    };
    // Season IS present (seeded in beforeAll)
    expect(body.season).not.toBeNull();
    expect(body.season?.name).toBe('2026');
    expect(body.season?.totalRounds).toBe(15);
    // No harvey_results yet → empty standings
    expect(body.fullMembers).toHaveLength(0);
    expect(body.subs).toHaveLength(0);
    expect(typeof body.lastUpdated).toBe('string');
  });

  it('returns season info with roundsCompleted count of finalized official rounds', async () => {
    const res = await standingsApp.request('/standings');
    expect(res.status).toBe(200);
    const body = await res.json() as { season: { id: number; name: string; totalRounds: number; roundsCompleted: number } };
    expect(body.season?.id).toBe(seasonId);
    expect(body.season?.name).toBe('2026');
    expect(body.season?.totalRounds).toBe(15);
    expect(body.season?.roundsCompleted).toBe(1); // 1 finalized round
  });

  it('returns empty fullMembers and subs when no harvey_results exist', async () => {
    const res = await standingsApp.request('/standings');
    const body = await res.json() as { fullMembers: unknown[]; subs: unknown[] };
    expect(body.fullMembers).toHaveLength(0);
    expect(body.subs).toHaveLength(0);
  });

  it('returns correct aggregated totals via calculateSeasonTotal', async () => {
    const now = Date.now();
    await db.insert(harveyResults).values([
      { roundId, playerId: p1Id, stablefordRank: 1, moneyRank: 1, stablefordPoints: 4, moneyPoints: 4, updatedAt: now },
      { roundId, playerId: p2Id, stablefordRank: 2, moneyRank: 2, stablefordPoints: 3, moneyPoints: 3, updatedAt: now },
    ]);

    const res = await standingsApp.request('/standings');
    const body = await res.json() as { fullMembers: Array<{ playerId: number; stablefordTotal: number; moneyTotal: number; combinedTotal: number; roundsPlayed: number; roundsDropped: number }> };

    const alice = body.fullMembers.find((r) => r.playerId === p1Id)!;
    expect(alice.stablefordTotal).toBe(4);
    expect(alice.moneyTotal).toBe(4);
    expect(alice.combinedTotal).toBe(8);
    expect(alice.roundsPlayed).toBe(1);
    expect(alice.roundsDropped).toBe(0);
  });

  it('applies best-10 drop when player has >10 rounds', async () => {
    // Create 10 extra rounds with harvey_results for p1Id
    const extraRoundIds: number[] = [];
    for (let i = 0; i < 10; i++) {
      const [r] = await db
        .insert(rounds)
        .values({
          seasonId,
          type: 'official',
          status: 'finalized',
          scheduledDate: `2026-02-${String(i + 1).padStart(2, '0')}`,
          entryCodeHash: null,
          autoCalculateMoney: 1,
          createdAt: Date.now(),
        })
        .returning({ id: rounds.id });
      extraRoundIds.push(r!.id);
    }

    const now = Date.now();
    // Base round: 5+5=10
    await db.insert(harveyResults).values(
      { roundId, playerId: p1Id, stablefordRank: 1, moneyRank: 1, stablefordPoints: 5, moneyPoints: 5, updatedAt: now }
    );
    // 10 extra rounds: scores from 2+2=4 to 11+11=22
    for (let i = 0; i < 10; i++) {
      const pts = i + 2;
      await db.insert(harveyResults).values({
        roundId: extraRoundIds[i]!,
        playerId: p1Id,
        stablefordRank: 1,
        moneyRank: 1,
        stablefordPoints: pts,
        moneyPoints: pts,
        updatedAt: now,
      });
    }

    const res = await standingsApp.request('/standings');
    const body = await res.json() as {
      fullMembers: Array<{ playerId: number; roundsPlayed: number; roundsDropped: number; stablefordTotal: number; moneyTotal: number }>;
    };
    const alice = body.fullMembers.find((r) => r.playerId === p1Id)!;
    expect(alice.roundsPlayed).toBe(11);
    expect(alice.roundsDropped).toBe(1);
    // Lowest combined round is i=0 (stab=2, money=2, combined=4) — dropped.
    // Top-10 combined sums: 22+20+18+16+14+12+10+10+8+6 = 136 → stab = money = 136/2 = 68
    expect(alice.stablefordTotal).toBe(68);
    expect(alice.moneyTotal).toBe(68);

    // Cleanup extra rounds + harvey_results
    await db.delete(harveyResults).where(inArray(harveyResults.roundId, extraRoundIds));
    await db.delete(rounds).where(inArray(rounds.id, extraRoundIds));
  });

  it('classifies player as full member if they have any is_sub=0 round_players entry', async () => {
    const now = Date.now();
    await db.insert(harveyResults).values(
      { roundId, playerId: p1Id, stablefordRank: 1, moneyRank: 1, stablefordPoints: 4, moneyPoints: 3, updatedAt: now }
    );

    const res = await standingsApp.request('/standings');
    const body = await res.json() as { fullMembers: Array<{ playerId: number }>; subs: Array<{ playerId: number }> };
    expect(body.fullMembers.some((r) => r.playerId === p1Id)).toBe(true);
    expect(body.subs.some((r) => r.playerId === p1Id)).toBe(false);
  });

  it('classifies player as sub when all round_players entries have is_sub=1', async () => {
    // Add a 5th player as a sub
    const [subPlayer] = await db
      .insert(players)
      .values({ name: 'SubPlayer', ghinNumber: null, isActive: 1, createdAt: Date.now() })
      .returning({ id: players.id });
    const subPlayerId = subPlayer!.id;

    // Need a new group to avoid unique constraint with existing round_players
    const [subGroup] = await db
      .insert(groups)
      .values({ roundId, groupNumber: 2, battingOrder: null })
      .returning({ id: groups.id });

    await db.insert(roundPlayers).values({
      roundId, groupId: subGroup!.id, playerId: subPlayerId, handicapIndex: 10, isSub: 1,
    });

    const now = Date.now();
    await db.insert(harveyResults).values({
      roundId, playerId: subPlayerId, stablefordRank: 5, moneyRank: 5, stablefordPoints: 2, moneyPoints: 2, updatedAt: now,
    });

    const res = await standingsApp.request('/standings');
    const body = await res.json() as { fullMembers: Array<{ playerId: number }>; subs: Array<{ playerId: number }> };
    expect(body.subs.some((r) => r.playerId === subPlayerId)).toBe(true);
    expect(body.fullMembers.some((r) => r.playerId === subPlayerId)).toBe(false);

    // Cleanup
    await db.delete(harveyResults).where(eq(harveyResults.playerId, subPlayerId));
    await db.delete(roundPlayers).where(eq(roundPlayers.playerId, subPlayerId));
    await db.delete(groups).where(eq(groups.id, subGroup!.id));
    await db.delete(players).where(eq(players.id, subPlayerId));
  });

  it('marks top-8 full members as isPlayoffEligible, rank 9+ not eligible', async () => {
    // Seed 10 players: p1..p4 already exist; add 6 more
    const extra: number[] = [];
    for (let i = 5; i <= 10; i++) {
      const [p] = await db
        .insert(players)
        .values({ name: `Player${i}`, ghinNumber: null, isActive: 1, createdAt: Date.now() })
        .returning({ id: players.id });
      extra.push(p!.id);
    }

    // Seed 10 extra rounds for these players (need round_players entries + harvey_results)
    const extraRoundIds: number[] = [];
    const allPlayerIds = [p1Id, p2Id, p3Id, p4Id, ...extra];
    for (let i = 0; i < 10; i++) {
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
      extraRoundIds.push(r!.id);

      const [g] = await db
        .insert(groups)
        .values({ roundId: r!.id, groupNumber: 1, battingOrder: null })
        .returning({ id: groups.id });

      await db.insert(roundPlayers).values(
        allPlayerIds.map((pid) => ({ roundId: r!.id, groupId: g!.id, playerId: pid, handicapIndex: 10, isSub: 0 }))
      );
    }

    // Also need round_players for extra players in the base round
    for (const pid of extra) {
      const [g2] = await db
        .insert(groups)
        .values({ roundId, groupNumber: extra.indexOf(pid) + 3, battingOrder: null })
        .returning({ id: groups.id });
      await db.insert(roundPlayers).values({ roundId, groupId: g2!.id, playerId: pid, handicapIndex: 10, isSub: 0 });
    }

    const now = Date.now();
    // Give each player distinct scores so ranks 1–10 are clear
    // p1=10th (worst), p2=9th (still not eligible), p3–p4 + extra 1–6 = ranks 1–8
    const scores = [
      { pid: p1Id, pts: 1 },   // rank 10
      { pid: p2Id, pts: 2 },   // rank 9
      { pid: p3Id, pts: 3 },   // rank 8 — eligible
      { pid: p4Id, pts: 4 },   // rank 7
      { pid: extra[0]!, pts: 5 },  // rank 6
      { pid: extra[1]!, pts: 6 },  // rank 5
      { pid: extra[2]!, pts: 7 },  // rank 4
      { pid: extra[3]!, pts: 8 },  // rank 3
      { pid: extra[4]!, pts: 9 },  // rank 2
      { pid: extra[5]!, pts: 10 }, // rank 1
    ];

    // Insert harvey results for ALL 10 players across ALL rounds (base + extra)
    const allRoundIds = [roundId, ...extraRoundIds];
    for (const rId of allRoundIds) {
      for (const { pid, pts } of scores) {
        await db.insert(harveyResults).values({
          roundId: rId,
          playerId: pid,
          stablefordRank: 1,
          moneyRank: 1,
          stablefordPoints: pts,
          moneyPoints: pts,
          updatedAt: now,
        }).onConflictDoNothing();
      }
    }

    const res = await standingsApp.request('/standings');
    const body = await res.json() as { fullMembers: Array<{ playerId: number; rank: number; isPlayoffEligible: boolean }> };

    // p3Id should be rank 8 and eligible
    const p3 = body.fullMembers.find((r) => r.playerId === p3Id)!;
    expect(p3.rank).toBe(8);
    expect(p3.isPlayoffEligible).toBe(true);

    // p2Id should be rank 9 and NOT eligible
    const p2 = body.fullMembers.find((r) => r.playerId === p2Id)!;
    expect(p2.rank).toBe(9);
    expect(p2.isPlayoffEligible).toBe(false);

    // p1Id should be rank 10 and NOT eligible
    const p1 = body.fullMembers.find((r) => r.playerId === p1Id)!;
    expect(p1.rank).toBe(10);
    expect(p1.isPlayoffEligible).toBe(false);

    // Cleanup
    await db.delete(harveyResults).where(inArray(harveyResults.roundId, allRoundIds));
    await db.delete(roundPlayers).where(inArray(roundPlayers.roundId, extraRoundIds));
    for (const pid of extra) {
      await db.delete(roundPlayers).where(eq(roundPlayers.playerId, pid));
    }
    for (const rId of extraRoundIds) {
      await db.delete(groups).where(eq(groups.roundId, rId));
    }
    await db.delete(rounds).where(inArray(rounds.id, extraRoundIds));
    await db.delete(players).where(inArray(players.id, extra));
  });

  it('assigns dense ranks: ties get same rank, gap skips (1, 1, 3)', async () => {
    const now = Date.now();
    // p1=8+8=16, p2=4+4=8, p3=4+4=8, p4=2+2=4
    await db.insert(harveyResults).values([
      { roundId, playerId: p1Id, stablefordRank: 1, moneyRank: 1, stablefordPoints: 8, moneyPoints: 8, updatedAt: now },
      { roundId, playerId: p2Id, stablefordRank: 2, moneyRank: 2, stablefordPoints: 4, moneyPoints: 4, updatedAt: now },
      { roundId, playerId: p3Id, stablefordRank: 2, moneyRank: 2, stablefordPoints: 4, moneyPoints: 4, updatedAt: now },
      { roundId, playerId: p4Id, stablefordRank: 4, moneyRank: 4, stablefordPoints: 2, moneyPoints: 2, updatedAt: now },
    ]);

    const res = await standingsApp.request('/standings');
    const body = await res.json() as { fullMembers: Array<{ playerId: number; rank: number }> };

    const alice = body.fullMembers.find((r) => r.playerId === p1Id)!;
    const bob = body.fullMembers.find((r) => r.playerId === p2Id)!;
    const carol = body.fullMembers.find((r) => r.playerId === p3Id)!;
    const dan = body.fullMembers.find((r) => r.playerId === p4Id)!;

    expect(alice.rank).toBe(1);
    expect(bob.rank).toBe(2);
    expect(carol.rank).toBe(2);
    expect(dan.rank).toBe(4); // gap skip
  });

  it('sorts fullMembers by rank then name ascending', async () => {
    const now = Date.now();
    // p2=18 (rank 1), p1=p3=10 (rank 2, alphabetical Alice < Carol), p4=4 (rank 4)
    await db.insert(harveyResults).values([
      { roundId, playerId: p1Id, stablefordRank: 2, moneyRank: 2, stablefordPoints: 5, moneyPoints: 5, updatedAt: now },
      { roundId, playerId: p2Id, stablefordRank: 1, moneyRank: 1, stablefordPoints: 9, moneyPoints: 9, updatedAt: now },
      { roundId, playerId: p3Id, stablefordRank: 2, moneyRank: 2, stablefordPoints: 5, moneyPoints: 5, updatedAt: now },
      { roundId, playerId: p4Id, stablefordRank: 4, moneyRank: 4, stablefordPoints: 2, moneyPoints: 2, updatedAt: now },
    ]);

    const res = await standingsApp.request('/standings');
    const body = await res.json() as { fullMembers: Array<{ playerId: number; name: string }> };
    expect(body.fullMembers[0]!.playerId).toBe(p2Id); // Bob=rank 1
    expect(body.fullMembers[1]!.name).toBe('Alice');  // rank 2, A < C
    expect(body.fullMembers[2]!.name).toBe('Carol');  // rank 2
    expect(body.fullMembers[3]!.playerId).toBe(p4Id); // Dan=rank 4
  });

  it('excludes casual rounds from standings', async () => {
    // Create a casual round and insert harvey_results for it
    const [casualRound] = await db
      .insert(rounds)
      .values({
        seasonId,
        type: 'casual',
        status: 'finalized',
        scheduledDate: '2026-01-20',
        entryCodeHash: null,
        autoCalculateMoney: 1,
        createdAt: Date.now(),
      })
      .returning({ id: rounds.id });

    const now = Date.now();
    await db.insert(harveyResults).values({
      roundId: casualRound!.id,
      playerId: p1Id,
      stablefordRank: 1,
      moneyRank: 1,
      stablefordPoints: 100,
      moneyPoints: 100,
      updatedAt: now,
    });

    const res = await standingsApp.request('/standings');
    const body = await res.json() as { fullMembers: Array<{ playerId: number; roundsPlayed: number; stablefordTotal: number }> };
    // Alice should not appear (no official harvey results), or if she does, totals should not include casual round
    const alice = body.fullMembers.find((r) => r.playerId === p1Id);
    // Since no official harvey results for p1Id, she should not appear
    expect(alice).toBeUndefined();

    // Cleanup
    await db.delete(harveyResults).where(eq(harveyResults.roundId, casualRound!.id));
    await db.delete(rounds).where(eq(rounds.id, casualRound!.id));
  });

  it('excludes cancelled official rounds from roundsCompleted', async () => {
    // Add a cancelled official round
    const [cancelledRound] = await db
      .insert(rounds)
      .values({
        seasonId,
        type: 'official',
        status: 'cancelled',
        scheduledDate: '2026-01-22',
        entryCodeHash: null,
        autoCalculateMoney: 1,
        createdAt: Date.now(),
      })
      .returning({ id: rounds.id });

    const res = await standingsApp.request('/standings');
    const body = await res.json() as { season: { roundsCompleted: number } };
    // Still only 1 finalized round (the base), cancelled round does not count
    expect(body.season?.roundsCompleted).toBe(1);

    // Cleanup
    await db.delete(rounds).where(eq(rounds.id, cancelledRound!.id));
  });

  it('response contains lastUpdated ISO string', async () => {
    const res = await standingsApp.request('/standings');
    const body = await res.json() as { lastUpdated: string };
    expect(typeof body.lastUpdated).toBe('string');
    expect(() => new Date(body.lastUpdated)).not.toThrow();
  });
});
