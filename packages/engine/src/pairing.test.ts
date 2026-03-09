import { describe, it, expect } from 'vitest';
import { suggestGroups, pairKey, groupCost, type PairingMatrix } from './pairing.js';

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
