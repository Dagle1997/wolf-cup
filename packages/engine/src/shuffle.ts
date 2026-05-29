/**
 * Uniform Fisher–Yates (Durstenfeld) shuffle.
 *
 * Returns a NEW array; does not mutate the input. Every permutation is equally
 * likely.
 *
 * This replaces the `arr.sort(() => Math.random() - 0.5)` idiom, which is badly
 * non-uniform on V8: arrays of length <= 10 use insertion sort, which leaves
 * elements close to their source index, so a player's draw position is pinned by
 * their slot in the input list rather than randomized. (Discovered 2026-05-29 in
 * the ball-draw batting order — one player drew 3rd every round of the season.)
 */
export function shuffle<T>(input: readonly T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}
