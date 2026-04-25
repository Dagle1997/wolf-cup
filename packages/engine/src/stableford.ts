import { calcCourseHandicap, type Tee } from './course.js';

/**
 * Returns the number of handicap strokes a player receives on a given hole.
 *
 * When `tee` is provided, the slope-adjusted USGA course handicap is computed
 * from the raw handicap index. Without `tee`, the first argument is treated as
 * an already-rounded course handicap (legacy; preserved for callers that pass
 * relative CH).
 */
export function getHandicapStrokes(handicapIndex: number, strokeIndex: number, tee?: Tee): number {
  const ch = tee !== undefined ? calcCourseHandicap(handicapIndex, tee) : Math.round(handicapIndex);
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
 */
export function calculateStablefordPoints(
  grossScore: number,
  handicapIndex: number,
  par: 3 | 4 | 5,
  strokeIndex: number,
  tee?: Tee,
): number {
  const strokes = getHandicapStrokes(handicapIndex, strokeIndex, tee);
  const netScore = grossScore - strokes;
  const netVsPar = netScore - par;

  if (netVsPar <= -3) return 5;
  if (netVsPar === -2) return 4;
  if (netVsPar === -1) return 3;
  if (netVsPar === 0) return 2;
  if (netVsPar === 1) return 1;
  return 0;
}
