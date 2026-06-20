/**
 * NFR-C4 ledger invariant — property test (fast-check).
 *
 * netPairwise must conserve every player's balance and never emit a pair in
 * both directions; zero-sum pairs net to zero. This is the "void/adjust leaves
 * settle-up consistent" guarantee, exercised against random edge lists.
 */
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { netPairwise, type PairwiseDebt } from './settlement-edge.js';
import type { SettlementEdge } from './types.js';

const PLAYERS = ['p0', 'p1', 'p2', 'p3', 'p4'];

/** Per-player net balance: received − paid. */
function balances(edges: ReadonlyArray<{ fromPlayerId: string; toPlayerId: string; cents: number }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of edges) {
    m.set(e.fromPlayerId, (m.get(e.fromPlayerId) ?? 0) - e.cents);
    m.set(e.toPlayerId, (m.get(e.toPlayerId) ?? 0) + e.cents);
  }
  return m;
}

const edgeArb: fc.Arbitrary<SettlementEdge> = fc
  .tuple(
    fc.integer({ min: 0, max: PLAYERS.length - 1 }),
    fc.integer({ min: 1, max: PLAYERS.length - 1 }), // offset → guarantees from ≠ to
    fc.integer({ min: 0, max: 100_000 }),
  )
  .map(([a, off, cents]) => ({
    fromPlayerId: PLAYERS[a]!,
    toPlayerId: PLAYERS[(a + off) % PLAYERS.length]!,
    cents,
    sourceBetId: 'bet',
    sourceType: 'h2h',
  }));

describe('netPairwise — ledger invariant (NFR-C4)', () => {
  test('conserves balances, one direction per pair, positive cents', () => {
    fc.assert(
      fc.property(fc.array(edgeArb, { maxLength: 40 }), (edges) => {
        const netted = netPairwise(edges);
        // 1. Per-player balance preserved.
        const raw = balances(edges);
        const net = balances(netted);
        for (const p of PLAYERS) {
          expect(net.get(p) ?? 0).toBe(raw.get(p) ?? 0);
        }
        // 2. At most one edge per unordered pair; 3. positive integer cents.
        const seen = new Set<string>();
        for (const d of netted) {
          const key = [d.fromPlayerId, d.toPlayerId].sort().join('|');
          expect(seen.has(key)).toBe(false);
          seen.add(key);
          expect(d.cents).toBeGreaterThan(0);
          expect(Number.isInteger(d.cents)).toBe(true);
        }
      }),
    );
  });

  test('zero-sum pair nets to zero', () => {
    const edges: SettlementEdge[] = [
      { fromPlayerId: 'a', toPlayerId: 'b', cents: 5000, sourceBetId: 'b1', sourceType: 'h2h' },
      { fromPlayerId: 'b', toPlayerId: 'a', cents: 5000, sourceBetId: 'b2', sourceType: 'h2h' },
    ];
    expect(netPairwise(edges)).toEqual([]);
  });

  test('opposing flows net to the residual direction', () => {
    const edges: SettlementEdge[] = [
      { fromPlayerId: 'a', toPlayerId: 'b', cents: 5000, sourceBetId: 'b1', sourceType: 'h2h' },
      { fromPlayerId: 'b', toPlayerId: 'a', cents: 3000, sourceBetId: 'b2', sourceType: 'snake' },
    ];
    const expected: PairwiseDebt[] = [{ fromPlayerId: 'a', toPlayerId: 'b', cents: 2000 }];
    expect(netPairwise(edges)).toEqual(expected);
  });
});
