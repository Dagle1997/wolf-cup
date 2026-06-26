/**
 * "The Action" betting engine — dispatch by bet_type (PURE, P1).
 *
 * engine/bets/ owns ALL new-schema settlement math (P14); the shipped
 * individual_bets engine is never cross-wired in. An unknown type fails loud
 * (P6) — returns an `unsupported` outcome, NEVER a silent push/$0.
 *
 * Story 1.1 wired h2h; Story 1.2 adds per_hole_match. putting (4.2), segments
 * (4.1), and Snake (3.x) attach here as they are built.
 */

import { settleH2h } from './h2h.js';
import { settlePerHoleMatch } from './per-hole-match.js';
import { settleOverUnder } from './over-under.js';
import type { H2hInput, SettlementOutcome } from './types.js';

export type { SettlementEdge, SettlementOutcome, BetDef, H2hInput } from './types.js';
export { netPairwise, type PairwiseDebt } from './settlement-edge.js';
export { settleH2h } from './h2h.js';
export { settlePerHoleMatch } from './per-hole-match.js';
export { settleOverUnder } from './over-under.js';

const unsupported = (): SettlementOutcome => ({
  state: 'unsupported',
  subjectNetTotal: {},
  result: { winnerSide: null, winnerSubjectId: null, marginNet: 0 },
  edges: [],
});

/**
 * Dispatch a settlement by bet type. An unknown type — or an
 * invalid (type, basis) pair (e.g. per_hole_match on a putts basis, FR12) —
 * returns an `unsupported` outcome (fail-loud, P6) rather than settling
 * silently as a $0/push. Creation gates the same combinations upstream; this
 * is defense-in-depth so a bad row can never bank money.
 */
export function settleBet(input: H2hInput): SettlementOutcome {
  switch (input.bet.betType) {
    case 'h2h':
      return settleH2h(input);
    case 'per_hole_match':
      // Match play on a putts basis is meaningless (FR12) → fail loud.
      if (input.bet.basis === 'putts') return unsupported();
      return settlePerHoleMatch(input);
    case 'over_under':
      // Over/under grades a stroke total against a line — a putts basis is
      // meaningless here → fail loud (defense-in-depth; creation gates it too).
      if (input.bet.basis === 'putts') return unsupported();
      return settleOverUnder(input);
    default:
      return unsupported();
  }
}
