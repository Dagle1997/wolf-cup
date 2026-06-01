import { describe, it, expect } from 'vitest';
import { mulberry32, pickWeightedIndex } from './rng.js';

describe('mulberry32', () => {
  // Committed seed→first-N-outputs vector. If mulberry32's implementation ever
  // drifts, this breaks — which is the point: the frozen odds report depends on
  // this exact byte sequence. Generated once from `mulberry32(42)`.
  it('matches the committed seed=42 output vector', () => {
    const rng = mulberry32(42);
    const got = Array.from({ length: 8 }, () => rng());
    expect(got).toEqual([
      0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693,
      0.17481389874592423, 0.5265925421845168, 0.2732279943302274, 0.6247446539346129,
    ]);
  });

  it('is deterministic — same seed yields the same sequence', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 50; i++) expect(a()).toBe(b());
  });

  it('different seeds diverge', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it('yields floats in [0, 1)', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 1000; i++) {
      const x = rng();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('is roughly uniform across deciles (sanity, not a strict statistical test)', () => {
    const rng = mulberry32(12345);
    const n = 200_000;
    const buckets = new Array(10).fill(0);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = rng();
      sum += x;
      buckets[Math.min(9, Math.floor(x * 10))]++;
    }
    expect(sum / n).toBeGreaterThan(0.49);
    expect(sum / n).toBeLessThan(0.51);
    // every decile within ±5% of the expected n/10
    for (const b of buckets) {
      expect(b).toBeGreaterThan((n / 10) * 0.95);
      expect(b).toBeLessThan((n / 10) * 1.05);
    }
  });
});

describe('pickWeightedIndex', () => {
  it('always picks the only positive-weight index', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 20; i++) {
      expect(pickWeightedIndex(rng, [0, 5, 0])).toBe(1);
    }
  });

  it('respects weight proportions (heavier weight drawn more often)', () => {
    const rng = mulberry32(55);
    const counts = [0, 0];
    for (let i = 0; i < 10_000; i++) {
      const idx = pickWeightedIndex(rng, [3, 1]);
      counts[idx] = (counts[idx] ?? 0) + 1;
    }
    // index 0 should win ~75% of the time
    expect(counts[0] ?? 0).toBeGreaterThan((counts[1] ?? 0) * 2);
  });

  it('falls back to a uniform draw when all weights are zero (never returns -1)', () => {
    const rng = mulberry32(8);
    for (let i = 0; i < 100; i++) {
      const idx = pickWeightedIndex(rng, [0, 0, 0]);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(3);
    }
  });

  it('treats negative weights as zero', () => {
    const rng = mulberry32(8);
    for (let i = 0; i < 20; i++) {
      expect(pickWeightedIndex(rng, [-5, 2, -1])).toBe(1);
    }
  });
});
