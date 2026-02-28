import { describe, it, expect } from 'vitest';
import { getCourseHole, getAllCourseHoles } from './course.js';
import { InvalidHoleError } from './types.js';

describe('getCourseHole', () => {
  describe('par values for all 18 holes', () => {
    const expectedPars: Record<number, 3|4|5> = {
      1: 5, 2: 4, 3: 4, 4: 4, 5: 4,
      6: 3, 7: 3, 8: 5, 9: 4,
      10: 4, 11: 5, 12: 3, 13: 4, 14: 4,
      15: 3, 16: 4, 17: 4, 18: 4,
    };

    for (const [holeStr, par] of Object.entries(expectedPars)) {
      const hole = Number(holeStr);
      it(`hole ${hole} has par ${par}`, () => {
        expect(getCourseHole(hole).par).toBe(par);
      });
    }
  });

  describe('stroke index values for all 18 holes', () => {
    const expectedStrokeIndex: Record<number, number> = {
      1: 3,  2: 1,  3: 13, 4: 5,  5: 9,
      6: 17, 7: 15, 8: 7,  9: 11,
      10: 8, 11: 2, 12: 18, 13: 6, 14: 10,
      15: 16, 16: 4, 17: 14, 18: 12,
    };

    for (const [holeStr, si] of Object.entries(expectedStrokeIndex)) {
      const hole = Number(holeStr);
      it(`hole ${hole} has strokeIndex ${si}`, () => {
        expect(getCourseHole(hole).strokeIndex).toBe(si);
      });
    }
  });

  describe('black tee yardages for all 18 holes', () => {
    const expectedBlack: Record<number, number> = {
      1: 558, 2: 444, 3: 339, 4: 358, 5: 423,
      6: 148, 7: 222, 8: 525, 9: 387,
      10: 352, 11: 561, 12: 165, 13: 378, 14: 361,
      15: 191, 16: 390, 17: 341, 18: 380,
    };

    for (const [holeStr, yardage] of Object.entries(expectedBlack)) {
      const hole = Number(holeStr);
      it(`hole ${hole} black: ${yardage} yards`, () => {
        expect(getCourseHole(hole).yardages.black).toBe(yardage);
      });
    }
  });

  describe('blue tee yardages for all 18 holes', () => {
    const expectedBlue: Record<number, number> = {
      1: 543, 2: 396, 3: 325, 4: 353, 5: 409,
      6: 135, 7: 201, 8: 515, 9: 331,
      10: 344, 11: 547, 12: 156, 13: 365, 14: 341,
      15: 167, 16: 381, 17: 334, 18: 366,
    };

    for (const [holeStr, yardage] of Object.entries(expectedBlue)) {
      const hole = Number(holeStr);
      it(`hole ${hole} blue: ${yardage} yards`, () => {
        expect(getCourseHole(hole).yardages.blue).toBe(yardage);
      });
    }
  });

  describe('white tee yardages for all 18 holes', () => {
    const expectedWhite: Record<number, number> = {
      1: 497, 2: 396, 3: 325, 4: 276, 5: 402,
      6: 135, 7: 188, 8: 499, 9: 331,
      10: 344, 11: 474, 12: 156, 13: 365, 14: 309,
      15: 140, 16: 328, 17: 296, 18: 334,
    };

    for (const [holeStr, yardage] of Object.entries(expectedWhite)) {
      const hole = Number(holeStr);
      it(`hole ${hole} white: ${yardage} yards`, () => {
        expect(getCourseHole(hole).yardages.white).toBe(yardage);
      });
    }
  });

  describe('all tee yardages for hole 1', () => {
    it('hole 1 yardages: black 558, blue 543, white 497', () => {
      const h = getCourseHole(1);
      expect(h.yardages).toEqual({ black: 558, blue: 543, white: 497 });
    });
  });

  describe('hole number on returned object', () => {
    it('getCourseHole(5).hole === 5', () => {
      expect(getCourseHole(5).hole).toBe(5);
    });
    it('getCourseHole(18).hole === 18', () => {
      expect(getCourseHole(18).hole).toBe(18);
    });
  });

  describe('InvalidHoleError on invalid input', () => {
    it('throws InvalidHoleError for hole 0', () => {
      expect(() => getCourseHole(0)).toThrowError(InvalidHoleError);
    });
    it('throws InvalidHoleError for hole 19', () => {
      expect(() => getCourseHole(19)).toThrowError(InvalidHoleError);
    });
    it('throws InvalidHoleError for negative number', () => {
      expect(() => getCourseHole(-1)).toThrowError(InvalidHoleError);
    });
    it('throws InvalidHoleError for decimal', () => {
      expect(() => getCourseHole(1.5)).toThrowError(InvalidHoleError);
    });
    it('error message contains the invalid number', () => {
      expect(() => getCourseHole(99)).toThrowError(/99/);
    });
    it('error name is InvalidHoleError', () => {
      try {
        getCourseHole(0);
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(InvalidHoleError);
        expect((e as InvalidHoleError).name).toBe('InvalidHoleError');
        expect((e as InvalidHoleError).holeNumber).toBe(0);
      }
    });
  });
});

describe('getAllCourseHoles', () => {
  it('returns exactly 18 holes', () => {
    expect(getAllCourseHoles()).toHaveLength(18);
  });

  it('holes are in order 1–18', () => {
    const holes = getAllCourseHoles();
    for (let i = 0; i < 18; i++) {
      expect(holes[i]?.hole).toBe(i + 1);
    }
  });

  it('front 9 total par is 36', () => {
    const holes = getAllCourseHoles();
    const frontPar = holes.slice(0, 9).reduce((sum, h) => sum + h.par, 0);
    expect(frontPar).toBe(36);
  });

  it('back 9 total par is 35', () => {
    const holes = getAllCourseHoles();
    const backPar = holes.slice(9, 18).reduce((sum, h) => sum + h.par, 0);
    expect(backPar).toBe(35);
  });

  it('total par is 71', () => {
    const totalPar = getAllCourseHoles().reduce((sum, h) => sum + h.par, 0);
    expect(totalPar).toBe(71);
  });

  it('stroke indexes are all unique (1–18, no duplicates)', () => {
    const indexes = getAllCourseHoles().map(h => h.strokeIndex);
    const unique = new Set(indexes);
    expect(unique.size).toBe(18);
  });

  it('stroke indexes sum to 171 (1+2+...+18)', () => {
    const sum = getAllCourseHoles().reduce((acc, h) => acc + h.strokeIndex, 0);
    expect(sum).toBe(171);
  });

  it('stroke indexes contain all values 1–18', () => {
    const indexes = new Set(getAllCourseHoles().map(h => h.strokeIndex));
    for (let i = 1; i <= 18; i++) {
      expect(indexes.has(i)).toBe(true);
    }
  });

  it('black total yardage is 6523', () => {
    const total = getAllCourseHoles().reduce((sum, h) => sum + h.yardages.black, 0);
    expect(total).toBe(6523);
  });

  it('blue total yardage is 6209', () => {
    const total = getAllCourseHoles().reduce((sum, h) => sum + h.yardages.blue, 0);
    expect(total).toBe(6209);
  });

  it('white total yardage is 5795', () => {
    const total = getAllCourseHoles().reduce((sum, h) => sum + h.yardages.white, 0);
    expect(total).toBe(5795);
  });
});
