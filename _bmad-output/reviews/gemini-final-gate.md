# Gemini Review

- Generated: 2026-06-23T03:02:31.126Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\Wolf-cup
- Reviewed files: apps/api/src/routes/stats.ts, apps/api/src/routes/standings.ts, apps/api/src/lib/sub-status.ts

## Summary

The `computeSeasonHighlights` function effectively resolves the prior 'Unknown' name bug by properly gating all highlight contributions to an active-member `eligible` set. The logic handles ties, handicaps, and edge cases safely without introducing new regressions. However, the exact same name-resolution bug remains unpatched in 'Step 10' of the `/stats` route, where league-wide partnership aggregations still process sub records against a member-only name map.

Overall risk: medium

## Findings

1. [medium] Incomplete regression fix: League-wide partnership stats still leak 'Unknown' for subs
   - File: apps/api/src/routes/stats.ts:697-721
   - Confidence: high
   - Why it matters: While `computeSeasonHighlights` was fixed, Step 10 evaluates league-wide partnerships by iterating unconditionally over `allPartnerDecisions`. It builds pairs in `pairMap` that include subs, but relies on `nameMapAll` (which only contains active members) to resolve names. Any pair involving a sub will have their name serialized as 'Unknown' in the final API payload, leaving the original UI data-leak regression partially unpatched.
   - Suggested fix: Apply the same member-only gating to Step 10 as you did for season highlights. Before mutating `pairMap`, verify that both players in the wolf pair (and both players in the opponent pair) exist in `nameMapAll` (e.g., `if (!nameMapAll.has(wolfId) || !nameMapAll.has(partnerId)) continue;`).

## Strengths

- The member-only guards introduced in `computeSeasonHighlights` are robust; skipping mixed eligible/ineligible pairs appropriately tracks performance strictly among active peers.
- Standings calculations use impeccable dense competition ranking logic and elegantly handle the concept of a sub's 'hypothetical rank' without cross-polluting full-member standings.
- Centralizing sub-status classification to read directly from `players.status` prevents complex per-round snapshot edge cases and guarantees UI consistency.

## Warnings

- Truncated file content for review: apps/api/src/routes/stats.ts
