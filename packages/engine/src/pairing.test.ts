import { describe, it, expect } from 'vitest';
import {
  suggestGroups,
  pairKey,
  groupCost,
  pairPenalty,
  groupPenaltyCost,
  maxPlayerRepeatLoad,
  REPEAT_PENALTY_EXP,
  type PairingMatrix,
} from './pairing.js';

/** Deterministic PRNG for reproducible engine tests (same one the replay uses). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('pairKey', () => {
  it('canonical order — lower ID first', () => {
    expect(pairKey(5, 3)).toBe('3-5');
    expect(pairKey(3, 5)).toBe('3-5');
    expect(pairKey(2, 2)).toBe('2-2');
  });
});

describe('groupCost', () => {
  it('sums all C(n,2) pair costs in a group', () => {
    const m: PairingMatrix = new Map([
      ['1-2', 3],
      ['1-3', 1],
      ['2-3', 2],
    ]);
    expect(groupCost(m, [1, 2, 3])).toBe(6);
  });

  it('returns 0 for unknown pairs', () => {
    const m: PairingMatrix = new Map();
    expect(groupCost(m, [10, 20, 30, 40])).toBe(0);
  });

  it('returns 0 for single-player group', () => {
    const m: PairingMatrix = new Map([['1-2', 5]]);
    expect(groupCost(m, [1])).toBe(0);
  });
});

describe('suggestGroups', () => {
  it('returns empty for no players', () => {
    const result = suggestGroups({ matrix: new Map(), playerIds: [] });
    expect(result.groups).toEqual([]);
    expect(result.remainder).toEqual([]);
    expect(result.totalCost).toBe(0);
  });

  it('4 players → 1 group', () => {
    const result = suggestGroups({ matrix: new Map(), playerIds: [1, 2, 3, 4] });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toHaveLength(4);
    expect([...result.groups[0]!].sort()).toEqual([1, 2, 3, 4]);
    expect(result.remainder).toEqual([]);
  });

  it('8 players → 2 groups of 4', () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8];
    const result = suggestGroups({ matrix: new Map(), playerIds: ids });
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]).toHaveLength(4);
    expect(result.groups[1]).toHaveLength(4);
    const allAssigned = [...result.groups[0]!, ...result.groups[1]!].sort((a: number, b: number) => a - b);
    expect(allAssigned).toEqual(ids);
  });

  it('12 players → 3 groups', () => {
    const ids = Array.from({ length: 12 }, (_, i) => i + 1);
    const result = suggestGroups({ matrix: new Map(), playerIds: ids });
    expect(result.groups).toHaveLength(3);
    for (const g of result.groups) expect(g).toHaveLength(4);
  });

  it('16 players → 4 groups', () => {
    const ids = Array.from({ length: 16 }, (_, i) => i + 1);
    const result = suggestGroups({ matrix: new Map(), playerIds: ids });
    expect(result.groups).toHaveLength(4);
    for (const g of result.groups) expect(g).toHaveLength(4);
  });

  it('5 players → 1 group of 4 + 1 remainder', () => {
    const ids = [1, 2, 3, 4, 5];
    const result = suggestGroups({ matrix: new Map(), playerIds: ids });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toHaveLength(4);
    expect(result.remainder).toHaveLength(1);
    // All 5 accounted for
    const all = [...result.groups[0]!, ...result.remainder].sort((a: number, b: number) => a - b);
    expect(all).toEqual(ids);
  });

  it('3 players → 0 groups, all remainder', () => {
    const result = suggestGroups({ matrix: new Map(), playerIds: [1, 2, 3] });
    expect(result.groups).toEqual([]);
    expect([...result.remainder].sort((a: number, b: number) => a - b)).toEqual([1, 2, 3]);
  });

  it('avoids repeated pairings when history exists', () => {
    // Players 1-8. Players 1&2 have played together a lot.
    const m: PairingMatrix = new Map([
      [pairKey(1, 2), 10],
      [pairKey(3, 4), 10],
    ]);
    const ids = [1, 2, 3, 4, 5, 6, 7, 8];

    // Run multiple times — the algorithm should consistently separate 1&2 and 3&4
    let separated = 0;
    const runs = 20;
    for (let i = 0; i < runs; i++) {
      const result = suggestGroups({ matrix: m, playerIds: ids });
      // Check that 1 and 2 are NOT in the same group
      const oneAndTwoSeparate = result.groups.every(
        (g) => !(g.includes(1) && g.includes(2)),
      );
      const threeAndFourSeparate = result.groups.every(
        (g) => !(g.includes(3) && g.includes(4)),
      );
      if (oneAndTwoSeparate && threeAndFourSeparate) separated++;
    }
    // Should separate high-cost pairs in most runs
    expect(separated).toBeGreaterThanOrEqual(runs * 0.8);
  });

  it('respects pinned players', () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8];
    const pins = new Map([[1, 0], [5, 1]]); // Player 1 in group 0, player 5 in group 1

    for (let i = 0; i < 10; i++) {
      const result = suggestGroups({ matrix: new Map(), playerIds: ids, pins });
      expect(result.groups[0]).toContain(1);
      expect(result.groups[1]).toContain(5);
    }
  });

  it('ignores invalid pin group indices', () => {
    const ids = [1, 2, 3, 4];
    const pins = new Map([[1, 99]]); // Invalid group index
    const result = suggestGroups({ matrix: new Map(), playerIds: ids, pins });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toHaveLength(4);
  });

  it('zero history → any valid partition accepted', () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8];
    const result = suggestGroups({ matrix: new Map(), playerIds: ids });
    expect(result.totalCost).toBe(0);
    expect(result.groups).toHaveLength(2);
  });

  it('totalCost reflects actual pair weights', () => {
    // 4 players, all pairs have cost 1 → C(4,2) = 6 pairs, cost = 6
    const m: PairingMatrix = new Map([
      [pairKey(1, 2), 1],
      [pairKey(1, 3), 1],
      [pairKey(1, 4), 1],
      [pairKey(2, 3), 1],
      [pairKey(2, 4), 1],
      [pairKey(3, 4), 1],
    ]);
    const result = suggestGroups({ matrix: m, playerIds: [1, 2, 3, 4] });
    expect(result.totalCost).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Convex repeat penalty + worst-player tie-break (minimize-max spec)
// ---------------------------------------------------------------------------

describe('pairPenalty', () => {
  it('is c² with penalty(0) = 0 (AC1 / AC2)', () => {
    expect(pairPenalty(0)).toBe(0);
    expect(pairPenalty(1)).toBe(1);
    expect(pairPenalty(2)).toBe(4);
    expect(pairPenalty(3)).toBe(9);
  });

  it('treats negative/zero counts as free', () => {
    expect(pairPenalty(-5)).toBe(0);
  });

  it('exponent is exposed as a named constant', () => {
    expect(REPEAT_PENALTY_EXP).toBe(2);
  });
});

describe('groupPenaltyCost', () => {
  it('sums the convex penalty over all C(n,2) pairs', () => {
    // (1,2)=2 → 4, (1,3)=1 → 1, (2,3)=0 → 0  ⇒ 5
    const m: PairingMatrix = new Map([
      [pairKey(1, 2), 2],
      [pairKey(1, 3), 1],
    ]);
    expect(groupPenaltyCost(m, [1, 2, 3])).toBe(5);
  });

  it('is 0 for a group with no history (AC2 — new pairings free)', () => {
    expect(groupPenaltyCost(new Map(), [10, 20, 30, 40])).toBe(0);
  });
});

describe('maxPlayerRepeatLoad', () => {
  it('returns the worst single player’s summed raw load with groupmates', () => {
    // group {1,2,3}: (1,2)=2,(1,3)=1,(2,3)=1
    //   player 1 load = 2+1 = 3 ; player 2 = 2+1 = 3 ; player 3 = 1+1 = 2 ⇒ max 3
    const m: PairingMatrix = new Map([
      [pairKey(1, 2), 2],
      [pairKey(1, 3), 1],
      [pairKey(2, 3), 1],
    ]);
    expect(maxPlayerRepeatLoad(m, [[1, 2, 3]])).toBe(3);
  });

  it('takes the max across all groups, raw counts (not convex)', () => {
    const m: PairingMatrix = new Map([
      [pairKey(1, 2), 1],
      [pairKey(4, 5), 10],
    ]);
    expect(maxPlayerRepeatLoad(m, [[1, 2, 3], [4, 5, 6]])).toBe(10);
  });

  it('is 0 when there is no shared history', () => {
    expect(maxPlayerRepeatLoad(new Map(), [[1, 2, 3, 4]])).toBe(0);
  });
});

describe('suggestGroups — convex penalty discriminates from raw (AC4)', () => {
  // Fixture (verified by exhaustive partition enumeration): every raw-minimum
  // partition has raw cost 2, but among them the convex cost is either 2 or 4.
  // A raw-sum engine is therefore INDIFFERENT; the convex engine must prefer
  // the convex-2 arrangement (which avoids co-grouping a count-2 pair).
  //   convex-2 optima: {1,2,3}|{4,5,6} and {1,3,4}|{2,5,6}
  //   convex-4 optima: {1,2,4}|{3,5,6} and {1,5,6}|{2,3,4}
  const m: PairingMatrix = new Map([
    [pairKey(1, 3), 1],
    [pairKey(1, 6), 2],
    [pairKey(2, 6), 1],
    [pairKey(3, 6), 2],
    [pairKey(4, 6), 1],
  ]);
  const ids = [1, 2, 3, 4, 5, 6];

  it('picks the lower-convex arrangement in the large majority of seeded runs', () => {
    let convexOptimal = 0;
    const runs = 50;
    for (let s = 1; s <= runs; s++) {
      const result = suggestGroups({ matrix: m, playerIds: ids, groupSize: 3, rng: mulberry32(s) });
      const convex = result.groups.reduce((sum, g) => sum + groupPenaltyCost(m, g), 0);
      if (convex === 2) convexOptimal++;
    }
    // Observed 45/50 for this implementation; a raw-indifferent engine would be
    // ~24/50. Threshold leaves margin for trivial heuristic variation.
    expect(convexOptimal).toBeGreaterThanOrEqual(35);
  });

  it('returns the RAW totalCost (not the penalty sum) on a count-2 fixture (AC3)', () => {
    // One group {1,2,3,4}, only (1,2)=2 has history → raw groupCost 2, convex 4.
    const m2: PairingMatrix = new Map([[pairKey(1, 2), 2]]);
    const result = suggestGroups({ matrix: m2, playerIds: [1, 2, 3, 4], rng: mulberry32(1) });
    expect(result.totalCost).toBe(2); // raw, NOT pairPenalty(2)=4
  });
});

describe('suggestGroups — worst-player tie-break (AC5)', () => {
  // Fixture (verified by exhaustive enumeration): the convex-minimum penalty is
  // 2, achieved by EXACTLY two partitions with identical raw cost (2) but
  // different worst-player load:
  //   {1,3,5}|{2,4,6}  → maxPlayerRepeatLoad 1   (protects the worst player)
  //   {1,3,6}|{2,4,5}  → maxPlayerRepeatLoad 2
  // The convex penalty alone is indifferent between them; only the tie-break
  // distinguishes. A penalty-only engine returns load-1 ~half the time.
  const m: PairingMatrix = new Map([
    [pairKey(1, 4), 2],
    [pairKey(2, 3), 1],
    [pairKey(2, 5), 1],
    [pairKey(3, 4), 2],
    [pairKey(3, 5), 1],
    [pairKey(4, 5), 1],
    [pairKey(4, 6), 1],
  ]);
  const ids = [1, 2, 3, 4, 5, 6];

  it('the two convex-optimal partitions tie on penalty + raw but differ on load', () => {
    const flat = (gs: number[][]) => gs;
    const lo = flat([[1, 3, 5], [2, 4, 6]]);
    const hi = flat([[1, 3, 6], [2, 4, 5]]);
    const pen = (gs: number[][]) => gs.reduce((s, g) => s + groupPenaltyCost(m, g), 0);
    const raw = (gs: number[][]) => gs.reduce((s, g) => s + groupCost(m, g), 0);
    expect(pen(lo)).toBe(pen(hi)); // tie on the optimized objective
    expect(raw(lo)).toBe(raw(hi)); // tie on the displayed cost too
    expect(maxPlayerRepeatLoad(m, lo)).toBe(1);
    expect(maxPlayerRepeatLoad(m, hi)).toBe(2);
  });

  it('prefers the lower worst-player-load assignment in a strong majority', () => {
    let minLoad = 0;
    const runs = 50;
    for (let s = 1; s <= runs; s++) {
      const result = suggestGroups({ matrix: m, playerIds: ids, groupSize: 3, rng: mulberry32(s) });
      if (maxPlayerRepeatLoad(m, result.groups as number[][]) === 1) minLoad++;
    }
    // Observed 41/50 with the tie-break; a penalty-only engine scores ~24/50.
    expect(minLoad).toBeGreaterThanOrEqual(30);
  });
});

describe('suggestGroups — determinism with injected rng (AC6)', () => {
  it('identical inputs + fixed seed → identical groups', () => {
    const m: PairingMatrix = new Map([
      [pairKey(1, 2), 3],
      [pairKey(3, 4), 2],
      [pairKey(5, 6), 1],
    ]);
    const ids = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = suggestGroups({ matrix: m, playerIds: ids, rng: mulberry32(12345) });
    const b = suggestGroups({ matrix: m, playerIds: ids, rng: mulberry32(12345) });
    expect(a.groups).toEqual(b.groups);
    expect(a.totalCost).toBe(b.totalCost);
    expect(a.remainder).toEqual(b.remainder);
  });
});
