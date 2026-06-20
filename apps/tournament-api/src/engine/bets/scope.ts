/**
 * Hole-scope → concrete hole list (PURE, P1).
 *
 * The 4-value hole_scope enum (front | back | total | full18) maps to the
 * course holes a bet depends on, intersected with the round's holesToPlay
 * (a 9-hole round has no back nine). Arbitrary hole sets (FR48) are DEFERRED
 * per architecture D1 — NOT v1.
 *
 *   - front:  holes 1..9
 *   - back:   holes 10..18
 *   - total:  holes 1..holesToPlay (Nassau "total" aggregate = the whole round)
 *   - full18: holes 1..holesToPlay (a standalone whole-round bet)
 *
 * `total` and `full18` resolve to the same hole set; they differ only in
 * intent (Nassau segment vs standalone bet), which matters to Epic 4
 * segmentation, not to the hole list. Both engine net (bets-query) and the
 * placement-cutoff check (bets-write) consume this so they can't disagree.
 */

export type HoleScope = 'front' | 'back' | 'total' | 'full18';

export function scopedHolesForScope(scope: HoleScope, holesToPlay: number): number[] {
  const last = Math.max(0, Math.min(18, holesToPlay));
  const range = (lo: number, hi: number): number[] => {
    const out: number[] = [];
    for (let h = lo; h <= hi; h++) out.push(h);
    return out;
  };
  switch (scope) {
    case 'front':
      return range(1, Math.min(9, last));
    case 'back':
      // No back nine on a 9-hole round → empty.
      return last <= 9 ? [] : range(10, last);
    case 'total':
    case 'full18':
      return range(1, last);
    default: {
      // Exhaustiveness guard — an unknown scope must not silently settle.
      const _never: never = scope;
      throw new Error(`unknown hole_scope: ${String(_never)}`);
    }
  }
}
