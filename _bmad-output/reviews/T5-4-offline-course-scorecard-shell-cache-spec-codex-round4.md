# Codex Review

- Generated: 2026-04-28T19:11:27.664Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md

## Summary

No High findings supported by the spec text. Round-3 items (banner in-scope, no TanStack meta mutation, ref-only source tracking, first-fetch guard) are largely resolved in the written spec. The main remaining issue is internal test-plan inconsistency around the number of frontend integration tests (2 vs 3), which can lead to dev/test drift. A couple of medium reliability ambiguities remain around banner comparison ordering and offline refetch behavior, but they’re addressable without changing scope.

Overall risk: medium

## Findings

1. [medium] Frontend integration test count is still internally inconsistent (2 vs 3), risking implementation drift and AC #7 mismatch
   - File: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md:29-177
   - Confidence: high
   - Why it matters: The spec alternates between “add 2 tests” and “+3 tests” for `rounds.$roundId.score-entry.test.tsx`. Specifically: file list says “add 2 tests” (line 29), §6 says “+2 tests” (line 175), but later the test attribution explicitly enumerates +3 integration tests (#9–#11) and totals assume 3 (lines 177, 249-253). AC #7’s tournament-web baseline threshold (92 → ≥103) implies +11 tests, which only works if integration adds 3 (8 cache-lib + 3 integration). This inconsistency can cause teams to implement fewer tests than AC requires or mis-measure baseline deltas.
   - Suggested fix: Make all references consistent: update the file list (line 29), §6 (line 175), and Tasks step 7 (line 270) to explicitly state +3 integration tests (including the banner test), or adjust AC #7 thresholds and totals if you truly intend only +2.

2. [medium] Banner ‘course superseded’ comparison depends on reading cached value before overwriting; ordering is not explicitly required and can be implemented incorrectly
   - File: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md:165-168
   - Confidence: medium
   - Why it matters: The banner condition requires comparing the previous cached payload hash vs the fresh payload hash, with a first-fetch guard based on cached being null (lines 165-168). But the spec does not explicitly state that the implementation must read the cached payload (and compute cachedHash) *before* writing the fresh payload. A straightforward (but wrong) implementation could `writeCachedRoundCourse(roundId, fresh)` first and then `readCachedRoundCourse` to compare—making cachedHash always equal freshHash and preventing the banner from ever firing (papering over the epic AC 1378-1380 behavior).
   - Suggested fix: Add a concrete implementation requirement in §5: in the network-success path, read cached first (or retain placeholderData result) to compute `cachedHash`, then compute `freshHash`, then write fresh to cache, then set banner flag if `cached !== null && cachedHash !== freshHash`.

3. [low] Offline polling with `refetchInterval: 15_000` may repeatedly hit IndexedDB every 15s; spec doesn’t bound/disable this when offline
   - File: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md:158
   - Confidence: medium
   - Why it matters: With `retry: false` and a 15s `refetchInterval` (line 158), an offline device can enter a loop: network fetch fails, then falls through to cache, every 15 seconds indefinitely. That means repeated IDB reads and repeated error paths while offline; not a correctness bug, but it can impact battery/perf and complicate tests/flakiness if timers aren’t controlled.
   - Suggested fix: Consider specifying `refetchInterval: (data, query) => navigator.onLine ? 15_000 : false` (or TanStack’s `onlineManager`) or otherwise documenting that polling continues while offline and is acceptable.

## Strengths

- Round-3 major correctness items are addressed in the spec: explicit ban on TanStack Query `meta` mutation (lines 161-163), and ref-only source tracking to avoid state writes in queryFn (lines 161-162).
- First-fetch banner guard is explicitly specified and test-planned (lines 167-168, 252).
- Backend endpoint auth chain and defense-in-depth are clearly defined (lines 50-55, 191-196), aligning with the epic’s event-scoped URL requirement.

## Warnings

None.
