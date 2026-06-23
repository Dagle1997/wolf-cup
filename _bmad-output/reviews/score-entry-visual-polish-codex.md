# Codex Review

- Generated: 2026-06-23T19:10:02.943Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx

## Summary

The diff successfully condenses each player card into a two-row layout and keeps score controls accessible (48×48 stepper, 48px-tall score input). The main risk introduced by removing the putts input is potential data loss / silent overwrites if the rest of the form still submits a `putts` field (or if any existing putts data is expected to be preserved). Also, the file header comments are now clearly out of sync with the current UI (putts + claim chips).

Overall risk: medium

## Findings

1. [high] Removing putts UI can cause silent loss of existing putts data (or make it impossible to score an active putting game)
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:1270-1610
   - Confidence: medium
   - Why it matters: This change removes (a) the only visible putts entry field and (b) its validation/update handler (`handlePuttsChange`). Since the data model still includes `HoleScore.putts: number | null` (file line 63-68), any workflow that previously captured putts (or any round that already has putts recorded) is now at risk: users cannot view/correct putts for the hole in this screen, and any subsequent save that writes `putts` (especially `null`) can overwrite previously-entered values. That’s irreversible data loss unless the backend preserves prior values when `putts` is null/omitted.
   - Suggested fix: If the intent is “putts always null from this screen,” make that explicit in the save payload construction (set `putts: null` unconditionally, or omit `putts` entirely if the API supports partial updates) and confirm backend semantics don’t null-out existing putts unexpectedly. If some tournaments still use putts, gate this UI removal behind a tournament/round feature flag or round setting so active putting games aren’t broken.

2. [medium] Test/automation break risk: removed `putts-input-*` data-testid
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:1567-1610
   - Confidence: high
   - Why it matters: The diff removes the `<input data-testid={`putts-input-${idx}`}>`. Any existing unit/E2E tests, QA scripts, or Playwright selectors relying on that test id will fail immediately. This is a common source of CI regressions even for “visual-only” polish changes.
   - Suggested fix: Update or remove any tests/selectors that target `putts-input-*`. If you still need a stable selector for the player card, consider adding a `data-testid` to the card wrapper (e.g., `player-card-${member.playerId}`) so tests can anchor without relying on removed inputs.

3. [low] Top-of-file porting notes are now inaccurate about putts and claim chips
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:4-17
   - Confidence: high
   - Why it matters: The header comment says greenies/polies/sandies were removed (line 7-8) and that “putts is always-optional input” (line 11). In the current file, claim chips are clearly implemented (ClaimType/CLAIM_LABELS at lines 70-82 and `<ClaimChips .../>` in the UI diff), and the putts input has been removed. These porting notes are “load-bearing” context for future changes; being wrong increases the chance of future regressions or incorrect assumptions during bugfixes.
   - Suggested fix: Update the header bullets to reflect current reality (claim chips present; putts input removed / putts handled elsewhere).

## Strengths

- Score control accessibility is preserved: stepper buttons are 48×48 and score input is 48px tall, meeting the ≥44px tap-target guideline.
- Score stepper buttons retain per-player aria-labels, which helps screen-reader users distinguish controls.
- The list item key remains `key={member.playerId}` on the card wrapper, which supports stable DOM reuse for the score input across renders.

## Warnings

- Truncated file content for review: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx
