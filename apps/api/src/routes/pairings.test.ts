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

import pairingsApp from './pairings.js';
import { db } from '../db/index.js';
import {
  seasons,
  rounds,
  groups,
  roundPlayers,
  players,
  sideGames,
} from '../db/schema.js';
import { migrate } from 'drizzle-orm/libsql/migrator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

let seasonId: number;
let roundId: number;
let groupId: number;
let p1Id: number;

beforeAll(async () => {
  await migrate(db, { migrationsFolder });

  const [season] = await db
    .insert(seasons)
    .values({
      name: 'pairings-test',
      year: 3030,
      startDate: '2030-01-01',
      endDate: '2030-12-31',
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
      status: 'scheduled',
      scheduledDate: '2030-04-26',
      tee: 'black',
      autoCalculateMoney: 1,
      handicapUpdatedAt: Date.now(),
      createdAt: Date.now(),
    })
    .returning({ id: rounds.id });
  roundId = round!.id;

  const [group] = await db
    .insert(groups)
    .values({ roundId, groupNumber: 1, battingOrder: null })
    .returning({ id: groups.id });
  groupId = group!.id;

  const [p1] = await db
    .insert(players)
    .values({ name: 'Alice', ghinNumber: null, isActive: 1, createdAt: Date.now() })
    .returning({ id: players.id });
  p1Id = p1!.id;

  await db.insert(roundPlayers).values({
    roundId,
    groupId,
    playerId: p1Id,
    handicapIndex: 10,
    isSub: 0,
  });
});

afterEach(async () => {
  await db.delete(sideGames).where(eq(sideGames.seasonId, seasonId));
});

describe('GET /pairings/:roundId — sideGame', () => {
  it('returns 200 with sideGame: null when no side games exist for season', async () => {
    const res = await pairingsApp.request(`/pairings/${roundId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sideGame: null };
    expect(body.sideGame).toBeNull();
  });

  it('returns sideGame when scheduledRoundIds includes this round', async () => {
    await db.insert(sideGames).values({
      seasonId,
      name: 'Closest to Pin',
      format: 'Closest tee shot on par 3s',
      calculationType: 'manual',
      scheduledRoundIds: JSON.stringify([roundId]),
      createdAt: Date.now(),
    });
    const res = await pairingsApp.request(`/pairings/${roundId}`);
    const body = (await res.json()) as {
      sideGame: { name: string; format: string; calculationType: string | null } | null;
    };
    expect(body.sideGame).not.toBeNull();
    expect(body.sideGame!.name).toBe('Closest to Pin');
    expect(body.sideGame!.format).toBe('Closest tee shot on par 3s');
    expect(body.sideGame!.calculationType).toBe('manual');
  });

  it('returns sideGame: null when rotation does not include this round', async () => {
    await db.insert(sideGames).values({
      seasonId,
      name: 'Most Skins',
      format: 'Lowest unique net score',
      calculationType: 'auto_skins',
      scheduledRoundIds: JSON.stringify([roundId + 999]),
      createdAt: Date.now(),
    });
    const res = await pairingsApp.request(`/pairings/${roundId}`);
    const body = (await res.json()) as { sideGame: null };
    expect(body.sideGame).toBeNull();
  });

  it('ignores malformed scheduledRoundIds JSON', async () => {
    await db.insert(sideGames).values({
      seasonId,
      name: 'Broken',
      format: 'x',
      scheduledRoundIds: 'not-json',
      createdAt: Date.now(),
    });
    const res = await pairingsApp.request(`/pairings/${roundId}`);
    const body = (await res.json()) as { sideGame: null };
    expect(body.sideGame).toBeNull();
  });

  it('returns sideGame: null when scheduledRoundIds is null', async () => {
    await db.insert(sideGames).values({
      seasonId,
      name: 'Not scheduled yet',
      format: 'x',
      scheduledRoundIds: null,
      createdAt: Date.now(),
    });
    const res = await pairingsApp.request(`/pairings/${roundId}`);
    const body = (await res.json()) as { sideGame: null };
    expect(body.sideGame).toBeNull();
  });

  it('returns 404 for unknown round', async () => {
    const res = await pairingsApp.request(`/pairings/${roundId + 9999}`);
    expect(res.status).toBe(404);
  });

  it('matches when scheduledRoundIds holds string IDs instead of numbers', async () => {
    await db.insert(sideGames).values({
      seasonId,
      name: 'String-IDs Game',
      format: 'Legacy data shape',
      calculationType: 'manual',
      scheduledRoundIds: JSON.stringify([String(roundId)]),
      createdAt: Date.now(),
    });
    const res = await pairingsApp.request(`/pairings/${roundId}`);
    const body = (await res.json()) as { sideGame: { name: string } | null };
    expect(body.sideGame).not.toBeNull();
    expect(body.sideGame!.name).toBe('String-IDs Game');
  });

  it('returns the lowest-id side game when multiple match the same round', async () => {
    const base = Date.now();
    const [a] = await db
      .insert(sideGames)
      .values({
        seasonId,
        name: 'First Scheduled',
        format: 'x',
        calculationType: 'manual',
        scheduledRoundIds: JSON.stringify([roundId]),
        createdAt: base,
      })
      .returning({ id: sideGames.id });
    const [b] = await db
      .insert(sideGames)
      .values({
        seasonId,
        name: 'Second Scheduled',
        format: 'y',
        calculationType: 'manual',
        scheduledRoundIds: JSON.stringify([roundId]),
        createdAt: base + 1,
      })
      .returning({ id: sideGames.id });
    expect(a!.id).toBeLessThan(b!.id);
    const res = await pairingsApp.request(`/pairings/${roundId}`);
    const body = (await res.json()) as { sideGame: { name: string } | null };
    expect(body.sideGame!.name).toBe('First Scheduled');
  });

  it('sideGame response contains only name, format, calculationType', async () => {
    await db.insert(sideGames).values({
      seasonId,
      name: 'Shape Check',
      format: 'z',
      calculationType: 'auto_skins',
      scheduledRoundIds: JSON.stringify([roundId]),
      createdAt: Date.now(),
    });
    const res = await pairingsApp.request(`/pairings/${roundId}`);
    const body = (await res.json()) as { sideGame: Record<string, unknown> | null };
    expect(body.sideGame).not.toBeNull();
    expect(Object.keys(body.sideGame!).sort()).toEqual(['calculationType', 'format', 'name']);
  });
});
