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
  const gross = fc.integer({ min: 1, max: 12 });
  const box = fc.boolean();
  return fc
    .record({
      par: fc.constantFrom(3, 4, 5),
      a1: net, a2: net, b1: net, b2: net,
      ga1: box, ga2: box, gb1: box, gb2: box, // greenie boxes (2.2)
      pa1: box, pa2: box, pb1: box, pb2: box, // polie boxes (2.3)
      sa1: box, sa2: box, sb1: box, sb2: box, // sandie boxes (2.4)
      xa1: gross, xa2: gross, xb1: gross, xb2: gross, // gross (2.3 — polie gate)
    })
    .map((r): HoleState => {
      const claims: Record<string, HoleClaims> = {};
      const set = (p: string, k: 'greenie' | 'polie' | 'sandie') => {
        claims[p] = { ...(claims[p] ?? {}), [k]: true };
      };
      if (r.ga1) set('a1', 'greenie');
      if (r.ga2) set('a2', 'greenie');
      if (r.gb1) set('b1', 'greenie');
      if (r.gb2) set('b2', 'greenie');
      if (r.pa1) set('a1', 'polie');
      if (r.pa2) set('a2', 'polie');
      if (r.pb1) set('b1', 'polie');
      if (r.pb2) set('b2', 'polie');
      if (r.sa1) set('a1', 'sandie');
      if (r.sa2) set('a2', 'sandie');
      if (r.sb1) set('b1', 'sandie');
      if (r.sb2) set('b2', 'sandie');
      return {
        holeNumber,
        par: r.par,
        net: { a1: r.a1, a2: r.a2, b1: r.b1, b2: r.b2 },
        gross: { a1: r.xa1, a2: r.xa2, b1: r.xb1, b2: r.xb2 },
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
    polie: fc.boolean(),
    sandie: fc.boolean(),
  })
  .map(({ dollars, netSkins, greenie, carryover, polie, sandie }) => {
    const modifiers: Modifier[] = [];
    if (netSkins) modifiers.push({ type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single' } });
    if (greenie) modifiers.push({ type: 'greenie', enabled: true, variant: { carryover } });
    if (polie) modifiers.push({ type: 'polie', enabled: true }); // no lever (Story 2.4a)
    if (sandie) modifiers.push({ type: 'sandie', enabled: true }); // no lever
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

  // Polie additivity (Story 2.3, NFR-C3/C6). Non-tautological: LHS from the engine
  // ledger, RHS re-derived independently from the raw inputs. Constrained to
  // POLIE-ONLY config + FLAT PV + gate OFF + nets=par (base 0) so a single `cents`
  // constant is exact and polie is the only money. Asserts ALL FOUR per-player
  // cents (so a within-team misallocation can't hide) + shuffle invariance.
  it('polie additivity (polie-only, flat PV, gate off, nets=par): perPlayer === cents * Σ(#A−#B), shuffle-invariant', () => {
    const polieOnlyArb: fc.Arbitrary<GameConfig> = fc
      .integer({ min: 1, max: 20 })
      .map((dollars) => ({
        game: 'guyan-2v2',
        pointValueSchedule: { kind: 'flat', cents: dollars * 100 } as const,
        modifiers: [{ type: 'polie', enabled: true }],
        lockState: 'locked' as const,
        configVersion: 1,
      }));

    // par-fixed holes with nets=par (base 0) + random polie boxes; gross irrelevant (gate off).
    function polieHoleArb(holeNumber: number): fc.Arbitrary<HoleState> {
      const box = fc.boolean();
      return fc
        .record({ par: fc.constantFrom(3, 4, 5), pa1: box, pa2: box, pb1: box, pb2: box })
        .map((r): HoleState => {
          const claims: Record<string, HoleClaims> = {};
          if (r.pa1) claims['a1'] = { polie: true };
          if (r.pa2) claims['a2'] = { polie: true };
          if (r.pb1) claims['b1'] = { polie: true };
          if (r.pb2) claims['b2'] = { polie: true };
          const par = r.par;
          return { holeNumber, par, net: { a1: par, a2: par, b1: par, b2: par }, claims };
        });
    }
    const polieInputArb = fc
      .integer({ min: 1, max: 9 })
      .chain((count) => fc.tuple(...Array.from({ length: count }, (_, i) => polieHoleArb(i + 1))))
      .map((holes) => ({ teamSplit, holes }));

    fc.assert(
      fc.property(polieOnlyArb, polieInputArb, (config, input) => {
        const cents = (config.pointValueSchedule as { kind: 'flat'; cents: number }).cents;
        // RHS: independently summed signed polie points from the raw inputs.
        let sum = 0;
        for (const h of input.holes) {
          const a = (h.claims?.['a1']?.polie === true ? 1 : 0) + (h.claims?.['a2']?.polie === true ? 1 : 0);
          const b = (h.claims?.['b1']?.polie === true ? 1 : 0) + (h.claims?.['b2']?.polie === true ? 1 : 0);
          sum += a - b;
        }
        const ledger = computeFoursome(config, input);
        const expectedA = cents * sum;
        // `-expectedA || 0` normalizes JS negative zero (−0) to +0 so toBe's
        // Object.is comparison matches the engine's +0 when sum === 0.
        const expectedB = -expectedA || 0;
        expect(ledger.perPlayerCents['a1']).toBe(expectedA);
        expect(ledger.perPlayerCents['a2']).toBe(expectedA);
        expect(ledger.perPlayerCents['b1']).toBe(expectedB);
        expect(ledger.perPlayerCents['b2']).toBe(expectedB);

        // Shuffle invariance (stateless).
        const reversed = computeFoursome(config, { ...input, holes: [...input.holes].reverse() });
        expect(reversed.perPlayerCents).toEqual(ledger.perPlayerCents);
        expect(reversed.cross).toEqual(ledger.cross);
      }),
    );
  });

  // Sandie additivity (Story 2.4). Non-tautological: LHS engine ledger, RHS
  // re-derived from raw inputs. sandie-only + flat PV + nets=par isolates sandie.
  it('sandie additivity (sandie-only, flat PV, nets=par): perPlayer === ±cents * Σ(#A−#B), shuffle-invariant', () => {
    const sandieOnlyArb: fc.Arbitrary<GameConfig> = fc
      .integer({ min: 1, max: 20 })
      .map((dollars) => ({
        game: 'guyan-2v2',
        pointValueSchedule: { kind: 'flat', cents: dollars * 100 } as const,
        modifiers: [{ type: 'sandie', enabled: true }],
        lockState: 'locked' as const,
        configVersion: 1,
      }));

    function sandieHoleArb(holeNumber: number): fc.Arbitrary<HoleState> {
      const box = fc.boolean();
      return fc
        .record({ par: fc.constantFrom(3, 4, 5), sa1: box, sa2: box, sb1: box, sb2: box })
        .map((r): HoleState => {
          const claims: Record<string, HoleClaims> = {};
          if (r.sa1) claims['a1'] = { sandie: true };
          if (r.sa2) claims['a2'] = { sandie: true };
          if (r.sb1) claims['b1'] = { sandie: true };
          if (r.sb2) claims['b2'] = { sandie: true };
          const par = r.par;
          return { holeNumber, par, net: { a1: par, a2: par, b1: par, b2: par }, claims };
        });
    }
    const sandieInputArb = fc
      .integer({ min: 1, max: 9 })
      .chain((count) => fc.tuple(...Array.from({ length: count }, (_, i) => sandieHoleArb(i + 1))))
      .map((holes) => ({ teamSplit, holes }));

    fc.assert(
      fc.property(sandieOnlyArb, sandieInputArb, (config, input) => {
        const cents = (config.pointValueSchedule as { kind: 'flat'; cents: number }).cents;
        let sum = 0;
        for (const h of input.holes) {
          const a = (h.claims?.['a1']?.sandie === true ? 1 : 0) + (h.claims?.['a2']?.sandie === true ? 1 : 0);
          const b = (h.claims?.['b1']?.sandie === true ? 1 : 0) + (h.claims?.['b2']?.sandie === true ? 1 : 0);
          sum += a - b;
        }
        const ledger = computeFoursome(config, input);
        const expectedA = cents * sum;
        const expectedB = -expectedA || 0; // normalize −0 to +0 for Object.is
        expect(ledger.perPlayerCents['a1']).toBe(expectedA);
        expect(ledger.perPlayerCents['a2']).toBe(expectedA);
        expect(ledger.perPlayerCents['b1']).toBe(expectedB);
        expect(ledger.perPlayerCents['b2']).toBe(expectedB);

        const reversed = computeFoursome(config, { ...input, holes: [...input.holes].reverse() });
        expect(reversed.perPlayerCents).toEqual(ledger.perPlayerCents);
        expect(reversed.cross).toEqual(ledger.cross);
      }),
    );
  });
});
