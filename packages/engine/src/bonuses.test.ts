import { describe, it, expect } from 'vitest';
import { detectBonusLevel, applyBonusModifiers } from './bonuses.js';
import { calculateHoleMoney } from './money.js';
import type { BonusInput, HoleAssignment, HoleMoneyResult, WolfDecision } from './types.js';

// ---------------------------------------------------------------------------
// Shorthands
// ---------------------------------------------------------------------------
const SKINS: HoleAssignment = { type: 'skins' };
const WOLF = (wolfBatterIndex: 0 | 1 | 2 | 3): HoleAssignment => ({ type: 'wolf', wolfBatterIndex });
const PARTNER = (partnerBatterIndex: 0 | 1 | 2 | 3): WolfDecision => ({ type: 'partner', partnerBatterIndex });
const ALONE: WolfDecision = { type: 'alone' };
const BLIND: WolfDecision = { type: 'blind_wolf' };
const NO_BONUS: BonusInput = { greenies: [], polies: [] };

/** All-zero base result — lets bonus tests verify the delta in isolation. */
function zeroBase(): HoleMoneyResult {
  return [
    { lowBall: 0, skin: 0, teamTotalOrBonus: 0, blindWolf: 0, bonusSkins: 0, total: 0 },
    { lowBall: 0, skin: 0, teamTotalOrBonus: 0, blindWolf: 0, bonusSkins: 0, total: 0 },
    { lowBall: 0, skin: 0, teamTotalOrBonus: 0, blindWolf: 0, bonusSkins: 0, total: 0 },
    { lowBall: 0, skin: 0, teamTotalOrBonus: 0, blindWolf: 0, bonusSkins: 0, total: 0 },
  ];
}

/** Extract the bonusSkins component from a result. */
function bs(r: HoleMoneyResult): readonly [number, number, number, number] {
  return [r[0].bonusSkins, r[1].bonusSkins, r[2].bonusSkins, r[3].bonusSkins];
}

/** Extract totals from a result. */
function tots(r: HoleMoneyResult): readonly [number, number, number, number] {
  return [r[0].total, r[1].total, r[2].total, r[3].total];
}

// No-bonus gross scores (all bogey — no birdie/eagle detection)
const NO_BONUS_GROSS: readonly [number, number, number, number] = [9, 9, 9, 9];

// ---------------------------------------------------------------------------
// detectBonusLevel — AC: 1
// ---------------------------------------------------------------------------
describe('detectBonusLevel', () => {
  it('par−1 → birdie (par 3, 4, 5)', () => {
    expect(detectBonusLevel(2, 3)).toBe('birdie');
    expect(detectBonusLevel(3, 4)).toBe('birdie');
    expect(detectBonusLevel(4, 5)).toBe('birdie');
  });

  it('par−2 → eagle', () => {
    expect(detectBonusLevel(1, 3)).toBe('eagle');
    expect(detectBonusLevel(2, 4)).toBe('eagle');
    expect(detectBonusLevel(3, 5)).toBe('eagle');
  });

  it('par−3 → double_eagle', () => {
    expect(detectBonusLevel(0, 3)).toBe('double_eagle');
    expect(detectBonusLevel(1, 4)).toBe('double_eagle');
    expect(detectBonusLevel(2, 5)).toBe('double_eagle');
  });

  it('≤ par−3 still returns double_eagle', () => {
    expect(detectBonusLevel(-1, 3)).toBe('double_eagle');
    expect(detectBonusLevel(0, 4)).toBe('double_eagle');
  });

  it('par → null', () => {
    expect(detectBonusLevel(3, 3)).toBeNull();
    expect(detectBonusLevel(4, 4)).toBeNull();
    expect(detectBonusLevel(5, 5)).toBeNull();
  });

  it('bogey or worse → null', () => {
    expect(detectBonusLevel(5, 4)).toBeNull();
    expect(detectBonusLevel(6, 4)).toBeNull();
    expect(detectBonusLevel(4, 3)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// applyBonusModifiers — 2v2 wolf holes (wolf=pos0, partner=pos1)
// AC: 2–6, 8–9, 11
// Bonus detection uses NET scores; double bonuses require ≥1 NATURAL.
// ---------------------------------------------------------------------------
describe('applyBonusModifiers — 2v2 (wolf=0, partner=1)', () => {
  const par = 4;

  it('no bonus events → bonusSkins all $0, totals unchanged', () => {
    const r = applyBonusModifiers(zeroBase(), [4, 4, 4, 4], [4, 4, 4, 4], NO_BONUS, WOLF(0), PARTNER(1), par);
    expect(bs(r)).toEqual([0, 0, 0, 0]);
    expect(tots(r)).toEqual([0, 0, 0, 0]);
  });

  it('net birdie on wolf team (pos0) → +1/+1/−1/−1 bonus skin', () => {
    const r = applyBonusModifiers(zeroBase(), [3, 5, 5, 5], [3, 5, 5, 5], NO_BONUS, WOLF(0), PARTNER(1), par);
    expect(bs(r)).toEqual([1, 1, -1, -1]);
    expect(tots(r)).toEqual([1, 1, -1, -1]);
  });

  it('net birdie on opponent team (pos2) → −1/−1/+1/+1 bonus skin', () => {
    const r = applyBonusModifiers(zeroBase(), [5, 5, 3, 5], [5, 5, 3, 5], NO_BONUS, WOLF(0), PARTNER(1), par);
    expect(bs(r)).toEqual([-1, -1, 1, 1]);
  });

  it('net eagle on wolf team (pos0) → 2 bonus skins (+2/+2/−2/−2)', () => {
    const r = applyBonusModifiers(zeroBase(), [2, 5, 5, 5], [2, 5, 5, 5], NO_BONUS, WOLF(0), PARTNER(1), par);
    expect(bs(r)).toEqual([2, 2, -2, -2]);
  });

  it('net double eagle on wolf team (pos0) → 3 bonus skins (+3/+3/−3/−3)', () => {
    const r = applyBonusModifiers(zeroBase(), [1, 5, 5, 5], [1, 5, 5, 5], NO_BONUS, WOLF(0), PARTNER(1), par);
    expect(bs(r)).toEqual([3, 3, -3, -3]);
  });

  it('double birdie bonus: both team members net+natural birdie → 2 birdie skins', () => {
    // pos0 net 3 + gross 3, pos1 net 3 + gross 3 — both natural birdies
    const r = applyBonusModifiers(zeroBase(), [3, 3, 5, 5], [3, 3, 5, 5], NO_BONUS, WOLF(0), PARTNER(1), par);
    expect(bs(r)).toEqual([2, 2, -2, -2]);
  });

  it('double birdie bonus: both net birdies, one natural → 2 birdie skins', () => {
    // pos0: net 3 (birdie), gross 3 (natural). pos1: net 3 (birdie), gross 5 (not natural).
    const r = applyBonusModifiers(zeroBase(), [3, 3, 5, 5], [3, 5, 5, 5], NO_BONUS, WOLF(0), PARTNER(1), par);
    expect(bs(r)).toEqual([2, 2, -2, -2]);
  });

  it('both net birdies but neither natural → 1 birdie skin (no double bonus)', () => {
    // pos0: net 3 (birdie), gross 5. pos1: net 3 (birdie), gross 6.
    const r = applyBonusModifiers(zeroBase(), [3, 3, 5, 5], [5, 6, 5, 5], NO_BONUS, WOLF(0), PARTNER(1), par);
    expect(bs(r)).toEqual([1, 1, -1, -1]);
  });

  it('net eagle + natural birdie → eagle (2) + double birdie (+1) = 3 skins', () => {
    // pos0: net 2 (eagle), gross 4 (not natural birdie). pos1: net 3 (birdie), gross 3 (natural birdie).
    const r = applyBonusModifiers(zeroBase(), [2, 3, 5, 5], [4, 3, 5, 5], NO_BONUS, WOLF(0), PARTNER(1), par);
    expect(bs(r)).toEqual([3, 3, -3, -3]);
  });

  it('double eagle bonus: both net eagles, one natural eagle → eagle (2) + dbl birdie (+1) + dbl eagle (+1) = 4', () => {
    // pos0: net 2 (eagle), gross 2 (natural eagle). pos1: net 2 (eagle), gross 4 (not natural).
    const r = applyBonusModifiers(zeroBase(), [2, 2, 5, 5], [2, 4, 5, 5], NO_BONUS, WOLF(0), PARTNER(1), par);
    expect(bs(r)).toEqual([4, 4, -4, -4]);
  });

  it('both net eagles but neither natural eagle → eagle (2) + dbl birdie (+1) = 3 (no dbl eagle)', () => {
    // pos0: net 2, gross 5. pos1: net 2, gross 5. Both have net birdie+, but no natural birdie either...
    // Actually gross 5 is NOT ≤ par-1 (3), so no natural birdie → no double birdie either.
    // Just eagle level (2 skins), no doubles.
    const r = applyBonusModifiers(zeroBase(), [2, 2, 5, 5], [5, 5, 5, 5], NO_BONUS, WOLF(0), PARTNER(1), par);
    expect(bs(r)).toEqual([2, 2, -2, -2]);
  });

  it('greenie on wolf team (pos0) → +1/+1/−1/−1 bonus skin', () => {
    const r = applyBonusModifiers(zeroBase(), [4, 4, 4, 4], NO_BONUS_GROSS, { greenies: [0], polies: [] }, WOLF(0), PARTNER(1), 3);
    expect(bs(r)).toEqual([1, 1, -1, -1]);
  });

  it('double greenie (both pos0 and pos1 in greenies) → 2 bonus skins', () => {
    const r = applyBonusModifiers(zeroBase(), [4, 4, 4, 4], NO_BONUS_GROSS, { greenies: [0, 1], polies: [] }, WOLF(0), PARTNER(1), 3);
    expect(bs(r)).toEqual([2, 2, -2, -2]);
  });

  it('greenie on opponent team → −1/−1/+1/+1', () => {
    const r = applyBonusModifiers(zeroBase(), [4, 4, 4, 4], NO_BONUS_GROSS, { greenies: [2], polies: [] }, WOLF(0), PARTNER(1), 3);
    expect(bs(r)).toEqual([-1, -1, 1, 1]);
  });

  it('polie on wolf team (pos0) → +1/+1/−1/−1 bonus skin', () => {
    const r = applyBonusModifiers(zeroBase(), [4, 4, 4, 4], NO_BONUS_GROSS, { greenies: [], polies: [0] }, WOLF(0), PARTNER(1), par);
    expect(bs(r)).toEqual([1, 1, -1, -1]);
  });

  it('two polies on same team (pos0, pos1) → 2 bonus skins (+2/+2/−2/−2)', () => {
    const r = applyBonusModifiers(zeroBase(), [4, 4, 4, 4], NO_BONUS_GROSS, { greenies: [], polies: [0, 1] }, WOLF(0), PARTNER(1), par);
    expect(bs(r)).toEqual([2, 2, -2, -2]);
  });

  it('two polies on different teams (pos0, pos2) → cancel ($0 all)', () => {
    const r = applyBonusModifiers(zeroBase(), [4, 4, 4, 4], NO_BONUS_GROSS, { greenies: [], polies: [0, 2] }, WOLF(0), PARTNER(1), par);
    expect(bs(r)).toEqual([0, 0, 0, 0]);
  });

  it('multiple bonuses stack: net birdie + polie on wolf team → 2 skins', () => {
    const r = applyBonusModifiers(zeroBase(), [3, 5, 5, 5], [3, 5, 5, 5], { greenies: [], polies: [0] }, WOLF(0), PARTNER(1), par);
    expect(bs(r)).toEqual([2, 2, -2, -2]);
  });

  it('bonusSkins sums to $0 across all 4 players', () => {
    const r = applyBonusModifiers(zeroBase(), [3, 4, 5, 6], [3, 4, 5, 6], { greenies: [0], polies: [2] }, WOLF(0), PARTNER(1), par);
    const sum = r[0].bonusSkins + r[1].bonusSkins + r[2].bonusSkins + r[3].bonusSkins;
    expect(sum).toBe(0);
  });

  it('total includes bonusSkins: total = base components + bonusSkins', () => {
    const base = calculateHoleMoney([3, 5, 5, 6], WOLF(0), PARTNER(1), par);
    const r = applyBonusModifiers(base, [3, 5, 5, 6], NO_BONUS_GROSS, NO_BONUS, WOLF(0), PARTNER(1), par);
    for (const p of r) {
      expect(p.total).toBe(p.lowBall + p.skin + p.teamTotalOrBonus + p.blindWolf + p.bonusSkins);
    }
  });

  it('net eagle (wolf team) vs net birdie (opp team) → wolf team wins 2 skins; birdie team earns $0', () => {
    const r = applyBonusModifiers(zeroBase(), [2, 5, 3, 5], [2, 5, 3, 5], NO_BONUS, WOLF(0), PARTNER(1), par);
    expect(bs(r)).toEqual([2, 2, -2, -2]);
  });

  it('tie on bonus level (each team has one net birdie) → no blood', () => {
    const r = applyBonusModifiers(zeroBase(), [3, 5, 3, 5], [3, 5, 3, 5], NO_BONUS, WOLF(0), PARTNER(1), par);
    expect(bs(r)).toEqual([0, 0, 0, 0]);
  });

  it('wolf at non-zero batting position (wolf=2, partner=3) resolves team correctly', () => {
    const r = applyBonusModifiers(zeroBase(), [5, 5, 3, 5], [5, 5, 3, 5], NO_BONUS, WOLF(2), PARTNER(3), par);
    expect(bs(r)).toEqual([-1, -1, 1, 1]);
  });
});

// ---------------------------------------------------------------------------
// applyBonusModifiers — 1v3 lone wolf (wolf=pos0, opps=1,2,3)
// AC: 7–9, 11
// ---------------------------------------------------------------------------
describe('applyBonusModifiers — 1v3 lone wolf', () => {
  const par = 4;

  it('no bonus events → bonusSkins all $0', () => {
    const r = applyBonusModifiers(zeroBase(), [4, 4, 4, 4], [4, 4, 4, 4], NO_BONUS, WOLF(0), ALONE, par);
    expect(bs(r)).toEqual([0, 0, 0, 0]);
  });

  it('wolf net birdie → wolf +3, each opp −1 bonus skin', () => {
    const r = applyBonusModifiers(zeroBase(), [3, 5, 5, 5], [3, 5, 5, 5], NO_BONUS, WOLF(0), ALONE, par);
    expect(bs(r)).toEqual([3, -1, -1, -1]);
  });

  it('wolf net eagle → wolf +6, each opp −2 (birdie + eagle = 2 skins)', () => {
    const r = applyBonusModifiers(zeroBase(), [2, 5, 5, 5], [2, 5, 5, 5], NO_BONUS, WOLF(0), ALONE, par);
    expect(bs(r)).toEqual([6, -2, -2, -2]);
  });

  it('wolf net double eagle → wolf +9, each opp −3 (3 skins)', () => {
    const r = applyBonusModifiers(zeroBase(), [1, 5, 5, 5], [1, 5, 5, 5], NO_BONUS, WOLF(0), ALONE, par);
    expect(bs(r)).toEqual([9, -3, -3, -3]);
  });

  it('opponent (pos1) net birdie → wolf −3, each opp +1 bonus skin', () => {
    const r = applyBonusModifiers(zeroBase(), [5, 3, 5, 5], [5, 3, 5, 5], NO_BONUS, WOLF(0), ALONE, par);
    expect(bs(r)).toEqual([-3, 1, 1, 1]);
  });

  it('opponent (pos1) net eagle → wolf −6, each opp +2', () => {
    const r = applyBonusModifiers(zeroBase(), [5, 2, 5, 5], [5, 2, 5, 5], NO_BONUS, WOLF(0), ALONE, par);
    expect(bs(r)).toEqual([-6, 2, 2, 2]);
  });

  it('two opponents each have a polie → 2 separate group skins (wolf −6, each opp +2)', () => {
    const r = applyBonusModifiers(zeroBase(), [4, 4, 4, 4], NO_BONUS_GROSS, { greenies: [], polies: [1, 2] }, WOLF(0), ALONE, par);
    expect(bs(r)).toEqual([-6, 2, 2, 2]);
  });

  it('opponent net eagle (opp1) + polie → 3 group skins (wolf −9, each opp +3)', () => {
    const r = applyBonusModifiers(zeroBase(), [5, 2, 5, 5], [5, 2, 5, 5], { greenies: [], polies: [1] }, WOLF(0), ALONE, par);
    expect(bs(r)).toEqual([-9, 3, 3, 3]);
  });

  it('two opponents net birdie → 2 separate group skins (no double birdie bonus in 1v3)', () => {
    const r = applyBonusModifiers(zeroBase(), [5, 3, 3, 5], [5, 3, 3, 5], NO_BONUS, WOLF(0), ALONE, par);
    expect(bs(r)).toEqual([-6, 2, 2, 2]);
  });

  it('wolf polie → wolf +3, each opp −1', () => {
    const r = applyBonusModifiers(zeroBase(), [4, 4, 4, 4], NO_BONUS_GROSS, { greenies: [], polies: [0] }, WOLF(0), ALONE, par);
    expect(bs(r)).toEqual([3, -1, -1, -1]);
  });

  it('wolf at non-zero batting position (wolf=3)', () => {
    const r = applyBonusModifiers(zeroBase(), [5, 5, 5, 3], [5, 5, 5, 3], NO_BONUS, WOLF(3), ALONE, par);
    expect(bs(r)).toEqual([-1, -1, -1, 3]);
  });

  it('bonusSkins component sums to $0 in 1v3', () => {
    const r = applyBonusModifiers(zeroBase(), [2, 3, 5, 5], [2, 3, 5, 5], { greenies: [], polies: [2] }, WOLF(0), ALONE, par);
    const sum = r[0].bonusSkins + r[1].bonusSkins + r[2].bonusSkins + r[3].bonusSkins;
    expect(sum).toBe(0);
  });

  it('blind wolf: same bonus structure as alone (blind modifier already in base)', () => {
    const r = applyBonusModifiers(zeroBase(), [3, 5, 5, 5], [3, 5, 5, 5], NO_BONUS, WOLF(0), BLIND, par);
    expect(bs(r)).toEqual([3, -1, -1, -1]);
  });
});

// ---------------------------------------------------------------------------
// applyBonusModifiers — skins holes (individual structure)
// AC: 10–11
// ---------------------------------------------------------------------------
describe('applyBonusModifiers — skins holes (individual structure)', () => {
  const par = 4;

  it('net birdie on skins hole → winner +3, others −1', () => {
    const r = applyBonusModifiers(zeroBase(), [3, 5, 5, 5], [3, 5, 5, 5], NO_BONUS, SKINS, null, par);
    expect(bs(r)).toEqual([3, -1, -1, -1]);
  });

  it('net eagle on skins hole → 2 skins: winner +6, others −2', () => {
    const r = applyBonusModifiers(zeroBase(), [2, 5, 5, 5], [2, 5, 5, 5], NO_BONUS, SKINS, null, par);
    expect(bs(r)).toEqual([6, -2, -2, -2]);
  });

  it('polie on skins hole → winner +3, others −1', () => {
    const r = applyBonusModifiers(zeroBase(), [4, 4, 4, 4], NO_BONUS_GROSS, { greenies: [], polies: [2] }, SKINS, null, par);
    expect(bs(r)).toEqual([-1, -1, 3, -1]);
  });

  it('greenie on skins hole → individual: winner +3, others −1', () => {
    const r = applyBonusModifiers(zeroBase(), [3, 3, 3, 3], NO_BONUS_GROSS, { greenies: [1], polies: [] }, SKINS, null, 3);
    expect(bs(r)).toEqual([-1, 3, -1, -1]);
  });

  it('two players have a bonus each on skins hole → correct net', () => {
    const r = applyBonusModifiers(zeroBase(), [4, 4, 4, 4], NO_BONUS_GROSS, { greenies: [], polies: [0, 1] }, SKINS, null, par);
    expect(bs(r)).toEqual([2, 2, -2, -2]);
  });

  it('bonusSkins sums to $0 on skins hole', () => {
    const r = applyBonusModifiers(zeroBase(), [2, 5, 5, 5], [2, 5, 5, 5], { greenies: [], polies: [1] }, SKINS, null, par);
    const sum = r[0].bonusSkins + r[1].bonusSkins + r[2].bonusSkins + r[3].bonusSkins;
    expect(sum).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// $21 wolf loss verification — AC: 9
// ---------------------------------------------------------------------------
describe('applyBonusModifiers — $21 wolf loss verification', () => {
  it('wolf alone loses 3 base skins + chip-in eagle (opp1) + separate polie (opp2) = −21 total', () => {
    const net: readonly [number, number, number, number] = [7, 2, 5, 5];
    const gross: readonly [number, number, number, number] = [7, 2, 5, 5];
    const base = calculateHoleMoney(net, WOLF(0), ALONE, 4);
    expect(base[0].total).toBe(-9);

    const r = applyBonusModifiers(
      base, net, gross,
      { greenies: [], polies: [1, 2] },
      WOLF(0), ALONE, 4,
    );

    expect(r[0].bonusSkins).toBe(-12);
    expect(r[1].bonusSkins).toBe(4);
    expect(r[2].bonusSkins).toBe(4);
    expect(r[3].bonusSkins).toBe(4);

    expect(r[0].total).toBe(-21);
    expect(r[1].total).toBe(7);
    expect(r[2].total).toBe(7);
    expect(r[3].total).toBe(7);

    const totalSum = r[0].total + r[1].total + r[2].total + r[3].total;
    expect(totalSum).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// validateZeroSum integration — AC: 11
// ---------------------------------------------------------------------------
describe('applyBonusModifiers — validateZeroSum integration', () => {
  it('all valid bonus results pass validateZeroSum (no throw)', () => {
    expect(() => applyBonusModifiers(zeroBase(), [3, 5, 5, 5], [3, 5, 5, 5], NO_BONUS, WOLF(0), PARTNER(1), 4)).not.toThrow();
    expect(() => applyBonusModifiers(zeroBase(), [2, 5, 5, 5], [2, 5, 5, 5], NO_BONUS, WOLF(0), ALONE, 4)).not.toThrow();
    expect(() => applyBonusModifiers(zeroBase(), [3, 5, 5, 5], [3, 5, 5, 5], NO_BONUS, SKINS, null, 4)).not.toThrow();
    expect(() => applyBonusModifiers(zeroBase(), [3, 3, 5, 5], [3, 3, 5, 5], NO_BONUS, WOLF(0), PARTNER(1), 4)).not.toThrow();
  });
});
