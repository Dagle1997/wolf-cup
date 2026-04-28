# Codex Review

- Generated: 2026-04-28T16:55:01.189Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md

## Summary

STOP-on-High. Round-2 critical/high items around 422 round_state_missing, uniform 404, and maxLength=2 are concretely addressed in this spec. However, the updated auto-advance state machine introduces a new functional bug: it makes it effectively impossible to type a valid score of 20 because any single-digit '2' immediately auto-advances focus before the user can enter the trailing '0'. There’s also an incompleteness risk in the skippedHoles clearing rule: it describes clearing computed each render but does not specify persisting that clearing back to sessionStorage, which can reintroduce “cleared” skips on remount.

Epic AC drift (line 1281-1322) cannot be verified from the provided materials; the epic text isn’t included, and the spec excerpt is truncated.

Overall risk: high

## Findings

1. [high] Auto-advance makes score=20 effectively un-enterable (single-digit '2' advances immediately)
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:150-176
   - Confidence: high
   - Why it matters: The spec explicitly allows gross strokes 1–20 and lists '20' as a valid value (lines 150-157). But the auto-advance state machine says entering any single digit '2'-'9' advances immediately (line 173). On a controlled input, the user types '2' first; onChange fires and the code focuses the next input immediately, preventing the second keystroke '0' from producing '20' in the same field. This is a functional regression that blocks a valid backend-accepted score value (20).
   - Suggested fix: Treat '2' as an ambiguous prefix the same way '1' is treated, because it could be '2' or the start of '20'. Options:
- Add a special case: on raw==='2', start the same 1500ms timer (or a shorter one) before auto-advancing; if the next digit is '0' (raw==='20') advance immediately.
- Alternatively, change the heuristic: only immediate-advance on digits that cannot start any valid 2-digit score (i.e., '3'-'9'), while '1' and '2' use the timer/blur acceptance path.
Update both the state machine description and the frontend tests to cover typing 2 then 0 yields 20 and advances correctly.

2. [medium] skippedHoles “cleared each render” rule doesn’t specify persisting the cleared set back to sessionStorage
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:187-192
   - Confidence: high
   - Why it matters: The spec says skippedHoles is persisted in sessionStorage (line 187) and later says it is ‘cleared’ when the server now has all 4 cells for a previously skipped hole, computed each render as `skippedHoles - {filledOnServer}` (lines 189-191). But it does not state that this derived/cleared set is written back to sessionStorage. If a user reloads/remounts, sessionStorage may rehydrate with the old skipped list and reintroduce already-cleared holes, potentially causing misleading UX (e.g., “skipped holes remain” messaging) and making behavior depend on whether the tab was reloaded.
   - Suggested fix: Make the clearing behavior explicit as a state update + persistence rule: when a refetch observes hole h is fully scored server-side, remove h from the skippedHoles state AND immediately persist the updated list back to sessionStorage. Add a frontend test that: skip hole 5 → refetch shows hole 5 fully scored → skippedHoles no longer contains 5 AND the persisted sessionStorage value is updated (then remount and verify 5 stays cleared).

## Strengths

- Round-2 Critical is addressed explicitly: missing round_states row now yields 422 round_state_missing (lines 100-103; AC #2 lines 270-272), and prior “default to not_started” language is removed.
- Round-2 High on existence/authorization leak is addressed: non-participant returns uniform 404 round_not_found (lines 94-97; step 5 line 105; AC #4 lines 286-290).
- Round-2 High on maxLength={1} is addressed: maxLength={2} is mandated and consistent across risk + AC (lines 150-152; 198; AC #6 line 307).
- Timer cancellation rules are spelled out concretely (lines 171-178), including unmount/blur/keystroke cancellation, reducing ambiguity for implementation and tests.

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md
