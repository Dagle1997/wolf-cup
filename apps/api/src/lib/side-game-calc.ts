import { calcCourseHandicap, getCourseHole, getHandicapStrokes } from '@wolf-cup/engine';
import type { Tee } from '@wolf-cup/engine';

export interface ScoreRow {
  playerId: number;
  holeNumber: number;
  grossScore: number;
  putts: number | null;
}

export interface PlayerHandicap {
  playerId: number;
  handicapIndex: number;
}

export interface WolfDecisionRow {
  wolfPlayerId: number; // The wolf player — NOT the polie recipient (recipients are in bonusesJson)
  holeNumber: number;
  bonusesJson: string | null;
}

export interface SideGameResult {
  winnerPlayerIds: number[];
  detail: string;
}

// ---------------------------------------------------------------------------
// Pure calculation functions
// ---------------------------------------------------------------------------

/**
 * Most Net Pars: count holes where gross - strokes === par per player.
 * Uses FULL course handicap (not relative/play-off-the-low-man).
 */
export function calcMostNetPars(
  scores: ScoreRow[],
  handicaps: PlayerHandicap[],
  tee: Tee,
): SideGameResult {
  const hiMap = new Map(handicaps.map((h) => [h.playerId, h.handicapIndex]));
  const counts = new Map<number, number>();

  for (const s of scores) {
    const hi = hiMap.get(s.playerId) ?? 0;
    const ch = calcCourseHandicap(hi, tee);
    const hole = getCourseHole(s.holeNumber);
    const strokes = getHandicapStrokes(ch, hole.strokeIndex);
    const netScore = s.grossScore - strokes;
    if (netScore === hole.par) {
      counts.set(s.playerId, (counts.get(s.playerId) ?? 0) + 1);
    }
  }

  return pickWinners(counts, 'net pars', 'highest');
}

/**
 * Most Skins: for each hole, compute net score per player across ALL groups.
 * If exactly one player has the unique lowest net, they earn a skin.
 * Uses FULL course handicap.
 */
export function calcMostSkins(
  scores: ScoreRow[],
  handicaps: PlayerHandicap[],
  tee: Tee,
): SideGameResult {
  const hiMap = new Map(handicaps.map((h) => [h.playerId, h.handicapIndex]));

  // Build net scores per hole across all players
  const holeNets = new Map<number, { playerId: number; net: number }[]>();
  for (const s of scores) {
    const hi = hiMap.get(s.playerId) ?? 0;
    const ch = calcCourseHandicap(hi, tee);
    const hole = getCourseHole(s.holeNumber);
    const strokes = getHandicapStrokes(ch, hole.strokeIndex);
    const net = s.grossScore - strokes;
    if (!holeNets.has(s.holeNumber)) holeNets.set(s.holeNumber, []);
    holeNets.get(s.holeNumber)!.push({ playerId: s.playerId, net });
  }

  const skinCounts = new Map<number, number>();
  for (const [, entries] of holeNets) {
    const minNet = Math.min(...entries.map((e) => e.net));
    const winners = entries.filter((e) => e.net === minNet);
    if (winners.length === 1) {
      const wid = winners[0]!.playerId;
      skinCounts.set(wid, (skinCounts.get(wid) ?? 0) + 1);
    }
  }

  return pickWinners(skinCounts, 'skins', 'highest');
}

/**
 * Least Putts: sum putts per player. Lowest wins.
 */
export function calcLeastPutts(scores: ScoreRow[]): SideGameResult {
  const totals = new Map<number, number>();
  for (const s of scores) {
    if (s.putts === null || s.putts === undefined) continue;
    totals.set(s.playerId, (totals.get(s.playerId) ?? 0) + s.putts);
  }

  if (totals.size === 0) return { winnerPlayerIds: [], detail: 'No putts data' };

  return pickWinners(totals, 'putts', 'lowest');
}

/**
 * Most Net Under Par: count holes where gross - strokes < par per player.
 * Uses FULL course handicap.
 */
export function calcMostNetUnderPar(
  scores: ScoreRow[],
  handicaps: PlayerHandicap[],
  tee: Tee,
): SideGameResult {
  const hiMap = new Map(handicaps.map((h) => [h.playerId, h.handicapIndex]));
  const counts = new Map<number, number>();

  for (const s of scores) {
    const hi = hiMap.get(s.playerId) ?? 0;
    const ch = calcCourseHandicap(hi, tee);
    const hole = getCourseHole(s.holeNumber);
    const strokes = getHandicapStrokes(ch, hole.strokeIndex);
    const netScore = s.grossScore - strokes;
    if (netScore < hole.par) {
      counts.set(s.playerId, (counts.get(s.playerId) ?? 0) + 1);
    }
  }

  return pickWinners(counts, 'net under par', 'highest');
}

/**
 * Most Polies: count polies per player from bonusesJson across all wolf_decisions.
 * The player ID in bonusesJson.polies array is the RECIPIENT.
 */
export function calcMostPolies(wolfDecisions: WolfDecisionRow[]): SideGameResult {
  const counts = new Map<number, number>();

  for (const wd of wolfDecisions) {
    if (!wd.bonusesJson) continue;
    try {
      const bonuses = JSON.parse(wd.bonusesJson) as { polies?: number[] };
      if (Array.isArray(bonuses.polies)) {
        for (const recipientId of bonuses.polies) {
          counts.set(recipientId, (counts.get(recipientId) ?? 0) + 1);
        }
      }
    } catch { /* skip malformed */ }
  }

  return pickWinners(counts, 'polies', 'highest');
}

// ---------------------------------------------------------------------------
// Helper: pick winners from a count/total map
// ---------------------------------------------------------------------------

function pickWinners(
  values: Map<number, number>,
  unit: string,
  mode: 'highest' | 'lowest',
): SideGameResult {
  if (values.size === 0) return { winnerPlayerIds: [], detail: `0 ${unit}` };

  const nums = [...values.values()];
  const best = mode === 'highest' ? Math.max(...nums) : Math.min(...nums);

  // No-contest: if the winning count is zero, nobody earned the award
  if (best === 0 && mode === 'highest') {
    return { winnerPlayerIds: [], detail: `0 ${unit}` };
  }

  const winners = [...values.entries()]
    .filter(([, v]) => v === best)
    .map(([id]) => id);

  return { winnerPlayerIds: winners, detail: `${best} ${unit}` };
}
