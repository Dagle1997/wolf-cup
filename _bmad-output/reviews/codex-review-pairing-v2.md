# Codex Review

- Generated: 2026-06-03T00:21:15.453Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: packages/engine/src/pairing.ts, packages/engine/src/pairing.test.ts, apps/api/src/scripts/_audit_pairing_engine_replay.ts

## Summary

Second-pass review confirms the 5 previously-found issues (F1/F2/F3/F4/F10) are fixed as described, and the critical invariant (returning RAW totalCost while optimizing convex penalty internally) is preserved. No Critical/High blockers remain for push+deploy based on the provided diff/files.

Overall risk: low

## Findings

1. [low] Defensive RNG clamping does not handle NaN, despite comment claiming out-of-contract values can’t corrupt the partition
   - File: packages/engine/src/pairing.ts:166-172
   - Confidence: high
   - Why it matters: The new clamp prevents negative and >=1 values from producing out-of-bounds indices (good), but if an injected rng() returns NaN, then `Math.floor(NaN)` is NaN and the clamp expression still yields NaN. Using `shuffled[j]` where `j` is NaN accesses a non-index property and can introduce `undefined` into the array, potentially leading to incorrect grouping or downstream odd behavior. This is only reachable via an invalid injected RNG (production default Math.random won’t do this), so it’s non-blocking—but the comment at input.rng and the shuffle comment currently overstates the safety guarantee.
   - Suggested fix: Harden the clamp to coerce non-finite values, e.g. `const r = rng(); const jj = Number.isFinite(r) ? Math.floor(r*(i+1)) : 0; const j = Math.min(i, Math.max(0, jj));` (or default to 0/i). Alternatively, narrow the claim in the comment to “out-of-range finite values”.

## Strengths

- F1 (replay harness remainder drop bias) is fully closed: upfront validation fails loudly on non-multiple-of-4 rosters and any non-4 actual group sizes (apps/api/src/scripts/_audit_pairing_engine_replay.ts:159-180), plus a per-round assertion that engine remainder is empty (lines 199-203). This prevents silent bias in engine-vs-random comparisons.
- F2 (rng unclamped) is correctly addressed for the intended class of bad RNG outputs: `j` is clamped into [0,i], and for valid rng in [0,1) it is behavior-preserving (packages/engine/src/pairing.ts:166-172).
- F3 (bestGroups non-null assertion crash) is fixed with a safe fallback return when no best is selected (packages/engine/src/pairing.ts:216-222).
- F4 (non-integer REPEAT_PENALTY_EXP tie-test fragility) is explicitly documented as requiring a positive integer to keep `===` ties meaningful (packages/engine/src/pairing.ts:53-63).
- F10 (AC9 median-vs-avg mismatch) is fixed: both worst-player and total gates compare median-to-median (apps/api/src/scripts/_audit_pairing_engine_replay.ts:262-267).
- The RAW-cost invariant is preserved: optimization selects on convex penalty + worst-player load, then recomputes and returns RAW `totalCost` via `groupCost` on the winning groups (packages/engine/src/pairing.ts:224-233).
- Good test coverage was added to lock in the convex objective, worst-player tie-break, and RNG determinism (packages/engine/src/pairing.test.ts:182-333).

## Warnings

None.
