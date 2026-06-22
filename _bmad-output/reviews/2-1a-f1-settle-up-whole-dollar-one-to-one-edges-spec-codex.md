# Codex Review

- Generated: 2026-06-22T12:01:42.036Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/2-1a-f1-settle-up-whole-dollar-one-to-one-edges.md

## Summary

Spec directionally solves the half-dollar leg UX by collapsing the symmetric 2v2 ledger into two 1-to-1 payments while keeping per-player nets + total unchanged. The core math is sound *if* within-team symmetry and team slot ordering are true invariants. The current spec under-specifies those invariants (especially “whole-dollar” and “slot” ordering) and introduces a new throw-path that could break settlement flows unless callers explicitly handle it or the behavior is gated to only the intended game.

Overall risk: medium

## Findings

1. [high] AC2 “whole-dollar guarantee” is not actually guaranteed unless pointValueCents is constrained to whole dollars
   - File: _bmad-output/implementation-artifacts/tournament/2-1a-f1-settle-up-whole-dollar-one-to-one-edges.md:28-30
   - Confidence: high
   - Why it matters: AC2 claims each emitted edge is “always a whole-dollar (even-cents) figure” because it is `integer points × pointValueCents`. That only implies “whole-dollar” if `pointValueCents` is itself a multiple of 100. If the rules ever allow point values like 50¢/pt (or any non-$1 increment), the new edges will still be fractional dollars (e.g., $1.50), undermining the stated guarantee and potentially reintroducing confusing amounts (just not the pv/2 half-split). This is a money-story acceptance criterion mismatch: either the guarantee is wrong, or the engine must validate/enforce PV granularity.
   - Suggested fix: Either (a) tighten the invariant: explicitly state/validate `pointValueCents % 100 === 0` for F1 2v2 and throw if violated, or (b) relax AC2 wording to the real goal: “no pv/2 split legs; edges equal the full per-player amount,” without claiming whole-dollar unless PV is constrained.

2. [high] Slot-paired 1-to-1 edges depend on teamA/teamB index ordering being a stable, user-meaningful invariant (not specified)
   - File: _bmad-output/implementation-artifacts/tournament/2-1a-f1-settle-up-whole-dollar-one-to-one-edges.md:28-31
   - Confidence: medium
   - Why it matters: The new behavior changes *who pays whom* (even if net amounts are unchanged) by pairing `teamA[i]↔teamB[i]`. If `teamA`/`teamB` ordering is not stable or not tied to a real-world “slot” concept, the app may tell players the wrong person to pay (e.g., swapped winners), which is a money-settlement UX correctness issue. Symmetry means any pairing preserves per-player nets, so tests that only assert net reconstruction won’t catch this; players will.
   - Suggested fix: Define and enforce what “slot” means (e.g., preserve input roster order; never sort by ID; or explicitly sort by tee-order). Add a test that asserts deterministic pairing identity given a known roster order (not just cents). If ordering is not guaranteed today, consider choosing pairing by a deterministic rule that matches UX (e.g., pair by original participant list order) and document it.

3. [medium] AC4 introduces a new throw-path; spec does not define how higher layers handle `asymmetric_2v2_ledger` vs existing “unsettleable” behavior
   - File: _bmad-output/implementation-artifacts/tournament/2-1a-f1-settle-up-whole-dollar-one-to-one-edges.md:31-35
   - Confidence: medium
   - Why it matters: Today’s 4-leg lowering would still produce internally consistent edges for an asymmetric ledger (it just wouldn’t have the desired symmetry/UX). After this change, the same input would hard-throw, potentially turning a settle-up into a 500 / broken screen unless callers catch and map this error. The spec asserts throwing is desired (“fail-closed”), but doesn’t specify the contract: is this surfaced as an “unsettleable game” state, logged and skipped, or fatal?
   - Suggested fix: Specify the expected handling path for `asymmetric_2v2_ledger` at the `games-money.ts` call site (named at line 66): e.g., convert to the existing unsettleable outcome, or fall back to the old 4-leg lowering when asymmetry is detected (if you want graceful degradation). If throwing remains the intent, add an integration test that proves the API returns the expected error shape/status and doesn’t corrupt any persisted settlement state.

4. [medium] Symmetry assumption is asserted but not bounded: future per-player modifiers (or config variants) could break it and cause new failures
   - File: _bmad-output/implementation-artifacts/tournament/2-1a-f1-settle-up-whole-dollar-one-to-one-edges.md:22-32
   - Confidence: medium
   - Why it matters: The design relies on “compute-foursome always adds the same half to all four cross cells” (lines 24, 60). If any future F1 variant introduces per-player-only debits/credits (greenie-like, penalties, side pots), symmetry breaks. Your guard will then start throwing in production for those variants unless ledgerToEdges is explicitly scoped to only the symmetric game types. The spec currently says “Cannot trigger for guyan-2v2; it is a guard, not a live path” (line 31), which is a strong claim but not enforceable unless you gate behavior by gameType/ruleset or prove symmetry by construction.
   - Suggested fix: Add an explicit precondition in the implementation plan: apply 2-leg lowering only for the intended symmetric F1 2v2 ruleset(s), otherwise keep the generic 4-leg lowering. Also add a regression test that builds a representative compute-foursome output for each supported F1 2v2 config and asserts within-team symmetry (or, minimally, asserts ledgerToEdges does not throw for all shipped fixtures/configs).

## Strengths

- AC3/AC4 correctly focus on conservation + reconstruction (money correctness) rather than just cosmetic edge count changes (lines 30–31).
- Including an explicit asymmetry guard is the right defensive move to prevent silent mis-settlement if the symmetry invariant ever changes (line 31).
- Test plan calls for both golden updates and targeted unit tests including an intentionally asymmetric ledger case (lines 40–42), which is appropriate for a money story.

## Warnings

None.
