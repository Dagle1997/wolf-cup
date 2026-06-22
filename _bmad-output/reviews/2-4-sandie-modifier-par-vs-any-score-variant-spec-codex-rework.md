# Codex Review

- Generated: 2026-06-22T17:48:06.667Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/2-4-sandie-modifier-par-vs-any-score-variant.md, apps/tournament-api/src/engine/games/modifiers/polie.ts, apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/compute-foursome.ts

## Summary

Spec is largely consistent with the shipped engine layering (stateless per-hole term added to `pts` before the `pts===0` short-circuit; no gross read; no new config lever). Two concrete spec issues would likely make the NFR-C1 golden gate ambiguous/wrong before ratification: (1) AC1 claims the golden covers the “all four boxes checked ⇒ 0” case, but Fixture 1 as written does not include that case; (2) AC10’s “no variant” rule is phrased as “reject any variant key”, which still allows `variant:{}` for enabled sandie—this may be OK, but it conflicts with the stronger “carries NO variant” wording and should be clarified so validator/tests match intent. Also, AC10’s stated deterministic precedence among keys should explicitly acknowledge the existing earlier `invalid_variant_shape` guard precedence to avoid mismatched expectations.

Overall risk: medium

## Findings

1. [high] AC1 requires golden coverage of “all four sandie boxes ⇒ 0”, but Fixture 1 doesn’t include an all-four hole
   - File: _bmad-output/implementation-artifacts/tournament/2-4-sandie-modifier-par-vs-any-score-variant.md:48-113
   - Confidence: high
   - Why it matters: AC1 explicitly states the golden fixture asserts the count model including “all four → 0” (line 48). The Dev Notes hand-calc / Fixture 1 table only covers: A-only (+1), both A (+2), B-only (−1), and contested one-each (0) (lines 103–109). If the golden fixture is used as the NFR-C1 approval artifact, it currently cannot prove the all-four behavior end-to-end, and the spec is internally inconsistent about what the golden must demonstrate versus what unit tests cover. This is exactly the kind of gap that can lead to a later disagreement at the spec gate (Josh approves numbers that don’t actually include all declared cases).
   - Suggested fix: Either (a) add a 5th hole to Fixture 1 with all four boxes checked (rawA=0) and keep totals unchanged, or (b) narrow AC1 to only require the cases actually present in the golden and push “all four ⇒ 0” to the unit-test-only list (Task 5). Make AC1/Dev Notes/fixture content match exactly.

2. [medium] “No variant” rule is ambiguous: AC10 rejects known variant keys but still allows `variant:{}` for enabled sandie
   - File: _bmad-output/implementation-artifacts/tournament/2-4-sandie-modifier-par-vs-any-score-variant.md:53-67
   - Confidence: high
   - Why it matters: The story narrative and AC3 describe sandie config as `{ type:'sandie', enabled }` with “NO variant” (lines 27–28, 53). But AC10’s enforcement is keyed to presence of specific variant keys (basis/bonus/carryover/polieBogeyOrBetter) (line 66). Under that rule, `enabled` sandie with `variant: {}` passes validation. That may be acceptable (and consistent with the engine’s general “variant optional” shape), but it conflicts with the stronger wording “carries NO variant” and can cause mismatched expectations between spec reviewers, tests, and future config generators.
   - Suggested fix: Clarify explicitly one of:
- Permissive: “`variant` may be absent or `{}`; any of the known keys is forbidden.”
- Strict: “`variant` must be `undefined` when enabled; even `{}` rejects with `unsupported_sandie_variant:variant_present` (or similar).”
Then align Task 1/AC10 and the planned fail-closed tests (Task 5) to that clarified contract.

3. [medium] AC10 deterministic precedence should acknowledge existing `invalid_variant_shape` guard precedence (or tests may expect the wrong error)
   - File: _bmad-output/implementation-artifacts/tournament/2-4-sandie-modifier-par-vs-any-score-variant.md:65-67
   - Confidence: high
   - Why it matters: `validateResolvedConfig` already has an early, shared guard that rejects enabled modifiers with non-object/array/null variants as `invalid_variant_shape:<type>` (apps/tournament-api/src/engine/games/registry.ts lines 97–110). AC10 states deterministic precedence among key checks (basis→bonus→carryover→polieBogeyOrBetter) for enabled sandie (line 66), but doesn’t explicitly state how that interacts with the existing earlier guard. Without that clarification, a config like `enabled sandie` + `variant: 'x'` will deterministically fail as `invalid_variant_shape:sandie`, not `unsupported_sandie_variant:basis` etc, and reviewers/test authors may encode incorrect expectations.
   - Suggested fix: Add one sentence to AC10 such as: “Precedence note: `invalid_variant_shape:sandie` (shared guard) still wins when `variant` is non-object; the key-order precedence applies only once `variant` is an object.” Then ensure Task 5 includes (or excludes) a test for non-object variants with the correct expected reason.

4. [low] Resolver responsibility for reading `{enabled}` is split between `sandieActive` and `sandiePoints`, but AC2 wording can be read as requiring the resolver itself to read config
   - File: _bmad-output/implementation-artifacts/tournament/2-4-sandie-modifier-par-vs-any-score-variant.md:50-80
   - Confidence: medium
   - Why it matters: AC2 says `modifiers/sandie.ts` “registers a pure resolver that counts … and reads `{enabled}`” (line 52). Task 2 then proposes `sandiePoints(hole, teamA, teamB)` with no `config` parameter, relying on `sandieActive(config)` gating the call (lines 76–79). That design is fine, but the spec language is ambiguous: someone could implement `sandiePoints` that does read config (polie-style self-guard) or one that doesn’t. Ambiguity here can ripple into tests and reuse patterns (e.g., direct callers using `sandiePoints` might forget the gate).
   - Suggested fix: Tighten AC2/Task 2 language to explicitly state which function is the self-guard:
- Option A (current Task 2): “`computeFoursome` must gate with `sandieActive`; `sandiePoints` assumes sandie is active.”
- Option B: make `sandiePoints(..., config)` self-guard like `poliePoints`.
Pick one and align tests accordingly.

## Strengths

- Model simplification is stated unambiguously (no score gate, no gross read, no variant lever) and consistently motivated by FR16 (spec lines 18–26).
- Layering matches shipped engine patterns: stateless modifier folded into per-hole `pts` before the `pts===0` skip (aligns with compute-foursome.ts lines 69–76).
- Fail-closed intent aligns with existing registry validator structure (apps/tournament-api/src/engine/games/registry.ts lines 111–178): only enabled modifiers are allowlist-checked; disabled modifiers remain inert.
- Golden math for Fixture 1 is internally consistent with the current `pts * (pv/2)` 2v2 split and whole-dollar PV constraint (registry.ts lines 44–56; compute-foursome.ts lines 78–88).

## Warnings

None.
