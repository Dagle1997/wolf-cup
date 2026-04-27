# Codex Review

- Generated: 2026-04-27T21:08:41.310Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/T4-1-pairings-suggest-engine-party-review.md, apps/tournament-api/src/engine/pairings/suggest.ts, apps/tournament-api/src/engine/pairings/suggest.test.ts

## Summary

No correctness regressions found in the canonical 8×4×4 path; Test A + golden asserts it and runtime-checks all C(8,2)=28 pairs. The 3 “NOT blockers” remain non-blocking based on the provided code/tests. One additional contract gap: despite the stated “NEVER-throw on bad input” posture, `suggestPairings` will throw if called with a non-object/invalid `roster` at runtime (TS types don’t protect JSON inputs).

Overall risk: medium

## Findings

1. [medium] “NEVER-throw on bad input” is not fully upheld at runtime: missing guards for `input` and `roster` shape
   - File: apps/tournament-api/src/engine/pairings/suggest.ts:94-136
   - Confidence: high
   - Why it matters: The file-level doc + party review repeatedly claim a broad NEVER-throw guarantee on bad input. However, the function immediately destructures `input` (line 95) and iterates `roster` (line 121). If a route handler (or any JS caller) passes malformed JSON (e.g., `null`, `{}`, `roster: null`, `roster: 'p0'`), this will throw before your existing `numRounds/foursomeSize` guards run. That’s a real runtime risk once T4-2 wires this into an API boundary.
   - Suggested fix: Add minimal runtime validation at function start, e.g.:
- ensure `input` is a non-null object
- ensure `roster` is an array (and ideally all elements are strings)
If invalid, return `{ rounds: [] }` with an `invalid roster` warning (similar pattern to sizing). Add 1–2 tests covering `roster: undefined/null/non-array` and `input as any = null`.

## Strengths

- Canonical 8×4×4 schedule is pinned by a golden assertion and independently verified via `assertEveryPairMet` (suggest.test.ts:40-90), supporting the spec-critical C(8,2)=28 claim.
- Top-level sizing validation prevents negative/NaN/float sizing crashes and early-outs deterministically (suggest.ts:103-113); tests cover numRounds=0 and NaN (suggest.test.ts:254-272).
- Pin validation includes integer/range guards preventing NaN/float index crashes (suggest.ts:190-200); test covers NaN/float pin rounds (suggest.test.ts:275-289).
- Path footprint appears confined to the new engine module + its tests under `apps/tournament-api/src/engine/pairings/` (no evidence of allowlist violations in provided files).
- Test file contains 11 `it(...)` cases, matching the party claim of “+11 tests” (suggest.test.ts:40-310).

## Warnings

None.
