import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  parseGameConfig,
  checkConfigColumnsConsistent,
  isLevel,
  isLockState,
} from '../../engine/games/config-schema.js';
import { validateResolvedConfig } from '../../engine/games/registry.js';
import type { GameConfig } from '../../engine/games/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../migrations');

vi.mock('../index.js', async () => {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

const { db } = await import('../index.js');
const { gameConfig } = await import('./index.js');

const TENANT = 'guyan';
const CTX = 'league:guyan-wolf-cup-friday';

const VALID: GameConfig = {
  game: 'guyan-2v2',
  pointValueSchedule: { kind: 'flat', cents: 500 },
  modifiers: [{ type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single' } }],
  lockState: 'locked',
  configVersion: 1,
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});
beforeEach(async () => {
  await db.delete(gameConfig);
});

describe('game_config schema', () => {
  test('insert + read round-trip with all columns', async () => {
    await db.insert(gameConfig).values({
      id: 'gc-1',
      level: 'event',
      refId: 'evt-1',
      configJson: JSON.stringify(VALID),
      seedRuleSetRevisionId: null,
      lockState: 'locked',
      configVersion: 1,
      createdAt: 1,
      updatedAt: 1,
      tenantId: TENANT,
      contextId: CTX,
    });
    const rows = await db.select().from(gameConfig);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.level).toBe('event');
    expect(JSON.parse(rows[0]!.configJson)).toEqual(VALID);
    expect(rows[0]!.tenantId).toBe('guyan');
  });

  test('UNIQUE(tenant, level, ref_id) rejects a duplicate', async () => {
    const base = {
      level: 'event',
      refId: 'evt-dup',
      configJson: JSON.stringify(VALID),
      seedRuleSetRevisionId: null,
      lockState: 'locked' as const,
      configVersion: 1,
      createdAt: 1,
      updatedAt: 1,
      tenantId: TENANT,
      contextId: CTX,
    };
    await db.insert(gameConfig).values({ id: 'gc-a', ...base });
    await expect(db.insert(gameConfig).values({ id: 'gc-b', ...base })).rejects.toThrow();
  });
});

describe('parseGameConfig — fail-closed write validation', () => {
  test('accepts the valid guyan-2v2 config', () => {
    expect(parseGameConfig(VALID).ok).toBe(true);
  });

  const REJECTS: Array<[string, unknown]> = [
    ['unknown game', { ...VALID, game: 'wolf-9' }],
    ['unknown modifier', { ...VALID, modifiers: [{ type: 'not-a-real-modifier', enabled: true }] }],
    ['too-new config_version', { ...VALID, configVersion: 2 }],
    ['odd point value', { ...VALID, pointValueSchedule: { kind: 'flat', cents: 501 } }],
    [
      'enabled gross net-skins variant',
      { ...VALID, modifiers: [{ type: 'net-skins', enabled: true, variant: { basis: 'gross', bonus: 'single' } }] },
    ],
    ['structurally malformed (missing game)', { pointValueSchedule: { kind: 'flat', cents: 500 }, modifiers: [], configVersion: 1 }],
    ['unknown key (.strict)', { ...VALID, bogusKey: 1 }],
  ];
  for (const [name, cfg] of REJECTS) {
    test(`rejects ${name}`, () => {
      expect(parseGameConfig(cfg).ok).toBe(false);
    });
  }
});

describe('Zod ↔ engine drift test (AC3) — identical verdicts on structurally-valid configs', () => {
  const CASES: Array<[string, GameConfig]> = [
    ['valid', VALID],
    ['unknown game', { ...VALID, game: 'wolf-9' }],
    ['unknown modifier', { ...VALID, modifiers: [{ type: 'not-a-real-modifier', enabled: true }] }],
    ['too-new version', { ...VALID, configVersion: 2 }],
    ['odd point value', { ...VALID, pointValueSchedule: { kind: 'flat', cents: 501 } }],
    [
      'gross variant',
      { ...VALID, modifiers: [{ type: 'net-skins', enabled: true, variant: { basis: 'gross', bonus: 'single' } }] },
    ],
  ];
  for (const [name, cfg] of CASES) {
    test(`agree on ${name}`, () => {
      const zod = parseGameConfig(cfg);
      const eng = validateResolvedConfig(cfg);
      expect(zod.ok).toBe(eng.ok);
      if (!zod.ok && !eng.ok) expect(zod.reason).toBe(eng.reason);
    });
  }
});

describe('checkConfigColumnsConsistent (AC1)', () => {
  test('matching columns pass', () => {
    expect(checkConfigColumnsConsistent({ lockState: 'locked', configVersion: 1 }, VALID).ok).toBe(true);
  });
  test('mismatched lock_state rejected', () => {
    const r = checkConfigColumnsConsistent({ lockState: 'unlocked', configVersion: 1 }, VALID);
    expect(r.ok).toBe(false);
  });
  test('mismatched config_version rejected', () => {
    const r = checkConfigColumnsConsistent({ lockState: 'locked', configVersion: 2 }, VALID);
    expect(r.ok).toBe(false);
  });
});

describe('enum guards', () => {
  test('isLevel / isLockState', () => {
    expect(isLevel('event')).toBe(true);
    expect(isLevel('foursome')).toBe(true);
    expect(isLevel('bogus')).toBe(false);
    expect(isLockState('locked')).toBe(true);
    expect(isLockState('bogus')).toBe(false);
  });
});
