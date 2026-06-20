/**
 * Per-hole match-play settlement (FR12) — pure (P1).
 *
 * Each scoped hole is graded independently: the LOWER per-hole value wins that
 * hole (+1 to that side); an equal hole is a PUSH (contributes zero). The money
 * is (holesWonA − holesWonB) × stake — the stake is per hole of MARGIN, NOT
 * winner-take-stake like h2h (locked with Josh 2026-06-20 against fixtures
 * per-hole-match-{a,b,c}). A level match (equal holes won) is a push (FR26).
 *
 * Basis-agnostic: net or gross both reduce to "compare the given per-hole
 * values, count decisive holes" — the engine NEVER re-derives the values (P2);
 * the query layer feeds net (netForSegment net) or gross. PUTTS is invalid for
 * this type (FR12) and is rejected upstream (creation gate + dispatch), never
 * reaching this function.
 *
 * The money is between STAKEHOLDERS, never subjects (FR8/FR10 — the open book).
 *
 * Output reuses the shared SettlementOutcome shape (no spine change): for this
 * type `result.marginNet` is the HOLE margin and `subjectNetTotal` holds each
 * subject's HOLES WON (not a stroke total).
 */

import type { H2hInput, SettlementEdge, SettlementOutcome, BetSideDef } from './types.js';

function requireSide(sides: BetSideDef[], side: 'A' | 'B'): BetSideDef {
  const found = sides.find((s) => s.side === side);
  if (!found) throw new Error(`per_hole_match bet missing side ${side}`);
  return found;
}

export function settlePerHoleMatch(input: H2hInput): SettlementOutcome {
  const { bet, netPerHoleBySubject } = input;
  const sideA = requireSide(bet.sides, 'A');
  const sideB = requireSide(bet.sides, 'B');

  const scopedCount = bet.scopedHoles.length;
  const aVals = netPerHoleBySubject[sideA.subjectPlayerId];
  const bVals = netPerHoleBySubject[sideB.subjectPlayerId];

  const provisional: SettlementOutcome = {
    state: 'provisional',
    subjectNetTotal: {},
    result: { winnerSide: null, winnerSubjectId: null, marginNet: 0 },
    edges: [],
  };

  // Both subjects need a value on every scoped hole — a missing value (null or
  // a length mismatch) means the match isn't complete yet (FR25). No early
  // close-out in v1; grade only a fully-entered scope.
  if (!aVals || !bVals || aVals.length !== scopedCount || bVals.length !== scopedCount) {
    return provisional;
  }

  let holesA = 0;
  let holesB = 0;
  for (let i = 0; i < scopedCount; i++) {
    const a = aVals[i];
    const b = bVals[i];
    if (a === null || a === undefined || b === null || b === undefined) {
      return provisional;
    }
    if (a < b) holesA++;
    else if (b < a) holesB++;
    // equal → halved hole, contributes zero
  }

  const subjectNetTotal: Record<string, number> = {
    [sideA.subjectPlayerId]: holesA,
    [sideB.subjectPlayerId]: holesB,
  };

  const diff = holesA - holesB;

  // Level match → push (FR26).
  if (diff === 0) {
    return {
      state: 'push',
      subjectNetTotal,
      result: { winnerSide: null, winnerSubjectId: null, marginNet: 0 },
      edges: [],
    };
  }

  const winner = diff > 0 ? sideA : sideB;
  const loser = diff > 0 ? sideB : sideA;
  const margin = Math.abs(diff);

  const edge: SettlementEdge = {
    fromPlayerId: loser.stakeholderPlayerId,
    toPlayerId: winner.stakeholderPlayerId,
    cents: margin * bet.stakeCents,
    sourceBetId: bet.id,
    sourceType: 'per_hole_match',
  };

  return {
    state: 'settled',
    subjectNetTotal,
    result: {
      winnerSide: winner.side,
      winnerSubjectId: winner.subjectPlayerId,
      marginNet: margin,
    },
    edges: [edge],
  };
}
