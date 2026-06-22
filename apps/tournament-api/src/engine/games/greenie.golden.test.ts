import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeFoursome } from './compute-foursome.js';
import { ledgerToEdges } from './ledger-to-edges.js';
import type { FoursomeInput, GameConfig, HoleState, SettlementEdge, TeamSplit } from './types.js';

type GoldenFixture = {
  input: { config: GameConfig; teamSplit: TeamSplit; holes: HoleState[]; sourceId: string };
  expected: { perPlayerNetCents: Record<string, number>; edges: SettlementEdge[]; ledgerTotalCents: number };
};

const here = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): GoldenFixture {
  return JSON.parse(readFileSync(join(here, '__fixtures__', name), 'utf8')) as GoldenFixture;
}

// Hand-approved at the Story 2.2 spec gate (NFR-C1). Edge IR is the post-2.1a
// whole-dollar 1-to-1 layout; per-player nets + totals are the approved values.
const FIXTURES = [
  'greenie-carryover-on.json',
  'greenie-carryover-off.json',
  'greenie-two-on-one-hole.json',
];

describe('greenie golden fixtures (hand-approved 2026-06-22)', () => {
  for (const name of FIXTURES) {
    it(`matches ${name}`, () => {
      const fx = loadFixture(name);
      const config: GameConfig = fx.input.config;
      const input: FoursomeInput = { teamSplit: fx.input.teamSplit, holes: fx.input.holes };

      const ledger = computeFoursome(config, input);
      expect(ledger.perPlayerCents).toEqual(fx.expected.perPlayerNetCents);
      expect(ledger.totalCents).toBe(fx.expected.ledgerTotalCents);

      const edges = ledgerToEdges(ledger, fx.input.teamSplit, { sourceId: fx.input.sourceId });
      expect(edges).toEqual(fx.expected.edges);
    });
  }
});
