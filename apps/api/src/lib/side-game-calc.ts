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

export interface SkinHolder {
  playerId: number;
  skins: number;
}

export interface SideGameResult {
  winnerPlayerIds: number[];
  detail: string;
  // Populated only by calcMostSkins. Skins is a list-display game now —
  // there is no single "winner," so winnerPlayerIds is always [] for skins
  // and the leaderboard renders this list directly.
  skinHolders?: SkinHolder[];
}

// ---------------------------------------------------------------------------
// Pure calculation functions
//
// All functions accept an optional `eligible` set. ALL players' scores
// participate in the computation (subs can block skins, etc.), but only
// eligible players can WIN. When omitted, all players are eligible.
// ---------------------------------------------------------------------------

/**
 * Most Net Pars: count holes where gross - strokes === par per player.
 * Uses FULL course handicap (not relative/play-off-the-low-man).
 */
export function calcMostNetPars(
  scores: ScoreRow[],
  handicaps: PlayerHandicap[],
  tee: Tee,
  eligible?: Set<number>,
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

  return pickWinners(counts, 'net pars', 'highest', eligible);
}

/**
 * Skins: for each hole, compute net score per player across ALL groups.
 * If exactly one player has the unique lowest net, they earn a skin.
 *
 * Subs participate in the field (their unique low blocks a hole's skin) but
 * cannot earn skins themselves. Returns the full list of skin-holders for
 * leaderboard display — there is no single "winner." Uses FULL course
 * handicap. winnerPlayerIds is intentionally empty: skins does not feed the
 * Side Game Champion trophy track.
 *
 * Per-hole completeness gate: when `fieldPlayerIds` is provided, a hole is
 * only counted if every player in the field has a score for it. This
 * prevents cross-group lag during live play from showing a transient
 * "unique low" before the rest of the field has posted (e.g., group 1
 * birdies hole 1 while groups 2-3 are still on hole 18 from a shotgun).
 * When omitted, every hole with any scores is counted (post-finalization
 * use, or unit tests that don't care about live partial state).
 */
export function calcMostSkins(
  scores: ScoreRow[],
  handicaps: PlayerHandicap[],
  tee: Tee,
  eligible?: Set<number>,
  fieldPlayerIds?: Set<number>,
): SideGameResult {
  const hiMap = new Map(handicaps.map((h) => [h.playerId, h.handicapIndex]));

  // Build net scores per hole across all players (including subs)
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

  // Count skins — unique low across the ENTIRE field (subs included).
  // If a sub has the unique low, that hole's skin is "blocked" — nobody gets it.
  // Only eligible players accumulate skin counts.
  const skinCounts = new Map<number, number>();
  for (const [, entries] of holeNets) {
    // Per-hole completeness gate: skip holes the field hasn't fully posted.
    if (fieldPlayerIds) {
      const scoredIds = new Set(entries.map((e) => e.playerId));
      let complete = true;
      for (const pid of fieldPlayerIds) {
        if (!scoredIds.has(pid)) { complete = false; break; }
      }
      if (!complete) continue;
    }
    const minNet = Math.min(...entries.map((e) => e.net));
    const winners = entries.filter((e) => e.net === minNet);
    if (winners.length === 1) {
      const wid = winners[0]!.playerId;
      if (!eligible || eligible.has(wid)) {
        skinCounts.set(wid, (skinCounts.get(wid) ?? 0) + 1);
      }
    }
  }

  const skinHolders: SkinHolder[] = [...skinCounts.entries()]
    .map(([playerId, skins]) => ({ playerId, skins }))
    .sort((a, b) => b.skins - a.skins || a.playerId - b.playerId);

  const totalSkins = skinHolders.reduce((acc, h) => acc + h.skins, 0);

  return {
    winnerPlayerIds: [],
    detail: `${totalSkins} skin${totalSkins === 1 ? '' : 's'}`,
    skinHolders,
  };
}

/**
 * Least Putts: sum putts per player. Lowest wins.
 */
export function calcLeastPutts(
  scores: ScoreRow[],
  eligible?: Set<number>,
): SideGameResult {
  const totals = new Map<number, number>();
  for (const s of scores) {
    if (s.putts === null || s.putts === undefined) continue;
    totals.set(s.playerId, (totals.get(s.playerId) ?? 0) + s.putts);
  }

  if (totals.size === 0) return { winnerPlayerIds: [], detail: 'No putts data' };

  return pickWinners(totals, 'putts', 'lowest', eligible);
}

/**
 * Most Net Under Par: count holes where gross - strokes < par per player.
 * Uses FULL course handicap.
 */
export function calcMostNetUnderPar(
  scores: ScoreRow[],
  handicaps: PlayerHandicap[],
  tee: Tee,
  eligible?: Set<number>,
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

  return pickWinners(counts, 'net under par', 'highest', eligible);
}

/**
 * Most Polies: count polies per player from bonusesJson across all wolf_decisions.
 * The player ID in bonusesJson.polies array is the RECIPIENT.
 */
export function calcMostPolies(
  wolfDecisions: WolfDecisionRow[],
  eligible?: Set<number>,
): SideGameResult {
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

  return pickWinners(counts, 'polies', 'highest', eligible);
}

// ---------------------------------------------------------------------------
// Helper: pick winners from a count/total map
//
// When `eligible` is provided, only those player IDs can win. The "best"
// value is computed only among eligible players. This means a sub with a
// higher count is skipped — the best eligible player wins.
// ---------------------------------------------------------------------------

function pickWinners(
  values: Map<number, number>,
  unit: string,
  mode: 'highest' | 'lowest',
  eligible?: Set<number>,
): SideGameResult {
  // Filter to eligible players if set is provided
  const candidates = eligible
    ? new Map([...values.entries()].filter(([id]) => eligible.has(id)))
    : values;

  if (candidates.size === 0) return { winnerPlayerIds: [], detail: `0 ${unit}` };

  const nums = [...candidates.values()];
  const best = mode === 'highest' ? Math.max(...nums) : Math.min(...nums);

  // No-contest: if the winning count is zero, nobody earned the award
  if (best === 0 && mode === 'highest') {
    return { winnerPlayerIds: [], detail: `0 ${unit}` };
  }

  const winners = [...candidates.entries()]
    .filter(([, v]) => v === best)
    .map(([id]) => id);

  return { winnerPlayerIds: winners, detail: `${best} ${unit}` };
}
