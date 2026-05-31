// ---------------------------------------------------------------------------
// Scouting report (/scouting/:roundId) — integration test.
// Seeds a mini 2026 season with finalized rounds BEFORE and AFTER the target
// round, to verify: frozen pre-round scoping (later rounds excluded), per-player
// stats + inline hole-by-hole, and the rivalry / lucky-charm callouts.
// ---------------------------------------------------------------------------

import { vi, describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { Hono } from 'hono';
import { migrate } from 'drizzle-orm/libsql/migrator';

vi.mock('../db/index.js', async () => {
  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../db/schema.js');
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client, { schema });
  return { db };
});

import scoutingRouter from './scouting.js';
import { db } from '../db/index.js';
import { seasons, players, rounds, groups, roundPlayers, roundResults, holeScores, wolfDecisions } from '../db/schema.js';

const app = new Hono();
app.route('/api', scoutingRouter);

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, '../db/migrations');

const now = 1_700_000_000_000;
const A = 9001, B = 9002; // Alice, Bob — high ids to avoid the 17 migration-seeded players

beforeAll(async () => {
  await migrate(db, { migrationsFolder });

  await db.insert(seasons).values({ id: 1, name: '2026', year: 2026, startDate: '2026-04-01', endDate: '2026-09-30', totalRounds: 20, playoffFormat: 'x', harveyLiveEnabled: 1, createdAt: now });
  await db.insert(players).values([
    { id: A, name: 'Alice', createdAt: now },
    { id: B, name: 'Bob', createdAt: now },
  ]);

  // R1/R2 = finalized BEFORE the target; R3 = target (05-01); R4 = finalized AFTER (must be excluded).
  await db.insert(rounds).values([
    { id: 1, seasonId: 1, type: 'official', status: 'finalized', scheduledDate: '2026-04-17', tee: 'blue', createdAt: now },
    { id: 2, seasonId: 1, type: 'official', status: 'finalized', scheduledDate: '2026-04-24', tee: 'black', createdAt: now },
    { id: 3, seasonId: 1, type: 'official', status: 'finalized', scheduledDate: '2026-05-01', tee: 'white', createdAt: now },
    { id: 4, seasonId: 1, type: 'official', status: 'finalized', scheduledDate: '2026-05-08', tee: 'blue', createdAt: now },
  ]);
  await db.insert(groups).values([
    { id: 1, roundId: 1, groupNumber: 1 }, { id: 2, roundId: 2, groupNumber: 1 },
    { id: 3, roundId: 3, groupNumber: 1 }, { id: 4, roundId: 4, groupNumber: 1 },
  ]);
  // HI rises 10 → 11 across the two prior rounds (trend up 1.0). Target/later rounds
  // have HI too but must NOT affect the report.
  await db.insert(roundPlayers).values([
    { roundId: 1, groupId: 1, playerId: A, handicapIndex: 10 }, { roundId: 1, groupId: 1, playerId: B, handicapIndex: 15 },
    { roundId: 2, groupId: 2, playerId: A, handicapIndex: 11 }, { roundId: 2, groupId: 2, playerId: B, handicapIndex: 15 },
    { roundId: 3, groupId: 3, playerId: A, handicapIndex: 12 }, { roundId: 3, groupId: 3, playerId: B, handicapIndex: 15 }, // target roster
    { roundId: 4, groupId: 4, playerId: A, handicapIndex: 99 }, { roundId: 4, groupId: 4, playerId: B, handicapIndex: 15 }, // later — excluded
  ]);
  // Alice beats Bob in money both prior rounds (+10, +8). The LATER round gives Alice +50 —
  // if frozen scoping leaks, her biggestWin would be 50 instead of 10.
  await db.insert(roundResults).values([
    { roundId: 1, playerId: A, stablefordTotal: 30, moneyTotal: 10, updatedAt: now }, { roundId: 1, playerId: B, stablefordTotal: 25, moneyTotal: -10, updatedAt: now },
    { roundId: 2, playerId: A, stablefordTotal: 28, moneyTotal: 8, updatedAt: now }, { roundId: 2, playerId: B, stablefordTotal: 27, moneyTotal: -8, updatedAt: now },
    { roundId: 4, playerId: A, stablefordTotal: 40, moneyTotal: 50, updatedAt: now }, { roundId: 4, playerId: B, stablefordTotal: 20, moneyTotal: -50, updatedAt: now },
  ]);
  // Holes 1 (par 5), 2 (par 4), 3 (par 4) for both prior rounds. Alice: hole 1 = 4 (birdie, best),
  // hole 3 = 6 (worst). Hole scores in the LATER round would skew averages if leaked.
  const hs = (roundId: number, groupId: number, playerId: number, hole: number, gross: number) =>
    ({ roundId, groupId, playerId, holeNumber: hole, grossScore: gross, createdAt: now, updatedAt: now });
  await db.insert(holeScores).values([
    hs(1, 1, A, 1, 4), hs(1, 1, A, 2, 4), hs(1, 1, A, 3, 6), hs(1, 1, B, 1, 6), hs(1, 1, B, 2, 5), hs(1, 1, B, 3, 5),
    hs(2, 2, A, 1, 4), hs(2, 2, A, 2, 5), hs(2, 2, A, 3, 6), hs(2, 2, B, 1, 6), hs(2, 2, B, 2, 5), hs(2, 2, B, 3, 5),
    hs(4, 4, A, 1, 9), hs(4, 4, A, 2, 9), hs(4, 4, A, 3, 9), // later round — must be excluded
  ]);
  // Alice+Bob partnered 3 holes in R1, all wins → lucky charm 3-0.
  await db.insert(wolfDecisions).values([
    { roundId: 1, groupId: 1, holeNumber: 2, wolfPlayerId: A, decision: 'partner', partnerPlayerId: B, outcome: 'win', createdAt: now },
    { roundId: 1, groupId: 1, holeNumber: 4, wolfPlayerId: A, decision: 'partner', partnerPlayerId: B, outcome: 'win', createdAt: now },
    { roundId: 1, groupId: 1, holeNumber: 5, wolfPlayerId: A, decision: 'partner', partnerPlayerId: B, outcome: 'win', createdAt: now },
  ]);
});

describe('GET /scouting/:roundId', () => {
  it('frozen scoping: only counts rounds BEFORE the target round date', async () => {
    const res = await app.request('/api/scouting/3');
    expect(res.status).toBe(200);
    const data = (await res.json()) as { seasonRounds: number; groups: Array<{ players: Array<{ name: string; biggestWin: number; handicapTrend: { direction: string; delta: number } | null }> }> };
    expect(data.seasonRounds).toBe(2); // R1 + R2; the 05-08 round is excluded
    const alice = data.groups[0]!.players.find((p) => p.name === 'Alice')!;
    expect(alice.biggestWin).toBe(10); // +10 from R1, NOT +50 from the later round
    expect(alice.handicapTrend).toEqual({ direction: 'up', delta: 1, sample: 2 }); // 10 → 11, not 99
  });

  it('per-player stats + inline hole-by-hole', async () => {
    const res = await app.request('/api/scouting/3');
    const data = (await res.json()) as { groups: Array<{ players: Array<{ name: string; bestHoles: number[]; worstHoles: number[]; topBirdieHole: { hole: number } | null; holes: Array<{ hole: number; par: number; avg: number }> }> }> };
    const alice = data.groups[0]!.players.find((p) => p.name === 'Alice')!;
    expect(alice.bestHoles).toEqual([1]);   // par-5 hole 1, avg 4 (−1)
    expect(alice.worstHoles).toEqual([3]);  // par-4 hole 3, avg 6 (+2)
    expect(alice.topBirdieHole?.hole).toBe(1);
    // inline holes shipped with the card (no separate fetch)
    expect(alice.holes.length).toBe(3);
    expect(alice.holes.find((h) => h.hole === 1)).toEqual({ hole: 1, par: 5, avg: 4 });
  });

  it('rivalry reads from the leader perspective; lucky charm from partnerships', async () => {
    const res = await app.request('/api/scouting/3');
    const data = (await res.json()) as { groups: Array<{ rivalry: { leaderName: string; trailerName: string; leaderWins: number; trailerWins: number; moneyDiff: number } | null; luckyCharm: { wins: number; losses: number; winRate: number } | null }> };
    const g = data.groups[0]!;
    // moneyDiff is the per-round head-to-head differential: (10−(−10)) + (8−(−8)) = 36.
    expect(g.rivalry).toMatchObject({ leaderName: 'Alice', trailerName: 'Bob', leaderWins: 2, trailerWins: 0, moneyDiff: 36 });
    expect(g.luckyCharm).toMatchObject({ wins: 3, losses: 0, winRate: 1 });
  });

  it('404 for an unknown round', async () => {
    const res = await app.request('/api/scouting/999');
    expect(res.status).toBe(404);
  });
});
