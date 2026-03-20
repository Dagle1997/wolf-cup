// ---------------------------------------------------------------------------
// Practice Round Integration Test
// Verifies the complete scoring flow: create round → add guests → batting
// order → 18 holes of scores + wolf decisions → Stableford cross-check →
// money zero-sum invariant.  Also covers multi-group isolation and quit.
// ---------------------------------------------------------------------------

import { vi, describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { Hono } from 'hono';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { calculateStablefordPoints, getCourseHole, getWolfAssignment } from '@wolf-cup/engine';

// ---------------------------------------------------------------------------
// DB mock — must be hoisted before any import that touches db
// ---------------------------------------------------------------------------

vi.mock('../db/index.js', async () => {
  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../db/schema.js');
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client, { schema });
  return { db };
});

import roundsRouter from './rounds.js';
import { db } from '../db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

// Compose a minimal test app — avoids importing index.ts which calls serve()
const testApp = new Hono();
testApp.route('/api', roundsRouter);

// ---------------------------------------------------------------------------
// Course constants derived from engine — stays in sync if course data changes
// ---------------------------------------------------------------------------

// Par-3 holes at Guyan G&CC: holes 6, 7, 12, 15 (derived from engine)
const PAR3_HOLES = new Set(
  Array.from({ length: 18 }, (_, i) => i + 1).filter((h) => getCourseHole(h).par === 3),
);

// ---------------------------------------------------------------------------
// Test player data — 4 players spanning scratch to 24 handicap
// ---------------------------------------------------------------------------

const PLAYER_DATA: Array<{ name: string; handicapIndex: number; scores: number[] }> = [
  { name: 'Alice', handicapIndex: 5.2,  scores: [5, 4, 4, 4, 5, 3, 3, 6, 5, 4, 5, 3, 4, 5, 3, 5, 4, 4] },
  { name: 'Bob',   handicapIndex: 12.8, scores: [6, 5, 5, 5, 5, 4, 4, 6, 5, 5, 6, 3, 5, 5, 4, 5, 4, 5] },
  { name: 'Carol', handicapIndex: 18.4, scores: [6, 5, 5, 5, 6, 4, 4, 7, 5, 5, 7, 4, 5, 5, 4, 5, 5, 5] },
  { name: 'Dave',  handicapIndex: 24.1, scores: [7, 6, 6, 5, 6, 4, 4, 7, 6, 6, 7, 4, 6, 6, 4, 6, 5, 6] },
];

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

type PlayerRow = { id: number; name: string; handicapIndex: number };
type RoundTotal = { playerId: number; stablefordTotal: number; moneyTotal: number };
type MoneyTotal = { playerId: number; moneyTotal: number };

function postJSON(path: string, body?: unknown) {
  return testApp.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function putJSON(path: string, body: unknown) {
  return testApp.request(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(path: string) {
  return testApp.request(path);
}

// ---------------------------------------------------------------------------
// Flow helpers
// ---------------------------------------------------------------------------

/** Add the 4 PLAYER_DATA entries as guests and return the created players */
async function addGuests(roundId: number, groupId: number): Promise<PlayerRow[]> {
  const result: PlayerRow[] = [];
  for (const p of PLAYER_DATA) {
    const res = await postJSON(`/api/rounds/${roundId}/groups/${groupId}/guests`, {
      name: p.name,
      handicapIndex: p.handicapIndex,
    });
    expect(res.status, `addGuest ${p.name}`).toBe(200);
    const data = (await res.json()) as { player: PlayerRow };
    result.push(data.player);
  }
  return result;
}

/**
 * Submit batting order, all 18 holes of scores, and wolf decisions.
 * playerIds[i] must correspond to PLAYER_DATA[i].
 *
 * Decision schedule:
 *   Holes 1–2:   skins only (no decision submitted unless greenie/polie present)
 *   Holes 3–4:   alone
 *   Holes 5–8:   partner  (next batter in rotating order)
 *   Holes 9–13:  blind_wolf
 *   Holes 14–18: alone
 *
 * Greenies: par-3 holes (6, 7, 12, 15) → awarded to playerIds[0]
 * Polies:   hole 9 → awarded to playerIds[0]
 */
async function runGroupFlow(roundId: number, groupId: number, playerIds: number[]): Promise<RoundTotal[]> {
  type WolfBody = {
    decision?: 'alone' | 'partner' | 'blind_wolf';
    partnerPlayerId?: number;
    greenies: number[];
    polies: number[];
  };

  // Set batting order
  const boRes = await putJSON(`/api/rounds/${roundId}/groups/${groupId}/batting-order`, {
    order: playerIds,
  });
  expect(boRes.status, 'batting-order').toBe(200);

  for (let h = 1; h <= 18; h++) {
    // Submit hole scores
    const scores = playerIds.map((pid, i) => ({
      playerId: pid,
      grossScore: PLAYER_DATA[i]!.scores[h - 1],
    }));
    const sRes = await postJSON(
      `/api/rounds/${roundId}/groups/${groupId}/holes/${h}/scores`,
      { scores },
    );
    expect(sRes.status, `scores hole ${h}`).toBe(200);

    // Build wolf decision body
    const greenies = PAR3_HOLES.has(h) ? [playerIds[0]!] : [];
    const polies = h === 9 ? [playerIds[0]!] : [];
    const wolfBody: WolfBody = { greenies, polies };

    if (h >= 3) {
      if (h <= 4) {
        wolfBody.decision = 'alone';
      } else if (h <= 8) {
        const assignment = getWolfAssignment([0, 1, 2, 3], h as 5 | 6 | 7 | 8);
        const wolfIdx = assignment.type === 'wolf' ? assignment.wolfBatterIndex : 0;
        const partnerIdx = (wolfIdx + 1) % 4;
        wolfBody.decision = 'partner';
        wolfBody.partnerPlayerId = playerIds[partnerIdx]!;
      } else if (h <= 13) {
        wolfBody.decision = 'blind_wolf';
      } else {
        wolfBody.decision = 'alone';
      }
    }

    // Only POST wolf-decision when there is something to save
    if (greenies.length > 0 || polies.length > 0 || h >= 3) {
      const wRes = await postJSON(
        `/api/rounds/${roundId}/groups/${groupId}/holes/${h}/wolf-decision`,
        wolfBody,
      );
      expect(wRes.status, `wolf-decision hole ${h}`).toBe(200);
    }
  }

  // Fetch final totals
  const totalsRes = await getReq(`/api/rounds/${roundId}/groups/${groupId}/scores`);
  expect(totalsRes.status, 'GET scores').toBe(200);
  const data = (await totalsRes.json()) as {
    scores: unknown[];
    roundTotals: RoundTotal[];
  };
  return data.roundTotals;
}

/**
 * Compute expected Stableford total for PLAYER_DATA[idx] via direct engine call.
 * Uses getCourseHole() from @wolf-cup/engine — stays in sync with course data.
 */
function engineStableford(playerIdx: number): number {
  const { handicapIndex, scores } = PLAYER_DATA[playerIdx]!;
  let total = 0;
  for (let h = 1; h <= 18; h++) {
    const { par, strokeIndex } = getCourseHole(h);
    total += calculateStablefordPoints(scores[h - 1]!, handicapIndex, par, strokeIndex);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Global setup — run migrations once for all suites
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

// ---------------------------------------------------------------------------
// Suite 1: 1-group practice round — full 18-hole flow
// ---------------------------------------------------------------------------

describe('1-group practice round — full 18-hole flow', () => {
  let roundId: number;
  let groupId: number;
  let playerIds: number[];
  let roundTotals: RoundTotal[];

  beforeAll(async () => {
    const res = await postJSON('/api/rounds/practice', { groupCount: 1 });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { roundId: number; groups: Array<{ id: number }> };
    roundId = data.roundId;
    groupId = data.groups[0]!.id;

    const guests = await addGuests(roundId, groupId);
    playerIds = guests.map((g) => g.id);

    roundTotals = await runGroupFlow(roundId, groupId, playerIds);
  });

  it('returns round totals for all 4 players', () => {
    expect(roundTotals).toHaveLength(4);
    for (const t of roundTotals) {
      expect(typeof t.stablefordTotal).toBe('number');
      expect(typeof t.moneyTotal).toBe('number');
    }
  });

  it('Stableford totals match direct engine calculation', () => {
    for (let i = 0; i < PLAYER_DATA.length; i++) {
      const pid = playerIds[i]!;
      const apiTotal = roundTotals.find((t) => t.playerId === pid)?.stablefordTotal;
      const expected = engineStableford(i);
      expect(apiTotal, `Stableford ${PLAYER_DATA[i]!.name} (idx ${i})`).toBe(expected);
    }
  });

  it('money totals sum to zero (zero-sum invariant)', () => {
    const sum = roundTotals.reduce((acc, t) => acc + t.moneyTotal, 0);
    expect(sum, 'money zero-sum').toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: 2-group practice round — independent group scoring
// ---------------------------------------------------------------------------

describe('2-group practice round — independent group scoring', () => {
  let roundId: number;
  let group1Id: number;
  let group2Id: number;
  let totals1: RoundTotal[];
  let totals2: RoundTotal[];
  let players1: number[];
  let players2: number[];

  beforeAll(async () => {
    const res = await postJSON('/api/rounds/practice', { groupCount: 2 });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { roundId: number; groups: Array<{ id: number }> };
    roundId = data.roundId;
    group1Id = data.groups[0]!.id;
    group2Id = data.groups[1]!.id;

    // Add guests sequentially to avoid SQLite write contention
    const g1 = await addGuests(roundId, group1Id);
    const g2 = await addGuests(roundId, group2Id);
    players1 = g1.map((p) => p.id);
    players2 = g2.map((p) => p.id);

    totals1 = await runGroupFlow(roundId, group1Id, players1);
    totals2 = await runGroupFlow(roundId, group2Id, players2);
  });

  it('group 1 money nets to zero', () => {
    const sum = totals1.reduce((acc, t) => acc + t.moneyTotal, 0);
    expect(sum, 'group 1 zero-sum').toBe(0);
  });

  it('group 2 money nets to zero', () => {
    const sum = totals2.reduce((acc, t) => acc + t.moneyTotal, 0);
    expect(sum, 'group 2 zero-sum').toBe(0);
  });

  it('group 1 Stableford totals match engine', () => {
    for (let i = 0; i < PLAYER_DATA.length; i++) {
      const pid = players1[i]!;
      const apiTotal = totals1.find((t) => t.playerId === pid)?.stablefordTotal;
      expect(apiTotal, `g1 stableford player ${i}`).toBe(engineStableford(i));
    }
  });

  it('group 2 Stableford totals match engine', () => {
    for (let i = 0; i < PLAYER_DATA.length; i++) {
      const pid = players2[i]!;
      const apiTotal = totals2.find((t) => t.playerId === pid)?.stablefordTotal;
      expect(apiTotal, `g2 stableford player ${i}`).toBe(engineStableford(i));
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 3: 4-group practice round — all groups independent
// ---------------------------------------------------------------------------

describe('4-group practice round — all groups independent', () => {
  let roundId: number;
  let groupIds: number[];
  let allTotals: RoundTotal[][];
  let allPlayerIds: number[][];

  beforeAll(async () => {
    const res = await postJSON('/api/rounds/practice', { groupCount: 4 });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { roundId: number; groups: Array<{ id: number }> };
    roundId = data.roundId;
    groupIds = data.groups.map((g) => g.id);

    allTotals = [];
    allPlayerIds = [];
    for (const gid of groupIds) {
      const guests = await addGuests(roundId, gid);
      const pids = guests.map((p) => p.id);
      allPlayerIds.push(pids);
      const totals = await runGroupFlow(roundId, gid, pids);
      allTotals.push(totals);
    }
  });

  it('creates exactly 4 groups', () => {
    expect(groupIds).toHaveLength(4);
  });

  it('all 4 groups produce zero-sum money totals', () => {
    for (let g = 0; g < 4; g++) {
      const sum = allTotals[g]!.reduce((acc, t) => acc + t.moneyTotal, 0);
      expect(sum, `group ${g + 1} zero-sum`).toBe(0);
    }
  });

  it('all 4 groups Stableford totals match engine', () => {
    for (let g = 0; g < 4; g++) {
      for (let i = 0; i < PLAYER_DATA.length; i++) {
        const pid = allPlayerIds[g]![i]!;
        const apiTotal = allTotals[g]!.find((t) => t.playerId === pid)?.stablefordTotal;
        expect(apiTotal, `group ${g + 1} player ${i} stableford`).toBe(engineStableford(i));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Blind wolf win & no-blood scenarios
//
// Score design (Guyan G&CC):
//   Hole 1 (par 5, SI 3) — all net 5, tie → $0 (no-blood)
//     Alice (ch=5,  SI3≤5  → 1 stroke): gross 6, net 5
//     Bob   (ch=13, SI3≤13 → 1 stroke): gross 6, net 5
//     Carol (ch=18, base 1 → 1 stroke): gross 6, net 5
//     Dave  (ch=24, base 1, SI3≤6 → 2 strokes): gross 7, net 5
//
//   Hole 2 (par 4, SI 1) — all net 4, tie → $0 (no-blood)
//     Alice (ch=5,  SI1≤5  → 1 stroke): gross 5, net 4
//     Bob   (ch=13, SI1≤13 → 1 stroke): gross 5, net 4
//     Carol (ch=18, base 1 → 1 stroke): gross 5, net 4
//     Dave  (ch=24, base 1, SI1≤6 → 2 strokes): gross 6, net 4
//
//   Hole 3 (par 4, SI 13) — Alice wins alone as blind wolf
//     Alice (ch=5, SI13>5 → 0 strokes): gross 3, net 3  ← unique low ✓
//     Bob   (ch=13, SI13≤13 → 1 stroke): gross 5, net 4
//     Carol (ch=18, base 1  → 1 stroke): gross 5, net 4
//     Dave  (ch=24, base 1, SI13>6 → 1 stroke): gross 6, net 5
//   Wolf wins all 4 base components (low ball + skin + bonus + blind wolf extra)
//   plus birdie bonus skin (net 3 on par 4):
//     wolf +$15, each opponent -$5, sum $0
// ---------------------------------------------------------------------------

describe('blind wolf win & no-blood scenarios', () => {
  let roundId: number;
  let groupId: number;
  let wolfId: number;    // Alice (batting position 0 — wolf on hole 3)
  let oppIds: number[];  // Bob, Carol, Dave
  let playerIds: number[];

  // Custom per-hole gross scores (index = player position 0-3)
  const HOLE1_GROSS = [6, 6, 6, 7]; // all net 5 — no-blood
  const HOLE2_GROSS = [5, 5, 5, 6]; // all net 4 — no-blood
  const HOLE3_GROSS = [3, 5, 5, 6]; // Alice net 3, others 4/4/5 — wolf wins

  beforeAll(async () => {
    const res = await postJSON('/api/rounds/practice', { groupCount: 1 });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { roundId: number; groups: Array<{ id: number }> };
    roundId = data.roundId;
    groupId = data.groups[0]!.id;

    const guests = await addGuests(roundId, groupId);
    playerIds = guests.map((g) => g.id);
    wolfId = playerIds[0]!;   // Alice is wolf for hole 3 (batting position (3-3)%4 = 0)
    oppIds = playerIds.slice(1);

    const boRes = await putJSON(`/api/rounds/${roundId}/groups/${groupId}/batting-order`, {
      order: playerIds,
    });
    expect(boRes.status, 'batting-order').toBe(200);
  });

  it('all-tied net scores yield $0 for all players (no-blood hole)', async () => {
    // Submit hole 1 — all net 5, tie
    const h1Scores = playerIds.map((pid, i) => ({ playerId: pid, grossScore: HOLE1_GROSS[i]! }));
    const s1Res = await postJSON(
      `/api/rounds/${roundId}/groups/${groupId}/holes/1/scores`,
      { scores: h1Scores },
    );
    expect(s1Res.status, 'hole 1 scores').toBe(200);

    // Post wolf-decision for hole 1 (skins hole — no decision needed) to trigger money recalc
    const w1Res = await postJSON(
      `/api/rounds/${roundId}/groups/${groupId}/holes/1/wolf-decision`,
      { greenies: [], polies: [] },
    );
    expect(w1Res.status, 'hole 1 wolf-decision').toBe(200);

    const w1Data = (await w1Res.json()) as { moneyTotals: MoneyTotal[] };
    const sum = w1Data.moneyTotals.reduce((acc, t) => acc + t.moneyTotal, 0);
    expect(sum, 'no-blood sum').toBe(0);
    for (const t of w1Data.moneyTotals) {
      expect(t.moneyTotal, `player ${t.playerId} no-blood`).toBe(0);
    }
  });

  it('blind_wolf win awards wolf +$15, each opponent -$5, sum $0', async () => {
    // Submit hole 2 — all net 4, tie
    const h2Scores = playerIds.map((pid, i) => ({ playerId: pid, grossScore: HOLE2_GROSS[i]! }));
    const s2Res = await postJSON(
      `/api/rounds/${roundId}/groups/${groupId}/holes/2/scores`,
      { scores: h2Scores },
    );
    expect(s2Res.status, 'hole 2 scores').toBe(200);

    // Submit hole 3 — Alice gross 3 (net 3, uniquely lowest)
    const h3Scores = playerIds.map((pid, i) => ({ playerId: pid, grossScore: HOLE3_GROSS[i]! }));
    const s3Res = await postJSON(
      `/api/rounds/${roundId}/groups/${groupId}/holes/3/scores`,
      { scores: h3Scores },
    );
    expect(s3Res.status, 'hole 3 scores').toBe(200);

    // Hole 3 wolf-decision: Alice (batting pos 0) calls blind_wolf
    const wRes = await postJSON(
      `/api/rounds/${roundId}/groups/${groupId}/holes/3/wolf-decision`,
      { decision: 'blind_wolf', greenies: [], polies: [] },
    );
    expect(wRes.status, 'hole 3 wolf-decision').toBe(200);

    // Cumulative totals (holes 1+2 no-blood = $0, hole 3 blind wolf wins all 4 components + birdie bonus)
    // Base: wolf +$12 (4 components × $3), each opp -$4 (4 components × $1)
    // Birdie bonus (net 3 on par 4): wolf +$3, each opp -$1
    // Total: wolf +$15, each opp -$5
    const wData = (await wRes.json()) as { moneyTotals: MoneyTotal[] };
    const wolfTotal = wData.moneyTotals.find((t) => t.playerId === wolfId)?.moneyTotal;
    expect(wolfTotal, 'wolf blind wolf total').toBe(15);
    for (const oppId of oppIds) {
      const oppTotal = wData.moneyTotals.find((t) => t.playerId === oppId)?.moneyTotal;
      expect(oppTotal, `opp ${oppId} total`).toBe(-5);
    }
    const sum = wData.moneyTotals.reduce((acc, t) => acc + t.moneyTotal, 0);
    expect(sum, 'zero-sum').toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 5: Round quit — group and round lifecycle
// ---------------------------------------------------------------------------

describe('round quit — group and round lifecycle', () => {
  let roundId: number;
  let group1Id: number;
  let group2Id: number;

  beforeAll(async () => {
    const res = await postJSON('/api/rounds/practice', { groupCount: 2 });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { roundId: number; groups: Array<{ id: number }> };
    roundId = data.roundId;
    group1Id = data.groups[0]!.id;
    group2Id = data.groups[1]!.id;

    await addGuests(roundId, group1Id);
    await addGuests(roundId, group2Id);
  });

  it('quitting first group leaves round active with one remaining group', async () => {
    const res = await postJSON(`/api/rounds/${roundId}/groups/${group1Id}/quit`);
    expect(res.status).toBe(200);

    const roundRes = await getReq(`/api/rounds/${roundId}`);
    expect(roundRes.status).toBe(200);
    const roundData = (await roundRes.json()) as {
      round: { status: string; groups: unknown[] };
    };
    expect(roundData.round.status).toBe('active');
    expect(roundData.round.groups).toHaveLength(1);

    // Verify group data actually purged — GET /scores returns 404 for deleted group
    const scoresRes = await getReq(`/api/rounds/${roundId}/groups/${group1Id}/scores`);
    expect(scoresRes.status, 'scores 404 for quit group').toBe(404);
  });

  it('quitting the last group cancels the round', async () => {
    const res = await postJSON(`/api/rounds/${roundId}/groups/${group2Id}/quit`);
    expect(res.status).toBe(200);

    const roundRes = await getReq(`/api/rounds/${roundId}`);
    expect(roundRes.status).toBe(200);
    const roundData = (await roundRes.json()) as { round: { status: string } };
    expect(roundData.round.status).toBe('cancelled');
  });
});
