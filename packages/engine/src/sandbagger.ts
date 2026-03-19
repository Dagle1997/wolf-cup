import type { SandbaggerRoundInput, SandbaggerResult } from './types.js';

// ---------------------------------------------------------------------------
// Tier thresholds
// ---------------------------------------------------------------------------

export const MIN_ROUNDS_TIER1 = 4;
export const MIN_ROUNDS_TIER2 = 7;
export const MIN_ROUNDS_TIER3 = 11;
export const RATIO_TIER1 = 0.60;
export const RATIO_TIER2 = 0.71;
export const RATIO_TIER3 = 0.73;

// ---------------------------------------------------------------------------
// Sandbagger detection
// ---------------------------------------------------------------------------

/**
 * Computes how frequently a player beats their handicap.
 *
 * "Beats handicap" = USGA differential < handicapIndex.
 * Differential = (gross18 - courseRating) * 113 / slopeRating.
 *
 * A golfer beats their handicap ~20% of the time (USGA data).
 * Doing it 60%+ over 4+ rounds is a ~5% event — suspicious.
 */
export function calculateSandbaggerStatus(
  rounds: readonly SandbaggerRoundInput[],
): SandbaggerResult {
  if (rounds.length === 0) {
    return { beatsCount: 0, totalRounds: 0, ratio: 0, tier: 0 };
  }

  let beatsCount = 0;
  for (const r of rounds) {
    const differential = ((r.gross18 - r.courseRating) * 113) / r.slopeRating;
    if (differential < r.handicapIndex) {
      beatsCount++;
    }
  }

  const totalRounds = rounds.length;
  const ratio = beatsCount / totalRounds;

  let tier: 0 | 1 | 2 | 3 = 0;
  if (totalRounds >= MIN_ROUNDS_TIER3 && ratio >= RATIO_TIER3) {
    tier = 3;
  } else if (totalRounds >= MIN_ROUNDS_TIER2 && ratio >= RATIO_TIER2) {
    tier = 2;
  } else if (totalRounds >= MIN_ROUNDS_TIER1 && ratio >= RATIO_TIER1) {
    tier = 1;
  }

  return { beatsCount, totalRounds, ratio, tier };
}
