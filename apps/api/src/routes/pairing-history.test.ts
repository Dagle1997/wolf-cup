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

import pairingHistoryApp from './pairing-history.js';
import { db } from '../db/index.js';
import { seasons, players, pairingHistory } from '../db/schema.js';
import { migrate } from 'drizzle-orm/libsql/migrator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

let season2026Id: number;
let season2025Id: number;
let aliceId: number;
let bobId: number;

beforeAll(async () => {
  await migrate(db, { migrationsFolder });

  const [s2026] = await db
    .insert(seasons)
    .values({
      name: 'pairing-history-test 2026',
      year: 9026,
      startDate: '9026-01-01',
      endDate: '9026-12-31',
      totalRounds: 15,
      playoffFormat: 'top-8',
      harveyLiveEnabled: 0,
      createdAt: Date.now(),
    })
    .returning({ id: seasons.id });
  season2026Id = s2026!.id;

  const [s2025] = await db
    .insert(seasons)
    .values({
      name: 'pairing-history-test 2025',
      year: 9025,
      startDate: '9025-01-01',
      endDate: '9025-12-31',
      totalRounds: 15,
      playoffFormat: 'top-8',
      harveyLiveEnabled: 0,
      createdAt: Date.now(),
    })
    .returning({ id: seasons.id });
  season2025Id = s2025!.id;

  const [a] = await db
    .insert(players)
    .values({ name: 'Alice', isActive: 1, createdAt: Date.now() })
    .returning({ id: players.id });
  aliceId = a!.id;
  const [b] = await db
    .insert(players)
    .values({ name: 'Bob', isActive: 1, createdAt: Date.now() })
    .returning({ id: players.id });
  bobId = b!.id;
  await db
    .insert(players)
    .values({ name: 'Carol', isActive: 1, createdAt: Date.now() })
    .returning({ id: players.id });
});

afterEach(async () => {
  await db.delete(pairingHistory).where(eq(pairingHistory.seasonId, season2026Id));
  await db.delete(pairingHistory).where(eq(pairingHistory.seasonId, season2025Id));
});

describe('GET /pairing-history', () => {
  it('returns the latest season by default with empty pairs when no history exists', async () => {
    const res = await pairingHistoryApp.request('/pairing-history');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      season: { id: number; year: number };
      seasons: { id: number; year: number }[];
      players: { id: number; name: string }[];
      pairs: { playerAId: number; playerBId: number; pairCount: number }[];
    };
    expect(body.season.id).toBe(season2026Id); // max year wins
    expect(body.seasons.map((s) => s.id)).toContain(season2025Id);
    expect(body.seasons.map((s) => s.id)).toContain(season2026Id);
    expect(body.pairs).toEqual([]);
    expect(body.players).toEqual([]);
  });

  it('returns season-scoped pairing rows with player names attached', async () => {
    // Look up Carol by name (we don't keep the id around since other tests don't need it).
    const carolRow = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.name, 'Carol'))
      .get();
    const carolId = carolRow!.id;

    const [aLow, aHigh] = aliceId < bobId ? [aliceId, bobId] : [bobId, aliceId];
    const [bcLow, bcHigh] = bobId < carolId ? [bobId, carolId] : [carolId, bobId];
    await db.insert(pairingHistory).values([
      { seasonId: season2026Id, playerAId: aLow, playerBId: aHigh, pairCount: 4 },
      { seasonId: season2026Id, playerAId: bcLow, playerBId: bcHigh, pairCount: 1 },
    ]);

    const res = await pairingHistoryApp.request(
      `/pairing-history?seasonId=${season2026Id}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      season: { id: number };
      players: { id: number; name: string }[];
      pairs: { playerAId: number; playerBId: number; pairCount: number }[];
    };
    expect(body.season.id).toBe(season2026Id);
    expect(body.pairs).toHaveLength(2);
    const names = body.players.map((p) => p.name).sort();
    expect(names).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('does not leak pairs from other seasons', async () => {
    const [aLow, aHigh] = aliceId < bobId ? [aliceId, bobId] : [bobId, aliceId];
    await db.insert(pairingHistory).values([
      { seasonId: season2025Id, playerAId: aLow, playerBId: aHigh, pairCount: 7 },
    ]);

    const res = await pairingHistoryApp.request(
      `/pairing-history?seasonId=${season2026Id}`,
    );
    const body = (await res.json()) as {
      pairs: unknown[];
      players: unknown[];
    };
    expect(body.pairs).toEqual([]);
    expect(body.players).toEqual([]);
  });

  it('returns 400 for an invalid seasonId param', async () => {
    const res = await pairingHistoryApp.request('/pairing-history?seasonId=not-a-number');
    expect(res.status).toBe(400);
  });

  it('returns 404 for a seasonId that does not exist', async () => {
    const res = await pairingHistoryApp.request('/pairing-history?seasonId=999999');
    expect(res.status).toBe(404);
  });

  it('returns empty pairs (not 404) for a pre-2026 season — public empty-state path', async () => {
    const res = await pairingHistoryApp.request(
      `/pairing-history?seasonId=${season2025Id}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      season: { id: number };
      pairs: unknown[];
    };
    expect(body.season.id).toBe(season2025Id);
    expect(body.pairs).toEqual([]);
  });
});

