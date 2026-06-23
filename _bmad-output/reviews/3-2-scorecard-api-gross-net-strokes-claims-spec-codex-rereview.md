# Codex Review

- Generated: 2026-06-23T13:20:27.481Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/3-2-scorecard-api-gross-net-strokes-claims.md

## Summary

AC #2 (hole range), AC #4 (helper path + consistency invariant), AC #6 (no-pin fallback to netScore=null), AC #7 (claim flags always-emitted booleans), AC #9 (tenant scoping), and AC #10 (tests incl. net=money-engine + missing course_holes) are all explicitly and unambiguously specified in the updated doc.

However, there are two internal spec contradictions that could cause an implementer to re-introduce prior bugs if they follow the wrong section, plus one smaller integrity edge case worth guarding.

No remaining issues rise to “High” based on the evidence in this file alone; the new issues below are Medium/Low.

Overall risk: medium

## Findings

1. [medium] AC #6 no-pin fallback is contradicted later (Dev Notes says net=gross)
   - File: _bmad-output/implementation-artifacts/tournament/3-2-scorecard-api-gross-net-strokes-claims.md:40-41
   - Confidence: high
   - Why it matters: AC #6 correctly specifies fail-closed behavior: when no pin / no player pin / null CH, netScore must be null (never net=gross) and relativeStrokes=0. But the “Forward concerns” section later states the opposite (“no-pin fallback shows net=gross”), which could lead a dev to accidentally restore the misleading behavior the prior review flagged.
   - Suggested fix: Update/replace the Forward concerns note at lines 110–113 to align with AC #6 (e.g., “no-pin fallback shows net unavailable (netScore=null), gross still shown”). If you want to discuss legacy non-F1 behavior, describe it as a separate possible future enhancement (e.g., derive from live CH) without contradicting 3-2’s required behavior.

2. [medium] Response shape ‘matches web type’ but Dev Notes still mark key fields optional; conflicts with AC #7 and AC #4 requirement that relativeStrokes is always returned
   - File: _bmad-output/implementation-artifacts/tournament/3-2-scorecard-api-gross-net-strokes-claims.md:28-43
   - Confidence: high
   - Why it matters: AC #7 requires hasGreenie/hasPolie/hasSandie to be non-optional booleans always emitted. AC #4 requires relativeStrokes returned for every in-play hole (including unplayed). But Dev Notes (endpoint contract) still describes these as optional (`hasGreenie?`, etc., `relativeStrokes?`). This can easily cause an implementation that omits fields or a test suite that doesn’t assert presence, undermining the “always emitted” guarantee.
   - Suggested fix: Edit Dev Notes line 89 to reflect the API contract you actually want: list hasGreenie/hasPolie/hasSandie/relativeStrokes as required in the API response (even if the web type allows optional). Consider adding an explicit assertion in tests that these keys are present on every hole object (not just truthy/falsey).

3. [low] Course revision mismatch between event_rounds.courseRevisionId and round_pin.courseRevisionId not specified as handled
   - File: _bmad-output/implementation-artifacts/tournament/3-2-scorecard-api-gross-net-strokes-claims.md:30-33
   - Confidence: medium
   - Why it matters: AC #2 says to join par/si via event_rounds.courseRevisionId and notes round_pin stores the same courseRevisionId and “they must agree.” If they ever diverge (bad data or future correction flows), net/relativeStrokes could be computed using SI from one revision while CH was pinned against another, producing incorrect dots/net or hard-to-debug discrepancies.
   - Suggested fix: Specify a defensive rule: if a round_pin exists and its courseRevisionId differs from event_rounds.courseRevisionId, throw a clear 500 data-integrity error (or choose one source of truth explicitly). Add/extend a unit test for this mismatch if you want to lock in behavior.

## Strengths

- AC #2 now clearly resolves the 9-hole ambiguity given the stated schema limitation (front nine only; back-nine not representable without a new field).
- AC #6 is now explicitly fail-closed and non-misleading (netScore=null, relativeStrokes=0) and requires test coverage.
- AC #4 is now unambiguous about staying in-tree (`apps/tournament-api/src/engine/handicap-strokes.ts`) and adds a strong ‘net must equal money-engine net’ invariant with an explicit test requirement (AC #10).
- AC #7 and AC #9 close common correctness/security gaps: always-emitted booleans and explicit tenant scoping of all lookups, not just the initial round check.
- AC #10 includes the two key regression tests you called out (net consistency + missing course_holes error) and defines route-level semantics (404/403/404) clearly.

## Warnings

None.
