import { describe, it, expect } from 'vitest';
import { getHandicapStrokes, calculateStablefordPoints } from './stableford.js';

describe('getHandicapStrokes', () => {
  describe('handicap 0: 0 strokes on all holes', () => {
    for (let si = 1; si <= 18; si++) {
      it(`SI ${si} → 0 strokes`, () => {
        expect(getHandicapStrokes(0, si)).toBe(0);
      });
    }
  });

  describe('handicap 9: 1 stroke on SI 1–9, 0 on SI 10–18', () => {
    for (let si = 1; si <= 9; si++) {
      it(`SI ${si} → 1 stroke`, () => {
        expect(getHandicapStrokes(9, si)).toBe(1);
      });
    }
    for (let si = 10; si <= 18; si++) {
      it(`SI ${si} → 0 strokes`, () => {
        expect(getHandicapStrokes(9, si)).toBe(0);
      });
    }
  });

  describe('handicap 18: 1 stroke on all 18 holes', () => {
    for (let si = 1; si <= 18; si++) {
      it(`SI ${si} → 1 stroke`, () => {
        expect(getHandicapStrokes(18, si)).toBe(1);
      });
    }
  });

  describe('handicap 27: 2 strokes on SI 1–9, 1 stroke on SI 10–18', () => {
    for (let si = 1; si <= 9; si++) {
      it(`SI ${si} → 2 strokes`, () => {
        expect(getHandicapStrokes(27, si)).toBe(2);
      });
    }
    for (let si = 10; si <= 18; si++) {
      it(`SI ${si} → 1 stroke`, () => {
        expect(getHandicapStrokes(27, si)).toBe(1);
      });
    }
  });

  describe('handicap 36: 2 strokes on all holes', () => {
    for (let si = 1; si <= 18; si++) {
      it(`SI ${si} → 2 strokes`, () => {
        expect(getHandicapStrokes(36, si)).toBe(2);
      });
    }
  });

  describe('decimal inputs are rounded', () => {
    it('18.5 rounds to 19: SI 1 → 2 strokes', () => {
      // hcp 19: base=1, extra=1 → SI 1 gets base+1=2
      expect(getHandicapStrokes(18.5, 1)).toBe(2);
    });
    it('18.5 rounds to 19: SI 2 → 1 stroke', () => {
      // hcp 19: base=1, extra=1 → SI 2 gets base+0=1
      expect(getHandicapStrokes(18.5, 2)).toBe(1);
    });
    it('18.4 rounds to 18: SI 1 → 1 stroke', () => {
      expect(getHandicapStrokes(18.4, 1)).toBe(1);
    });
  });

  // Plus / negative course handicaps (near-scratch players on white/blue tees).
  // USGA allocation: strokes are GIVEN BACK starting from the easiest hole
  // (highest stroke index). Regression for the negative-CH bug where `ch % 18`
  // kept its sign and charged −1 on all 18 holes.
  describe('handicap −1: gives back 1 stroke on SI 18 only', () => {
    it('SI 18 → −1 stroke', () => {
      expect(getHandicapStrokes(-1, 18)).toBe(-1);
    });
    for (let si = 1; si <= 17; si++) {
      it(`SI ${si} → 0 strokes`, () => {
        expect(getHandicapStrokes(-1, si)).toBe(0);
      });
    }
  });

  describe('handicap −2: gives back 1 stroke on SI 17 and 18', () => {
    it('SI 17 → −1, SI 18 → −1, SI 16 → 0', () => {
      expect(getHandicapStrokes(-2, 17)).toBe(-1);
      expect(getHandicapStrokes(-2, 18)).toBe(-1);
      expect(getHandicapStrokes(-2, 16)).toBe(0);
    });
  });

  describe('handicap −19: −1 on every hole plus a 2nd give-back on SI 18', () => {
    it('SI 18 → −2', () => {
      expect(getHandicapStrokes(-19, 18)).toBe(-2);
    });
    for (let si = 1; si <= 17; si++) {
      it(`SI ${si} → −1 stroke`, () => {
        expect(getHandicapStrokes(-19, si)).toBe(-1);
      });
    }
  });

  describe('invariant: per-hole strokes sum to the course handicap over 18 holes', () => {
    for (const ch of [-19, -2, -1, 0, 1, 9, 18, 19, 27, 36]) {
      it(`ch ${ch} → strokes sum to ${ch}`, () => {
        let sum = 0;
        for (let si = 1; si <= 18; si++) sum += getHandicapStrokes(ch, si);
        expect(sum).toBe(ch);
      });
    }
  });

  describe('plus handicap Stableford: a scratch-plus player nets +1 only on the easiest hole', () => {
    it('ch −1, par-4 SI 18, gross 4 → net 5 (bogey) → 1 pt', () => {
      // SI 18 gives back a stroke: net = 4 − (−1) = 5 = +1 vs par → 1 pt
      expect(calculateStablefordPoints(4, -1, 4, 18)).toBe(1);
    });
    it('ch −1, par-4 SI 1, gross 4 → net 4 (par) → 2 pts (no give-back on hardest hole)', () => {
      expect(calculateStablefordPoints(4, -1, 4, 1)).toBe(2);
    });
  });
});

describe('calculateStablefordPoints', () => {
  describe('AC example 1: hcp 18, par-4, SI 1, gross 5 → 2 (net par)', () => {
    it('calculateStablefordPoints(5, 18, 4, 1) === 2', () => {
      expect(calculateStablefordPoints(5, 18, 4, 1)).toBe(2);
    });
  });

  describe('AC example 2: hcp 36, par-3, SI 1, gross 4 → 3 (net birdie)', () => {
    it('calculateStablefordPoints(4, 36, 3, 1) === 3', () => {
      expect(calculateStablefordPoints(4, 36, 3, 1)).toBe(3);
    });
  });

  describe('all 6 point outcomes', () => {
    it('net ≤−3 → 5: hcp 36, par-4, SI 1, gross 1 (net −1 vs par 4 → net+strokes: 1+2=net1, 1−4=−3)', () => {
      // hcp 36: 2 strokes on SI 1; gross 1, net = 1−2 = −1 vs par 4 → −1−4 = −5 ≤ −3 → 5
      expect(calculateStablefordPoints(1, 36, 4, 1)).toBe(5);
    });

    it('net −2 → 4: hcp 0, par-5, SI 1, gross 3 (net 3−5=−2 → eagle)', () => {
      expect(calculateStablefordPoints(3, 0, 5, 1)).toBe(4);
    });

    it('net −1 → 3: hcp 0, par-4, SI 1, gross 3 (net 3−4=−1 → birdie)', () => {
      expect(calculateStablefordPoints(3, 0, 4, 1)).toBe(3);
    });

    it('net 0 → 2: hcp 0, par-4, SI 1, gross 4 (net par)', () => {
      expect(calculateStablefordPoints(4, 0, 4, 1)).toBe(2);
    });

    it('net +1 → 1: hcp 0, par-4, SI 1, gross 5 (net bogey)', () => {
      expect(calculateStablefordPoints(5, 0, 4, 1)).toBe(1);
    });

    it('net +2 → 0: hcp 0, par-4, SI 1, gross 6 (net double bogey)', () => {
      expect(calculateStablefordPoints(6, 0, 4, 1)).toBe(0);
    });

    it('net +3 → 0: hcp 0, par-3, SI 1, gross 6 (net triple bogey)', () => {
      expect(calculateStablefordPoints(6, 0, 3, 1)).toBe(0);
    });
  });

  describe('5-point cap: net 3+ under par always returns 5', () => {
    it('hcp 36, par-3, SI 1, gross 0 (net −2−3=−5 → capped at 5)', () => {
      expect(calculateStablefordPoints(0, 36, 3, 1)).toBe(5);
    });
  });

  describe('stroke-index boundary: gets stroke on SI equal to handicap, not one above', () => {
    it('hcp 9, SI 9 → gets 1 stroke (boundary hole)', () => {
      // SI 9 ≤ extra=9 → gets stroke
      expect(getHandicapStrokes(9, 9)).toBe(1);
    });
    it('hcp 9, SI 10 → gets 0 strokes (just outside boundary)', () => {
      expect(getHandicapStrokes(9, 10)).toBe(0);
    });
  });

  describe('par-3 scenarios', () => {
    it('hcp 0, par-3, gross 3 → 2 (net par)', () => {
      expect(calculateStablefordPoints(3, 0, 3, 1)).toBe(2);
    });
    it('hcp 0, par-3, gross 2 → 3 (birdie)', () => {
      expect(calculateStablefordPoints(2, 0, 3, 1)).toBe(3);
    });
    it('hcp 0, par-3, gross 4 → 1 (bogey)', () => {
      expect(calculateStablefordPoints(4, 0, 3, 1)).toBe(1);
    });
  });

  describe('par-5 scenarios', () => {
    it('hcp 0, par-5, gross 5 → 2 (net par)', () => {
      expect(calculateStablefordPoints(5, 0, 5, 1)).toBe(2);
    });
    it('hcp 0, par-5, gross 4 → 3 (birdie)', () => {
      expect(calculateStablefordPoints(4, 0, 5, 1)).toBe(3);
    });
    it('hcp 0, par-5, gross 7 → 0 (double bogey)', () => {
      expect(calculateStablefordPoints(7, 0, 5, 1)).toBe(0);
    });
  });

  describe('high handicap (36) receiving 2 strokes', () => {
    it('hcp 36, par-4, SI 18 → 2 strokes (all holes get 2)', () => {
      expect(getHandicapStrokes(36, 18)).toBe(2);
    });
    it('hcp 36, par-4, SI 18, gross 6 → 2 (net 4 = par)', () => {
      expect(calculateStablefordPoints(6, 36, 4, 18)).toBe(2);
    });
  });

  describe('pure function: same inputs always produce same output', () => {
    it('repeated calls return identical results', () => {
      const result1 = calculateStablefordPoints(5, 18, 4, 1);
      const result2 = calculateStablefordPoints(5, 18, 4, 1);
      expect(result1).toBe(result2);
    });
  });
});
