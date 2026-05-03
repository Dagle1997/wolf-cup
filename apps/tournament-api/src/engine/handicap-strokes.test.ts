/**
 * T6-1 unit tests for engine/handicap-strokes.ts.
 *
 * Pure function; no DB. 7 cases per AC-13:
 *   (i)   HI 0 → 0 strokes any SI
 *   (ii)  HI 9 → 1 on SI 1..9; 0 on SI 10..18
 *   (iii) HI 15 → 1 on SI 1..15
 *   (iv)  HI 18 → 1 on every SI
 *   (v)   HI 27 (slope-adjusted CH ≥ 18) → 2 on SI 1..(CH−18); 1 on rest
 *   (vi)  CH=18 boundary → 1 every SI
 *   (vii) plus-handicap clamp → 0 every SI
 */
import { describe, expect, test } from 'vitest';
import {
  calcCourseHandicap,
  getHandicapStrokes,
  type TeeShape,
} from './handicap-strokes.js';

// Reference tee approximating "neutral" Pinehurst-style: slope 113 + rating == par
// makes calcCourseHandicap return Math.round(handicapIndex × 1 + 0) = round(handicapIndex).
// This isolates the SI-allocation math from slope-adjustment math for cases (i)–(iv).
const NEUTRAL_TEE: TeeShape = {
  slope: 113,
  ratingTimes10: 720, // 72.0 rating
  coursePar: 72,
};

describe('getHandicapStrokes — AC-13 cases', () => {
  test('(i) HI 0 → 0 strokes on every SI', () => {
    for (let si = 1; si <= 18; si++) {
      expect(getHandicapStrokes(0, si, NEUTRAL_TEE)).toBe(0);
    }
  });

  test('(ii) HI 9 → 1 stroke on SI 1..9; 0 on SI 10..18', () => {
    for (let si = 1; si <= 9; si++) {
      expect(getHandicapStrokes(9, si, NEUTRAL_TEE)).toBe(1);
    }
    for (let si = 10; si <= 18; si++) {
      expect(getHandicapStrokes(9, si, NEUTRAL_TEE)).toBe(0);
    }
  });

  test('(iii) HI 15 → 1 stroke on SI 1..15; 0 on SI 16..18', () => {
    for (let si = 1; si <= 15; si++) {
      expect(getHandicapStrokes(15, si, NEUTRAL_TEE)).toBe(1);
    }
    for (let si = 16; si <= 18; si++) {
      expect(getHandicapStrokes(15, si, NEUTRAL_TEE)).toBe(0);
    }
  });

  test('(iv) HI 18 → 1 stroke on every SI', () => {
    for (let si = 1; si <= 18; si++) {
      expect(getHandicapStrokes(18, si, NEUTRAL_TEE)).toBe(1);
    }
  });

  test('(v) HI 27 → 2 strokes on SI 1..9; 1 stroke on SI 10..18', () => {
    // CH = round(27 × 1 + 0) = 27. base = 1, extra = 9.
    for (let si = 1; si <= 9; si++) {
      expect(getHandicapStrokes(27, si, NEUTRAL_TEE)).toBe(2);
    }
    for (let si = 10; si <= 18; si++) {
      expect(getHandicapStrokes(27, si, NEUTRAL_TEE)).toBe(1);
    }
  });

  test('(vi) CH=18 boundary → 1 stroke on every SI; 0 nowhere', () => {
    // HI 18 with NEUTRAL_TEE → CH = 18. base = 1, extra = 0.
    for (let si = 1; si <= 18; si++) {
      expect(getHandicapStrokes(18, si, NEUTRAL_TEE)).toBe(1);
    }
  });

  test('(vii) plus-handicap clamp — HI -3 → 0 strokes on every SI', () => {
    // CH = round(-3 × 1 + 0) = -3. Plus-handicap clamp returns 0 immediately.
    expect(calcCourseHandicap({ handicapIndex: -3, ...NEUTRAL_TEE })).toBe(-3);
    for (let si = 1; si <= 18; si++) {
      expect(getHandicapStrokes(-3, si, NEUTRAL_TEE)).toBe(0);
    }
  });
});

describe('getHandicapStrokes — slope-adjusted (non-neutral tee)', () => {
  test('HI 12 at high-slope tee (140) → CH = round(12 × 140/113) = 15', () => {
    // 12 × 140/113 ≈ 14.867 → round(14.867) = 15
    const tee: TeeShape = { slope: 140, ratingTimes10: 720, coursePar: 72 };
    const ch = calcCourseHandicap({ handicapIndex: 12, ...tee });
    expect(ch).toBe(15);
    for (let si = 1; si <= 15; si++) {
      expect(getHandicapStrokes(12, si, tee)).toBe(1);
    }
    for (let si = 16; si <= 18; si++) {
      expect(getHandicapStrokes(12, si, tee)).toBe(0);
    }
  });

  test('HI 12 at non-neutral rating (rating > par) → CH bumped up', () => {
    // rating 73.0, par 72: contributes +1 to CH. 12 × 1 + 1 = 13.
    const tee: TeeShape = { slope: 113, ratingTimes10: 730, coursePar: 72 };
    const ch = calcCourseHandicap({ handicapIndex: 12, ...tee });
    expect(ch).toBe(13);
    expect(getHandicapStrokes(12, 13, tee)).toBe(1);
    expect(getHandicapStrokes(12, 14, tee)).toBe(0);
  });
});

describe('calcCourseHandicap — input validation', () => {
  test('throws on NaN handicapIndex', () => {
    expect(() =>
      calcCourseHandicap({ handicapIndex: NaN, ...NEUTRAL_TEE }),
    ).toThrow();
  });

  test('throws on zero slope', () => {
    expect(() =>
      calcCourseHandicap({ handicapIndex: 12, slope: 0, ratingTimes10: 720, coursePar: 72 }),
    ).toThrow();
  });
});
