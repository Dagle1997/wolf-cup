import { describe, it, expect } from 'vitest';
import { calculateHarveyPoints, calculateSeasonTotal } from './harvey.js';
import { validateHarveyTotal } from './validation.js';
import { HarveySumViolationError } from './types.js';
import type { HarveyRoundInput, HarveyRoundResult } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sp(results: readonly HarveyRoundResult[]): number[] {
  return results.map(r => r.stablefordPoints);
}

function mp(results: readonly HarveyRoundResult[]): number[] {
  return results.map(r => r.moneyPoints);
}

function sumOf(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

function inputs(pairs: readonly [number, number][]): HarveyRoundInput[] {
  return pairs.map(([stableford, money]) => ({ stableford, money }));
}

function rounds(pairs: readonly [number, number][]): HarveyRoundResult[] {
  return pairs.map(([stablefordPoints, moneyPoints]) => ({ stablefordPoints, moneyPoints }));
}

// ---------------------------------------------------------------------------
// No-tie baselines
// ---------------------------------------------------------------------------

describe('calculateHarveyPoints — no ties', () => {
  it('N=4: stableford scores [10,8,6,4] → points [4,3,2,1]', () => {
    const players = inputs([[10, 0], [8, 0], [6, 0], [4, 0]]);
    const results = calculateHarveyPoints(players);
    expect(sp(results)).toEqual([4, 3, 2, 1]);
  });

  it('N=4: money scores [-3,-1,1,3] → points [1,2,3,4] (highest = best)', () => {
    const players = inputs([[0, -3], [0, -1], [0, 1], [0, 3]]);
    const results = calculateHarveyPoints(players);
    expect(mp(results)).toEqual([1, 2, 3, 4]);
  });

  it('N=4: stableford sum = 10 = 4×5/2', () => {
    const players = inputs([[18, 3], [15, 1], [12, -1], [10, -3]]);
    const results = calculateHarveyPoints(players);
    expect(sumOf(sp(results))).toBe(10);
    expect(sumOf(mp(results))).toBe(10);
  });

  it('N=8 no-tie: 1st gets 8, 8th gets 1, sum=36', () => {
    const players = inputs([[80, 8], [70, 7], [60, 6], [50, 5], [40, 4], [30, 3], [20, 2], [10, 1]]);
    const results = calculateHarveyPoints(players);
    expect(sp(results)).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    expect(mp(results)).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    expect(sumOf(sp(results))).toBe(36);
  });

  it('N=16 no-tie: 1st gets 16, 16th gets 1, sum=136', () => {
    const players = inputs(
      Array.from({ length: 16 }, (_, i) => [16 - i, 16 - i] as [number, number]),
    );
    const results = calculateHarveyPoints(players);
    expect(sp(results)[0]).toBe(16);
    expect(sp(results)[15]).toBe(1);
    expect(sumOf(sp(results))).toBe(136);
    expect(sumOf(mp(results))).toBe(136);
  });
});

// ---------------------------------------------------------------------------
// Tie handling
// ---------------------------------------------------------------------------

describe('calculateHarveyPoints — ties', () => {
  it('2-way tie for 2nd/3rd (N=4): each gets 2.5; 1st gets 4; 4th gets 1; sum=10', () => {
    // Scores: [18, 15, 15, 10] — indices 1 and 2 tie for 2nd
    const players = inputs([[18, 3], [15, 1], [15, -1], [10, -3]]);
    const results = calculateHarveyPoints(players);
    expect(sp(results)).toEqual([4, 2.5, 2.5, 1]);
    expect(sumOf(sp(results))).toBe(10);
  });

  it('2-way tie for 2nd/3rd (N=4): money category correct', () => {
    // Money: [3, 1, 1, -3] — indices 1 and 2 tie for 2nd in money
    const players = inputs([[18, 3], [12, 1], [15, 1], [10, -3]]);
    const results = calculateHarveyPoints(players);
    // stableford: 18→4, 15→3, 12→2, 10→1
    expect(sp(results)).toEqual([4, 2, 3, 1]);
    // money: 3→4, 1→2.5 each, -3→1
    expect(mp(results)).toEqual([4, 2.5, 2.5, 1]);
    expect(sumOf(mp(results))).toBe(10);
  });

  it('3-way tie for 1st (N=4): each gets 3.0; 4th gets 1; sum=10', () => {
    const players = inputs([[20, 0], [20, 0], [20, 0], [10, 0]]);
    const results = calculateHarveyPoints(players);
    expect(sp(results)).toEqual([3, 3, 3, 1]);
    expect(sumOf(sp(results))).toBe(10);
  });

  it('4-way all-tie (N=4): everyone gets 2.5; sum=10', () => {
    const players = inputs([[10, 0], [10, 0], [10, 0], [10, 0]]);
    const results = calculateHarveyPoints(players);
    expect(sp(results)).toEqual([2.5, 2.5, 2.5, 2.5]);
    expect(sumOf(sp(results))).toBe(10);
  });

  it('2-way tie for last (N=4): tied players each get 1.5; 1st gets 4; 2nd gets 3; sum=10', () => {
    const players = inputs([[20, 0], [18, 0], [10, 0], [10, 0]]);
    const results = calculateHarveyPoints(players);
    expect(sp(results)).toEqual([4, 3, 1.5, 1.5]);
    expect(sumOf(sp(results))).toBe(10);
  });

  it('N=16 with 2-way tie for 3rd/4th: sum still = 136', () => {
    // Build scores where positions 3 and 4 tie (indices 2 and 3 both score 14)
    const scores: [number, number][] = [
      [16, 0], [15, 0], [14, 0], [14, 0], // 1st, 2nd, tied 3rd/4th
      [12, 0], [11, 0], [10, 0], [9, 0],
      [8, 0], [7, 0], [6, 0], [5, 0],
      [4, 0], [3, 0], [2, 0], [1, 0],
    ];
    const results = calculateHarveyPoints(inputs(scores));
    expect(sp(results)[0]).toBe(16);
    expect(sp(results)[1]).toBe(15);
    // 3rd and 4th: positions 3 and 4 → avg of (14+13)/2 = 13.5
    expect(sp(results)[2]).toBe(13.5);
    expect(sp(results)[3]).toBe(13.5);
    expect(sumOf(sp(results))).toBe(136);
  });

  it('all-zero stableford (N=4): each player gets 2.5; sum=10', () => {
    const players = inputs([[0, 0], [0, 0], [0, 0], [0, 0]]);
    const results = calculateHarveyPoints(players);
    expect(sp(results)).toEqual([2.5, 2.5, 2.5, 2.5]);
    expect(sumOf(sp(results))).toBe(10);
  });

  it('negative money scores with tie: correctly ranked and summed', () => {
    // Money: [-1, -1, -3, -5] — indices 0 and 1 tie for 1st (best = least negative)
    const players = inputs([[0, -1], [0, -1], [0, -3], [0, -5]]);
    const results = calculateHarveyPoints(players);
    // Tied 1st/2nd → avg (4+3)/2 = 3.5 each; 3rd→2; 4th→1
    expect(mp(results)).toEqual([3.5, 3.5, 2, 1]);
    expect(sumOf(mp(results))).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Both categories independent
// ---------------------------------------------------------------------------

describe('calculateHarveyPoints — independent categories', () => {
  it('player 1st in Stableford but 3rd in money → different points per category', () => {
    // Stableford: [18, 15, 12, 10] → [4, 3, 2, 1]
    // Money: [−2, 3, −1, 0] → sorted desc [3, 0, −1, −2] = players 1,3,2,0 → pts [1,4,2,3]
    const players = inputs([[18, -2], [15, 3], [12, -1], [10, 0]]);
    const results = calculateHarveyPoints(players);
    expect(sp(results)).toEqual([4, 3, 2, 1]);
    // money rank: player1=3→4pts, player3=0→3pts, player2=-1→2pts, player0=-2→1pt
    expect(mp(results)).toEqual([1, 4, 2, 3]);
    expect(sumOf(sp(results))).toBe(10);
    expect(sumOf(mp(results))).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('calculateHarveyPoints — edge cases', () => {
  it('N=1: single player gets 1 point in both categories', () => {
    const results = calculateHarveyPoints([{ stableford: 5, money: 3 }]);
    expect(sp(results)).toEqual([1]);
    expect(mp(results)).toEqual([1]);
  });

  it('N=2 no-tie: winner gets 2, loser gets 1; sum=3', () => {
    const results = calculateHarveyPoints([{ stableford: 10, money: 5 }, { stableford: 8, money: -5 }]);
    expect(sp(results)).toEqual([2, 1]);
    expect(mp(results)).toEqual([2, 1]);
    expect(sumOf(sp(results))).toBe(3);
  });

  it('N=2 all-tie: each gets 1.5; sum=3', () => {
    const results = calculateHarveyPoints([{ stableford: 10, money: 0 }, { stableford: 10, money: 0 }]);
    expect(sp(results)).toEqual([1.5, 1.5]);
    expect(mp(results)).toEqual([1.5, 1.5]);
  });

  it('N=0 empty array: returns empty array without throwing', () => {
    const results = calculateHarveyPoints([]);
    expect(results).toHaveLength(0);
  });

  it('N=20 no-tie: 1st gets 20, 20th gets 1, sum=210 (= 20×21/2)', () => {
    const players = inputs(
      Array.from({ length: 20 }, (_, i) => [20 - i, 20 - i] as [number, number]),
    );
    const results = calculateHarveyPoints(players);
    expect(sp(results)[0]).toBe(20);
    expect(sp(results)[19]).toBe(1);
    expect(sumOf(sp(results))).toBe(210);
    expect(sumOf(mp(results))).toBe(210);
  });
});

// ---------------------------------------------------------------------------
// validateHarveyTotal
// ---------------------------------------------------------------------------

describe('validateHarveyTotal', () => {
  it('does not throw for valid results (N=4, sum=10)', () => {
    const results: HarveyRoundResult[] = [
      { stablefordPoints: 4, moneyPoints: 1 },
      { stablefordPoints: 3, moneyPoints: 2 },
      { stablefordPoints: 2, moneyPoints: 3 },
      { stablefordPoints: 1, moneyPoints: 4 },
    ];
    expect(() => validateHarveyTotal(results, 4)).not.toThrow();
  });

  it('does not throw for half-point tie results (N=4, sum=10)', () => {
    const results: HarveyRoundResult[] = [
      { stablefordPoints: 4, moneyPoints: 4 },
      { stablefordPoints: 2.5, moneyPoints: 2.5 },
      { stablefordPoints: 2.5, moneyPoints: 2.5 },
      { stablefordPoints: 1, moneyPoints: 1 },
    ];
    expect(() => validateHarveyTotal(results, 4)).not.toThrow();
  });

  it('throws HarveySumViolationError for stableford sum ≠ expected', () => {
    const results: HarveyRoundResult[] = [
      { stablefordPoints: 5, moneyPoints: 4 }, // wrong: 5+3+2+1=11 ≠ 10
      { stablefordPoints: 3, moneyPoints: 3 },
      { stablefordPoints: 2, moneyPoints: 2 },
      { stablefordPoints: 1, moneyPoints: 1 },
    ];
    expect(() => validateHarveyTotal(results, 4)).toThrowError(HarveySumViolationError);
    try {
      validateHarveyTotal(results, 4);
    } catch (e) {
      expect((e as HarveySumViolationError).category).toBe('stableford');
      expect((e as HarveySumViolationError).actualSum).toBe(11);
      expect((e as HarveySumViolationError).expectedSum).toBe(10);
    }
  });

  it('throws HarveySumViolationError for money sum ≠ expected', () => {
    const results: HarveyRoundResult[] = [
      { stablefordPoints: 4, moneyPoints: 4 },
      { stablefordPoints: 3, moneyPoints: 3 },
      { stablefordPoints: 2, moneyPoints: 2 },
      { stablefordPoints: 1, moneyPoints: 0 }, // wrong: 4+3+2+0=9 ≠ 10
    ];
    expect(() => validateHarveyTotal(results, 4)).toThrowError(HarveySumViolationError);
    try {
      validateHarveyTotal(results, 4);
    } catch (e) {
      expect((e as HarveySumViolationError).category).toBe('money');
      expect((e as HarveySumViolationError).actualSum).toBe(9);
      expect((e as HarveySumViolationError).expectedSum).toBe(10);
    }
  });

  it('HarveySumViolationError is an Error instance with correct name', () => {
    const results: HarveyRoundResult[] = [
      { stablefordPoints: 10, moneyPoints: 4 },
      { stablefordPoints: 1, moneyPoints: 3 },
      { stablefordPoints: 1, moneyPoints: 2 },
      { stablefordPoints: 1, moneyPoints: 1 },
    ];
    try {
      validateHarveyTotal(results, 4);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HarveySumViolationError);
      expect((e as HarveySumViolationError).name).toBe('HarveySumViolationError');
    }
  });

  it('does not throw for N=16, sum=136', () => {
    const results: HarveyRoundResult[] = Array.from({ length: 16 }, (_, i) => ({
      stablefordPoints: 16 - i,
      moneyPoints: i + 1,
    }));
    expect(() => validateHarveyTotal(results, 16)).not.toThrow();
  });

  it('throws Error when results.length !== playerCount', () => {
    const results: HarveyRoundResult[] = [
      { stablefordPoints: 4, moneyPoints: 4 },
      { stablefordPoints: 3, moneyPoints: 3 },
      { stablefordPoints: 2, moneyPoints: 2 },
      { stablefordPoints: 1, moneyPoints: 1 },
    ];
    expect(() => validateHarveyTotal(results, 16)).toThrow(
      'results.length (4) !== playerCount (16)',
    );
  });
});

// ---------------------------------------------------------------------------
// Story 1.7: Playoff multipliers
// ---------------------------------------------------------------------------

describe('calculateHarveyPoints — playoff_r8 (×3 multiplier)', () => {
  it('N=8 no-tie: 1st gets 24 (8×3), 8th gets 3 (1×3), sum=108', () => {
    const players = inputs([
      [80, 8], [70, 7], [60, 6], [50, 5],
      [40, 4], [30, 3], [20, 2], [10, 1],
    ]);
    const results = calculateHarveyPoints(players, 'playoff_r8');
    expect(sp(results)).toEqual([24, 21, 18, 15, 12, 9, 6, 3]);
    expect(mp(results)).toEqual([24, 21, 18, 15, 12, 9, 6, 3]);
    expect(sumOf(sp(results))).toBe(108);
    expect(sumOf(mp(results))).toBe(108);
  });

  it('N=8 2-way tie for 1st/2nd: each gets (8+7)/2 × 3 = 22.5; sum=108', () => {
    // Stableford: both players 0 and 1 tied for 1st
    const players = inputs([
      [80, 0], [80, 0], [60, 0], [50, 0],
      [40, 0], [30, 0], [20, 0], [10, 0],
    ]);
    const results = calculateHarveyPoints(players, 'playoff_r8');
    // Tied 1st/2nd: avg = (8+7)/2 = 7.5 × 3 = 22.5
    expect(sp(results)[0]).toBe(22.5);
    expect(sp(results)[1]).toBe(22.5);
    // 3rd gets 6×3=18, ..., 8th gets 1×3=3
    expect(sp(results)[2]).toBe(18);
    expect(sp(results)[7]).toBe(3);
    expect(sumOf(sp(results))).toBe(108);
  });

  it('regular roundType produces same output as default (no roundType)', () => {
    const players = inputs([[18, 3], [15, 1], [12, -1], [10, -3]]);
    const withExplicit = calculateHarveyPoints(players, 'regular');
    const withDefault = calculateHarveyPoints(players);
    expect(sp(withExplicit)).toEqual(sp(withDefault));
    expect(mp(withExplicit)).toEqual(mp(withDefault));
  });
});

describe('calculateHarveyPoints — playoff_r4 (×8 multiplier)', () => {
  it('N=4 no-tie: 1st gets 32 (4×8), 4th gets 8 (1×8), sum=80', () => {
    const players = inputs([[20, 4], [15, 3], [10, 2], [5, 1]]);
    const results = calculateHarveyPoints(players, 'playoff_r4');
    expect(sp(results)).toEqual([32, 24, 16, 8]);
    expect(mp(results)).toEqual([32, 24, 16, 8]);
    expect(sumOf(sp(results))).toBe(80);
    expect(sumOf(mp(results))).toBe(80);
  });

  it('N=4 3-way tie for 1st: each gets (4+3+2)/3 × 8 = 24; 4th gets 8; sum=80', () => {
    const players = inputs([[20, 0], [20, 0], [20, 0], [10, 0]]);
    const results = calculateHarveyPoints(players, 'playoff_r4');
    // Tied 1st/2nd/3rd: avg = (4+3+2)/3 = 3.0 × 8 = 24 each; 4th = 1×8=8
    expect(sp(results)).toEqual([24, 24, 24, 8]);
    expect(sumOf(sp(results))).toBe(80);
  });
});

describe('validateHarveyTotal — with multiplier', () => {
  it('passes for R8 N=8 sum=108 with multiplier=3', () => {
    const results: HarveyRoundResult[] = Array.from({ length: 8 }, (_, i) => ({
      stablefordPoints: (8 - i) * 3,
      moneyPoints: (8 - i) * 3,
    }));
    expect(() => validateHarveyTotal(results, 8, 3)).not.toThrow();
  });

  it('throws for R8 results with multiplier=1 (wrong expected sum)', () => {
    // R8 no-tie results sum to 108, but multiplier=1 expects 36
    const results: HarveyRoundResult[] = Array.from({ length: 8 }, (_, i) => ({
      stablefordPoints: (8 - i) * 3,
      moneyPoints: (8 - i) * 3,
    }));
    expect(() => validateHarveyTotal(results, 8, 1)).toThrowError(HarveySumViolationError);
  });
});

// ---------------------------------------------------------------------------
// Story 1.7: calculateSeasonTotal — regular rounds only
// ---------------------------------------------------------------------------

describe('calculateSeasonTotal — regular rounds only', () => {
  it('15 rounds: drops 5 lowest combined; roundsDropped=5', () => {
    // Both categories increase together (combined = 2*(i+1)); top-10-combined drops rounds 0-4.
    // Stableford top 10: 6+7+...+15 = 105; Money top 10: same = 105
    const r = rounds(
      Array.from({ length: 15 }, (_, i) => [i + 1, i + 1] as [number, number]),
    );
    const result = calculateSeasonTotal(r);
    expect(result.roundsPlayed).toBe(15);
    expect(result.roundsDropped).toBe(5);
    expect(result.stableford).toBe(105);
    expect(result.money).toBe(105);
  });

  it('10 rounds: drops 0; total = sum of all 10; roundsDropped=0', () => {
    const r = rounds(Array.from({ length: 10 }, (_, i) => [i + 1, i + 1] as [number, number]));
    const result = calculateSeasonTotal(r);
    expect(result.roundsPlayed).toBe(10);
    expect(result.roundsDropped).toBe(0);
    // Sum 1+2+...+10 = 55
    expect(result.stableford).toBe(55);
    expect(result.money).toBe(55);
  });

  it('8 rounds (mid-season joiner): drops 0; total = sum of all 8', () => {
    const r = rounds(Array.from({ length: 8 }, (_, i) => [i + 1, i + 1] as [number, number]));
    const result = calculateSeasonTotal(r);
    expect(result.roundsPlayed).toBe(8);
    expect(result.roundsDropped).toBe(0);
    expect(result.stableford).toBe(36); // 1+2+...+8
    expect(result.money).toBe(36);
  });

  it('1 round: returns that round\'s points; roundsDropped=0', () => {
    const r = rounds([[7, 4]]);
    const result = calculateSeasonTotal(r);
    expect(result.roundsPlayed).toBe(1);
    expect(result.roundsDropped).toBe(0);
    expect(result.stableford).toBe(7);
    expect(result.money).toBe(4);
  });

  it('combined-round drops: both categories use the same dropped rounds', () => {
    // 11 rounds (1 drop): round 0 has high stableford (20) but low money (1), combined=21;
    // rounds 1-10 have stableford (5) and money (10), combined=15 each.
    // Top-10 by combined: keeps round 0 (highest combined=21), drops one of the 15-combined rounds.
    // stableford: 20 + 5×9 = 65
    // money: 1 + 10×9 = 91  (round 0's money=1 is kept, one 10 is dropped)
    const r = rounds([
      [20, 1],
      ...Array.from({ length: 10 }, () => [5, 10] as [number, number]),
    ]);
    const result = calculateSeasonTotal(r);
    expect(result.roundsPlayed).toBe(11);
    expect(result.roundsDropped).toBe(1);
    expect(result.stableford).toBe(65);  // 20 + 5×9
    expect(result.money).toBe(91);       // 1 + 10×9 — same 10 rounds used for both categories
  });

  it('11 rounds: drops 1 lowest per category; roundsDropped=1', () => {
    // Boundary case: first season length where a drop actually applies (11 - 10 = 1)
    const r = rounds(Array.from({ length: 11 }, (_, i) => [i + 1, i + 1] as [number, number]));
    const result = calculateSeasonTotal(r);
    expect(result.roundsPlayed).toBe(11);
    expect(result.roundsDropped).toBe(1);
    // Drop the lowest (1); sum of 2+3+...+11 = 65
    expect(result.stableford).toBe(65);
    expect(result.money).toBe(65);
  });

  it('0 regular rounds: roundsPlayed=0, roundsDropped=0, total=0', () => {
    const result = calculateSeasonTotal([]);
    expect(result.roundsPlayed).toBe(0);
    expect(result.roundsDropped).toBe(0);
    expect(result.stableford).toBe(0);
    expect(result.money).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Story 1.7: calculateSeasonTotal — with playoff rounds
// ---------------------------------------------------------------------------

describe('calculateSeasonTotal — with playoff rounds', () => {
  it('10 regular + 1 R8 playoff: playoff points add on top of season total', () => {
    // Regular: 10 rounds each worth [5,5] → total 50/50
    const regular = rounds(Array.from({ length: 10 }, () => [5, 5] as [number, number]));
    // Playoff R8: player earned 22.5 stableford and 22.5 money
    const playoff = rounds([[22.5, 22.5]]);
    const result = calculateSeasonTotal(regular, playoff);
    expect(result.roundsPlayed).toBe(10);
    expect(result.roundsDropped).toBe(0);
    expect(result.stableford).toBe(50 + 22.5);
    expect(result.money).toBe(50 + 22.5);
  });

  it('15 regular + 2 playoff: best-10 drops regular only; both playoff rounds fully counted', () => {
    // Regular: values 1..15 stableford; top 10 = 6+7+...+15 = 105
    const regular = rounds(
      Array.from({ length: 15 }, (_, i) => [i + 1, i + 1] as [number, number]),
    );
    // Playoff: R8 and R4 rounds — e.g., 24 and 32 stableford
    const playoff = rounds([[24, 18], [32, 24]]);
    const result = calculateSeasonTotal(regular, playoff);
    expect(result.roundsPlayed).toBe(15);
    expect(result.roundsDropped).toBe(5);
    // regular top 10 stableford: 15+14+...+6 = 105
    expect(result.stableford).toBe(105 + 24 + 32); // 161
    // regular top 10 money: same = 105
    expect(result.money).toBe(105 + 18 + 24); // 147
  });

  it('0 regular rounds + playoff rounds: roundsPlayed=0, total=playoff sum only', () => {
    const playoff = rounds([[22.5, 22.5], [32, 32]]);
    const result = calculateSeasonTotal([], playoff);
    expect(result.roundsPlayed).toBe(0);
    expect(result.roundsDropped).toBe(0);
    expect(result.stableford).toBe(54.5);
    expect(result.money).toBe(54.5);
  });

  it('omitted playoffRounds param behaves same as empty array', () => {
    const regular = rounds([[5, 3], [4, 2], [3, 1]]);
    const withUndefined = calculateSeasonTotal(regular);
    const withEmpty = calculateSeasonTotal(regular, []);
    expect(withUndefined).toEqual(withEmpty);
  });
});
