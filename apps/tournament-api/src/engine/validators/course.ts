/**
 * T2-4: Course Validator.
 *
 * Pure synchronous function that validates a `ParsedCourse` (T2-3 parser
 * output shape) against cross-field invariants Zod cannot natively express:
 * - Hole-number bijection 1..18, no duplicates, no gaps, no extras
 * - Stroke-index bijection 1..18 (same constraint)
 * - Yardage keys per hole match the declared `tees[].color` set exactly
 * - Printed totals (out_total, in_total, course_total) match computed sums
 * - Printed totals are internally consistent (out + in === course)
 *
 * Consumers: T2-5's admin save endpoint will call this before persistence.
 * T2-3's parse-pdf route does NOT call this directly (decoupled per spec
 * AC #19 — wiring the validator into the parser endpoint forces a
 * response-shape decision that T2-5 owns).
 *
 * Contract:
 * - No I/O, no DB, no async, no global state, no logging side-effects
 * - Same input → same output, every call
 * - Returns a discriminated `ValidationResult` union:
 *     { valid: true; errors: [] }       — all rules passed
 *     { valid: false; errors: [...] }   — at least one rule failed
 * - Does NOT short-circuit on first failure; accumulates all errors
 *   EXCEPT for an explicit cross-rule prerequisite: rules 13-17 (totals
 *   comparisons) skip if rule 5 (holes length=18) or rule 7 (hole-number
 *   bijection) failed, since totals computation on malformed holes would
 *   produce meaningless errors or throw.
 *
 * Error message templates pinned in story file §6 — tests assert exact
 * strings.
 */

import type { ParsedCourse } from '../../lib/course-parser.js';

export type ValidationResult =
  | { valid: true; errors: [] }
  | { valid: false; errors: [string, ...string[]] };

const VALID_PARS = new Set([3, 4, 5]);
const SLOPE_MIN = 55;
const SLOPE_MAX = 155;
const HOLE_COUNT = 18;

/**
 * Validates a ParsedCourse against all T2-4 rules. Returns
 * `{ valid: true, errors: [] }` on success or `{ valid: false, errors }`
 * with all detected errors.
 */
export function validateCourse(course: ParsedCourse): ValidationResult {
  const errors: string[] = [];

  // ---- Section A: required-field presence + type-shape sanity ----------

  // Rule 1: name non-empty after trim
  if (typeof course.name !== 'string' || course.name.trim().length === 0) {
    errors.push('name must be a non-empty string');
  }

  // Rule 2: club_name non-empty after trim
  if (typeof course.club_name !== 'string' || course.club_name.trim().length === 0) {
    errors.push('club_name must be a non-empty string');
  }

  // Rule 3: tees non-empty array
  if (!Array.isArray(course.tees) || course.tees.length === 0) {
    errors.push('tees must be a non-empty array');
  }

  // Rule 4: each tee has valid color, rating, slope (one error per offending field per offending tee).
  // Defensive: null/undefined/non-object array elements get a single
  // generic error rather than throwing — the validator's contract is to
  // gracefully accept any input and return a structured result.
  if (Array.isArray(course.tees)) {
    course.tees.forEach((tee, i) => {
      if (tee === null || tee === undefined || typeof tee !== 'object') {
        errors.push(`tees[${i}] must be an object`);
        return;
      }
      if (typeof tee.color !== 'string' || tee.color.trim().length === 0) {
        errors.push(`tees[${i}] color must be a non-empty string`);
      }
      if (typeof tee.rating !== 'number' || !Number.isFinite(tee.rating) || tee.rating <= 0) {
        errors.push(`tees[${i}] rating ${tee.rating} must be a positive number`);
      }
      if (
        typeof tee.slope !== 'number' ||
        !Number.isInteger(tee.slope) ||
        tee.slope < SLOPE_MIN ||
        tee.slope > SLOPE_MAX
      ) {
        errors.push(
          `tees[${i}] slope ${tee.slope} is outside the valid range ${SLOPE_MIN}-${SLOPE_MAX}`,
        );
      }
    });
  }

  // Rule 5: holes is exactly 18 entries
  const rule5Pass =
    Array.isArray(course.holes) && course.holes.length === HOLE_COUNT;
  if (!Array.isArray(course.holes)) {
    errors.push(`holes must have exactly ${HOLE_COUNT} entries (got non-array)`);
  } else if (course.holes.length !== HOLE_COUNT) {
    errors.push(
      `holes must have exactly ${HOLE_COUNT} entries (got ${course.holes.length})`,
    );
  }

  // Rule 6: totals has positive-integer out_total, in_total, course_total
  if (
    !course.totals ||
    typeof course.totals !== 'object' ||
    !isPositiveInt(course.totals.out_total) ||
    !isPositiveInt(course.totals.in_total) ||
    !isPositiveInt(course.totals.course_total)
  ) {
    errors.push('totals must include positive-integer out_total, in_total, course_total');
  }

  // ---- Section B: hole-index cross-field invariants -------------------

  // Rule 7: hole numbers form exactly {1..18}.
  // Filter out null/undefined/non-object hole entries before mapping —
  // bijection check on `[null].map(h => h.number)` would throw; instead
  // we treat malformed entries as "not in the set" and let rule 7 emit
  // a missing/extra mismatch for them.
  let rule7Pass = false;
  const validHoleEntries: NonNullable<typeof course.holes>[number][] = Array.isArray(course.holes)
    ? course.holes.filter(
        (h): h is NonNullable<typeof course.holes>[number] =>
          h !== null && h !== undefined && typeof h === 'object',
      )
    : [];
  if (Array.isArray(course.holes)) {
    const numbers = validHoleEntries.map((h) => h.number);
    const setMismatchErr = checkBijection18(numbers, 'Hole numbers do not form 1..18');
    if (setMismatchErr === null) {
      rule7Pass = true;
    } else {
      errors.push(setMismatchErr);
    }
  }

  // Rule 8: par ∈ {3, 4, 5} — one error per offending hole. Iterate only
  // valid hole entries (null/undefined entries already surfaced as a
  // hole-numbers-mismatch via rule 7's filter).
  validHoleEntries.forEach((h) => {
    if (!VALID_PARS.has(h.par)) {
      errors.push(`Hole ${h.number} par is ${h.par}; must be 3, 4, or 5`);
    }
  });

  // Rule 9: SIs form exactly {1..18}
  if (Array.isArray(course.holes)) {
    const sis = validHoleEntries.map((h) => h.si);
    const setMismatchErr = checkBijection18(sis, 'Stroke indexes do not form 1..18');
    if (setMismatchErr !== null) {
      errors.push(setMismatchErr);
    }
  }

  // ---- Section C: tee + yardage cross-field invariants ----------------

  // Rule 10: tee colors unique
  if (Array.isArray(course.tees)) {
    const seen = new Set<string>();
    for (const tee of course.tees) {
      if (typeof tee.color === 'string' && seen.has(tee.color)) {
        errors.push(`Duplicate tee color: ${tee.color}`);
        break; // one-error-per-call per cardinality policy
      }
      if (typeof tee.color === 'string') seen.add(tee.color);
    }
  }

  // Rule 11: yardage keys per hole match declared tee colors (FIRST-mismatch locator).
  // A hole with missing/non-object yardages is treated as a key-set mismatch
  // (empty keys vs declared tees) — keeps the rule's "yardages must match
  // tees" contract strict instead of silently accepting malformed input.
  if (
    Array.isArray(course.tees) &&
    Array.isArray(course.holes) &&
    course.tees.length > 0
  ) {
    const declaredColors = course.tees
      .map((t) => t.color)
      .filter((c): c is string => typeof c === 'string' && c.length > 0);
    const declaredSet = new Set(declaredColors);
    for (const hole of validHoleEntries) {
      const hasObjectYardages =
        hole.yardages !== null &&
        hole.yardages !== undefined &&
        typeof hole.yardages === 'object';
      const yardageKeys = hasObjectYardages ? Object.keys(hole.yardages) : [];
      const yardageSet = new Set(yardageKeys);
      const missing = [...declaredSet]
        .filter((c) => !yardageSet.has(c))
        .sort();
      const extra = [...yardageSet]
        .filter((k) => !declaredSet.has(k))
        .sort();
      if (missing.length > 0 || extra.length > 0) {
        errors.push(
          `Hole ${hole.number} yardage keys [${[...yardageKeys].sort().join(', ')}] don't match declared tee colors [${[...declaredColors].sort().join(', ')}]: missing [${missing.join(', ')}], extra [${extra.join(', ')}]`,
        );
        break; // one error per call (FIRST-mismatch locator) per cardinality policy
      }
    }
  }

  // Rule 12: yardages are non-negative integers — one error per (hole, tee).
  // Non-object yardages produce no per-tee errors (rule 11 above already
  // surfaces the hole-level missing-keys mismatch); rule 12 only walks
  // entries when yardages is a real object.
  for (const hole of validHoleEntries) {
    if (
      hole.yardages === null ||
      hole.yardages === undefined ||
      typeof hole.yardages !== 'object'
    ) {
      continue;
    }
    for (const [color, y] of Object.entries(hole.yardages)) {
      if (typeof y !== 'number' || !Number.isInteger(y) || y < 0) {
        errors.push(
          `Hole ${hole.number} yardage for tee ${color} is ${y}; must be a non-negative integer`,
        );
      }
    }
  }

  // ---- Section D: printed-vs-computed totals (PREREQUISITES: rules 5 + 7) ----

  if (rule5Pass && rule7Pass && course.totals && typeof course.totals === 'object') {
    // Rule 13: compute the values (no error emitted; produces the comparison inputs).
    // Sorts validHoleEntries (already filtered for null entries above)
    // — rule 5 + rule 7 both passed, so length=18 + bijection guarantees
    // sortedHoles.slice(0, 9) and slice(9, 18) are well-defined.
    const sortedHoles = [...validHoleEntries].sort((a, b) => a.number - b.number);
    const computedOut = sortedHoles.slice(0, 9).reduce((s, h) => s + h.par, 0);
    const computedIn = sortedHoles.slice(9, 18).reduce((s, h) => s + h.par, 0);
    const computedCourse = computedOut + computedIn;

    // Rule 14: printed.out_total == computed_out
    if (course.totals.out_total !== computedOut) {
      errors.push(
        `Printed out_total ${course.totals.out_total} != computed sum of front-9 par ${computedOut}`,
      );
    }

    // Rule 15: printed.in_total == computed_in
    if (course.totals.in_total !== computedIn) {
      errors.push(
        `Printed in_total ${course.totals.in_total} != computed sum of back-9 par ${computedIn}`,
      );
    }

    // Rule 16: printed.course_total == computed_course
    if (course.totals.course_total !== computedCourse) {
      errors.push(
        `Printed course_total ${course.totals.course_total} != computed sum of all 18 par ${computedCourse}`,
      );
    }

    // Rule 17: printed internally consistent
    if (
      course.totals.out_total + course.totals.in_total !==
      course.totals.course_total
    ) {
      errors.push(
        `Printed totals inconsistent: out_total ${course.totals.out_total} + in_total ${course.totals.in_total} = ${
          course.totals.out_total + course.totals.in_total
        }, but course_total ${course.totals.course_total}`,
      );
    }
  }

  // ---- Return the discriminated union --------------------------------

  if (errors.length === 0) {
    return { valid: true, errors: [] };
  }
  return { valid: false, errors: errors as [string, ...string[]] };
}

/** Type guard — positive integer (excludes NaN, infinity, negatives, fractions). */
function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

/**
 * Checks whether the given numbers form exactly the set {1, 2, ..., 18}.
 * Returns null if they do; otherwise returns a 3-slot error message
 * matching the §6 template (missing/duplicate/extra).
 */
function checkBijection18(values: number[], setName: string): string | null {
  const expected = new Set<number>();
  for (let i = 1; i <= HOLE_COUNT; i++) expected.add(i);

  const seen = new Set<number>();
  const dupSet = new Set<number>();
  const extraSet = new Set<number>();
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      // Non-integer values land in `extra` (representing "not in 1..18")
      extraSet.add(v);
      continue;
    }
    if (v < 1 || v > HOLE_COUNT) {
      extraSet.add(v);
      continue;
    }
    if (seen.has(v)) {
      dupSet.add(v);
    } else {
      seen.add(v);
    }
  }

  const missingSet = new Set<number>();
  for (const want of expected) {
    if (!seen.has(want)) missingSet.add(want);
  }

  if (missingSet.size === 0 && dupSet.size === 0 && extraSet.size === 0) {
    return null;
  }

  const sortAsc = (a: number, b: number): number => a - b;
  const missing = [...missingSet].sort(sortAsc).join(', ');
  const duplicate = [...dupSet].sort(sortAsc).join(', ');
  const extra = [...extraSet].sort(sortAsc).join(', ');
  return `${setName}: missing [${missing}], duplicate [${duplicate}], extra [${extra}]`;
}
