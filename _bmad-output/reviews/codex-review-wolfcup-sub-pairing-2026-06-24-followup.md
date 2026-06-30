# Codex Review

- Generated: 2026-06-24T16:42:08.554Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: packages/engine/src/pairing.ts, packages/engine/src/pairing.test.ts, apps/api/src/lib/sub-grouping.ts

## Summary

Re-review of the patched sub-aware pairing change shows the three previously raised issues are addressed in the provided code:

1) Oversized clusters + fragmentation stranding: the new split-on-failure queue fallback in `suggestGroups` ensures only true capacity exhaustion can produce overflow; clusters that can’t fit as units are split into singletons and re-queued, and the queue growth is bounded (no infinite loop).

2) Pin determinism regression: pins are lifted to clusters in `pinMap` iteration order, first pin per cluster wins, and capacity is checked at full cluster size. In the no-links (all-singletons) case, cluster construction is an identity on input order and the size-bucketing step is also an identity, so RNG draw count/order and greedy iteration order are preserved.

3) Attendance gating: `buildSubGroupingInputs` now selects `attendance.status` and emits a link only when both requester and sponsor are `status === 'in'`.

No remaining concrete path was found that would emit an invalid partition (duplicate player, over-capacity group, or dropped player when capacity exists), given the invariants in the current implementation and the added tests.

Overall risk: low

## Findings

No concrete findings were identified from the supplied evidence.

## Strengths

- `pairing.test.ts` adds targeted regression coverage for: empty `subIds`/`links` identity, sub collision counting, soft sub spreading under pressure, hard keep-together link contraction behavior (including absent-player link dropping), oversized cluster degradation, and pin overflow precedence/determinism.
- `suggestGroups` now guarantees (by construction) that overflow happens only when every group is full (for singletons), preventing the prior fragmentation-stranding failure mode.
- Pins lifted to clusters in `pinMap` iteration order provides a clear, deterministic precedence rule, and the implementation explicitly preserves the all-singletons/no-links RNG-driven order via size-bucketing identity when `maxSize === 1`.

## Warnings

None.
