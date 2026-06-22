# Codex Review

- Generated: 2026-06-22T15:46:33.703Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/2-3-polie-modifier.md, apps/tournament-api/src/engine/games/modifiers/greenie.ts, apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/types.ts, apps/tournament-api/src/engine/games/compute-foursome.ts

## Summary

Spec is largely aligned with the shipped greenie template and the current engine architecture (pure resolver, folded into `pts`, no new split path, fail-closed config validation). The two embedded goldens are internally consistent with the count-based TEAM-point model and the post-2.1a whole-dollar 1-to-1 edge layout.

Main issues are: (1) a likely-incorrect/ambiguous fast-check property definition (uses `Σ|rawA|` without PV/sign considerations); (2) an internal contradiction on the FD-1/FD-2 path allowlist (spec claims apps/tournament-api only but lists `_bmad-output/**` edits); and (3) ambiguity around exact fail-closed reason strings + whether unknown variant keys (for direct callers bypassing Zod) must be rejected to truly meet FR44 as the spec describes.

Overall risk: medium

## Findings

1. [medium] Property test definition for polie additivity appears incorrect/ambiguous (uses Σ|rawA| without PV/sign)
   - File: _bmad-output/implementation-artifacts/tournament/2-3-polie-modifier.md:69-102
   - Confidence: high
   - Why it matters: AC9/Task 6 defines a new fast-check property: `Σ_holes |rawA_polie| ... equals the polie-only point contribution` (lines 69-71, 99-102). In the shipped engine, money impact is not `Σ|rawA|` in “points”; it is per-hole and PV-weighted:
- per-player cents from polie on a hole should be `rawA * pointValueCents(holeNumber)` (signed), and
- ledger total contribution should be `2 * |rawA| * pointValueCents(holeNumber)` (because there are 4 cross-cells each `pts * pv/2`).
Using absolute raw points also breaks when signs cancel across holes: `rawA = +2` then `rawA = -2` gives `Σ|rawA|=4` but net points sum to 0. If implemented literally, the property will either fail spuriously or (worse) incentivize an incorrect implementation to satisfy a bad invariant.
   - Suggested fix: Rewrite the property in cents and per-hole terms. E.g. compute expected polie-only delta independently as:
- `expectedPerPlayerDelta[a] += rawA * pv`, `expectedPerPlayerDelta[b] -= rawA * pv` for complete holes, and/or
- `expectedTotalCents += 2 * Math.abs(rawA) * pv`.
Then assert `ledger(perPlayerCents/totalCents)` changes match those expectations and remain invariant under hole shuffles.

2. [medium] FD-1/FD-2 scope contradiction: spec says apps/tournament-api/** only, but planned edits include _bmad-output/**
   - File: _bmad-output/implementation-artifacts/tournament/2-3-polie-modifier.md:73-176
   - Confidence: high
   - Why it matters: AC11 says “All work is `apps/tournament-api/**` only (FD-1/FD-2)” (line 75), but the “Files this story will edit” list includes `_bmad-output/implementation-artifacts/tournament/2-3-polie-modifier.md` and `.../sprint-status.yaml` (lines 174-176), which are outside `apps/tournament-api/**`. If the gate is strict (as your review request states), this is a process/path allowlist violation or at least an ambiguity in what “work” includes.
   - Suggested fix: Clarify the boundary explicitly:
- Either (a) amend AC11 to allow documentation/status updates outside `apps/tournament-api/**`, or
- (b) move/duplicate the spec artifact into an allowed path, or
- (c) state that code changes must be confined to `apps/tournament-api/**`, while spec/status files are exempt (if that’s the intended interpretation).

3. [medium] Fail-closed ACs specify reason strings that may not match the shipped validator conventions; exact expected reasons are underspecified
   - File: _bmad-output/implementation-artifacts/tournament/2-3-polie-modifier.md:58-98
   - Confidence: high
   - Why it matters: AC10 and Task 5 require specific rejection reasons like `unsupported_polie_variant:<key>` and `unsupported_greenie_variant:polieScope` / `unsupported_net_skins_variant:polieScope` (lines 71-72, 97). The shipped `validateResolvedConfig` uses a mix of formats, e.g. `unsupported_greenie_variant:basis=<value>` and `unsupported_net_skins_variant:${basis}/${bonus}` / `unsupported_net_skins_variant:carryover` (apps/tournament-api/src/engine/games/registry.ts lines 119-127, 133-145). If tests assert exact strings (as 2.2 goldens/guards often do), this spec leaves too much room for drift and inconsistent error surfacing across modifiers.
   - Suggested fix: In AC10, pin the exact reason formats to be implemented (including whether values are included, e.g. `basis=<val>` vs just `basis`). Align polie’s rejection format with existing patterns (either mirror greenie’s `unsupported_<mod>_variant:<key>=<val>` style or define a consistent new convention and update tests accordingly).

4. [medium] FR44 “fail closed” for direct callers is incomplete unless unknown variant keys are also rejected (not just misplaced shared keys)
   - File: _bmad-output/implementation-artifacts/tournament/2-3-polie-modifier.md:71-72
   - Confidence: medium
   - Why it matters: The spec leans heavily on FR44 and the registry’s “direct caller bypassing Zod” threat model (see existing registry commentary and guards). However, AC10’s allowlist only discusses rejecting known shared keys (`basis/bonus/carryover/polieScope`) when they appear on the wrong enabled modifier. It does not state what happens if an enabled modifier’s `variant` object contains extra unknown keys (possible for direct callers bypassing Zod `.strict()`). In the shipped validator, there is no generic unknown-key rejection—only targeted checks—so a direct caller could pass `{type:'greenie', enabled:true, variant:{carryover:true, futureKey:'x'}}` and be accepted. If you consider that a FR44 violation, polie should not extend the same gap.
   - Suggested fix: Add an explicit AC: for any ENABLED modifier, `Object.keys(variant)` must be a subset of the globally-known variant keys, and optionally also a subset of the per-modifier allowed keys. Implement by enumerating allowed keys and rejecting any others with a clear reason like `unsupported_<mod>_variant:unknown_key:<k>`.

5. [low] Money semantics phrasing could be misread: “each polie point is worth hole PV” should clarify per-player vs ledger total
   - File: _bmad-output/implementation-artifacts/tournament/2-3-polie-modifier.md:61-65
   - Confidence: high
   - Why it matters: AC6 says “Each polie point is worth the hole's `pointValueCents`” (line 64). In this engine, a +1 `pts` results in each A player netting `+pv` and each B player `-pv`, while ledger total (sum of abs cross cells) moves by `2*pv`. The spec’s goldens correctly use per-player `pv` (Fixture 1 line 121), but the phrasing could lead a dev to assert the wrong ‘total pot’ in tests or documentation.
   - Suggested fix: Add a one-liner formula in AC6 or Dev Notes: “Per hole: each A player nets `rawA*pv`; ledger total increases by `2*|rawA|*pv`.”

## Strengths

- Clear stateless model statement (rawA = #A − #B) and explicit ‘any hole’ (non-par-3) distinction vs greenie (lines 17-22, 63-64).
- Golden fixtures are internally consistent with the current `computeFoursome` point→cents math and 2.1a edge layout: Fixture 1’s +2 points at $5/pt implies +$10 per A player and ledger total $20, matching the 2v2 cross-matrix semantics (lines 108-123; compute-foursome.ts lines 72-75).
- Correctly scopes out gross-dependent bogey-or-better and proposes a fail-closed behavior instead of silently defaulting (lines 23-32, 58-59).
- Correctly calls out isolation/foreign-claims ignore (FR23) and insists on tests for it (lines 57-59, 93-94).
- Wiring plan (add polie points into `pts` before `pts===0` short-circuit) matches shipped greenie integration and ensures ‘all-push + polie’ still settles while ‘all-push + no polie’ yields empty edges (lines 64-70, 85-87).

## Warnings

None.
