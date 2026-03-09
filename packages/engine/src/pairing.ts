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

  if (playerIds.length === 0) {
    return { groups: [], remainder: [], totalCost: 0 };
  }

  const numGroups = Math.floor(playerIds.length / groupSize);
  if (numGroups === 0) {
    return { groups: [], remainder: [...playerIds], totalCost: 0 };
  }

  const remainderIds = new Set<number>();
  const pinnedPlayers = new Set<number>();
  const pinMap = pins ?? new Map<number, number>();

  // Validate pins
  for (const [pid, gIdx] of pinMap) {
    if (gIdx < 0 || gIdx >= numGroups) continue;
    pinnedPlayers.add(pid);
  }

  const unpinnedPlayers = playerIds.filter((id) => !pinnedPlayers.has(id));
  const restarts = 10;

  let bestGroups: number[][] | null = null;
  let bestCost = Infinity;

  for (let attempt = 0; attempt < restarts; attempt++) {
    // Initialize groups with pinned players
    const currentGroups: number[][] = Array.from({ length: numGroups }, () => []);
    for (const [pid, gIdx] of pinMap) {
      if (gIdx >= 0 && gIdx < numGroups) {
        currentGroups[gIdx]!.push(pid);
      }
    }

    // Shuffle unpinned players (Fisher-Yates)
    const shuffled = [...unpinnedPlayers];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }

    // Greedily assign each unpinned player to the group with lowest incremental cost
    const overflow: number[] = [];
    for (const pid of shuffled) {
      let bestGroup = -1;
      let bestIncrCost = Infinity;

      for (let g = 0; g < numGroups; g++) {
        if (currentGroups[g]!.length >= groupSize) continue;
        // Incremental cost = sum of pair costs with existing members
        let incrCost = 0;
        for (const existing of currentGroups[g]!) {
          incrCost += matrix.get(pairKey(pid, existing)) ?? 0;
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

    const totalCost = currentGroups.reduce((sum, g) => sum + groupCost(matrix, g), 0);
    if (totalCost < bestCost) {
      bestCost = totalCost;
      bestGroups = currentGroups;
      // Track overflow on best
      remainderIds.clear();
      for (const id of overflow) remainderIds.add(id);
    }
  }

  return {
    groups: bestGroups!,
    remainder: [...remainderIds],
    totalCost: bestCost,
  };
}
