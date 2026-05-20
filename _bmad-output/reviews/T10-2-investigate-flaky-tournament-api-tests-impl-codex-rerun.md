# Codex Review

- Generated: 2026-05-20T20:55:10.353Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/round-lifecycle.integration.test.ts

## Summary

Diff only adds an expanded triage comment plus `retry: 1` on the flaky handoff regression test. The new retry-math comment is mathematically correct as written (given the usual independence assumption) and the corrected line-number reference to `__testPlayer` now matches `buildApp()` (~line 208). No other functional code changes are present beyond enabling the retry.

Overall risk: low

## Findings

1. [low] Retry-math comment is correct but implicitly assumes independent attempts; consider stating that explicitly
   - File: apps/tournament-api/src/routes/round-lifecycle.integration.test.ts:519-526
   - Confidence: high
   - Why it matters: The formula `false-PASS = 1 - p^2` is correct if each attempt fails independently with probability p. In real flakes, retries can be correlated (e.g., deterministic by environment, order-dependent global state, shared DB state), in which case masking can be better or worse than the simple model. Since this is documentation meant to guide future decisions, an explicit note avoids overconfidence in the numeric examples.
   - Suggested fix: Amend the comment to something like: “Assuming attempt outcomes are independent: false-PASS = 1 - p² … (if correlated, masking differs).”

2. [low] Commented concurrency hypothesis may be misleading given typical Vitest per-file sequential execution
   - File: apps/tournament-api/src/routes/round-lifecycle.integration.test.ts:504-513
   - Confidence: medium
   - Why it matters: The hypotheses mention races with a “parallelized test runner” and “a concurrent test resetting `__testPlayer`”. Within a single test file, Vitest runs tests sequentially unless `concurrent` is used. Cross-file parallelism usually occurs in separate workers/isolates, where module globals (like `__testPlayer`) and in-memory DB connections may not actually be shared. If the comment is used for diagnosis later, it may send readers toward a concurrency explanation that doesn’t apply in the current execution model.
   - Suggested fix: Consider reframing from “concurrent test” to “state leakage/order dependence across tests” and, if relevant to your runner config, specify whether this relies on cross-file shared worker/DB behavior (or explicitly note it’s a hypothesis contingent on execution model).

## Strengths

- Retry-masking math is now correct (`1 - p²`) and the examples are numerically consistent (p=10/50/90/100%).
- The updated `__testPlayer` line-number reference correctly points to `buildApp()` (~line 208) and the mid-test reassignment (line ~546).
- The comment clearly labels `retry: 1` as triage, not a fix, and links to a follow-up story for structural diagnosis.

## Warnings

None.
