// ---------------------------------------------------------------------------
// Scouting "The Line" (odds / retrospective / house ledger) — integration test.
// Seeds a 6-round finalized 2026 season + one upcoming target round, with one
// sub present every week, and verifies the additive blocks added to
// /scouting/:roundId. harvey_results are computed via the engine (mirrors the
// production computeAndStoreHarvey ranking) so the actual winners are real.
// ---------------------------------------------------------------------------

import { vi, describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { Hono } from 'hono';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { calculateHarveyPoints } from '@wolf-cup/engine';

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
import { seasons, players, rounds, groups, roundPlayers, roundResults, harveyResults } from '../db/schema.js';

const app = new Hono();
app.route('/api', scoutingRouter);

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, '../db/migrations');
const now = 1_700_000_000_000;

// Members M1..M4, sub S1 (high ids dodge the 17 migration-seeded players).
const M1 = 9001, M2 = 9002, M3 = 9003, M4 = 9004, S1 = 9005;

type Line = { playerId: number; isSub: boolean; stableford: number; money: number };

// Per-round lineups. M4 sits out R1/R2 (so at R4 it has <2 prior rounds → unpriced).
const SCHEDULE: Array<{ id: number; date: string; status: 'finalized' | 'scheduled'; lines: Line[] }> = [
  { id: 1, date: '2026-04-03', status: 'finalized', lines: [
    { playerId: M1, isSub: false, stableford: 40, money: 30 },
    { playerId: M2, isSub: false, stableford: 30, money: 10 },
    { playerId: M3, isSub: false, stableford: 25, money: -20 },
    { playerId: S1, isSub: true, stableford: 28, money: -20 },
  ] },
  { id: 2, date: '2026-04-10', status: 'finalized', lines: [
    { playerId: M1, isSub: false, stableford: 38, money: 25 },
    { playerId: M2, isSub: false, stableford: 32, money: 12 },
    { playerId: M3, isSub: false, stableford: 26, money: -15 },
    { playerId: S1, isSub: true, stableford: 27, money: -22 },
  ] },
  { id: 3, date: '2026-04-17', status: 'finalized', lines: [
    { playerId: M1, isSub: false, stableford: 41, money: 28 },
    { playerId: M2, isSub: false, stableford: 33, money: 15 },
    { playerId: M3, isSub: false, stableford: 24, money: -10 },
    { playerId: M4, isSub: false, stableford: 20, money: -18 },
    { playerId: S1, isSub: true, stableford: 29, money: -15 },
  ] },
  // R4 (idx 3) — M4 (only 1 prior round) wins → BUSTED (off the board).
  { id: 4, date: '2026-04-24', status: 'finalized', lines: [
    { playerId: M1, isSub: false, stableford: 35, money: 18 },
    { playerId: M2, isSub: false, stableford: 28, money: 0 },
    { playerId: M3, isSub: false, stableford: 22, money: -20 },
    { playerId: M4, isSub: false, stableford: 46, money: 45 },
    { playerId: S1, isSub: true, stableford: 26, money: -25 },
  ] },
  // R5 (idx 4) — M1 (the favorite) wins → CHALK.
  { id: 5, date: '2026-05-01', status: 'finalized', lines: [
    { playerId: M1, isSub: false, stableford: 42, money: 30 },
    { playerId: M2, isSub: false, stableford: 30, money: 10 },
    { playerId: M3, isSub: false, stableford: 25, money: -12 },
    { playerId: M4, isSub: false, stableford: 24, money: -15 },
    { playerId: S1, isSub: true, stableford: 28, money: -13 },
  ] },
  // R6 (idx 5) — M2 is top MEMBER, S1 posts the overall high → UPSET + subSpoiled.
  { id: 6, date: '2026-05-08', status: 'finalized', lines: [
    { playerId: M1, isSub: false, stableford: 30, money: 10 },
    { playerId: M2, isSub: false, stableford: 38, money: 22 },
    { playerId: M3, isSub: false, stableford: 25, money: -10 },
    { playerId: M4, isSub: false, stableford: 22, money: -15 },
    { playerId: S1, isSub: true, stableford: 44, money: 40 },
  ] },
  // R7 — upcoming target (scheduled). Odds computed from R1..R6.
  { id: 7, date: '2026-05-15', status: 'scheduled', lines: [
    { playerId: M1, isSub: false, stableford: 0, money: 0 },
    { playerId: M2, isSub: false, stableford: 0, money: 0 },
    { playerId: M3, isSub: false, stableford: 0, money: 0 },
    { playerId: M4, isSub: false, stableford: 0, money: 0 },
    { playerId: S1, isSub: true, stableford: 0, money: 0 },
  ] },
];

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
  await db.insert(seasons).values({ id: 1, name: '2026', year: 2026, startDate: '2026-04-01', endDate: '2026-09-30', totalRounds: 20, playoffFormat: 'x', harveyLiveEnabled: 1, createdAt: now });
  await db.insert(players).values([
    { id: M1, name: 'Mara', createdAt: now }, { id: M2, name: 'Beck', createdAt: now },
    { id: M3, name: 'Cole', createdAt: now }, { id: M4, name: 'Dale', createdAt: now },
    { id: S1, name: 'Subby', createdAt: now },
  ]);

  let groupId = 1;
  for (const r of SCHEDULE) {
    await db.insert(rounds).values({ id: r.id, seasonId: 1, type: 'official', status: r.status, scheduledDate: r.date, tee: 'blue', createdAt: now });
    const gid = groupId++;
    await db.insert(groups).values({ id: gid, roundId: r.id, groupNumber: 1 });
    await db.insert(roundPlayers).values(r.lines.map((l) => ({
      roundId: r.id, groupId: gid, playerId: l.playerId, handicapIndex: l.isSub ? 20 : 10, isSub: l.isSub ? 1 : 0,
    })));
    if (r.status !== 'finalized') continue;
    await db.insert(roundResults).values(r.lines.map((l) => ({
      roundId: r.id, playerId: l.playerId, stablefordTotal: l.stableford, moneyTotal: l.money, updatedAt: now,
    })));
    // Compute harvey points over the FULL lineup (members + subs), like production.
    const pts = calculateHarveyPoints(r.lines.map((l) => ({ stableford: l.stableford, money: l.money })), 'regular', 0);
    await db.insert(harveyResults).values(r.lines.map((l, i) => ({
      roundId: r.id, playerId: l.playerId, stablefordRank: 1, moneyRank: 1,
      stablefordPoints: pts[i]!.stablefordPoints, moneyPoints: pts[i]!.moneyPoints, updatedAt: now,
    })));
  }
});

type OddsLine = { playerId: number; name: string; fairProb: number; postedAmerican: number | null; impliedProb: number; tier: string };
type Odds = { gated: boolean; reason?: string; lines?: OddsLine[]; wideOpen?: boolean; theoreticalHold?: number; effectiveHold?: number };
type Retro = { winningMemberId: number | null; winningMemberName: string | null; subSpoiled: boolean; verdict: string; favoriteId: number | null } | null;
type Ledger = { openWeeks: number; cumulativeUnits: number; totalStakes: number; realizedHold: number; theoreticalHold: number; perWeek: Array<{ roundId: number }>; validity: { logLoss: number; baselines: { uniform: { logLoss: number }; handicapOnly: { logLoss: number }; lastWeek: { logLoss: number } }; ci: { logLoss: unknown; vsUniform: unknown } } | null };
type Resp = { odds: Odds; retrospective: Retro; houseLedger: Ledger; weeks: Array<{ roundId: number }> };

const get = async (rid: number) => (await (await app.request(`/api/scouting/${rid}`)).json()) as Resp;

describe('odds — "The Line" on the upcoming round', () => {
  it('emits one posted line per MEMBER (no sub), sorted favorites → longshots', async () => {
    const { odds } = await get(7);
    expect(odds.gated).toBe(false);
    const lines = odds.lines!;
    expect(lines.map((l) => l.playerId).sort()).toEqual([M1, M2, M3, M4]);
    expect(lines.some((l) => l.playerId === S1)).toBe(false); // sub never emitted as a line
    for (let i = 1; i < lines.length; i++) expect(lines[i - 1]!.fairProb).toBeGreaterThanOrEqual(lines[i]!.fairProb);
    expect(lines[0]!.playerId).toBe(M1); // dominant history ⇒ favorite
    expect(lines[0]!.name).toBe('Mara');
  });

  it('posted implied sums to ≈OVERROUND; fair sums to ≈1', async () => {
    const { odds } = await get(7);
    const lines = odds.lines!;
    expect(lines.reduce((a, l) => a + l.fairProb, 0)).toBeCloseTo(1, 6);
    expect(lines.reduce((a, l) => a + l.impliedProb, 0)).toBeCloseTo(1.18, 6);
  });

  it('determinism — two calls return byte-identical JSON', async () => {
    const a = await (await app.request('/api/scouting/7')).text();
    const b = await (await app.request('/api/scouting/7')).text();
    expect(a).toBe(b);
  });

  it('blindness — odds use only finalized rounds before the target', async () => {
    // R7 is scheduled (no results); the model can never read its outcome. The
    // odds are determined entirely by R1..R6, which are unchanged here.
    const { odds } = await get(7);
    expect(odds.gated).toBe(false);
    expect(odds.lines!.length).toBe(4);
  });
});

describe('odds — gate', () => {
  it('gates the earliest week (fewer than 3 prior finalized rounds)', async () => {
    const { odds } = await get(2); // only R1 precedes R2
    expect(odds.gated).toBe(true);
    expect(odds.reason).toMatch(/few weeks/);
  });
});

describe('retrospective — graded opening line', () => {
  it('R4: an unpriced member wins → BUSTED', async () => {
    const { retrospective } = await get(4);
    expect(retrospective).not.toBeNull();
    expect(retrospective!.winningMemberId).toBe(M4);
    expect(retrospective!.verdict).toBe('busted');
  });

  it('R5: the favorite wins → CHALK', async () => {
    const { retrospective, odds } = await get(5);
    expect(retrospective!.winningMemberId).toBe(M1);
    expect(odds.lines![0]!.playerId).toBe(M1); // M1 is the posted favorite
    expect(retrospective!.verdict).toBe('chalk');
  });

  it('R6: a listed non-favorite wins + a sub posts the overall high → UPSET + subSpoiled', async () => {
    const { retrospective } = await get(6);
    expect(retrospective!.winningMemberId).toBe(M2);
    expect(retrospective!.subSpoiled).toBe(true);
    expect(retrospective!.verdict).toBe('upset');
  });

  it('no retrospective on a not-yet-finalized round', async () => {
    const { retrospective } = await get(7);
    expect(retrospective).toBeNull();
  });
});

describe('house ledger', () => {
  it('opens after week 3, excludes below-gate weeks, covers R4/R5/R6', async () => {
    const { houseLedger } = await get(7);
    expect(houseLedger.openWeeks).toBe(3);
    expect(houseLedger.perWeek.map((w) => w.roundId)).toEqual([4, 5, 6]);
  });

  it('reports cumulative units + holds + calibration vs. baselines', async () => {
    const { houseLedger } = await get(7);
    expect(Number.isFinite(houseLedger.cumulativeUnits)).toBe(true);
    expect(houseLedger.theoreticalHold).toBeCloseTo(1 - 1 / 1.18, 4);
    expect(houseLedger.realizedHold).toBeGreaterThanOrEqual(-1);
    const v = houseLedger.validity!;
    expect(Number.isFinite(v.logLoss)).toBe(true); // finite even if a winner had fair_p=0 (floored)
    expect(v.baselines.uniform).toBeDefined();
    expect(v.baselines.handicapOnly).toBeDefined();
    expect(v.baselines.lastWeek).toBeDefined();
    expect(v.ci.logLoss).toBeDefined();
    expect(v.ci.vsUniform).toBeDefined();
  });

  it('is deterministic across reads', async () => {
    const a = await get(7);
    const b = await get(7);
    expect(JSON.stringify(a.houseLedger)).toBe(JSON.stringify(b.houseLedger));
  });
});

describe('week selector data', () => {
  it('lists the season official rounds', async () => {
    const { weeks } = await get(7);
    expect(weeks.map((w) => w.roundId)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
