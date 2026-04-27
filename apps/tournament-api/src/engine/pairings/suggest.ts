/**
 * T4-1 pairings suggest engine.
 *
 * Pure function: no DB, no I/O, no env, no Math.random, no Date.now. Same
 * input → byte-for-byte identical output. The directory boundary
 * (`engine/pairings/`) signals the no-I/O invariant.
 *
 * Two-tier algorithm:
 *   1. Canonical fixture path for the load-bearing 8×4×4 Pinehurst case
 *      (8 players, 4 rounds, foursomes-of-4, no pins, everyone-once
 *      constraint). Returns a hardcoded known-good schedule that satisfies
 *      everyone-once.
 *   2. Greedy fallback for everything else. Places pins, then fills
 *      remaining slots minimizing the maximum pair-meeting count. NOT
 *      guaranteed to satisfy everyone-once for arbitrary input shapes;
 *      surfaces `pair-not-met` warnings when constraints can't be fully
 *      satisfied (target-miss tolerable per epic).
 *
 * T4-2 will call this from a route handler. T4-1 itself is just the
 * engine + tests.
 */

export interface SuggestPairingsInput {
  /** Player IDs. Order matters — used as the deterministic tie-breaker. */
  roster: string[];
  /** ≥ 1. */
  numRounds: number;
  /** Typically 4 (Pinehurst). Supports any positive integer. */
  foursomeSize: number;
  /**
   * `'everyone-once'` — every pair of players meets in at least one
   * foursome across all rounds. After greedy fill, scan for unmet pairs;
   * each emits a `pair-not-met` warning.
   *
   * `'custom'` — no pair-coverage enforcement. Greedy fill happens; no
   * `pair-not-met` warnings emitted.
   */
  constraint: 'everyone-once' | 'custom';
  /**
   * Optional pins. Each `{ round, foursome, playerId }` triple forces a
   * player into a specific slot. `round` and `foursome` are 1-indexed
   * (human-readable).
   */
  pins?: Array<{ round: number; foursome: number; playerId: string }>;
}

export interface PairingsGrid {
  rounds: Array<{
    round: number;
    foursomes: Array<{
      foursome: number;
      playerIds: string[];
    }>;
  }>;
}

export interface SuggestPairingsResult {
  grid: PairingsGrid;
  warnings: string[];
}

/**
 * Canonical 8×4×4 schedule satisfying everyone-once. Verified at impl
 * time via the Test A pair-coverage assertion.
 *
 * Pair coverage: every C(8,2)=28 pair meets in at least one foursome.
 * Hand-verified pair-coverage matrix in the spec docs; Test A re-verifies
 * at runtime against this exact constant.
 *
 *   round 1: [r0,r1,r2,r3] [r4,r5,r6,r7]
 *   round 2: [r0,r1,r4,r5] [r2,r3,r6,r7]
 *   round 3: [r0,r2,r4,r6] [r1,r3,r5,r7]
 *   round 4: [r0,r3,r4,r7] [r1,r2,r5,r6]
 */
const CANONICAL_8X4X4: number[][][] = [
  [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
  ],
  [
    [0, 1, 4, 5],
    [2, 3, 6, 7],
  ],
  [
    [0, 2, 4, 6],
    [1, 3, 5, 7],
  ],
  [
    [0, 3, 4, 7],
    [1, 2, 5, 6],
  ],
];

export function suggestPairings(input: SuggestPairingsInput): SuggestPairingsResult {
  const { roster, numRounds, foursomeSize, constraint } = input;
  const pins = input.pins ?? [];
  const warnings: string[] = [];

  // ---- Top-level input validation. AC #5 NEVER-throw guarantee. --------
  // Bad numRounds / foursomeSize values would crash the algorithm
  // downstream (negative array sizes, NaN modular arithmetic). Early-out
  // with empty grid + warning instead.
  if (
    !Number.isInteger(numRounds) ||
    numRounds < 1 ||
    !Number.isInteger(foursomeSize) ||
    foursomeSize < 1
  ) {
    warnings.push(
      `invalid sizing: numRounds=${numRounds}, foursomeSize=${foursomeSize} — both must be positive integers`,
    );
    return { grid: { rounds: [] }, warnings };
  }

  // ---- Roster duplicates: drop them silently — placement uses Set
  // semantics, so duplicates would underfill foursomes (round-2 codex
  // catch). Emit a warning so the caller can see the unique count.
  // Stable order preserved: first occurrence kept.
  const seen = new Set<string>();
  const dedupedRoster: string[] = [];
  for (const p of roster) {
    if (!seen.has(p)) {
      seen.add(p);
      dedupedRoster.push(p);
    }
  }
  if (dedupedRoster.length < roster.length) {
    warnings.push(
      `roster contains duplicates — ${roster.length - dedupedRoster.length} duplicate(s) dropped, deduped roster size ${dedupedRoster.length}`,
    );
  }
  // Use deduped roster for the rest of the algorithm. This keeps the
  // public contract clean: callers can pass in roster with duplicates
  // (e.g., from a UI bug); engine produces a valid grid + warning.
  const effectiveRoster = dedupedRoster;

  // ---- Insufficient roster: empty grid + warning. -----------------------
  if (effectiveRoster.length < foursomeSize) {
    warnings.push(
      `insufficient roster: need at least ${foursomeSize}, got ${effectiveRoster.length}`,
    );
    return { grid: { rounds: [] }, warnings };
  }

  const foursomesPerRound = Math.floor(effectiveRoster.length / foursomeSize);
  const playableSlots = foursomesPerRound * foursomeSize;
  const sitOutCount = effectiveRoster.length - playableSlots;

  // ---- Canonical fixture path (load-bearing 8×4×4 Pinehurst case). ------
  if (
    effectiveRoster.length === 8 &&
    numRounds === 4 &&
    foursomeSize === 4 &&
    constraint === 'everyone-once' &&
    pins.length === 0
  ) {
    const grid: PairingsGrid = {
      rounds: CANONICAL_8X4X4.map((roundFoursomes, rIdx) => ({
        round: rIdx + 1,
        foursomes: roundFoursomes.map((indices, fIdx) => ({
          foursome: fIdx + 1,
          playerIds: indices.map((i) => effectiveRoster[i]!),
        })),
      })),
    };
    return { grid, warnings };
  }

  // ---- Greedy fallback path. --------------------------------------------

  // Validate pins. Build a per-round, per-foursome map honoring the order
  // rules per Risk §5.
  const rosterSet = new Set(effectiveRoster);
  // pinnedSlots[r][f] = ordered list of playerIds pinned to (r+1, f+1).
  const pinnedSlots: string[][][] = Array.from({ length: numRounds }, () =>
    Array.from({ length: foursomesPerRound }, () => []),
  );
  // Track which (round, playerId) pairs are already pinned to detect the
  // "same playerId in two foursomes of one round" violation.
  const pinnedRoundPlayer = new Map<number, Map<string, number>>(); // round → (playerId → foursome)

  for (const pin of pins) {
    if (!rosterSet.has(pin.playerId)) {
      warnings.push(`pin references unknown playerId ${pin.playerId}`);
      continue;
    }
    // Integer-and-range guard. NaN, floats, negatives all fall into
    // out-of-range. AC #5 NEVER-throw: drop + warn rather than crash on
    // pinnedSlots[NaN] or array-bounds violation.
    if (
      !Number.isInteger(pin.round) ||
      !Number.isInteger(pin.foursome) ||
      pin.round < 1 ||
      pin.round > numRounds ||
      pin.foursome < 1 ||
      pin.foursome > foursomesPerRound
    ) {
      warnings.push(`pin out of range: round ${pin.round}, foursome ${pin.foursome}`);
      continue;
    }
    const rIdx = pin.round - 1;
    const fIdx = pin.foursome - 1;
    let perRound = pinnedRoundPlayer.get(pin.round);
    if (!perRound) {
      perRound = new Map();
      pinnedRoundPlayer.set(pin.round, perRound);
    }
    const existingFoursome = perRound.get(pin.playerId);
    if (existingFoursome !== undefined) {
      if (existingFoursome === pin.foursome) {
        // Idempotent same-triple — silent no-op.
        continue;
      }
      // Same playerId in TWO foursomes of one round: drop second + warn.
      warnings.push(`player ${pin.playerId} pinned to multiple foursomes in round ${pin.round}`);
      continue;
    }
    if (pinnedSlots[rIdx]![fIdx]!.length >= foursomeSize) {
      warnings.push(
        `foursome (round ${pin.round}, foursome ${pin.foursome}) overflowed — ${pinnedSlots[rIdx]![fIdx]!.length + 1} pinned, max is ${foursomeSize}`,
      );
      continue;
    }
    pinnedSlots[rIdx]![fIdx]!.push(pin.playerId);
    perRound.set(pin.playerId, pin.foursome);
  }

  // Build the grid with greedy fill + sit-out rotation.
  // Pair-meeting count map: key `playerA|playerB` (sorted) → count of
  // shared foursomes so far. Used by greedy heuristic + post-fill scan.
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const pairMeetings = new Map<string, number>();

  function recordFoursome(playerIds: string[]): void {
    for (let i = 0; i < playerIds.length; i++) {
      for (let j = i + 1; j < playerIds.length; j++) {
        const k = pairKey(playerIds[i]!, playerIds[j]!);
        pairMeetings.set(k, (pairMeetings.get(k) ?? 0) + 1);
      }
    }
  }

  // Track which players sat out in EACH round (for the no-permanent-
  // benching warning).
  const playedAtLeastOnce = new Set<string>();

  const grid: PairingsGrid = { rounds: [] };

  for (let rIdx = 0; rIdx < numRounds; rIdx++) {
    const roundPinned = pinnedRoundPlayer.get(rIdx + 1) ?? new Map<string, number>();

    // Generate sit-out set for this round, respecting pins.
    const sitOutSet = new Set<string>();
    if (sitOutCount > 0) {
      let j = 0;
      let attempts = 0;
      const maxAttempts = effectiveRoster.length * 2; // safety bound
      while (sitOutSet.size < sitOutCount && attempts < maxAttempts) {
        const candidate =
          effectiveRoster[(rIdx * sitOutCount + j) % effectiveRoster.length]!;
        if (!roundPinned.has(candidate) && !sitOutSet.has(candidate)) {
          sitOutSet.add(candidate);
        }
        j++;
        attempts++;
      }
    }

    // Playable players for this round = roster - sitOutSet.
    const playableThisRound = effectiveRoster.filter((p) => !sitOutSet.has(p));
    for (const p of playableThisRound) playedAtLeastOnce.add(p);

    // Build foursomes for this round.
    const placedThisRound = new Set<string>();
    const foursomesOut: Array<{ foursome: number; playerIds: string[] }> = [];

    for (let fIdx = 0; fIdx < foursomesPerRound; fIdx++) {
      const playerIds: string[] = [];
      // Pinned players first.
      for (const pid of pinnedSlots[rIdx]![fIdx]!) {
        if (!placedThisRound.has(pid)) {
          playerIds.push(pid);
          placedThisRound.add(pid);
        }
      }
      // Greedy fill remaining slots.
      while (playerIds.length < foursomeSize) {
        const candidatePool = playableThisRound.filter((p) => !placedThisRound.has(p));
        if (candidatePool.length === 0) break; // out of players (shouldn't happen if sizing is correct)

        // Score each candidate: minimize the max pair-meetings with the
        // current foursome's existing players. Tie-break by roster order
        // (which is the candidatePool's iteration order since filter
        // preserves order).
        let bestPick: string | null = null;
        let bestMaxMeetings = Number.POSITIVE_INFINITY;
        for (const candidate of candidatePool) {
          let candidateMaxMeetings = 0;
          for (const placed of playerIds) {
            const m = pairMeetings.get(pairKey(candidate, placed)) ?? 0;
            if (m > candidateMaxMeetings) candidateMaxMeetings = m;
          }
          if (candidateMaxMeetings < bestMaxMeetings) {
            bestMaxMeetings = candidateMaxMeetings;
            bestPick = candidate;
          }
        }
        if (bestPick === null) break;
        playerIds.push(bestPick);
        placedThisRound.add(bestPick);
      }

      recordFoursome(playerIds);
      foursomesOut.push({ foursome: fIdx + 1, playerIds });
    }

    grid.rounds.push({ round: rIdx + 1, foursomes: foursomesOut });
  }

  // ---- Post-fill: never-plays warnings. ---------------------------------
  // Only fires when pins are empty AND a player was never on the
  // playable side of any round.
  if (pins.length === 0) {
    for (const p of effectiveRoster) {
      if (!playedAtLeastOnce.has(p)) {
        warnings.push(
          `player ${p} never plays: roster size + foursome size produces a permanent sit-out`,
        );
      }
    }
  }

  // ---- Post-fill: pair-coverage scan (everyone-once only). --------------
  if (constraint === 'everyone-once') {
    // Collect unmet pairs, then sort lexicographically for deterministic
    // warning order.
    const unmet: Array<[string, string]> = [];
    for (let i = 0; i < effectiveRoster.length; i++) {
      for (let j = i + 1; j < effectiveRoster.length; j++) {
        const a = effectiveRoster[i]!;
        const b = effectiveRoster[j]!;
        if ((pairMeetings.get(pairKey(a, b)) ?? 0) === 0) {
          unmet.push([a, b]);
        }
      }
    }
    unmet.sort((x, y) => {
      if (x[0] < y[0]) return -1;
      if (x[0] > y[0]) return 1;
      if (x[1] < y[1]) return -1;
      if (x[1] > y[1]) return 1;
      return 0;
    });
    for (const [a, b] of unmet) {
      warnings.push(`pair-not-met: ${a} and ${b}`);
    }
  }

  return { grid, warnings };
}
