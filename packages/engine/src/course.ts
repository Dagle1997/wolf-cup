import type { CourseHole, HoleNumber } from './types.js';
import { InvalidHoleError } from './types.js';

export type Tee = 'black' | 'blue' | 'white';

const COURSE_PAR = 71;

export const TEE_RATINGS: Record<Tee, { courseRating: number; slopeRating: number }> = {
  black: { courseRating: 71.4, slopeRating: 128 },
  blue:  { courseRating: 69.9, slopeRating: 126 },
  white: { courseRating: 67.7, slopeRating: 119 },
};

export function calcCourseHandicap(handicapIndex: number, tee: Tee): number {
  const { slopeRating, courseRating } = TEE_RATINGS[tee];
  return Math.round(handicapIndex * (slopeRating / 113) + (courseRating - COURSE_PAR));
}

/**
 * Guyan Golf & Country Club — Huntington, WV
 *
 * Source: Wolf Cup physical scorecard (authoritative)
 * Weekly tee rotation: black → blue → white → repeat
 *
 * Total par: 71 (36 out / 35 in)
 * Black: 6,523 yds  Blue: 6,209 yds  White: 5,795 yds
 */
const COURSE_DATA: CourseHole[] = [
  { hole:  1, par: 5, strokeIndex:  3, yardages: { black: 558, blue: 543, white: 497 } },
  { hole:  2, par: 4, strokeIndex:  1, yardages: { black: 444, blue: 396, white: 396 } },
  { hole:  3, par: 4, strokeIndex: 13, yardages: { black: 339, blue: 325, white: 325 } },
  { hole:  4, par: 4, strokeIndex:  5, yardages: { black: 358, blue: 353, white: 276 } },
  { hole:  5, par: 4, strokeIndex:  9, yardages: { black: 423, blue: 409, white: 402 } },
  { hole:  6, par: 3, strokeIndex: 17, yardages: { black: 148, blue: 135, white: 135 } },
  { hole:  7, par: 3, strokeIndex: 15, yardages: { black: 222, blue: 201, white: 188 } },
  { hole:  8, par: 5, strokeIndex:  7, yardages: { black: 525, blue: 515, white: 499 } },
  { hole:  9, par: 4, strokeIndex: 11, yardages: { black: 387, blue: 331, white: 331 } },
  { hole: 10, par: 4, strokeIndex:  8, yardages: { black: 352, blue: 344, white: 344 } },
  { hole: 11, par: 5, strokeIndex:  2, yardages: { black: 561, blue: 547, white: 474 } },
  { hole: 12, par: 3, strokeIndex: 18, yardages: { black: 165, blue: 156, white: 156 } },
  { hole: 13, par: 4, strokeIndex:  6, yardages: { black: 378, blue: 365, white: 365 } },
  { hole: 14, par: 4, strokeIndex: 10, yardages: { black: 361, blue: 341, white: 309 } },
  { hole: 15, par: 3, strokeIndex: 16, yardages: { black: 191, blue: 167, white: 140 } },
  { hole: 16, par: 4, strokeIndex:  4, yardages: { black: 390, blue: 381, white: 328 } },
  { hole: 17, par: 4, strokeIndex: 14, yardages: { black: 341, blue: 334, white: 296 } },
  { hole: 18, par: 4, strokeIndex: 12, yardages: { black: 380, blue: 366, white: 334 } },
];

// O(1) lookup map — avoids noUncheckedIndexedAccess issues with array indexing
const COURSE_MAP = new Map<HoleNumber, CourseHole>(
  COURSE_DATA.map(h => [h.hole, h]),
);

/**
 * Returns course data for a specific hole at Guyan G&CC.
 *
 * @param holeNumber - any number; validated at runtime
 * @throws {InvalidHoleError} if holeNumber is not an integer in range 1–18
 */
export function getCourseHole(holeNumber: number): CourseHole {
  if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18) {
    throw new InvalidHoleError(holeNumber);
  }
  const hole = COURSE_MAP.get(holeNumber as HoleNumber);
  if (hole === undefined) {
    // Unreachable for valid integers 1–18 — all 18 entries are in the map
    throw new InvalidHoleError(holeNumber);
  }
  return hole;
}

/**
 * Returns all 18 holes in order (hole 1 first, hole 18 last).
 * Returns a shallow copy — internal data is not exposed.
 */
export function getAllCourseHoles(): readonly CourseHole[] {
  return [...COURSE_DATA];
}
