/**
 * Head-to-head settlement (FR11) — pure (P1).
 *
 * One subject's total vs another's over the scoped holes; LOWER total wins.
 * WINNER-TAKE-STAKE: the loser's stakeholder pays the winner's stakeholder the
 * full stake ONCE (not per-stroke, not margin x stake) — locked with Josh
 * 2026-06-20 against fixtures h2h-net-{a,b,c}. Level total = push (FR26).
 *
 * Basis-agnostic: net, gross, or putts-total all reduce to "sum the given
 * per-hole values, compare totals" — the engine NEVER re-derives the values
 * (P2); the query layer feeds net (netForSegment), gross, or putts. (Per-hole
 * match-play, FR12, is a DIFFERENT shape and lives in its own module.)
 *
 * The money is between STAKEHOLDERS, never subjects (FR8/FR10 — the open-book
 * "Kyle" case: a non-playing backer collects).
 */

import type { H2hInput, SettlementEdge, SettlementOutcome, BetSideDef } from './types.js';

function requireSide(sides: BetSideDef[], side: 'A' | 'B'): BetSideDef {
  const found = sides.find((s) => s.side === side);
  if (!found) throw new Error(`h2h bet missing side ${side}`);
  return found;
}

/**
 * Sum a subject's per-hole values over the scope. Returns null if the values
 * are missing or any scoped hole is not yet entered (null) — drives the
 * provisional state (FR25), never a settle on partial data.
 */
function totalOverScope(
  perHole: Array<number | null> | undefined,
  scopedHoleCount: number,
): number | null {
  if (!perHole || perHole.length !== scopedHoleCount) return null;
  let sum = 0;
  for (const v of perHole) {
    if (v === null || v === undefined) return null;
    sum += v;
  }
  return sum;
}

export function settleH2h(input: H2hInput): SettlementOutcome {
  const { bet, netPerHoleBySubject } = input;
  const sideA = requireSide(bet.sides, 'A');
  const sideB = requireSide(bet.sides, 'B');

  const scopedCount = bet.scopedHoles.length;
  const totalA = totalOverScope(netPerHoleBySubject[sideA.subjectPlayerId], scopedCount);
  const totalB = totalOverScope(netPerHoleBySubject[sideB.subjectPlayerId], scopedCount);

  const subjectNetTotal: Record<string, number> = {};
  if (totalA !== null) subjectNetTotal[sideA.subjectPlayerId] = totalA;
  if (totalB !== null) subjectNetTotal[sideB.subjectPlayerId] = totalB;

  // Not all scoped holes complete for both subjects → provisional (FR25).
  if (totalA === null || totalB === null) {
    return {
      state: 'provisional',
      subjectNetTotal,
      result: { winnerSide: null, winnerSubjectId: null, marginNet: 0 },
      edges: [],
    };
  }

  // Level total → push (FR26).
  if (totalA === totalB) {
    return {
      state: 'push',
      subjectNetTotal,
      result: { winnerSide: null, winnerSubjectId: null, marginNet: 0 },
      edges: [],
    };
  }

  // Lower total wins. Loser's stakeholder pays winner's stakeholder the stake.
  const winner = totalA < totalB ? sideA : sideB;
  const loser = totalA < totalB ? sideB : sideA;
  const marginNet = Math.abs(totalA - totalB);

  const edge: SettlementEdge = {
    fromPlayerId: loser.stakeholderPlayerId,
    toPlayerId: winner.stakeholderPlayerId,
    cents: bet.stakeCents,
    sourceBetId: bet.id,
    sourceType: 'h2h',
  };

  return {
    state: 'settled',
    subjectNetTotal,
    result: {
      winnerSide: winner.side,
      winnerSubjectId: winner.subjectPlayerId,
      marginNet,
    },
    edges: [edge],
  };
}
