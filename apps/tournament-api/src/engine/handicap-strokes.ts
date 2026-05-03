/**
 * T6-1 engine handicap math (per-hole stroke allocation + slope-aware
 * course handicap).
 *
 * **Layering rationale (T6-1 Section 2b):** these functions live in the
 * engine layer because they are pure-function inputs to T6-1's 2v2
 * best-ball math. T5-5 originally placed `calcCourseHandicap` in
 * `services/handicap.ts` for leaderboard.ts callers; T6-1 promotes it
 * here and `services/handicap.ts` becomes a thin wrapper that delegates
 * to this module. T5-5's existing public API (`CourseHandicapInput`
 * type, leaderboard.ts compile contract) is preserved.
 *
 * **Inline-port posture (T6-1 Section 2 option A):** mirror of
 * `packages/engine/src/stableford.ts:11-16` math. Wolf Cup's engine
 * has no `./stableford` subpath export and tournament's eslint rule
 * blocks the would-be import path. Followup T6-1a (next-trigger
 * priority) tracks consolidation if/when packages/engine exposes
 * subpath exports OR a third tournament inline-port event lands.
 *
 * **Plus-handicap clamp (AC-13(vii)):** when course handicap is ≤ 0
 * (a "plus" handicap or scratch), `getHandicapStrokes` returns 0 for
 * every stroke index. v1 does NOT propagate negative strokes back to
 * the caller — Pinehurst's trip roster is all positive HIs.
 */

export type TeeShape = {
  /** USGA slope rating (typically 55–155). */
  slope: number;
  /** USGA course rating × 10 (e.g. 72.3 → 723). Stored ×10 per integer-discipline. */
  ratingTimes10: number;
  /** Course par from `course_revisions.courseTotal` (typically 70–72). */
  coursePar: number;
};

export type CalcCourseHandicapInput = TeeShape & {
  /** Player's USGA handicap index (e.g. 12.4). Throws if non-finite. */
  handicapIndex: number;
};

/**
 * USGA slope-aware course handicap (relocated from services/handicap.ts).
 *
 *   courseHandicap = round(handicapIndex × (slope / 113) + (rating − coursePar))
 *
 * Returns an integer (rounded half-up via Math.round). Throws on
 * non-finite / non-positive inputs (caller's responsibility to handle
 * null handicap before calling — see leaderboard.ts).
 */
export function calcCourseHandicap(input: CalcCourseHandicapInput): number {
  const { handicapIndex, slope, ratingTimes10, coursePar } = input;
  if (typeof handicapIndex !== 'number' || !Number.isFinite(handicapIndex)) {
    throw new Error('calcCourseHandicap: handicapIndex must be a finite number');
  }
  if (typeof slope !== 'number' || !Number.isFinite(slope) || slope <= 0) {
    throw new Error('calcCourseHandicap: slope must be a positive finite number');
  }
  if (typeof ratingTimes10 !== 'number' || !Number.isFinite(ratingTimes10) || ratingTimes10 <= 0) {
    throw new Error('calcCourseHandicap: ratingTimes10 must be a positive finite number');
  }
  if (typeof coursePar !== 'number' || !Number.isFinite(coursePar) || coursePar <= 0) {
    throw new Error('calcCourseHandicap: coursePar must be a positive finite number');
  }
  const rating = ratingTimes10 / 10;
  const result = Math.round(handicapIndex * (slope / 113) + (rating - coursePar));
  // Normalize JS's signed zero — downstream Object.is comparisons treat ±0 as distinct.
  return result === 0 ? 0 : result;
}

/**
 * Per-hole handicap-stroke allocation. Mirrors
 * `packages/engine/src/stableford.ts:11-16`'s math.
 *
 * Plus-handicap clamp: returns 0 when slope-adjusted CH ≤ 0 (AC-13(vii)).
 */
export function getHandicapStrokes(
  handicapIndex: number,
  strokeIndex: number,
  tee: TeeShape,
): number {
  if (!Number.isInteger(strokeIndex) || strokeIndex < 1 || strokeIndex > 18) {
    throw new RangeError(
      `getHandicapStrokes: strokeIndex must be integer in [1, 18] (got ${strokeIndex})`,
    );
  }
  const ch = calcCourseHandicap({ handicapIndex, ...tee });
  if (ch <= 0) return 0;
  const base = Math.floor(ch / 18);
  const extra = ch % 18;
  return base + (strokeIndex <= extra ? 1 : 0);
}
