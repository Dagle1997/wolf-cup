/**
 * T6-2 — Press + auto-press trigger evaluation.
 *
 * Pure function over a 2v2 match-state snapshot. Returns the set of all
 * active presses given `throughHole` plus the subset that newly fired in
 * this evaluation pass (i.e., not present in `existingPressLog`).
 *
 * **Auto-press semantic:** team X is "N-down" iff the running count of
 * X's hole wins minus the opposing team's wins through `throughHole`
 * equals `-N`. Auto-press fires for the down team at `startHole = h + 1`
 * where `h` is the first hole within a match-segment that reaches that
 * deficit. Trigger at hole 18 → no fire (no remaining holes; AC-11).
 *
 * **Compound auto-press (nested matches):** every press that exists —
 * carried forward from `existingPressLog`, manual-echoed from
 * `manualPresses`, or newly fired in the base match — establishes a
 * nested match starting at its `startHole`. Auto-press triggers fire
 * within nested matches just like the base match. The fixed-point loop
 * (step 7) walks all known presses repeatedly until no new compound
 * fires occur. Defensive 50-iteration cap.
 *
 * **Multiplier preservation (codex spec-rerun H#1):** carried-forward
 * `existingPressLog` entries preserve their fire-time `multiplier` and
 * `trigger` fields verbatim — a later T5-11 mid-event rule edit that
 * changes `config.pressMultiplier` does NOT retroactively rewrite the
 * historical money math. New fires use the current config.
 *
 * **Dedupe-key collision (Section 5 v1 acceptance):** the global key
 * `(type, team, startHole)` can theoretically collapse two presses that
 * fire from different parent matches at the same coordinate. v1 accepts
 * this limitation; followup T6-2g tracks the v1.5 fix via `parentMatchId`.
 *
 * No DB, no I/O, no env, no clock, no crypto, no input mutation.
 */

import type { HoleResult } from '../formats/best-ball-2v2.js';

export type PressTeam = 'teamA' | 'teamB';
export type PressType = 'auto' | 'manual';

export type PressConfig = {
  /** N for "fire when N-down". null OR 0 → auto-press disabled. */
  autoPressTriggerAtNDown: number | null;
  /** Multiplier applied to press contributions downstream. Positive integer (typically 2). */
  pressMultiplier: number;
};

export type ManualPress = {
  team: PressTeam;
  /** Hole the press takes effect on (1..18). filedAtHole === startHole for manual presses. */
  filedAtHole: number;
};

export type PressLogEntry = {
  type: PressType;
  team: PressTeam;
  startHole: number;
  /**
   * Multiplier IN EFFECT WHEN THIS PRESS WAS FIRED. Persisted on the press
   * log row at fire-time so a later T5-11 mid-event rule edit does not
   * retroactively change historical money math.
   */
  multiplier: number;
  /** Optional. For auto presses: e.g. '2-down'. Caller persists at fire-time. */
  trigger?: string;
};

export type Press = {
  type: PressType;
  team: PressTeam;
  startHole: number;
  /**
   * For newly-fired presses: copied from `config.pressMultiplier`.
   * For carried-forward presses: copied from `existingPressLog[i].multiplier`
   * (historical fire-time value, NOT current config).
   */
  multiplier: number;
  /** For auto presses: e.g., '2-down'. For manual: undefined. */
  trigger?: string;
  /** True iff this press is in its undo window (manual + throughHole <= startHole). */
  canUndo: boolean;
};

export type EvaluatePressesInput = {
  perHoleResults: HoleResult[];
  manualPresses: ManualPress[];
  existingPressLog: PressLogEntry[];
  config: PressConfig;
  /** 0..18; "the last hole for which all 4 foursome members have committed scores". */
  throughHole: number;
};

export type EvaluatePressesOutput = {
  /** All presses considered live given throughHole, sorted deterministically per AC-13. */
  activePresses: Press[];
  /** Subset of activePresses NOT present in existingPressLog (by (type, team, startHole)). Same sort order. */
  newlyFired: Press[];
};

// ---------------------------------------------------------------------------
// Validation helpers (AC-2 boundary)
// ---------------------------------------------------------------------------

const PRESS_TYPES: ReadonlySet<PressType> = new Set(['auto', 'manual']);
const PRESS_TEAMS: ReadonlySet<PressTeam> = new Set(['teamA', 'teamB']);
const HOLE_WINNERS: ReadonlySet<HoleResult['winner']> = new Set([
  'teamA',
  'teamB',
  'tie',
]);

function assertIntegerInRange(name: string, value: number, lo: number, hi: number): void {
  if (!Number.isInteger(value) || value < lo || value > hi) {
    throw new RangeError(`${name} must be integer in [${lo}, ${hi}] (got ${value})`);
  }
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer (got ${value})`);
  }
}

function assertNonNegativeIntegerOrNull(name: string, value: number | null): void {
  if (value === null) return;
  if (!Number.isInteger(value) || value < 0 || value > 18) {
    throw new RangeError(`${name} must be null or integer in [0, 18] (got ${value})`);
  }
}

// ---------------------------------------------------------------------------
// Comparator (AC-13 — explicit rank maps)
// ---------------------------------------------------------------------------

const TYPE_RANK: Record<PressType, number> = { auto: 0, manual: 1 };
const TEAM_RANK: Record<PressTeam, number> = { teamA: 0, teamB: 1 };

function pressOrder(a: Press, b: Press): number {
  if (a.startHole !== b.startHole) return a.startHole - b.startHole;
  if (a.type !== b.type) return TYPE_RANK[a.type] - TYPE_RANK[b.type];
  if (a.team !== b.team) return TEAM_RANK[a.team] - TEAM_RANK[b.team];
  return 0;
}

// ---------------------------------------------------------------------------
// Auto-fire detector — finds 0..2 presses (one per team if both reach N-down) within a segment
// ---------------------------------------------------------------------------

interface CandidateAutoFire {
  team: PressTeam;
  startHole: number;
  trigger: string;
}

function findAutoFires(
  perHoleByNumber: Map<number, HoleResult>,
  segmentStart: number,
  throughHole: number,
  triggerN: number,
): CandidateAutoFire[] {
  if (segmentStart > throughHole) return [];
  let signedDelta = 0; // positive = team A leads
  let firedA = false;
  let firedB = false;
  const fires: CandidateAutoFire[] = [];

  for (let h = segmentStart; h <= throughHole; h++) {
    const hr = perHoleByNumber.get(h);
    if (!hr) continue; // shouldn't happen — completeness gate validated upstream
    if (hr.winner === 'teamA') signedDelta += 1;
    else if (hr.winner === 'teamB') signedDelta -= 1;
    // 'tie' is a no-op

    if (!firedA && signedDelta === -triggerN) {
      const startHole = h + 1;
      if (startHole <= 18) {
        fires.push({ team: 'teamA', startHole, trigger: `${triggerN}-down` });
      }
      firedA = true;
    }
    if (!firedB && signedDelta === triggerN) {
      const startHole = h + 1;
      if (startHole <= 18) {
        fires.push({ team: 'teamB', startHole, trigger: `${triggerN}-down` });
      }
      firedB = true;
    }
  }

  return fires;
}

// ---------------------------------------------------------------------------
// evaluatePresses — main entry
// ---------------------------------------------------------------------------

export function evaluatePresses(
  input: EvaluatePressesInput,
): EvaluatePressesOutput {
  const { perHoleResults, manualPresses, existingPressLog, config, throughHole } = input;

  // ── (1) Boundary validation (AC-2) ───────────────────────────────────────
  assertIntegerInRange('throughHole', throughHole, 0, 18);
  assertPositiveInteger('config.pressMultiplier', config.pressMultiplier);
  assertNonNegativeIntegerOrNull('config.autoPressTriggerAtNDown', config.autoPressTriggerAtNDown);

  // perHoleResults shape + completeness.
  const perHoleByNumber = new Map<number, HoleResult>();
  for (const hr of perHoleResults) {
    if (typeof hr.holeNumber !== 'number' || !Number.isInteger(hr.holeNumber) || hr.holeNumber < 1 || hr.holeNumber > 18) {
      throw new RangeError(`perHoleResults[].holeNumber must be integer in [1, 18] (got ${hr.holeNumber})`);
    }
    if (!HOLE_WINNERS.has(hr.winner)) {
      throw new RangeError(`perHoleResults[].winner must be 'teamA' | 'teamB' | 'tie' (got ${String(hr.winner)})`);
    }
    if (perHoleByNumber.has(hr.holeNumber)) {
      throw new Error(`evaluatePresses: duplicate perHoleResults entry for hole ${hr.holeNumber}`);
    }
    perHoleByNumber.set(hr.holeNumber, hr);
  }
  for (let h = 1; h <= throughHole; h++) {
    if (!perHoleByNumber.has(h)) {
      throw new Error(`evaluatePresses: missing perHoleResults entry for hole ${h} (throughHole=${throughHole})`);
    }
  }

  // manualPresses shape + dedupe.
  const seenManual = new Set<string>();
  for (const m of manualPresses) {
    if (!PRESS_TEAMS.has(m.team)) {
      throw new RangeError(`manualPress.team must be 'teamA' | 'teamB' (got ${String(m.team)})`);
    }
    assertIntegerInRange('manualPress.filedAtHole', m.filedAtHole, 1, 18);
    const key = `${m.team}|${m.filedAtHole}`;
    if (seenManual.has(key)) {
      throw new Error(`evaluatePresses: duplicate manualPresses entry for ${key}`);
    }
    seenManual.add(key);
  }

  // existingPressLog shape + dedupe.
  const seenLog = new Set<string>();
  for (const e of existingPressLog) {
    if (!PRESS_TYPES.has(e.type)) {
      throw new RangeError(`existingPressLog[].type must be 'auto' | 'manual' (got ${String(e.type)})`);
    }
    if (!PRESS_TEAMS.has(e.team)) {
      throw new RangeError(`existingPressLog[].team must be 'teamA' | 'teamB' (got ${String(e.team)})`);
    }
    assertIntegerInRange('existingPressLog[].startHole', e.startHole, 1, 18);
    assertPositiveInteger('existingPressLog[].multiplier', e.multiplier);
    if (e.trigger !== undefined && typeof e.trigger !== 'string') {
      throw new RangeError(`existingPressLog[].trigger must be a string when present`);
    }
    const key = `${e.type}|${e.team}|${e.startHole}`;
    if (seenLog.has(key)) {
      throw new Error(`evaluatePresses: duplicate existingPressLog entry for ${key}`);
    }
    seenLog.add(key);
  }

  // ── (2) Snapshot the original log keys (before any new evaluation) ─────
  const originalLogKeys = new Set(seenLog);

  // ── (3) Initialize allPresses + working dedupe set ─────────────────────
  const allPresses: Press[] = [];
  const dedupeKeys = new Set<string>(seenLog);

  function pressKey(p: { type: PressType; team: PressTeam; startHole: number }): string {
    return `${p.type}|${p.team}|${p.startHole}`;
  }

  function computeCanUndo(type: PressType, startHole: number): boolean {
    return type === 'manual' && throughHole <= startHole;
  }

  // ── (4) Carry-forward existingPressLog → allPresses ────────────────────
  for (const e of existingPressLog) {
    const press: Press = {
      type: e.type,
      team: e.team,
      startHole: e.startHole,
      multiplier: e.multiplier,  // historical fire-time value preserved
      canUndo: computeCanUndo(e.type, e.startHole),
    };
    if (e.trigger !== undefined) press.trigger = e.trigger;
    allPresses.push(press);
  }

  // ── (5) Manual-press echo ──────────────────────────────────────────────
  for (const m of manualPresses) {
    const key = pressKey({ type: 'manual', team: m.team, startHole: m.filedAtHole });
    if (!dedupeKeys.has(key)) {
      allPresses.push({
        type: 'manual',
        team: m.team,
        startHole: m.filedAtHole,
        multiplier: config.pressMultiplier,
        canUndo: computeCanUndo('manual', m.filedAtHole),
      });
      dedupeKeys.add(key);
    }
  }

  // ── (6) Base-match auto-press fires + (7) fixed-point compound eval ────
  const autoEnabled =
    config.autoPressTriggerAtNDown !== null && config.autoPressTriggerAtNDown > 0;

  if (autoEnabled) {
    const triggerN = config.autoPressTriggerAtNDown!;

    // Step 6: base match.
    const baseFires = findAutoFires(perHoleByNumber, 1, throughHole, triggerN);
    for (const f of baseFires) {
      const key = pressKey({ type: 'auto', team: f.team, startHole: f.startHole });
      if (!dedupeKeys.has(key)) {
        allPresses.push({
          type: 'auto',
          team: f.team,
          startHole: f.startHole,
          multiplier: config.pressMultiplier,
          trigger: f.trigger,
          canUndo: false,  // AC-9 — auto-press never has canUndo=true
        });
        dedupeKeys.add(key);
      }
    }

    // Step 7: fixed-point compound evaluation.
    const ITERATION_CAP = 50;
    let iteration = 0;
    let added = true;
    let cursor = 0;  // start of "presses to evaluate this iteration"
    while (added) {
      if (++iteration > ITERATION_CAP) {
        throw new RangeError(
          `evaluatePresses: fixed-point did not converge within ${ITERATION_CAP} iterations`,
        );
      }
      added = false;
      const snapshotEnd = allPresses.length;
      for (let i = cursor; i < snapshotEnd; i++) {
        const parent = allPresses[i]!;
        const childFires = findAutoFires(
          perHoleByNumber,
          parent.startHole,
          throughHole,
          triggerN,
        );
        for (const f of childFires) {
          const key = pressKey({ type: 'auto', team: f.team, startHole: f.startHole });
          if (!dedupeKeys.has(key)) {
            allPresses.push({
              type: 'auto',
              team: f.team,
              startHole: f.startHole,
              multiplier: config.pressMultiplier,
              trigger: f.trigger,
              canUndo: false,
            });
            dedupeKeys.add(key);
            added = true;
          }
        }
      }
      cursor = snapshotEnd;  // next iteration starts after the previously-evaluated batch
    }
  }

  // ── (8) Sort deterministically ─────────────────────────────────────────
  allPresses.sort(pressOrder);

  // ── (9) newlyFired filter — exclude entries that were in originalLogKeys ──
  const newlyFired = allPresses.filter((p) => !originalLogKeys.has(pressKey(p)));

  return { activePresses: allPresses, newlyFired };
}
