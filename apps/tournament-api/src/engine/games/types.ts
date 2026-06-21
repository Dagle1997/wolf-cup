/**
 * F1 "Rules & Games" — pure engine types (Story 1.1).
 *
 * The engine REPLICATES Wolf Cup's money model (packages/engine/src/money.ts
 * calc2v2 + bonuses.ts apply2v2) for a FIXED 2v2 team game, adapted to the
 * Tournament app. It is a pure function family: no db, no Date, no random —
 * callers pass net scores / par / team split / config in, settlement edges
 * come out. The engine consumes per-player NET as a GIVEN (gross->net
 * allocation is the Story 1.4 service layer).
 *
 * Money is INTEGER CENTS throughout. SettlementEdge direction: fromPlayerId
 * PAYS toPlayerId.
 */

/** Per-hole point value. Flat all round, or front/back segmented (by course hole number). */
export type PointValueSchedule =
  | { kind: 'flat'; cents: number }
  | { kind: 'front-back'; frontCents: number; backCents: number };

/** A modifier rides the base game (Story 1.1: only 'net-skins'). */
export type ModifierVariant = { basis: 'net' | 'gross'; bonus: 'single' | 'double' };
export type Modifier = { type: string; enabled: boolean; variant?: ModifierVariant };

/** The resolved game configuration the engine settles from. */
export type GameConfig = {
  scope?: string | undefined;
  /** Base game id. Story 1.1 supports only 'guyan-2v2'. */
  game: string;
  pointValueSchedule: PointValueSchedule;
  modifiers: Modifier[];
  cap?: number | null | undefined;
  lockState?: 'locked' | 'unlocked' | undefined;
  configVersion: number;
};

/** The two fixed teams in a foursome (slots 1&2 vs 3&4 — fed by Story 1.4's resolveFoursomeTeams). */
export type TeamSplit = { teamA: readonly [string, string]; teamB: readonly [string, string] };

/** One hole's GIVEN inputs: course hole number, par, and each player's net. */
export type HoleState = {
  holeNumber: number;
  par: number;
  /** playerId -> net strokes for this hole. */
  net: Record<string, number>;
};

/** A foursome's full input to the engine. */
export type FoursomeInput = {
  teamSplit: TeamSplit;
  holes: readonly HoleState[];
};

/**
 * The settled foursome ledger. Money is held as a cross-team pairwise matrix
 * (the Wolf Cup money.ts shape): cross[aPlayerId][bPlayerId] = net cents the
 * A player is UP on the B player (positive => B owes A). Within-team pairs are
 * never recorded (2v2 teammates never owe each other). Also exposes the
 * per-player net for convenience/asserting.
 */
export type Ledger = {
  /** cross[aId][bId] = signed cents, positive => bId owes aId. */
  cross: Record<string, Record<string, number>>;
  /** playerId -> net cents (zero-sum across the four players). */
  perPlayerCents: Record<string, number>;
  /** sum of |edge| cents (== sum of positive cross cells). */
  totalCents: number;
};

/** SettlementEdge IR — mirrors engine/bets/types.ts; from PAYS to. */
export type SettlementEdge = {
  fromPlayerId: string;
  toPlayerId: string;
  cents: number;
  sourceType: 'f1_game';
  sourceId: string;
};
