# Codex Review

- Generated: 2026-06-22T17:10:04.098Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/games/types.ts, apps/tournament-api/src/engine/games/config-schema.ts, apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/compute-foursome.ts, apps/tournament-api/src/engine/games/modifiers/polie.ts, apps/tournament-api/src/engine/games/modifiers/polie.test.ts, apps/tournament-api/src/engine/games/polie.golden.test.ts, apps/tournament-api/src/engine/games/games.property.test.ts, apps/tournament-api/src/engine/games/__fixtures__/polie-anything.json, apps/tournament-api/src/engine/games/__fixtures__/polie-bogey-or-better.json, apps/tournament-api/src/engine/games/__fixtures__/polie-all-push.json, apps/tournament-api/src/services/games-money.ts

## Summary

Polie count model and sign handling look correct (rawA = #A−#B, range −2..+2), and the bogey-or-better gate is coercion-safe via a `typeof gross === 'number' && Number.isFinite(gross)` guard before `<= par+1` (so `null <= ...` can’t sneak through). Wiring in `computeFoursome` adds polie points before the `pts===0` short-circuit, preserving the “greenie/polie alone can settle a hole” behavior and the all-push → empty-edges case. Config allowlisting in `registry.ts` is fail-closed and prevents JS-truthiness misinterpretation for `polieBogeyOrBetter`.

Main money-correctness risk left is integration: the service layer now threads `grossStrokes` straight into `HoleState.gross`. Because the gate deliberately voids any non-`number` gross, any DB/driver/schema mismatch that yields `grossStrokes` as `string | null | bigint` would silently void *all* gated polies (fail-closed, but potentially surprising). The current unit/golden/property tests strongly cover engine behavior, but they don’t exercise the service’s gross threading contract end-to-end in the provided changes.

Overall risk: medium

## Findings

1. [medium] Service→engine gross threading is brittle to non-number `grossStrokes` and could silently void all gated polies (fail-closed)
   - File: apps/tournament-api/src/services/games-money.ts:411-454
   - Confidence: medium
   - Why it matters: `polie.ts` intentionally voids gated polies unless `gross` is a finite JS `number` (good for coercion-safety). But `settleFoursome` copies `s.grossStrokes` into `HoleState.gross` without any runtime assertion/conversion. If `holeScores.grossStrokes` ever comes back as `string`/`bigint`/`null` (driver/type drift, partial writes, unexpected schema), the bogey-or-better gate will treat it as ineligible and drop those polie points across the board. That’s a high-impact money delta (all gated polies disappear) that can look like “polie is broken” rather than “data type mismatch.”
   - Suggested fix: In `settleFoursome`, validate `s.grossStrokes` before storing/using it (e.g., `if (typeof s.grossStrokes !== 'number' || !Number.isFinite(s.grossStrokes)) { /* omit gross cell (keeps fail-closed) and consider marking hole incomplete or surfacing unsettleable */ }`). At minimum, add a focused service-level test (or contract test around the DB row shape) that ensures `grossStrokes` is a JS number and that a gated polie survives the full `computeF1EventEdges` path.

## Strengths

- `isBogeyOrBetter` guard in `polie.ts` is correctly ordered to prevent JS coercion bugs like `null <= par+1` counting as eligible (apps/tournament-api/src/engine/games/modifiers/polie.ts:40-46).
- Polie points are folded into `pts` before the `pts===0` short-circuit, so claim-only holes can still settle and all-push stays inert (apps/tournament-api/src/engine/games/compute-foursome.ts:55-76).
- `registry.ts` allowlist correctly rejects cross-modifier lever bleed (e.g., `polieBogeyOrBetter` on greenie/net-skins) and type-checks `polieBogeyOrBetter` to avoid truthiness-based mis-settlement (apps/tournament-api/src/engine/games/registry.ts:116-178).
- Test coverage is strong at the engine layer: unit tests for count/sign/gate edge cases (including null/NaN/string gross), golden fixtures that prove the gate moves money, and a non-tautological fast-check additivity property for polie-only configs.

## Warnings

None.
