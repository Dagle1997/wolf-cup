import { describe, it, expect } from 'vitest';
import { shuffle } from './shuffle.js';

describe('shuffle (Fisher–Yates)', () => {
  it('returns a permutation containing exactly the same elements', () => {
    const input = [10, 20, 30, 40];
    const out = shuffle(input);
    expect(out).toHaveLength(input.length);
    expect([...out].sort((a, b) => a - b)).toEqual([10, 20, 30, 40]);
  });

  it('does not mutate the input', () => {
    const input = [1, 2, 3, 4];
    const copy = [...input];
    shuffle(input);
    expect(input).toEqual(copy);
  });

  it('handles empty and single-element arrays', () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle([7])).toEqual([7]);
  });

  // Regression guard: the old `sort(() => Math.random() - 0.5)` was heavily
  // biased (some positions ~39% vs the fair 25%). A uniform shuffle keeps every
  // source slot near 1/n at every position. If anyone reintroduces the biased
  // sort, these bounds blow out and this test fails.
  it('is uniform — each input slot lands at each position ~1/n of the time', () => {
    const N = 60000;
    const n = 4;
    const counts = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let k = 0; k < N; k++) {
      const r = shuffle([0, 1, 2, 3]);
      for (let pos = 0; pos < n; pos++) counts[r[pos]!]![pos]++;
    }
    const expected = N / n; // 15000
    // ~10+ std devs of slack; biased sort would produce cells far outside this.
    const lo = expected * 0.9;
    const hi = expected * 1.1;
    for (let slot = 0; slot < n; slot++) {
      for (let pos = 0; pos < n; pos++) {
        expect(counts[slot]![pos]).toBeGreaterThan(lo);
        expect(counts[slot]![pos]).toBeLessThan(hi);
      }
    }
  });
});
