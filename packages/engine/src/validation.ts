import type { HoleMoneyResult, HarveyRoundResult } from './types.js';
import { ZeroSumViolationError, HarveySumViolationError } from './types.js';

/**
 * Asserts that every component of a HoleMoneyResult sums to exactly $0
 * across all four players.
 *
 * @throws {ZeroSumViolationError} if any component does not sum to zero
 */
export function validateZeroSum(result: HoleMoneyResult): void {
  const components = ['lowBall', 'skin', 'teamTotalOrBonus', 'blindWolf', 'bonusSkins', 'total'] as const;
  for (const component of components) {
    const sum = result[0][component] + result[1][component] + result[2][component] + result[3][component];
    if (sum !== 0) {
      throw new ZeroSumViolationError(component, sum);
    }
  }
}

/**
 * Validates that Harvey Cup point totals equal N×(N+1)/2×multiplier + N×bonusPerPlayer
 * for each category, where N = playerCount.
 *
 * @throws {HarveySumViolationError} if either category sum is wrong
 */
export function validateHarveyTotal(
  results: readonly HarveyRoundResult[],
  playerCount: number,
  multiplier = 1,
  bonusPerPlayer = 0,
): void {
  if (results.length !== playerCount) {
    throw new Error(
      `validateHarveyTotal: results.length (${results.length}) !== playerCount (${playerCount})`,
    );
  }
  const expectedSum = (playerCount * (playerCount + 1)) / 2 * multiplier + playerCount * bonusPerPlayer;

  let stablefordSum = 0;
  let moneySum = 0;
  for (const r of results) {
    stablefordSum += r.stablefordPoints;
    moneySum += r.moneyPoints;
  }

  if (stablefordSum !== expectedSum) {
    throw new HarveySumViolationError('stableford', stablefordSum, expectedSum);
  }
  if (moneySum !== expectedSum) {
    throw new HarveySumViolationError('money', moneySum, expectedSum);
  }
}
