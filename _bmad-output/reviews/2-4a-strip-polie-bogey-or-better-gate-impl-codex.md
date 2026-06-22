# Codex Review

- Generated: 2026-06-22T18:49:51.812Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/games/modifiers/polie.ts, apps/tournament-api/src/engine/games/modifiers/polie.test.ts, apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/types.ts, apps/tournament-api/src/engine/games/config-schema.ts, apps/tournament-api/src/engine/games/polie.golden.test.ts, apps/tournament-api/src/engine/games/__fixtures__/polie-counts-regardless.json, apps/tournament-api/src/engine/games/__fixtures__/polie-anything.json, apps/tournament-api/src/engine/games/games.property.test.ts, apps/tournament-api/src/services/games-money.polie.test.ts, apps/tournament-api/src/engine/games/modifiers/sandie.test.ts

## Summary

The gate strip is implemented cleanly in the core money path: `poliePoints` is now a pure count (#A−#B) and no longer reads `hole.gross`; the config lever (`polieBogeyOrBetter`) is removed from engine types + Zod schema; and registry validation is updated to fail-closed on any non-empty `variant` for enabled polie/sandie. The new `polie-counts-regardless.json` golden math is internally consistent with the stated model ($5/pt, net=par base=0, polie sum +1 ⇒ +$5/side). The biggest risks I see are (1) backward compatibility for already-persisted configs containing `polieBogeyOrBetter` (now hard-rejected), and (2) loss of coverage that gross is correctly threaded end-to-end (since no shipped modifier consumes gross now).

Overall risk: medium

## Findings

1. [high] Breaking change: any existing persisted config_json with variant.polieBogeyOrBetter becomes unsettleable (Zod strict + semantic fail-closed)
   - File: apps/tournament-api/src/engine/games/config-schema.ts:18-36
   - Confidence: high
   - Why it matters: You removed `polieBogeyOrBetter` from the Zod `variant` object and kept `.strict()`. That means any stored `game_config.configJson` (or pinned `resolvedConfigJson`) that still contains `{"variant":{"polieBogeyOrBetter":...}}` will now fail parsing with a `zod:...:unrecognized_keys`-style error before it even reaches semantic validation. Even if Zod were bypassed, `validateResolvedConfig` now rejects any non-empty variant for enabled polie, so the config is also semantically invalid. Net effect: previously settleable historical rounds could become permanently “unsettleable” after deploy, which is a production money regression unless you also migrate/clean existing configs.
   - Suggested fix: If you need backward compatibility, consider a deprecation window:
- Allow `polieBogeyOrBetter` in the Zod schema (optional) but ignore it, and have `validateResolvedConfig` accept it (or accept-and-normalize by stripping it) while still rejecting any other variant keys.
- Or ship a DB/config migration that removes `polieBogeyOrBetter` from all stored/pinned configs before/with this deploy, and add a test proving old configs are migrated.
If you *intend* to break old configs, add an explicit release note + a targeted test that demonstrates the failure mode is surfaced as a clear reason.

2. [medium] Semantic validator no longer fails closed on stray `polieBogeyOrBetter` placed on other modifiers (direct-caller path)
   - File: apps/tournament-api/src/engine/games/registry.ts:117-160
   - Confidence: high
   - Why it matters: In 2.3 you explicitly rejected `variant.polieBogeyOrBetter` on net-skins and greenie. Those checks are removed, and there is no generic “unknown variant key” rejection for those modifiers—only specific checks for basis/bonus/carryover. In the normal production path, Zod `.strict()` will reject unknown keys, but `validateResolvedConfig` is documented as a direct-caller guard (it assumes callers might bypass Zod). With the current code, a direct caller can pass `net-skins` with `{ polieBogeyOrBetter: true }` and it will validate and settle, silently ignoring the key. That weakens the fail-closed story (FR44 / “misplaced lever must not be silently ignored”) even if the key is now “obsolete.”
   - Suggested fix: Either:
- Reinstate explicit rejection of `polieBogeyOrBetter` on net-skins/greenie (even if deprecated), or
- Add a generic allowlist check per modifier (e.g., for net-skins: only keys in {basis,bonus}; for greenie: only {carryover}; for sandie/polie: none), so *any* extra key is rejected in semantic validation too.

3. [medium] End-to-end gross-threading coverage was effectively removed; future gross-based modifiers (Story 2.5) could regress silently
   - File: apps/tournament-api/src/services/games-money.polie.test.ts:1-133
   - Confidence: medium
   - Why it matters: This test file originally proved that the service layer threaded per-hole gross into engine `HoleState.gross` by asserting money differences that depended on the gross gate. After 2.4a, the remaining assertions only check polie count money, which is independent of gross (by design). If `games-money.ts` stops populating gross, these tests will still pass. Since `HoleState.gross` is explicitly retained for Story 2.5, you’ve lost a safety net for the gross pipeline (a subtle, high-impact integration point when 2.5 ships).
   - Suggested fix: Add a focused test that validates gross is present in the engine input (or in whatever intermediate representation is available) even when no current modifier consumes it. Options:
- Factor out the “resolve holes to HoleState[]” logic and unit-test that `gross` is populated.
- Or add a temporary debug hook/return shape in the service computation used only in tests.
Also update the file header comment, which still describes the removed 2.3 gate behavior and is now misleading.

4. [low] Validation error reason string for polie variants changed shape (drops previous '=value' detail) — potential contract drift
   - File: apps/tournament-api/src/engine/games/modifiers/polie.test.ts:124-145
   - Confidence: medium
   - Why it matters: Previously, some polie variant failures returned reasons like `unsupported_polie_variant:basis=net` / `bonus=double`. After the registry merge, the reason is now `unsupported_polie_variant:basis` etc. If anything outside tests depends on the more specific reason format (logging, UI copy, analytics, alerting), this is a behavior change unrelated to the gate removal itself.
   - Suggested fix: Confirm no consumer depends on the old reason format. If they do, either preserve the old strings for polie (include value where applicable), or treat reason strings as opaque codes and adjust consumers accordingly.

## Strengths

- `poliePoints` is now correctly pure-count and self-guards via `polieActive`; it structurally ignores foreign claim keys and no longer reads `hole.gross` (apps/tournament-api/src/engine/games/modifiers/polie.ts:25-51).
- Registry change correctly enforces “no lever” for enabled polie/sandie by rejecting any non-empty `variant` object, while allowing absent/empty variant and allowing disabled modifiers to carry stray variants inertly (apps/tournament-api/src/engine/games/registry.ts:149-160; polie/sandie tests assert this).
- The new golden fixture `polie-counts-regardless.json` math is consistent with the stated model: polie sum +1 at $5 ⇒ per-player ±500c, total edges 1000c (apps/tournament-api/src/engine/games/__fixtures__/polie-counts-regardless.json:18-31, 32).
- Property tests were updated so polie no longer uses a “gate lever,” and the polie additivity invariant still independently recomputes Σ(#A−#B) and matches ledger per-player cents (apps/tournament-api/src/engine/games/games.property.test.ts:175-237).

## Warnings

None.
