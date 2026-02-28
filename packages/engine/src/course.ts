import type { CourseHole, HoleNumber } from './types.js';
import { InvalidHoleError } from './types.js';

/**
 * Guyan Golf & Country Club — Huntington, WV
 *
 * Course ratings:
 *   Blue  71.2 / 126  (6,455 yds)
 *   White 69.3 / 122  (6,062 yds)
 *   Gold  66.5 / 113  (5,602 yds)
 *   Red   71.8 / 123  (4,942 yds)
 *
 * Total par: 71 (36 out / 35 in)
 */
const COURSE_DATA: CourseHole[] = [
  { hole:  1, par: 5, strokeIndex:  3, yardages: { blue: 567, white: 548, gold: 508, red: 466 } },
  { hole:  2, par: 4, strokeIndex:  1, yardages: { blue: 444, white: 382, gold: 357, red: 311 } },
  { hole:  3, par: 4, strokeIndex: 13, yardages: { blue: 328, white: 317, gold: 303, red: 271 } },
  { hole:  4, par: 4, strokeIndex:  5, yardages: { blue: 358, white: 351, gold: 325, red: 289 } },
  { hole:  5, par: 4, strokeIndex:  9, yardages: { blue: 414, white: 401, gold: 381, red: 347 } },
  { hole:  6, par: 3, strokeIndex: 17, yardages: { blue: 148, white: 135, gold: 118, red:  95 } },
  { hole:  7, par: 3, strokeIndex: 15, yardages: { blue: 222, white: 197, gold: 171, red: 128 } },
  { hole:  8, par: 5, strokeIndex:  7, yardages: { blue: 510, white: 488, gold: 461, red: 412 } },
  { hole:  9, par: 4, strokeIndex: 11, yardages: { blue: 346, white: 311, gold: 289, red: 251 } },
  { hole: 10, par: 4, strokeIndex:  8, yardages: { blue: 356, white: 344, gold: 315, red: 280 } },
  { hole: 11, par: 5, strokeIndex:  2, yardages: { blue: 566, white: 543, gold: 508, red: 459 } },
  { hole: 12, par: 3, strokeIndex: 18, yardages: { blue: 159, white: 147, gold: 133, red: 111 } },
  { hole: 13, par: 4, strokeIndex:  6, yardages: { blue: 383, white: 357, gold: 329, red: 285 } },
  { hole: 14, par: 4, strokeIndex: 10, yardages: { blue: 357, white: 304, gold: 279, red: 246 } },
  { hole: 15, par: 3, strokeIndex: 16, yardages: { blue: 176, white: 151, gold: 126, red: 102 } },
  { hole: 16, par: 4, strokeIndex:  4, yardages: { blue: 396, white: 386, gold: 352, red: 312 } },
  { hole: 17, par: 4, strokeIndex: 14, yardages: { blue: 345, white: 334, gold: 309, red: 275 } },
  { hole: 18, par: 4, strokeIndex: 12, yardages: { blue: 380, white: 366, gold: 338, red: 302 } },
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
 * Readonly — the underlying array is not exposed.
 */
export function getAllCourseHoles(): readonly CourseHole[] {
  return [...COURSE_DATA];
}
