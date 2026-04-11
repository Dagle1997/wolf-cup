import type {
  BattingPosition,
  HoleAssignment,
  HoleMoneyResult,
  PlayerHoleMoneyResult,
  WolfDecision,
} from './types.js';
import { validateZeroSum } from './validation.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const ALL_POSITIONS: readonly BattingPosition[] = [0, 1, 2, 3];

/** Build a PlayerHoleMoneyResult, computing total from all five components. */
function player(
  lowBall: number,
  skin: number,
  teamTotalOrBonus: number,
  blindWolf: number,
  bonusSkins = 0,
): PlayerHoleMoneyResult {
  return { lowBall, skin, teamTotalOrBonus, blindWolf, bonusSkins, total: lowBall + skin + teamTotalOrBonus + blindWolf + bonusSkins };
}

/** Compare two net scores: returns 1 if a wins (lower), -1 if b wins, 0 if tied. */
function cmp(a: number, b: number): -1 | 0 | 1 {
  if (a < b) return 1;
  if (a > b) return -1;
  return 0;
}

/** Resolve individual skin payout (+3 winner, -1 others) — used on skins holes (1, 3). */
function skinIndividual(
  netScores: readonly [number, number, number, number],
  par: number,
): readonly [number, number, number, number] {
  const min = Math.min(netScores[0], netScores[1], netScores[2], netScores[3]);
  if (min > par) return [0, 0, 0, 0];
  const count = netScores.filter(s => s === min).length;
  if (count !== 1) return [0, 0, 0, 0];
  return netScores.map(s => (s === min ? 3 : -1)) as unknown as readonly [number, number, number, number];
}

/**
 * Resolve skin as a TEAM point (2v2).
 * Follows the low-ball result: winning team each +1, losing team each -1.
 * Gated by the winning team's low ball being ≤ par.
 * Same-team ties for absolute low are fine — the team still won low ball.
 */
function skinTeam(
  netScores: readonly [number, number, number, number],
  par: number,
  lbResult: -1 | 0 | 1,
  teamA: readonly [BattingPosition, BattingPosition],
  teamB: readonly [BattingPosition, BattingPosition],
): readonly [number, number, number, number] {
  if (lbResult === 0) return [0, 0, 0, 0];
  // Winning team's low ball must be ≤ par
  const winLow = lbResult === 1
    ? Math.min(netScores[teamA[0]], netScores[teamA[1]])
    : Math.min(netScores[teamB[0]], netScores[teamB[1]]);
  if (winLow > par) return [0, 0, 0, 0];
  const result: [number, number, number, number] = [0, 0, 0, 0];
  result[teamA[0]] = lbResult;
  result[teamA[1]] = lbResult;
  result[teamB[0]] = -lbResult;
  result[teamB[1]] = -lbResult;
  return result;
}

/**
 * Resolve skin as a GROUP point (1v3).
 * Follows the low-ball result: wolf vs opponents collectively.
 * Gated by the winning side's low ball being ≤ par.
 * Wolf wins → wolf +3, each opp -1.
 * Opponents win → wolf -3, each opp +1.
 * Tie → no skin.
 */
function skinGroup(
  netScores: readonly [number, number, number, number],
  par: number,
  wolfIdx: BattingPosition,
  opps: readonly [BattingPosition, BattingPosition, BattingPosition],
  lbResult: -1 | 0 | 1,
): readonly [number, number, number, number] {
  if (lbResult === 0) return [0, 0, 0, 0];
  // Winning side's low score must be ≤ par
  const winLow = lbResult === 1
    ? netScores[wolfIdx]
    : Math.min(netScores[opps[0]], netScores[opps[1]], netScores[opps[2]]);
  if (winLow > par) return [0, 0, 0, 0];
  const result: [number, number, number, number] = [0, 0, 0, 0];
  result[wolfIdx] = lbResult * 3;
  result[opps[0]] = -lbResult;
  result[opps[1]] = -lbResult;
  result[opps[2]] = -lbResult;
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calculates per-player money results for a single hole.
 *
 * @param netScores      - Net score for each player (batting positions 0–3)
 * @param holeAssignment - Skins hole (1, 3) or wolf hole with wolf's batting position
 * @param wolfDecision   - Wolf's decision (null on skins holes): partner | alone | blind_wolf
 * @param par            - Hole par (3, 4, or 5)
 */
export function calculateHoleMoney(
  netScores: readonly [number, number, number, number],
  holeAssignment: HoleAssignment,
  wolfDecision: WolfDecision | null,
  par: 3 | 4 | 5,
): HoleMoneyResult {
  const result = holeAssignment.type === 'skins'
    ? calcSkinsHole(netScores, par)
    : calcWolfHole(netScores, holeAssignment.wolfBatterIndex, wolfDecision!, par);

  validateZeroSum(result);
  return result;
}

// ---------------------------------------------------------------------------
// Skins hole (holes 1, 3) — individual skin payout only
// ---------------------------------------------------------------------------

function calcSkinsHole(
  netScores: readonly [number, number, number, number],
  par: number,
): HoleMoneyResult {
  const s = skinIndividual(netScores, par);
  return [
    player(0, s[0], 0, 0),
    player(0, s[1], 0, 0),
    player(0, s[2], 0, 0),
    player(0, s[3], 0, 0),
  ];
}

// ---------------------------------------------------------------------------
// Wolf hole dispatch
// ---------------------------------------------------------------------------

function calcWolfHole(
  netScores: readonly [number, number, number, number],
  wolfIdx: BattingPosition,
  wolfDecision: WolfDecision,
  par: 3 | 4 | 5,
): HoleMoneyResult {
  if (wolfDecision.type === 'partner') {
    return calc2v2(netScores, wolfIdx, wolfDecision.partnerBatterIndex, par);
  }
  return calc1v3(netScores, wolfIdx, wolfDecision.type === 'blind_wolf', par);
}

// ---------------------------------------------------------------------------
// 2v2 — three TEAM components (low ball, skin, team total)
// ---------------------------------------------------------------------------

function calc2v2(
  netScores: readonly [number, number, number, number],
  wolfIdx: BattingPosition,
  partnerIdx: BattingPosition,
  par: 3 | 4 | 5,
): HoleMoneyResult {
  const teamASet = new Set<BattingPosition>([wolfIdx, partnerIdx]);
  const teamA: [BattingPosition, BattingPosition] = [wolfIdx, partnerIdx];
  const teamBArr = ALL_POSITIONS.filter((i): i is BattingPosition => !teamASet.has(i));
  const b0 = teamBArr[0];
  const b1 = teamBArr[1];
  if (b0 === undefined || b1 === undefined) throw new Error('unreachable: invalid team config');
  const teamB: [BattingPosition, BattingPosition] = [b0, b1];

  // Low ball: team's best net score
  const lowA = Math.min(netScores[wolfIdx], netScores[partnerIdx]);
  const lowB = Math.min(netScores[b0], netScores[b1]);
  const lbResult = cmp(lowA, lowB);

  // Skin: team-based, follows low ball result, gated by net par
  const sk = skinTeam(netScores, par, lbResult, teamA, teamB);

  // Team total: combined net scores
  const totalA = netScores[wolfIdx] + netScores[partnerIdx];
  const totalB = netScores[b0] + netScores[b1];
  const ttResult = cmp(totalA, totalB);

  const lb: [number, number, number, number] = [0, 0, 0, 0];
  const tt: [number, number, number, number] = [0, 0, 0, 0];
  lb[wolfIdx] = lbResult; lb[partnerIdx] = lbResult;
  lb[b0] = -lbResult;     lb[b1] = -lbResult;
  tt[wolfIdx] = ttResult; tt[partnerIdx] = ttResult;
  tt[b0] = -ttResult;     tt[b1] = -ttResult;

  return [
    player(lb[0], sk[0], tt[0], 0),
    player(lb[1], sk[1], tt[1], 0),
    player(lb[2], sk[2], tt[2], 0),
    player(lb[3], sk[3], tt[3], 0),
  ];
}

// ---------------------------------------------------------------------------
// 1v3 lone wolf / blind wolf — three GROUP components + optional blind bonus
// ---------------------------------------------------------------------------

function calc1v3(
  netScores: readonly [number, number, number, number],
  wolfIdx: BattingPosition,
  isBlindWolf: boolean,
  par: 3 | 4 | 5,
): HoleMoneyResult {
  const oppArr = ALL_POSITIONS.filter((i): i is BattingPosition => i !== wolfIdx);
  const o0 = oppArr[0];
  const o1 = oppArr[1];
  const o2 = oppArr[2];
  if (o0 === undefined || o1 === undefined || o2 === undefined) {
    throw new Error('unreachable: invalid wolf config');
  }
  const opps: [BattingPosition, BattingPosition, BattingPosition] = [o0, o1, o2];

  // Low ball: wolf's net vs opponents' best net
  const wolfNet = netScores[wolfIdx];
  const oppBest = Math.min(netScores[o0], netScores[o1], netScores[o2]);
  const lbResult = cmp(wolfNet, oppBest);

  // Skin: group-based (wolf vs 3 opponents collectively), follows low ball result
  const sk = skinGroup(netScores, par, wolfIdx, opps, lbResult);

  // Bonus mirrors low ball
  const bonusResult = lbResult;

  // Blind wolf extra: wolf +3/opps -1 only if wolf WON low ball; $0 otherwise (no penalty on loss/tie)
  const bw: [number, number, number, number] = [0, 0, 0, 0];
  if (isBlindWolf && lbResult === 1) {
    bw[wolfIdx] = 3;
    bw[o0] = -1;
    bw[o1] = -1;
    bw[o2] = -1;
  }

  const lb: [number, number, number, number] = [0, 0, 0, 0];
  const bonus: [number, number, number, number] = [0, 0, 0, 0];
  lb[wolfIdx] = lbResult * 3;
  lb[o0] = -lbResult; lb[o1] = -lbResult; lb[o2] = -lbResult;
  bonus[wolfIdx] = bonusResult * 3;
  bonus[o0] = -bonusResult; bonus[o1] = -bonusResult; bonus[o2] = -bonusResult;

  return [
    player(lb[0], sk[0], bonus[0], bw[0]),
    player(lb[1], sk[1], bonus[1], bw[1]),
    player(lb[2], sk[2], bonus[2], bw[2]),
    player(lb[3], sk[3], bonus[3], bw[3]),
  ];
}
