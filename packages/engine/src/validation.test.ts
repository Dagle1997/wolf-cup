import { describe, it, expect } from 'vitest';
import { validateZeroSum } from './validation.js';
import { ZeroSumViolationError } from './types.js';
import type { HoleMoneyResult } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(
  p0: Partial<{ lowBall: number; skin: number; teamTotalOrBonus: number; blindWolf: number; bonusSkins: number; total: number }>,
  p1: Partial<{ lowBall: number; skin: number; teamTotalOrBonus: number; blindWolf: number; bonusSkins: number; total: number }>,
  p2: Partial<{ lowBall: number; skin: number; teamTotalOrBonus: number; blindWolf: number; bonusSkins: number; total: number }>,
  p3: Partial<{ lowBall: number; skin: number; teamTotalOrBonus: number; blindWolf: number; bonusSkins: number; total: number }>,
): HoleMoneyResult {
  const fill = (p: typeof p0) => ({
    lowBall: p.lowBall ?? 0,
    skin: p.skin ?? 0,
    teamTotalOrBonus: p.teamTotalOrBonus ?? 0,
    blindWolf: p.blindWolf ?? 0,
    bonusSkins: p.bonusSkins ?? 0,
    total: p.total ?? 0,
  });
  return [fill(p0), fill(p1), fill(p2), fill(p3)];
}

/** All-zero result — trivially valid */
const ZERO_RESULT: HoleMoneyResult = [
  { lowBall: 0, skin: 0, teamTotalOrBonus: 0, blindWolf: 0, bonusSkins: 0, total: 0 },
  { lowBall: 0, skin: 0, teamTotalOrBonus: 0, blindWolf: 0, bonusSkins: 0, total: 0 },
  { lowBall: 0, skin: 0, teamTotalOrBonus: 0, blindWolf: 0, bonusSkins: 0, total: 0 },
  { lowBall: 0, skin: 0, teamTotalOrBonus: 0, blindWolf: 0, bonusSkins: 0, total: 0 },
];

/** 2v2 full sweep: team 0+1 win all 3 → +3/+3/−3/−3 */
const SWEEP_RESULT: HoleMoneyResult = [
  { lowBall: 1, skin: 1, teamTotalOrBonus: 1, blindWolf: 0, bonusSkins: 0, total: 3 },
  { lowBall: 1, skin: 1, teamTotalOrBonus: 1, blindWolf: 0, bonusSkins: 0, total: 3 },
  { lowBall: -1, skin: -1, teamTotalOrBonus: -1, blindWolf: 0, bonusSkins: 0, total: -3 },
  { lowBall: -1, skin: -1, teamTotalOrBonus: -1, blindWolf: 0, bonusSkins: 0, total: -3 },
];

/** 1v3 wolf wins all → +9/−3/−3/−3 */
const WOLF_WIN_RESULT: HoleMoneyResult = [
  { lowBall: 3, skin: 3, teamTotalOrBonus: 3, blindWolf: 0, bonusSkins: 0, total: 9 },
  { lowBall: -1, skin: -1, teamTotalOrBonus: -1, blindWolf: 0, bonusSkins: 0, total: -3 },
  { lowBall: -1, skin: -1, teamTotalOrBonus: -1, blindWolf: 0, bonusSkins: 0, total: -3 },
  { lowBall: -1, skin: -1, teamTotalOrBonus: -1, blindWolf: 0, bonusSkins: 0, total: -3 },
];

/** Blind wolf full win: +12/−4/−4/−4 */
const BLIND_WOLF_WIN: HoleMoneyResult = [
  { lowBall: 3, skin: 3, teamTotalOrBonus: 3, blindWolf: 3, bonusSkins: 0, total: 12 },
  { lowBall: -1, skin: -1, teamTotalOrBonus: -1, blindWolf: -1, bonusSkins: 0, total: -4 },
  { lowBall: -1, skin: -1, teamTotalOrBonus: -1, blindWolf: -1, bonusSkins: 0, total: -4 },
  { lowBall: -1, skin: -1, teamTotalOrBonus: -1, blindWolf: -1, bonusSkins: 0, total: -4 },
];

describe('validateZeroSum', () => {
  describe('valid results — must not throw', () => {
    it('all-zero result passes', () => {
      expect(() => validateZeroSum(ZERO_RESULT)).not.toThrow();
    });

    it('2v2 full sweep (+3/+3/−3/−3) passes', () => {
      expect(() => validateZeroSum(SWEEP_RESULT)).not.toThrow();
    });

    it('1v3 wolf wins all (+9/−3/−3/−3) passes', () => {
      expect(() => validateZeroSum(WOLF_WIN_RESULT)).not.toThrow();
    });

    it('blind wolf full win (+12/−4/−4/−4) passes', () => {
      expect(() => validateZeroSum(BLIND_WOLF_WIN)).not.toThrow();
    });

    it('skins hole result (skin only, individual) passes', () => {
      const result: HoleMoneyResult = [
        { lowBall: 0, skin: 3, teamTotalOrBonus: 0, blindWolf: 0, bonusSkins: 0, total: 3 },
        { lowBall: 0, skin: -1, teamTotalOrBonus: 0, blindWolf: 0, bonusSkins: 0, total: -1 },
        { lowBall: 0, skin: -1, teamTotalOrBonus: 0, blindWolf: 0, bonusSkins: 0, total: -1 },
        { lowBall: 0, skin: -1, teamTotalOrBonus: 0, blindWolf: 0, bonusSkins: 0, total: -1 },
      ];
      expect(() => validateZeroSum(result)).not.toThrow();
    });
  });

  describe('violations — must throw ZeroSumViolationError', () => {
    it('lowBall sum ≠ 0 → throws with component "lowBall"', () => {
      const bad = makeResult(
        { lowBall: 2 }, { lowBall: -1 }, { lowBall: -1 }, { lowBall: -1 },
      );
      expect(() => validateZeroSum(bad)).toThrowError(ZeroSumViolationError);
      try {
        validateZeroSum(bad);
      } catch (e) {
        expect((e as ZeroSumViolationError).component).toBe('lowBall');
      }
    });

    it('skin sum ≠ 0 → throws with component "skin"', () => {
      const bad = makeResult(
        { skin: 3 }, { skin: -1 }, { skin: -1 }, { skin: 0 }, // sum = 1
      );
      expect(() => validateZeroSum(bad)).toThrowError(ZeroSumViolationError);
      try {
        validateZeroSum(bad);
      } catch (e) {
        expect((e as ZeroSumViolationError).component).toBe('skin');
      }
    });

    it('teamTotalOrBonus sum ≠ 0 → throws with component "teamTotalOrBonus"', () => {
      const bad = makeResult(
        { teamTotalOrBonus: 2 }, { teamTotalOrBonus: 1 }, { teamTotalOrBonus: -1 }, { teamTotalOrBonus: -1 },
      );
      expect(() => validateZeroSum(bad)).toThrowError(ZeroSumViolationError);
      try {
        validateZeroSum(bad);
      } catch (e) {
        expect((e as ZeroSumViolationError).component).toBe('teamTotalOrBonus');
      }
    });

    it('blindWolf sum ≠ 0 → throws with component "blindWolf"', () => {
      const bad = makeResult(
        { blindWolf: 3 }, { blindWolf: -1 }, { blindWolf: -1 }, { blindWolf: 0 }, // sum = 1
      );
      expect(() => validateZeroSum(bad)).toThrowError(ZeroSumViolationError);
      try {
        validateZeroSum(bad);
      } catch (e) {
        expect((e as ZeroSumViolationError).component).toBe('blindWolf');
      }
    });

    it('bonusSkins sum ≠ 0 → throws with component "bonusSkins"', () => {
      const bad = makeResult(
        { bonusSkins: 3 }, { bonusSkins: -1 }, { bonusSkins: -1 }, { bonusSkins: 0 }, // sum = 1
      );
      expect(() => validateZeroSum(bad)).toThrowError(ZeroSumViolationError);
      try {
        validateZeroSum(bad);
      } catch (e) {
        expect((e as ZeroSumViolationError).component).toBe('bonusSkins');
      }
    });

    it('total sum ≠ 0 → throws with component "total"', () => {
      const bad = makeResult(
        { total: 5 }, { total: -1 }, { total: -1 }, { total: -1 }, // sum = 2
      );
      expect(() => validateZeroSum(bad)).toThrowError(ZeroSumViolationError);
      try {
        validateZeroSum(bad);
      } catch (e) {
        expect((e as ZeroSumViolationError).component).toBe('total');
      }
    });

    it('error.sum field contains the actual non-zero sum', () => {
      const bad = makeResult(
        { lowBall: 3 }, { lowBall: 0 }, { lowBall: 0 }, { lowBall: 0 }, // sum = 3
      );
      try {
        validateZeroSum(bad);
        expect.fail('should have thrown');
      } catch (e) {
        expect((e as ZeroSumViolationError).sum).toBe(3);
      }
    });

    it('throws ZeroSumViolationError instance (not generic Error)', () => {
      const bad = makeResult({ lowBall: 1 }, {}, {}, {});
      try {
        validateZeroSum(bad);
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ZeroSumViolationError);
        expect((e as ZeroSumViolationError).name).toBe('ZeroSumViolationError');
      }
    });
  });
});
