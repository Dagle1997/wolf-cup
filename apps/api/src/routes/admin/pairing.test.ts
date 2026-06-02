import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { Context, Next } from 'hono';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { eq, and } from 'drizzle-orm';

vi.mock('../../db/index.js', async () => {
  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../../db/schema.js');
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client, { schema });
  return { db };
});

// Bypass admin auth for the integration paths (auth enforcement is covered in
// pairing.auth.test.ts, which does NOT mock the middleware).
vi.mock('../../middleware/admin-auth.js', () => ({
  adminAuthMiddleware: async (c: Context, next: Next) => {
    c.set('adminId' as never, 1 as never);
    await next();
  },
}));

import roundsApp from './rounds.js';
import pairingApp from './pairing.js';
import { db } from '../../db/index.js';
import { seasons, seasonWeeks, attendance, players, rounds, groups, roundPlayers } from '../../db/schema.js';
import { captureGeneratedPairingIfAbsent } from '../../lib/pairing-capture.js';
import { migrate } from 'drizzle-orm/libsql/migrator';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, '../../db/migrations');

type DiffBody = {
  tracked: boolean;
  generated: { groupNumber: number; playerIds: number[]; names: string[] }[] | null;
  final: { groupNumber: number; playerIds: number[]; names: string[] }[];
  changes: {
    moved: { playerId: number; fromGroup: number; toGroup: number }[];
    added: { playerId: number; toGroup: number }[];
    removed: { playerId: number; fromGroup: number }[];
  };
};

let seasonId: number;
let week1Id: number; // round used for capture / no-change / set-once
let week2Id: number; // round used for the end-to-end moved scenario
const playerIds: number[] = [];
let round1Id: number;
let round2Id: number;

async function createRoundFromWeek(seasonWeekId: number): Promise<number> {
  const res = await roundsApp.request('/rounds/from-attendance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seasonWeekId }),
  });
  expect(res.status).toBe(201);
  const week = await db.select().from(seasonWeeks).where(eq(seasonWeeks.id, seasonWeekId)).get();
  const round = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(and(eq(rounds.seasonId, seasonId), eq(rounds.scheduledDate, week!.friday)))
    .get();
  return round!.id;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder });

  const [season] = await db
    .insert(seasons)
    .values({
      name: 'pairing-test',
      year: 5099,
      startDate: '5099-01-01',
      endDate: '5099-12-31',
      totalRounds: 15,
      playoffFormat: 'top-8',
      createdAt: Date.now(),
    })
    .returning({ id: seasons.id });
  seasonId = season!.id;

  const [w1] = await db
    .insert(seasonWeeks)
    .values({ seasonId, friday: '5099-01-02', isActive: 1, tee: 'black', createdAt: Date.now() })
    .returning({ id: seasonWeeks.id });
  week1Id = w1!.id;
  const [w2] = await db
    .insert(seasonWeeks)
    .values({ seasonId, friday: '5099-01-09', isActive: 1, tee: 'black', createdAt: Date.now() })
    .returning({ id: seasonWeeks.id });
  week2Id = w2!.id;

  // 8 players → 2 groups of 4
  for (let i = 0; i < 8; i++) {
    const [p] = await db
      .insert(players)
      .values({ name: `Player ${i + 1}`, handicapIndex: 10 + i, createdAt: Date.now() })
      .returning({ id: players.id });
    playerIds.push(p!.id);
  }

  // Confirm all 8 for both weeks
  for (const wkId of [week1Id, week2Id]) {
    for (const pid of playerIds) {
      await db
        .insert(attendance)
        .values({ seasonWeekId: wkId, playerId: pid, status: 'in', updatedAt: Date.now() });
    }
  }

  round1Id = await createRoundFromWeek(week1Id);
  round2Id = await createRoundFromWeek(week2Id);
});

describe('from-attendance capture (AC1)', () => {
  it('snapshots the generated pairing as groups of 4 covering all players', async () => {
    const round = await db
      .select({ gp: rounds.generatedPairing })
      .from(rounds)
      .where(eq(rounds.id, round1Id))
      .get();
    expect(round!.gp).not.toBeNull();
    const snapshot = JSON.parse(round!.gp!) as { groupNumber: number; playerIds: number[] }[];
    expect(snapshot).toHaveLength(2);
    for (const g of snapshot) expect(g.playerIds).toHaveLength(4);
    const allIds = snapshot.flatMap((g) => g.playerIds).sort((a, b) => a - b);
    expect(allIds).toEqual([...playerIds].sort((a, b) => a - b));
  });
});

describe('set-once capture (AC2)', () => {
  it('does not overwrite an already-captured snapshot', async () => {
    const before = await db
      .select({ gp: rounds.generatedPairing })
      .from(rounds)
      .where(eq(rounds.id, round1Id))
      .get();

    const captured = await captureGeneratedPairingIfAbsent(round1Id, db);
    expect(captured).toBe(false);

    const after = await db
      .select({ gp: rounds.generatedPairing })
      .from(rounds)
      .where(eq(rounds.id, round1Id))
      .get();
    expect(after!.gp).toBe(before!.gp);
  });
});

describe('GET /rounds/:roundId/pairing-diff', () => {
  it('returns tracked with no changes for a freshly-generated round', async () => {
    const res = await pairingApp.request(`/rounds/${round1Id}/pairing-diff`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DiffBody;
    expect(body.tracked).toBe(true);
    expect(body.generated).not.toBeNull();
    expect(body.changes).toEqual({ moved: [], added: [], removed: [] });
    // names resolved for display
    expect(body.final[0]!.names.length).toBeGreaterThan(0);
  });

  it('returns tracked:false / generated:null for an untracked round (AC5)', async () => {
    const [bare] = await db
      .insert(rounds)
      .values({
        seasonId,
        type: 'official',
        status: 'scheduled',
        scheduledDate: '5099-02-01',
        autoCalculateMoney: 1,
        createdAt: Date.now(),
      })
      .returning({ id: rounds.id });

    const res = await pairingApp.request(`/rounds/${bare!.id}/pairing-diff`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DiffBody;
    expect(body.tracked).toBe(false);
    expect(body.generated).toBeNull();
    expect(body.final).toEqual([]);
  });

  it('404s for a non-existent round', async () => {
    const res = await pairingApp.request('/rounds/999999/pairing-diff', { method: 'GET' });
    expect(res.status).toBe(404);
  });

  it('treats a parseable-but-wrong-shape snapshot as untracked, never 500s', async () => {
    // Valid JSON, wrong shape (missing playerIds) — must NOT throw downstream.
    const [r] = await db
      .insert(rounds)
      .values({
        seasonId,
        type: 'official',
        status: 'scheduled',
        scheduledDate: '5099-03-01',
        autoCalculateMoney: 1,
        generatedPairing: '[{"groupNumber":1}]',
        createdAt: Date.now(),
      })
      .returning({ id: rounds.id });

    const res = await pairingApp.request(`/rounds/${r!.id}/pairing-diff`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DiffBody;
    expect(body.tracked).toBe(false);
    expect(body.generated).toBeNull();
  });

  it('set-once survives a direct pre-set value (atomic IS NULL guard)', async () => {
    const [r] = await db
      .insert(rounds)
      .values({
        seasonId,
        type: 'official',
        status: 'scheduled',
        scheduledDate: '5099-03-08',
        autoCalculateMoney: 1,
        generatedPairing: '[{"groupNumber":1,"playerIds":[1,2,3,4]}]',
        createdAt: Date.now(),
      })
      .returning({ id: rounds.id });

    const captured = await captureGeneratedPairingIfAbsent(r!.id, db);
    expect(captured).toBe(false);
    const after = await db
      .select({ gp: rounds.generatedPairing })
      .from(rounds)
      .where(eq(rounds.id, r!.id))
      .get();
    expect(after!.gp).toBe('[{"groupNumber":1,"playerIds":[1,2,3,4]}]');
  });

  it('reports a moved player after a manual group change (AC3)', async () => {
    // Read round2's groups + current membership (== generated, no edits yet).
    const grpRows = await db
      .select({ id: groups.id, groupNumber: groups.groupNumber })
      .from(groups)
      .where(eq(groups.roundId, round2Id));
    const g1 = grpRows.find((g) => g.groupNumber === 1)!;
    const g2 = grpRows.find((g) => g.groupNumber === 2)!;

    const inG1 = await db
      .select({ playerId: roundPlayers.playerId, handicapIndex: roundPlayers.handicapIndex })
      .from(roundPlayers)
      .where(and(eq(roundPlayers.roundId, round2Id), eq(roundPlayers.groupId, g1.id)));
    const mover = inG1[0]!;

    // Move the player from group 1 → group 2 via the real admin endpoints.
    const del = await roundsApp.request(
      `/rounds/${round2Id}/groups/${g1.id}/players/${mover.playerId}`,
      { method: 'DELETE' },
    );
    expect(del.status).toBe(200);
    const add = await roundsApp.request(`/rounds/${round2Id}/groups/${g2.id}/players`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: mover.playerId, handicapIndex: mover.handicapIndex, isSub: false }),
    });
    expect(add.status).toBe(201);

    const res = await pairingApp.request(`/rounds/${round2Id}/pairing-diff`, { method: 'GET' });
    const body = (await res.json()) as DiffBody;
    expect(body.tracked).toBe(true);
    expect(body.changes.moved).toContainEqual({ playerId: mover.playerId, fromGroup: 1, toGroup: 2 });
    expect(body.changes.added).toEqual([]);
    expect(body.changes.removed).toEqual([]);
  });
});
