# Gemini Review

- Generated: 2026-06-22T18:51:25.180Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/games/modifiers/polie.ts, apps/tournament-api/src/engine/games/modifiers/polie.test.ts, apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/types.ts, apps/tournament-api/src/engine/games/config-schema.ts, apps/tournament-api/src/engine/games/polie.golden.test.ts, apps/tournament-api/src/engine/games/__fixtures__/polie-counts-regardless.json, apps/tournament-api/src/engine/games/__fixtures__/polie-anything.json, apps/tournament-api/src/engine/games/games.property.test.ts, apps/tournament-api/src/services/games-money.polie.test.ts, apps/tournament-api/src/engine/games/modifiers/sandie.test.ts

## Summary

The removal of the polie bogey-or-better gate is cleanly implemented. The engine correctly transitions to a pure-count model matching sandie, the tests accurately prove the behavioral shift (e.g., a double-bogey polie now counts), and the golden math is flawless. However, the strict removal of the `polieBogeyOrBetter` property from Zod schemas and validation creates a critical backwards incompatibility with existing configurations from Story 2.3 that are currently in the database.

Overall risk: high

## Findings

1. [high] Backward incompatibility with existing DB configurations (Breaks settlement)
   - File: apps/tournament-api/src/engine/games/registry.ts:155-160
   - Confidence: high
   - Why it matters: The system now explicitly rejects any variant keys for the polie modifier (via Zod's `.strict()` and `Object.keys(m.variant)` in `validateResolvedConfig`). Since Story 2.3 shipped with the `polieBogeyOrBetter` lever, live `config_json` records in the database contain `variant: { polieBogeyOrBetter: true/false }`. Reading these existing configurations will fail validation, rendering any previously created tournament with polie enabled completely unsettleable.
   - Suggested fix: If a DB migration to strip the `polieBogeyOrBetter` key from all `config_json` payloads was intentionally omitted from this PR, ensure it is added. Otherwise, to safely support existing data without a migration, retain `polieBogeyOrBetter` in the Zod schema and `ModifierVariant` type as a deprecated optional boolean, and explicitly ignore it in `validateResolvedConfig` (e.g., by filtering it out before checking `keys.length > 0`).

## Strengths

- Excellent test coverage maintaining NFR-C3/C6 invariants, with new assertions explicitly proving that non-finite/worse-than-bogey gross no longer voids the claim.
- `poliePoints` correctly ignores the retained `gross` state, aligning perfectly with the stateless sandie count model.
- Unified fail-closed validation in `registry.ts` for sandie and polie is an elegant refactor.
- Golden fixtures correctly identify and assert the $5/side impact caused by stripping the gate.

## Warnings

None.
