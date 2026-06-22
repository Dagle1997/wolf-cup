/**
 * greenie modifier (Story 2.2) — the FIRST stateful modifier in the F1 engine.
 *
 * A greenie is contested ONLY on par-3s and is COUNT-BASED: the system's only
 * job is the per-player greenie checkbox (Story 2.1 populates `holeState.claims`).
 * Closest-to-pin / green-in-reg / 2-putt are HUMAN judgments never validated in
 * software — boxes are accepted as entered (FR16). Per par-3:
 *   rawA = (#teamA members checked) − (#teamB members checked)  ∈ −2…+2
 * Each unit is a TEAM point (+1 each winning-team player / −1 each opponent),
 * the same shape as the base low-ball/skin/total points.
 *
 * STATEFUL CARRYOVER (the only greenie lever, FR2): an UNCLAIMED par-3 (zero
 * boxes) rolls 1 greenie to the NEXT par-3 when carryover is ON; expires when
 * OFF (FR40). The winning team SWEEPS the pending pot when a par-3 is finally
 * won. Non-par-3 holes are skipped — the pot never lands on a par-4/5.
 *
 * Pure: no db, no Date, no random. Reads structurally only its own foursome's
 * claims (teamA ∪ teamB members; any foreign key is ignored — FR23). The fold is
 * order-invariant for a fixed hole sequence (it sorts by holeNumber, NFR-C6).
 *
 * Carry is tracked in integer POINTS (never cents); compute-foursome values each
 * greenie point — including a swept pot — at the COLLECTING hole's pointValueCents
 * (AC7), folding the per-hole award into the existing `pts` (the split path is not
 * forked, NFR-C7).
 */
import type { GameConfig, HoleState, TeamSplit } from '../types.js';

/** Is the greenie modifier present AND enabled for this config? */
export function greenieActive(config: GameConfig): boolean {
  const m = config.modifiers.find((x) => x.type === 'greenie');
  return !!m && m.enabled;
}

/**
 * Is greenie carryover ON? Defaults to TRUE when greenie is enabled (Standard
 * Guyan = "greenie carryover"). Only meaningful when greenieActive.
 */
export function greenieCarryover(config: GameConfig): boolean {
  const m = config.modifiers.find((x) => x.type === 'greenie');
  return m?.variant?.carryover ?? true;
}

/**
 * The greenie fold result. `pointsByHole` maps a collecting par-3's holeNumber to
 * its signed (A-positive) greenie team points (entries only for non-zero awards).
 * `finalCarryPoints` is the pot still pending after the last SETTLEABLE par-3 (it
 * contributes 0 money — no phantom edge). `settleablePar3Count` is the number of
 * par-3s actually folded (the contiguous-complete prefix; the AC8 barrier defers
 * the rest). The latter two surface fold state so the carry-conservation property
 * is non-tautological.
 */
export type GreenieFold = {
  pointsByHole: Map<number, number>;
  finalCarryPoints: number;
  settleablePar3Count: number;
};

/** A member is "checked" iff their greenie claim flag is exactly true. */
function isChecked(hole: HoleState, playerId: string): boolean {
  return hole.claims?.[playerId]?.greenie === true;
}

/**
 * Fold the per-player greenie checkboxes over par-3s into per-hole team points,
 * threading the carry pot. Inactive greenie ⇒ empty fold (inert).
 *
 * BARRIER, not filter (AC8): the fold iterates par-3s in holeNumber order and, at
 * the FIRST incomplete par-3 (any of the four members' net missing), BREAKS — that
 * par-3 and every par-3 after it are deferred, carry frozen at its pre-barrier
 * value. The incomplete par-3 is NOT dropped (filtering would bridge the carry
 * across the gap → money would retroactively vanish when the gap completes).
 * PRECONDITION: the `holes` array must be DENSE (a row for every in-play hole,
 * incl. unplayed/partial par-3s as present-but-incomplete rows) so the barrier can
 * see the gap — the service layer (games-money.ts) guarantees this.
 */
export function greenieFold(
  config: GameConfig,
  holes: readonly HoleState[],
  teamSplit: TeamSplit,
): GreenieFold {
  if (!greenieActive(config)) {
    return { pointsByHole: new Map(), finalCarryPoints: 0, settleablePar3Count: 0 };
  }

  const carryEnabled = greenieCarryover(config);
  const { teamA, teamB } = teamSplit;
  const members = [teamA[0], teamA[1], teamB[0], teamB[1]];

  const pointsByHole = new Map<number, number>();
  let carry = 0; // pending pot, non-negative integer POINTS
  let settleablePar3Count = 0;

  // Canonical order (NFR-C6): carryover inherently respects holeNumber order.
  const sorted = [...holes].sort((x, y) => x.holeNumber - y.holeNumber);

  for (const hole of sorted) {
    if (hole.par !== 3) continue; // greenies contested only on par-3s; pot rolls past
    // BARRIER (AC8): stop at the first incomplete par-3 — do NOT filter/advance.
    if (members.some((p) => hole.net[p] === undefined)) break;

    settleablePar3Count += 1;
    const countA = (isChecked(hole, teamA[0]) ? 1 : 0) + (isChecked(hole, teamA[1]) ? 1 : 0);
    const countB = (isChecked(hole, teamB[0]) ? 1 : 0) + (isChecked(hole, teamB[1]) ? 1 : 0);
    const rawA = countA - countB; // −2…+2

    if (rawA !== 0) {
      // WON: the winning team sweeps the pending pot. award = rawA + sign*carry;
      // carryover stops once won.
      const sign = rawA > 0 ? 1 : -1;
      pointsByHole.set(hole.holeNumber, rawA + sign * carry);
      carry = 0;
    } else if (countA === 0 && countB === 0) {
      // UNCLAIMED (zero boxes): one greenie rolls when ON; expires when OFF (FR40).
      carry = carryEnabled ? carry + 1 : 0;
    }
    // CONTESTED (boxes on both teams, rawA === 0): award 0, pot PRESERVED (carry
    // unchanged — neither incremented nor forfeited). Cannot occur in real play
    // (closest-to-pin always has a clear winner); kept as a defensive
    // accepted-as-entered safety rule so malformed input can never move money.
  }

  return { pointsByHole, finalCarryPoints: carry, settleablePar3Count };
}
