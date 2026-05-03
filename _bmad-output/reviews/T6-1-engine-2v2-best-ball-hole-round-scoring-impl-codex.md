# Codex Review

- Generated: 2026-05-03T13:13:14.893Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/handicap-strokes.ts, apps/tournament-api/src/engine/handicap-strokes.test.ts, apps/tournament-api/src/engine/formats/best-ball-2v2.ts, apps/tournament-api/src/engine/formats/best-ball-2v2.test.ts, apps/tournament-api/src/services/handicap.ts, _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md

## Summary

Core implementation largely matches the spec: pure function, complete-cell skip, pairwise attribution with anti-symmetry, integer-cents fast-fail, sandies/greenies only on won holes, and a solid fixture + invariant test harness. The main concrete gaps are (1) course-handicap rounding semantics for negative values vs the written spec, and (2) missing/insufficient validation (Infinity inputs, strokeIndex range, config non-negativity, and silently defaulting missing handicap indexes to 0).

Overall risk: medium

## Findings

1. [high] calcCourseHandicap rounding for negative values does not match spec’s “half-away-from-zero” behavior
   - File: apps/tournament-api/src/engine/handicap-strokes.ts:63-66
   - Confidence: high
   - Why it matters: The implementation uses `Math.round(raw)`, which rounds negative halves toward zero (e.g., `Math.round(-1.5) === -1`), not away from zero. Your own spec artifact explicitly shows/claims “Round half-away-from-zero per USGA convention” (in the included markdown snippet). This will change course handicap results for plus-handicap / negative-raw cases around .5 boundaries. Even though `getHandicapStrokes` clamps `ch <= 0` to 0, `calcCourseHandicap` is a public function used by the services wrapper and tests/caches; rounding drift here can cause subtle mismatches and breaks spec compliance.
   - Suggested fix: If the intended rule is half-away-from-zero, compute `raw` then `const result = Math.sign(raw) * Math.round(Math.abs(raw));` (still normalize -0 to 0). Add a focused unit test for a negative-half boundary (e.g. construct tee/rating/par to produce raw = -1.5). If the intended rule is actually JS Math.round semantics, update the spec text to match reality.

2. [high] calcCourseHandicap claims “finite” validation but permits Infinity/-Infinity
   - File: apps/tournament-api/src/engine/handicap-strokes.ts:49-56
   - Confidence: high
   - Why it matters: The guard checks `typeof === 'number'` and `Number.isNaN`, but does not reject `Infinity` or `-Infinity`. That can yield `Infinity` course handicaps and propagate into downstream computations (including pairwise money attribution). Since this is engine math, it’s safer to fail fast on non-finite numbers.
   - Suggested fix: Replace `Number.isNaN(handicapIndex)` with `!Number.isFinite(handicapIndex)` (and similarly consider `Number.isFinite` for `slope`, `ratingTimes10`, `coursePar`). Add a unit test asserting it throws on `handicapIndex: Infinity` (and potentially `slope: Infinity`).

3. [medium] getHandicapStrokes has no strokeIndex range validation; incorrect results for SI خارج 1..18
   - File: apps/tournament-api/src/engine/handicap-strokes.ts:75-85
   - Confidence: high
   - Why it matters: The function assumes `strokeIndex` is 1..18 (as your types/spec say), but if a caller passes 0 or a negative, the comparison `strokeIndex <= extra` becomes true and awards an extra stroke incorrectly. If a caller passes >18, it may award too few. While current `compute2v2BestBall` likely feeds valid SIs from `course.holes`, this is an exported engine function and a subtle bug can leak into other formats later.
   - Suggested fix: Add a guard like `if (!Number.isInteger(strokeIndex) || strokeIndex < 1 || strokeIndex > 18) throw new RangeError(...)` (or clamp, but throwing is safer in engine math). Add a small unit test for SI=0 and SI=19 to confirm behavior.

4. [medium] compute2v2BestBall silently treats missing handicapIndexByPlayer entries as 0 (scratch)
   - File: apps/tournament-api/src/engine/formats/best-ball-2v2.ts:186-190
   - Confidence: medium
   - Why it matters: `handicapIndexByPlayer[id] ?? 0` will convert missing/undefined handicap indexes into scratch, which can silently flip winners and money attribution without any signal to the caller. The spec says the caller handles missing handicap earlier in other contexts; for this money engine, defaulting to 0 may hide data issues.
   - Suggested fix: Consider failing fast if any of the 4 players’ handicap indexes are missing/non-finite (throw), or make the behavior explicit via config/flag (e.g., `missingHandicapBehavior: 'throw' | 'treat-as-scratch'`). At minimum, add a test covering a missing HI to lock intended behavior.

5. [low] Money config validation enforces integer-only but not non-negativity (spec says ≥ 0)
   - File: apps/tournament-api/src/engine/formats/best-ball-2v2.ts:110-156
   - Confidence: high
   - Why it matters: `assertInteger` allows negative integers. A negative `basePerHoleCents` or bonus would invert flows and can produce surprising results while still satisfying integer-only invariants. Your spec states these are `INTEGER ≥ 0`.
   - Suggested fix: Extend validation to `if (value < 0) throw new RangeError(...)` for the three money fields. Add a unit test that negative cents throws.

## Strengths

- Engine/services layering is respected: engine does not import from services; services wrapper delegates cleanly (apps/tournament-api/src/services/handicap.ts:27-54).
- compute2v2BestBall appears pure/deterministic (no I/O; deterministic replay test asserts no mutation).
- Complete-cell gate is correctly implemented (skips holes missing any of the 4 score rows) and has a dedicated test.
- Pairwise attribution implementation (`bumpPair`/`distributePairWise`) enforces anti-symmetry by construction, and tests assert anti-symmetry + perPair-sum invariant.
- Sandies/greenies are correctly restricted to won holes; sandies apply once per hole via `.some()`, and greenies require par-3 + winning-team CTP + validation.

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md
