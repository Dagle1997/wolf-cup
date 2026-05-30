import { describe, it, expect } from 'vitest';
import { getWolfAssignment, wolfHoleChanges } from './wolf.js';
import type { BattingOrder, HoleNumber } from './types.js';

const ORDER: BattingOrder<string> = ['alice', 'bob', 'carol', 'dave'];

describe('getWolfAssignment', () => {
  describe('skins holes (1, 3)', () => {
    it('hole 1 returns skins regardless of batting order', () => {
      expect(getWolfAssignment(ORDER, 1)).toEqual({ type: 'skins' });
    });

    it('hole 3 returns skins regardless of batting order', () => {
      expect(getWolfAssignment(ORDER, 3)).toEqual({ type: 'skins' });
    });

    it('hole 1 returns skins for any batting order', () => {
      const other: BattingOrder<number> = [10, 20, 30, 40];
      expect(getWolfAssignment(other, 1)).toEqual({ type: 'skins' });
    });
  });

  describe('Batter 1 (index 0) wolf holes: 2, 6, 9, 14', () => {
    it('hole 2 → wolfBatterIndex 0', () => {
      expect(getWolfAssignment(ORDER, 2)).toEqual({ type: 'wolf', wolfBatterIndex: 0 });
    });
    it('hole 6 → wolfBatterIndex 0', () => {
      expect(getWolfAssignment(ORDER, 6)).toEqual({ type: 'wolf', wolfBatterIndex: 0 });
    });
    it('hole 9 → wolfBatterIndex 0', () => {
      expect(getWolfAssignment(ORDER, 9)).toEqual({ type: 'wolf', wolfBatterIndex: 0 });
    });
    it('hole 14 → wolfBatterIndex 0', () => {
      expect(getWolfAssignment(ORDER, 14)).toEqual({ type: 'wolf', wolfBatterIndex: 0 });
    });
  });

  describe('Batter 2 (index 1) wolf holes: 4, 7, 10, 16', () => {
    it('hole 4 → wolfBatterIndex 1', () => {
      expect(getWolfAssignment(ORDER, 4)).toEqual({ type: 'wolf', wolfBatterIndex: 1 });
    });
    it('hole 7 → wolfBatterIndex 1', () => {
      expect(getWolfAssignment(ORDER, 7)).toEqual({ type: 'wolf', wolfBatterIndex: 1 });
    });
    it('hole 10 → wolfBatterIndex 1', () => {
      expect(getWolfAssignment(ORDER, 10)).toEqual({ type: 'wolf', wolfBatterIndex: 1 });
    });
    it('hole 16 → wolfBatterIndex 1', () => {
      expect(getWolfAssignment(ORDER, 16)).toEqual({ type: 'wolf', wolfBatterIndex: 1 });
    });
  });

  describe('Batter 3 (index 2) wolf holes: 5, 11, 12, 17', () => {
    it('hole 5 → wolfBatterIndex 2', () => {
      expect(getWolfAssignment(ORDER, 5)).toEqual({ type: 'wolf', wolfBatterIndex: 2 });
    });
    it('hole 11 → wolfBatterIndex 2', () => {
      expect(getWolfAssignment(ORDER, 11)).toEqual({ type: 'wolf', wolfBatterIndex: 2 });
    });
    it('hole 12 → wolfBatterIndex 2', () => {
      expect(getWolfAssignment(ORDER, 12)).toEqual({ type: 'wolf', wolfBatterIndex: 2 });
    });
    it('hole 17 → wolfBatterIndex 2', () => {
      expect(getWolfAssignment(ORDER, 17)).toEqual({ type: 'wolf', wolfBatterIndex: 2 });
    });
  });

  describe('Batter 4 (index 3) wolf holes: 8, 13, 15, 18', () => {
    it('hole 8 → wolfBatterIndex 3', () => {
      expect(getWolfAssignment(ORDER, 8)).toEqual({ type: 'wolf', wolfBatterIndex: 3 });
    });
    it('hole 13 → wolfBatterIndex 3', () => {
      expect(getWolfAssignment(ORDER, 13)).toEqual({ type: 'wolf', wolfBatterIndex: 3 });
    });
    it('hole 15 → wolfBatterIndex 3', () => {
      expect(getWolfAssignment(ORDER, 15)).toEqual({ type: 'wolf', wolfBatterIndex: 3 });
    });
    it('hole 18 → wolfBatterIndex 3', () => {
      expect(getWolfAssignment(ORDER, 18)).toEqual({ type: 'wolf', wolfBatterIndex: 3 });
    });
  });

  describe('all 18 holes are assigned (coverage)', () => {
    const ALL_HOLES: HoleNumber[] = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18];

    it('every hole returns a valid HoleAssignment', () => {
      for (const hole of ALL_HOLES) {
        const result = getWolfAssignment(ORDER, hole);
        expect(result.type === 'skins' || result.type === 'wolf').toBe(true);
      }
    });

    it('exactly 2 skins holes and 16 wolf holes', () => {
      const assignments = ALL_HOLES.map(h => getWolfAssignment(ORDER, h));
      expect(assignments.filter(a => a.type === 'skins').length).toBe(2);
      expect(assignments.filter(a => a.type === 'wolf').length).toBe(16);
    });

    it('each batter is wolf exactly 4 times', () => {
      const wolfCounts = [0, 0, 0, 0];
      for (const hole of ALL_HOLES) {
        const a = getWolfAssignment(ORDER, hole);
        if (a.type === 'wolf') {
          wolfCounts[a.wolfBatterIndex] = (wolfCounts[a.wolfBatterIndex] ?? 0) + 1;
        }
      }
      expect(wolfCounts).toEqual([4, 4, 4, 4]);
    });
  });

  describe('purity — identical inputs produce identical output', () => {
    it('same hole called twice returns equal results', () => {
      const r1 = getWolfAssignment(ORDER, 8);
      const r2 = getWolfAssignment(ORDER, 8);
      expect(r1).toEqual(r2);
    });

    it('different batting orders produce same wolfBatterIndex (order is irrelevant to index)', () => {
      const order2: BattingOrder<string> = ['dave', 'carol', 'bob', 'alice'];
      const r1 = getWolfAssignment(ORDER, 5);
      const r2 = getWolfAssignment(order2, 5);
      expect(r1).toEqual(r2); // same wolfBatterIndex: 2 regardless
    });
  });

  describe('wolfBatterIndex resolves to correct player in battingOrder', () => {
    it('hole 2: batter index 0 → alice', () => {
      const a = getWolfAssignment(ORDER, 2);
      expect(a.type).toBe('wolf');
      if (a.type === 'wolf') {
        expect(ORDER[a.wolfBatterIndex]).toBe('alice');
      }
    });

    it('hole 8: batter index 3 → dave', () => {
      const a = getWolfAssignment(ORDER, 8);
      expect(a.type).toBe('wolf');
      if (a.type === 'wolf') {
        expect(ORDER[a.wolfBatterIndex]).toBe('dave');
      }
    });
  });
});

describe('wolfHoleChanges', () => {
  it('no change when the order is identical', () => {
    expect(wolfHoleChanges([11, 13, 21, 17], [11, 13, 21, 17])).toEqual([]);
  });

  it('swapping slots 3 & 4 changes only their wolf holes (5,8,11,12,13,15,17,18)', () => {
    // old: Matt(11) Scott(13) Ronnie(17) Kyle(21)  -> new: Matt Scott Kyle(21) Ronnie(17)
    const changes = wolfHoleChanges([11, 13, 17, 21], [11, 13, 21, 17]);
    expect(changes.map((c) => c.hole)).toEqual([5, 8, 11, 12, 13, 15, 17, 18]);
    // holes 2 (slot1) and 4 (slot2) are NOT in the list — the real 2026-05-29 case
    expect(changes.map((c) => c.hole)).not.toContain(2);
    expect(changes.map((c) => c.hole)).not.toContain(4);
    // hole 5 is slot 3: old wolf Ronnie(17) -> new wolf Kyle(21)
    expect(changes.find((c) => c.hole === 5)).toEqual({ hole: 5, oldWolf: 17, newWolf: 21 });
    // hole 8 is slot 4: old wolf Kyle(21) -> new wolf Ronnie(17)
    expect(changes.find((c) => c.hole === 8)).toEqual({ hole: 8, oldWolf: 21, newWolf: 17 });
  });

  it('moving slot 1 changes its wolf holes (2,6,9,14) — earliest is hole 2', () => {
    const changes = wolfHoleChanges([1, 2, 3, 4], [2, 1, 3, 4]);
    // slot1 (1->2) holes: 2,6,9,14 ; slot2 (2->1) holes: 4,7,10,16
    expect(changes.map((c) => c.hole)).toEqual([2, 4, 6, 7, 9, 10, 14, 16]);
    expect(changes[0]!.hole).toBe(2); // first wolf hole — error surfaces early
  });

  it('skins holes 1 and 3 are never reported', () => {
    const changes = wolfHoleChanges([4, 3, 2, 1], [1, 2, 3, 4]);
    expect(changes.map((c) => c.hole)).not.toContain(1);
    expect(changes.map((c) => c.hole)).not.toContain(3);
  });

  it('a full reversal changes every wolf hole (all 16)', () => {
    const changes = wolfHoleChanges([1, 2, 3, 4], [4, 3, 2, 1]);
    expect(changes).toHaveLength(16);
  });
});
