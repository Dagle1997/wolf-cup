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
