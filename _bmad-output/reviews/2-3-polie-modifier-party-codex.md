# Codex Review

- Generated: 2026-06-22T17:17:28.703Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/2-3-polie-modifier-party-review.md, apps/tournament-api/src/engine/games/modifiers/polie.ts, apps/tournament-api/src/services/games-money.ts

## Summary

The party-mode written review is largely consistent with the provided implementation for the core Story 2.3 behaviors (stateless count model, gross-based bogey-or-better gate with coercion-safe guard, and service-layer threading of per-hole gross sourced from `grossStrokes`). However, the review makes several definitive claims about tests, allowlist enforcement, and “proven” base-money-neutrality that are not verifiable from the provided files/diff; those should be softened or backed with concrete references (test paths/IDs) to avoid accidental false assurance.

Overall risk: medium

## Findings

1. [medium] Review asserts extensive unit/E2E test coverage that is not evidenced in provided code
   - File: _bmad-output/reviews/2-3-polie-modifier-party-review.md:35-40
   - Confidence: high
   - Why it matters: This artifact is being used as a verification/signoff document. Claims like “24 resolver unit tests… DB-backed end-to-end service test… proving the gross gate works through computeF1PerPlayerNet” (lines 35–38) are not confirmable from the provided diff/files (no test files shown). If those tests don’t exist (or don’t cover what’s stated), the review becomes a false-positive safety signal and could mask regressions in the gross gate path.
   - Suggested fix: Either (a) add citations in the review (exact test file paths + test names, or a commit hash/PR link), or (b) rephrase to non-assertive language (e.g., “intended/expected coverage includes…”) unless the tests are directly referenced and confirmed.

2. [low] Allowlist/foreign-lever rejection claims are not verifiable from shown implementation
   - File: _bmad-output/reviews/2-3-polie-modifier-party-review.md:23-24
   - Confidence: medium
   - Why it matters: The review claims “registry allowlist” behavior such that “polie rejects foreign levers; greenie/net-skins reject polieBogeyOrBetter” (line 23). In the provided `polie.ts`, `polieBogeyOrBetter()` simply reads `m?.variant?.polieBogeyOrBetter ?? false` (apps/tournament-api/src/engine/games/modifiers/polie.ts:34–37) and does not itself enforce an allowlist; such enforcement would have to live in `parseGameConfig` / schema code (not provided). If the schema is permissive, the review’s security/fail-closed assertions could be overstated.
   - Suggested fix: In the review, qualify this as “enforced by parseGameConfig/schema (not shown here)” and/or add a concrete pointer to the schema rule that rejects unknown modifier variants/keys.

3. [low] “Base-money-neutral proven” claim is only partially supported by provided files
   - File: _bmad-output/reviews/2-3-polie-modifier-party-review.md:21-22
   - Confidence: medium
   - Why it matters: The service change clearly threads `gross` alongside `net` into `HoleState` (apps/tournament-api/src/services/games-money.ts:411–454), and `polie.ts` consumes `hole.gross` only for the gate (apps/tournament-api/src/engine/games/modifiers/polie.ts:48–53). But the statement that “base game + greenie ignore it → base-money-neutral” and that neutrality is “proven” by “golden gate + service test” (review line 21–22) can’t be confirmed without seeing `computeFoursome` / other modifiers and the referenced tests. The core neutrality argument is plausible, but “proven” is stronger than the evidence provided here.
   - Suggested fix: Soften wording to “intended/expected to be base-money-neutral because existing logic uses net/par/claims” unless you cite the exact code sites/tests demonstrating `gross` is ignored by base/greenie paths.

## Strengths

- Polie modifier implementation matches the described stateless, count-based team point model: `poliePoints` computes `#eligibleA - #eligibleB` and self-guards on inactive config (apps/tournament-api/src/engine/games/modifiers/polie.ts:61–74).
- Gross-based bogey-or-better gate and coercion safety are correctly reflected: the finite-number guard precedes comparison (apps/tournament-api/src/engine/games/modifiers/polie.ts:39–46) and eligibility checks gate on `hole.gross` not `net` (lines 48–53).
- Service-layer change matches the review’s description of sourcing gross directly from scorer-entered `grossStrokes` and emitting it per-hole into `HoleState` (apps/tournament-api/src/services/games-money.ts:413–454).
- Optional followups are correctly characterized as not implemented in the shown code: there is no additional service-side gross type-guard, and `par: parByHole.get(holeNumber) ?? 0` remains (apps/tournament-api/src/services/games-money.ts:453).

## Warnings

None.
