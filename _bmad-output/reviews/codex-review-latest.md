# Codex Review

- Generated: 2026-06-29T20:23:13.413Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/routes/admin.events.quick.tsx, apps/tournament-web/src/routes/admin.events.quick.test.tsx

## Summary

Your three stated follow-up fixes are largely in place:
- GHIN add de-dupe is now done inside the `setPlayers` functional updater, which makes it race-safe against rapid double-taps.
- `foursomeOf` maintenance was removed from step-2 mutators, and `goToArrange()` rebuilds `foursomeOf` to match the compacted roster before entering step 3, so the Arrange step and Start POST loop should not see a players/foursome mismatch via normal UI navigation.
- The Search button now refetches when already triggered, fixing the “same-criteria search can’t re-run” behavior for the button path.

One concrete new/remaining correctness risk: `setRosterSize()` can silently delete a manual row that has a handicap entered but no name yet (data loss) because it treats “blank” as `name.trim()===''` only.

Overall risk: medium

## Findings

1. [medium] setRosterSize may silently delete a manual row with handicap entered but empty name (data loss); comment says it won’t remove “filled” rows
   - File: apps/tournament-web/src/routes/admin.events.quick.tsx:229-242
   - Confidence: high
   - Why it matters: `setRosterSize()` trims trailing manual rows when reducing the roster, but it considers a row removable when `p.ghin === undefined && p.name.trim() === ''` (line 238). If a user types handicap first (or pastes handicap) and then reduces the roster count, that row can be spliced out and the typed handicap lost. This contradicts the stated intent “never auto-removes a GHIN or filled row” (lines 229–231) and can produce confusing UX/data loss.
   - Suggested fix: Tighten the “blank manual row” condition to require both fields empty, e.g. `p.ghin === undefined && p.name.trim() === '' && p.handicap.trim() === ''` (and consider similarly updating `effectivePlayers` if you want handicap-only rows to be preserved until name is entered). Add a test that sets a handicap with blank name, calls `setRosterSize(…)`, and asserts the row is not removed.

2. [low] GHIN re-trigger fix applies to Search button, but Enter key won’t refetch when already triggered
   - File: apps/tournament-web/src/routes/admin.events.quick.tsx:476-487
   - Confidence: medium
   - Why it matters: You fixed re-trigger via the Search button by calling `ghinSearchQuery.refetch()` when `ghinSearchTriggered` is already true (line 486). However, `onKeyDown` for both name fields only does `setGhinSearchTriggered(true)` (lines 478, 482). If the user presses Enter again with the same criteria after a transient error, it won’t refetch because state doesn’t change.
   - Suggested fix: Option A: in `onKeyDown`, if `ghinSearchTriggered` is true, call `void ghinSearchQuery.refetch()`; else set the flag. Option B: always call `refetch()` on Enter when last name is non-empty.

## Strengths

- De-dupe moved into the `setPlayers(prev => …)` updater (apps/tournament-web/src/routes/admin.events.quick.tsx lines 207–220), which eliminates the stale-closure/double-tap duplicate risk described in the prior review.
- `goToArrange()` compacts the roster and rebuilds `foursomeOf` to the exact roster length before step 3 (lines 244–253), which makes removing step-2 `foursomeOf` maintenance generally safe and reduces desync surface area.
- The GHIN-mode POST body is separated from manual-mode and does not send `manualHandicapIndex` for GHIN players (lines 309–316), and you added a focused integration-style test asserting that behavior (admin.events.quick.test.tsx lines 170–205).
- Search button re-trigger now explicitly refetches (line 486), addressing the “same criteria can’t be re-run” issue for the primary interaction path.

## Warnings

- Truncated file content for review: apps/tournament-web/src/routes/admin.events.quick.tsx
