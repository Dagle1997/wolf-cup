# Codex Review

- Generated: 2026-06-22T16:36:15.954Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/2-3-polie-modifier.md, apps/tournament-api/src/engine/games/modifiers/greenie.ts, apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/types.ts, apps/tournament-api/src/engine/games/compute-foursome.ts, apps/tournament-api/src/services/games-money.ts

## Summary

The reworked spec is largely coherent with the existing engine shape: polie is a stateless, per-hole count-based team-point award folded into `pts`, with an optional GROSS bogey-or-better gate. The golden fixture math (Fixtures 1–3) is internally consistent with the count model and the post-2.1a whole-dollar 1-to-1 edges.

Main risks are (1) the gross-gate’s “gross present” definition not being robust against non-numeric/null runtime values (which would violate the intended fail-closed behavior), and (2) service-level coverage: the spec’s proposed service test (“base money unchanged”) does not actually prove gross is threaded correctly or that the bogey-or-better toggle works end-to-end through `services/games-money.ts` (a likely real-world failure mode would silently void all gated polies). There’s also a small consistency concern in the proposed validation reason strings vs shipped 2.2 conventions.

Overall risk: medium

## Findings

1. [high] Gross-gate eligibility is underspecified for non-numeric/null gross values; can violate intended fail-closed behavior via JS coercion
   - File: _bmad-output/implementation-artifacts/tournament/2-3-polie-modifier.md:63-99
   - Confidence: high
   - Why it matters: AC5 defines eligibility as “gross present AND gross ≤ par+1” and Task 2 repeats this as `hole.gross?.[p] present AND ≤ hole.par + 1` (AC5 at line 63; Task 2 at lines 87–89). But “present” is not the same as “valid number” at runtime.

This is money-bearing. If `gross` is ever `null`/string/NaN (possible when sourced from DB rows or unvalidated callers), JS comparisons can behave unexpectedly (e.g., `null <= 5` is `true`), causing an ineligible polie to COUNT even though the spec intends fail-closed (“absent gross under the gate = voided”).

The spec explicitly frames this as fail-closed, so allowing coerced non-numbers would be a correctness/safety regression relative to the stated model.
   - Suggested fix: Tighten the eligibility rule in the spec (and require tests) to treat gross as eligible only if it is a finite number (and ideally an integer > 0):
- `const g = hole.gross?.[p]; eligible = isChecked && (!gate || (Number.isFinite(g) && Number.isInteger(g) && g <= par+1))`.
- Add an explicit unit test: gate ON + `gross: {p: null as any}` and/or `gross: {p: '6' as any}` must VOID (fail-closed).

2. [high] Service-layer test plan does not prove gross is actually threaded/populated correctly (risk: all gated polies void in production)
   - File: _bmad-output/implementation-artifacts/tournament/2-3-polie-modifier.md:91-95
   - Confidence: high
   - Why it matters: The story’s production path depends on `services/games-money.ts` populating `holeState.gross` (Task 3b, line 91). If that population is missing/incorrect (wrong holeNumber mapping, missing players, etc.), then under `polieBogeyOrBetter:true` every checked polie can become “absent gross → voided” (AC5), producing systematically wrong money while still passing engine-only goldens (because goldens hand-supply `gross`).

The spec’s only explicit service test requirement is “assert base money unchanged on a fixture with gross attached but polie off” (line 91). That test does not validate:
- that `gross` is present when expected,
- that it is correctly keyed by holeNumber/playerId,
- that the gate actually flips settlement when driven through the real service path.

Given the spec’s own emphasis on money safety and fail-closed behavior, this is a realistic gap that could make Josh’s golden expectations wrong in real recompute-on-read behavior.
   - Suggested fix: Add a required service-level test that exercises the full pipeline:
- Create a minimal DB fixture with holeScores.grossStrokes for all 4 players on at least one hole, plus claim writes for a polie.
- Run `computeF1EventEdges` twice with identical pinned inputs except `polieBogeyOrBetter` toggle.
- Assert the edges differ exactly as expected (and that when ON, an eligible gross (≤ par+1) polie counts). Also directly assert that the HoleState passed to the engine contains `gross[playerId] === grossStrokes` for that hole.

Keep the existing “base money unchanged” regression test as well, but don’t rely on it alone.

3. [medium] Proposed validation reason string `unsupported_polie_variant:bogey_or_better_type` is not well-aligned to shipped 2.2 naming conventions
   - File: _bmad-output/implementation-artifacts/tournament/2-3-polie-modifier.md:71-75
   - Confidence: medium
   - Why it matters: AC10 requires “exact reason strings consistent with the shipped 2.2 conventions” (line 71). In shipped 2.2, type-mismatch reasons name the actual key (e.g., `unsupported_greenie_variant:carryover_type` in registry.ts line 143–145). The proposed polie string uses a shortened/renamed key fragment: `unsupported_polie_variant:bogey_or_better_type` (line 72), which doesn’t match the actual variant key name `polieBogeyOrBetter` (AC3 / Task 1).

This isn’t just cosmetic: you’re explicitly gating on exact strings and reusing a known pattern. A mismatched naming convention increases the odds of inconsistent errors across modifiers and brittle tests/diagnostics as more variants are added.
   - Suggested fix: Either:
- Rename the reason to mirror the established pattern: `unsupported_polie_variant:polieBogeyOrBetter_type`, or
- Explicitly justify (in the spec) why polie is the one exception and ensure all tests assert the chosen string.

Also consider whether cross-modifier rejection strings should include `=true/false` (like basis/bonus do) or remain key-only; be consistent across modifiers.

## Strengths

- The count-based per-player checkbox model is clearly stated and matches the existing “team point” semantics used by base + greenie (spec lines 17–21, 63–66).
- The gross gate is explicitly defined on GROSS (≤ par+1) and the fail-closed rule is stated (AC5 line 63), which is the right safety stance for a money engine.
- Wiring plan (fold into existing `pts` before the `pts===0` short-circuit) correctly reuses the settled split path and preserves NFR-C7 (AC6 line 64; compute-foursome shows the same pattern for greenie at lines 62–66).
- Per-modifier variant allowlist approach is consistent with the existing shipped validator pattern in `registry.ts` (registry.ts lines 110–146), and the spec correctly notices that adding a shared variant key requires cross-modifier rejection (AC10 lines 71–75).
- Golden fixtures 1–3 math is internally consistent with the stated model and whole-dollar 1-to-1 edges (spec lines 118–140).

## Warnings

None.
