# Codex Review

- Generated: 2026-05-03T13:15:25.829Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/handicap-strokes.ts, apps/tournament-api/src/engine/formats/best-ball-2v2.ts, apps/tournament-api/src/services/handicap.ts

## Summary

The prior-pass fixes appear correctly applied: calcCourseHandicap now delegates to the engine implementation while preserving the old call contract; handicapIndex/slope/ratingTimes10/coursePar are now validated with Number.isFinite; getHandicapStrokes enforces strokeIndex ∈ [1,18]; compute2v2BestBall now throws on missing handicapIndex and validates money cents as non-negative integers. No regressions are evident in the moved math.

Remaining gaps are mostly at the “defensive validation” boundary of compute2v2BestBall: some inputs can silently override earlier entries or be invalid at runtime despite TS types, potentially producing incorrect payouts without an explicit error.

Overall risk: medium

## Findings

1. [medium] Duplicate holeScores / holeMeta entries silently overwrite earlier rows
   - File: apps/tournament-api/src/engine/formats/best-ball-2v2.ts:175-184
   - Confidence: high
   - Why it matters: scoresByCell and metaByHole are built with Map#set. If the input arrays contain duplicate keys (same playerId|holeNumber, or same holeNumber in meta), later entries overwrite earlier ones with no error. This can mask upstream data integrity issues (e.g., duplicated DB rows, merge bugs) and can change results depending on input ordering, leading to incorrect net scores and money attribution.
   - Suggested fix: Detect duplicates during map construction and throw (or at least log) when an existing key is present before set(). Example: if (scoresByCell.has(key)) throw new Error(...). Do the same for metaByHole.

2. [medium] Config enum/boolean fields are not runtime-validated; invalid values can change award behavior
   - File: apps/tournament-api/src/engine/formats/best-ball-2v2.ts:170-285
   - Confidence: high
   - Why it matters: Only the integer-cents fields are validated. If config.greenieValidation is not '2-putt' or 'none' at runtime (e.g., coming from JSON/db), the code effectively treats it like 'none' (validates remains true) and may award greenies without the intended 2-putt check. Similarly, non-boolean truthy values for config.sandies could unexpectedly enable sandies. This is a correctness risk at the boundary the comments describe as validation-enforced.
   - Suggested fix: Add explicit runtime validation for config.sandies (boolean), config.greenieValidation (must be '2-putt'|'none'), and optionally config.greenieCarryover/other fields. If invalid, throw a RangeError/Error before computing.

3. [low] No validation of grossStrokes/putts numeric ranges; negative or non-integer values can skew net calculations
   - File: apps/tournament-api/src/engine/formats/best-ball-2v2.ts:194-214
   - Confidence: medium
   - Why it matters: net is computed as grossStrokes - getHandicapStrokes(...). If grossStrokes is negative, non-finite, or non-integer (bad ingest), the engine will produce nonsensical nets and potentially award money incorrectly. putts is only checked for null/<=2 when greenieValidation==='2-putt'; non-finite putts could pass/behave oddly (e.g., NaN comparison is false, making validates false, but Infinity would fail <=2).
   - Suggested fix: At boundary, validate grossStrokes is a positive integer (or at least finite and >=1) and, when present, putts is an integer >=0. If the engine intentionally permits non-integers, validate finite and >=0 instead.

## Strengths

- Engine-layer calcCourseHandicap now correctly rejects NaN/Infinity and non-finite slope/ratingTimes10/coursePar (apps/tournament-api/src/engine/handicap-strokes.ts:51-62).
- strokeIndex range enforcement is now explicit and throws a RangeError early (apps/tournament-api/src/engine/handicap-strokes.ts:80-84).
- Missing handicapIndex no longer silently defaults to 0; getRequiredHandicapIndex correctly fails fast with a clear error message (apps/tournament-api/src/engine/formats/best-ball-2v2.ts:123-134).
- Money cent values are now validated as non-negative integers at the compute boundary (apps/tournament-api/src/engine/formats/best-ball-2v2.ts:170-174).

## Warnings

None.
