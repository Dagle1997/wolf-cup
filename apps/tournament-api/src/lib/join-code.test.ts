import { describe, expect, test } from 'vitest';
import { generateJoinCode, normalizeJoinCode } from './join-code.js';

describe('join-code', () => {
  test('generateJoinCode: default length 6, only unambiguous alphabet chars', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateJoinCode();
      expect(c).toHaveLength(6);
      expect(c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
      // no look-alikes
      expect(c).not.toMatch(/[ILO01]/);
    }
  });

  test('generateJoinCode: respects custom length', () => {
    expect(generateJoinCode(8)).toHaveLength(8);
  });

  test('normalizeJoinCode: uppercases + strips spaces/dashes/invalid chars', () => {
    expect(normalizeJoinCode('k7m-4pq')).toBe('K7M4PQ');
    expect(normalizeJoinCode('  a b c 2 3 4 ')).toBe('ABC234');
    // chars not in the alphabet (I, L, O, 0, 1) are dropped
    expect(normalizeJoinCode('ILO01')).toBe('');
  });
});
