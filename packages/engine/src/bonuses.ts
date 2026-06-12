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
  for (const p of bonusInput.sandies) events[p] += 1;
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

  // Base: team's best player's level (second birdie/eagle doesn't count on its own)
  let skins = Math.max(
    skinCount(detectBonusLevel(netScores[w0], par)),
    skinCount(detectBonusLevel(netScores[w1], par)),
  );

  // Double birdie bonus: both NET birdie+, ≥1 NATURAL (gross) birdie,
  // AND no opponent has net birdie+ (opponent birdie cancels the bonus).
  // When this fires, BOTH players' contributions count (per-player) + 1 bonus.
  const oppHasBirdie = netScores[l0] <= par - 1 || netScores[l1] <= par - 1;
  if (!oppHasBirdie &&
      netScores[w0] <= par - 1 && netScores[w1] <= par - 1 &&
      (grossScores[w0] <= par - 1 || grossScores[w1] <= par - 1)) {
    // Switch to per-player counting (both players' birdie/eagle levels)
    skins = skinCount(detectBonusLevel(netScores[w0], par))
          + skinCount(detectBonusLevel(netScores[w1], par));
    skins += 1; // double birdie bonus
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

  // Sandie skins: 1 per player (same nets-to-zero behavior as polies)
  for (const p of bonusInput.sandies) {
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
  grossScores: readonly [number, number, number, number],
  bonusInput: BonusInput,
  wolfIdx: BattingPosition,
  par: number,
): void {
  const opps = ALL_POSITIONS.filter((i): i is BattingPosition => i !== wolfIdx) as
    [BattingPosition, BattingPosition, BattingPosition];

  // SCORE-BASED bonus skin: 1 skin per hole based on max LEVEL on each side
  // (mirrors competitiveScoreSkins for 2v2). Tied levels = no blood.
  // Double birdie bonus (1v3 variant): when opps win, ≥2 opp net birdie+,
  // ≥1 natural (gross) birdie, AND wolf has no net birdie → +2 skins.
  // The double-birdie bonus is TWO extra skins (league rule), so a single
  // birdie pays 1 and a double pays 1+2 = 3 — matching the 2v2 path, where a
  // single→double also goes 1→3. There is NO triple-birdie escalation: the +2
  // is flat regardless of how many opponents birdied (2 or 3 → same +2).
  const wolfLevel = skinCount(detectBonusLevel(netScores[wolfIdx], par));
  const oppLevels = opps.map((i) => skinCount(detectBonusLevel(netScores[i], par)));
  const maxOppLevel = Math.max(oppLevels[0]!, oppLevels[1]!, oppLevels[2]!);

  let scoreSkinsToWolf = 0; // positive = wolf wins, negative = opps win
  if (wolfLevel > maxOppLevel) {
    scoreSkinsToWolf = wolfLevel;
  } else if (maxOppLevel > wolfLevel) {
    let oppSkins = maxOppLevel;
    const oppNetBirdies = opps.filter((i) => netScores[i] <= par - 1).length;
    const oppNaturalBirdies = opps.filter((i) => grossScores[i] <= par - 1).length;
    const wolfHasBirdie = netScores[wolfIdx] <= par - 1;
    if (oppNetBirdies >= 2 && oppNaturalBirdies >= 1 && !wolfHasBirdie) {
      oppSkins += 2; // double-birdie bonus = TWO extra skins (league rule)
    }
    scoreSkinsToWolf = -oppSkins;
  }

  // MANUAL bonuses (polies/greenies/sandies): each event counts independently,
  // group-scaled (preserves prior behavior for these — no rule change).
  let W_manual = 0;
  if (bonusInput.polies.includes(wolfIdx)) W_manual += 1;
  if (bonusInput.greenies.includes(wolfIdx)) W_manual += 1;
  if (bonusInput.sandies.includes(wolfIdx)) W_manual += 1;
  let O_manual = 0;
  for (const opp of opps) {
    if (bonusInput.polies.includes(opp)) O_manual += 1;
    if (bonusInput.greenies.includes(opp)) O_manual += 1;
    if (bonusInput.sandies.includes(opp)) O_manual += 1;
  }

  // Combine: wolf takes 3×(score + manual), each opp takes 1×(opp share)
  bonusSkins[wolfIdx] = 3 * scoreSkinsToWolf + 3 * (W_manual - O_manual);
  for (const opp of opps) {
    bonusSkins[opp] = -scoreSkinsToWolf + (O_manual - W_manual);
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
    // NOTE: This branch encodes the SUPERSEDED pre-2026-03-09 rule where skins
    // holes paid individual bonus skins. The live league rule (commit 477c4c3)
    // is that skins holes 1 & 3 carry NO bonus money — base skin only. Every
    // production path (rounds.ts, money-breakdown.ts) gates applyBonusModifiers
    // to wolf holes, so this branch is NEVER reached in prod. Do NOT "fix" an
    // API path to call this on skins holes — it would reintroduce the 477c4c3 bug.
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
    apply1v3(bonusSkins, netScores, grossScores, bonusInput, holeAssignment.wolfBatterIndex, par);
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
