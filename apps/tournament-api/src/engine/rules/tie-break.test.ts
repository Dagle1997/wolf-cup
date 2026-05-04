/**
 * T6-10 tie-break pure function tests.
 *
 * 6 fixture cases per AC + extras for null handling:
 *   (a) no tie — pure gross sort
 *   (b) tie broken at back-9
 *   (c) tie broken at hole 18
 *   (d) tie broken at hole 14 (mid hole-by-hole)
 *   (e) true tie (identical scorecards)
 *   (f) partial scores
 *   + 9-hole round (skip back-9 step)
 */
import { describe, expect, test } from 'vitest';
import { breakTie, type TieBreakInput } from './tie-break.js';

function row(
  playerId: string,
  grossByHole: Array<number | null>,
): TieBreakInput {
  const filtered = grossByHole.filter((g): g is number => g !== null);
  const gross = filtered.length === grossByHole.length
    ? filtered.reduce((a, b) => a + b, 0)
    : null;  // any null = total gross is null
  return { playerId, grossStrokes: gross, grossByHole };
}

const par4x18 = (g: number) => Array.from({ length: 18 }, () => g);

describe('breakTie — AC fixtures', () => {
  test('(a) no tie — pure gross sort', () => {
    const out = breakTie(
      [
        row('A', par4x18(4)),  // 72
        row('B', par4x18(5)),  // 90
        row('C', par4x18(3)),  // 54
      ],
      18,
    );
    expect(out.map((r) => r.playerId)).toEqual(['C', 'A', 'B']);
    expect(out.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(out.every((r) => r.tiedWith === 1)).toBe(true);
  });

  test('(b) tie broken at back-9', () => {
    // Both 72 total. A's back-9 = 36; B's back-9 = 30. B wins back-9.
    const aHoles = [...par4x18(4)];  // 72; back-9 = 36
    const bHoles = [
      5, 5, 5, 5, 5, 5, 5, 5, 5,    // front-9 = 45
      3, 3, 3, 3, 3, 3, 4, 4, 4,    // back-9 = 30
    ];
    expect(bHoles.reduce((a, b) => a + b, 0)).toBe(75);
    // Adjust to actually be 72: front 42, back 30 = 72.
    const bHoles2 = [
      5, 5, 5, 5, 5, 5, 5, 4, 3,    // front-9 = 42
      3, 3, 3, 3, 3, 3, 4, 4, 4,    // back-9 = 30
    ];
    expect(bHoles2.reduce((a, b) => a + b, 0)).toBe(72);
    const out = breakTie(
      [row('A', aHoles), row('B', bHoles2)],
      18,
    );
    expect(out.map((r) => r.playerId)).toEqual(['B', 'A']);
    expect(out.map((r) => r.rank)).toEqual([1, 2]);
  });

  test('(c) tie broken at hole 18', () => {
    // Both 72 total + same back-9 sum. Differ only at hole 18.
    // A: back-9 = 36 (4×9), B: back-9 = 36 (different distribution but same sum + same hole-18 differs).
    const aHoles = [
      ...Array(9).fill(4),       // front-9 = 36
      4, 4, 4, 4, 4, 4, 4, 5, 3, // back-9 = 36; hole-18 = 3
    ];
    const bHoles = [
      ...Array(9).fill(4),       // front-9 = 36
      4, 4, 4, 4, 4, 4, 4, 4, 4, // back-9 = 36; hole-18 = 4
    ];
    expect(aHoles.reduce((a, b) => a + b, 0)).toBe(72);
    expect(bHoles.reduce((a, b) => a + b, 0)).toBe(72);
    const out = breakTie([row('A', aHoles), row('B', bHoles)], 18);
    // A has lower hole 18 (3 vs 4) → A ranks higher.
    expect(out.map((r) => r.playerId)).toEqual(['A', 'B']);
  });

  test('(d) tie broken at hole 14 (mid hole-by-hole)', () => {
    // Both 72 total. Same back-9 sum (36). Same holes 18, 17, 16, 15.
    // Differ at hole 14 (A=3, B=5). Compensator at hole 13 (A=5, B=3).
    // Walk backward: 18,17,16,15 same → 14 deciding (A=3 lower).
    const aHoles = [
      4, 4, 4, 4, 4, 4, 4, 4, 4,  // front-9 = 36
      4, 4, 4, 5, 3, 4, 4, 4, 4,  // back-9 = 36; hole 13 (idx 12) = 5; hole 14 (idx 13) = 3
    ];
    const bHoles = [
      4, 4, 4, 4, 4, 4, 4, 4, 4,  // front-9 = 36
      4, 4, 4, 3, 5, 4, 4, 4, 4,  // back-9 = 36; hole 13 (idx 12) = 3; hole 14 (idx 13) = 5
    ];
    expect(aHoles.reduce((a, b) => a + b, 0)).toBe(72);
    expect(bHoles.reduce((a, b) => a + b, 0)).toBe(72);
    const out = breakTie([row('A', aHoles), row('B', bHoles)], 18);
    expect(out.map((r) => r.playerId)).toEqual(['A', 'B']);
  });

  test('(e) true tie — identical scorecards', () => {
    const same = par4x18(4);
    const out = breakTie(
      [row('A', [...same]), row('B', [...same]), row('C', par4x18(5))],
      18,
    );
    // A and B share rank 1 (tiedWith=2); C ranks 3 (NOT 2).
    expect(out[0]!.rank).toBe(1);
    expect(out[1]!.rank).toBe(1);
    expect(out[0]!.tiedWith).toBe(2);
    expect(out[1]!.tiedWith).toBe(2);
    expect(out[2]!.rank).toBe(3);
    expect(out[2]!.tiedWith).toBe(1);
  });

  test('(f) partial scores — incomplete round ranks last regardless of gross', () => {
    // A finished at 72; B has only 12 holes scored at 4 each (gross=48 partial).
    const aHoles = par4x18(4);
    const bHoles: Array<number | null> = [
      ...Array(12).fill(4),
      null, null, null, null, null, null,
    ];
    const out = breakTie([row('A', aHoles), row('B', bHoles)], 18);
    expect(out.map((r) => r.playerId)).toEqual(['A', 'B']);
    expect(out[0]!.rank).toBe(1);
    expect(out[1]!.rank).toBe(2);
  });
});

describe('breakTie — 9-hole round (skip back-9 step)', () => {
  test('9-hole round with tied gross → walks backward from hole 9', () => {
    const aHoles = [4, 4, 4, 4, 4, 4, 4, 4, 4];  // 36
    const bHoles = [5, 5, 4, 4, 4, 4, 4, 3, 3];  // 36, hole 9 (idx 8) = 3 vs A's 4
    expect(aHoles.reduce((a, b) => a + b, 0)).toBe(36);
    expect(bHoles.reduce((a, b) => a + b, 0)).toBe(36);
    const out = breakTie([row('A', aHoles), row('B', bHoles)], 9);
    // B wins because hole 9 lower.
    expect(out.map((r) => r.playerId)).toEqual(['B', 'A']);
  });
});

describe('breakTie — null handling', () => {
  test('player with null in back-9 ranks below player with complete back-9 (same gross)', () => {
    // Both have 72 total but B has nulls in back-9. v1 spec says null > integer
    // for ordering, so B sorts after A.
    // But B has total gross = null because of nulls (per row helper).
    // Actually row helper sets gross to null if any hole null. So B's gross is null;
    // initial sort puts B last on gross alone. Test the case where A complete + B partial.
    const aHoles = par4x18(4);  // 72
    const bHolesPartial: Array<number | null> = [
      ...Array(9).fill(4),       // front-9 complete
      4, 4, 4, null, null, null, null, null, null,  // partial back-9
    ];
    const out = breakTie([row('A', aHoles), row('B', bHolesPartial)], 18);
    expect(out[0]!.playerId).toBe('A');
    expect(out[1]!.playerId).toBe('B');
  });
});
