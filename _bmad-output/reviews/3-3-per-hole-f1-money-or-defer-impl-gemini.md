# Gemini Review

- Generated: 2026-06-23T15:57:45.420Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/games/types.ts, apps/tournament-api/src/engine/games/compute-foursome.ts, apps/tournament-api/src/services/games-money.ts, apps/tournament-api/src/services/scorecard.ts, apps/tournament-api/src/engine/games/perhole-money.golden.test.ts, apps/tournament-api/src/engine/games/compute-foursome.perhole.test.ts, apps/tournament-api/src/services/games-money.perhole.test.ts, apps/tournament-api/src/routes/scorecard.integration.test.ts, apps/tournament-api/src/engine/games/__fixtures__/perhole-money-base-flat.json, apps/tournament-api/src/engine/games/__fixtures__/perhole-money-greenie-carryover.json

## Summary

Implementation of per-hole F1 money on the scorecard is highly robust, logically complete, and excellently tested. All loss-less invariants hold, and the -0 normalization is accurate. A performance regression was identified where the read-heavy scorecard endpoint duplicates data fetching and performs a full foursome settlement on every poll, which should be optimized.

Overall risk: low

## Findings

1. [medium] Redundant foursome settlement and DB queries on read-heavy scorecard route
   - File: apps/tournament-api/src/services/scorecard.ts:187-199
   - Confidence: high
   - Why it matters: The live scorecard endpoint is polled frequently by users during play. Calling `computeF1PerHoleMoneyForPlayer` triggers a full engine settlement, performing ~10 additional queries (fetching the whole foursome's scores, claims, course holes, and pins) that largely duplicate the data already fetched by `buildPlayerScorecard` just above it. This multiplies database load significantly on a hot read path.
   - Suggested fix: Refactor the data loading so the route or builder loads the shared state (course holes, pins, foursome scores/claims) once, and passes it to both the scorecard line generator and the money settlement engine in a single pass.

## Strengths

- Perfect adherence to the 'loss-less' money invariant, proven comprehensively by golden fixtures.
- Fail-closed isolation is strictly maintained; missing pins or unpinned rounds return null seamlessly without crashing the scorecard.
- The normalization of `-0` for team B on push holes is elegant and precisely handles serialization quirks.
- Test coverage is exemplary, covering positive paths, edge cases (unlocked, flag off, missing pins), and structural proofs.

## Warnings

None.
