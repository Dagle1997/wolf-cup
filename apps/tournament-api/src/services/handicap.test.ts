import { describe, expect, test } from 'vitest';
import { allocateNetThroughHole, calcCourseHandicap } from './handicap.js';

describe('calcCourseHandicap (USGA slope-aware)', () => {
  test('Pinehurst No. 2 blue tees with index 12.4', () => {
    // No. 2 blue: rating ~74.8 (so ratingTimes10 = 748), slope ~145, par 72.
    // Expected: round(12.4 × (145/113) + (74.8 − 72))
    //         = round(12.4 × 1.28319 + 2.8)
    //         = round(15.91 + 2.8)
    //         = round(18.71) = 19
    expect(
      calcCourseHandicap({
        handicapIndex: 12.4,
        slope: 145,
        ratingTimes10: 748,
        coursePar: 72,
      }),
    ).toBe(19);
  });

  test('Scratch player (index 0.0) gets handicap from rating-vs-par alone', () => {
    // 0.0 × anything = 0; result is round(rating − par). Pine Needles white
    // (rating 70.5, slope 128, par 71) → round(70.5 − 71) = round(-0.5) = 0.
    expect(
      calcCourseHandicap({
        handicapIndex: 0.0,
        slope: 128,
        ratingTimes10: 705,
        coursePar: 71,
      }),
    ).toBe(0);
  });

  test('High-handicap player (index 28.5) at a tough course', () => {
    // round(28.5 × (140/113) + (73.5 − 72))
    //   = round(28.5 × 1.23894 + 1.5)
    //   = round(35.31 + 1.5)
    //   = round(36.81) = 37
    expect(
      calcCourseHandicap({
        handicapIndex: 28.5,
        slope: 140,
        ratingTimes10: 735,
        coursePar: 72,
      }),
    ).toBe(37);
  });

  test('Easier course (lower slope + rating below par) lowers the handicap', () => {
    // Standard 113-slope par-72 course at exact par rating: handicap === index
    expect(
      calcCourseHandicap({
        handicapIndex: 10.0,
        slope: 113,
        ratingTimes10: 720,
        coursePar: 72,
      }),
    ).toBe(10);
  });

  test('Throws on NaN handicap index', () => {
    expect(() =>
      calcCourseHandicap({
        handicapIndex: NaN,
        slope: 130,
        ratingTimes10: 720,
        coursePar: 72,
      }),
    ).toThrow(/handicapIndex/);
  });

  test('Throws on missing slope', () => {
    expect(() =>
      calcCourseHandicap({
        handicapIndex: 12,
        slope: 0,
        ratingTimes10: 720,
        coursePar: 72,
      }),
    ).toThrow(/slope/);
  });

  test('Throws on missing rating', () => {
    expect(() =>
      calcCourseHandicap({
        handicapIndex: 12,
        slope: 130,
        ratingTimes10: 0,
        coursePar: 72,
      }),
    ).toThrow(/ratingTimes10/);
  });

  test('Throws on missing coursePar', () => {
    expect(() =>
      calcCourseHandicap({
        handicapIndex: 12,
        slope: 130,
        ratingTimes10: 720,
        coursePar: 0,
      }),
    ).toThrow(/coursePar/);
  });
});

describe('allocateNetThroughHole', () => {
  test('returns 0 when no holes scored', () => {
    expect(allocateNetThroughHole({ courseHandicap: 18, throughHole: 0 })).toBe(0);
  });

  test('returns full handicap at 18 holes', () => {
    expect(allocateNetThroughHole({ courseHandicap: 18, throughHole: 18 })).toBe(18);
  });

  test('returns proportional allocation through 9 holes (half)', () => {
    // round(18 × 9 / 18) = round(9) = 9
    expect(allocateNetThroughHole({ courseHandicap: 18, throughHole: 9 })).toBe(9);
  });

  test('rounds half-up on fractional allocation', () => {
    // round(15 × 9 / 18) = round(7.5) = 8 (Math.round rounds .5 up for positives)
    expect(allocateNetThroughHole({ courseHandicap: 15, throughHole: 9 })).toBe(8);
  });

  test('clamps at full handicap when throughHole somehow exceeds 18', () => {
    expect(allocateNetThroughHole({ courseHandicap: 18, throughHole: 27 })).toBe(18);
  });

  test('proportional with small handicap and partial holes', () => {
    // round(4 × 5 / 18) = round(1.111) = 1
    expect(allocateNetThroughHole({ courseHandicap: 4, throughHole: 5 })).toBe(1);
  });
});
