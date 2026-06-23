import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeFoursome } from './compute-foursome.js';
import type { FoursomeInput, GameConfig, HoleState, PerHoleMoney, TeamSplit } from './types.js';

/**
 * Story 3-3 per-hole money golden (hand-calc, JOSH-APPROVED 2026-06-23).
 *
 * Proves the engine's additive `Ledger.perHole` decomposition is correct AND
 * loss-less against the already-approved round totals: for every player,
 * Σ_holes perHole.perPlayerCents === ledger.perPlayerCents. The round-total
 * goldens (guyan-2v2.golden.test.ts etc.) stay byte-identical — this file only
 * asserts the NEW per-hole field + the signed loss-less invariant. It does NOT
 * assert any `Σ |…| === totalCents` relation (abs-of-round-sum ≠ sum-of-abs once
 * teams trade holes — see the base-flat scenario, which trades holes).
 */
type PerHoleGolden = {
  input: { config: GameConfig; teamSplit: TeamSplit; holes: HoleState[]; sourceId: string };
  expected: {
    perPlayerNetCents: Record<string, number>;
    ledgerTotalCents: number;
    perHole: PerHoleMoney[];
  };
};

const here = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): PerHoleGolden {
  return JSON.parse(readFileSync(join(here, '__fixtures__', name), 'utf8')) as PerHoleGolden;
}

const FIXTURES = ['perhole-money-base-flat.json', 'perhole-money-greenie-carryover.json'];

describe('per-hole money golden fixtures (Story 3-3, hand-approved 2026-06-23)', () => {
  for (const name of FIXTURES) {
    it(`per-hole rows match ${name}`, () => {
      const fx = loadFixture(name);
      const input: FoursomeInput = { teamSplit: fx.input.teamSplit, holes: fx.input.holes };
      const ledger = computeFoursome(fx.input.config, input);

      // 1) The new per-hole decomposition exactly matches the approved golden.
      expect(ledger.perHole).toEqual(fx.expected.perHole);

      // 2) Round totals unchanged (the approved ledger) — proves the per-hole
      //    record did not move the settlement.
      expect(ledger.perPlayerCents).toEqual(fx.expected.perPlayerNetCents);
      expect(ledger.totalCents).toBe(fx.expected.ledgerTotalCents);
    });

    it(`loss-less: Σ per-hole === round per-player, and round is zero-sum (${name})`, () => {
      const fx = loadFixture(name);
      const input: FoursomeInput = { teamSplit: fx.input.teamSplit, holes: fx.input.holes };
      const ledger = computeFoursome(fx.input.config, input);
      const perHole = ledger.perHole ?? [];

      const members = [
        ...fx.input.teamSplit.teamA,
        ...fx.input.teamSplit.teamB,
      ];

      // The ONE unconditionally-correct loss-less proof: signed per-player sum.
      for (const p of members) {
        const summed = perHole.reduce((acc, h) => acc + (h.perPlayerCents[p] ?? 0), 0);
        expect(summed).toBe(ledger.perPlayerCents[p]);
      }

      // Round zero-sum.
      const roundSum = members.reduce((acc, p) => acc + (ledger.perPlayerCents[p] ?? 0), 0);
      expect(roundSum).toBe(0);

      // Each row's per-player cents reconcile with its teamPointsA*pv (sanity on
      // the decomposition shape itself).
      for (const h of perHole) {
        expect(h.teamASignedPerPlayerCents).toBe(h.teamPointsA * h.pointValueCents);
        for (const a of fx.input.teamSplit.teamA) {
          expect(h.perPlayerCents[a]).toBe(h.teamASignedPerPlayerCents);
        }
        const expectedB =
          h.teamASignedPerPlayerCents === 0 ? 0 : -h.teamASignedPerPlayerCents;
        for (const b of fx.input.teamSplit.teamB) {
          expect(h.perPlayerCents[b]).toBe(expectedB);
        }
      }
    });
  }
});
