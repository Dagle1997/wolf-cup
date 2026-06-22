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

// Hand-approved (count-only after Story 2.4a stripped the bogey-or-better gate;
// the gated polie-bogey-or-better.json was removed). Edge IR = post-2.1a
// whole-dollar 1-to-1; per-player nets + totals are the approved values.
const FIXTURES = ['polie-anything.json', 'polie-counts-regardless.json', 'polie-all-push.json'];

describe('polie golden fixtures (hand-approved 2026-06-22)', () => {
  for (const name of FIXTURES) {
    it(`matches ${name}`, () => {
      const fx = loadFixture(name);
      const input: FoursomeInput = { teamSplit: fx.input.teamSplit, holes: fx.input.holes };

      const ledger = computeFoursome(fx.input.config, input);
      expect(ledger.perPlayerCents).toEqual(fx.expected.perPlayerNetCents);
      expect(ledger.totalCents).toBe(fx.expected.ledgerTotalCents);

      const edges = ledgerToEdges(ledger, fx.input.teamSplit, { sourceId: fx.input.sourceId });
      expect(edges).toEqual(fx.expected.edges);
    });
  }

  it('AC1(iv) order-independence: polie-anything with holes REVERSED is byte-identical (stateless, NFR-C6)', () => {
    const fx = loadFixture('polie-anything.json');
    const forward = computeFoursome(fx.input.config, { teamSplit: fx.input.teamSplit, holes: fx.input.holes });
    const reversed = computeFoursome(fx.input.config, {
      teamSplit: fx.input.teamSplit,
      holes: [...fx.input.holes].reverse(),
    });
    expect(reversed.perPlayerCents).toEqual(forward.perPlayerCents);
    expect(reversed.cross).toEqual(forward.cross);
    expect(reversed.totalCents).toBe(forward.totalCents);
  });
});
