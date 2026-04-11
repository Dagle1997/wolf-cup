// Wolf Cup — Engine Domain Types

/** Valid hole numbers at Guyan G&CC */
export type HoleNumber = 1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18;

/** Position in the ball draw batting order (0 = first drawn, 3 = last drawn) */
export type BattingPosition = 0 | 1 | 2 | 3;

/** Four player IDs in batting draw order — generic to decouple engine from DB layer */
export type BattingOrder<TPlayerId = string> = [TPlayerId, TPlayerId, TPlayerId, TPlayerId];

/** Holes 1 and 3 are skins holes */
export type SkinsHoleAssignment = { readonly type: 'skins' };

/** Holes 3–18: one batter is wolf */
export type WolfHoleAssignment = {
  readonly type: 'wolf';
  /** Index into BattingOrder that identifies the wolf player this hole */
  readonly wolfBatterIndex: BattingPosition;
};

/** Combined hole assignment type */
export type HoleAssignment = SkinsHoleAssignment | WolfHoleAssignment;

/** Tee yardages available at Guyan G&CC (Wolf Cup rotation: black → blue → white) */
export type TeeYardages = {
  readonly black: number;
  readonly blue: number;
  readonly white: number;
};

/** Full data for one hole at Guyan G&CC */
export type CourseHole = {
  readonly hole: HoleNumber;
  readonly par: 3 | 4 | 5;
  /** Handicap stroke index: 1 = hardest, 18 = easiest */
  readonly strokeIndex: number;
  readonly yardages: TeeYardages;
};

/** Thrown when an invalid hole number is provided */
export class InvalidHoleError extends Error {
  constructor(public readonly holeNumber: number) {
    super(`Invalid hole number: ${holeNumber}. Must be 1–18.`);
    this.name = 'InvalidHoleError';
  }
}

// ---------------------------------------------------------------------------
// Wolf Money Engine types (Story 1.4+)
// ---------------------------------------------------------------------------

/** The wolf's decision on a wolf hole */
export type WolfDecision =
  | { readonly type: 'partner'; readonly partnerBatterIndex: BattingPosition }
  | { readonly type: 'alone' }
  | { readonly type: 'blind_wolf' };

/**
 * Per-player money result for a single hole.
 * All amounts are integers (dollars): positive = won, negative = lost.
 */
export type PlayerHoleMoneyResult = {
  /** 2v2: team low-ball component; 1v3: wolf vs opponents' best ball; skins hole: 0 */
  readonly lowBall: number;
  /** Skin component — team-based in 2v2, group-based in 1v3, individual on skins holes */
  readonly skin: number;
  /** Team total (2v2) | bonus point that mirrors low ball (1v3) | 0 on skins holes */
  readonly teamTotalOrBonus: number;
  /** Blind wolf extra component — 0 unless blind_wolf called AND wolf wins low ball */
  readonly blindWolf: number;
  /** Birdie/eagle/double-eagle/greenie/polie bonus skins — 0 if no bonus events on this hole */
  readonly bonusSkins: number;
  /** Sum of all five components above */
  readonly total: number;
};

/** Full hole money result for all 4 players, indexed by batting position 0–3 */
export type HoleMoneyResult = readonly [
  PlayerHoleMoneyResult,
  PlayerHoleMoneyResult,
  PlayerHoleMoneyResult,
  PlayerHoleMoneyResult,
];

/** Bonus level auto-detected from net score vs par */
export type BonusLevel = 'birdie' | 'eagle' | 'double_eagle';

/**
 * Scorer-recorded bonus events for a single hole.
 * Birdie/eagle/double-eagle are auto-detected from net scores — not needed here.
 */
export type BonusInput = {
  /** Batting positions credited with a valid greenie (par-3 only; scorer-determined closest validated player) */
  readonly greenies: readonly BattingPosition[];
  /** Batting positions credited with a valid polie (first putt >flagstick length, or chip-in from off green) */
  readonly polies: readonly BattingPosition[];
};

/** Thrown when a money result violates the zero-sum constraint */
export class ZeroSumViolationError extends Error {
  constructor(
    public readonly component: 'lowBall' | 'skin' | 'teamTotalOrBonus' | 'blindWolf' | 'bonusSkins' | 'total',
    public readonly sum: number,
  ) {
    super(`Zero-sum violation on '${component}' component: sum=${sum}`);
    this.name = 'ZeroSumViolationError';
  }
}

// ---------------------------------------------------------------------------
// Harvey Cup Points types (Story 1.6+)
// ---------------------------------------------------------------------------

/** Round classification for Harvey Cup point calculation */
export type RoundType = 'regular' | 'playoff_r8' | 'playoff_r4';

/** A player's season Harvey Cup totals after applying best-10-of-N drops to regular rounds */
export type HarveySeasonTotal = {
  /** Total Harvey points for Stableford category (best-10 regular + all playoff) */
  readonly stableford: number;
  /** Total Harvey points for money category (best-10 regular + all playoff) */
  readonly money: number;
  /** Number of regular-season rounds played (before drops; excludes playoff rounds) */
  readonly roundsPlayed: number;
  /** Number of regular-season rounds excluded (lowest scores dropped) */
  readonly roundsDropped: number;
};

/** One player's round totals fed into Harvey Cup calculation */
export type HarveyRoundInput = {
  /** Player's total Stableford points for the round */
  readonly stableford: number;
  /** Player's net money balance for the round (whole dollars; negative = net loss) */
  readonly money: number;
};

/** Harvey Cup points awarded to one player from a single round */
export type HarveyRoundResult = {
  /** Harvey points for Stableford rank — may be x.5 for tie splits */
  readonly stablefordPoints: number;
  /** Harvey points for money rank — may be x.5 for tie splits */
  readonly moneyPoints: number;
};

/** Input for sandbagger detection — one round of data */
export interface SandbaggerRoundInput {
  readonly gross18: number;       // Sum of 18 hole gross scores
  readonly courseRating: number;   // From TEE_RATINGS[tee].courseRating
  readonly slopeRating: number;    // From TEE_RATINGS[tee].slopeRating
  readonly handicapIndex: number;  // Snapshot from roundPlayers
}

/** Sandbagger detection result */
export interface SandbaggerResult {
  readonly beatsCount: number;    // Rounds where differential < HI
  readonly totalRounds: number;
  readonly ratio: number;         // beatsCount / totalRounds (0 if no rounds)
  readonly tier: 0 | 1 | 2 | 3;
}

/** Thrown when Harvey Cup point totals violate the expected sum invariant */
export class HarveySumViolationError extends Error {
  constructor(
    public readonly category: 'stableford' | 'money',
    public readonly actualSum: number,
    public readonly expectedSum: number,
  ) {
    super(
      `Harvey Cup sum violation in '${category}' category: expected ${expectedSum}, got ${actualSum}`,
    );
    this.name = 'HarveySumViolationError';
  }
}
