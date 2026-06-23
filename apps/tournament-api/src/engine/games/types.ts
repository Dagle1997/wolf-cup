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
   * playerId -> GROSS strokes for this hole (Story 2.3). Optional: a reusable
   * per-player gross input for any SCORE-BASED modifier. (Story 2.3's polie
   * bogey-or-better gate originally read it; Story 2.4a removed that gate, so no
   * shipped modifier reads gross today — it is RETAINED for Story 2.5 gross/natural
   * birdie and any future gross-vs-par rule.) The base game + greenie + polie +
   * sandie all ignore gross, so attaching it is base-money-neutral. Sourced
   * DIRECTLY from the scorer's entered strokes by the service layer — never
   * reconstructed from net+handicap (net may be relative/off-the-low, which is not
   * invertible).
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
 * One settled hole's money decomposition (Story 3-3). Emitted for exactly the
 * holes whose `pts`/`pv` enter the cross accumulation (the same complete-cell
 * gate), so `Ledger.perHole` rows correspond 1:1 with what moves
 * `cross`/`perPlayerCents`. A settled PUSH hole (`teamPointsA === 0`) emits a
 * row with all-zero money (so a halved hole reads `$0`, distinct from an
 * unsettled hole, which emits NO row). Per-player loss-less:
 * `Σ_holes perPlayerCents[p] === Ledger.perPlayerCents[p]`.
 */
export type PerHoleMoney = {
  holeNumber: number;
  /** teamA-signed net points this hole (positive => team A won the hole). */
  teamPointsA: number;
  /** this hole's point value in cents (flat, or front/back-segmented). */
  pointValueCents: number;
  /**
   * ONE teamA player's signed per-hole cents (= teamPointsA * pointValueCents).
   * NOT the team total (which is 2× this). Named explicitly so a consumer can
   * never double-count a 2v2 team's swing.
   */
  teamASignedPerPlayerCents: number;
  /** playerId -> this hole's signed cents (zero-sum across the four players). */
  perPlayerCents: Record<string, number>;
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
  /**
   * Per-hole money decomposition (Story 3-3). OPTIONAL in the type only so
   * hand-built `Ledger` literals in unit tests (e.g. ledger-to-edges.test.ts,
   * which never reads it) stay terse — `computeFoursome` ALWAYS populates it
   * (one row per settled hole). Consumers that need it can read it directly.
   */
  perHole?: PerHoleMoney[];
};

/** SettlementEdge IR — mirrors engine/bets/types.ts; from PAYS to. */
export type SettlementEdge = {
  fromPlayerId: string;
  toPlayerId: string;
  cents: number;
  sourceType: 'f1_game';
  sourceId: string;
};
