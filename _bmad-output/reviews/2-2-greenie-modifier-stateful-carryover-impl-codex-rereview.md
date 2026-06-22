# Codex Review

- Generated: 2026-06-22T15:07:59.640Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/modifiers/greenie.ts, apps/tournament-api/src/engine/games/modifiers/greenie.test.ts, apps/tournament-api/src/engine/games/compute-foursome.ts, apps/tournament-api/src/services/games-money.ts

## Summary

The carryover-type fix is correctly implemented for the main settlement path: computeFoursome now validates configs via validateResolvedConfig, and validateResolvedConfig rejects enabled greenie configs with a non-boolean `variant.carryover` using `unsupported_greenie_variant:carryover_type`. Boolean carryover values and absent carryover continue to pass; disabled greenie remains inert. The dense-holes change in games-money.ts does what greenieFold’s AC8 barrier requires and does not change base-game money because computeFoursome already skips incomplete holes.

One remaining fail-closed gap: validateResolvedConfig does not verify that `m.variant` is a plain object when a modifier is enabled. Certain malformed runtime shapes (e.g. `variant: "oops"` or `variant: true` or `variant: null`) will currently pass validation and be interpreted as “variant absent” (carryover defaults to true), which undermines the stated goal of guarding direct callers that bypass Zod.

The deferred `parByHole.get(holeNumber) ?? 0` concern is effectively unreachable-by-construction in the normal path because `holeNumber` is iterated from `siByHole.keys()` and `parByHole` is constructed from the same `holesInPlay` array (identical keyset).

Overall risk: medium

## Findings

1. [medium] validateResolvedConfig does not fail-closed on non-object modifier.variant shapes (e.g., string/boolean/null) for enabled modifiers
   - File: apps/tournament-api/src/engine/games/registry.ts:88-124
   - Confidence: high
   - Why it matters: This review’s fix relies on validateResolvedConfig to protect computeFoursome from malformed configs that bypass Zod. However, the current checks only look at specific properties (basis/bonus/carryover) via optional chaining. If `m.variant` is not an object (e.g., `variant: "false"`, `variant: true`, or `variant: null` in unvalidated JSON), then `m.variant?.carryover` is `undefined`, the type-check is skipped, validation succeeds, and greenieCarryover will default carryover to `true`. That is a remaining fail-closed gap: malformed configs can still be silently accepted and affect money behavior.
   - Suggested fix: When `m.enabled` is true, add a shape guard such as:
- reject if `m.variant` is not `undefined` and (typeof !== 'object' || m.variant === null || Array.isArray(m.variant));
Optionally also enforce an explicit allowlist of keys for each enabled modifier (e.g., for greenie only `carryover` is permitted).

## Strengths

- The carryover-type fix is correctly targeted: enabled greenie + non-boolean carryover now rejects with the requested reason, closing the specific `?? true` truthiness misinterpretation path in computeFoursome.
- The new net-skins rejection of `variant.carryover` and greenie rejection of net-skins levers (basis/bonus) matches the stated per-modifier allowlist/fail-closed intent and does not constrain disabled modifiers.
- games-money.ts now emits dense HoleState rows for all in-play holes, enabling greenieFold’s “first incomplete par-3 barrier” without changing base settlement (computeFoursome already gates on complete nets).
- The deferred `par ?? 0` is indeed unreachable in the normal construction because `parByHole` and `siByHole` are derived from the same `holesInPlay` list; iterating `siByHole.keys()` should always hit a defined par value absent corrupt DB rows.

## Warnings

None.
