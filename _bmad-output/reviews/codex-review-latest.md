# Codex Review

- Generated: 2026-04-22T19:52:50.684Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/web/src/routes/score-entry-hole.tsx

## Summary

Additive UI looks safe overall and matches the stated behavior/guard. One concrete edge: the chip can render before `ctpEntriesData` has loaded (since the page only blocks on round/scores/decisions), which can temporarily show the wrong label/action ("Tap to answer" / "Answer") even when an entry already exists, and can let the user overwrite unintentionally.

Overall risk: low

## Findings

1. [low] CTP status chip can mislabel state (and encourage re-answer) while ctpEntriesData is still loading
   - File: apps/web/src/routes/score-entry-hole.tsx:1006-1041
   - Confidence: high
   - Why it matters: The page’s loading gate only checks `roundLoading || scoresLoading || decisionsLoading` (line ~710), not the CTP entries query. In this chip, `myEntry` is derived from `(ctpEntriesData?.entries ?? [])`, which becomes an empty array until the query resolves. That means on a CTP week/par-3 with all scores submitted, the chip can briefly show “Tap to answer Closest to Pin” and the CTA “Answer” even if the group already has an entry. If the user taps quickly, they’ll open the prompt assuming no prior answer and may submit—potentially overwriting an existing entry (depending on server semantics). This contradicts the stated display rules (“My group said: {name}” if entry exists).
   - Suggested fix: Consider gating the chip on CTP entries being loaded (e.g., include `isLoading` from the query and return null/disabled chip until loaded), or render a neutral/loading label until `ctpEntriesData` is present. Alternative: keep rendering but disable tap until entries load, or show “Closest to Pin (loading…)”.

2. [low] Chip styling lacks dark-mode variants (may reduce readability in dark theme)
   - File: apps/web/src/routes/score-entry-hole.tsx:1026-1039
   - Confidence: medium
   - Why it matters: Nearby banners include `dark:` classes (e.g., offline banner around line ~971), but the new chip hardcodes light palette (`bg-amber-50 text-amber-800 border-amber-300`). In dark mode this can look out of place or have suboptimal contrast.
   - Suggested fix: Add `dark:` equivalents similar to other banners (e.g., `dark:bg-amber-950/30 dark:border-amber-700 dark:text-amber-300` etc.) or confirm the app doesn’t use dark mode here.

## Strengths

- The render guard `submittedScores.get(currentHole)?.size === orderedPlayers.length` aligns with the existing completion logic and should substantially reduce the chance of triggering HOLE_NOT_COMPLETE from normal in-app flows.
- Uses a semantic <button type="button"> and includes visible text, so it’s keyboard/screen-reader discoverable.
- On tap, it clears `ctpError` and `ctpSubmittingFor` before reopening the prompt, which avoids stale error/submitting UI when revisiting.

## Warnings

- Truncated file content for review: apps/web/src/routes/score-entry-hole.tsx
