# Codex Review

- Generated: 2026-05-06T22:57:34.609Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/T8-3-player-home-activity-feed-party-review.md, apps/tournament-web/src/lib/activity-headline.ts, apps/tournament-web/src/components/activity-feed.tsx

## Summary

The party-mode PASS verdict is mostly consistent with the implementation (provider-driven feed, two-stage Load more with re-entry guard, empty-state precedence, routing via TanStack Link, shared headline helper). However, there are a couple of concrete, user-visible copy/emoji correctness issues in the extracted headline helper, and one clear mismatch between the party review’s described relative-time behavior and what the code actually does.

Overall risk: medium

## Findings

1. [medium] award.triggered toast headline always uses eagle emoji, even for birdie awards
   - File: apps/tournament-web/src/lib/activity-headline.ts:93-105
   - Confidence: high
   - Why it matters: For award types that map to “birdie”, the toast would still render `🦅 First birdie of the trip...`, which is misleading user-facing output (and contradicts the party review’s statement that the icon/headline are coherent). This is a concrete correctness bug in the new shared helper used across surfaces.
   - Suggested fix: Choose the emoji based on `label` (e.g., `label === 'eagle' ? '🦅' : '🐦'`), or use a neutral trophy emoji consistently for awards if that’s the intended UX. Add/adjust unit tests to cover both eagle and birdie award types for toast surface.

2. [medium] score.committed toast headline always uses bird emoji regardless of toPar descriptor
   - File: apps/tournament-web/src/lib/activity-headline.ts:49-62
   - Confidence: high
   - Why it matters: `buildScoreCommittedHeadline` uses a fixed `🐦` prefix for toast (line 59), so a bogey/par/etc. would still show a bird emoji. That’s misleading, and the helper is intended to be shared across surfaces; this could also be a regression from pre-extraction behavior if toast previously varied emoji or used a neutral one.
   - Suggested fix: Use a neutral golfing emoji for score commits (e.g. `🏌️`) or map emoji to `descriptor` (birdie/eagle/etc.) if desired. Ensure tests cover at least one non-birdie toPar case on the toast surface.

3. [low] Party review claims relative-time labels flip to “5s ago” after 5 seconds, but implementation shows “just now” for up to 30 seconds
   - File: apps/tournament-web/src/components/activity-feed.tsx:51-61
   - Confidence: high
   - Why it matters: This is a spec/drift concern between the documented review narrative and actual behavior. The current implementation will display “just now” for 0–30s (line 53), so the party review’s example (“5 seconds later: 5s ago”) is incorrect. If AC expectations/tests were written to the narrative, this could cause confusion or future assertion mismatches.
   - Suggested fix: Either (a) update the party output / expectations to match the implemented bucketing (≤30s = “just now”), or (b) change the bucketing threshold if the intended spec was ≤5s for “just now”. Ensure the relative-time tests (not provided here) align with the chosen rule.

## Strengths

- ActivityFeed correctly relies on `useActivityFeed` (no local polling) and implements the two-stage Load more with a synchronous re-entry guard (`loadingMoreRef`) plus UI state (`loadingMore`).
- Empty-state precedence is correctly implemented via `if (rows.length === 0)` regardless of `cursorBefore` (prevents a misleading Load more when there are no rows).
- Routing uses TanStack Router `Link` with typed route targets, and the `scorer.transferred` route has a defensive `roundId` presence check to avoid malformed URLs.
- Headline extraction is real and centralized: ActivityFeed calls `buildActivityHeadline(row, 'feed')`, and the helper includes defensive numeric coercion (`safeNumber`) and toPar descriptor mapping.

## Warnings

None.
