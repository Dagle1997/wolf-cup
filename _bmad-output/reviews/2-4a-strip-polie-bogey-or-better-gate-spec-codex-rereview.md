# Codex Review

- Generated: 2026-06-22T18:36:44.754Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/2-4a-strip-polie-bogey-or-better-gate.md, apps/tournament-api/src/engine/games/config-schema.ts, apps/tournament-api/src/engine/games/registry.ts

## Summary

Confirmed: `config-schema.ts` uses Zod `.strict()` on the variant object, the modifier object, and the full GameConfig, so unknown keys are rejected (not stripped). The Story 2.4a spec is largely complete/build-safe (types/schema/registry/tests/fixtures + grep gate are all accounted for). One remaining potential blocker is a defense-in-depth regression for *direct callers bypassing Zod*: removing the explicit `polieBogeyOrBetter` cross-rejections from `greenie`/`net-skins` means `validateResolvedConfig` will no longer fail-closed on that now-“unknown” key for those modifiers unless you add a generic unknown-key guard (or accept the documented deferred gap).

Overall risk: medium

## Findings

1. [medium] Direct-caller fail-closed regression risk when removing greenie/net-skins `polieBogeyOrBetter` cross-rejections
   - File: apps/tournament-api/src/engine/games/registry.ts:117-191
   - Confidence: high
   - Why it matters: Today, `validateResolvedConfig` explicitly rejects `polieBogeyOrBetter` when it appears under enabled `net-skins` (lines 130–133) or enabled `greenie` (lines 152–155). The spec proposes removing those checks (because the key is removed from the schema/types). After that removal, a *direct caller* that bypasses `parseGameConfig` could pass `{ variant: { polieBogeyOrBetter: true } }` on net-skins/greenie and it would likely be silently ignored (since those branches don’t do an `Object.keys` unknown-key scan). This is a real reduction in defense-in-depth compared to current behavior, even if production writes are protected by Zod `.strict()`.

The spec acknowledges a “general-engine unknown-key gap deferred since 2.2/2.3”, but removing these explicit checks re-opens that gap for a key that was previously covered.
   - Suggested fix: If you want to preserve the existing direct-caller fail-closed posture, add a generic unknown-key rejection for enabled `greenie` and `net-skins` variants (e.g., `const keys = Object.keys(m.variant ?? {})` and allow-list the known keys for that modifier; reject any others). Alternatively, explicitly document/accept that direct-caller configs are no longer fail-closed for this case and ensure no code path can reach settlement without `parseGameConfig` + `validateResolvedConfig`.

## Strengths

- Zod `.strict()` is clearly in place for variant/modifier/config objects, supporting the spec’s “reject unknown keys (not strip)” claim: `variant: z.object(...).strict()` (config-schema.ts:27–35), `modifierSchema...strict()` (18–37), `gameConfigSchema...strict()` (45–55).
- Spec explicitly enumerates all expected deletions/updates (types, schema, registry, fixtures, goldens, property arb, unit + e2e tests) and adds a grep gate to prevent dangling references to the removed key.
- Registry change for polie to “no-lever” with `Object.keys(variant)[0]` mirrors sandie’s already-shipped pattern and closes the direct-caller unknown-key hole for polie specifically.

## Warnings

None.
