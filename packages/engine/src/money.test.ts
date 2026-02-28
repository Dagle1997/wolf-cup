import { describe, it, expect } from 'vitest';
import { calculateHoleMoney } from './money.js';
import type { HoleAssignment, WolfDecision } from './types.js';

// ---------------------------------------------------------------------------
// Shorthands
// ---------------------------------------------------------------------------
const SKINS: HoleAssignment = { type: 'skins' };
const WOLF = (wolfBatterIndex: 0 | 1 | 2 | 3): HoleAssignment => ({
  type: 'wolf',
  wolfBatterIndex,
});
const PARTNER = (partnerBatterIndex: 0 | 1 | 2 | 3): WolfDecision => ({
  type: 'partner',
  partnerBatterIndex,
});
const ALONE: WolfDecision = { type: 'alone' };
const BLIND: WolfDecision = { type: 'blind_wolf' };

// Convenience: extract the total for each batting position
function totals(netScores: readonly [number, number, number, number], ha: HoleAssignment, wd: WolfDecision | null, par: 3 | 4 | 5) {
  const r = calculateHoleMoney(netScores, ha, wd, par);
  return [r[0].total, r[1].total, r[2].total, r[3].total] as const;
}

// ---------------------------------------------------------------------------
// Skins holes (type: 'skins') — individual skin payout only
// ---------------------------------------------------------------------------
describe('calculateHoleMoney — skins holes (type: skins)', () => {
  it('unique low ball ≤ par → winner +3, others −1', () => {
    // player 3 has net 3 on par-4 (birdie) — unique low
    const r = calculateHoleMoney([5, 5, 5, 3], SKINS, null, 4);
    expect(r[0].total).toBe(-1);
    expect(r[1].total).toBe(-1);
    expect(r[2].total).toBe(-1);
    expect(r[3].total).toBe(3);
    // payout is in skin component, lowBall/teamTotalOrBonus/blindWolf are all 0
    expect(r[3].lowBall).toBe(0);
    expect(r[3].skin).toBe(3);
    expect(r[3].teamTotalOrBonus).toBe(0);
    expect(r[3].blindWolf).toBe(0);
  });

  it('unique low ball exactly at par → skin awarded (net par is ≤ par)', () => {
    const r = calculateHoleMoney([5, 5, 5, 4], SKINS, null, 4);
    expect(r[3].total).toBe(3);
    expect(r[0].total).toBe(-1);
  });

  it('tied low ball → all $0', () => {
    expect(totals([3, 3, 5, 5], SKINS, null, 4)).toEqual([0, 0, 0, 0]);
  });

  it('all four tie → all $0', () => {
    expect(totals([4, 4, 4, 4], SKINS, null, 4)).toEqual([0, 0, 0, 0]);
  });

  it('low ball worse than par (net bogey) → no skin, all $0', () => {
    // net scores all bogeys on par-4
    expect(totals([5, 6, 7, 8], SKINS, null, 4)).toEqual([0, 0, 0, 0]);
  });

  it('low ball = par + 1 (net bogey) → no skin', () => {
    expect(totals([5, 5, 5, 5], SKINS, null, 4)).toEqual([0, 0, 0, 0]);
  });

  it('par-3 hole: player 1 nets 2 (birdie) → skin', () => {
    const r = calculateHoleMoney([4, 2, 4, 4], SKINS, null, 3);
    expect(r[1].total).toBe(3);
    expect(r[0].total).toBe(-1);
  });

  it('par-5 hole: player 0 nets 5 (par) → skin', () => {
    const r = calculateHoleMoney([5, 6, 7, 8], SKINS, null, 5);
    expect(r[0].total).toBe(3);
    expect(r[1].total).toBe(-1);
  });

  it('zero-sum always holds on skins hole', () => {
    const r = calculateHoleMoney([3, 5, 6, 7], SKINS, null, 4);
    const sum = r[0].total + r[1].total + r[2].total + r[3].total;
    expect(sum).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2v2 wolf holes — 3 team components (low ball, skin, team total)
// ---------------------------------------------------------------------------
describe('calculateHoleMoney — 2v2 wolf holes', () => {
  // wolf = pos 0, partner = pos 1; opponents = pos 2, 3

  it('full sweep: team A wins all 3 → each +3, each opponent −3', () => {
    // Team A: [3, 4]  Team B: [5, 6]  par-5
    // Low ball: 3 vs 5 → A wins
    // Skin: 3 ≤ 5 ✓, unique → A wins
    // Total: 7 vs 11 → A wins
    const r = calculateHoleMoney([3, 4, 5, 6], WOLF(0), PARTNER(1), 5);
    expect(r[0].total).toBe(3);
    expect(r[1].total).toBe(3);
    expect(r[2].total).toBe(-3);
    expect(r[3].total).toBe(-3);
  });

  it('full sweep: each component individually +1/+1/−1/−1', () => {
    const r = calculateHoleMoney([3, 4, 5, 6], WOLF(0), PARTNER(1), 5);
    expect(r[0].lowBall).toBe(1);
    expect(r[0].skin).toBe(1);
    expect(r[0].teamTotalOrBonus).toBe(1);
    expect(r[1].lowBall).toBe(1);
    expect(r[1].skin).toBe(1);
    expect(r[1].teamTotalOrBonus).toBe(1);
    expect(r[2].lowBall).toBe(-1);
    expect(r[2].skin).toBe(-1);
    expect(r[2].teamTotalOrBonus).toBe(-1);
    expect(r[3].lowBall).toBe(-1);
    expect(r[3].skin).toBe(-1);
    expect(r[3].teamTotalOrBonus).toBe(-1);
  });

  it('team A wins low ball + skin; ties team total → each +2/−2', () => {
    // Team A: [3, 5]  Team B: [4, 4]  par-4
    // Low ball: 3 vs 4 → A wins
    // Skin: 3 ≤ 4 ✓ → A wins
    // Total: 8 vs 8 → tie
    const r = calculateHoleMoney([3, 5, 4, 4], WOLF(0), PARTNER(1), 4);
    expect(r[0].total).toBe(2);
    expect(r[1].total).toBe(2);
    expect(r[2].total).toBe(-2);
    expect(r[3].total).toBe(-2);
    expect(r[0].teamTotalOrBonus).toBe(0); // tie
  });

  it('team A wins low ball, no skin (net bogey), B wins total → each nets 0', () => {
    // Team A: [5, 7]  Team B: [6, 5]  par-4
    // Low ball: 5 vs 5 → tie
    // Actually let me re-do: A = [5,8], B = [6,6]
    // Low ball: 5 vs 6 → A wins (+1 each)
    // Skin: low ball = 5, par = 4 → 5 > 4 → no skin ($0)
    // Total: 13 vs 12 → B wins (−1 each A, +1 each B)
    // Net: A: +1−1=0, B: −1+1=0
    const r = calculateHoleMoney([5, 8, 6, 6], WOLF(0), PARTNER(1), 4);
    expect(r[0].total).toBe(0);
    expect(r[1].total).toBe(0);
    expect(r[2].total).toBe(0);
    expect(r[3].total).toBe(0);
    expect(r[0].skin).toBe(0); // no skin
  });

  it('all 4 scores equal → all $0 (3 ties)', () => {
    const r = calculateHoleMoney([4, 4, 4, 4], WOLF(0), PARTNER(1), 4);
    expect(r[0].total).toBe(0);
    expect(r[1].total).toBe(0);
    expect(r[2].total).toBe(0);
    expect(r[3].total).toBe(0);
  });

  it('low ball win but no skin (par = 3, low ball = 4 = bogey) → low ball + total only', () => {
    // Team A: [4, 6]  Team B: [5, 7]  par-3
    // Low ball: 4 vs 5 → A wins
    // Skin: 4 > 3 → no skin
    // Total: 10 vs 12 → A wins
    const r = calculateHoleMoney([4, 6, 5, 7], WOLF(0), PARTNER(1), 3);
    expect(r[0].skin).toBe(0);
    expect(r[0].total).toBe(2); // low ball + total
    expect(r[2].total).toBe(-2);
  });

  it('wolf pos 2, partner pos 3 (non-zero wolf position)', () => {
    // Team A: [5, 3]  (pos 2=5, pos 3=3)  Team B: [4, 4]  (pos 0=4, pos 1=4)  par-4
    // Low ball: 3 vs 4 → A (pos 2+3) wins
    // Skin: 3 ≤ 4 ✓ → A wins
    // Total: 8 vs 8 → tie
    const r = calculateHoleMoney([4, 4, 5, 3], WOLF(2), PARTNER(3), 4);
    expect(r[2].total).toBe(2);
    expect(r[3].total).toBe(2);
    expect(r[0].total).toBe(-2);
    expect(r[1].total).toBe(-2);
  });

  it('team B wins all 3 → B each +3, A each −3', () => {
    // Team A (wolf=0, partner=1): [5, 6]  Team B: [3, 4]  par-5
    const r = calculateHoleMoney([5, 6, 3, 4], WOLF(0), PARTNER(1), 5);
    expect(r[0].total).toBe(-3);
    expect(r[1].total).toBe(-3);
    expect(r[2].total).toBe(3);
    expect(r[3].total).toBe(3);
  });

  it('blindWolf component is always 0 in 2v2', () => {
    const r = calculateHoleMoney([3, 4, 5, 6], WOLF(0), PARTNER(1), 5);
    expect(r[0].blindWolf).toBe(0);
    expect(r[1].blindWolf).toBe(0);
    expect(r[2].blindWolf).toBe(0);
    expect(r[3].blindWolf).toBe(0);
  });

  it('zero-sum holds on every component for 2v2 result', () => {
    const r = calculateHoleMoney([3, 5, 4, 6], WOLF(0), PARTNER(1), 4);
    const sumLB = r[0].lowBall + r[1].lowBall + r[2].lowBall + r[3].lowBall;
    const sumSk = r[0].skin + r[1].skin + r[2].skin + r[3].skin;
    const sumTT = r[0].teamTotalOrBonus + r[1].teamTotalOrBonus + r[2].teamTotalOrBonus + r[3].teamTotalOrBonus;
    const sumTo = r[0].total + r[1].total + r[2].total + r[3].total;
    expect(sumLB).toBe(0);
    expect(sumSk).toBe(0);
    expect(sumTT).toBe(0);
    expect(sumTo).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 1v3 lone wolf (alone) — 3 group components
// ---------------------------------------------------------------------------
describe('calculateHoleMoney — 1v3 lone wolf (alone)', () => {
  // wolf = pos 0, opponents = pos 1, 2, 3

  it('wolf wins all 3 (low ball, skin, bonus) → wolf +9, each opp −3', () => {
    // wolf: 3, opps: 5, 5, 5  par-4
    // Low ball: 3 vs min(5,5,5)=5 → wolf wins
    // Skin: 3 ≤ 4, unique → wolf wins
    // Bonus: mirrors low ball → wolf wins
    const r = calculateHoleMoney([3, 5, 5, 5], WOLF(0), ALONE, 4);
    expect(r[0].total).toBe(9);
    expect(r[1].total).toBe(-3);
    expect(r[2].total).toBe(-3);
    expect(r[3].total).toBe(-3);
  });

  it('wolf wins all 3: each component individually correct', () => {
    const r = calculateHoleMoney([3, 5, 5, 5], WOLF(0), ALONE, 4);
    expect(r[0].lowBall).toBe(3);
    expect(r[0].skin).toBe(3);
    expect(r[0].teamTotalOrBonus).toBe(3);
    expect(r[1].lowBall).toBe(-1);
    expect(r[1].skin).toBe(-1);
    expect(r[1].teamTotalOrBonus).toBe(-1);
  });

  it('wolf loses all 3 → wolf −9, each opp +3', () => {
    // wolf: 6, opps: 3, 4, 5  par-4
    // Low ball: 6 vs 3 → wolf loses
    // Skin: min=3 (opp1, unique, ≤4) → opponents win
    // Bonus: mirrors low ball → wolf loses
    const r = calculateHoleMoney([6, 3, 4, 5], WOLF(0), ALONE, 4);
    expect(r[0].total).toBe(-9);
    expect(r[1].total).toBe(3);
    expect(r[2].total).toBe(3);
    expect(r[3].total).toBe(3);
  });

  it('wolf ties low ball → all $0 (no blood)', () => {
    // wolf: 4, opps: 4, 5, 6  par-4
    // Low ball: 4 vs 4 → tie
    // Skin: 4 tied (wolf + opp1) → no skin
    // Bonus: mirrors low ball → tie
    const r = calculateHoleMoney([4, 4, 5, 6], WOLF(0), ALONE, 4);
    expect(r[0].total).toBe(0);
    expect(r[1].total).toBe(0);
    expect(r[2].total).toBe(0);
    expect(r[3].total).toBe(0);
  });

  it('wolf wins low ball but no skin (low ball > par) → wolf +6, each opp −2', () => {
    // wolf: 5, opps: 6, 7, 8  par-4  (all bogey or worse)
    // Low ball: 5 vs 6 → wolf wins
    // Skin: 5 > 4 → no skin
    // Bonus: mirrors low ball → wolf wins
    const r = calculateHoleMoney([5, 6, 7, 8], WOLF(0), ALONE, 4);
    expect(r[0].total).toBe(6);
    expect(r[1].total).toBe(-2);
    expect(r[2].total).toBe(-2);
    expect(r[3].total).toBe(-2);
    expect(r[0].skin).toBe(0); // no skin
  });

  it('opponent has skin (opp low ball unique ≤ par) — opponents win skin component', () => {
    // wolf: 5, opps: 3, 5, 6  par-4
    // Low ball: 5 vs 3 → wolf loses
    // Skin: 3 (opp1, unique, ≤4) → opponents win skin (wolf −3, each opp +1)
    // Bonus: mirrors low ball → wolf loses
    const r = calculateHoleMoney([5, 3, 5, 6], WOLF(0), ALONE, 4);
    expect(r[0].lowBall).toBe(-3);
    expect(r[0].skin).toBe(-3);
    expect(r[0].teamTotalOrBonus).toBe(-3);
    expect(r[1].skin).toBe(1);
    expect(r[2].skin).toBe(1);
    expect(r[3].skin).toBe(1);
    expect(r[0].total).toBe(-9);
  });

  it('two opponents tie for absolute low ball → no skin ($0 on skin component)', () => {
    // wolf: 5, opp1: 3, opp2: 3, opp3: 6  par-4 — tied low ball among opps
    // Skin: 3 tied → no skin
    const r = calculateHoleMoney([5, 3, 3, 6], WOLF(0), ALONE, 4);
    expect(r[0].skin).toBe(0);
    expect(r[1].skin).toBe(0);
  });

  it('wolf at non-zero batting position', () => {
    // wolf = pos 2, opps = pos 0,1,3
    // wolf: net 3, opps: 5, 5, 5  par-4
    const r = calculateHoleMoney([5, 5, 3, 5], WOLF(2), ALONE, 4);
    expect(r[2].total).toBe(9);
    expect(r[0].total).toBe(-3);
    expect(r[1].total).toBe(-3);
    expect(r[3].total).toBe(-3);
  });

  it('blindWolf component is always 0 for alone decision', () => {
    const r = calculateHoleMoney([3, 5, 5, 5], WOLF(0), ALONE, 4);
    expect(r[0].blindWolf).toBe(0);
    expect(r[1].blindWolf).toBe(0);
    expect(r[2].blindWolf).toBe(0);
    expect(r[3].blindWolf).toBe(0);
  });

  it('zero-sum holds on every component for 1v3 result', () => {
    const r = calculateHoleMoney([3, 5, 6, 7], WOLF(0), ALONE, 4);
    const sumLB = r[0].lowBall + r[1].lowBall + r[2].lowBall + r[3].lowBall;
    const sumSk = r[0].skin + r[1].skin + r[2].skin + r[3].skin;
    const sumBo = r[0].teamTotalOrBonus + r[1].teamTotalOrBonus + r[2].teamTotalOrBonus + r[3].teamTotalOrBonus;
    const sumTo = r[0].total + r[1].total + r[2].total + r[3].total;
    expect(sumLB).toBe(0);
    expect(sumSk).toBe(0);
    expect(sumBo).toBe(0);
    expect(sumTo).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 1v3 blind wolf — same as alone + extra bonus if wolf wins low ball
// ---------------------------------------------------------------------------
describe('calculateHoleMoney — 1v3 blind wolf', () => {
  it('wolf wins all 3 + blind bonus → wolf +12, each opp −4', () => {
    // wolf: 3, opps: 5, 5, 5  par-4
    const r = calculateHoleMoney([3, 5, 5, 5], WOLF(0), BLIND, 4);
    expect(r[0].total).toBe(12);
    expect(r[1].total).toBe(-4);
    expect(r[2].total).toBe(-4);
    expect(r[3].total).toBe(-4);
  });

  it('blind wolf extra component correctly populated on win', () => {
    const r = calculateHoleMoney([3, 5, 5, 5], WOLF(0), BLIND, 4);
    expect(r[0].blindWolf).toBe(3);
    expect(r[1].blindWolf).toBe(-1);
    expect(r[2].blindWolf).toBe(-1);
    expect(r[3].blindWolf).toBe(-1);
  });

  it('wolf loses — no blind wolf extra penalty (same −9 as regular alone)', () => {
    // wolf: 6, opps: 3, 4, 5  par-4
    const r = calculateHoleMoney([6, 3, 4, 5], WOLF(0), BLIND, 4);
    expect(r[0].total).toBe(-9);
    expect(r[1].total).toBe(3);
    expect(r[2].total).toBe(3);
    expect(r[3].total).toBe(3);
    // blind wolf extra is $0 (no penalty)
    expect(r[0].blindWolf).toBe(0);
    expect(r[1].blindWolf).toBe(0);
  });

  it('wolf ties low ball → blind wolf extra = $0 (tie is not a win)', () => {
    // wolf: 4, opp1: 4, opp2: 5, opp3: 6  par-4
    const r = calculateHoleMoney([4, 4, 5, 6], WOLF(0), BLIND, 4);
    expect(r[0].blindWolf).toBe(0);
    expect(r[1].blindWolf).toBe(0);
    expect(r[0].total).toBe(0); // all tied → no blood
  });

  it('blind wolf wins low ball but no skin → +9 (low ball + bonus + blind; no skin)', () => {
    // wolf: 5, opps: 6, 7, 8  par-4 — wolf wins low ball but > par, no skin
    const r = calculateHoleMoney([5, 6, 7, 8], WOLF(0), BLIND, 4);
    expect(r[0].skin).toBe(0);
    expect(r[0].total).toBe(9); // low ball (+3) + bonus (+3) + blind (+3)
    expect(r[1].total).toBe(-3);
  });

  it('zero-sum holds on every component including blindWolf', () => {
    const r = calculateHoleMoney([3, 5, 5, 5], WOLF(0), BLIND, 4);
    const sumBW = r[0].blindWolf + r[1].blindWolf + r[2].blindWolf + r[3].blindWolf;
    const sumTo = r[0].total + r[1].total + r[2].total + r[3].total;
    expect(sumBW).toBe(0);
    expect(sumTo).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC: validateZeroSum called internally — all calculateHoleMoney outputs are valid
// ---------------------------------------------------------------------------
describe('calculateHoleMoney — all outputs pass validateZeroSum internally', () => {
  it('does not throw for any valid 2v2 scenario', () => {
    expect(() => calculateHoleMoney([3, 4, 5, 6], WOLF(0), PARTNER(1), 5)).not.toThrow();
    expect(() => calculateHoleMoney([4, 4, 4, 4], WOLF(0), PARTNER(1), 4)).not.toThrow();
    expect(() => calculateHoleMoney([5, 6, 3, 4], WOLF(0), PARTNER(1), 4)).not.toThrow();
  });

  it('does not throw for any valid 1v3 scenario', () => {
    expect(() => calculateHoleMoney([3, 5, 5, 5], WOLF(0), ALONE, 4)).not.toThrow();
    expect(() => calculateHoleMoney([6, 3, 4, 5], WOLF(0), ALONE, 4)).not.toThrow();
    expect(() => calculateHoleMoney([4, 4, 5, 6], WOLF(0), ALONE, 4)).not.toThrow();
  });

  it('does not throw for any valid blind wolf scenario', () => {
    expect(() => calculateHoleMoney([3, 5, 5, 5], WOLF(0), BLIND, 4)).not.toThrow();
    expect(() => calculateHoleMoney([6, 3, 4, 5], WOLF(0), BLIND, 4)).not.toThrow();
  });

  it('does not throw for any valid skins hole scenario', () => {
    expect(() => calculateHoleMoney([3, 5, 5, 5], SKINS, null, 4)).not.toThrow();
    expect(() => calculateHoleMoney([4, 4, 4, 4], SKINS, null, 4)).not.toThrow();
  });
});
