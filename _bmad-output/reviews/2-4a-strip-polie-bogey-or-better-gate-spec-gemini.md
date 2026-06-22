# Gemini Review

- Generated: 2026-06-22T18:33:33.568Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/2-4a-strip-polie-bogey-or-better-gate.md, apps/tournament-api/src/engine/games/modifiers/polie.ts, apps/tournament-api/src/engine/games/modifiers/sandie.ts, apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/types.ts

## Summary

The specification is thorough and the architectural approach is solid. Retaining the gross threading for Story 2.5 is the right call to avoid unnecessary churn, and the golden hand-calc is mathematically correct. However, there is a build-breaking omission regarding where the registry validation changes should be tested, along with a couple of dangling JSDoc references to the removed gate.

Overall risk: medium

## Findings

1. [high] Missing `registry.test.ts` file and misplaced validation tests
   - File: _bmad-output/implementation-artifacts/tournament/2-4a-strip-polie-bogey-or-better-gate.md:50-67
   - Confidence: high
   - Why it matters: The spec changes the fail-closed validation rules for polie in `registry.ts` and removes cross-modifier rejections. This will break existing tests in `registry.test.ts` that assert the old behavior. AC7 mistakenly instructs putting the new 'no-variant fail-closed tests' in `modifiers/polie.test.ts`, which tests the modifier execution rather than the config validation, and completely omits `registry.test.ts` from the file list.
   - Suggested fix: Add `apps/tournament-api/src/engine/games/registry.test.ts` to the files list. Update AC7 / Task 4 to specify that the old polie variant validation and cross-rejection tests must be removed from `registry.test.ts`, and the new no-lever fail-closed tests belong there as well.

2. [medium] Dangling reference to the polie gate in `types.ts` JSDoc
   - File: _bmad-output/implementation-artifacts/tournament/2-4a-strip-polie-bogey-or-better-gate.md:44-62
   - Confidence: high
   - Why it matters: AC4 correctly specifies keeping `HoleState.gross?` in `types.ts`, but misses updating its JSDoc. The current comment explicitly states: 'Optional: only the polie bogey-or-better gate reads it... Absent gross under an active gate voids the polie'. Leaving this unchanged creates a confusing, factually incorrect dangling reference in the core types file.
   - Suggested fix: Update AC4 / Task 2 to instruct rewriting the JSDoc for `HoleState.gross` in `types.ts`, removing references to the polie gate and simply noting it provides per-player gross strokes (e.g., for upcoming Story 2.5).

3. [low] Dangling reference in `registry.ts` sandie comment
   - File: _bmad-output/implementation-artifacts/tournament/2-4a-strip-polie-bogey-or-better-gate.md:45-63
   - Confidence: high
   - Why it matters: The existing validation block for sandie in `registry.ts` contains a comment saying sandie is 'stricter than greenie/polie, which allow-list one key each'. Since polie is becoming a no-lever modifier with zero valid keys, this comment will become stale.
   - Suggested fix: Add a brief instruction in AC5 to update the sandie comment in `registry.ts` to 'stricter than greenie, which allow-lists one key'.

## Strengths

- Retaining the `HoleState.gross` state and `games-money.ts` threading is exactly the right call, preventing redundant tear-down/rebuild work right before Story 2.5 requires it.
- The golden hand-calc correctly handles the pure-count behavior and accurately proves that b1's double-bogey now shifts the ledger from $10/side to $5/side.
- Making `poliePoints` a self-contained count function that mirrors `sandiePoints` while preserving its signature cleanly insulates `compute-foursome.ts` from any required changes.

## Warnings

None.
