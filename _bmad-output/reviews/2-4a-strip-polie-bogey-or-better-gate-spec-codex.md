# Codex Review

- Generated: 2026-06-22T18:30:20.694Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/2-4a-strip-polie-bogey-or-better-gate.md, apps/tournament-api/src/engine/games/modifiers/polie.ts, apps/tournament-api/src/engine/games/modifiers/sandie.ts, apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/types.ts

## Summary

Spec intent is clear: make polie match sandie as a pure count and remove the bogey-or-better lever everywhere, while keeping HoleState.gross threading for Story 2.5. The main correctness risk is config validation: removing `polieBogeyOrBetter` from the Zod schema can inadvertently *strip* (not reject) legacy keys, which would silently change settlement instead of failing closed as AC5/FR44 require. Also, the spec’s rationale for removing cross-rejections in registry is slightly off: sandie’s `Object.keys` guard cannot “cover” stray keys on other modifiers, so fail-closed behavior depends on schema strictness/passthrough or additional registry guards.

Overall risk: medium

## Findings

1. [high] Potential fail-closed break: removing `polieBogeyOrBetter` from config-schema may silently strip legacy keys, defeating AC5’s intended `unsupported_polie_variant:*` rejection
   - File: _bmad-output/implementation-artifacts/tournament/2-4a-strip-polie-bogey-or-better-gate.md:42-46
   - Confidence: medium
   - Why it matters: AC5/Dev Notes claim that old configs with `variant:{polieBogeyOrBetter:...}` will now fail closed (FR44) with `unsupported_polie_variant:polieBogeyOrBetter`. However, if `config-schema.ts` uses Zod’s default object behavior (unknown keys are commonly stripped unless `.strict()` or `.passthrough()` is used), then removing the key from the schema can produce `variant:{}` at runtime. That would then PASS the proposed “no-lever” polie validation (empty object) and silently compute count-only settlement—exactly the mis-settlement FR44 is trying to prevent (especially relevant since this story changes shipped money).
   - Suggested fix: When removing `polieBogeyOrBetter` from `config-schema.ts`, ensure unknown keys do not get silently dropped. Options:
- Make the modifier variant schema `.strict()` so configs with unknown keys hard-fail at parse-time (then update expected error surface accordingly), OR
- Make it `.passthrough()` so registry sees the raw keys and can emit `unsupported_polie_variant:<key>` as specified.
Also add/adjust tests that prove a config containing `variant:{polieBogeyOrBetter:true}` is rejected (not accepted with the key stripped).

2. [medium] Spec claim that sandie’s generic `Object.keys` guard “covers any stray key” does not apply to greenie/net-skins; removing explicit cross-rejections may weaken direct-caller fail-closed posture
   - File: apps/tournament-api/src/engine/games/registry.ts:112-168
   - Confidence: high
   - Why it matters: The registry currently explicitly rejects `polieBogeyOrBetter` when it appears under other enabled modifiers (net-skins: lines 130-133; greenie: lines 152-155). The spec proposes deleting those checks and asserts sandie’s generic branch covers stray keys, but sandie validation (lines 157-168) only runs when `m.type === 'sandie'`; it cannot reject stray keys on `greenie` or `net-skins`.

If Zod is strict and rejects unknown keys globally, you’re safe—but that’s not shown in the provided code. If any unvalidated caller can reach `validateResolvedConfig` (which the comments explicitly consider, e.g. lines 90-116), then removing the explicit rejections reduces protection against malformed variant objects containing now-unsupported legacy keys.
   - Suggested fix: Either:
- Ensure config parsing is strict enough that unknown keys cannot reach `validateResolvedConfig` (and document that as the guarantee), OR
- Keep/replace cross-rejection behavior with a generic per-modifier allowlist check (e.g., for greenie: reject any keys other than `carryover`; for net-skins: reject any keys other than `basis`/`bonus`).
If you keep the spec’s deletion, add a test that demonstrates the end-to-end behavior for a legacy stray key under greenie/net-skins (reject vs strip vs ignore), so FR44 remains enforced intentionally.

3. [low] After stripping the polie gate, existing type/docs will become misleading about `HoleState.gross` and polie’s lever unless updated
   - File: apps/tournament-api/src/engine/games/types.ts:72-86
   - Confidence: high
   - Why it matters: `HoleState.gross` is currently documented as only being used by the polie bogey-or-better gate (lines 79-85). The spec explicitly keeps gross threading for Story 2.5, and polie will stop reading gross. Leaving this comment unchanged will mislead future maintainers into thinking gross is dead/neutral and safe to remove, increasing regression risk for 2.5.
   - Suggested fix: Update the `HoleState.gross` doc to reflect the new reality: polie no longer reads gross; gross is kept for upcoming modifiers (Story 2.5) and is populated by services. Similarly update `polie.ts` header comment (currently describes the gate at lines 12-14) once the gate is removed.

## Strengths

- Acceptance criteria enumerate all required touchpoints (polie.ts, types/schema, registry validation, tests, fixtures/goldens) and explicitly call out regression constraints (byte-identical unrelated goldens).
- Golden hand-calc for the new behavior-change fixture is internally consistent with the stated count model: (+1 +1 −1) = +1 point => +500c per A player at $5/pt, total edges 1000c.
- Keeping `HoleState.gross` threading is a reasonable forward-compat choice given the stated Story 2.5 dependency; the spec explicitly scopes that to avoid an accidental revert.

## Warnings

None.
