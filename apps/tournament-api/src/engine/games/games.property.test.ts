import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeFoursome } from './compute-foursome.js';
import { ledgerToEdges } from './ledger-to-edges.js';
import { greenieFold } from './modifiers/greenie.js';
import type { FoursomeInput, GameConfig, HoleClaims, Modifier, HoleState, TeamSplit } from './types.js';

const teamSplit: TeamSplit = { teamA: ['a1', 'a2'], teamB: ['b1', 'b2'] };
const members = ['a1', 'a2', 'b1', 'b2'] as const;

/**
 * A complete hole with random par + nets + random per-player greenie checkboxes
 * (Story 2.2). holeNumber supplied by the caller (unique). All four nets are
 * always present (complete), so the greenie barrier never trips in these
 * properties — every par-3 is settleable.
 */
function holeArb(holeNumber: number): fc.Arbitrary<HoleState> {
  const net = fc.integer({ min: 1, max: 9 });
  const box = fc.boolean();
  return fc
    .record({
      par: fc.constantFrom(3, 4, 5),
      a1: net, a2: net, b1: net, b2: net,
      ga1: box, ga2: box, gb1: box, gb2: box,
    })
    .map((r): HoleState => {
      const claims: Record<string, HoleClaims> = {};
      if (r.ga1) claims['a1'] = { greenie: true };
      if (r.ga2) claims['a2'] = { greenie: true };
      if (r.gb1) claims['b1'] = { greenie: true };
      if (r.gb2) claims['b2'] = { greenie: true };
      return {
        holeNumber,
        par: r.par,
        net: { a1: r.a1, a2: r.a2, b1: r.b1, b2: r.b2 },
        claims,
      };
    });
}

const inputArb: fc.Arbitrary<FoursomeInput> = fc
  .integer({ min: 1, max: 9 })
  .chain((count) => fc.tuple(...Array.from({ length: count }, (_, i) => holeArb(i + 1))))
  .map((holes) => ({ teamSplit, holes }));

const configArb: fc.Arbitrary<GameConfig> = fc
  .record({
    dollars: fc.integer({ min: 1, max: 20 }),
    netSkins: fc.boolean(),
    greenie: fc.boolean(),
    carryover: fc.boolean(),
  })
  .map(({ dollars, netSkins, greenie, carryover }) => {
    const modifiers: Modifier[] = [];
    if (netSkins) modifiers.push({ type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single' } });
    if (greenie) modifiers.push({ type: 'greenie', enabled: true, variant: { carryover } });
    return {
      game: 'guyan-2v2',
      pointValueSchedule: { kind: 'flat', cents: dollars * 100 } as const,
      modifiers,
      lockState: 'locked' as const,
      configVersion: 1,
    };
  });

describe('guyan-2v2 engine — money-correctness invariants (fast-check)', () => {
  it('order-independence: shuffling holes does not change the ledger (NFR-C6)', () => {
    fc.assert(
      fc.property(configArb, inputArb, (config, input) => {
        const a = computeFoursome(config, input);
        const reversed = computeFoursome(config, { ...input, holes: [...input.holes].reverse() });
        expect(reversed.perPlayerCents).toEqual(a.perPlayerCents);
        expect(reversed.cross).toEqual(a.cross);
      }),
    );
  });

  it('loss-less + zero-sum: per-player sums to 0; edges reconcile to the ledger (NFR-C3)', () => {
    fc.assert(
      fc.property(configArb, inputArb, (config, input) => {
        const ledger = computeFoursome(config, input);
        const sum = members.reduce((s, p) => s + ledger.perPlayerCents[p]!, 0);
        expect(sum).toBe(0);

        const edges = ledgerToEdges(ledger, teamSplit, { sourceId: 'p' });
        const edgeSum = edges.reduce((s, e) => s + e.cents, 0);
        expect(edgeSum).toBe(ledger.totalCents);

        // Edges reconstruct the per-player balances exactly.
        const fromEdges: Record<string, number> = { a1: 0, a2: 0, b1: 0, b2: 0 };
        for (const e of edges) {
          fromEdges[e.toPlayerId]! += e.cents;
          fromEdges[e.fromPlayerId]! -= e.cents;
        }
        expect(fromEdges).toEqual(ledger.perPlayerCents);
      }),
    );
  });

  it('foursome isolation: an unrelated foursome computation never moves this one (FR23)', () => {
    fc.assert(
      fc.property(configArb, inputArb, configArb, inputArb, (cA, iA, cB, iB) => {
        const first = computeFoursome(cA, iA);
        computeFoursome(cB, iB); // unrelated foursome between calls
        const second = computeFoursome(cA, iA);
        expect(second).toEqual(first);
      }),
    );
  });

  // Greenie carryover-pot conservation (Story 2.2, NFR-C3). Made non-tautological
  // by computing both sides INDEPENDENTLY: the LHS reads the fold's surfaced state
  // (pointsByHole + finalCarryPoints); the RHS re-derives the expected total
  // directly from the raw input holes (rawA = #A−#B per par-3; zeroBoxes ⇒ 1).
  // Neither side is derived from the other → no `finalCarry = count − sum`
  // tautology. Proves the carry mechanism creates and loses no points.
  it('carryover conservation (greenie ON, carryover ON): Σ|pointsByHole| + finalCarry === Σ_settleablePar3(zeroBoxes ? 1 : |#A−#B|)', () => {
    const greenieOnConfigArb: fc.Arbitrary<GameConfig> = fc
      .integer({ min: 1, max: 20 })
      .map((dollars) => ({
        game: 'guyan-2v2',
        pointValueSchedule: { kind: 'flat', cents: dollars * 100 } as const,
        modifiers: [{ type: 'greenie', enabled: true, variant: { carryover: true } as const }],
        lockState: 'locked' as const,
        configVersion: 1,
      }));

    fc.assert(
      fc.property(greenieOnConfigArb, inputArb, (config, input) => {
        const fold = greenieFold(config, input.holes, teamSplit);

        // LHS — from the fold's surfaced state.
        let lhs = fold.finalCarryPoints;
        for (const v of fold.pointsByHole.values()) lhs += Math.abs(v);

        // RHS — re-derived from raw inputs over the settleable prefix (the first
        // `settleablePar3Count` par-3s in holeNumber order; all complete here).
        const par3s = [...input.holes]
          .filter((h) => h.par === 3)
          .sort((a, b) => a.holeNumber - b.holeNumber)
          .slice(0, fold.settleablePar3Count);
        let rhs = 0;
        for (const h of par3s) {
          const countA = (h.claims?.['a1']?.greenie === true ? 1 : 0) + (h.claims?.['a2']?.greenie === true ? 1 : 0);
          const countB = (h.claims?.['b1']?.greenie === true ? 1 : 0) + (h.claims?.['b2']?.greenie === true ? 1 : 0);
          rhs += countA === 0 && countB === 0 ? 1 : Math.abs(countA - countB);
        }

        expect(lhs).toBe(rhs);
        expect(fold.finalCarryPoints).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});
