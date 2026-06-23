# Gemini Review

- Generated: 2026-06-23T15:22:25.754Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/3-3-per-hole-f1-money-or-defer.md

## Summary

The specification is exceptionally detailed and properly isolates per-hole money exposure within the existing pinned chokepoint. The golden-gated approach safely protects existing settlement totals. However, the mathematical invariant for total round money is incorrectly formulated and will block the required golden tests. Additionally, there is a missing step to update callers of a modified shared function, and an overly strict assumption regarding greenie carryover behavior.

Overall risk: high

## Findings

1. [high] Mathematically impossible invariant for totalCents will block golden tests
   - File: _bmad-output/implementation-artifacts/tournament/3-3-per-hole-f1-money-or-defer.md:41
   - Confidence: high
   - Why it matters: AC1 requires asserting `Σ_holes |teamADelta| * 2 === ledger.totalCents`. Because `ledger.totalCents` represents the net money exchanged at the round level, it effectively equals the absolute value of the total net sum. By placing the absolute value inside the sum, the spec calculates the gross volume of money exchanged. If the teams trade holes (e.g., Team A wins hole 1, Team B wins hole 2), the sum of absolute per-hole deltas will far exceed the net round total, causing the mandatory golden gate test to always fail.
   - Suggested fix: Change the invariant to `| Σ_holes teamADelta | * 2 === ledger.totalCents`. Moving the absolute value outside the sum correctly nets out back-and-forth wins across the round.

2. [medium] Missing update to computeF1EventEdges when changing settleFoursome signature
   - File: _bmad-output/implementation-artifacts/tournament/3-3-per-hole-f1-money-or-defer.md:84
   - Confidence: high
   - Why it matters: Task 2 instructs changing `settleFoursome` to 'return it [perHole] in the ok result alongside edges'. This changes the return type from an array of edges (`SettlementEdge[]`) to an object. However, the spec omits updating the existing primary caller, `computeF1EventEdges` (also in `games-money.ts`), which expects and aggregates arrays of edges. Without this update, the build will break or event settlement logic will fail.
   - Suggested fix: Add a subtask to update `computeF1EventEdges` (and any other callers) to correctly extract the `.edges` property from the new `settleFoursome` result object.

3. [medium] Inaccurate assumption that deferred greenie holes always emit $0
   - File: _bmad-output/implementation-artifacts/tournament/3-3-per-hole-f1-money-or-defer.md:41
   - Confidence: high
   - Why it matters: The spec states the greenie-carryover fixture must assert '$0 on the earlier deferred par-3s'. When a greenie carries over (no GIR), the teams may still win or lose the hole's *base* points (e.g., team A scores 3 vs team B scores 4). In that case, the deferred hole still emits base money. Asserting it must be $0 forces the test fixture to push the base hole and propagates a misconception that a carried greenie means the entire hole was pushed.
   - Suggested fix: Clarify that the earlier deferred par-3 only emits $0 if the base hole was *also* pushed. The core assertion should just verify that the carried greenie money lands on the resolving hole.

## Strengths

- Excellent definition of a strict, mathematical 'loss-less invariant' to prove financial correctness.
- The 'golden first' testing constraint (NFR-C1 gate) provides extremely strong protection against round-total regressions.
- Smart reuse of the existing `settleFoursome` pinned chokepoint ensures the scorecard will never disagree with the final event settlement.
- Clear, precise distinction between $0 push holes and null incomplete holes.

## Warnings

None.
