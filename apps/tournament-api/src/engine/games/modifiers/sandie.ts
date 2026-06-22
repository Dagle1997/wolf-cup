/**
 * sandie modifier (Story 2.4) — the simplest claim modifier: a PURE COUNT.
 *
 * A sandie = an "up-and-down from the sand" (out of a greenside bunker + one putt).
 * Scorer-checked, accepted as entered (FR16). Same shape as polie MINUS the score
 * gate: all four players can each have a sandie; each is a TEAM point. COUNT-BASED:
 * sandieA = (# teamA sandies) − (# teamB sandies), range −2…+2. STATELESS.
 *
 * NO engine-enforced eligibility gate (Josh, FR16): the system does NOT validate
 * the up-and-down or the score — the scorer simply doesn't check the box if the
 * player didn't earn it under the group's rule. Re-validating in the engine would
 * silently void a human-entered claim, against FR16. The "par/bogey or better"
 * convention is a Rules-Sheet item (Story 2.7), not a settlement gate. So a checked
 * sandie ALWAYS counts — no gross, no variant lever.
 *
 * Pure: no db, no Date, no random. Reads structurally only its own foursome's
 * claims (teamA ∪ teamB; foreign keys ignored — FR23). Stateless ⇒ order-independent
 * (NFR-C6). compute-foursome values each point at the collecting hole's
 * pointValueCents, folding it into the existing `pts` (split not forked, NFR-C7).
 */
import type { GameConfig, HoleState } from '../types.js';

/** Is the sandie modifier present AND enabled for this config? */
export function sandieActive(config: GameConfig): boolean {
  const m = config.modifiers.find((x) => x.type === 'sandie');
  return !!m && m.enabled;
}

/** A member is "checked" iff their sandie claim flag is exactly true. */
function isChecked(hole: HoleState, playerId: string): boolean {
  return hole.claims?.[playerId]?.sandie === true;
}

/**
 * Signed (A-positive) sandie team points on a hole: `#A − #B`, range −2…+2.
 * Counts only `teamA ∪ teamB` members (foreign claim keys ignored — FR23). Returns
 * 0 when sandie is inactive (self-guards for any direct caller). Stateless.
 */
export function sandiePoints(
  hole: HoleState,
  teamA: readonly [string, string],
  teamB: readonly [string, string],
  config: GameConfig,
): number {
  if (!sandieActive(config)) return 0;
  const countA = (isChecked(hole, teamA[0]) ? 1 : 0) + (isChecked(hole, teamA[1]) ? 1 : 0);
  const countB = (isChecked(hole, teamB[0]) ? 1 : 0) + (isChecked(hole, teamB[1]) ? 1 : 0);
  return countA - countB;
}
