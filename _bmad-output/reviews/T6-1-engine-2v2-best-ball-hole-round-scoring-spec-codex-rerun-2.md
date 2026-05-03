# Codex Review

- Generated: 2026-05-03T12:55:02.167Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md

## Summary

Re-review of the provided spec excerpt shows the prior 6 items you listed are largely addressed in the AC text (tie behavior, iteration driven by course.holes with sparse holeMeta, fixture JSON including holeMeta, layering intent, and plus-handicap clamp). However, there are still a few concrete internal inconsistencies in this document (mostly between Section 3 / ACs and the Tasks + re-export snippet) that could mislead implementation and/or break existing type contracts.

Overall risk: medium

## Findings

1. [high] services/handicap.ts re-export snippet aliases the wrong type (TeeShape as CourseHandicapInput)
   - File: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md:113-117
   - Confidence: high
   - Why it matters: The snippet says:
`export { calcCourseHandicap, type TeeShape as CourseHandicapInput } ...`.
But `TeeShape` (slope/ratingTimes10/coursePar) does not include `handicapIndex` (defined in the very same section as required by `calcCourseHandicap` input at lines 89-97). If existing callers rely on a `CourseHandicapInput` type that includes `handicapIndex` (which the function necessarily needs), this alias would be type-incorrect and could cause downstream compile breaks or incorrect developer usage.
   - Suggested fix: Re-export the correct input type for `calcCourseHandicap`, e.g. define/export `export type CourseHandicapInput = { handicapIndex: number; slope: number; ratingTimes10: number; coursePar: number }` from engine and re-export that. Do not alias `TeeShape` to `CourseHandicapInput` unless `CourseHandicapInput` is truly meant to be just the tee-only shape (in which case rename it to avoid implying it’s the function input).

2. [medium] Tasks section contradicts AC-1/Section 2b layering: Task 1 still says engine calls services/handicap.js
   - File: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md:427-432
   - Confidence: high
   - Why it matters: AC-1 explicitly requires `best-ball-2v2.ts` to import from `../handicap-strokes.js` only and not from services (lines 299-301). Section 2b also says v1 ships with `calcCourseHandicap` promoted into the engine and services becoming a thin re-export (lines 60-67). But Task 1 still instructs: `Calls calcCourseHandicap from services/handicap.js` (line 430). That directly re-introduces the engine→services dependency the spec says to avoid, and could lead an implementer to build the wrong dependency direction.
   - Suggested fix: Update Task 1 to match the chosen approach: `handicap-strokes.ts` should define/export `calcCourseHandicap` itself (engine source of truth) and `services/handicap.ts` should re-export it. Remove any instruction that engine imports from services.

3. [medium] Test count mismatch: AC-13 requires 7 cases but Task 2 still says 6
   - File: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md:379-435
   - Confidence: high
   - Why it matters: AC-13 states "at least 7 cases" including the plus-handicap clamp case (i)-(vii) (lines 379-390). Task 2 still says "6 unit cases per AC-13" (line 434). This can easily result in missing coverage for the plus-handicap clamp or boundary behavior, regressing the exact issue this spec says was fixed.
   - Suggested fix: Change Task 2 to require 7 cases (or "at least 7") and explicitly include the plus-handicap clamp test case.

4. [low] Spec text says plus-handicap clamp is `Math.max(0, ...)` at the end, but snippet uses an early return
   - File: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md:80-110
   - Confidence: high
   - Why it matters: Line 80 describes the clamp as being applied at the end via `Math.max(0, ...)`, while the code snippet implements it as an early return `if (ch <= 0) return 0;` (lines 105-110). Both satisfy the requirement, but the mismatch can cause unnecessary confusion during implementation or review (someone may “fix” it back to a `Math.max` in a way that reintroduces the negative-floor/mod bug if done incorrectly).
   - Suggested fix: Align the narrative with the snippet (or vice versa). If early return is the intended safe form, say so explicitly (e.g., "early return before floor/mod").

5. [low] TeeShape appears defined in both the handicap-strokes snippet and AC-1 type surface; re-export intent is implied but not explicit
   - File: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md:82-255
   - Confidence: medium
   - Why it matters: Section 3 defines `export type TeeShape` in `engine/handicap-strokes.ts` (lines 83-88). AC-1 then requires `best-ball-2v2.ts` to export a `TeeShape` type as part of its public surface (lines 213-218) while also saying it imports `TeeShape` from `../handicap-strokes.js` (line 300). That strongly implies `best-ball-2v2.ts` should re-export the imported type rather than redefine it, but the spec doesn’t state this explicitly. Ambiguity risks duplicated-but-diverging types.
   - Suggested fix: Clarify in AC-1 that `best-ball-2v2.ts` may `export type { TeeShape } from '../handicap-strokes.js'` (or similar) to satisfy the “exports every type” rule without redefining it.

## Strengths

- AC-2 now clearly specifies iteration over `course.holes` with a 4-cell completeness gate, while allowing `holeMeta` to be sparse/optional per hole (lines 302-309).
- AC-4/AC-6 greenie behavior on ties is now consistent: tied holes emit `greenieAwarded = null` and greenies only pay on a winning hole (lines 317-321, 339-340).
- Fixture JSON shape in AC-14 includes `holeMeta` alongside `holeScores`, matching the input contract changes (lines 402-416).
- The plus-handicap clamp is expressed in code as an early return before `floor`/`%`, which avoids negative-stroke emission (lines 104-110).

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md
