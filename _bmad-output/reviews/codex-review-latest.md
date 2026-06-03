# Codex Review

- Generated: 2026-06-03T00:08:45.283Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: packages/engine/src/pairing.ts, packages/engine/src/pairing.test.ts, apps/api/src/scripts/_audit_pairing_engine_replay.ts

## Summary

Engine-side change largely meets the stated invariants: optimization is done on a convex objective (c²) while the returned `totalCost` is recomputed as RAW Σ `groupCost` for display. The worst-player tie-break is implemented at restart selection time and an injectable RNG is threaded into the Fisher–Yates shuffle. Main concrete risks are (1) `rng()` contract is unchecked and can produce out-of-range indices/undefined players, and (2) the new replay audit script can silently drop players if any round roster isn’t an exact multiple of 4, making AC9 conclusions potentially invalid without an explicit guard.

Overall risk: medium

## Findings

1. [high] Replay audit can silently drop players when roster size isn’t a multiple of GROUP_SIZE (results can be overly optimistic / invalid)
   - File: apps/api/src/scripts/_audit_pairing_engine_replay.ts:168-177
   - Confidence: high
   - Why it matters: `suggestGroups` only forms `floor(roster.length / groupSize)` full groups and returns the rest in `remainder`. The replay script accumulates pair counts only from `res.groups` (line 176) and ignores `res.remainder`, and it never asserts that `round.roster.length % GROUP_SIZE === 0`. If any finalized round had (e.g.) 15 players with a real 3-person group, the replay would consistently omit 3 players for that week, undercount repeats, and make “median worst-player”/“total repeats” look better than reality—directly impacting AC9 gating.
   - Suggested fix: Add an explicit guard before calling `suggestGroups`: if `round.roster.length % GROUP_SIZE !== 0`, either (a) throw/fail fast with a clear message, or (b) incorporate remainder players into additional (smaller) group(s) for accumulation so every rostered player contributes to the forward matrix and metrics. At minimum, log and exclude such rounds from the evaluation to avoid misleading PASS/FAIL.

2. [medium] Injected `rng()` is not validated/clamped; `rng() >= 1` can generate out-of-bounds shuffle indices and introduce `undefined` playerIds
   - File: packages/engine/src/pairing.ts:158-163
   - Confidence: high
   - Why it matters: `const j = Math.floor(rng() * (i + 1));` assumes `rng()` behaves like `Math.random` in [0,1). The type `() => number` doesn’t enforce that. If a caller supplies an RNG that can return 1 (or NaN/negative), `j` can become `i+1` (or negative/NaN), causing swaps with `undefined` and potentially pushing `undefined` into `shuffled`, which then can flow into `pairKey(pid, existing)` and `currentGroups.push(pid)` without runtime checks. This can lead to malformed group outputs or hard-to-debug behavior. (Math.random/mulberry32 are fine, but the API is now publicly injectable.)
   - Suggested fix: Clamp/validate RNG output at the shuffle site, e.g. `const r = rng(); if (!Number.isFinite(r)) throw ...; const u = Math.min(Math.max(r, 0), 0.999999999999); const j = Math.floor(u * (i + 1));` Alternatively, document/encode the contract as `rng: () => number /* in [0,1) */` and add a dev-time assertion.

3. [medium] `bestGroups!` can still be null if penalty comparisons never succeed (NaN/Infinity edge cases), causing a runtime crash after restarts
   - File: packages/engine/src/pairing.ts:143-214
   - Confidence: high
   - Why it matters: After the restart loop, the code unconditionally dereferences `bestGroups!` (line 210, 213). Under normal conditions it will be set on attempt 0 because `bestPenalty` starts at `Infinity` and penalty costs are finite. But if `penaltyCost` becomes `NaN` (e.g., matrix contains `NaN` values, or `undefined` IDs leak in via a bad RNG as above), then both `penaltyCost < bestPenalty` and `penaltyCost === bestPenalty` are false, so `bestGroups` never updates and the function throws. This is exactly the “bestGroups stays null” failure mode the review request called out.
   - Suggested fix: Make the selection condition resilient: `if (bestGroups === null || penaltyCost < bestPenalty || (penaltyCost === bestPenalty && thisLoad < bestLoad)) { ... }`. Optionally also validate matrix counts are finite numbers before use (or coerce non-finite to 0) to avoid NaN propagation.

## Strengths

- `totalCost` is recomputed RAW from the winning grouping for the normal return path, protecting the UI heatColor magnitude expectations (pairing.ts:207-216).
- Greedy incremental objective and restart selection objective are consistent (both based on `pairPenalty` / `groupPenaltyCost`), so the engine is actually optimizing the intended convex function.
- Worst-player tie-break is correctly implemented as a secondary criterion only on penalty ties (`penaltyCost === bestPenalty && thisLoad < bestLoad`).
- RNG injection is localized to the shuffle (maintains prod behavior with `Math.random` default) and is covered by deterministic tests.
- Added tests directly cover the key acceptance criteria: convex penalty shape, discrimination vs raw, worst-player tie-break behavior, and deterministic runs with a seeded PRNG.

## Warnings

None.
