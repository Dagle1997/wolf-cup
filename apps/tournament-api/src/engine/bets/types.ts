/**
 * "The Action" betting engine — shared types (engine/bets/).
 *
 * PURE domain: no DB, no Date.now(), no Math.random(), no I/O (P1). Net is a
 * GIVEN input — the engine NEVER re-derives it (P2); the leaderboard service
 * supplies net via netForSegment() and the query layer feeds it here.
 *
 * Every settlement source reduces to the SettlementEdge IR (P15).
 */

export type Side = 'A' | 'B';

/** Closed enum (CHECK-enforced in schema). */
export type HoleScope = 'front' | 'back' | 'total' | 'full18';

/**
 * Open enums (FR20 additive model) — validated in Zod at the boundary, NOT a
 * DB CHECK. The engine narrows the types it knows and fails loud (P6) on the
 * rest, so an unknown value never settles as a silent $0/push.
 */
export type BetType = 'h2h' | 'per_hole_match' | 'over_under' | 'putting';
export type Basis = 'net' | 'gross' | 'putts';

export type BetSideDef = {
  side: Side;
  /** Who has the money on this side (FR8 — may be a non-playing roster member, FR10). */
  stakeholderPlayerId: string;
  /** Whose play this side backs. */
  subjectPlayerId: string;
};

export type BetDef = {
  id: string;
  /** string (not BetType) so an unknown type reaches the fail-loud path (P6). */
  betType: string;
  basis: string;
  holeScope: HoleScope;
  stakeCents: number;
  /** Course hole numbers in this bet's scope (e.g. 1..18 for full18). */
  scopedHoles: number[];
  /**
   * over_under ONLY: the strokes line the subject's scoped total is graded
   * against (under = side A, over = side B). null/undefined for every other
   * bet type. A missing line on an over_under bet fails loud (unsupported).
   */
  line?: number | null;
  sides: BetSideDef[];
};

/**
 * Canonical settlement IR (P15). Direction: `fromPlayerId` PAYS `toPlayerId`
 * (debtor -> creditor), matching the project's "X -> Y $N" settle-up
 * convention. `cents` is always a positive integer.
 */
export type SettlementEdge = {
  fromPlayerId: string;
  toPlayerId: string;
  cents: number;
  sourceBetId: string;
  sourceType: string;
};

/**
 * Derived settlement state for a single bet (the recompute-on-read subset).
 * Durable lifecycle states (void / unsettleable / finalized) live on
 * bets.state in the DB and are not produced here.
 *   - settled:     graded; edges emitted.
 *   - push:        level; no money moves (FR26).
 *   - provisional: not all scoped holes complete yet → no edges (FR25).
 *   - unsupported: unknown bet type/basis (P6 fail-loud) → no edges.
 */
export type SettlementState = 'settled' | 'push' | 'provisional' | 'unsupported';

export type H2hResult = {
  winnerSide: Side | null;
  winnerSubjectId: string | null;
  /** Absolute net margin (stroke/putt count); 0 on push/provisional. */
  marginNet: number;
};

export type SettlementOutcome = {
  state: SettlementState;
  /** Each subject's total over the scoped holes (omitted entries when incomplete). */
  subjectNetTotal: Record<string, number>;
  result: H2hResult;
  edges: SettlementEdge[];
};

/**
 * Input for an h2h (total-comparison) settlement, any basis. `netPerHoleBySubject`
 * is keyed by subjectPlayerId; each array aligns 1:1 with `bet.scopedHoles` in
 * scoped order. A `null` entry means that hole's value is not yet entered
 * (architecture D5) -> the bet is provisional, never settled on partial data.
 */
export type H2hInput = {
  bet: BetDef;
  netPerHoleBySubject: Record<string, Array<number | null>>;
};
