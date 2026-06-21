import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeFoursome } from './compute-foursome.js';
import { ledgerToEdges } from './ledger-to-edges.js';
import type { FoursomeInput, GameConfig, HoleState, TeamSplit } from './types.js';

const teamSplit: TeamSplit = { teamA: ['a1', 'a2'], teamB: ['b1', 'b2'] };
const members = ['a1', 'a2', 'b1', 'b2'] as const;

/** A complete hole with random par + nets; holeNumber supplied by the caller (unique). */
function holeArb(holeNumber: number): fc.Arbitrary<HoleState> {
  const net = fc.integer({ min: 1, max: 9 });
  return fc.record({ par: fc.constantFrom(3, 4, 5), a1: net, a2: net, b1: net, b2: net }).map(
    (r): HoleState => ({
      holeNumber,
      par: r.par,
      net: { a1: r.a1, a2: r.a2, b1: r.b1, b2: r.b2 },
    }),
  );
}

const inputArb: fc.Arbitrary<FoursomeInput> = fc
  .integer({ min: 1, max: 9 })
  .chain((count) => fc.tuple(...Array.from({ length: count }, (_, i) => holeArb(i + 1))))
  .map((holes) => ({ teamSplit, holes }));

const configArb: fc.Arbitrary<GameConfig> = fc
  .record({ dollars: fc.integer({ min: 1, max: 20 }), netSkins: fc.boolean() })
  .map(({ dollars, netSkins }) => ({
    game: 'guyan-2v2',
    pointValueSchedule: { kind: 'flat', cents: dollars * 100 } as const,
    modifiers: netSkins
      ? [{ type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single' } as const }]
      : [],
    lockState: 'locked' as const,
    configVersion: 1,
  }));

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
});
