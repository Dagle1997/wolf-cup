import { describe, it, expect } from 'vitest';
import { getWolfAssignment } from './wolf.js';
import type { BattingOrder, HoleNumber } from './types.js';

const ORDER: BattingOrder<string> = ['alice', 'bob', 'carol', 'dave'];

describe('getWolfAssignment', () => {
  describe('skins holes (1–2)', () => {
    it('hole 1 returns skins regardless of batting order', () => {
      expect(getWolfAssignment(ORDER, 1)).toEqual({ type: 'skins' });
    });

    it('hole 2 returns skins regardless of batting order', () => {
      expect(getWolfAssignment(ORDER, 2)).toEqual({ type: 'skins' });
    });

    it('hole 1 returns skins for any batting order', () => {
      const other: BattingOrder<number> = [10, 20, 30, 40];
      expect(getWolfAssignment(other, 1)).toEqual({ type: 'skins' });
    });
  });

  describe('Batter 1 (index 0) wolf holes: 3, 6, 9, 14', () => {
    it('hole 3 → wolfBatterIndex 0', () => {
      expect(getWolfAssignment(ORDER, 3)).toEqual({ type: 'wolf', wolfBatterIndex: 0 });
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
    it('hole 3: batter index 0 → alice', () => {
      const a = getWolfAssignment(ORDER, 3);
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
