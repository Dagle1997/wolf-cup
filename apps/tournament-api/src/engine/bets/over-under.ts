/**
 * Over/Under settlement — pure (P1). Ports Wolf Cup's `over_under` bet
 * (apps/api/src/services/bets.ts) into the Action engine's SettlementEdge IR.
 *
 * ONE subject + a strokes LINE. The subject's total over the scoped holes is
 * compared to the line:
 *   - total <  line  → UNDER wins  (side A)
 *   - total >  line  → OVER wins   (side B)
 *   - total == line  → push (FR26; no money moves)
 * WINNER-TAKE-STAKE: the loser's stakeholder pays the winner's the full stake
 * once (same shape as h2h, NOT margin × stake — that's per_hole_match).
 *
 * Both bet sides carry the SAME subjectPlayerId (the one player the line is
 * on); side A backs UNDER, side B backs OVER. The money is between
 * STAKEHOLDERS, never the subject (the open-book invariant).
 *
 * Basis-agnostic: the query layer feeds net (netForSegment) or gross per-hole
 * values; the engine only sums them (P2). A missing line fails loud
 * (unsupported) so a malformed row never banks a silent $0/push.
 */

import type { H2hInput, SettlementEdge, SettlementOutcome } from './types.js';

const UNSUPPORTED: SettlementOutcome = {
  state: 'unsupported',
  subjectNetTotal: {},
  result: { winnerSide: null, winnerSubjectId: null, marginNet: 0 },
  edges: [],
};

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

export function settleOverUnder(input: H2hInput): SettlementOutcome {
  const { bet, netPerHoleBySubject } = input;
  const sideUnder = bet.sides.find((s) => s.side === 'A'); // backs UNDER
  const sideOver = bet.sides.find((s) => s.side === 'B'); // backs OVER
  const line = bet.line;

  // Fail loud (P6) — never settle a malformed row as a silent $0/push:
  //  - a missing side (a single bad row must not crash the whole board),
  //  - a missing line,
  //  - sides on DIFFERENT subjects (over_under is ONE subject on both sides;
  //    settling against just one side's subject would grade the wrong player).
  if (
    !sideUnder ||
    !sideOver ||
    line === undefined ||
    line === null ||
    sideUnder.subjectPlayerId !== sideOver.subjectPlayerId
  ) {
    return UNSUPPORTED;
  }

  // Both sides share the one subject the line is on.
  const subjectId = sideUnder.subjectPlayerId;
  const total = totalOverScope(netPerHoleBySubject[subjectId], bet.scopedHoles.length);
  const subjectNetTotal: Record<string, number> = {};
  if (total !== null) subjectNetTotal[subjectId] = total;

  // Not all scoped holes complete → provisional (FR25), never settle on partial.
  if (total === null) {
    return {
      state: 'provisional',
      subjectNetTotal,
      result: { winnerSide: null, winnerSubjectId: null, marginNet: 0 },
      edges: [],
    };
  }

  // On the line exactly → push (FR26).
  if (total === line) {
    return {
      state: 'push',
      subjectNetTotal,
      result: { winnerSide: null, winnerSubjectId: null, marginNet: 0 },
      edges: [],
    };
  }

  const winner = total < line ? sideUnder : sideOver;
  const loser = total < line ? sideOver : sideUnder;
  const marginNet = Math.abs(total - line);

  const edge: SettlementEdge = {
    fromPlayerId: loser.stakeholderPlayerId,
    toPlayerId: winner.stakeholderPlayerId,
    cents: bet.stakeCents,
    sourceBetId: bet.id,
    sourceType: 'over_under',
  };

  return {
    state: 'settled',
    subjectNetTotal,
    result: {
      winnerSide: winner.side,
      winnerSubjectId: subjectId,
      marginNet,
    },
    edges: [edge],
  };
}
