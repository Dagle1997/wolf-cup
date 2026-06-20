# Codex Review

- Generated: 2026-06-20T15:09:04.372Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/api/src/services/bets.ts, apps/api/src/services/bets.settlement.integration.test.ts, apps/api/src/services/bets.settleup.integration.test.ts

## Summary

The three prior findings appear resolved in the implementation shown: (1) both getBetsBoard and getSeasonBetHistory now require winner/loser ids to be non-null and distinct, preventing the prior double-null (“House pays House”) case; (2) HOUSE_ID fallback is now explicitly restricted to betType === "odds_win"; (3) an integration test was added to cover player → House direction. Pairwise netting math for normal player-vs-player bets is unchanged (same low/high unordered pair keying and same signed net accumulation).

Overall risk: low

## Findings

1. [low] Settle-up integration test no longer asserts expected settleUp length after adding The House case
   - File: apps/api/src/services/bets.settleup.integration.test.ts:75-102
   - Confidence: high
   - Why it matters: The scenario now has 3 expected settle-up rows (Josh→Kyle, Kyle→Jaquint, Jaquint→The House). Removing the length assertion weakens regression detection: the test will still pass if extra/duplicate settle-up rows are produced (e.g., double-counting) as long as the expected rows exist.
   - Suggested fix: Restore strictness by asserting the exact expected length (likely 3 for this fixture) and/or asserting uniqueness (e.g., filter rows with toPlayerId === -1 and expect length 1).

## Strengths

- Guards in getBetsBoard and getSeasonBetHistory now require winnerId/loserId to be both present and distinct, eliminating the prior double-null (-1/-1) pair risk.
- HOUSE_ID fallback is correctly limited to odds_win only, matching the stated invariant that other bet types must have real counterparties.
- Name rendering for HOUSE_ID is handled in both settle-up (nameOrId) and season history (people.name), and the updated settlement integration test exercises the House→player path plus House season aggregation.

## Warnings

None.
