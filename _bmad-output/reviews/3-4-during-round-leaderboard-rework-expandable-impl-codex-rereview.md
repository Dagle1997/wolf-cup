# Codex Review

- Generated: 2026-06-23T16:55:36.970Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx, apps/tournament-web/src/routes/events.$eventId.leaderboard.test.tsx

## Summary

The three stated SHIP fixes are present in the updated implementation:
- Scope toggle now clears `expandedPlayerId` (prevents auto-reopen/refetch when returning to round scope).
- `aria-controls` now targets a real element (`<div id=… role="region">`) instead of a `<tr>`.
- New tests cover lazy scorecard fetch, money gating when `moneyEnabled=false`, and scope-toggle clearing the open scorecard.

No new high-severity issues are evident from the provided diff/file contents.

Overall risk: low

## Findings

1. [low] `aria-controls` points to an element that is not in the DOM while collapsed
   - File: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx:492-540
   - Confidence: medium
   - Why it matters: When the row is collapsed, the button still has `aria-controls={panelId}` but the controlled element (`<div id={panelId}>…`) is only conditionally rendered when expanded (lines 530-540). Some assistive technologies expect `aria-controls` to reference an existing element, and may not announce the relationship correctly if the target doesn’t exist yet.
   - Suggested fix: Consider always rendering the region container with the `id` and toggling visibility (e.g., `hidden` / conditional content inside), or remove `aria-controls` when collapsed and add it only when expanded.

2. [low] `panelId` is derived from raw `playerId` without sanitization
   - File: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx:482-485
   - Confidence: low
   - Why it matters: HTML `id` must be a valid identifier and cannot contain spaces. If `playerId` can ever contain characters that produce invalid IDs, this would break the `aria-controls` linkage and could cause DOM id collisions or selector issues.
   - Suggested fix: Sanitize/encode the id segment (e.g., `encodeURIComponent(row.playerId)` or a safe hash) when building `panelId`.

## Strengths

- `expandedPlayerId` is explicitly cleared on scope toggle click, matching the intended no-auto-reopen behavior (lines 384-389).
- `aria-controls` now targets a proper region wrapper (`<div id=… role="region" aria-label=…>`) rather than a table row (lines 533-537).
- Scorecard fetching is truly lazy because `RowScorecard` is only mounted when expanded (lines 530-540), and there’s now a dedicated test asserting no `/scorecard` fetch before expansion.
- Money display is gated by `f1.mode === 'money' && f1.moneyEnabled === true` and is covered by tests for both scores-only and moneyEnabled=false cases.
- Inline handling of 403/404 as `unavailable` prevents the scorecard panel from crashing the entire leaderboard (lines 250-279), and is tested.

## Warnings

None.
