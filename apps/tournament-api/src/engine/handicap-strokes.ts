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
 * Per-hole handicap-stroke allocation FROM AN ALREADY-COMPUTED course handicap.
 *
 * This is the canonical allocation kernel: it does NOT compute (and never
 * re-derives) a course handicap from a handicap index + tee — the CH is passed
 * in. It exists so the F1 recompute-on-read path (Story 1.4) can allocate per
 * hole from the PINNED course handicap (money-safety invariant: reads never
 * call `calcCourseHandicap` / read a live HI). `getHandicapStrokes` below
 * delegates here, so the base/extra split lives in exactly one place — this is
 * NOT new allocation math, it is the existing formula reached via the CH
 * directly.
 *
 * Plus-handicap clamp: returns 0 when CH ≤ 0 (AC-13(vii)).
 */
export function allocateStrokesFromCourseHandicap(
  courseHandicap: number,
  strokeIndex: number,
): number {
  if (!Number.isInteger(strokeIndex) || strokeIndex < 1 || strokeIndex > 18) {
    throw new RangeError(
      `allocateStrokesFromCourseHandicap: strokeIndex must be integer in [1, 18] (got ${strokeIndex})`,
    );
  }
  if (!Number.isInteger(courseHandicap)) {
    throw new TypeError(
      `allocateStrokesFromCourseHandicap: courseHandicap must be an integer (got ${courseHandicap})`,
    );
  }
  if (courseHandicap <= 0) return 0;
  const base = Math.floor(courseHandicap / 18);
  const extra = courseHandicap % 18;
  return base + (strokeIndex <= extra ? 1 : 0);
}

/**
 * Apply a handicap allowance percentage, THEN play "off the low" within a group.
 *
 * The money rule (Pete Dye Guyan 2v2): `allowedCH = round(fullCH × pct/100)` per
 * player, then the LOWEST allowed CH in the group plays to scratch and every
 * other player gets `allowedCH − groupLow` strokes (allocated per hole by
 * `allocateStrokesFromCourseHandicap`). Order matters: allowance first, low
 * subtraction second.
 *
 * `pct` is an integer percent (e.g. 80; 100 = no reduction). Rounding is half-up
 * (`Math.round`) — the USGA convention, matching `calcCourseHandicap` above.
 *
 * Pure. Returns each player's allowed CH, the group low, and the off-the-low
 * handicap they allocate strokes from (always ≥ 0, since groupLow is the min).
 * Throws on an empty group (a 0-player foursome is a caller bug, not scratch) and
 * on a non-integer input CH (a corrupt pin): because this rounds, it would
 * otherwise mask a non-integer CH and let `allocateStrokesFromCourseHandicap`
 * settle it — so it enforces the same integer precondition the allocator does,
 * keeping the corrupt-pin fail-closed guard intact for every caller.
 *
 * Rounding is float `Math.round` of `(ch*pct)/100`; for integer ch + pct this is
 * exact half-up over the positive domain (every `k.5` quotient is exactly
 * representable in IEEE-754), matching the USGA convention and the golden.
 */
export function applyAllowanceOffLow(
  chByPlayer: ReadonlyMap<string, number>,
  pct: number,
): { allowed: Map<string, number>; groupLow: number; offLow: Map<string, number> } {
  if (chByPlayer.size === 0) {
    throw new Error('applyAllowanceOffLow: empty group');
  }
  const allowed = new Map<string, number>();
  for (const [playerId, ch] of chByPlayer) {
    if (!Number.isInteger(ch)) {
      throw new TypeError(`applyAllowanceOffLow: course handicap must be an integer (got ${ch} for ${playerId})`);
    }
    allowed.set(playerId, Math.round((ch * pct) / 100));
  }
  let groupLow = Infinity;
  for (const a of allowed.values()) if (a < groupLow) groupLow = a;
  const offLow = new Map<string, number>();
  for (const [playerId, a] of allowed) offLow.set(playerId, a - groupLow);
  return { allowed, groupLow, offLow };
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
  const ch = calcCourseHandicap({ handicapIndex, ...tee });
  return allocateStrokesFromCourseHandicap(ch, strokeIndex);
}
