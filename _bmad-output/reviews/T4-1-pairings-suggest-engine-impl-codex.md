# Codex Review

- Generated: 2026-04-27T21:02:55.596Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/pairings/suggest.ts, apps/tournament-api/src/engine/pairings/suggest.test.ts, _bmad-output/implementation-artifacts/tournament/T4-1-pairings-suggest-engine.md

## Summary

Implements the two-tier engine and 9 tests; canonical 8×4×4 schedule matches the spec and Test A asserts full C(8,2)=28 pair coverage with no warnings. Greedy fallback is deterministic and honors valid pins. Main risk: pin validation is not robust to non-integer/NaN round/foursome values and can throw, violating AC #5’s “NEVER throw” guarantee for invalid pins. Also missing validation for numRounds/foursomeSize can cause runtime exceptions on bad inputs.

Overall risk: medium

## Findings

1. [critical] Invalid pins can still throw (NaN/float round or foursome bypasses range check, then crashes indexing pinnedSlots)
   - File: apps/tournament-api/src/engine/pairings/suggest.ts:144-178
   - Confidence: high
   - Why it matters: AC #5 requires invalid pins be dropped with a warning and the function must never throw. Current validation only checks numeric range with < and >. For NaN, both comparisons are false, so the pin is treated as valid; then `rIdx = pin.round - 1` becomes NaN and `pinnedSlots[rIdx]![fIdx]!` dereferences undefined, throwing at runtime. Similarly, non-integer values like 1.5 pass the range check and produce non-integer indices, also leading to undefined access and a throw.
   - Suggested fix: Before any range checks, validate `Number.isInteger(pin.round) && Number.isInteger(pin.foursome)` (and optionally `Number.isFinite(...)`). If invalid, `warnings.push(...)` (likely reuse `pin out of range...` or add a dedicated message) and `continue`. Add a test case with `pins: [{ round: Number.NaN, foursome: 1, playerId: 'p0' }]` (and/or `round: 1.5`) asserting no throw and that a warning is emitted.

2. [high] Missing validation for numRounds and foursomeSize can throw (negative/0/NaN) despite spec stating ≥1 / positive
   - File: apps/tournament-api/src/engine/pairings/suggest.ts:94-140
   - Confidence: high
   - Why it matters: The spec/contract states `numRounds ≥ 1` and `foursomeSize` is positive. Without runtime validation, callers can pass `numRounds < 0` which causes `Array.from({ length: numRounds })` to throw a RangeError, or `foursomeSize = 0/NaN` which can produce `Infinity/NaN` sizes and crash when allocating `pinnedSlots`. This is likely to become user-controlled once T4-2 wires it to an API route.
   - Suggested fix: Add early guards: if `!Number.isInteger(numRounds) || numRounds < 1` return `{ grid:{rounds:[]}, warnings:[...] }`; similarly validate `foursomeSize` is an integer >= 1. Add tests for these bad inputs asserting no throw and stable warnings (even if not explicitly called out in current ACs, it prevents runtime crashes in API usage).

3. [medium] Warning ordering may drift from spec for pin-related warnings that are described as “per-round”
   - File: apps/tournament-api/src/engine/pairings/suggest.ts:133-178
   - Confidence: medium
   - Why it matters: The story doc’s warning ordering says: input-validation warnings first (pin processing in input order), then per-round warnings in round order, then post-fill `pair-not-met` sorted. This implementation emits all pin warnings (including `overflowed` and `pinned to multiple foursomes in round`) strictly in input array order during pin processing, not grouped by round. If callers/tests later depend on the documented ordering (e.g., UI displays grouped warnings), this will be a contract mismatch even though output remains deterministic.
   - Suggested fix: If the spec’s “per-round warning ordering” is meant to be strict, collect pin warnings that are round-specific into a per-round bucket and append them in round order after validation, or explicitly amend the spec to state pin warnings are emitted in pin-input order. Add a test that uses pins out of round order and asserts warning order, if ordering is contract-critical.

## Strengths

- Pure, deterministic implementation: no I/O imports, no Date.now/Math.random, warnings and grid construction are stable given roster/pin order (AC #1, #3, #11).
- Canonical 8×4×4 fixture path matches spec trigger (pins undefined/[] both work) and Test A asserts both the golden schedule and full pair coverage with empty warnings (AC #2).
- Greedy fallback matches stated heuristic (minimize max pair meetings with already-placed players; roster order tie-break) and correctly skips `pair-not-met` warnings for `constraint: 'custom'` (AC #7).
- Pins handling covers unknown player, out-of-range, duplicate player pinned to multiple foursomes in same round, and per-foursome overflow with warnings and no throws for those cases (AC #4/#5), and tests A–I exist (AC #8).

## Warnings

None.
