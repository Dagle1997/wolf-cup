/**
 * Returns the number of handicap strokes a player receives on a given hole.
 *
 * @param handicapIndex - Whole-number playing handicap (non-integers are rounded)
 * @param strokeIndex   - Hole stroke index, 1 (hardest) to 18 (easiest)
 */
export function getHandicapStrokes(handicapIndex: number, strokeIndex: number): number {
  const ch = Math.round(handicapIndex);
  const base = Math.floor(ch / 18);
  const extra = ch % 18;
  return base + (strokeIndex <= extra ? 1 : 0);
}

/**
 * Calculates Stableford points for a single hole.
 *
 * Points table (net score vs par):
 *   ≤ −3 → 5 (double eagle or better)
 *   −2   → 4 (eagle)
 *   −1   → 3 (birdie)
 *    0   → 2 (par)
 *   +1   → 1 (bogey)
 *   ≥ +2 → 0 (double bogey or worse)
 *
 * @param grossScore    - Player's actual strokes taken on the hole
 * @param handicapIndex - Whole-number playing handicap
 * @param par           - Hole par (3, 4, or 5)
 * @param strokeIndex   - Hole stroke index, 1 (hardest) to 18 (easiest)
 */
export function calculateStablefordPoints(
  grossScore: number,
  handicapIndex: number,
  par: 3 | 4 | 5,
  strokeIndex: number,
): number {
  const strokes = getHandicapStrokes(handicapIndex, strokeIndex);
  const netScore = grossScore - strokes;
  const netVsPar = netScore - par;

  if (netVsPar <= -3) return 5;
  if (netVsPar === -2) return 4;
  if (netVsPar === -1) return 3;
  if (netVsPar === 0) return 2;
  if (netVsPar === 1) return 1;
  return 0;
}
