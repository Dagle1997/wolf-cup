# Codex Review

- Generated: 2026-04-27T20:49:42.858Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T4-1-pairings-suggest-engine.md

## Summary

Spec is generally detailed and deterministic, but there are a few internal inconsistencies/underspecified behaviors that could cause the implementation/tests to diverge from the intended contract—especially around function signature, `'custom'` warning behavior, sit-out wording, and pin/sit-out feasibility edge cases.

Overall risk: medium

## Findings

1. [high] Conflicting contract: story describes `suggestPairings(roster, numRounds, constraint, pins)` but AC requires `suggestPairings(input: SuggestPairingsInput)`
   - File: _bmad-output/implementation-artifacts/tournament/T4-1-pairings-suggest-engine.md:9-127
   - Confidence: high
   - Why it matters: Line 10 states a positional-args function signature, while AC #1 (lines 115-127) specifies an object-parameter signature and types. This can cause the dev agent to implement the wrong API shape or write tests against the wrong signature, creating avoidable rework and integration mismatch with T4-2.
   - Suggested fix: Pick one public signature and make it consistent everywhere. If the object input is intended (it appears to be), change Story line 10 to `suggestPairings(input)` and/or explicitly deprecate the positional signature.

2. [high] `constraint: 'custom'` behavior contradicts greedy fallback’s pair-coverage warning scan
   - File: _bmad-output/implementation-artifacts/tournament/T4-1-pairings-suggest-engine.md:67-169
   - Confidence: high
   - Why it matters: The greedy fallback section says that for all other shapes including `constraint: 'custom'` it will scan all pairs and add `"pair-not-met"` warnings for any unmet pair (lines 67-70). But AC #7 explicitly requires that for `'custom'` the algorithm does not enforce everyone-once and produces “no warnings about pair coverage” (lines 166-168). These requirements cannot both hold if the scan always runs.
   - Suggested fix: Gate the post-fill pair-coverage scan and `pair-not-met` warnings behind `constraint === 'everyone-once'` only. For `'custom'`, either skip the scan entirely or do it only for metrics (no warnings).

3. [medium] Derived sizing section claims “same roster.length players play every round” but sit-out logic contradicts it
   - File: _bmad-output/implementation-artifacts/tournament/T4-1-pairings-suggest-engine.md:27-39
   - Confidence: high
   - Why it matters: Line 27 says “the same `roster.length` players play every round,” but lines 31-40 define sit-outs when `roster.length` is not a multiple of `foursomeSize`, meaning not all rostered players play each round. This is an internal contradiction that could mislead implementation (e.g., assuming full participation per round).
   - Suggested fix: Reword line 27 to clarify that the roster list is constant across rounds, but only `playableSlots` players are scheduled each round when sit-outs exist.

4. [medium] Warnings + determinism contract is underspecified for ordering; spec also calls warning strings “stable contract”
   - File: _bmad-output/implementation-artifacts/tournament/T4-1-pairings-suggest-engine.md:74-101
   - Confidence: medium
   - Why it matters: The spec demands byte-for-byte identical output (lines 74-77) and declares warning strings as a stable contract (lines 90-101), but it does not specify the ordering of `warnings`. Some warning generation steps (notably the pair scan over C(n,2) pairs at line 70) can be implemented with nondeterministic iteration if using Sets/Maps or if pair enumeration order isn’t mandated, causing flaky golden tests and API instability.
   - Suggested fix: Specify warning ordering rules: e.g., warnings are appended in deterministic generation order, and pair warnings are emitted in roster index order (`i<j` nested loops) to ensure stable output. Consider specifying that `warnings` are not deduped unless explicitly stated.

5. [medium] Pins vs sit-out feasibility: spec references a “too many pins” overflow warning but no warning string/behavior is defined
   - File: _bmad-output/implementation-artifacts/tournament/T4-1-pairings-suggest-engine.md:33-89
   - Confidence: medium
   - Why it matters: Sit-out step (3) says if fewer than `sitOutCount` sit-outs are possible due to pinned players, that implies “too many pins” and claims “the overflow case from Risk §5 has already produced its warning” (line 38). But Risk §5’s warning enumeration covers per-foursome overflow and other pin validation issues, not the global feasibility case where the number of distinct pinned players in a round exceeds `playableSlots` (or equivalently, the required sit-outs cannot be satisfied). Without an explicit warning/behavior, implementations may diverge (drop some pins? reduce sit-outs? throw?) and tests won’t cover it.
   - Suggested fix: Define a concrete rule and warning for this global infeasibility, e.g., drop excess pins in deterministic order with a warning like `"round {r} pinned players exceed playable slots"`, or state that sitOutCount is reduced (and explain implications). Add/extend an AC/test if this matters.

6. [low] Spec says “No-permanent-benching guarantee… Tested explicitly” but no acceptance test covers that guarantee
   - File: _bmad-output/implementation-artifacts/tournament/T4-1-pairings-suggest-engine.md:41-181
   - Confidence: high
   - Why it matters: Line 41 claims the no-permanent-benching guarantee is “Tested explicitly,” but AC #8’s enumerated tests A–H do not include a test that checks that in the no-pins case with `numRounds * sitOutCount >= roster.length` every player sits out at least once (or equivalently no one is permanently benched). This creates a spec/AC mismatch and raises risk the guarantee won’t actually be enforced.
   - Suggested fix: Either (a) add an explicit acceptance test (e.g., “Test I — sit-out rotation covers all players when numRounds*sitOutCount >= roster.length”), or (b) remove/soften “Tested explicitly” language if it’s not an AC requirement.

## Strengths

- Clear separation of scope (pure function only) and explicit non-goals (no DB/I/O/routes/frontend).
- Deterministic, exact trigger for the 8×4×4 canonical fixture path, including the important `pins: []` vs `pins: undefined` nuance.
- Pin validation behaviors are mostly well specified (drop vs honor-first, overflow rules, idempotent duplicate triple).
- Acceptance criteria include concrete tests (A–H) and regression posture (baseline test counts, lint/typecheck/build constraints).

## Warnings

None.
