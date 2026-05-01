/**
 * Slope-aware course handicap math (T5-5).
 *
 * Formula source: `packages/engine/src/course.ts:14` (USGA standard).
 * Tournament owns its own copy because Wolf Cup's engine hardcodes Guyan
 * tee data; tournament reads slope/rating per-course from `course_tees`.
 *
 *   courseHandicap = round(handicapIndex × (slope / 113) + (rating − coursePar))
 *
 * v1 limitations (per T5-5 spec sections 4–5):
 *   - 18-hole rating only. Per-9 ratings are NOT half-of-18; they are
 *     USGA-issued per nine and require schema columns + parser update +
 *     back-fill (deferred to T5-5c). For Pinehurst trip-week (4 days ×
 *     18-hole rounds), 18-hole rating is sufficient.
 *   - `rating` column stores USGA rating × 10 (e.g. 72.3 → 723) per
 *     `course_tees` integer-cents discipline; this module decodes by
 *     dividing by 10 before applying the formula.
 */

export type CourseHandicapInput = {
  /** Player's USGA handicap index (e.g. 12.4). Throws if null/undefined. */
  handicapIndex: number;
  /** USGA slope rating from `course_tees.slope` (integer 55–155). */
  slope: number;
  /**
   * USGA course rating × 10 from `course_tees.rating` (e.g. 723 = 72.3).
   * This module divides by 10 internally.
   */
  ratingTimes10: number;
  /** Course par from `course_revisions.courseTotal` (typically 70–72). */
  coursePar: number;
};

/**
 * USGA course handicap. Returns an integer (rounded half-up via Math.round).
 * Throws on missing/invalid inputs — caller's responsibility to handle null
 * handicap index BEFORE calling this (see leaderboard.ts which sets
 * `netThroughHole = null` for players with no handicap on file).
 */
export function calcCourseHandicap(input: CourseHandicapInput): number {
  const { handicapIndex, slope, ratingTimes10, coursePar } = input;
  if (typeof handicapIndex !== 'number' || Number.isNaN(handicapIndex)) {
    throw new Error('calcCourseHandicap: handicapIndex must be a finite number');
  }
  if (typeof slope !== 'number' || slope <= 0) {
    throw new Error('calcCourseHandicap: slope must be a positive number');
  }
  if (typeof ratingTimes10 !== 'number' || ratingTimes10 <= 0) {
    throw new Error('calcCourseHandicap: ratingTimes10 must be a positive number');
  }
  if (typeof coursePar !== 'number' || coursePar <= 0) {
    throw new Error('calcCourseHandicap: coursePar must be a positive number');
  }
  const rating = ratingTimes10 / 10;
  const result = Math.round(handicapIndex * (slope / 113) + (rating - coursePar));
  // Normalize JS's signed zero (Math.round(-0.5) returns -0) — a course
  // handicap of zero is conceptually unsigned and downstream `Object.is`
  // comparisons in tests + caches treat -0 and +0 as distinct.
  return result === 0 ? 0 : result;
}

export type NetAllocationInput = {
  /** Output of calcCourseHandicap (integer). */
  courseHandicap: number;
  /**
   * Holes scored so far in this scope (0..N where N is holes_to_play). For
   * 18-hole rounds, N=18; for 9-hole rounds (deferred to T5-5c), N=9.
   */
  throughHole: number;
};

/**
 * Proportional allocation of course handicap to holes played so far.
 * Used to compute `netThroughHole` for partial rounds. The v1 alternative
 * (per-stroke-index allocation following Wolf Cup's `getHandicapStrokes`)
 * is more accurate but deferred — gross is the primary leaderboard
 * metric, net is supporting.
 *
 * Returns 0 if throughHole is 0 (avoids div-by-zero and matches the
 * "unscored = no allocation" semantics).
 */
export function allocateNetThroughHole(input: NetAllocationInput): number {
  const { courseHandicap, throughHole } = input;
  if (throughHole <= 0) return 0;
  if (throughHole >= 18) return courseHandicap;
  return Math.round((courseHandicap * throughHole) / 18);
}
