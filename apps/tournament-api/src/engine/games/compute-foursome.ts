/**
 * computeFoursome (Story 1.1) — pure: settles one foursome's 2v2 Guyan game
 * from net scores + config into a cross-team pairwise cents ledger.
 *
 * Reads structurally only its own foursome's config + inputs (FR23 isolation).
 * Order-independent: holes are sorted by holeNumber before accumulation, so the
 * result is invariant to input ordering (NFR-C6). Money is integer cents.
 */
import type { FoursomeInput, GameConfig, Ledger } from './types.js';
import { holeNetPointsA, pointValueCents } from './games/guyan-2v2.js';
import { validateResolvedConfig } from './registry.js';

export function computeFoursome(config: GameConfig, input: FoursomeInput): Ledger {
  // Fail closed by construction: never settle an unsupported/invalid config
  // (unknown game/modifier, enabled gross/double net-skins variant, odd or
  // non-positive point value, duplicate modifier, bad config_version). The
  // production path resolves via resolveConfig (which also validates); this
  // guard protects any direct caller from silently computing wrong money.
  const v = validateResolvedConfig(config);
  if (!v.ok) throw new Error(`unsettleable config: ${v.reason}`);

  const { teamA, teamB } = input.teamSplit;

  // Cross-team matrix: cross[aId][bId] = signed cents, positive => bId owes aId.
  const cross: Record<string, Record<string, number>> = {};
  for (const a of teamA) {
    cross[a] = {};
    for (const b of teamB) cross[a]![b] = 0;
  }

  // Deterministic order (NFR-C6): never depend on input/insertion order.
  const holes = [...input.holes].sort((x, y) => x.holeNumber - y.holeNumber);

  // Fail closed on duplicate hole numbers — otherwise a hole would be
  // double-counted. Hole numbers are unique per round (input precondition).
  const seenHoles = new Set<number>();
  for (const h of holes) {
    if (seenHoles.has(h.holeNumber)) {
      throw new Error(`duplicate holeNumber ${h.holeNumber} in foursome input`);
    }
    seenHoles.add(h.holeNumber);
  }

  const members = [teamA[0], teamA[1], teamB[0], teamB[1]];
  for (const hole of holes) {
    // Complete-cell gate (INTENTIONAL, matches Wolf Cup best-ball-2v2 + the
    // recompute-on-read model): a hole missing any member's net is not yet
    // scorable, so it contributes no money. An in-progress round settles only
    // its complete holes; partial holes are skipped, never half-settled.
    if (members.some((p) => hole.net[p] === undefined)) continue;

    const pts = holeNetPointsA(hole, teamA, teamB, config);
    if (pts === 0) continue;

    const pv = pointValueCents(config.pointValueSchedule, hole.holeNumber);
    if (pv % 2 !== 0) {
      throw new Error(`pointValueCents must be even (whole-dollar) for the 2v2 split; got ${pv}`);
    }
    // Each of the 4 cross-team pairs moves pts * (pv/2) toward team A, so each
    // A player nets pts*pv (two pairs) and each B player -pts*pv — the Wolf Cup
    // +N/-N per-player point model, expressed pairwise.
    const half = pts * (pv / 2);
    for (const a of teamA) {
      for (const b of teamB) cross[a]![b]! += half;
    }
  }

  // Derive per-player net + total.
  const perPlayerCents: Record<string, number> = {};
  for (const p of members) perPlayerCents[p] = 0;
  let totalCents = 0;
  for (const a of teamA) {
    for (const b of teamB) {
      const v = cross[a]![b]!;
      perPlayerCents[a]! += v;
      perPlayerCents[b]! -= v;
      totalCents += Math.abs(v);
    }
  }

  return { cross, perPlayerCents, totalCents };
}
