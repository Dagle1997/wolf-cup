# Codex Review

- Generated: 2026-04-28T16:51:29.721Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md

## Summary

Round-1 issues look addressed in spirit, but the spec still contains several internal contradictions that would cause an implementer to ship the wrong behavior (or write failing tests). The biggest gaps are: (1) round_states missing is specified as both 422 and “default to not_started”, (2) non-participant handling is specified as both 404 and 200 with myFoursome:null, and (3) the AC section still mandates maxLength=1 despite the new 1–20 requirement. The new 1500ms ‘1’ debounce and skippedHoles sessionStorage approach also need a bit more lifecycle detail to avoid focus-steal surprises and undefined-hole edge cases.

Overall risk: medium

## Findings

1. [critical] Contradiction: round_states missing is specified as both 422 round_state_missing and “default to not_started”
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:100-242
   - Confidence: high
   - Why it matters: In Risk Acceptance §3 you explicitly require 422 `round_state_missing` when the `round_states` row is absent (lines 101-103). But AC #2 still says `state` defaults to `'not_started'` if missing (line 240). Those are mutually exclusive; an implementation that follows AC #2 would reintroduce the ambiguity Round 1 flagged and would also conflict with backend tests you list (line 322).
   - Suggested fix: Make AC #2 consistent with the 422 design: remove the “defaulting to not_started if missing” clause and explicitly state that missing round_states returns 422 `round_state_missing` (and ensure tests/assertions align).

2. [high] Contradiction: non-participant behavior is described as 404 round_not_found but also as 200 with myFoursome:null
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:93-192
   - Confidence: high
   - Why it matters: You state non-participants must get 404 `round_not_found` to obfuscate existence (lines 94-97, 255-260). But the backend lookup chain says “If not found → myFoursome: null” (line 105), and the UI section includes a “Not in round placeholder” triggered by `myFoursome === null` (lines 191-192). These can’t all be true. If the API returns 404, the UI should never see `myFoursome:null` on a 200; if the API returns 200+null, you reintroduce the existence leak you said was resolved.
   - Suggested fix: Pick one and delete the other path. If you want strict obfuscation, remove `myFoursome:null` from the 200 shape entirely and update the chain step (line 105) + UI condition (lines 191-192) to be purely 404-driven. Alternatively, if you want 200+null, you must drop the 404-obfuscation requirement (but that would contradict your stated resolution).

3. [high] AC #6 still requires maxLength={1}, contradicting the new 1–20 scoring requirement and regex/state machine
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:150-277
   - Confidence: high
   - Why it matters: The spec correctly updates the design to allow 10–20 via `maxLength={2}` and `/^([1-9]|1[0-9]|20)$/` (lines 150-156, 171-172). But AC #6 still mandates `maxLength={1}` (line 276). This will either (a) cause the implementation to regress back to single-digit-only, or (b) cause the AC checklist to fail review even if implemented correctly.
   - Suggested fix: Update AC #6 to require `maxLength={2}` and ensure every place that mentions maxLength=1 is removed or scoped only to the Wolf Cup provenance description (not the tournament implementation).

4. [high] Score input “reject invalid keystroke” regex likely blocks legitimate intermediate states (empty string/backspace/replace), risking unusable input
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:150-157
   - Confidence: high
   - Why it matters: The allowed-character regex `/^([1-9]|1[0-9]|20)$/` (line 152) matches only complete valid scores, not intermediate edit states. If the onChange handler refuses state updates unless the full string matches, users may be unable to clear a cell ("" doesn’t match), fix mistakes via backspace, or select+replace fluidly—especially on mobile where composition/edit behaviors vary. This is a common real-world bug with “reject invalid” approaches.
   - Suggested fix: Explicitly allow intermediate states in the input model (at minimum: "" and possibly partial "1"). One safe pattern: always accept digits-only up to 2 chars (`/^\d{0,2}$/`), then validate complete value on blur / on Save (and for auto-advance, only advance when the value is within 1–20). If you keep the current approach, update the regex/logic to allow "" and ensure backspace works.

5. [medium] 1500ms auto-advance debounce on '1' needs explicit cancellation rules to avoid focus-steal surprises
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:153-156
   - Confidence: high
   - Why it matters: You identified the core UX risk in your prompt: if a scorer types '1' and then pauses (thinking, or moving their finger to tap another field), a delayed timer can fire and unexpectedly advance focus. The spec currently says “wait 1500ms… and auto-advances” (line 155) but does not specify cancellation on: manual focus change, blur, navigation (Skip hole), Save click, or component unmount. Without this, implementation may intermittently steal focus or attempt to focus an unmounted ref.
   - Suggested fix: Add requirements: clear the pending '1' timeout on (a) any focus/blur change, (b) any non-digit edit (including backspace), (c) Save/Skip actions, and (d) unmount. Also specify whether manual tap to another input should suppress pending auto-advance permanently for that cell.

6. [medium] skippedHoles persisted in sessionStorage is per-tab; spec doesn’t state intended multi-tab behavior (and user asked explicitly)
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:159-168
   - Confidence: high
   - Why it matters: sessionStorage survives refresh in the same tab, but does not sync across tabs/windows. If a scorer has the score-entry screen open in two tabs (or opens it from a second device), the skip set will diverge. The prompt explicitly calls out “multi-tab consistency?”; the spec currently doesn’t answer it, so the behavior will be accidental rather than designed.
   - Suggested fix: Decide and document: (1) accept per-tab skip persistence (and call it out explicitly), or (2) switch to localStorage (and optionally handle the `storage` event to sync), or (3) store skipped holes server-side (probably out of scope). Update tests accordingly if you choose (2).

7. [medium] Skipped-holes clearing conditions are underspecified; may persist longer than intended and affect later sessions
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:164-168
   - Confidence: medium
   - Why it matters: You only clear sessionStorage skippedHoles “when the round transitions to complete_editable or finalized” (line 167). But the UI can reach “all done” (line 164) before state transitions, or state may remain `in_progress` due to delayed organizer workflow. In that case, a refresh could resurrect stale skipped holes and change the computed currentHole unexpectedly.
   - Suggested fix: Also clear skippedHoles when you detect completion locally (e.g., when `firstUnscoredHole` is undefined / `currentHole > holesToPlay`). Consider clearing on route unmount as well if you intend skip to be a short-lived aid rather than durable state.

8. [medium] currentHole min() over empty sets not defined (all holes scored, or all remaining holes skipped)
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:161-166
   - Confidence: high
   - Why it matters: The spec defines `firstUnscoredHole = min({...})` and then `currentHole = min({...})` (lines 162-164). If all holes are fully scored, `firstUnscoredHole` has no elements; if the scorer skips every remaining hole, the second set can be empty too. Without an explicit fallback, implementations may produce `Infinity`, `undefined`, or crash—especially important because this logic is “load-bearing” for the snap-back fix.
   - Suggested fix: Define explicit fallbacks: if no unscored holes exist, set `currentHole = holesToPlay + 1` (or a sentinel) and clear skippedHoles; if all holes >= firstUnscoredHole are skipped, either (a) allow advancing to holesToPlay+1 (treat as done), or (b) surface UI to “unskip” or pick a hole.

9. [low] Test plan and counts are internally inconsistent (8 vs 10 backend GET tests; 11 vs 13 frontend tests)
   - File: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md:21-339
   - Confidence: high
   - Why it matters: Early sections say `scores.read.test.ts` NEW (8 GET tests) (line 23) and frontend tests (line 216 mentions 11). Later AC #10 enumerates 10 backend tests (lines 313-325) and 13 frontend tests (lines 326-339). This isn’t a functional bug, but it creates review ambiguity and makes the “test floor” gate harder to verify.
   - Suggested fix: Normalize the numbers in all sections (risk acceptance, test surface summary, and AC #10 attribution list) so they match the actual intended list: 10 backend + 13 frontend (as described in the user’s Round-2 preface).

## Strengths

- Good evidence-first pinning of load-bearing requirements: stable member ordering (slot_number ASC) is explicitly called out as required for ref-positional indexing (lines 82-83, 148-149, 246-247).
- The iOS keyboard fix is correctly specified as synchronous focus within the user gesture before async work, and stable keys to preserve DOM inputs across rerenders (lines 54-55, 173-176, 272-275).
- The 404 obfuscation intent is clearly articulated, and you added explicit tests to ensure uniformity (lines 94-97, 255-260, 317-325)—once the myFoursome:null contradiction is removed.
- Offline queue error taxonomy mapping is thorough and connects to T5-3/T5-6 behavior in an implementable way (lines 195-203).

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T5-2-scorer-entry-ui-ios-keyboard-fix.md
