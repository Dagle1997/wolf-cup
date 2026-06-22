# Gemini Review

- Generated: 2026-06-22T00:07:04.117Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/leaderboard.ts, apps/tournament-api/src/services/money-detail.ts, apps/tournament-api/src/services/games-money.disjointness.test.ts

## Summary

The F1 money-critical settlement fixes successfully wrap stroke allocations in fail-closed try/catch blocks, resolving the 500 crashes associated with corrupt pinned course handicaps (non-integers). The read endpoints elegantly route F1 vs. legacy logic to prevent double-counting and dual-reads. However, an inconsistency exists in the leaderboard where F1 net correctly filters out stray hole scores beyond `holesToPlay`, but the gross total does not, which will skew the UI display and stroke-play rankings.

Overall risk: low

## Findings

1. [medium] F1 Leaderboard gross and throughHole incorrectly include stray out-of-play holes
   - File: apps/tournament-api/src/services/leaderboard.ts:305-309
   - Confidence: high
   - Why it matters: While the PR successfully restricts the F1 net calculation to `holesToPlay` (e.g. counting only the front 9 for a 9-hole round), `accum.totalGross` and `accum.totalThroughHole` still unconditionally accumulate all `hole_scores`. If a user accidentally enters a stray score for an out-of-play hole, their gross score and hole count will erroneously increase on the UI, while their net score does not. Since the leaderboard strictly ranks by gross score, this unfiltered data will also artificially lower their rank.
   - Suggested fix: Filter `holeRows` by `holesToPlay` (e.g., by joining `eventRounds` to get `holesToPlay` when selecting `hole_scores`) before accumulating `totalGross` and `totalThroughHole`, or adjust the F1 net loop to simultaneously compute a filtered gross score so that gross and net perfectly align.

## Strengths

- The fail-closed strategy is meticulously executed. Wrapping the F1 allocation logic in try/catch blocks correctly safeguards against bad payload states crashing the entire event.
- Dual-read isolation is perfectly implemented in `computeFoursomeResults` and `computeMyMoney`, safely gating F1 data via locked state and correctly omitting legacy calculations.
- Comprehensive test coverage added to actively enforce disjointness rules and ensure system resilience against corrupt pins.

## Warnings

- Truncated file content for review: apps/tournament-api/src/services/money-detail.ts
- Truncated file content for review: apps/tournament-api/src/services/games-money.disjointness.test.ts
