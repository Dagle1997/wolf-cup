# Codex Review

- Generated: 2026-06-22T15:25:42.269Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/modifiers/greenie.test.ts

## Summary

(a) The new `typeof m.enabled !== 'boolean'` guard (registry.ts:88-95) is correct and does not over-reject valid configs: both `enabled: true` and `enabled: false` pass, and only non-boolean values fail with `invalid_modifier_enabled:${type}`.

(b) Within `validateResolvedConfig`’s current structural assumptions (i.e., `config.modifiers` is an iterable of modifier-shaped objects), the three money-moving inputs are now fail-closed:
- `type` is validated via `hasModifier` (registry.ts:85-87).
- `enabled` is strict-boolean validated (registry.ts:93-95).
- Variant levers are protected by (i) enabled-only non-object variant rejection (registry.ts:103-109) and (ii) enabled-only per-modifier allowlists + greenie carryover type check (registry.ts:115-146).

(c) The earlier consistency concern about `m.enabled` being in the same threat class as the other guards is resolved: it is now treated as load-bearing and fail-closed the same way.

No new over-rejection issues are evident in the diff; the accompanying tests in greenie.test.ts cover the intended failure modes for non-boolean `enabled`, non-object `variant`, and non-boolean `carryover` and confirm disabled modifiers remain inert/unconstrained.

Overall risk: low

## Findings

1. [low] validateResolvedConfig can still throw on malformed top-level shapes (not fully fail-closed for arbitrary unvalidated JSON)
   - File: apps/tournament-api/src/engine/games/registry.ts:66-109
   - Confidence: high
   - Why it matters: Despite the comments emphasizing protection against direct callers bypassing Zod, `validateResolvedConfig` assumes structural validity of `config.pointValueSchedule` and `config.modifiers`.

Examples supported by the current code:
- If `config.modifiers` is not iterable, `for (const m of config.modifiers)` throws rather than returning `{ok:false,...}`.
- If `config.modifiers` contains `null`/non-objects, `m.type` access throws.
- If `config.pointValueSchedule` is non-object/invalid shape, `validateSchedule` reads `s.kind` and will throw.

This is not introduced by your change, but it means the function’s “fail-closed validator returns Validation” contract doesn’t hold for arbitrary unvalidated JSON.
   - Suggested fix: If the intent is truly "fail-closed for direct callers" (as the new comments suggest), add minimal runtime shape guards up front (e.g., ensure `config` is object, `modifiers` is an array of objects with string `type`, and `pointValueSchedule` is object with expected discriminant) so the function returns `{ok:false,...}` instead of throwing. If that’s intentionally out of scope, consider toning down the "direct caller" claims in comments to match actual guarantees.

## Strengths

- The `enabled` strict-boolean guard correctly closes the JS-truthiness settlement risk without affecting valid boolean configs (registry.ts:93-95).
- The enabled-only non-object `variant` rejection prevents silent defaulting of variant levers (registry.ts:103-109) and is covered by tests (greenie.test.ts:251-261).
- Per-modifier allowlists are explicit and fail-closed: greenie rejects basis/bonus and type-checks carryover; net-skins rejects carryover and non net/single (registry.ts:115-146), with targeted tests (greenie.test.ts:196-270).

## Warnings

None.
