import type { HarveyRoundInput, HarveyRoundResult, RoundType, HarveySeasonTotal } from './types.js';
import { validateHarveyTotal } from './validation.js';

// ---------------------------------------------------------------------------
// Internal helper: playoff multiplier
// ---------------------------------------------------------------------------

function getMultiplier(roundType: RoundType): number {
  if (roundType === 'playoff_r8') return 3;
  if (roundType === 'playoff_r4') return 8;
  return 1;
}

// ---------------------------------------------------------------------------
// Internal helper: rank-based Harvey Cup points with half-point tie splits
// ---------------------------------------------------------------------------

/**
 * Given an array of raw numeric scores, returns Harvey Cup points for each
 * player (indexed identically to the input).
 *
 * Rules:
 *   - Higher score = better rank = more points.
 *   - Rank 1 (best) = N points; Rank N (worst) = 1 point.
 *   - Ties: averaged across the positions they occupy (half-point splits).
 *   - Sum invariant: sum of all returned values = N×(N+1)/2.
 */
function rankScores(scores: readonly number[]): readonly number[] {
  const N = scores.length;
  if (N === 0) return [];

  // Pair each score with its original index, then sort descending.
  const indexed: Array<[number, number]> = scores.map((s, i) => [s, i]);
  indexed.sort((a, b) => b[0] - a[0]);

  const points = new Array<number>(N).fill(0);

  let pos = 0; // 0-indexed position in sorted order
  while (pos < N) {
    const currentScore = indexed[pos]?.[0];
    // Find how many players share this score (group size).
    let groupEnd = pos + 1;
    while (groupEnd < N && indexed[groupEnd]?.[0] === currentScore) {
      groupEnd++;
    }
    const groupSize = groupEnd - pos;
    // Points for positions pos+1 through pos+groupSize (1-indexed).
    // Point for 1-indexed position p = N + 1 − p = N − (p−1).
    // Average for this group = sum of (N − pos), (N − pos − 1), … across groupSize terms.
    // Sum = groupSize*N − (pos + pos+1 + ... + pos+groupSize-1)
    //     = groupSize*N − (groupSize*pos + groupSize*(groupSize-1)/2)
    const sumOfPoints = groupSize * N - (groupSize * pos + (groupSize * (groupSize - 1)) / 2);
    const avgPoints = sumOfPoints / groupSize;

    for (let g = pos; g < groupEnd; g++) {
      const origIdx = indexed[g]?.[1];
      if (origIdx !== undefined) {
        points[origIdx] = avgPoints;
      }
    }

    pos = groupEnd;
  }

  return points;
}

// ---------------------------------------------------------------------------
// Public: calculateHarveyPoints
// ---------------------------------------------------------------------------

/**
 * Computes Harvey Cup points for all players in a round.
 *
 * Points per category (regular): rank 1 (best) = N pts; rank N (worst) = 1 pt.
 * An optional bonus (extra points added to every player's score per category)
 * models the Wolf Cup group-size incentive — e.g. +8 for 4 players, +2 for 16.
 * Playoff rounds multiply each player's rank-based points by a round-type multiplier:
 *   - 'regular'    → ×1 (default)
 *   - 'playoff_r8' → ×3 (round-of-8 format)
 *   - 'playoff_r4' → ×8 (round-of-4 format)
 *
 * Ties are resolved by averaging the rank-points occupied (half-point splits).
 * Both categories (Stableford and money) are ranked independently.
 * Sum invariant per category: N×(N+1)/2 × multiplier + N × bonusPerPlayer.
 *
 * @throws {HarveySumViolationError} if the internal sum invariant is violated
 */
export function calculateHarveyPoints(
  players: readonly HarveyRoundInput[],
  roundType: RoundType = 'regular',
  bonusPerPlayer = 0,
): readonly HarveyRoundResult[] {
  const multiplier = getMultiplier(roundType);
  const stablefordScores = players.map(p => p.stableford);
  const moneyScores = players.map(p => p.money);

  const stablefordPoints = rankScores(stablefordScores).map(p => p * multiplier + bonusPerPlayer);
  const moneyPoints = rankScores(moneyScores).map(p => p * multiplier + bonusPerPlayer);

  const results: HarveyRoundResult[] = players.map((_, i) => ({
    stablefordPoints: stablefordPoints[i] ?? 0,
    moneyPoints: moneyPoints[i] ?? 0,
  }));

  validateHarveyTotal(results, players.length, multiplier, bonusPerPlayer);

  return results;
}

// ---------------------------------------------------------------------------
// Public: calculateSeasonTotal
// ---------------------------------------------------------------------------

/**
 * Computes a player's Harvey Cup season total.
 *
 * Regular rounds are subject to best-10-of-N drops. The top 10 rounds are
 * selected by their COMBINED (stableford + money) Harvey total — both
 * categories come from the same 10 rounds (not selected independently).
 * Playoff rounds are always counted in full and never dropped.
 */
export function calculateSeasonTotal(
  regularRounds: readonly HarveyRoundResult[],
  playoffRounds: readonly HarveyRoundResult[] = [],
): HarveySeasonTotal {
  const roundsPlayed = regularRounds.length;
  const roundsDropped = Math.max(0, roundsPlayed - 10);
  const kept = roundsPlayed - roundsDropped;

  // Sort rounds by combined (stableford + money) score descending, keep top `kept`.
  const keptRounds = [...regularRounds]
    .sort((a, b) => (b.stablefordPoints + b.moneyPoints) - (a.stablefordPoints + a.moneyPoints))
    .slice(0, kept);

  const regularStableford = keptRounds.reduce((sum, r) => sum + r.stablefordPoints, 0);
  const regularMoney = keptRounds.reduce((sum, r) => sum + r.moneyPoints, 0);

  const playoffStableford = playoffRounds.reduce((sum, r) => sum + r.stablefordPoints, 0);
  const playoffMoney = playoffRounds.reduce((sum, r) => sum + r.moneyPoints, 0);

  return {
    stableford: regularStableford + playoffStableford,
    money: regularMoney + playoffMoney,
    roundsPlayed,
    roundsDropped,
  };
}
