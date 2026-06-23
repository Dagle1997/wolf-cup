/**
 * Tournament scorecard hole type — the Pete Dye SUBSET of the Wolf Cup
 * `ScorecardHole` (apps/web/src/routes/index.tsx L80-97).
 *
 * Provenance: hand-ported under the FD-1/FD-2 monorepo boundary. The Wolf
 * type is a READ-ONLY pattern reference; this is NOT an import / re-export of
 * it — Tournament never depends on apps/web/** at runtime. The Stableford /
 * Harvey / Wolf-decision fields (`stablefordPoints`, `wolfRole`,
 * `wolfDecision`, `wolfPlayerName`, `partnerPlayerName`, `teammateName`) are
 * intentionally DROPPED: Pete Dye doesn't use those formats.
 *
 * Money nullability (diverges from Wolf's non-nullable `moneyNet`):
 *   `moneyNet` is `number | null` so "money not supplied" is structurally
 *   representable and the component can never fabricate a value.
 *     - `null` = money unknown / not-yet-computed (the 3-3 API seam). A played
 *       hole with `moneyNet === null` renders `—` (em-dash), never `0`/`$0`.
 *     - `0`    = a legitimate even-money result, renders `0`.
 *   Section totals (Out/In/Tot) sum only non-null `moneyNet` of played holes;
 *   a section with zero non-null contributions renders `—` (an empty sum is
 *   "unknown", never `0`). See story 3-1 AC #6.
 */
export type ScorecardHole = {
  holeNumber: number;
  par: number;
  /** null = hole not yet played. HoleBadge is rendered only when non-null. */
  grossScore: number | null;
  /** netScore = grossScore - (relativeStrokes || 0) on played holes; null when unplayed. */
  netScore: number | null;
  /** null = money unknown / not-yet-computed (renders `—`); 0 = even money (renders `0`). */
  moneyNet: number | null;
  hasGreenie?: boolean;
  hasPolie?: boolean;
  hasSandie?: boolean;
  /** handicap strokes received on this hole; drives the top-right stroke dot(s). */
  relativeStrokes?: number;
};
