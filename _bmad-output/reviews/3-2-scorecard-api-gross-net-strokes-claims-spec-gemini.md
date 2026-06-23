# Gemini Review

- Generated: 2026-06-23T13:15:29.569Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/3-2-scorecard-api-gross-net-strokes-claims.md

## Summary

The scorecard API spec provides a solid, well-scoped design that safely defers complex per-hole money logic and properly reuses existing claim-fold helpers. However, there are significant functional bugs related to 9-hole rounds, specifically regarding back-9 hole resolution and potential unadjusted 9-hole handicap stroke allocation.

Overall risk: medium

## Findings

1. [high] Hardcoded `1..holesToPlay` breaks Back-9 rounds
   - File: _bmad-output/implementation-artifacts/tournament/3-2-scorecard-api-gross-net-strokes-claims.md:30
   - Confidence: high
   - Why it matters: AC #2 explicitly dictates pulling holes `1..holesToPlay`. For a 9-hole round, this strictly fetches holes 1 through 9. If the 9-hole round is being played on the back 9, the scorecard will render the wrong hole numbers, par values, and stroke indices, severely breaking the core feature.
   - Suggested fix: Update AC #2 and Task 1 (line 69) to derive the hole range from the round's starting hole or side indicator (e.g., `front_back` on `event_rounds`), fetching `10..18` for back-9 rounds.

2. [medium] Potential double-allocation of strokes for 9-hole rounds
   - File: _bmad-output/implementation-artifacts/tournament/3-2-scorecard-api-gross-net-strokes-claims.md:34
   - Confidence: medium
   - Why it matters: AC #4 dictates passing the pinned `ch` directly into `getHandicapStrokes(ch, si)`. If the pinned `ch` represents an 18-hole handicap and is not pre-adjusted for 9-hole rounds, a 9-hole round will allocate 18-holes worth of strokes, resulting in wildly incorrect net scores.
   - Suggested fix: Clarify if `round_pins.ch` is already 9-hole adjusted. If it is the 18-hole CH, specify the requirement to adjust it (e.g., halving it) based on `holesToPlay === 9` before allocating strokes.

## Strengths

- Cleanly defers per-hole money computation (`moneyNet: null`) to Story 3-3, preventing scope creep while ensuring compatibility with the front-end components built in Story 3-1.
- Explicitly addresses the missing/null pin fallback (AC #6), opting for an explicit, documented degradation (`relativeStrokes = 0`, `net = gross`) rather than silent failure or 500s.
- Correctly isolates the API schema definition (FD-1/FD-2 compliance) by explicitly forbidding cross-app imports for the `ScorecardHole` type.
- Thorough test coverage requirements, explicitly checking claims latest-wins, no-pin fallbacks, and tenant authorization scoping.

## Warnings

None.
