/**
 * guyan-2v2 — the standard Guyan 2v2 base game (Story 1.1).
 *
 * Replicates Wolf Cup money.ts calc2v2 (READ-ONLY reference, never imported)
 * with FIXED teams: three team points per hole — low ball, skin (gated NET <=
 * par), team total — each +1 to each winning-team player / -1 to each losing
 * player; plus the net-skins bonus (default on). All NET-derived (Story 1.1).
 */
import type { GameConfig, HoleState, PointValueSchedule } from '../types.js';
import { netSkinsPoints } from '../modifiers/net-skins.js';

/** Resolve the per-hole point value (flat, or front/back by course hole number). */
export function pointValueCents(schedule: PointValueSchedule, holeNumber: number): number {
  if (schedule.kind === 'flat') return schedule.cents;
  return holeNumber <= 9 ? schedule.frontCents : schedule.backCents;
}

/** Is the net-skins bonus active for this config? (enabled + net basis.) */
export function netSkinsActive(config: GameConfig): boolean {
  const m = config.modifiers.find((x) => x.type === 'net-skins');
  return !!m && m.enabled && (m.variant?.basis ?? 'net') === 'net';
}

/**
 * Net team points to team A on a hole (positive => A, negative => B): the sum
 * of the three base points (low ball, skin, team total) plus the net-skins
 * bonus. Each base point is +1/-1; the net-skins bonus can be +/-1..3.
 *
 * Callers MUST pass a complete hole (all four nets present).
 */
export function holeNetPointsA(
  hole: HoleState,
  teamA: readonly [string, string],
  teamB: readonly [string, string],
  config: GameConfig,
): number {
  const a0 = hole.net[teamA[0]]!;
  const a1 = hole.net[teamA[1]]!;
  const b0 = hole.net[teamB[0]]!;
  const b1 = hole.net[teamB[1]]!;

  const lowA = Math.min(a0, a1);
  const lowB = Math.min(b0, b1);

  // (1) Low ball — lower team-best net wins.
  const lb = lowA < lowB ? 1 : lowA > lowB ? -1 : 0;

  // (2) Skin — follows the low-ball winner, gated winning low ball NET <= par.
  let sk = 0;
  if (lb !== 0) {
    const winLow = lb === 1 ? lowA : lowB;
    if (winLow <= hole.par) sk = lb;
  }

  // (3) Team total — lower combined net wins.
  const totalA = a0 + a1;
  const totalB = b0 + b1;
  const tt = totalA < totalB ? 1 : totalA > totalB ? -1 : 0;

  // Net-skins bonus (on top), winner-takes-all by net level.
  const ns = netSkinsActive(config) ? netSkinsPoints(hole, teamA, teamB) : 0;

  return lb + sk + tt + ns;
}
