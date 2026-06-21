import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { GameConfig } from '../engine/games/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

// FKs intentionally DISABLED: this is a writer-logic test using synthetic
// round_id / course_revision_id. FK integrity is enforced by the schema/migration
// (and exercised through the real round-start path in Story 1.4).
vi.mock('../db/index.js', async () => {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = OFF');
  return { client, db };
});

const { db, client } = await import('../db/index.js');
const { roundPins, rounds } = await import('../db/schema/index.js');
const { pinRound } = await import('./pin-round.js');

const TENANT = 'guyan';
const CTX = 'league:guyan-wolf-cup-friday';

const CONFIG_A: GameConfig = {
  game: 'guyan-2v2',
  pointValueSchedule: { kind: 'flat', cents: 500 },
  modifiers: [{ type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single' } }],
  lockState: 'locked',
  configVersion: 1,
};
const CONFIG_B: GameConfig = { ...CONFIG_A, pointValueSchedule: { kind: 'flat', cents: 1000 } };

function input(roundId: string, config: GameConfig, hi: number | typeof NaN = 10.5) {
  return {
    roundId,
    resolvedConfig: config,
    perPlayerHandicaps: { p1: { hi, ch: 12 }, p2: { hi: 8.2, ch: 9 } },
    courseRevisionId: 'crev-1',
    tee: 'Dye',
    seedRuleSetRevisionId: null,
    createdAt: 100,
  };
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
  // migrate may reset connection pragmas — ensure FKs stay off for synthetic
  // course_revision_id; the round rows below are seeded so the tenancy lookup
  // (pinRound copies tenant/context FROM the round, AC5) resolves.
  await client.execute('PRAGMA foreign_keys = OFF');
  for (const id of ['r-1', 'r-2', 'r-3']) {
    await db.insert(rounds).values({ id, holesToPlay: 18, createdAt: 1, tenantId: TENANT, contextId: CTX });
  }
});
beforeEach(async () => {
  await db.delete(roundPins);
});

describe('pinRound', () => {
  test('writes a pin (pinned=true) with all fields; team_composition defaults NULL', async () => {
    const res = await pinRound(db, input('r-1', CONFIG_A));
    expect(res.pinned).toBe(true);
    expect(res.row.roundId).toBe('r-1');
    expect(JSON.parse(res.row.resolvedConfigJson)).toEqual(CONFIG_A);
    expect(JSON.parse(res.row.perPlayerHandicapsJson)).toEqual({ p1: { hi: 10.5, ch: 12 }, p2: { hi: 8.2, ch: 9 } });
    expect(res.row.teamCompositionJson).toBeNull();
    expect(res.row.tenantId).toBe('guyan');

    const all = await db.select().from(roundPins);
    expect(all).toHaveLength(1);
  });

  test('is IMMUTABLE + idempotent: re-pin with DIFFERENT data is a no-op, first pin wins (AC11)', async () => {
    await pinRound(db, input('r-2', CONFIG_A, 10.5));
    const res2 = await pinRound(db, input('r-2', CONFIG_B, 30.0)); // different config + handicaps

    expect(res2.pinned).toBe(false);
    // Returned row is the ORIGINAL, unchanged.
    expect(JSON.parse(res2.row.resolvedConfigJson)).toEqual(CONFIG_A);
    expect(JSON.parse(res2.row.perPlayerHandicapsJson).p1.hi).toBe(10.5);

    // Still exactly one row, still the first pin's data.
    const all = await db.select().from(roundPins);
    expect(all).toHaveLength(1);
    expect(JSON.parse(all[0]!.resolvedConfigJson)).toEqual(CONFIG_A);
  });

  test('fails closed on an invalid resolved config', async () => {
    const bad = { ...CONFIG_A, game: 'wolf-9' } as GameConfig;
    await expect(pinRound(db, input('r-3', bad))).rejects.toThrow(/invalid resolved config/);
  });

  test('fails closed on a non-finite handicap (NaN)', async () => {
    await expect(pinRound(db, input('r-3', CONFIG_A, NaN))).rejects.toThrow(/invalid per-player handicaps/);
  });

  test('fails closed when the round does not exist (AC5 tenancy provenance)', async () => {
    await expect(pinRound(db, input('r-missing', CONFIG_A))).rejects.toThrow(/not found/);
  });

  test('persists the CANONICAL parsed config, stripping unknown keys is rejected by .strict()', async () => {
    // A config with an extra key fails closed at parse (strict) — never persisted.
    const withExtra = { ...CONFIG_A, bogusKey: 1 } as unknown as GameConfig;
    await expect(pinRound(db, input('r-1', withExtra))).rejects.toThrow(/invalid resolved config/);
  });
});
