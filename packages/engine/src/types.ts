// Wolf Cup — Engine Domain Types

/** Valid hole numbers at Guyan G&CC */
export type HoleNumber = 1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18;

/** Position in the ball draw batting order (0 = first drawn, 3 = last drawn) */
export type BattingPosition = 0 | 1 | 2 | 3;

/** Four player IDs in batting draw order — generic to decouple engine from DB layer */
export type BattingOrder<TPlayerId = string> = [TPlayerId, TPlayerId, TPlayerId, TPlayerId];

/** Holes 1–2 are skins holes */
export type SkinsHoleAssignment = { readonly type: 'skins' };

/** Holes 3–18: one batter is wolf */
export type WolfHoleAssignment = {
  readonly type: 'wolf';
  /** Index into BattingOrder that identifies the wolf player this hole */
  readonly wolfBatterIndex: BattingPosition;
};

/** Combined hole assignment type */
export type HoleAssignment = SkinsHoleAssignment | WolfHoleAssignment;

/** Tee yardages available at Guyan G&CC */
export type TeeYardages = {
  readonly blue: number;
  readonly white: number;
  readonly gold: number;
  readonly red: number;
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
