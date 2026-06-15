/**
 * Pure mapping from a GHIN CRDB course-details payload to the
 * SaveCourseRequest shape consumed by POST /api/admin/courses. Kept pure +
 * dependency-free so it's unit-testable without network or DB.
 *
 * Design decisions (the local course model is intentionally simpler than
 * GHIN's):
 *   - ONE par + ONE stroke index per hole, shared across tees. GHIN carries
 *     par/allocation per tee; on the rare hole where they differ by tee, we
 *     take the values from the REFERENCE tee (the longest qualifying tee of
 *     the chosen gender). Per-tee par divergence is not representable and is
 *     dropped — documented, not silently lossy.
 *   - Only CURRENT tees of the chosen gender that have a `Total` rating AND a
 *     full 18 holes are importable. 9-hole / partial tees are skipped.
 *   - Combo tees (e.g. "Dye/Middle") import naturally — they're just another
 *     named tee with their own per-hole yardages.
 */

import type { GhinCourseDetails, GhinTeeSet } from './ghin-client.js';

export type MappedTee = { color: string; rating: number; slope: number };
export type MappedHole = {
  number: number;
  par: number;
  si: number;
  yardages: Record<string, number>;
};
export type MappedCourse = {
  name: string;
  club_name: string;
  tees: MappedTee[];
  holes: MappedHole[];
  totals: { out_total: number; in_total: number; course_total: number };
  source_url: string;
};

export type MapResult =
  | { ok: true; course: MappedCourse }
  | { ok: false; reason: string };

const GHIN_COURSE_URL = (id: number) =>
  `https://api2.ghin.com/api/v1/courses/${id}.json`;

function totalRating(tee: GhinTeeSet) {
  return tee.ratings.find((r) => r.type === 'Total');
}

/** A tee's allocation values form a valid 1..18 stroke-index permutation. */
function hasValidStrokeIndex(tee: GhinTeeSet): boolean {
  if (tee.holes.length !== 18) return false;
  const alloc = tee.holes.map((h) => h.allocation).sort((a, b) => a - b);
  return alloc.every((v, i) => v === i + 1);
}

export function mapGhinCourseToSaveRequest(
  details: GhinCourseDetails,
  opts: { gender?: 'Male' | 'Female'; teeNames?: string[] } = {},
): MapResult {
  const gender = opts.gender ?? 'Male';

  // Qualifying tees: chosen gender, a Total rating, exactly 18 holes.
  let qualifying = details.teeSets.filter(
    (t) => t.gender === gender && totalRating(t) && t.holes.length === 18,
  );
  if (opts.teeNames && opts.teeNames.length > 0) {
    const want = new Set(opts.teeNames);
    qualifying = qualifying.filter((t) => want.has(t.name));
  }
  if (qualifying.length === 0) {
    return { ok: false, reason: 'no_importable_tees' };
  }

  // De-duplicate by tee name (defensive — current sets shouldn't collide).
  const seenNames = new Set<string>();
  qualifying = qualifying.filter((t) => {
    if (seenNames.has(t.name)) return false;
    seenNames.add(t.name);
    return true;
  });

  // Reference tee for par + SI = longest tee with a VALID 1..18 allocation.
  const refCandidates = [...qualifying]
    .filter(hasValidStrokeIndex)
    .sort((a, b) => b.totalYardage - a.totalYardage);
  const ref = refCandidates[0];
  if (!ref) {
    return { ok: false, reason: 'no_valid_stroke_index' };
  }

  const refHoleByNumber = new Map(ref.holes.map((h) => [h.number, h]));

  const holes: MappedHole[] = [];
  for (let n = 1; n <= 18; n++) {
    const refHole = refHoleByNumber.get(n);
    if (!refHole) return { ok: false, reason: `reference_tee_missing_hole_${n}` };
    const yardages: Record<string, number> = {};
    for (const tee of qualifying) {
      const h = tee.holes.find((x) => x.number === n);
      if (!h) return { ok: false, reason: `tee_${tee.name}_missing_hole_${n}` };
      yardages[tee.name] = h.length;
    }
    holes.push({ number: n, par: refHole.par, si: refHole.allocation, yardages });
  }

  const pars = holes.map((h) => h.par);
  const out_total = pars.slice(0, 9).reduce((a, b) => a + b, 0);
  const in_total = pars.slice(9).reduce((a, b) => a + b, 0);

  const tees: MappedTee[] = qualifying.map((t) => {
    const r = totalRating(t)!;
    return { color: t.name, rating: r.courseRating, slope: r.slopeRating };
  });

  const name = (details.facilityName ?? details.name).trim();
  return {
    ok: true,
    course: {
      name,
      club_name: name,
      tees,
      holes,
      totals: { out_total, in_total, course_total: out_total + in_total },
      source_url: GHIN_COURSE_URL(details.ghinCourseId),
    },
  };
}
