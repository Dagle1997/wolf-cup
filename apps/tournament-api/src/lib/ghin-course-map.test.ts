import { describe, expect, test } from 'vitest';
import { mapGhinCourseToSaveRequest } from './ghin-course-map.js';
import type { GhinCourseDetails, GhinTeeSet } from './ghin-client.js';

// Build an 18-hole tee. SI = the standard front-odds / back-evens layout so
// allocations form a valid 1..18 permutation. Yardages = base + hole index.
function makeTee(over: Partial<GhinTeeSet> & { name: string; gender: string; baseYds: number; rating: number; slope: number }): GhinTeeSet {
  const si = [7, 1, 15, 13, 3, 11, 17, 9, 5, 4, 12, 16, 18, 6, 8, 14, 10, 2];
  const pars = [4, 4, 4, 3, 5, 4, 3, 5, 4, 4, 5, 4, 3, 4, 5, 3, 4, 4];
  const holes = Array.from({ length: 18 }, (_, i) => ({
    number: i + 1,
    par: pars[i]!,
    allocation: si[i]!,
    length: over.baseYds + i,
  }));
  const totalYardage = holes.reduce((a, h) => a + h.length, 0);
  return {
    teeSetRatingId: over.teeSetRatingId ?? 1,
    name: over.name,
    gender: over.gender,
    totalYardage,
    totalPar: 72,
    ratings: [{ type: 'Total', courseRating: over.rating, slopeRating: over.slope }],
    holes,
  };
}

function details(teeSets: GhinTeeSet[]): GhinCourseDetails {
  return {
    ghinCourseId: 5737,
    name: 'Test GC',
    city: 'Bridgeport',
    state: 'US-WV',
    facilityName: 'Test Golf Club',
    teeSets,
  };
}

describe('mapGhinCourseToSaveRequest', () => {
  test('maps men’s tees: every tee becomes a column, par/SI from the longest tee', () => {
    const d = details([
      makeTee({ name: 'Championship', gender: 'Male', baseYds: 400, rating: 75.5, slope: 141, teeSetRatingId: 1 }),
      makeTee({ name: 'Dye', gender: 'Male', baseYds: 360, rating: 71.3, slope: 130, teeSetRatingId: 2 }),
    ]);
    const r = mapGhinCourseToSaveRequest(d, { gender: 'Male' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.course.name).toBe('Test Golf Club'); // facility name preferred
    expect(r.course.tees).toEqual([
      { color: 'Championship', rating: 75.5, slope: 141 },
      { color: 'Dye', rating: 71.3, slope: 130 },
    ]);
    expect(r.course.holes).toHaveLength(18);
    // Each hole carries a yardage for BOTH tees.
    expect(Object.keys(r.course.holes[0]!.yardages).sort()).toEqual(['Championship', 'Dye']);
    // par/SI taken from the longest tee (Championship); hole 2 SI = 1.
    expect(r.course.holes[1]!.si).toBe(1);
    // totals = honest par sum (36/36/72).
    expect(r.course.totals).toEqual({ out_total: 36, in_total: 36, course_total: 72 });
    expect(r.course.source_url).toMatch(/api2\.ghin\.com\/api\/v1\/courses\/5737/);
  });

  test('skips women’s tees and partial (9-hole) tees', () => {
    const partial = makeTee({ name: 'Forward', gender: 'Male', baseYds: 280, rating: 64.6, slope: 118 });
    partial.holes = partial.holes.slice(0, 9); // only 9 holes → not importable
    const d = details([
      makeTee({ name: 'Championship', gender: 'Male', baseYds: 400, rating: 75.5, slope: 141 }),
      makeTee({ name: 'Middle', gender: 'Female', baseYds: 330, rating: 73.6, slope: 128 }),
      partial,
    ]);
    const r = mapGhinCourseToSaveRequest(d, { gender: 'Male' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.course.tees.map((t) => t.color)).toEqual(['Championship']);
  });

  test('combo tees import as their own named column', () => {
    const d = details([
      makeTee({ name: 'Dye', gender: 'Male', baseYds: 360, rating: 71.3, slope: 130 }),
      makeTee({ name: 'Dye/Middle', gender: 'Male', baseYds: 340, rating: 69.3, slope: 127 }),
    ]);
    const r = mapGhinCourseToSaveRequest(d, { gender: 'Male' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.course.tees.map((t) => t.color)).toContain('Dye/Middle');
  });

  test('teeNames filter restricts the imported set', () => {
    const d = details([
      makeTee({ name: 'Championship', gender: 'Male', baseYds: 400, rating: 75.5, slope: 141 }),
      makeTee({ name: 'Dye', gender: 'Male', baseYds: 360, rating: 71.3, slope: 130 }),
    ]);
    const r = mapGhinCourseToSaveRequest(d, { gender: 'Male', teeNames: ['Dye'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.course.tees.map((t) => t.color)).toEqual(['Dye']);
  });

  test('no qualifying tees → ok:false no_importable_tees', () => {
    const d = details([
      makeTee({ name: 'Middle', gender: 'Female', baseYds: 330, rating: 73.6, slope: 128 }),
    ]);
    const r = mapGhinCourseToSaveRequest(d, { gender: 'Male' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no_importable_tees');
  });

  test('reference tee with a broken stroke index is rejected', () => {
    const bad = makeTee({ name: 'Championship', gender: 'Male', baseYds: 400, rating: 75.5, slope: 141 });
    bad.holes = bad.holes.map((h) => ({ ...h, allocation: 1 })); // all SI=1, not a permutation
    const r = mapGhinCourseToSaveRequest(details([bad]), { gender: 'Male' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no_valid_stroke_index');
  });
});
