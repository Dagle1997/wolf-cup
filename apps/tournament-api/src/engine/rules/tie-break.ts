/**
 * T6-10 — leaderboard tie-break pure function (FR-C5).
 *
 * Stroke-play tie-break algorithm:
 *   1. Sort by total gross ascending (lowest first; partial rounds sort
 *      AFTER complete rounds regardless of gross — null > any integer
 *      for ordering).
 *   2. For groups of equal-gross-total players (a "tie group"):
 *      a. **18-hole rounds:** lower back-9 total (sum of holes 10–18,
 *         indices 9..17) wins. Players with any null in back-9 sort
 *         AFTER players with complete back-9.
 *      b. **9-hole rounds:** SKIP back-9 step (no back-9 exists).
 *      c. Walk backward from the last hole (18 or 9) toward hole 1:
 *         for each hole, lower gross wins. Null > any integer.
 *      d. If still tied after all steps, share the rank.
 *
 * Output: 1224-style ranking — ties share rank; next rank skips by
 * tied-group size. E.g., two players tied at rank 1 → both rank 1,
 * tiedWith = 2; next player ranks 3, NOT 2.
 *
 * **No DB, no I/O, no env, no clock, no crypto, no input mutation.**
 */

export type TieBreakInput = {
  playerId: string;
  /**
   * Total gross strokes across the round. May be null for unscored
   * players (T5-5 sorts them last regardless of grossByHole content).
   */
  grossStrokes: number | null;
  /**
   * Per-hole gross. Length matches `holesToPlay` (9 or 18).
   * `null` = unscored hole.
   */
  grossByHole: Array<number | null>;
};

export type TieBreakOutput = {
  playerId: string;
  /** 1-based rank (1224-style: ties share, next rank skips). */
  rank: number;
  /** Number of rows sharing this rank (≥ 1; > 1 means tie). */
  tiedWith: number;
};

/**
 * Comparator for two values where null > any integer (unscored sorts last).
 * Returns negative if a should rank higher (lower value), positive if b
 * should rank higher, 0 if equal.
 */
function compareNullableAsc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;   // a is "higher" (sorts later)
  if (b === null) return -1;
  return a - b;
}

/**
 * Sum back-9 (holes 10..18, indices 9..17). Returns null if ANY hole in
 * the back-9 is null (incomplete back-9 sorts after complete back-9).
 */
function back9Sum(grossByHole: Array<number | null>): number | null {
  let sum = 0;
  for (let i = 9; i < 18; i++) {
    const v = grossByHole[i];
    if (v === null || v === undefined) return null;
    sum += v;
  }
  return sum;
}

/**
 * Compare two tie-group rows step-by-step. Returns negative if a beats b,
 * positive if b beats a, 0 if truly tied.
 */
function compareTieGroupMembers(
  a: TieBreakInput,
  b: TieBreakInput,
  holesToPlay: 9 | 18,
): number {
  // Step (a): back-9 (only for 18-hole rounds).
  if (holesToPlay === 18) {
    const cmp = compareNullableAsc(back9Sum(a.grossByHole), back9Sum(b.grossByHole));
    if (cmp !== 0) return cmp;
  }
  // Step (b): walk backward from last hole to hole 1.
  for (let i = holesToPlay - 1; i >= 0; i--) {
    const cmp = compareNullableAsc(a.grossByHole[i] ?? null, b.grossByHole[i] ?? null);
    if (cmp !== 0) return cmp;
  }
  // Truly tied.
  return 0;
}

export function breakTie(
  rows: readonly TieBreakInput[],
  holesToPlay: 9 | 18,
): TieBreakOutput[] {
  // Stable sort by total gross asc (null last), then by tie-break order.
  const sorted = [...rows].sort((a, b) => {
    const grossCmp = compareNullableAsc(a.grossStrokes, b.grossStrokes);
    if (grossCmp !== 0) return grossCmp;
    return compareTieGroupMembers(a, b, holesToPlay);
  });

  // Walk sorted array; group consecutive runs of TRULY-TIED rows (where
  // both gross AND all tie-break steps come out equal).
  const output: TieBreakOutput[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (
      j < sorted.length &&
      compareNullableAsc(sorted[i]!.grossStrokes, sorted[j]!.grossStrokes) === 0 &&
      compareTieGroupMembers(sorted[i]!, sorted[j]!, holesToPlay) === 0
    ) {
      j++;
    }
    const tiedWith = j - i;
    const rank = i + 1;  // 1-based
    for (let k = i; k < j; k++) {
      output.push({ playerId: sorted[k]!.playerId, rank, tiedWith });
    }
    i = j;
  }

  return output;
}
