# Codex Review

- Generated: 2026-06-22T17:28:20.102Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/2-4-sandie-modifier-par-vs-any-score-variant.md, apps/tournament-api/src/engine/games/modifiers/polie.ts, apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/types.ts, apps/tournament-api/src/engine/games/compute-foursome.ts

## Summary

Spec is largely well-aligned with the shipped 2.2/2.3 engine seams (stateless claim modifier, gross finite-guard, fold into per-hole `pts`, fail-closed per-modifier variant allowlist). The golden hand-calc math for Fixtures 1–2 appears internally consistent with the engine’s `pts * (pv/2)` split model, and the H3 bogey claim correctly creates the intended divergence between `par_or_better` and `any_score`.

Main risks are around (1) AC10 “exact reason strings” without specifying deterministic precedence when multiple stray keys are present, (2) property-test arb generation now that `ModifierVariant` gains a new key that must be rejected cross-modifier, and (3) brittleness/ambiguity in asserting an exact `SettlementEdge[]` layout if the edge-lowering canonicalization differs from the assumed post-2.1a 1-to-1 pairing.

Overall risk: medium

## Findings

1. [medium] AC10 requires exact reject reason strings but does not specify precedence when multiple unsupported variant keys are present
   - File: _bmad-output/implementation-artifacts/tournament/2-4-sandie-modifier-par-vs-any-score-variant.md:67-70
   - Confidence: high
   - Why it matters: The shipped validator returns on the *first* failing check (see existing `registry.ts` patterns). If a config includes multiple stray keys (e.g., `basis` + `carryover` + bad `sandieScore`), the observed reason becomes dependent on check order. Because AC10 demands “exact reason strings”, tests/clients can become brittle unless the spec pins a deterministic priority order (or explicitly allows any one of the applicable reasons).
   - Suggested fix: Either (a) specify a strict evaluation order for sandie’s allowlist checks (e.g., basis → bonus → carryover → polieBogeyOrBetter → sandieScore), and mirror that order in tests; or (b) loosen AC10 to allow any matching `unsupported_sandie_variant:*` reason when multiple stray keys are present, and keep unit tests to single-stray-key cases.

2. [medium] Property-test generator requirements are underspecified given new cross-modifier fail-closed key (`sandieScore`)
   - File: _bmad-output/implementation-artifacts/tournament/2-4-sandie-modifier-par-vs-any-score-variant.md:95-97
   - Confidence: medium
   - Why it matters: Adding `sandieScore` to `ModifierVariant` plus AC10’s cross-modifier rejection means any existing `fast-check` `configArb` that produces variant objects with “random extra keys” will start failing validation for reasons unrelated to sandie’s money logic. The spec says “extend `configArb` … (`sandieScore` random)” but doesn’t explicitly require that `sandieScore` only appears on the enabled sandie modifier and is absent everywhere else (unless intentionally testing rejection). This is a common source of noisy/red property tests after adding a new shared variant key.
   - Suggested fix: In AC9/Task 6, explicitly require: in the *valid-config* property arb, emit `sandieScore` only inside the sandie modifier’s variant, and ensure other modifiers’ variants never include `sandieScore` (unless generating invalid configs for dedicated validation tests). If you keep a separate invalid-config arb, add targeted cases for the AC10 stray-key rejections.

3. [low] Golden fixtures assert exact `SettlementEdge[]` amounts/directions but spec assumes a particular edge-lowering canonicalization
   - File: _bmad-output/implementation-artifacts/tournament/2-4-sandie-modifier-par-vs-any-score-variant.md:106-118
   - Confidence: medium
   - Why it matters: The hand-calc states exact edges `b1→a1` and `b2→a2` (lines 116–118). However, the engine’s core money accumulator (shown in `compute-foursome.ts`) produces a 2×2 cross matrix (each B owing each A). The final `SettlementEdge[]` depends on whatever “lowering to edges” strategy is implemented elsewhere. If that canonicalization ever differs (e.g., 4 edges instead of 2, or different pairing), the golden could fail even though per-player nets and ledger totals are correct.
   - Suggested fix: At spec-gate, confirm that the shipped edge-lowering for F1 games is indeed the post-2.1a 1-to-1 pairing by index (`teamA[i]↔teamB[i]`) and will remain stable. If stability is not guaranteed, revise AC1/Task 4 to assert (1) `perPlayerCents`, (2) `ledger.totalCents`, and (3) that edges sum correctly and are zero-sum, rather than asserting a specific minimal edge decomposition.

## Strengths

- Correctly mirrors shipped polie mechanics: stateless count model, gross finite-guard before comparison, and per-hole folding into existing `pts` before the `pts===0` short-circuit (matches `compute-foursome.ts` behavior).
- Clear statement that the ONLY lever is `sandieScore ∈ {par_or_better, any_score}` with default `par_or_better`, and that gating is on GROSS vs par (not net), consistent with the 2.3 gross-threading design.
- Golden hand-calc math is consistent with the engine’s split formula: for pv=500, rawA=+2 ⇒ per-player ±1000 and ledger total 2000; rawA=+1 ⇒ per-player ±500 and ledger total 1000; the H3 bogey claim cleanly proves divergence.
- Good fail-closed framing (variant allowlist + cross-modifier stray key rejection) and explicit JS-coercion hazard callout (`null <= par`), aligning with existing `registry.ts` and polie’s `isBogeyOrBetter` guard.

## Warnings

None.
