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
   * Optional set of player IDs that are SUBSTITUTES this week. The engine makes
   * a SOFT effort to keep two subs out of the same group (one sub per foursome,
   * the way the organizer pairs by hand). Soft = a large but finite penalty:
   * group capacity, hard pins, and keep-together links always win, and if subs
   * ever outnumber groups the partition still completes — collisions are only
   * minimized, never fatal. Omit (or pass empty) to disable, leaving the no-sub
   * path byte-identical to the pre-sub engine.
   */
  readonly subIds?: ReadonlySet<number>;
  /**
   * Optional HARD keep-together links: each `[a, b]` forces players a and b into
   * the same group (the "play-with sponsor" request — e.g. a sub attached to the
   * regular who invited them). Implemented by CONTRACTION: linked players form a
   * single unit that reserves adjacent seats, so the unit takes `members.length`
   * of a group's `groupSize` seats. A link is honored only when BOTH players are
   * in `playerIds`; a link naming an absent player is dropped (the present player
   * pairs normally). Transitive: `[a,b] + [b,c]` ⇒ `{a,b,c}` together. Capacity
   * still wins — a cluster larger than `groupSize` cannot fit and its members
   * fall back to normal (unlinked) assignment. Omit to leave the engine
   * byte-identical to the pre-link version.
   */
  readonly links?: ReadonlyArray<readonly [number, number]>;
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
 * Penalty for co-locating two SUBS in one group. Large enough to dominate any
 * realistic repeat-pairing penalty (so the engine reliably spreads subs across
 * groups), yet finite — group capacity, hard pins, and keep-together links all
 * still win, so the partition never fails to complete. MUST stay a positive
 * INTEGER for the same reason as REPEAT_PENALTY_EXP: scores are compared with
 * exact `===` in the restart tie-break.
 */
export const SUB_SPREAD_PENALTY = 100_000;

/** Shared empty set so the no-sub path allocates nothing per call. */
const EMPTY_NUMBER_SET: ReadonlySet<number> = new Set<number>();

/**
 * Count of sub-collisions in an assignment: for each group holding `k` subs, the
 * `(k - 1)` subs beyond the first each count as one collision. Returns 0 when
 * every group holds at most one sub (the goal), or when there are no subs.
 */
export function subCollisionCount(
  subIds: ReadonlySet<number>,
  groups: readonly (readonly number[])[],
): number {
  if (subIds.size === 0) return 0;
  let collisions = 0;
  for (const group of groups) {
    let n = 0;
    for (const p of group) if (subIds.has(p)) n++;
    if (n > 1) collisions += n - 1;
  }
  return collisions;
}

/**
 * Contract keep-together links into clusters via union-find. Returns one member
 * array per cluster; players with no link form singleton clusters. Cluster order
 * and within-cluster member order both follow `uniquePlayerIds` first-appearance
 * — so with NO links the result is exactly one singleton per player, in input
 * order, which is the property the no-link path relies on to stay byte-identical
 * (same shuffle length ⇒ same RNG draw sequence ⇒ same determinism).
 *
 * Self-links (`a === b`) and links naming a non-participant are ignored.
 */
function buildClusters(
  uniquePlayerIds: readonly number[],
  playerSet: ReadonlySet<number>,
  links: ReadonlyArray<readonly [number, number]> | undefined,
): number[][] {
  const parent = new Map<number, number>();
  for (const id of uniquePlayerIds) parent.set(id, id);

  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path compression.
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };

  if (links) {
    for (const [a, b] of links) {
      if (a === b) continue;
      if (!playerSet.has(a) || !playerSet.has(b)) continue;
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    }
  }

  const byRoot = new Map<number, number[]>();
  const order: number[] = [];
  for (const id of uniquePlayerIds) {
    const root = find(id);
    let members = byRoot.get(root);
    if (!members) {
      members = [];
      byRoot.set(root, members);
      order.push(root);
    }
    members.push(id);
  }
  return order.map((root) => byRoot.get(root)!);
}

/**
 * Suggest groups that minimize repeat pairings using greedy assignment
 * with random restarts.
 *
 * Algorithm:
 *   1. Contract keep-together links into clusters (singletons when no link)
 *   2. Partition pinned clusters into their assigned groups
 *   3. Shuffle unpinned clusters
 *   4. Assign each cluster to the group with lowest incremental cost (where cost
 *      = convex repeat penalty + a soft penalty for co-locating subs)
 *   5. Track best result across restarts (objective ties broken by lowest
 *      worst-player repeat load)
 */
export function suggestGroups(input: SuggestGroupsInput): SuggestGroupsResult {
  const { matrix, playerIds, pins, groupSize = 4 } = input;
  const rng = input.rng ?? Math.random;
  const subIds = input.subIds ?? EMPTY_NUMBER_SET;

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
  const pinMap = pins ?? new Map<number, number>();

  // Contract keep-together links into clusters. With no links this is one
  // singleton per player in input order (preserves the pre-link RNG sequence).
  const clusters = buildClusters(uniquePlayerIds, playerSet, input.links);

  // Map each player to the cluster that owns it (singletons map to themselves).
  const clusterOfPlayer = new Map<number, number>();
  clusters.forEach((members, idx) => {
    for (const m of members) clusterOfPlayer.set(m, idx);
  });

  // Lift pins to clusters in pinMap ITERATION ORDER — this preserves the legacy
  // pin precedence exactly: when more players are pinned to a group than fit, the
  // earlier-iterated pins win and later ones overflow to the greedy phase, and
  // pinned clusters are seeded into groups in that same order. With no links
  // every cluster is a singleton, so this reduces to the pre-cluster behavior
  // byte-for-byte (same honored set, same in-group ordering) — the property the
  // AC6 determinism guarantee depends on. Capacity is checked with the FULL
  // cluster size (a clustered, pinned player reserves the whole cluster's seats);
  // a pin that can't fit is dropped and its cluster falls through as unpinned.
  // First pin for a cluster wins (a second, conflicting pin on a LINKED member is
  // ignored).
  const pinnedClusters: Array<{ members: number[]; group: number }> = [];
  const clusterPinned = new Array<boolean>(clusters.length).fill(false);
  const slotsUsed = new Array<number>(numGroups).fill(0);
  for (const [pid, gIdx] of pinMap) {
    if (!Number.isInteger(pid) || !playerSet.has(pid)) continue;
    if (gIdx < 0 || gIdx >= numGroups) continue;
    const ci = clusterOfPlayer.get(pid)!;
    if (clusterPinned[ci]) continue; // cluster already pinned (first pin wins)
    const members = clusters[ci]!;
    if (slotsUsed[gIdx]! + members.length > groupSize) continue; // can't fit → greedy
    clusterPinned[ci] = true;
    slotsUsed[gIdx]! += members.length;
    pinnedClusters.push({ members, group: gIdx });
  }
  const unpinnedClusters = clusters.filter((_, idx) => !clusterPinned[idx]);

  const restarts = 10;

  let bestGroups: number[][] | null = null;
  let bestRemainder: number[] = [];
  // Selection optimizes the convex PENALTY cost plus the soft sub-spread
  // penalty; ties broken by the lowest worst-player load (the lever that
  // protects the worst-off regular).
  let bestScore = Infinity;
  let bestLoad = Infinity;

  for (let attempt = 0; attempt < restarts; attempt++) {
    // Initialize groups with the pinned clusters (membership/range/capacity
    // already enforced above).
    const currentGroups: number[][] = Array.from({ length: numGroups }, () => []);
    for (const { members, group } of pinnedClusters) {
      for (const m of members) currentGroups[group]!.push(m);
    }

    // Shuffle unpinned clusters (Fisher-Yates). Clamp the index to [0, i] so an
    // out-of-contract rng (returning <0, >=1, or NaN) can never index out of
    // bounds — NaN floors to NaN, so fall back to 0 before clamping.
    const shuffled = [...unpinnedClusters];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const raw = Math.floor(rng() * (i + 1));
      const j = Number.isFinite(raw) ? Math.min(i, Math.max(0, raw)) : 0;
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }

    // First-Fit-Decreasing ordering: place larger (linked) clusters before
    // singletons so a multi-seat cluster claims contiguous seats before the
    // singletons fragment the groups. Done as explicit size-bucketing (NOT
    // Array.sort) so it can never depend on sort stability — clusters keep their
    // post-shuffle order within each size bucket. For the all-singletons (no
    // link) case there is exactly ONE bucket, so this is an identity: the
    // RNG-driven order is untouched and the AC6 byte-identical guarantee holds.
    let maxSize = 1;
    for (const c of shuffled) if (c.length > maxSize) maxSize = c.length;
    const ordered: number[][] = [];
    for (let s = maxSize; s >= 1; s--) {
      for (const c of shuffled) if (c.length === s) ordered.push(c);
    }

    // Greedily assign each cluster to the group with lowest incremental cost that
    // has room for ALL of its members, with a SPLIT-ON-FAILURE fallback: a
    // cluster that cannot fit as a unit — because it is oversized (more members
    // than a whole group) or because leftover capacity is fragmented across
    // groups — is broken into singletons that are re-queued. Its members then
    // fill whatever single seats remain instead of being stranded in the
    // remainder; the keep-together link is given up only as far as capacity
    // actually forces. A singleton that still finds no seat (every group full ⇒ a
    // genuine remainder, e.g. player count not a multiple of groupSize) overflows.
    const queue: number[][] = [...ordered];
    const overflow: number[] = [];
    for (let qi = 0; qi < queue.length; qi++) {
      const members = queue[qi]!;
      const size = members.length;
      let bestGroup = -1;
      let bestIncrCost = Infinity;

      for (let g = 0; g < numGroups; g++) {
        if (currentGroups[g]!.length + size > groupSize) continue;

        // Repeat cost = sum of CONVEX pair penalties between every cluster member
        // and every existing member. pairPenalty(0)=0 ⇒ an all-fresh group still
        // costs 0 (identical to the old raw greedy in low-history weeks); it only
        // diverges once a candidate group already holds a prior partner. Pairs
        // WITHIN the cluster are forced (the link) and intentionally excluded —
        // their cost is the same in every candidate group, so it cannot change
        // the argmin; it is added back once via groupPenaltyCost in the score.
        let incrCost = 0;
        for (const member of members) {
          for (const existing of currentGroups[g]!) {
            incrCost += pairPenalty(matrix.get(pairKey(member, existing)) ?? 0);
          }
        }

        // Soft sub-spread: discourage putting another sub where a sub already
        // sits (or bringing >1 sub in via one cluster). Each colliding sub adds
        // SUB_SPREAD_PENALTY — large enough to win over repeat history, finite so
        // capacity/pins/links still dominate.
        if (subIds.size > 0) {
          let existingSubs = 0;
          for (const existing of currentGroups[g]!) if (subIds.has(existing)) existingSubs++;
          let clusterSubs = 0;
          for (const member of members) if (subIds.has(member)) clusterSubs++;
          const collisions =
            existingSubs > 0 ? clusterSubs : Math.max(0, clusterSubs - 1);
          incrCost += SUB_SPREAD_PENALTY * collisions;
        }

        if (incrCost < bestIncrCost) {
          bestIncrCost = incrCost;
          bestGroup = g;
        }
      }

      if (bestGroup >= 0) {
        for (const m of members) currentGroups[bestGroup]!.push(m);
      } else if (size > 1) {
        // Couldn't fit as a unit — degrade the link: re-queue as singletons so
        // they consume fragmented single seats instead of stranding everyone.
        for (const m of members) queue.push([m]);
      } else {
        overflow.push(members[0]!);
      }
    }

    const penaltyCost = currentGroups.reduce((sum, g) => sum + groupPenaltyCost(matrix, g), 0);
    const score = penaltyCost + SUB_SPREAD_PENALTY * subCollisionCount(subIds, currentGroups);
    const thisLoad = maxPlayerRepeatLoad(matrix, currentGroups);
    // Lower combined score wins; on a tie, prefer the flatter-per-player option.
    if (score < bestScore || (score === bestScore && thisLoad < bestLoad)) {
      bestScore = score;
      bestLoad = thisLoad;
      bestGroups = currentGroups;
      bestRemainder = overflow;
    }
  }

  // Defensive: bestGroups is set on the first restart in practice (score is
  // always a finite, non-negative integer < Infinity), but guard the invariant
  // rather than asserting non-null — a NaN score would otherwise crash here.
  // Fall back to leaving everyone unassigned.
  if (!bestGroups) {
    return { groups: [], remainder: [...uniquePlayerIds], totalCost: 0 };
  }

  // Return the RAW repeat-weight for display — the admin/attendance UIs and
  // their heatColor thresholds are tuned to raw magnitudes. Optimization above
  // happens on the convex penalty; totalCost is recomputed raw on the winner.
  const totalCost = bestGroups.reduce((sum, g) => sum + groupCost(matrix, g), 0);

  return {
    groups: bestGroups,
    remainder: bestRemainder,
    totalCost,
  };
}
