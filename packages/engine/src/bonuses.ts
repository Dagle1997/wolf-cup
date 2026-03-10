import type {
  BattingPosition,
  BonusInput,
  BonusLevel,
  HoleAssignment,
  HoleMoneyResult,
  WolfDecision,
} from './types.js';
import { validateZeroSum } from './validation.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_POSITIONS: readonly BattingPosition[] = [0, 1, 2, 3];

// ---------------------------------------------------------------------------
// Public: detectBonusLevel
// ---------------------------------------------------------------------------

/**
 * Auto-detects bonus level from a score vs par.
 * Returns null if par or worse (no bonus).
 */
export function detectBonusLevel(score: number, par: number): BonusLevel | null {
  const diff = par - score;
  if (diff >= 3) return 'double_eagle';
  if (diff === 2) return 'eagle';
  if (diff === 1) return 'birdie';
  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Number of group skins contributed by a bonus level (cumulative per level). */
function skinCount(level: BonusLevel | null): number {
  if (level === 'double_eagle') return 3;
  if (level === 'eagle') return 2;
  if (level === 'birdie') return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Skins holes — individual skin structure (+3 winner / −1 others per event)
// ---------------------------------------------------------------------------

function applyIndividual(
  bonusSkins: [number, number, number, number],
  netScores: readonly [number, number, number, number],
  bonusInput: BonusInput,
  par: number,
): void {
  const events: [number, number, number, number] = [0, 0, 0, 0];
  for (const i of ALL_POSITIONS) {
    events[i] += skinCount(detectBonusLevel(netScores[i], par));
  }
  for (const p of bonusInput.polies) events[p] += 1;
  for (const p of bonusInput.greenies) events[p] += 1;
  const total = events[0] + events[1] + events[2] + events[3];
  for (const i of ALL_POSITIONS) {
    // Winner of each event: +3; loser: -1 per event they didn't win.
    // Net = events[i]*3 - (total - events[i])*1 = events[i]*4 - total
    bonusSkins[i] = events[i] * 4 - total;
  }
}

// ---------------------------------------------------------------------------
// 2v2 wolf holes — team skin structure
// ---------------------------------------------------------------------------

/**
 * Score-based bonus skin result for a 2v2 hole — winner-takes-all competitive.
 *
 * Winner determined by comparing each team's best bonus LEVEL (birdie < eagle < double_eagle).
 * Same level → tie → no blood.
 *
 * Winning team's skins are counted PER PLAYER: each player contributes skinCount
 * based on their individual net score (birdie=1, eagle=2, double_eagle=3).
 *
 * Double birdie/eagle bonuses apply to the WINNING team only.
 *
 * Returns: positive = team A wins N skins, negative = team B wins N skins, 0 = no blood.
 */
function competitiveScoreSkins(
  netScores: readonly [number, number, number, number],
  grossScores: readonly [number, number, number, number],
  teamA: readonly [BattingPosition, BattingPosition],
  teamB: readonly [BattingPosition, BattingPosition],
  par: number,
): number {
  // Determine winner by comparing each team's best bonus level
  const bestLevelA = Math.max(
    skinCount(detectBonusLevel(netScores[teamA[0]], par)),
    skinCount(detectBonusLevel(netScores[teamA[1]], par)),
  );
  const bestLevelB = Math.max(
    skinCount(detectBonusLevel(netScores[teamB[0]], par)),
    skinCount(detectBonusLevel(netScores[teamB[1]], par)),
  );

  if (bestLevelA === 0 && bestLevelB === 0) return 0;
  if (bestLevelA === bestLevelB) return 0; // same level — no blood

  const winnerIsA = bestLevelA > bestLevelB;
  const [w0, w1] = winnerIsA ? teamA : teamB;
  const [l0, l1] = winnerIsA ? teamB : teamA;

  // Count skins per player on winning team
  let skins = skinCount(detectBonusLevel(netScores[w0], par))
            + skinCount(detectBonusLevel(netScores[w1], par));

  // Double birdie bonus: both NET birdie+, ≥1 NATURAL (gross) birdie,
  // AND no opponent has net birdie+ (opponent birdie cancels the bonus)
  const oppHasBirdie = netScores[l0] <= par - 1 || netScores[l1] <= par - 1;
  if (!oppHasBirdie &&
      netScores[w0] <= par - 1 && netScores[w1] <= par - 1 &&
      (grossScores[w0] <= par - 1 || grossScores[w1] <= par - 1)) {
    skins += 1;
  }

  // Double eagle bonus: both NET eagle+, ≥1 NATURAL (gross) eagle,
  // AND no opponent has net eagle+ (opponent eagle cancels the bonus)
  const oppHasEagle = netScores[l0] <= par - 2 || netScores[l1] <= par - 2;
  if (!oppHasEagle &&
      netScores[w0] <= par - 2 && netScores[w1] <= par - 2 &&
      (grossScores[w0] <= par - 2 || grossScores[w1] <= par - 2)) {
    skins += 1;
  }

  return winnerIsA ? skins : -skins;
}

function apply2v2(
  bonusSkins: [number, number, number, number],
  netScores: readonly [number, number, number, number],
  grossScores: readonly [number, number, number, number],
  bonusInput: BonusInput,
  wolfIdx: BattingPosition,
  partnerIdx: BattingPosition,
  par: number,
): void {
  const teamASet = new Set<BattingPosition>([wolfIdx, partnerIdx]);
  const teamA: [BattingPosition, BattingPosition] = [wolfIdx, partnerIdx];
  const teamBArr = ALL_POSITIONS.filter((i): i is BattingPosition => !teamASet.has(i));
  const b0 = teamBArr[0];
  const b1 = teamBArr[1];
  if (b0 === undefined || b1 === undefined) throw new Error('unreachable: invalid team config');
  const teamB: [BattingPosition, BattingPosition] = [b0, b1];

  const scoreNet = competitiveScoreSkins(netScores, grossScores, teamA, teamB, par);
  let skinsA = scoreNet > 0 ? scoreNet : 0;
  let skinsB = scoreNet < 0 ? -scoreNet : 0;

  // Greenie skins: 1 skin per greenie, 2 for double greenie (both team members validate)
  const aGreenies = bonusInput.greenies.filter(p => teamASet.has(p)).length;
  const bGreenies = bonusInput.greenies.filter(p => !teamASet.has(p)).length;
  skinsA += Math.min(aGreenies, 2);
  skinsB += Math.min(bGreenies, 2);

  // Polie skins: 1 per player
  for (const p of bonusInput.polies) {
    if (teamASet.has(p)) skinsA += 1;
    else skinsB += 1;
  }

  // Net result — each team member gets net differential
  for (const p of teamA) bonusSkins[p] = skinsA - skinsB;
  for (const p of teamB) bonusSkins[p] = skinsB - skinsA;
}

// ---------------------------------------------------------------------------
// 1v3 wolf holes — group skin structure (wolf ×3 multiplier)
// ---------------------------------------------------------------------------

function apply1v3(
  bonusSkins: [number, number, number, number],
  netScores: readonly [number, number, number, number],
  bonusInput: BonusInput,
  wolfIdx: BattingPosition,
  par: number,
): void {
  const opps = ALL_POSITIONS.filter((i): i is BattingPosition => i !== wolfIdx) as
    [BattingPosition, BattingPosition, BattingPosition];

  // Wolf bonus events — birdie/eagle based on NET score
  let W = skinCount(detectBonusLevel(netScores[wolfIdx], par));
  if (bonusInput.polies.includes(wolfIdx)) W += 1;
  if (bonusInput.greenies.includes(wolfIdx)) W += 1;

  // Opponent bonus events (each counted individually; no double bonus in 1v3)
  let O = 0;
  for (const opp of opps) {
    O += skinCount(detectBonusLevel(netScores[opp], par));
    if (bonusInput.polies.includes(opp)) O += 1;
    if (bonusInput.greenies.includes(opp)) O += 1;
  }

  // Group skin payout: wolf × 3, each opp × 1
  bonusSkins[wolfIdx] = 3 * W - 3 * O;
  for (const opp of opps) {
    bonusSkins[opp] = O - W;
  }
}

// ---------------------------------------------------------------------------
// Public: applyBonusModifiers
// ---------------------------------------------------------------------------

/**
 * Applies bonus skin modifiers (birdie/eagle/double eagle, greenies, polies)
 * on top of a base HoleMoneyResult.
 *
 * The base result's `bonusSkins` field is assumed to be $0 — this function
 * computes and sets it, then recalculates `total` for each player.
 *
 * @throws {ZeroSumViolationError} if the resulting bonusSkins violate zero-sum
 */
export function applyBonusModifiers(
  base: HoleMoneyResult,
  netScores: readonly [number, number, number, number],
  grossScores: readonly [number, number, number, number],
  bonusInput: BonusInput,
  holeAssignment: HoleAssignment,
  wolfDecision: WolfDecision | null,
  par: number,
): HoleMoneyResult {
  const bonusSkins: [number, number, number, number] = [0, 0, 0, 0];

  if (holeAssignment.type === 'skins') {
    applyIndividual(bonusSkins, netScores, bonusInput, par);
  } else if (wolfDecision?.type === 'partner') {
    apply2v2(
      bonusSkins,
      netScores,
      grossScores,
      bonusInput,
      holeAssignment.wolfBatterIndex,
      wolfDecision.partnerBatterIndex,
      par,
    );
  } else {
    apply1v3(bonusSkins, netScores, bonusInput, holeAssignment.wolfBatterIndex, par);
  }

  const result: HoleMoneyResult = [
    { ...base[0], bonusSkins: bonusSkins[0], total: base[0].total + bonusSkins[0] },
    { ...base[1], bonusSkins: bonusSkins[1], total: base[1].total + bonusSkins[1] },
    { ...base[2], bonusSkins: bonusSkins[2], total: base[2].total + bonusSkins[2] },
    { ...base[3], bonusSkins: bonusSkins[3], total: base[3].total + bonusSkins[3] },
  ];

  validateZeroSum(result);
  return result;
}
