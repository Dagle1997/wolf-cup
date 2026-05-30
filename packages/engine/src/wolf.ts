import type { BattingOrder, BattingPosition, HoleAssignment, HoleNumber } from './types.js';

/**
 * Fixed wolf hole assignment table.
 * Maps hole number → batting position index for the 16 wolf holes.
 * Holes 1 and 3 are skins and not present in this map.
 *
 * Batter 1 (index 0): holes 2, 6, 9, 14
 * Batter 2 (index 1): holes 4, 7, 10, 16
 * Batter 3 (index 2): holes 5, 11, 12, 17
 * Batter 4 (index 3): holes 8, 13, 15, 18
 */
const WOLF_TABLE = new Map<HoleNumber, BattingPosition>([
  [2,  0], [6,  0], [9,  0], [14, 0],
  [4,  1], [7,  1], [10, 1], [16, 1],
  [5,  2], [11, 2], [12, 2], [17, 2],
  [8,  3], [13, 3], [15, 3], [18, 3],
]);

/**
 * Returns the wolf hole assignment for a given hole based on batting order.
 *
 * Holes 1 and 3 are skins holes. The remaining 16 holes have a fixed wolf rotation
 * derived from the ball draw batting order.
 *
 * Pure function — deterministic, no side effects.
 *
 * @param _battingOrder - 4-tuple of player IDs in ball draw order (unused here; caller resolves player via battingOrder[wolfBatterIndex])
 * @param holeNumber    - hole 1–18
 * @returns HoleAssignment — either { type: 'skins' } or { type: 'wolf', wolfBatterIndex }
 */
export function getWolfAssignment<TPlayerId>(
  _battingOrder: BattingOrder<TPlayerId>,
  holeNumber: HoleNumber,
): HoleAssignment {
  if (holeNumber === 1 || holeNumber === 3) {
    return { type: 'skins' };
  }

  const wolfBatterIndex = WOLF_TABLE.get(holeNumber);
  if (wolfBatterIndex === undefined) {
    // Unreachable for valid HoleNumber — all 16 wolf holes are in the table
    throw new Error(`Wolf table missing entry for hole ${holeNumber}`);
  }

  return { type: 'wolf', wolfBatterIndex };
}

/**
 * Given an old and a new batting order (each a 4-tuple of player IDs), return
 * the wolf holes whose WOLF changes — i.e. holes whose batting-slot occupant
 * differs between the two orders. Skins holes (1, 3) are never included.
 *
 * Pure. Used by the in-round batting-order correction to detect which
 * already-recorded wolf decisions a reorder invalidates (the decision belongs
 * to whoever was wolf then; a new wolf means the call must be re-entered).
 *
 * Both orders must contain the same 4 player IDs (a reorder, not a roster
 * change). Returned holes are sorted ascending.
 */
export function wolfHoleChanges(
  oldOrder: readonly number[],
  newOrder: readonly number[],
): Array<{ hole: HoleNumber; oldWolf: number; newWolf: number }> {
  const changes: Array<{ hole: HoleNumber; oldWolf: number; newWolf: number }> = [];
  for (const [hole, slot] of WOLF_TABLE) {
    const oldWolf = oldOrder[slot];
    const newWolf = newOrder[slot];
    if (oldWolf !== undefined && newWolf !== undefined && oldWolf !== newWolf) {
      changes.push({ hole, oldWolf, newWolf });
    }
  }
  return changes.sort((a, b) => a.hole - b.hole);
}
