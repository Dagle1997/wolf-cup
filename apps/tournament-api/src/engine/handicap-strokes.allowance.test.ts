/**
 * GOLDEN (Josh-approved 2026-06-23) — handicap allowance % + off-the-low.
 *
 * The Pete Dye Guyan 2v2 money basis: apply the allowance % to each player's
 * full course handicap (round half-up), THEN play off the lowest allowed CH in
 * the foursome (low man → scratch, everyone else gets the difference). These are
 * the exact numbers approved before settlement code merged (money discipline:
 * golden hand-calc first).
 */
import { describe, it, expect } from 'vitest';
import { applyAllowanceOffLow, allocateStrokesFromCourseHandicap } from './handicap-strokes.js';

describe('applyAllowanceOffLow — Pete Dye golden (full CH 4/11/18/27 @ 80%)', () => {
  const chByPlayer = new Map<string, number>([
    ['A', 4],
    ['B', 11],
    ['C', 18],
    ['D', 27],
  ]);

  it('allowance rounds half-up: round(CH × 0.80)', () => {
    const { allowed } = applyAllowanceOffLow(chByPlayer, 80);
    expect(allowed.get('A')).toBe(3); // 3.2 → 3
    expect(allowed.get('B')).toBe(9); // 8.8 → 9
    expect(allowed.get('C')).toBe(14); // 14.4 → 14
    expect(allowed.get('D')).toBe(22); // 21.6 → 22
  });

  it('off-the-low: lowest allowed CH plays to scratch, others get the difference', () => {
    const { groupLow, offLow } = applyAllowanceOffLow(chByPlayer, 80);
    expect(groupLow).toBe(3); // min(3, 9, 14, 22) = A
    expect(offLow.get('A')).toBe(0); // 3 − 3
    expect(offLow.get('B')).toBe(6); // 9 − 3
    expect(offLow.get('C')).toBe(11); // 14 − 3
    expect(offLow.get('D')).toBe(19); // 22 − 3
  });

  it('off-low strokes drop by stroke index (D = 19 → all 18 holes + a 2nd on SI 1)', () => {
    const { offLow } = applyAllowanceOffLow(chByPlayer, 80);
    const dStrokes = (si: number) => allocateStrokesFromCourseHandicap(offLow.get('D')!, si);
    expect(dStrokes(1)).toBe(2); // 19 = 18 + 1 → SI 1 gets the 19th (2nd) stroke
    expect(dStrokes(2)).toBe(1);
    expect(dStrokes(18)).toBe(1);
    // The scratch low man (A) gets a stroke nowhere.
    const { offLow: ol } = applyAllowanceOffLow(chByPlayer, 80);
    expect(allocateStrokesFromCourseHandicap(ol.get('A')!, 1)).toBe(0);
    expect(allocateStrokesFromCourseHandicap(ol.get('A')!, 18)).toBe(0);
  });
});

describe('applyAllowanceOffLow — invariants', () => {
  it('100% is identity on the allowance step (pure off-the-low)', () => {
    const ch = new Map([
      ['A', 4],
      ['B', 11],
      ['C', 18],
      ['D', 27],
    ]);
    const { allowed, groupLow, offLow } = applyAllowanceOffLow(ch, 100);
    expect([...allowed.values()]).toEqual([4, 11, 18, 27]);
    expect(groupLow).toBe(4);
    expect([...offLow.values()]).toEqual([0, 7, 14, 23]);
  });

  it('every off-low value is ≥ 0 (groupLow is the min) so allocation never throws', () => {
    const ch = new Map([
      ['A', 30],
      ['B', 2],
      ['C', 15],
    ]);
    const { offLow } = applyAllowanceOffLow(ch, 85);
    for (const v of offLow.values()) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(() => allocateStrokesFromCourseHandicap(v, 1)).not.toThrow();
    }
  });

  it('throws on an empty group (never silently scratch)', () => {
    expect(() => applyAllowanceOffLow(new Map(), 80)).toThrow(/empty group/);
  });

  it('throws on a non-integer CH (corrupt pin) instead of rounding it away', () => {
    // Math.round would otherwise mask 8.5 → 9 and let it settle; the integer
    // precondition keeps the corrupt-pin fail-closed guard intact.
    const ch = new Map([
      ['A', 4],
      ['B', 8.5],
    ]);
    expect(() => applyAllowanceOffLow(ch, 100)).toThrow(/integer/);
  });
});
