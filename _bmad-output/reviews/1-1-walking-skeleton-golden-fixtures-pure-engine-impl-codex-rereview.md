# Codex Review

- Generated: 2026-06-21T20:28:32.704Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/resolver.ts, apps/tournament-api/src/engine/games/compute-foursome.ts, apps/tournament-api/src/engine/games/games/guyan-2v2.ts, apps/tournament-api/src/engine/games/modifiers/net-skins.ts, apps/tournament-api/src/engine/games/ledger-to-edges.ts, apps/tournament-api/src/engine/games/types.ts

## Summary

The added fail-closed validation for (a) enabled net-skins variant support and (b) even positive integer-cent point values is correctly implemented in `validateResolvedConfig`, and `computeFoursome` now also defensively throws on odd per-hole point values. Core per-hole math (low ball + skin gate net<=par + team total + net-skins winner-takes-all by best net level, no-blood ties) and the cross-team pv/2 splitting appear internally consistent and integer-cent safe *when the config has been validated and normalized*.

However, there remain concrete paths where unsupported/enabled variants or misconfigurations can still silently compute the wrong money, and there are still order-dependence risks (especially around duplicate modifiers and duplicate non-event rows). These are not covered by the new checks as written.

Overall risk: medium

## Findings

1. [high] `computeFoursome` can still silently miscompute unsupported enabled net-skins variants if called without prior validation
   - File: apps/tournament-api/src/engine/games/compute-foursome.ts:12-57
   - Confidence: high
   - Why it matters: Your critical fix relies on `validateResolvedConfig` being invoked before settlement. But `computeFoursome` is exported and does not itself validate the config. If a caller uses `computeFoursome` directly (or accidentally bypasses `resolveConfig`), an enabled unsupported `net-skins` variant can still silently compute wrong money:
- If `variant.basis === 'gross'` and `enabled === true`, `netSkinsActive` will simply return false (silently disabling the modifier) rather than fail closed.
- If `variant.bonus === 'double'`, the engine will still apply the single-bonus logic (since bonus isn’t consulted in `netSkinsActive`/`netSkinsPoints`).
This is exactly the class of “unsupported/enabled variant silently computes wrong money” you’re trying to eliminate, just via a different entry point.
   - Suggested fix: Fail closed at the settlement entry point(s), not only at config-resolution time. Options:
1) Add `validateResolvedConfig(config)` at the top of `computeFoursome` and `throw` on `!ok`.
2) Or, make `computeFoursome` non-public and expose a single public API that always resolves+validates before computing.
Also consider making `netSkinsActive` assert `bonus==='single'` (or throw) when `enabled` to avoid silently treating unsupported variants as disabled/single.

2. [high] Duplicate modifiers can survive in locked configs and produce order-dependent behavior (including silently disabling net-skins)
   - File: apps/tournament-api/src/engine/games/resolver.ts:62-73
   - Confidence: high
   - Why it matters: When the event is locked, `resolveConfig` does not call `mergeModifiers`; it directly copies `ec.modifiers` (`modifiers: ec.modifiers ? [...ec.modifiers] : []`). That means duplicate modifier entries of the same `type` can persist into the resolved config.

Downstream, `netSkinsActive` uses `find()` (first match) to select the net-skins modifier, making behavior dependent on array order if duplicates exist. This can lead to silent wrong money even if `validateResolvedConfig` passes. Example:
- modifiers = [`{type:'net-skins', enabled:false, variant:{basis:'gross',bonus:'double'}}`, `{type:'net-skins', enabled:true, variant:{basis:'net',bonus:'single'}}`]
- Validation passes (the enabled one is supported).
- `netSkinsActive` finds the first (disabled) entry and returns false, incorrectly disabling net-skins and computing wrong money.

This is also an order-independence violation for the resolved config shape (and it can occur in the locked path today).
   - Suggested fix: Enforce uniqueness of `modifiers[]` by `type` in the resolved config:
- Either (preferred) normalize with `mergeModifiers(merged.modifiers, undefined)` even in the locked path (i.e., always dedupe/sort by type), or
- Add a fail-closed check in `validateResolvedConfig` for duplicate modifier `type` values.
Additionally, consider changing `netSkinsActive` to resolve modifiers by type deterministically (e.g., reduce-by-type) rather than `find()` on a potentially-duplicated array.

3. [medium] `resolveConfig` is still order-dependent if duplicate round/foursome rows are present (only event duplicates are rejected)
   - File: apps/tournament-api/src/engine/games/resolver.ts:74-90
   - Confidence: high
   - Why it matters: You fixed duplicate **event** rows (good). But if `rows` contains >1 `round` row or >1 `foursome` row, the merge loop applies them sequentially (after sorting by level only). Within the same level, the merge order is effectively whatever order the caller provided (and can differ across DB queries), so the resolved config can change without any explicit difference in configuration.

Given your stated requirement of determinism/order-independence, this is still a correctness footgun (even if the DB *should* enforce uniqueness, the engine currently won’t fail closed if that invariant is violated upstream).
   - Suggested fix: Fail closed if `rows` contains more than one row for any given level (`round` or `foursome`) for the resolution context, similar to the event-level check. If future epics legitimately need multiple rows per level, you’ll need a deterministic tie-breaker key in `LeveledConfigRow` (e.g., `refId` + stable ordering) and explicit semantics.

4. [medium] `configVersion` is not validated as a finite integer; NaN/non-integer values can bypass version gating
   - File: apps/tournament-api/src/engine/games/registry.ts:63-66
   - Confidence: high
   - Why it matters: `validateResolvedConfig` only checks `config.configVersion > ENGINE_CONFIG_VERSION`. If `configVersion` is `NaN` (or another non-finite/non-integer value), the comparison is false and validation incorrectly succeeds, defeating the “fail closed on unsupported config_version” guarantee.

`resolveConfig` can also propagate `NaN` via `Math.max(merged.configVersion, c.configVersion ?? 0)` if any merged value is `NaN`.
   - Suggested fix: In `validateResolvedConfig`, add a strict check such as:
- `if (!Number.isInteger(config.configVersion) || config.configVersion < 0) return {ok:false, reason: 'invalid_config_version:...'};`
and consider using `Number.isFinite` as well.
In `resolveConfig`, avoid `Math.max` on untrusted numbers unless you’ve validated them (or coerce invalid values to a sentinel that triggers rejection).

## Strengths

- `validateSchedule` now correctly rejects non-integer, non-positive, and odd cent values, closing the pv/2 fractional-cent hole when config is validated (registry.ts 47-54).
- Enabled net-skins variants are now explicitly constrained to net/single and rejected otherwise (registry.ts 76-86), addressing the original “unsupported enabled variant” issue on the validated path.
- Duplicate event-level rows are now fail-closed, eliminating a clear order-dependent resolution bug at the event level (resolver.ts 49-55).
- `computeFoursome` now enforces deterministic hole accumulation order and fails closed on duplicate hole numbers, preventing double-counting (compute-foursome.ts 22-33).
- Money math stays integer-cent throughout (pv even gate + pv/2 split) and the pairwise cross-matrix lowering to SettlementEdge[] remains loss-less and deterministic (compute-foursome.ts 46-56; ledger-to-edges.ts 17-36).
- No evidence of impurity (no db/Date/random) or forbidden imports in the provided files.

## Warnings

None.
