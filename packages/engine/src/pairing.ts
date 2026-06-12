// ---------------------------------------------------------------------------
// Pairing engine — suggest optimal groups that minimize repeat pairings
// ---------------------------------------------------------------------------

/** Key format for pair cost lookup: `${minId}-${maxId}` */
export type PairingMatrix = Map<string, number>;

export interface SuggestGroupsInput {
  /** Cost matrix — key is `${minId}-${maxId}`, value is pair count */
  readonly matrix: PairingMatrix;
  /** Player IDs to assign into groups */
  readonly playerIds: readonly number[];
  /** Optional pin map: playerId → 0-based group index */
  readonly pins?: ReadonlyMap<number, number>;
  /** Players per group (default 4) */
  readonly groupSize?: number;
  /**
   * Optional random source (default `Math.random`). Must return a float in
   * `[0, 1)` (the `Math.random` contract). Injected only to make the
   * Fisher-Yates shuffle deterministic for tests and the reproducible replay
   * harness; production callers omit it and get `Math.random`. The shuffle
   * index is clamped defensively, so an out-of-contract value can't corrupt
   * the partition — it only skews the (already heuristic) shuffle.
   */
  readonly rng?: () => number;
}

export interface SuggestGroupsResult {
  /** Assigned groups — each sub-array contains player IDs */
  readonly groups: readonly (readonly number[])[];
  /** Player IDs that couldn't fill a complete group */
  readonly remainder: readonly number[];
  /** Total pairing cost of the assignment */
  readonly totalCost: number;
}

/** Canonical pair key — always lower ID first */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** Sum of all C(n,2) pair costs within a single group */
export function groupCost(matrix: PairingMatrix, groupPlayerIds: readonly number[]): number {
  let cost = 0;
  for (let i = 0; i < groupPlayerIds.length; i++) {
    for (let j = i + 1; j < groupPlayerIds.length; j++) {
      cost += matrix.get(pairKey(groupPlayerIds[i]!, groupPlayerIds[j]!)) ?? 0;
    }
  }
  return cost;
}

/**
 * Exponent for the convex repeat penalty. `2` (quadratic) makes the marginal
 * cost of the 2nd/3rd/4th pairing +3/+5/+7, strongly discouraging *pair*
 * concentration while leaving a brand-new pairing free. Named (not inlined) so
 * it is the single retune escape hatch if worst-player protection underdelivers.
 *
 * MUST stay a positive INTEGER: penalties are summed and compared with exact
 * `===` in the restart tie-break (`pairing.ts` selection). A non-integer
 * exponent would make `count ** exp` a float and the equality tie-test
 * unreliable. Retune by integer steps (2 → 3) only.
 */
export const REPEAT_PENALTY_EXP = 2;

/**
 * Convex penalty for a single pair given its HISTORICAL count `c`.
 * `penalty(0) = 0` keeps first-time pairings free; `c²` makes re-pairing an
 * already-high pair cost far more than a fresh one.
 */
export function pairPenalty(count: number): number {
  return count <= 0 ? 0 : count ** REPEAT_PENALTY_EXP;
}

/**
 * Sum of the convex `pairPenalty` over all C(n,2) pairs within a group.
 * Mirrors `groupCost` but on the penalty transform — this is the objective the
 * engine optimizes internally. `groupCost` (raw) is still what gets displayed.
 */
export function groupPenaltyCost(matrix: PairingMatrix, groupPlayerIds: readonly number[]): number {
  let cost = 0;
  for (let i = 0; i < groupPlayerIds.length; i++) {
    for (let j = i + 1; j < groupPlayerIds.length; j++) {
      cost += pairPenalty(matrix.get(pairKey(groupPlayerIds[i]!, groupPlayerIds[j]!)) ?? 0);
    }
  }
  return cost;
}

/**
 * Worst-player repeat load across an assignment: for each player, sum the
 * RAW historical counts with each of its assigned groupmates, then return the
 * maximum such load over all players (0 if none). This is the worst-off
 * individual the tie-break protects — deliberately named to avoid collision
 * with the per-group `maxPairCount` response field used elsewhere.
 */
export function maxPlayerRepeatLoad(
  matrix: PairingMatrix,
  groups: readonly (readonly number[])[],
): number {
  let worst = 0;
  for (const group of groups) {
    for (let i = 0; i < group.length; i++) {
      let load = 0;
      for (let j = 0; j < group.length; j++) {
        if (i === j) continue;
        load += matrix.get(pairKey(group[i]!, group[j]!)) ?? 0;
      }
      if (load > worst) worst = load;
    }
  }
  return worst;
}

/**
 * Suggest groups that minimize repeat pairings using greedy assignment
 * with random restarts.
 *
 * Algorithm:
 *   1. Partition pinned players into their assigned groups
 *   2. Shuffle unpinned players
 *   3. Assign each to the group with lowest incremental cost
 *   4. Track best result across restarts
 */
export function suggestGroups(input: SuggestGroupsInput): SuggestGroupsResult {
  const { matrix, playerIds, pins, groupSize = 4 } = input;
  const rng = input.rng ?? Math.random;

  // Dedupe defensively: a duplicate id would otherwise be placed twice and the
  // self-pair (pairKey(p,p)) costs 0, so the greedy phase would never discourage
  // assigning the same player to two groups.
  const uniquePlayerIds = [...new Set(playerIds)];

  if (uniquePlayerIds.length === 0) {
    return { groups: [], remainder: [], totalCost: 0 };
  }

  const numGroups = Math.floor(uniquePlayerIds.length / groupSize);
  if (numGroups === 0) {
    return { groups: [], remainder: [...uniquePlayerIds], totalCost: 0 };
  }

  const playerSet = new Set(uniquePlayerIds);
  const remainderIds = new Set<number>();
  const pinnedPlayers = new Set<number>();
  const pinMap = pins ?? new Map<number, number>();

  // Validate pins. Keep only pins whose player is a real, in-range member, drop
  // phantom/NaN ids and out-of-range group indexes, never pin the same player
  // twice, and never let pins overfill a group past groupSize (excess pins fall
  // through to the greedy phase as if unpinned). This guarantees the engine can
  // never emit an invalid partition from bad pin input.
  const validPins: Array<[number, number]> = [];
  const pinnedPerGroup = new Array<number>(numGroups).fill(0);
  for (const [pid, gIdx] of pinMap) {
    if (!Number.isInteger(pid) || !playerSet.has(pid)) continue;
    if (gIdx < 0 || gIdx >= numGroups) continue;
    if (pinnedPlayers.has(pid)) continue;
    if (pinnedPerGroup[gIdx]! >= groupSize) continue;
    pinnedPlayers.add(pid);
    pinnedPerGroup[gIdx]!++;
    validPins.push([pid, gIdx]);
  }

  const unpinnedPlayers = uniquePlayerIds.filter((id) => !pinnedPlayers.has(id));
  const restarts = 10;

  let bestGroups: number[][] | null = null;
  // Selection optimizes the convex PENALTY cost; ties broken by the lowest
  // worst-player load (the lever that actually protects the worst-off regular).
  let bestPenalty = Infinity;
  let bestLoad = Infinity;

  for (let attempt = 0; attempt < restarts; attempt++) {
    // Initialize groups with the validated pins (membership/range/capacity
    // already enforced above).
    const currentGroups: number[][] = Array.from({ length: numGroups }, () => []);
    for (const [pid, gIdx] of validPins) {
      currentGroups[gIdx]!.push(pid);
    }

    // Shuffle unpinned players (Fisher-Yates). Clamp the index to [0, i] so an
    // out-of-contract rng (returning <0, >=1, or NaN) can never index out of
    // bounds — NaN floors to NaN, so fall back to 0 before clamping.
    const shuffled = [...unpinnedPlayers];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const raw = Math.floor(rng() * (i + 1));
      const j = Number.isFinite(raw) ? Math.min(i, Math.max(0, raw)) : 0;
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }

    // Greedily assign each unpinned player to the group with lowest incremental cost
    const overflow: number[] = [];
    for (const pid of shuffled) {
      let bestGroup = -1;
      let bestIncrCost = Infinity;

      for (let g = 0; g < numGroups; g++) {
        if (currentGroups[g]!.length >= groupSize) continue;
        // Incremental cost = sum of CONVEX pair penalties with existing members.
        // pairPenalty(0)=0 ⇒ an all-fresh group still costs 0 (identical to the
        // old raw greedy in low-history weeks); it only diverges once a candidate
        // group already holds a prior partner.
        let incrCost = 0;
        for (const existing of currentGroups[g]!) {
          incrCost += pairPenalty(matrix.get(pairKey(pid, existing)) ?? 0);
        }
        if (incrCost < bestIncrCost) {
          bestIncrCost = incrCost;
          bestGroup = g;
        }
      }

      if (bestGroup >= 0) {
        currentGroups[bestGroup]!.push(pid);
      } else {
        overflow.push(pid);
      }
    }

    const penaltyCost = currentGroups.reduce((sum, g) => sum + groupPenaltyCost(matrix, g), 0);
    const thisLoad = maxPlayerRepeatLoad(matrix, currentGroups);
    // Lower convex penalty wins; on a tie, prefer the flatter-per-player option.
    if (penaltyCost < bestPenalty || (penaltyCost === bestPenalty && thisLoad < bestLoad)) {
      bestPenalty = penaltyCost;
      bestLoad = thisLoad;
      bestGroups = currentGroups;
      // Track overflow on best
      remainderIds.clear();
      for (const id of overflow) remainderIds.add(id);
    }
  }

  // Defensive: bestGroups is set on the first restart in practice (penaltyCost
  // is always a finite, non-negative integer < Infinity), but guard the
  // invariant rather than asserting non-null — a NaN penalty would otherwise
  // crash here. Fall back to leaving everyone unassigned.
  if (!bestGroups) {
    return { groups: [], remainder: [...uniquePlayerIds], totalCost: 0 };
  }

  // Return the RAW repeat-weight for display — the admin/attendance UIs and
  // their heatColor thresholds are tuned to raw magnitudes. Optimization above
  // happens on the convex penalty; totalCost is recomputed raw on the winner.
  const totalCost = bestGroups.reduce((sum, g) => sum + groupCost(matrix, g), 0);

  return {
    groups: bestGroups,
    remainder: [...remainderIds],
    totalCost,
  };
}
