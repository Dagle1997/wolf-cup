/**
 * T2-4 unit tests for `validateCourse`.
 *
 * Covers:
 *   - One rejection-mode test per rule (rules 1-17 from spec §4)
 *   - Multi-error tests (assert no-short-circuit + prerequisite-skip)
 *   - 5 happy-path tests for the seeded Pinehurst courses (literals
 *     constructed in-test; totals computed from the literal's holes
 *     array so each fixture is self-consistent without referencing
 *     seed.ts)
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ParsedCourse } from '../../lib/course-parser.js';
import { validateCourse } from './course.js';

// ===========================================================================
// Seed-data fixture loader (module-load time, not per-test). Reads the
// authoritative reference/pinehurst-may-2026-courses.json and converts each
// course into a ParsedCourse-shape literal with totals computed from its
// own holes — keeps each fixture self-consistent without re-importing
// seed.ts logic. Per AC #14: tests use real seed data so the validator
// is exercised against the actual courses we'll play in May.
// ===========================================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const seedJsonPath = resolve(__dirname, '../../../../../reference/pinehurst-may-2026-courses.json');

type SeedTee = { name: string; rating: number; slope: number; yardage: number };
type SeedHole = { hole: number; par: number; si: number; yardages: Record<string, number> };
type SeedCourse = { name: string; tees: SeedTee[]; holes: SeedHole[] };
type SeedFile = { courses: SeedCourse[] };

function loadSeedCourses(): ParsedCourse[] {
  const raw = readFileSync(seedJsonPath, 'utf8');
  const parsed = JSON.parse(raw) as SeedFile;
  return parsed.courses.map((c) => {
    const tees = c.tees.map((t) => ({
      color: t.name,
      rating: t.rating,
      slope: t.slope,
    }));
    const holes = c.holes.map((h) => ({
      number: h.hole,
      par: h.par,
      si: h.si,
      // Use yardages as-is from seed JSON. NO filtering — if the seed
      // file has yardage keys that don't match tees, the validator
      // SHOULD reject and the test SHOULD fail (catching real
      // data-quality issues in the reference file). Tested 2026-04-26:
      // all 5 courses' yardage keys match their declared tee `name`s
      // exactly.
      yardages: h.yardages,
    }));
    const sortedForTotals = [...holes].sort((a, b) => a.number - b.number);
    const out = sortedForTotals.slice(0, 9).reduce((s, h) => s + h.par, 0);
    const inn = sortedForTotals.slice(9, 18).reduce((s, h) => s + h.par, 0);
    return {
      name: c.name,
      club_name: c.name,
      tees,
      holes,
      totals: { out_total: out, in_total: inn, course_total: out + inn },
    };
  });
}

const SEEDED_COURSES = loadSeedCourses();
const SEEDED_BY_NAME = new Map(SEEDED_COURSES.map((c) => [c.name, c]));

// ===========================================================================
// Test fixture helpers
// ===========================================================================

/** Build a minimal-valid 18-hole holes array with par 71 (out=35, in=36). */
function build18Holes(
  yardageKeys: readonly string[] = ['Blue'],
): ParsedCourse['holes'] {
  // Pars: holes 1-9 sum to 35 (4*8 + 3 = 35), holes 10-18 sum to 36 (4*9).
  const pars = [4, 4, 4, 4, 4, 4, 4, 4, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4];
  return Array.from({ length: 18 }, (_, i) => {
    const yardages: Record<string, number> = {};
    for (const k of yardageKeys) yardages[k] = 400;
    return {
      number: i + 1,
      par: pars[i]!,
      si: i + 1,
      yardages,
    };
  });
}

/**
 * Build a minimal-valid ParsedCourse with totals computed from the holes
 * array (so the fixture is self-consistent — totals always match per-hole
 * sums).
 */
function buildCourse(
  overrides: Partial<ParsedCourse> = {},
): ParsedCourse {
  const tees = overrides.tees ?? [{ color: 'Blue', rating: 71.5, slope: 130 }];
  const teeColors = tees.map((t) => t.color);
  const holes = overrides.holes ?? build18Holes(teeColors);
  // Sort by hole number BEFORE computing totals — guarantees correct
  // out/in/course sums regardless of caller-supplied hole ordering.
  // Validator does the same internally, so this matches the contract.
  const sortedForTotals = [...holes].sort((a, b) => a.number - b.number);
  const out = sortedForTotals.slice(0, 9).reduce((s, h) => s + h.par, 0);
  const inn = sortedForTotals.slice(9, 18).reduce((s, h) => s + h.par, 0);
  return {
    name: overrides.name ?? 'Test Course',
    club_name: overrides.club_name ?? 'Test Club',
    tees,
    holes,
    totals: overrides.totals ?? {
      out_total: out,
      in_total: inn,
      course_total: out + inn,
    },
  };
}

// ===========================================================================
// Section A: required-field presence + type-shape sanity (rules 1-6)
// ===========================================================================

describe('validateCourse — Section A: required-field sanity', () => {
  it('rule 1: rejects empty name', () => {
    const r = validateCourse(buildCourse({ name: '   ' }));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('name must be a non-empty string');
  });

  it('rule 2: rejects empty club_name', () => {
    const r = validateCourse(buildCourse({ club_name: '' }));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('club_name must be a non-empty string');
  });

  it('rule 3: rejects empty tees array', () => {
    const r = validateCourse(buildCourse({ tees: [] }));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('tees must be a non-empty array');
  });

  it('rule 4: rejects tee with empty color', () => {
    const r = validateCourse(
      buildCourse({ tees: [{ color: '', rating: 71.5, slope: 130 }] }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('tees[0] color must be a non-empty string');
  });

  it('rule 4: rejects tee with non-positive rating', () => {
    const r = validateCourse(
      buildCourse({ tees: [{ color: 'Blue', rating: 0, slope: 130 }] }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('tees[0] rating 0 must be a positive number');
  });

  it('rule 4: rejects tee with slope outside 55-155', () => {
    const r = validateCourse(
      buildCourse({ tees: [{ color: 'Blue', rating: 71.5, slope: 200 }] }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('tees[0] slope 200 is outside the valid range 55-155');
  });

  it('rule 4: emits 2 errors for a tee with bad slope AND bad rating', () => {
    const r = validateCourse(
      buildCourse({ tees: [{ color: 'Blue', rating: -5, slope: 200 }] }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('tees[0] rating -5 must be a positive number');
    expect(r.errors).toContain('tees[0] slope 200 is outside the valid range 55-155');
  });

  it('rule 5: rejects holes array with 17 entries', () => {
    const holes = build18Holes().slice(0, 17);
    const r = validateCourse(buildCourse({ holes }));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('holes must have exactly 18 entries (got 17)');
  });

  it('rule 6: rejects negative course_total', () => {
    const holes = build18Holes();
    const r = validateCourse(
      buildCourse({
        holes,
        totals: { out_total: 35, in_total: 36, course_total: -1 },
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors).toContain(
      'totals must include positive-integer out_total, in_total, course_total',
    );
  });
});

// ===========================================================================
// Section B: hole-index cross-field invariants (rules 7-9)
// ===========================================================================

describe('validateCourse — Section B: hole-index invariants', () => {
  it('rule 7: rejects duplicate hole number', () => {
    const holes = build18Holes();
    holes[6]!.number = 4; // hole 7 now claims to be 4 → 4 appears twice, 7 missing
    const r = validateCourse(buildCourse({ holes }));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain(
      'Hole numbers do not form 1..18: missing [7], duplicate [4], extra []',
    );
  });

  it('rule 7: rejects out-of-range hole number', () => {
    const holes = build18Holes();
    holes[17]!.number = 19; // hole 18 → 19
    const r = validateCourse(buildCourse({ holes }));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain(
      'Hole numbers do not form 1..18: missing [18], duplicate [], extra [19]',
    );
  });

  it('rule 8: rejects par=6 (one error per offending hole)', () => {
    const holes = build18Holes();
    holes[3]!.par = 6;
    const r = validateCourse(buildCourse({ holes }));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('Hole 4 par is 6; must be 3, 4, or 5');
  });

  it('rule 8: emits 3 distinct errors for 3 bad pars', () => {
    const holes = build18Holes();
    holes[3]!.par = 6;
    holes[7]!.par = 2;
    holes[11]!.par = 7;
    const r = validateCourse(buildCourse({ holes }));
    expect(r.valid).toBe(false);
    const parErrors = r.errors.filter((e) => /^Hole \d+ par/.test(e));
    expect(parErrors.length).toBe(3);
  });

  it('rule 9: rejects duplicate SI', () => {
    const holes = build18Holes();
    holes[10]!.si = 4; // duplicates SI 4 from hole 4; SI 11 missing
    const r = validateCourse(buildCourse({ holes }));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain(
      'Stroke indexes do not form 1..18: missing [11], duplicate [4], extra []',
    );
  });
});

// ===========================================================================
// Section C: tee + yardage cross-field invariants (rules 10-12)
// ===========================================================================

describe('validateCourse — Section C: tee + yardage invariants', () => {
  it('rule 10: rejects duplicate tee colors', () => {
    const r = validateCourse(
      buildCourse({
        tees: [
          { color: 'Blue', rating: 71.5, slope: 130 },
          { color: 'Blue', rating: 70.0, slope: 125 },
        ],
        holes: build18Holes(['Blue']),
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('Duplicate tee color: Blue');
  });

  it('rule 11: rejects yardage keys not matching tee colors (missing key on first hole)', () => {
    const tees = [
      { color: 'Blue', rating: 71.5, slope: 130 },
      { color: 'Red', rating: 65.0, slope: 110 },
    ];
    const holes = build18Holes(['Blue']); // missing "Red" yardage
    const r = validateCourse(buildCourse({ tees, holes }));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain(
      "Hole 1 yardage keys [Blue] don't match declared tee colors [Blue, Red]: missing [Red], extra []",
    );
  });

  it('rule 11: rejects null yardages (covers Med #2 fix — was silently skipped pre-fix)', () => {
    const tees = [{ color: 'Blue', rating: 71.5, slope: 130 }];
    const holes = build18Holes(['Blue']);
    // Wipe yardages on hole 4 (most-likely-first-detected mismatch given
    // the loop iterates in array order).
    (holes[3] as { yardages: unknown }).yardages = null;
    const r = validateCourse(buildCourse({ tees, holes }));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain(
      "Hole 4 yardage keys [] don't match declared tee colors [Blue]: missing [Blue], extra []",
    );
  });

  it('rule 11: rejects yardage keys with extra unknown tee', () => {
    const tees = [{ color: 'Blue', rating: 71.5, slope: 130 }];
    const holes = build18Holes(['Blue', 'Red']); // "Red" not declared
    const r = validateCourse(buildCourse({ tees, holes }));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain(
      "Hole 1 yardage keys [Blue, Red] don't match declared tee colors [Blue]: missing [], extra [Red]",
    );
  });

  it('rule 12: rejects negative yardage', () => {
    const holes = build18Holes(['Blue']);
    holes[3]!.yardages['Blue'] = -50;
    const r = validateCourse(buildCourse({ holes }));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain(
      'Hole 4 yardage for tee Blue is -50; must be a non-negative integer',
    );
  });

  it('rule 12: rejects non-integer yardage', () => {
    const holes = build18Holes(['Blue']);
    holes[3]!.yardages['Blue'] = 400.5;
    const r = validateCourse(buildCourse({ holes }));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain(
      'Hole 4 yardage for tee Blue is 400.5; must be a non-negative integer',
    );
  });
});

// ===========================================================================
// Section D: printed-vs-computed totals (rules 13-16) + Section E (rule 17)
// ===========================================================================

describe('validateCourse — Section D+E: totals invariants', () => {
  it('rule 14: rejects printed out_total != computed front-9 sum', () => {
    const r = validateCourse(
      buildCourse({
        totals: { out_total: 36, in_total: 36, course_total: 72 }, // out should be 35
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors).toContain(
      'Printed out_total 36 != computed sum of front-9 par 35',
    );
  });

  it('rule 15: rejects printed in_total != computed back-9 sum', () => {
    const r = validateCourse(
      buildCourse({
        totals: { out_total: 35, in_total: 35, course_total: 70 }, // in should be 36
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors).toContain(
      'Printed in_total 35 != computed sum of back-9 par 36',
    );
  });

  it('rule 16: rejects printed course_total != computed full-18 sum', () => {
    const r = validateCourse(
      buildCourse({
        totals: { out_total: 35, in_total: 36, course_total: 70 }, // course should be 71
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors).toContain(
      'Printed course_total 70 != computed sum of all 18 par 71',
    );
  });

  it('rule 17: rejects internally inconsistent printed totals', () => {
    // Use modified holes so per-half sums match printed values; the
    // course_total mismatches arithmetically with out + in.
    const holes = build18Holes();
    // Pars give out=35, in=36 already.
    const r = validateCourse(
      buildCourse({
        holes,
        totals: { out_total: 35, in_total: 36, course_total: 72 }, // 35+36=71, not 72
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors).toContain(
      'Printed totals inconsistent: out_total 35 + in_total 36 = 71, but course_total 72',
    );
  });

  it('rule 13-17 PREREQUISITE: skip totals rules when rule 5 (length) fails', () => {
    const holes = build18Holes().slice(0, 17);
    const r = validateCourse(
      buildCourse({
        holes,
        totals: { out_total: 99, in_total: 99, course_total: 99 }, // wildly wrong
      }),
    );
    expect(r.valid).toBe(false);
    // Rule 5 error fires:
    expect(r.errors).toContain('holes must have exactly 18 entries (got 17)');
    // But NO totals errors:
    expect(r.errors.find((e) => /Printed (out_total|in_total|course_total)/.test(e))).toBeUndefined();
    expect(
      r.errors.find((e) => /Printed totals inconsistent/.test(e)),
    ).toBeUndefined();
  });

  it('rule 13-17 PREREQUISITE: skip totals rules when rule 7 (bijection) fails', () => {
    const holes = build18Holes();
    holes[6]!.number = 4; // duplicate; rule 7 fails
    const r = validateCourse(
      buildCourse({
        holes,
        totals: { out_total: 99, in_total: 99, course_total: 99 },
      }),
    );
    expect(r.valid).toBe(false);
    expect(
      r.errors.find((e) => /Hole numbers do not form 1\.\.18/.test(e)),
    ).toBeDefined();
    // No totals errors:
    expect(r.errors.find((e) => /Printed (out_total|in_total|course_total)/.test(e))).toBeUndefined();
  });

  it('totals sort-by-number normalization: holes shuffled but totals correct → no error', () => {
    const holes = build18Holes();
    // Shuffle: reverse the array
    const shuffled = [...holes].reverse();
    const r = validateCourse(buildCourse({ holes: shuffled }));
    // Totals computed by buildCourse() are already correct; sort fixes lookup.
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });
});

// ===========================================================================
// Multi-error / no-short-circuit tests
// ===========================================================================

describe('validateCourse — multi-error accumulation', () => {
  it('returns ALL detected errors (no short-circuit on first failure)', () => {
    const r = validateCourse(
      buildCourse({
        name: '', // rule 1
        club_name: '', // rule 2
        tees: [{ color: 'Blue', rating: 71.5, slope: 200 }], // rule 4 (slope)
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
    expect(r.errors).toContain('name must be a non-empty string');
    expect(r.errors).toContain('club_name must be a non-empty string');
    expect(r.errors).toContain('tees[0] slope 200 is outside the valid range 55-155');
  });
});

// ===========================================================================
// Happy-path: 5 seeded Pinehurst courses (constructed in-test, totals
// computed from the literal's holes; no seed.ts re-implementation)
// ===========================================================================

describe('validateCourse — happy path: seeded Pinehurst courses (real seed data)', () => {
  // Each test reads the corresponding course's full data (par + SI +
  // per-tee yardages) from reference/pinehurst-may-2026-courses.json
  // via the loadSeedCourses() helper. Totals are computed from the
  // course's own holes so each fixture is self-consistent — tests do
  // NOT re-import seed.ts logic. Per AC #14.

  it.each([
    'Pine Needles Lodge & Golf Club',
    'Mid Pines Inn & Golf Club',
    'Talamore Golf Resort',
    'Pinehurst No. 2',
    'Tobacco Road Golf Club',
  ])('seeded course %s: valid', (courseName) => {
    const course = SEEDED_BY_NAME.get(courseName);
    expect(course).toBeDefined();
    const r = validateCourse(course!);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });
});
