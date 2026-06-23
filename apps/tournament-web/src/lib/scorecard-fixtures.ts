/**
 * Static scorecard fixtures for story 3-1 (HoleBadge + ScorecardGrid port).
 *
 * Pure data only — no API, no money math. These exercise every rendering
 * path the components must handle:
 *   - full-18 played card (birdies / pars / bogeys / a double),
 *   - greenie + polie + sandie dots,
 *   - handicap-stroke holes (relativeStrokes 1 and 2),
 *   - a played hole with `moneyNet: null` (the `—` money path, AC #6),
 *   - a partial card (back-9 unplayed) with an unplayed stroke hole,
 *   - an all-null-money front-9 (the empty-sum `—` total path, AC #6).
 *
 * Invariant on played holes: netScore = grossScore - (relativeStrokes || 0).
 * Unplayed holes carry grossScore / netScore / moneyNet = null.
 *
 * Par-72 layout (self-consistent across all fixtures):
 *   Front: 4 4 3 5 4 4 3 5 4   (par 36)
 *   Back:  4 4 5 3 4 4 5 3 4   (par 36)
 */
import type { ScorecardHole } from '../types/scorecard';

/** Shared par-72 layout so every fixture reads off the same course. */
const PARS = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 5, 3, 4, 4, 5, 3, 4] as const;

/**
 * Steven Chatterton showcase card — a realistic full-18 Pete Dye round.
 *
 * Notation mix:
 *   - birdies (gross = par-1): holes 2, 11, 16
 *   - bogeys  (gross = par+1): holes 5, 13
 *   - double  (gross = par+2): hole 8
 *   - rest are pars
 * Bonus dots: greenie on the par-3 #3, polie on #11, sandie on #16.
 * Stroke holes: #4 (relativeStrokes 1), #12 (relativeStrokes 2).
 * Money: small whole-dollar mix of +/-/0, plus ONE played hole (#15) with
 *   moneyNet: null so the per-hole `—` money path is test-reachable.
 */
export const STEVEN_CHATTERTON_CARD: ScorecardHole[] = [
  // Front nine
  { holeNumber: 1, par: PARS[0], grossScore: 4, netScore: 4, moneyNet: 0 },
  { holeNumber: 2, par: PARS[1], grossScore: 3, netScore: 3, moneyNet: 5 },
  { holeNumber: 3, par: PARS[2], grossScore: 3, netScore: 3, moneyNet: 2, hasGreenie: true },
  { holeNumber: 4, par: PARS[3], grossScore: 5, netScore: 4, moneyNet: -3, relativeStrokes: 1 },
  { holeNumber: 5, par: PARS[4], grossScore: 5, netScore: 5, moneyNet: -5 },
  { holeNumber: 6, par: PARS[5], grossScore: 4, netScore: 4, moneyNet: 1 },
  { holeNumber: 7, par: PARS[6], grossScore: 3, netScore: 3, moneyNet: 0 },
  { holeNumber: 8, par: PARS[7], grossScore: 7, netScore: 7, moneyNet: -4 },
  { holeNumber: 9, par: PARS[8], grossScore: 4, netScore: 4, moneyNet: 3 },
  // Back nine
  { holeNumber: 10, par: PARS[9], grossScore: 4, netScore: 4, moneyNet: 2 },
  { holeNumber: 11, par: PARS[10], grossScore: 3, netScore: 3, moneyNet: 6, hasPolie: true },
  { holeNumber: 12, par: PARS[11], grossScore: 6, netScore: 4, moneyNet: -2, relativeStrokes: 2 },
  { holeNumber: 13, par: PARS[12], grossScore: 4, netScore: 4, moneyNet: -1 },
  { holeNumber: 14, par: PARS[13], grossScore: 4, netScore: 4, moneyNet: 0 },
  { holeNumber: 15, par: PARS[14], grossScore: 5, netScore: 5, moneyNet: null },
  { holeNumber: 16, par: PARS[15], grossScore: 4, netScore: 4, moneyNet: 4, hasSandie: true },
  { holeNumber: 17, par: PARS[16], grossScore: 3, netScore: 3, moneyNet: 1 },
  { holeNumber: 18, par: PARS[17], grossScore: 4, netScore: 4, moneyNet: -3 },
];

/**
 * Partial card — front-9 played, back-9 (holes 10-18) unplayed.
 *
 * All holes 1..18 are present so the grid can decide front/back visibility off
 * `grossScore != null`. Back-9 holes carry grossScore/netScore/moneyNet = null.
 * Hole 14 (unplayed) carries relativeStrokes: 1 to exercise the unplayed
 * stroke-dot (exactly one dot, never the played 2-dot variant). Front-9 money
 * is a +/-/0 mix.
 */
export const FRONT_NINE_ONLY: ScorecardHole[] = [
  // Front nine — played
  { holeNumber: 1, par: PARS[0], grossScore: 4, netScore: 4, moneyNet: 2 },
  { holeNumber: 2, par: PARS[1], grossScore: 3, netScore: 3, moneyNet: 5 },
  { holeNumber: 3, par: PARS[2], grossScore: 4, netScore: 4, moneyNet: -2 },
  { holeNumber: 4, par: PARS[3], grossScore: 5, netScore: 4, moneyNet: 0, relativeStrokes: 1 },
  { holeNumber: 5, par: PARS[4], grossScore: 4, netScore: 4, moneyNet: 1 },
  { holeNumber: 6, par: PARS[5], grossScore: 5, netScore: 5, moneyNet: -4 },
  { holeNumber: 7, par: PARS[6], grossScore: 3, netScore: 3, moneyNet: 3 },
  { holeNumber: 8, par: PARS[7], grossScore: 5, netScore: 5, moneyNet: -1 },
  { holeNumber: 9, par: PARS[8], grossScore: 4, netScore: 4, moneyNet: 0 },
  // Back nine — unplayed
  { holeNumber: 10, par: PARS[9], grossScore: null, netScore: null, moneyNet: null },
  { holeNumber: 11, par: PARS[10], grossScore: null, netScore: null, moneyNet: null },
  { holeNumber: 12, par: PARS[11], grossScore: null, netScore: null, moneyNet: null },
  { holeNumber: 13, par: PARS[12], grossScore: null, netScore: null, moneyNet: null },
  { holeNumber: 14, par: PARS[13], grossScore: null, netScore: null, moneyNet: null, relativeStrokes: 1 },
  { holeNumber: 15, par: PARS[14], grossScore: null, netScore: null, moneyNet: null },
  { holeNumber: 16, par: PARS[15], grossScore: null, netScore: null, moneyNet: null },
  { holeNumber: 17, par: PARS[16], grossScore: null, netScore: null, moneyNet: null },
  { holeNumber: 18, par: PARS[17], grossScore: null, netScore: null, moneyNet: null },
];

/**
 * Front-9 played but EVERY played hole has moneyNet: null — exercises the
 * empty-sum `—` section-total path (AC #6: a section with zero non-null
 * moneyNet renders `—`, never `0`). Back-9 fully unplayed.
 */
export const ALL_NULL_MONEY_FRONT: ScorecardHole[] = [
  // Front nine — played, money entirely unknown
  { holeNumber: 1, par: PARS[0], grossScore: 4, netScore: 4, moneyNet: null },
  { holeNumber: 2, par: PARS[1], grossScore: 4, netScore: 4, moneyNet: null },
  { holeNumber: 3, par: PARS[2], grossScore: 3, netScore: 3, moneyNet: null },
  { holeNumber: 4, par: PARS[3], grossScore: 6, netScore: 5, moneyNet: null, relativeStrokes: 1 },
  { holeNumber: 5, par: PARS[4], grossScore: 4, netScore: 4, moneyNet: null },
  { holeNumber: 6, par: PARS[5], grossScore: 5, netScore: 5, moneyNet: null },
  { holeNumber: 7, par: PARS[6], grossScore: 3, netScore: 3, moneyNet: null },
  { holeNumber: 8, par: PARS[7], grossScore: 5, netScore: 5, moneyNet: null },
  { holeNumber: 9, par: PARS[8], grossScore: 4, netScore: 4, moneyNet: null },
  // Back nine — unplayed
  { holeNumber: 10, par: PARS[9], grossScore: null, netScore: null, moneyNet: null },
  { holeNumber: 11, par: PARS[10], grossScore: null, netScore: null, moneyNet: null },
  { holeNumber: 12, par: PARS[11], grossScore: null, netScore: null, moneyNet: null },
  { holeNumber: 13, par: PARS[12], grossScore: null, netScore: null, moneyNet: null },
  { holeNumber: 14, par: PARS[13], grossScore: null, netScore: null, moneyNet: null },
  { holeNumber: 15, par: PARS[14], grossScore: null, netScore: null, moneyNet: null },
  { holeNumber: 16, par: PARS[15], grossScore: null, netScore: null, moneyNet: null },
  { holeNumber: 17, par: PARS[16], grossScore: null, netScore: null, moneyNet: null },
  { holeNumber: 18, par: PARS[17], grossScore: null, netScore: null, moneyNet: null },
];
