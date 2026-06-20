/**
 * "The Action" betting engine — dispatch by bet_type (PURE, P1).
 *
 * engine/bets/ owns ALL new-schema settlement math (P14); the shipped
 * individual_bets engine is never cross-wired in. An unknown type fails loud
 * (P6) — returns an `unsupported` outcome, NEVER a silent push/$0.
 *
 * Story 1.1 wires h2h only. per_hole_match (1.2), putting (4.2), segments
 * (4.1), and Snake (3.x) attach here as they are built.
 */

import { settleH2h } from './h2h.js';
import type { H2hInput, SettlementOutcome } from './types.js';

export type { SettlementEdge, SettlementOutcome, BetDef, H2hInput } from './types.js';
export { netPairwise, type PairwiseDebt } from './settlement-edge.js';
export { settleH2h } from './h2h.js';

/**
 * Dispatch a settlement by bet type. For now only 'h2h' is implemented; any
 * other type returns an `unsupported` outcome (fail-loud, P6) rather than
 * settling silently.
 */
export function settleBet(input: H2hInput): SettlementOutcome {
  switch (input.bet.betType) {
    case 'h2h':
      return settleH2h(input);
    default:
      return {
        state: 'unsupported',
        subjectNetTotal: {},
        result: { winnerSide: null, winnerSubjectId: null, marginNet: 0 },
        edges: [],
      };
  }
}
