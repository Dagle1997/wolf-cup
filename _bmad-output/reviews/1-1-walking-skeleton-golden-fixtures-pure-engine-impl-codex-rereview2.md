# Codex Review

- Generated: 2026-06-21T20:31:59.832Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/resolver.ts, apps/tournament-api/src/engine/games/compute-foursome.ts, apps/tournament-api/src/engine/games/games/guyan-2v2.ts

## Summary

One remaining fail-closed gap: duplicate modifier types inside a single config row (event/round/foursome) are silently de-duped by `mergeModifiers()` before validation, so production resolution can still become order-dependent and settle wrong money instead of surfacing `duplicate_modifier:<type>`. Everything else in the provided files appears to correctly reject unsupported net-skins variants, odd/non-positive point values, duplicate level rows, and bad/non-integer configVersion before settlement; the core 2v2 cross-team pv/2 math shown here is unchanged.

Overall risk: high

## Findings

1. [high] Duplicate modifier types can still slip through resolveConfig (silently last-wins) because mergeModifiers de-dupes before validateResolvedConfig runs
   - File: apps/tournament-api/src/engine/games/resolver.ts:40-102
   - Confidence: high
   - Why it matters: You stated the system now FAILS CLOSED on duplicate modifier types (`duplicate_modifier:type`) and is order-independent. However, `resolveConfig()` normalizes modifiers via `mergeModifiers()` (Map keyed by type) at the event base (line 71) and on each cascade step (line 89) *before* calling `validateResolvedConfig()` (line 99). If an event/round/foursome row’s `modifiers` array contains duplicates of the same `type`, `mergeModifiers()` will silently collapse them (Map `set` overwrites), and which entry “wins” depends on the original array order (last-write-wins). Because validation only sees the merged/deduped result, `validateResolvedConfig()` never observes the duplicate and cannot reject it. That is a concrete remaining path where a duplicate modifier can silently compute/settle wrong money and violates purity/order-independence under malformed config rows.

This also undermines the stated rationale that the locked path is not order-dependent with duplicate event modifiers: with duplicates present, the *chosen* modifier is still order-dependent even though the final list is sorted.
   - Suggested fix: Detect duplicates *before* deduping. Options:
- In `resolveConfig()`, validate each row’s `config.modifiers` (event + each more-specific row) for duplicate `type` and return `{ ok:false, reason: `duplicate_modifier:${type}` }` before calling `mergeModifiers()`.
- Or change `mergeModifiers()` to check duplicates within each input array (base and override) and throw/return an error that `resolveConfig()` surfaces.

Add a regression test: event row with two `net-skins` entries with different `enabled/variant` values must return `duplicate_modifier:net-skins` (not silently pick one), for both locked and unlocked events; same for duplicates within a round/foursome row.

## Strengths

- `validateResolvedConfig()` now correctly rejects non-integer / <1 `configVersion` before the too-new check (apps/tournament-api/src/engine/games/registry.ts:64-69).
- Point value schedule validation is fail-closed for non-integer, non-positive, and odd cents (registry.ts:47-54), and `computeFoursome()` redundantly guards evenness again (compute-foursome.ts:55-58).
- Unsupported enabled net-skins variants are explicitly rejected (registry.ts:89-95), preventing gross/double from being silently treated as net/single.
- `resolveConfig()` now fails closed on >1 row at any level (resolver.ts:52-56), removing order-dependent row selection.
- `computeFoursome()` now validates config at entry and throws on invalid (compute-foursome.ts:19-20), closing the direct-call miscompute path.

## Warnings

None.
