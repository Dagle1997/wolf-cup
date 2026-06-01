import { describe, it, expect } from 'vitest';
import {
  computeOddsLine,
  estimateStrengthOrder,
  probToAmerican,
  americanToImplied,
  simulateWeekHousePnl,
  logLossAndBrier,
  DEFAULT_ODDS_CONSTANTS,
  type ComputeOddsInput,
  type OddsFieldEntry,
} from './odds.js';
import { calculateHarveyPoints } from './harvey.js';

// Helper: build a member with `n` rounds of fixed (stableford, money).
function member(playerId: number, rounds: Array<[number, number]>, isSub = false): OddsFieldEntry {
  return {
    playerId,
    isSub,
    history: rounds.map(([stableford, money], i) => ({ stableford, money, orderIndex: i })),
  };
}

const base = (field: OddsFieldEntry[], over: Partial<ComputeOddsInput> = {}): ComputeOddsInput => ({
  field,
  priorRoundCount: 5,
  seed: 12345,
  ...over,
});

describe('probToAmerican / americanToImplied', () => {
  it('prices a favorite negative and an underdog positive', () => {
    expect(probToAmerican(0.8, 2500)).toBeLessThan(0);
    expect(probToAmerican(0.1, 2500)).toBeGreaterThan(0);
  });

  it('caps displayed longshots at the dignity ceiling', () => {
    expect(probToAmerican(0.001, 2500)).toBe(2500); // raw would be ~+99900
    expect(probToAmerican(0.0001, 1500)).toBe(1500);
  });

  it('floors absurd favorite prices at −favoriteCap (codex F2)', () => {
    // fairProb·OVERROUND can exceed 1 for a lock — raw would be ~−99999900.
    expect(probToAmerican(1.18, 2500, 10000)).toBe(-10000);
    expect(probToAmerican(0.999, 2500, 5000)).toBe(-5000);
  });

  it('round-trips approximately through implied probability', () => {
    const a = probToAmerican(0.25, 2500); // ~+300
    expect(americanToImplied(a)).toBeCloseTo(0.25, 1);
  });

  it('never returns a degenerate 0', () => {
    expect(probToAmerican(0.5, 2500)).not.toBe(0);
  });
});

describe('computeOddsLine — gate', () => {
  it('gates below MIN_FIELD_ROUNDS', () => {
    const r = computeOddsLine(base([member(1, [[30, 5]]), member(2, [[20, -5]])], { priorRoundCount: 2 }));
    expect(r.gated).toBe(true);
    if (r.gated) expect(r.reason).toMatch(/few weeks/);
  });

  it('gates with an empty field (no roster)', () => {
    const r = computeOddsLine(base([], { priorRoundCount: 5 }));
    expect(r.gated).toBe(true);
    if (r.gated) expect(r.reason).toMatch(/pairings/);
  });
});

describe('computeOddsLine — determinism', () => {
  it('two calls with the same seed + inputs are byte-identical', () => {
    const field = [member(1, [[34, 10], [30, 5], [28, -2]]), member(2, [[25, -8], [27, 0], [22, -5]]), member(3, [[30, 2], [31, 3], [29, 1]])];
    const a = computeOddsLine(base(field));
    const b = computeOddsLine(base(field));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('is order-independent — shuffling field / history / sub order yields identical odds (codex F1)', () => {
    const field = [
      member(1, [[34, 10], [30, 5], [28, -2]]),
      member(2, [[25, -8], [27, 0], [22, -5]]),
      member(3, [[30, 2], [31, 3], [29, 1]]),
      member(99, [[33, 8], [31, 6], [30, 4]], true),
    ];
    const subPrior = [{ stableford: 33, money: 8 }, { stableford: 31, money: 6 }];
    const a = computeOddsLine(base(field, { subPrior }));
    // Reverse the field, reverse each member's history, reverse the sub prior.
    const shuffled = [...field].reverse().map((f) => ({ ...f, history: [...f.history].reverse() }));
    const b = computeOddsLine(base(shuffled, { subPrior: [...subPrior].reverse() }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different seed produces a different line', () => {
    const field = [member(1, [[34, 10], [30, 5]]), member(2, [[25, -8], [27, 0]]), member(3, [[30, 2], [31, 3]])];
    const a = computeOddsLine(base(field, { seed: 1 }));
    const b = computeOddsLine(base(field, { seed: 2 }));
    // Not asserting inequality of every field (MC can coincide), but the favorites' fairProbs should differ slightly.
    if (!a.gated && !b.gated) {
      expect(a.lines.map((l) => l.fairProb)).not.toEqual(b.lines.map((l) => l.fairProb));
    }
  });
});

describe('computeOddsLine — favorite emerges + members only', () => {
  const field = [
    member(1, [[40, 30], [42, 28], [41, 25], [39, 26], [43, 31], [40, 27]]), // strong
    member(2, [[28, -5], [27, 0], [29, -2], [26, -8], [28, -3], [27, -1]]),
    member(3, [[30, 5], [31, 3], [29, 4], [30, 2], [32, 6], [31, 4]]),
    member(4, [[20, -15], [22, -12], [21, -14], [19, -16], [20, -13], [22, -11]]),
    member(99, [[33, 8], [34, 9]], true), // a sub — must NOT appear as a line
  ];

  it('emits one line per member (subs excluded) sorted favorites → longshots', () => {
    const r = computeOddsLine(base(field));
    expect(r.gated).toBe(false);
    if (r.gated) return;
    expect(r.lines.map((l) => l.playerId).sort()).toEqual([1, 2, 3, 4]);
    expect(r.lines.find((l) => l.playerId === 99)).toBeUndefined();
    // sorted by fairProb descending
    for (let i = 1; i < r.lines.length; i++) {
      expect(r.lines[i - 1]!.fairProb).toBeGreaterThanOrEqual(r.lines[i]!.fairProb);
    }
    // the strong player is the favorite
    expect(r.lines[0]!.playerId).toBe(1);
    expect(r.lines[0]!.tier).toBe('favorite');
  });

  it('fairProb sums to ≈1; posted implied sums to ≈OVERROUND', () => {
    const r = computeOddsLine(base(field));
    if (r.gated) throw new Error('gated');
    const fairSum = r.lines.reduce((a, l) => a + l.fairProb, 0);
    const impliedSum = r.lines.reduce((a, l) => a + l.impliedProb, 0);
    expect(fairSum).toBeCloseTo(1, 6);
    expect(impliedSum).toBeCloseTo(DEFAULT_ODDS_CONSTANTS.OVERROUND, 6);
  });

  it('agrees with the independent estimator on favorite ordering (self-consistency)', () => {
    const r = computeOddsLine(base(field));
    if (r.gated) throw new Error('gated');
    const bootstrapOrder = r.lines.map((l) => l.playerId);
    const independent = estimateStrengthOrder(field);
    // favorite (top of each ordering) must agree
    expect(bootstrapOrder[0]).toBe(independent[0]);
  });
});

describe('computeOddsLine — shrinkage + no false favorite', () => {
  it('a 2-round hot streak does not dominate a deep field', () => {
    // player 1 has only 2 hot rounds; players 2-5 have long average histories.
    const avg: Array<[number, number]> = Array.from({ length: 8 }, (_, i) => [30 + (i % 3), (i % 3) - 1]);
    const field = [
      member(1, [[44, 40], [45, 42]]), // tiny but blazing sample
      member(2, avg),
      member(3, avg),
      member(4, avg),
      member(5, avg),
    ];
    const r = computeOddsLine(base(field));
    if (r.gated) throw new Error('gated');
    const p1 = r.lines.find((l) => l.playerId === 1)!;
    // shrinkage pulls the thin sample toward baseline — not a runaway favorite at ~1.0
    expect(p1.fairProb).toBeLessThan(0.85);
  });

  it('all-identical history → no false favorite (wide-open)', () => {
    const h: Array<[number, number]> = [[30, 0], [30, 0], [30, 0], [30, 0]];
    const field = [member(1, h), member(2, h), member(3, h), member(4, h)];
    const r = computeOddsLine(base(field));
    if (r.gated) throw new Error('gated');
    expect(r.wideOpen).toBe(true);
    // every member near 1/N
    for (const l of r.lines) expect(l.fairProb).toBeCloseTo(0.25, 1);
  });
});

describe('computeOddsLine — edge cases', () => {
  it('single member = lock, no divide-by-zero', () => {
    const r = computeOddsLine(base([member(1, [[30, 5], [31, 6], [29, 4]])]));
    if (r.gated) throw new Error('gated');
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.fairProb).toBe(1);
    expect(r.lines[0]!.tier).toBe('favorite');
    expect(r.lines[0]!.postedAmerican).toBe(-DEFAULT_ODDS_CONSTANTS.FAVORITE_CAP); // capped, not −99999900
  });

  it('under-sampled member is unpriced ("—") but still simulated', () => {
    const avg: Array<[number, number]> = Array.from({ length: 6 }, () => [30, 0]);
    const field = [member(1, [[44, 40]]), member(2, avg), member(3, avg)]; // player 1 has 1 round
    const r = computeOddsLine(base(field));
    if (r.gated) throw new Error('gated');
    const p1 = r.lines.find((l) => l.playerId === 1)!;
    expect(p1.tier).toBe('unpriced');
    expect(p1.postedAmerican).toBeNull();
    expect(p1.fairProb).toBeGreaterThan(0); // still in the sim
  });

  it('tie-split: two mirror-image members each price near 1/2', () => {
    // identical histories ⇒ symmetric ⇒ ~50/50 with 1/k tie credit
    const h: Array<[number, number]> = [[30, 5], [31, 6], [29, 4]];
    const r = computeOddsLine(base([member(1, h), member(2, h)]));
    if (r.gated) throw new Error('gated');
    expect(r.lines[0]!.fairProb).toBeCloseTo(0.5, 1);
    expect(r.lines[0]!.fairProb + r.lines[1]!.fairProb).toBeCloseTo(1, 6);
  });
});

describe('subs are load-bearing rank fillers (F1 counterexample)', () => {
  // The earlier "exclude subs, it's argmax-equivalent" claim was FALSE: Harvey
  // points are rank-based over the full field, so a sub occupying a rank slot
  // can REORDER the member winner. This is a concrete, hand-verified flip.
  it('including a sub flips the top member (C → B)', () => {
    const members = [
      { stableford: 24, money: 17 }, // A
      { stableford: 34, money: 13 }, // B
      { stableford: 26, money: 17 }, // C
      { stableford: 35, money: -3 }, // D
    ];
    const sub = { stableford: 32, money: 1 };

    const topMember = (field: Array<{ stableford: number; money: number }>): number => {
      const pts = calculateHarveyPoints(field, 'regular', 0);
      let best = -Infinity;
      let bi = -1;
      for (let i = 0; i < members.length; i++) {
        const c = pts[i]!.stablefordPoints + pts[i]!.moneyPoints;
        if (c > best) { best = c; bi = i; }
      }
      return bi;
    };

    expect(topMember(members)).toBe(2); // C wins with members only
    expect(topMember([...members, sub])).toBe(1); // B wins once the sub fills a rank slot
  });
});

describe('house P&L helpers', () => {
  it('off-board winner ⇒ house keeps every stake (P&L = +nBettors·stake)', () => {
    const r = simulateWeekHousePnl({
      pricedMemberIds: [1, 2, 3],
      postedAmerican: [-150, 200, 400],
      formZ: [0.5, 0, -0.5],
      winningMemberIds: [99], // not in priced set — nobody can cash
      winnerShare: 1,
      seed: 123,
      nBettors: 20,
      stakeUnit: 1,
      bias: 1,
    });
    expect(r.totalStakes).toBe(20);
    expect(r.housePnl).toBe(20); // keeps it all
  });

  it('changing the posted line changes the house P&L (non-circular — AC-C1b)', () => {
    const common = {
      pricedMemberIds: [1, 2, 3],
      formZ: [1.0, 0, -1.0],
      winningMemberIds: [1],
      winnerShare: 1,
      seed: 77,
      nBettors: 50,
      stakeUnit: 1,
      bias: 1,
    };
    const a = simulateWeekHousePnl({ ...common, postedAmerican: [-200, 300, 600] });
    const b = simulateWeekHousePnl({ ...common, postedAmerican: [+500, 300, 600] });
    expect(a.housePnl).not.toBe(b.housePnl);
  });

  it('log-loss is finite even when the winner had fair_p = 0 (floored)', () => {
    const probs = new Map([[1, 0.6], [2, 0.4], [3, 0]]);
    const { logLoss } = logLossAndBrier(probs, [1, 2, 3], 3);
    expect(Number.isFinite(logLoss)).toBe(true);
    expect(logLoss).toBeCloseTo(-Math.log(1e-6), 6);
  });
});

describe('computeOddsLine — hold math', () => {
  it('theoretical hold = 1 − 1/OVERROUND; effective hold derived from posted prices', () => {
    const field = [
      member(1, [[40, 30], [42, 28], [41, 25], [39, 26]]),
      member(2, [[28, -5], [27, 0], [29, -2], [26, -8]]),
      member(3, [[30, 5], [31, 3], [29, 4], [30, 2]]),
    ];
    const r = computeOddsLine(base(field));
    if (r.gated) throw new Error('gated');
    expect(r.theoreticalHold).toBeCloseTo(1 - 1 / DEFAULT_ODDS_CONSTANTS.OVERROUND, 9);
    expect(Number.isFinite(r.effectiveHold)).toBe(true);
  });
});
