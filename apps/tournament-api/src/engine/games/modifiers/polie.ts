/**
 * polie modifier (Story 2.3) — the STATELESS claim sibling of greenie (2.2).
 *
 * A polie = making a putt (or chip-in) longer than the flagstick. It CANNOT be
 * detected by software — the scorer checks the polie box next to each player who
 * made one (accepted as entered, FR16), exactly like greenie. ALL FOUR players
 * can each have a polie; each is a TEAM point (+1 to the maker's team / −1 to the
 * opponents), same shape as the base low-ball/skin/total points. COUNT-BASED per
 * hole: poliePoints to A = (# eligible teamA polies) − (# eligible teamB polies),
 * range −2…+2. STATELESS — no carryover; each hole resolves independently.
 *
 * The ONLY lever is a Y/N toggle "Polie must be Bogey or Better" (Josh). When ON,
 * a checked polie counts only if that player's GROSS ≤ par+1 (bogey-or-better).
 * GROSS — never net — so the group's "net off the low" basis does not affect it.
 *
 * Pure: no db, no Date, no random. Reads structurally only its own foursome's
 * claims/gross (teamA ∪ teamB members; any foreign key ignored — FR23). Stateless
 * ⇒ inherently order-independent (NFR-C6). compute-foursome values each polie
 * point at the collecting hole's pointValueCents, folding it into the existing
 * `pts` (the split path is not forked, NFR-C7).
 */
import type { GameConfig, HoleState } from '../types.js';

/** Is the polie modifier present AND enabled for this config? */
export function polieActive(config: GameConfig): boolean {
  const m = config.modifiers.find((x) => x.type === 'polie');
  return !!m && m.enabled;
}

/**
 * Is the "Polie must be Bogey or Better" gate ON? Defaults to FALSE when polie is
 * enabled (Standard Guyan = "polie on anything"). Only meaningful when polieActive.
 */
export function polieBogeyOrBetter(config: GameConfig): boolean {
  const m = config.modifiers.find((x) => x.type === 'polie');
  return m?.variant?.polieBogeyOrBetter ?? false;
}

/**
 * Bogey-or-better on GROSS. Fail-closed: the finite-number guard runs BEFORE the
 * comparison so a `null`/`undefined`/`NaN`/string gross is voided, never coerced
 * (`null <= par+1` is `true` in JS — that would wrongly count an ineligible polie).
 */
function isBogeyOrBetter(gross: number | undefined, par: number): boolean {
  return typeof gross === 'number' && Number.isFinite(gross) && gross <= par + 1;
}

/** A member's polie is eligible: checked AND (gate off OR finite gross ≤ par+1). */
function polieEligible(hole: HoleState, playerId: string, gateOn: boolean): boolean {
  if (hole.claims?.[playerId]?.polie !== true) return false;
  if (!gateOn) return true;
  return isBogeyOrBetter(hole.gross?.[playerId], hole.par);
}

/**
 * Signed (A-positive) polie team points on a hole: `#eligibleA − #eligibleB`,
 * range −2…+2. Counts only `teamA ∪ teamB` members (foreign claim/gross keys are
 * ignored — FR23). Returns 0 when polie is inactive (self-guards for any direct
 * caller). Stateless: no cross-hole state.
 */
export function poliePoints(
  hole: HoleState,
  teamA: readonly [string, string],
  teamB: readonly [string, string],
  config: GameConfig,
): number {
  if (!polieActive(config)) return 0;
  const gateOn = polieBogeyOrBetter(config);
  const countA =
    (polieEligible(hole, teamA[0], gateOn) ? 1 : 0) + (polieEligible(hole, teamA[1], gateOn) ? 1 : 0);
  const countB =
    (polieEligible(hole, teamB[0], gateOn) ? 1 : 0) + (polieEligible(hole, teamB[1], gateOn) ? 1 : 0);
  return countA - countB;
}
