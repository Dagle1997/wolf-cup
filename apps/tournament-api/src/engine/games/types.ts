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

/**
 * A modifier rides the base game. The variant carries each modifier's levers;
 * which keys are meaningful is modifier-specific (validateResolvedConfig enforces
 * a per-modifier allowlist, FR44):
 *  - net-skins (Story 1.1): `basis`/`bonus` (net/single supported; gross/double 2.5).
 *  - greenie (Story 2.2): `carryover` ONLY (carryover-on/off is the single greenie
 *    lever, FR2); `basis`/`bonus` on an enabled greenie fail closed.
 * All keys are optional so each modifier carries only its own lever (a greenie
 * variant is `{ carryover }`, never forced to also name basis/bonus).
 */
export type ModifierVariant = {
  basis?: 'net' | 'gross';
  bonus?: 'single' | 'double';
  carryover?: boolean;
  /**
   * polie (Story 2.3) ONLY lever — "Polie must be Bogey or Better" Y/N. When
   * true, a checked polie counts only if that player's GROSS ≤ par+1. Default
   * false = "polie on anything". Off-the-low net does NOT affect this (the gate
   * is on raw gross).
   */
  polieBogeyOrBetter?: boolean;
};
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

/**
 * Per-player claim flags for a hole (Story 2.1). A player may carry any subset
 * of greenie/polie/sandie. Story 2.1 only POPULATES this from the append-only
 * `hole_claim_writes` log at the service layer (latest-`set`-write-per-cell);
 * the resolvers that CONSUME it (greenie 2.2 / polie 2.3 / sandie 2.4) are out
 * of scope, so a populated claim is INERT until its resolver ships.
 */
export type HoleClaims = {
  greenie?: boolean;
  polie?: boolean;
  sandie?: boolean;
};

/** One hole's GIVEN inputs: course hole number, par, each player's net, gross, claims. */
export type HoleState = {
  holeNumber: number;
  par: number;
  /** playerId -> net strokes for this hole. */
  net: Record<string, number>;
  /**
   * playerId -> GROSS strokes for this hole (Story 2.3). Optional: only the polie
   * bogey-or-better gate reads it; the base game + greenie ignore gross entirely
   * (so attaching it is base-money-neutral). Sourced DIRECTLY from the scorer's
   * entered strokes by the service layer — never reconstructed from net+handicap
   * (net may be relative/off-the-low, which is not invertible). Absent gross under
   * an active gate voids the polie (fail-closed).
   */
  gross?: Record<string, number>;
  /**
   * playerId -> the player's current claim set for this hole. Optional: an
   * undefined `claims` (or an absent player key) means no claims. The pure
   * engine reads structurally only its own foursome's claims (FR23); the
   * service layer derives the value (the engine never reads the DB).
   */
  claims?: Record<string, HoleClaims>;
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
