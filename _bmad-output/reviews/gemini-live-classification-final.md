# Gemini Review

- Generated: 2026-06-23T02:56:13.936Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\Wolf-cup
- Reviewed files: apps/api/src/lib/sub-status.ts, apps/api/src/routes/standings.ts, apps/api/src/routes/stats.ts

## Summary

The standings redesign correctly implements a single, live source of truth for sub status, fixing the issue of subs displaying as full members. It safely defaults missing statuses to 'sub' and appropriately isolates sub hypothetical ranks. However, there is a regression in `stats.ts`: the strict gating of `allPlayers` causes subs and inactive players who earn league-wide highlights to display as 'Unknown'.

Overall risk: medium

## Findings

1. [high] Subs and inactive players will display as 'Unknown' in league-wide stats/highlights
   - File: apps/api/src/routes/stats.ts:404-408
   - Confidence: high
   - Why it matters: The `allPlayers` query is strictly filtered to only include active full members in order to gate the individual stats cards. However, this same filtered array is used to build the global name lookup maps (`playerNameById` inside `computeSeasonHighlights` and `nameMapAll` for best partnerships). If a sub (who is omitted from `allPlayers`) achieves a season highlight like 'lowest net round' or tops a leaderboard, their ID won't be found in the map, causing the UI to render their name as 'Unknown'.
   - Suggested fix: Fetch all non-guest players (or simply all players) from the database to populate the name lookup maps so highlight labels resolve correctly. Then, use an in-memory `.filter()` to restrict the list strictly to `status === 'active' && isActive === 1 && isGuest === 0` when generating the individual `playerStats` response array.

## Strengths

- Elegant simplification of sub classification by relying on a single, live source of truth (`players.status`).
- Safely handles edge cases like missing players or null statuses by defaulting them gracefully to 'sub' instead of crashing or wrongly slotting them into the main standings.
- Appropriately isolates hypothetical rank logic for subs so their performance doesn't interfere with full-member rank calculations.
- Handles tiebreakers and top-8 playoff eligibility securely across multiple dense rank scenarios.

## Warnings

- Truncated file content for review: apps/api/src/routes/stats.ts
