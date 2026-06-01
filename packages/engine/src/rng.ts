// ---------------------------------------------------------------------------
// Seedable PRNG (mulberry32) + weighted-index draw.
//
// The scouting odds line is a FROZEN report — given the same inputs (the field's
// prior rounds + the seed) every read must produce byte-identical odds. The
// engine's existing `shuffle.ts` uses bare `Math.random()` (non-seedable), so it
// cannot give that determinism. mulberry32 is a tiny, fast, well-distributed
// 32-bit PRNG seeded from a single integer (we seed from `roundId`).
//
// No `Math.random()` / `Date.now()` anywhere — that's the whole point.
// ---------------------------------------------------------------------------

/**
 * Returns a deterministic PRNG yielding floats in [0, 1), seeded from a single
 * 32-bit integer. Same seed ⇒ identical output sequence.
 *
 * Canonical mulberry32 (public domain). The seed is coerced to a u32.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draws an index in [0, weights.length) with probability proportional to each
 * weight, using one call to `rng`. Cumulative-weight (inverse-CDF) draw.
 *
 * Negative weights are treated as 0. If every weight is ≤ 0 (or the array is
 * empty-after-clamp), falls back to a uniform draw over all indices so callers
 * never get `-1`. Used by both the bootstrap resampler and the bettor allocation.
 */
export function pickWeightedIndex(rng: () => number, weights: readonly number[]): number {
  const n = weights.length;
  if (n === 0) return 0;
  let total = 0;
  for (const w of weights) total += w > 0 ? w : 0;
  if (total <= 0) {
    // Degenerate (all-zero) — uniform fallback so we never return -1.
    return Math.min(n - 1, Math.floor(rng() * n));
  }
  let r = rng() * total;
  for (let i = 0; i < n; i++) {
    const w = weights[i]! > 0 ? weights[i]! : 0;
    r -= w;
    if (r < 0) return i;
  }
  return n - 1; // float-rounding safety net
}
