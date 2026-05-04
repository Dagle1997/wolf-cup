/**
 * T6-3 — Cross-foursome individual bets pure engine.
 *
 * Per-pair match-play money across any two Event participants regardless
 * of shared foursome. Two bet types:
 *   - 'match_play_per_hole': base match only, no presses.
 *   - 'match_play_with_auto_press': base match + N-down auto-press triggers
 *     (single-direction per round; nested-match fixed-point per T6-2 pattern).
 *
 * Per-round structure: each applicableRound is evaluated independently —
 * presses don't carry across rounds (epic AC line 1816). Within a round:
 *   1. Walk holes in course order, computing per-player NET = gross - strokes.
 *   2. Compare nets → winner ('playerA' | 'playerB' | 'halved').
 *   3. Base delta = stakePerHoleCents (signed by winner).
 *   4. For match_play_with_auto_press: walk fixed-point of presses against
 *      the round's signed delta to find which presses fire AND apply each
 *      press's contribution to its hole-segment.
 *
 * **Press logic is DUPLICATED, not generalized, from T6-2** (Section 3 v1
 * acceptance). Different contracts: 1v1 vs 2v2 nested-match. Followup
 * T6-3a tracks consolidation when a third surface emerges.
 *
 * **Multiplier preservation:** carried-forward `pressesByRound` rows
 * preserve their fire-time `multiplier` verbatim — a later T5-11
 * mid-event-edit changing config.pressMultiplier does NOT retroactively
 * change historical money math. New fires use the current config.
 *
 * No DB, no I/O, no env, no clock, no crypto, no input mutation.
 */

import {
  getHandicapStrokes,
  type TeeShape,
} from '../handicap-strokes.js';

export type { TeeShape };

export type IndividualBetType = 'match_play_per_hole' | 'match_play_with_auto_press';

export type IndividualBetConfig =
  | Record<string, never>  // empty for match_play_per_hole
  | { autoPressTriggerAtNDown: number; pressMultiplier: number };

export type HoleShape = {
  holeNumber: number;
  par: 3 | 4 | 5;
  strokeIndex: number;
};

export type HoleScoreShape = {
  grossStrokes: number;
  putts: number | null;
};

/**
 * Press fire-row shape (engine domain). Field names align with the DB
 * column convention so the route layer (T6-4) maps trivially:
 *   - firedAtRoundId ↔ fired_at_round_id (event_rounds.id)
 *   - firedAtHole ↔ fired_at_hole
 *   - triggerType ↔ trigger_type
 *   - multiplier ↔ multiplier (positive integer; persisted at fire-time)
 *   - id ↔ id (route layer mints UUID for newly-fired rows)
 *
 * The DB columns NOT carried in this engine type — bet_id, fired_at,
 * tenant_id, context_id — are stamped by the route layer at persist
 * time. The `trigger` field is engine-only descriptive label.
 */
export type PressFireRow = {
  id?: string;
  firedAtRoundId: string;        // event_rounds.id
  firedAtHole: number;
  multiplier: number;
  triggerType: 'auto' | 'manual';
  trigger?: string;
};

export type ComputeIndividualBetInput = {
  bet: {
    id: string;
    playerAId: string;
    playerBId: string;
    betType: IndividualBetType;
    stakePerHoleCents: number;
    config: IndividualBetConfig;
  };
  applicableRounds: Array<{
    roundId: string;
    eventRoundId: string;
    course: { tee: TeeShape; holes: HoleShape[] };
  }>;
  /** Key: `${roundId}|${playerId}|${holeNumber}` */
  holeScoresByCell: Map<string, HoleScoreShape>;
  /** Already-fired press rows from individual_bet_presses, keyed by eventRoundId. */
  pressesByRound: Record<string, PressFireRow[]>;
  handicapIndexByPlayer: Record<string, number>;
};

export type BetHoleResult = {
  holeNumber: number;
  par: 3 | 4 | 5;
  netA: number;
  netB: number;
  winner: 'playerA' | 'playerB' | 'halved';
  baseDeltaCents: number;
  pressDeltaCents: number;
};

export type BetRoundResult = {
  roundId: string;
  eventRoundId: string;
  perHole: BetHoleResult[];
  netToPlayerACents: number;
  triggeredPresses: PressFireRow[];
};

export type ComputeIndividualBetOutput = {
  perRound: BetRoundResult[];
  netToPlayerACents: number;
  triggeredPresses: PressFireRow[];
};

// ---------------------------------------------------------------------------
// Validation helpers (AC-5 boundary)
// ---------------------------------------------------------------------------

const BET_TYPES: ReadonlySet<IndividualBetType> = new Set([
  'match_play_per_hole',
  'match_play_with_auto_press',
]);

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer (got ${value})`);
  }
}

function assertIntegerInRange(name: string, value: number, lo: number, hi: number): void {
  if (!Number.isInteger(value) || value < lo || value > hi) {
    throw new RangeError(`${name} must be integer in [${lo}, ${hi}] (got ${value})`);
  }
}

function getRequiredHandicapIndex(
  map: Record<string, number>,
  playerId: string,
): number {
  const hi = map[playerId];
  if (hi === undefined) {
    throw new Error(
      `computeIndividualBet: missing handicapIndex for player ${playerId}`,
    );
  }
  return hi;
}

// ---------------------------------------------------------------------------
// computeIndividualBet — main entry
// ---------------------------------------------------------------------------

export function computeIndividualBet(
  input: ComputeIndividualBetInput,
): ComputeIndividualBetOutput {
  const { bet, applicableRounds, holeScoresByCell, pressesByRound, handicapIndexByPlayer } = input;

  // ── (1) Boundary validation ──────────────────────────────────────────
  if (!BET_TYPES.has(bet.betType)) {
    throw new RangeError(`bet.betType must be in enum (got ${String(bet.betType)})`);
  }
  assertPositiveInteger('bet.stakePerHoleCents', bet.stakePerHoleCents);

  const isAutoPress = bet.betType === 'match_play_with_auto_press';
  if (isAutoPress) {
    const cfg = bet.config as { autoPressTriggerAtNDown?: unknown; pressMultiplier?: unknown };
    if (typeof cfg.autoPressTriggerAtNDown !== 'number') {
      throw new RangeError('config.autoPressTriggerAtNDown required for match_play_with_auto_press');
    }
    assertIntegerInRange('config.autoPressTriggerAtNDown', cfg.autoPressTriggerAtNDown, 1, 18);
    if (typeof cfg.pressMultiplier !== 'number') {
      throw new RangeError('config.pressMultiplier required for match_play_with_auto_press');
    }
    assertPositiveInteger('config.pressMultiplier', cfg.pressMultiplier);
  }

  // applicableRounds dedupe.
  const seenEventRoundIds = new Set<string>();
  const seenRoundIds = new Set<string>();
  for (const r of applicableRounds) {
    if (seenEventRoundIds.has(r.eventRoundId)) {
      throw new Error(`computeIndividualBet: duplicate applicableRounds eventRoundId ${r.eventRoundId}`);
    }
    if (seenRoundIds.has(r.roundId)) {
      throw new Error(`computeIndividualBet: duplicate applicableRounds roundId ${r.roundId}`);
    }
    seenEventRoundIds.add(r.eventRoundId);
    seenRoundIds.add(r.roundId);
  }

  // pressesByRound key consistency invariant.
  for (const [k, rows] of Object.entries(pressesByRound)) {
    for (const p of rows) {
      assertPositiveInteger(`pressesByRound[${k}][i].multiplier`, p.multiplier);
      if (p.firedAtRoundId !== k) {
        throw new Error(
          `computeIndividualBet: press_fire_row_round_mismatch — pressesByRound[${k}] contains row with firedAtRoundId=${p.firedAtRoundId}`,
        );
      }
    }
  }

  // ── (2) Per-round evaluation ─────────────────────────────────────────
  const perRound: BetRoundResult[] = [];
  let netToPlayerACents = 0;
  const allTriggeredPresses: PressFireRow[] = [];

  for (const round of applicableRounds) {
    const roundResult = evaluateRound(
      bet,
      round,
      holeScoresByCell,
      pressesByRound[round.eventRoundId] ?? [],
      handicapIndexByPlayer,
      isAutoPress,
    );
    perRound.push(roundResult);
    netToPlayerACents += roundResult.netToPlayerACents;
    allTriggeredPresses.push(...roundResult.triggeredPresses);
  }

  return { perRound, netToPlayerACents, triggeredPresses: allTriggeredPresses };
}

// ---------------------------------------------------------------------------
// Per-round evaluator
// ---------------------------------------------------------------------------

function evaluateRound(
  bet: ComputeIndividualBetInput['bet'],
  round: ComputeIndividualBetInput['applicableRounds'][number],
  holeScoresByCell: Map<string, HoleScoreShape>,
  existingPresses: PressFireRow[],
  handicapIndexByPlayer: Record<string, number>,
  isAutoPress: boolean,
): BetRoundResult {
  const hiA = getRequiredHandicapIndex(handicapIndexByPlayer, bet.playerAId);
  const hiB = getRequiredHandicapIndex(handicapIndexByPlayer, bet.playerBId);

  // Build per-hole winner array (only for holes where BOTH players have scores).
  // hole.holeNumber → { winner, netA, netB, par } (or undefined if either player missing).
  const perHoleData = new Map<
    number,
    { par: 3 | 4 | 5; netA: number; netB: number; winner: 'playerA' | 'playerB' | 'halved' }
  >();

  for (const hole of round.course.holes) {
    const cellA = holeScoresByCell.get(`${round.roundId}|${bet.playerAId}|${hole.holeNumber}`);
    const cellB = holeScoresByCell.get(`${round.roundId}|${bet.playerBId}|${hole.holeNumber}`);
    if (!cellA || !cellB) continue;
    const strokesA = getHandicapStrokes(hiA, hole.strokeIndex, round.course.tee);
    const strokesB = getHandicapStrokes(hiB, hole.strokeIndex, round.course.tee);
    const netA = cellA.grossStrokes - strokesA;
    const netB = cellB.grossStrokes - strokesB;
    const winner: 'playerA' | 'playerB' | 'halved' =
      netA < netB ? 'playerA' : netB < netA ? 'playerB' : 'halved';
    perHoleData.set(hole.holeNumber, { par: hole.par, netA, netB, winner });
  }

  // Identify the auto-press fires for this round if applicable. T6-3 pattern
  // mirrors T6-2 fixed-point: starting from existingPresses, find new
  // compounds within each press's nested segment.
  let allPresses: PressFireRow[];
  let triggeredPresses: PressFireRow[];

  if (isAutoPress) {
    const cfg = bet.config as { autoPressTriggerAtNDown: number; pressMultiplier: number };
    // Max hole on this round's course — used to suppress press fires
    // beyond the round's actual hole count (e.g., 9-hole rounds).
    const maxHole = round.course.holes.reduce(
      (acc, h) => (h.holeNumber > acc ? h.holeNumber : acc),
      0,
    );
    const fixedPoint = computeAutoPressFixedPoint(
      perHoleData,
      round.course.holes,
      round.eventRoundId,
      existingPresses,
      cfg.autoPressTriggerAtNDown,
      cfg.pressMultiplier,
      maxHole,
    );
    allPresses = fixedPoint.allPresses;
    triggeredPresses = fixedPoint.triggeredPresses;
  } else {
    allPresses = [];
    triggeredPresses = [];
  }

  // Build perHole results with base + press deltas.
  const perHole: BetHoleResult[] = [];
  let netToPlayerACents = 0;

  for (const hole of round.course.holes) {
    const data = perHoleData.get(hole.holeNumber);
    if (!data) continue;

    const baseDeltaCents =
      data.winner === 'playerA' ? bet.stakePerHoleCents
      : data.winner === 'playerB' ? -bet.stakePerHoleCents
      : 0;

    // Press contribution: for each active press whose firedAtHole <= hole.holeNumber,
    // compute that press's segment match-state result for this hole and apply
    // stakePerHoleCents × multiplier.
    let pressDeltaCents = 0;
    for (const press of allPresses) {
      if (press.firedAtHole > hole.holeNumber) continue;
      // Press is active on this hole. Press applies the same per-hole winner
      // semantics, scaled by multiplier.
      if (data.winner === 'playerA') {
        pressDeltaCents += bet.stakePerHoleCents * press.multiplier;
      } else if (data.winner === 'playerB') {
        pressDeltaCents -= bet.stakePerHoleCents * press.multiplier;
      }
      // halved: 0
    }

    perHole.push({
      holeNumber: hole.holeNumber,
      par: data.par,
      netA: data.netA,
      netB: data.netB,
      winner: data.winner,
      baseDeltaCents,
      pressDeltaCents,
    });

    netToPlayerACents += baseDeltaCents + pressDeltaCents;
  }

  return {
    roundId: round.roundId,
    eventRoundId: round.eventRoundId,
    perHole,
    netToPlayerACents,
    triggeredPresses,
  };
}

// ---------------------------------------------------------------------------
// Auto-press fixed-point evaluator (per round, single-direction triggers
// — but BOTH players can trigger in the same segment if delta swings)
// ---------------------------------------------------------------------------

interface FixedPointResult {
  allPresses: PressFireRow[];
  triggeredPresses: PressFireRow[];
}

function computeAutoPressFixedPoint(
  perHoleData: Map<
    number,
    { par: 3 | 4 | 5; netA: number; netB: number; winner: 'playerA' | 'playerB' | 'halved' }
  >,
  holes: HoleShape[],
  eventRoundId: string,
  existingPresses: PressFireRow[],
  triggerN: number,
  pressMultiplier: number,
  maxHole: number,
): FixedPointResult {
  // Build an ordered hole-number array (only scored holes appear in perHoleData).
  const scoredHoleNumbers = holes
    .map((h) => h.holeNumber)
    .filter((n) => perHoleData.has(n))
    .sort((a, b) => a - b);

  // Dedupe seed from existingPresses.
  const originalKeys = new Set<string>();
  const dedupeKeys = new Set<string>();
  const allPresses: PressFireRow[] = [];

  for (const e of existingPresses) {
    const key = `${e.firedAtHole}|${e.triggerType}`;
    originalKeys.add(key);
    dedupeKeys.add(key);
    allPresses.push({ ...e });
  }

  // Fixed-point loop.
  const ITERATION_CAP = 50;
  let iteration = 0;
  let added = true;
  let cursor = 0;

  // Seed: include the base match (segment from hole 1).
  // We model this as a virtual "press" at firedAtHole=1 (for iteration purposes),
  // but it does NOT appear in allPresses output. It's just the segment seed.
  // The base segment is processed implicitly by setting the initial cursor to
  // a synthetic startHole=1.
  const segments: number[] = [1];  // segment-startHole values
  for (const e of allPresses) segments.push(e.firedAtHole);

  while (added) {
    if (++iteration > ITERATION_CAP) {
      throw new RangeError(
        `computeIndividualBet: fixed-point did not converge within ${ITERATION_CAP} iterations`,
      );
    }
    added = false;
    const snapshotEnd = segments.length;
    for (let i = cursor; i < snapshotEnd; i++) {
      const segmentStart = segments[i]!;
      const fires = findAutoFiresInSegment(perHoleData, scoredHoleNumbers, segmentStart, triggerN, maxHole);
      for (const f of fires) {
        const key = `${f.firedAtHole}|auto`;
        if (!dedupeKeys.has(key)) {
          const press: PressFireRow = {
            firedAtRoundId: eventRoundId,
            firedAtHole: f.firedAtHole,
            multiplier: pressMultiplier,
            triggerType: 'auto',
            trigger: f.trigger,
          };
          allPresses.push(press);
          dedupeKeys.add(key);
          segments.push(f.firedAtHole);
          added = true;
        }
      }
    }
    cursor = snapshotEnd;
  }

  // Sort by firedAtHole asc (deterministic).
  allPresses.sort((a, b) => a.firedAtHole - b.firedAtHole);

  const triggeredPresses = allPresses.filter(
    (p) => !originalKeys.has(`${p.firedAtHole}|${p.triggerType}`),
  );

  return { allPresses, triggeredPresses };
}

interface CandidateAutoFire {
  firedAtHole: number;
  trigger: string;
}

/**
 * Within a segment starting at segmentStart, walk scored holes and detect
 * the first hole where signed delta (from playerA's perspective) reaches
 * ±triggerN. Returns up to 2 fires (one per direction if delta swings).
 *
 * firedAtHole = trigger hole + 1; if > 18 → suppressed (no remaining holes).
 */
function findAutoFiresInSegment(
  perHoleData: Map<
    number,
    { par: 3 | 4 | 5; netA: number; netB: number; winner: 'playerA' | 'playerB' | 'halved' }
  >,
  scoredHoleNumbers: number[],
  segmentStart: number,
  triggerN: number,
  maxHole: number,
): CandidateAutoFire[] {
  let signedDelta = 0;
  let firedA = false;
  let firedB = false;
  const fires: CandidateAutoFire[] = [];

  for (const n of scoredHoleNumbers) {
    if (n < segmentStart) continue;
    const data = perHoleData.get(n);
    if (!data) continue;
    if (data.winner === 'playerA') signedDelta += 1;
    else if (data.winner === 'playerB') signedDelta -= 1;

    if (!firedA && signedDelta === -triggerN) {
      const firedAtHole = n + 1;
      // Suppress fire if startHole would be beyond the round's last hole
      // (codex impl H#1 — supports 9-hole rounds + future shortened formats).
      if (firedAtHole <= maxHole) {
        fires.push({ firedAtHole, trigger: `${triggerN}-down` });
      }
      firedA = true;
    }
    if (!firedB && signedDelta === triggerN) {
      const firedAtHole = n + 1;
      if (firedAtHole <= maxHole) {
        fires.push({ firedAtHole, trigger: `${triggerN}-down` });
      }
      firedB = true;
    }
  }

  return fires;
}
