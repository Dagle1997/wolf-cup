# Gemini Review

- Generated: 2026-06-22T17:49:55.452Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/2-4-sandie-modifier-par-vs-any-score-variant.md, apps/tournament-api/src/engine/games/modifiers/polie.ts, apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/compute-foursome.ts

## Summary

The Sandie modifier spec correctly models the ratified pure count-based (gateless) logic and accurately predicts the ledger payouts and post-2.1a canonical edge reductions. The math for the hand-calc golden is 100% correct, including the slot-paired 1-to-1 edge collapse. One layering contradiction was found where the spec strips the self-guard from the resolver, breaking established safety patterns and making isolated unit testing impossible.

Overall risk: low

## Findings

1. [medium] sandiePoints signature lacks config parameter, breaking self-guard pattern and Task 5 testability
   - File: _bmad-output/implementation-artifacts/tournament/2-4-sandie-modifier-par-vs-any-score-variant.md:76-87
   - Confidence: high
   - Why it matters: Task 2 explicitly states `sandiePoints` takes no `config`, but Task 5 requires testing that an inactive/absent modifier returns 0 in isolated resolver tests (`sandie.test.ts`). Without receiving the `config`, the pure resolver cannot evaluate its active state to return 0. Furthermore, omitting `config` breaks the self-guard pattern established by `poliePoints`, leaving the function vulnerable to computing phantom money if a direct caller ever bypasses the `sandieActive` gate.
   - Suggested fix: Update Task 2 to include `config: GameConfig` in the `sandiePoints` signature and require it to self-guard (`if (!sandieActive(config)) return 0;`), exactly like `polie.ts`. This immediately enables the isolated resolver test required in Task 5.

## Strengths

- The Golden Hand-calc correctly models the post-2.1a edge reduction algorithm, accurately calculating that a +2000c differential across 4 pairs collapses into two 1000c edges.
- Fail-closed logic correctly adapts to a modifier with zero variant levers, guaranteeing robust protection against phantom variant properties.
- The use of the `pts === 0` short-circuit flawlessly handles the 'all-push hole' scenario without outputting empty/zero edges.
- The new fast-check property mathematically models the per-player dollar variance correctly.

## Warnings

None.
