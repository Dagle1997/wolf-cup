/**
 * polie modifier (Story 2.3; Story 2.4a stripped the score gate).
 *
 * A polie = making a putt (or chip-in) longer than the flagstick. Scorer-checked,
 * accepted as entered (FR16). PURE COUNT (identical money model to sandie): all
 * four players can each have a polie; each is a TEAM point. poliePointsA =
 * (# teamA polie boxes) − (# teamB polie boxes), range −2…+2. STATELESS.
 *
 * NO engine-enforced eligibility gate (Josh, FR16): the original Story 2.3
 * "bogey-or-better" GROSS gate was removed in Story 2.4a — the system does NOT
 * validate the score (the scorer simply doesn't check the box if the player
 * didn't earn it under the group's rule; re-validating would silently void a
 * human-entered claim, against FR16). The "polie must be bogey-or-better"
 * convention is a Rules-Sheet item (Story 2.7), not a settlement gate. So a
 * checked polie ALWAYS counts — polie does not read `hole.gross`. (`HoleState.gross`
 * is retained for other consumers, e.g. Story 2.5 gross-birdie.)
 *
 * Pure: no db, no Date, no random. Reads structurally only its own foursome's
 * claims (teamA ∪ teamB; foreign keys ignored — FR23). Stateless ⇒ order-independent
 * (NFR-C6). compute-foursome values each point at the collecting hole's
 * pointValueCents, folding it into the existing `pts` (split not forked, NFR-C7).
 */
import type { GameConfig, HoleState } from '../types.js';

/** Is the polie modifier present AND enabled for this config? */
export function polieActive(config: GameConfig): boolean {
  const m = config.modifiers.find((x) => x.type === 'polie');
  return !!m && m.enabled;
}

/** A member is "checked" iff their polie claim flag is exactly true. */
function isChecked(hole: HoleState, playerId: string): boolean {
  return hole.claims?.[playerId]?.polie === true;
}

/**
 * Signed (A-positive) polie team points on a hole: `#A − #B`, range −2…+2.
 * Counts only `teamA ∪ teamB` members (foreign claim keys ignored — FR23). Returns
 * 0 when polie is inactive (self-guards for any direct caller). Stateless.
 */
export function poliePoints(
  hole: HoleState,
  teamA: readonly [string, string],
  teamB: readonly [string, string],
  config: GameConfig,
): number {
  if (!polieActive(config)) return 0;
  const countA = (isChecked(hole, teamA[0]) ? 1 : 0) + (isChecked(hole, teamA[1]) ? 1 : 0);
  const countB = (isChecked(hole, teamB[0]) ? 1 : 0) + (isChecked(hole, teamB[1]) ? 1 : 0);
  return countA - countB;
}
