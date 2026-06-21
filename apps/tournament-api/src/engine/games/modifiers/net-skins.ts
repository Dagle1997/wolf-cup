/**
 * net-skins modifier (Story 1.1) — replicates Wolf Cup bonuses.ts
 * detectBonusLevel/skinCount + competitiveScoreSkins NET path (READ-ONLY
 * reference, never imported). Winner-takes-all by best NET level; equal best
 * level = no blood. Story 1.1 scope: net basis, single bonus (the gross
 * natural-double bonus is Story 2.5).
 */
import type { HoleState } from '../types.js';

/** Net level vs par: birdie (par-1) => 1, eagle (par-2) => 2, double_eagle (par-3+) => 3, else 0. */
export function netLevel(net: number, par: number): number {
  const diff = par - net;
  if (diff >= 3) return 3;
  if (diff === 2) return 2;
  if (diff === 1) return 1;
  return 0;
}

/**
 * Net-skins bonus points to team A (positive) / team B (negative) on a hole.
 * Winner = team with the strictly higher best net level, awarded that many
 * points; equal best level => 0 (no blood).
 */
export function netSkinsPoints(
  hole: HoleState,
  teamA: readonly [string, string],
  teamB: readonly [string, string],
): number {
  const levelA = Math.max(
    netLevel(hole.net[teamA[0]]!, hole.par),
    netLevel(hole.net[teamA[1]]!, hole.par),
  );
  const levelB = Math.max(
    netLevel(hole.net[teamB[0]]!, hole.par),
    netLevel(hole.net[teamB[1]]!, hole.par),
  );
  if (levelA > levelB) return levelA;
  if (levelB > levelA) return -levelB;
  return 0;
}
