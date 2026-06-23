# Codex Review

- Generated: 2026-06-23T15:27:51.368Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/3-3-per-hole-f1-money-or-defer.md

## Summary

Prior findings (1)–(6) look addressed in the spec text:
- Money units: AC#4 explicitly defines `moneyNet` as **integer cents**, warns against claiming whole-dollar from `pv`-even, and forbids rounding.
- Exposure: AC#5 now carries an explicit product decision (recommended locked-only public surface; organizer not exempt; My Money separate).
- Naming: `teamASignedPerPlayerCents` is explicitly “one teamA player” (not team total).
- Invariants: the incorrect `totalCents` per-hole invariant is explicitly dropped; only per-player signed sum + round zero-sum are asserted.
- “Settled hole” definition: AC#2 ties `perHole` emission to the same complete-cell gate used by cross accumulation (with a push-hole zero-row carve-out).
- Golden safety: softened and adds an explicit grep task for whole-Ledger equality/snapshots.

One new, concrete correctness risk remains: the spec does not explicitly guard against the common `Map.get(...) || null` bug that would incorrectly turn legitimate `0`-cent push holes into `null` (unsettled) in the scorecard output.

Overall risk: high

## Findings

1. [high] Spec leaves room for a `Map.get(...) || null` bug that would erase push-hole $0 and violate AC#2/AC#4 semantics
   - File: _bmad-output/implementation-artifacts/tournament/3-3-per-hole-f1-money-or-defer.md:45-47
   - Confidence: high
   - Why it matters: AC#2 requires push holes to emit a settled per-hole row with **0** cents (distinct from an unsettled hole, which is `null`/no row). AC#4 then maps per-hole results into `ScorecardHole.moneyNet` using the per-hole map: “value for that hole if present, else `null`”. In JS/TS, a very common implementation is `moneyNet = map.get(hole) || null`, which would treat `0` as falsy and incorrectly output `null` for push holes—breaking the UI distinction (`null → —` vs `0 → $0`) and breaking the story’s core correctness semantics.
   - Suggested fix: In AC#4 (and/or Task 3), explicitly require presence checks that preserve zero: e.g. `moneyNet = map.has(holeNumber) ? map.get(holeNumber)! : null`. Also ensure `computeF1PerHoleMoneyForPlayer` includes push holes in the returned map (value `0`) so the scorecard can render `$0` for settled pushes.

## Strengths

- Clear resolution of the cents/whole-dollar confusion: integer cents contract, no rounding, and correct distinction between `pv` evenness vs whole-dollar multiples (AC#4).
- Exposure model is now explicitly mirrored from the leaderboard and includes an explicit product decision on organizer/unlocked behavior (AC#5).
- Correctly removes the invalid `totalCents` per-hole invariant and replaces it with the unconditional per-player signed decomposition invariant plus round zero-sum (AC#1, Dev Notes).
- Tightened definition of which holes produce `perHole` rows by binding it to the same complete-cell gate as cross accumulation (AC#2).
- Golden-test safety is handled pragmatically: field-level assertions + explicit grep task for deep-equals/snapshots that would break with additive fields (Background, Task 1).

## Warnings

None.
