// ---------------------------------------------------------------------------
// In-Round Batting-Order Correction — integration tests
// Covers: clean early-catch reorder (today's 2026-05-29 scenario), the conflict
// case (a changed wolf hole already has a decision), optimistic-lock staleness,
// no-op, and the zero-sum money invariant after a mid-round correction.
// ---------------------------------------------------------------------------

import { vi, describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { Hono } from 'hono';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { and, eq } from 'drizzle-orm';

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
import { wolfDecisions } from '../db/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

const app = new Hono();
app.route('/api', roundsRouter);

// 4 players, scores for holes 1–5 (enough to exercise slots 1–4 wolf holes 2,4,5).
const PLAYERS = [
  { name: 'Anna', handicapIndex: 5.2, scores: [5, 4, 4, 4, 5] },
  { name: 'Beth', handicapIndex: 12.8, scores: [6, 5, 5, 5, 5] },
  { name: 'Cara', handicapIndex: 18.4, scores: [6, 5, 5, 5, 6] },
  { name: 'Dina', handicapIndex: 24.1, scores: [7, 6, 6, 5, 6] },
];

const json = (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

type DecisionSpec = { decision: string; partnerIdx?: number; polieIdx?: number[]; greenieIdx?: number[] };

async function setupScoredRound(throughHole: number, decisions: Record<number, DecisionSpec>) {
  const r = await json('POST', '/api/rounds/practice', { groupCount: 1, tee: 'blue' });
  const { roundId, groups } = (await r.json()) as { roundId: number; groups: Array<{ id: number }> };
  const groupId = groups[0]!.id;

  const ids: number[] = [];
  for (const p of PLAYERS) {
    const g = await json('POST', `/api/rounds/${roundId}/groups/${groupId}/guests`, { name: p.name, handicapIndex: p.handicapIndex });
    ids.push(((await g.json()) as { player: { id: number } }).player.id);
  }

  const boRes = await json('PUT', `/api/rounds/${roundId}/groups/${groupId}/batting-order`, { order: ids });
  expect(boRes.status).toBe(200);

  for (let h = 1; h <= throughHole; h++) {
    const scores = ids.map((pid, i) => ({ playerId: pid, grossScore: PLAYERS[i]!.scores[h - 1] }));
    const s = await json('POST', `/api/rounds/${roundId}/groups/${groupId}/holes/${h}/scores`, { scores });
    expect(s.status, `scores hole ${h}`).toBe(200);
    const d = decisions[h];
    if (d) {
      const w = await json('POST', `/api/rounds/${roundId}/groups/${groupId}/holes/${h}/wolf-decision`, {
        decision: d.decision,
        ...(d.partnerIdx != null ? { partnerPlayerId: ids[d.partnerIdx] } : {}),
        greenies: (d.greenieIdx ?? []).map((i) => ids[i]),
        polies: (d.polieIdx ?? []).map((i) => ids[i]),
      });
      expect(w.status, `decision hole ${h}`).toBe(200);
    }
  }
  return { roundId, groupId, ids };
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

describe('batting-order correction', () => {
  it('clean early-catch: swapping slots 3&4 after holes 1–4 has no conflict and stays zero-sum', async () => {
    // Wolf holes in 1–4 are 2 (slot1) and 4 (slot2) — neither touches the swapped slots 3&4.
    const { roundId, groupId, ids } = await setupScoredRound(4, {
      2: { decision: 'alone' },
      4: { decision: 'alone' },
    });
    const swapped = [ids[0]!, ids[1]!, ids[3]!, ids[2]!]; // swap slots 3 & 4

    const res = await json('PUT', `/api/rounds/${roundId}/groups/${groupId}/batting-order/correct`, { order: swapped });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { conflicts: number[]; changedHoles: number[]; moneyTotals: Array<{ moneyTotal: number }> };
    expect(data.conflicts).toEqual([]); // nothing already played on a changed wolf hole
    expect(data.changedHoles).toEqual([5, 8, 11, 12, 13, 15, 17, 18]);
    const sum = data.moneyTotals.reduce((a, m) => a + m.moneyTotal, 0);
    expect(Math.abs(sum)).toBeLessThan(0.001); // zero-sum preserved
    // decisions on holes 2 & 4 untouched
    const surviving = await db.select().from(wolfDecisions).where(and(eq(wolfDecisions.roundId, roundId), eq(wolfDecisions.groupId, groupId)));
    expect(surviving.find((d) => d.holeNumber === 2)?.decision).toBe('alone');
    expect(surviving.find((d) => d.holeNumber === 4)?.decision).toBe('alone');
  });

  it('conflict: blind_wolf on a changed hole (5) blocks, then on confirm clears decision+outcome but PRESERVES bonuses', async () => {
    // Hole 5 is slot 3; swapping 3&4 changes its wolf. Recorded as blind_wolf (order-sensitive,
    // codex F4) with a poly awarded to player 0 (order-independent bonus, codex F6).
    const { roundId, groupId, ids } = await setupScoredRound(5, {
      2: { decision: 'alone' },
      4: { decision: 'alone' },
      5: { decision: 'blind_wolf', polieIdx: [0] },
    });
    const swapped = [ids[0]!, ids[1]!, ids[3]!, ids[2]!];

    // outcome was written for hole 5 at decision time
    const before = await db.select().from(wolfDecisions).where(and(eq(wolfDecisions.roundId, roundId), eq(wolfDecisions.groupId, groupId)));
    expect(before.find((d) => d.holeNumber === 5)?.outcome).not.toBeNull();

    // Without confirm → 409 naming hole 5
    const blocked = await json('PUT', `/api/rounds/${roundId}/groups/${groupId}/batting-order/correct`, { order: swapped });
    expect(blocked.status).toBe(409);
    const blockedBody = (await blocked.json()) as { code: string; conflicts: number[] };
    expect(blockedBody.code).toBe('WOLF_CONFLICT');
    expect(blockedBody.conflicts).toContain(5);

    // With confirm → 200, zero-sum
    const ok = await json('PUT', `/api/rounds/${roundId}/groups/${groupId}/batting-order/correct`, { order: swapped, confirm: true });
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as { conflicts: number[]; moneyTotals: Array<{ moneyTotal: number }> };
    expect(okBody.conflicts).toContain(5);
    expect(Math.abs(okBody.moneyTotals.reduce((a, m) => a + m.moneyTotal, 0))).toBeLessThan(0.001);

    const rows = await db.select().from(wolfDecisions).where(and(eq(wolfDecisions.roundId, roundId), eq(wolfDecisions.groupId, groupId)));
    const hole5 = rows.find((d) => d.holeNumber === 5);
    expect(hole5?.decision).toBeNull(); // wolf call reset for re-entry (F2/F4)
    expect(hole5?.outcome).toBeNull(); // derived outcome cleared too (F2)
    expect(hole5?.wolfPlayerId).toBe(ids[3]); // now points at the new wolf (slot 3 after swap)
    const bonuses = JSON.parse(hole5?.bonusesJson ?? '{}') as { polies?: number[] };
    expect(bonuses.polies).toContain(ids[0]); // order-independent bonus preserved (F6)
  });

  it('optimistic lock: a stale fromOrder is rejected with 409 STALE_ORDER', async () => {
    const { roundId, groupId, ids } = await setupScoredRound(2, { 2: { decision: 'alone' } });
    const swapped = [ids[0]!, ids[1]!, ids[3]!, ids[2]!];
    const wrongFrom = [ids[3]!, ids[2]!, ids[1]!, ids[0]!]; // not the current order
    const res = await json('PUT', `/api/rounds/${roundId}/groups/${groupId}/batting-order/correct`, { order: swapped, fromOrder: wrongFrom });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('STALE_ORDER');
  });

  it('no-op: same order returns 200 with no changes', async () => {
    const { roundId, groupId, ids } = await setupScoredRound(2, { 2: { decision: 'alone' } });
    const res = await json('PUT', `/api/rounds/${roundId}/groups/${groupId}/batting-order/correct`, { order: ids });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { changedHoles: number[] };
    expect(data.changedHoles).toEqual([]);
  });

  it('rejects a roster change (a player not in the group)', async () => {
    const { roundId, groupId, ids } = await setupScoredRound(2, { 2: { decision: 'alone' } });
    const bogus = [ids[0]!, ids[1]!, ids[2]!, 999999];
    const res = await json('PUT', `/api/rounds/${roundId}/groups/${groupId}/batting-order/correct`, { order: bogus });
    expect(res.status).toBe(422);
  });
});
