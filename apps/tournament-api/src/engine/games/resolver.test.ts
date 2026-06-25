import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveConfig, type LeveledConfigRow } from './resolver.js';
import type { PointValueSchedule } from './types.js';

type ResolverCase = {
  name: string;
  rows: LeveledConfigRow[];
  expected: {
    ok: boolean;
    reason?: string;
    pointValueCents?: number;
    netSkinsEnabled?: boolean;
    config?: { game: string; pointValueSchedule: PointValueSchedule; lockState: string; modifiers: unknown[]; configVersion: number };
  };
};

const here = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(
  readFileSync(join(here, '__fixtures__', 'cascade-resolver-lock-gate.json'), 'utf8'),
) as { cases: ResolverCase[] };

function flatCents(schedule: PointValueSchedule): number {
  return schedule.kind === 'flat' ? schedule.cents : -1;
}

describe('cascade resolver + lock gate', () => {
  for (const c of fx.cases) {
    it(c.name, () => {
      const result = resolveConfig(c.rows as LeveledConfigRow[]);

      if (c.expected.ok === false) {
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe(c.expected.reason);
        return;
      }

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      if (c.expected.pointValueCents !== undefined) {
        expect(flatCents(result.config.pointValueSchedule)).toBe(c.expected.pointValueCents);
      }
      if (c.expected.netSkinsEnabled !== undefined) {
        const m = result.config.modifiers.find((x) => x.type === 'net-skins');
        expect(!!m && m.enabled).toBe(c.expected.netSkinsEnabled);
      }
      if (c.expected.config !== undefined) {
        expect(result.config.game).toBe(c.expected.config.game);
        expect(result.config.pointValueSchedule).toEqual(c.expected.config.pointValueSchedule);
        expect(result.config.lockState).toBe(c.expected.config.lockState);
        expect(result.config.modifiers).toEqual(c.expected.config.modifiers);
        expect(result.config.configVersion).toBe(c.expected.config.configVersion);
      }
    });
  }
});

describe('applyOverridesWhenLocked — the pin-path lock bypass (Epic 6)', () => {
  const eventRow: LeveledConfigRow = {
    level: 'event',
    config: {
      game: 'guyan-2v2',
      pointValueSchedule: { kind: 'flat', cents: 500 },
      modifiers: [{ type: 'sandie', enabled: true }],
      lockState: 'locked',
      configVersion: 1,
    },
  };
  const foursomeRow: LeveledConfigRow = {
    level: 'foursome',
    config: {
      game: 'guyan-2v2',
      pointValueSchedule: { kind: 'flat', cents: 1000 }, // override the stake
      modifiers: [{ type: 'sandie', enabled: false }], // turn sandie OFF for this foursome
      lockState: 'locked',
      configVersion: 1,
    },
  };

  it('DEFAULT (locked): foursome override is IGNORED — event config wins', () => {
    const res = resolveConfig([eventRow, foursomeRow]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(flatCents(res.config.pointValueSchedule)).toBe(500); // event stake
    expect(res.config.modifiers.find((m) => m.type === 'sandie')!.enabled).toBe(true);
    expect(res.config.lockState).toBe('locked');
  });

  it('applyOverridesWhenLocked: foursome override APPLIES, but lockState stays the event value', () => {
    const res = resolveConfig([eventRow, foursomeRow], { applyOverridesWhenLocked: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(flatCents(res.config.pointValueSchedule)).toBe(1000); // foursome stake applied
    expect(res.config.modifiers.find((m) => m.type === 'sandie')!.enabled).toBe(false); // sandie off
    expect(res.config.lockState).toBe('locked'); // money exposure gate UNCHANGED
  });

  it('an UNLOCKED event applies overrides with or without the flag (no behavior change)', () => {
    const unlockedEvent: LeveledConfigRow = {
      ...eventRow,
      config: { ...eventRow.config, lockState: 'unlocked' },
    };
    const a = resolveConfig([unlockedEvent, foursomeRow]);
    const b = resolveConfig([unlockedEvent, foursomeRow], { applyOverridesWhenLocked: true });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(flatCents(a.config.pointValueSchedule)).toBe(1000);
    expect(flatCents(b.config.pointValueSchedule)).toBe(1000);
  });
});
