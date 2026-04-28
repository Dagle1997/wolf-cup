# Codex Review

- Generated: 2026-04-28T13:23:04.434Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-3-offline-queue-indexeddb-client-event-id-idempotency.md

## Summary

STOP-on-High. Round-3 items are mostly addressed in the Acceptance Criteria text, but the spec still contains a high-risk drain detail that can easily lead to a real implementation bug (unconditional `response.json()`), plus a few new/remaining inconsistencies (Tasks section test counts vs AC) and some under-specified timer behavior that can cause stacked heartbeats or post-unmount execution.

Overall risk: high

## Findings

1. [high] Drain spec implies unconditional `await response.json()` which can break success-path drains (204/empty body) and cause queue lockup
   - File: _bmad-output/implementation-artifacts/tournament/T5-3-offline-queue-indexeddb-client-event-id-idempotency.md:168-175
   - Confidence: high
   - Why it matters: AC #4 states “The response is parsed as JSON (`await response.json()`)” (line 170) and only later defines status-based handling for 2xx/409/4xx/5xx (lines 171-175). If an implementer follows this literally (parse before branching), any endpoint that returns 204 No Content or a 200 with an empty/non-JSON body will throw in `response.json()`. That can prevent `removeFromQueue()` on a true success and/or incorrectly route the code into error handling, effectively retrying forever and blocking queue progress. Since the queue is intentionally generic (`url` is consumer-supplied), the library cannot safely assume all success responses are JSON.
   - Suggested fix: Make the spec explicit about parsing order and conditions. For example: check `response.ok` first and skip JSON parsing for 2xx; or do `let body: unknown = null; try { body = await response.json(); } catch { body = null; }` and ensure 2xx still purges regardless. Reserve `{code}` parsing for non-2xx responses where tournament-api guarantees JSON error bodies.

2. [medium] Tasks section still contradicts AC test counts (+14) and per-file test counts (+9/+5/+1)
   - File: _bmad-output/implementation-artifacts/tournament/T5-3-offline-queue-indexeddb-client-event-id-idempotency.md:194-259
   - Confidence: high
   - Why it matters: AC #7 and the attribution list specify 9 library tests, 5 `useOfflineQueue` tests, and 1 `useOnlineStatus` test (lines 202-223). But Tasks steps still reference older counts: step 7 says “(8 tests)” (line 254), step 8 says “(3 tests)” (line 255), and step 11 says “9 lib tests + 4 hook tests + 1 status hook test” (line 258). This is concrete spec drift that can mislead implementation, create “done” confusion, or cause the dev to stop short of the required coverage.
   - Suggested fix: Update Tasks steps 7/8/11 to match AC #7: 9 lib tests, 5 useOfflineQueue tests, 1 status test, total 15, net +14 minimum. If the Tasks list is non-authoritative, explicitly say “Counts per AC #7; numbers below are outdated/ignored” (but better to correct them).

3. [medium] Heartbeat timer contract doesn’t prevent stacked timeouts when multiple drains fail before the prior timer fires
   - File: _bmad-output/implementation-artifacts/tournament/T5-3-offline-queue-indexeddb-client-event-id-idempotency.md:175
   - Confidence: medium
   - Why it matters: The lifecycle rules added for `setTimeout` cover clearing on success and on unmount (line 175), but they don’t state that an existing pending timer must be cleared/overwritten before scheduling a new one on subsequent 5xx/network failures. A realistic sequence (manual `drain()` calls, repeated online events, or repeated failures) can schedule multiple future drains, causing redundant work and harder-to-reason-about state updates. The single-flight lock prevents overlap, but not timer accumulation over time.
   - Suggested fix: Add an explicit rule: before scheduling a new heartbeat timeout, `clearTimeout(timerRef.current)` if set, then assign the new id. Also consider: if unmounted, the timeout callback should no-op (e.g., `isMountedRef`) to avoid state updates after unmount if the callback was already queued.

4. [low] `_resetTerminalErrorsForTests()` is exported in production surface; spec doesn’t define any guard against accidental runtime use
   - File: _bmad-output/implementation-artifacts/tournament/T5-3-offline-queue-indexeddb-client-event-id-idempotency.md:128-131
   - Confidence: medium
   - Why it matters: AC #1 requires exporting `_resetTerminalErrorsForTests()` (lines 128-131). Prefixing with `_` is a convention, not enforcement; a production caller could invoke it and silently break terminal error classification at runtime. This is low likelihood but real-footgun potential because the registry is module-global.
   - Suggested fix: If you keep the export, document it as `/** @internal test-only */` and (optionally) make it throw unless `import.meta.env.MODE === 'test'` or `process.env.NODE_ENV === 'test'` (depending on tooling). Alternative: avoid exporting and instead expose via a test-only module path, but that changes the spec.

## Strengths

- Round-3 contradiction about transient 4xx CONTINUE vs BREAK appears resolved: AC #4 now explicitly states transient 4xx CONTINUES (line 174) while 5xx/network BREAK (line 175), and the hook tests list aligns with that intent (lines 216-218).
- Failsafe off-by-one is now explicitly and consistently specified: increment retryCount, then purge when `retryCount >= MAX_TRANSIENT_RETRIES`, with a concrete 0→5 example (line 54) and matching test attribution (line 218).
- The added timeout lifecycle rules (clear on success, clear on unmount, recreate on roundId change) are a meaningful improvement over the prior ambiguous heartbeat behavior (line 175).
- The spec is generally concrete about API surface, event names/payloads, and IDB behaviors (conflict retention, quarantine atomic move, terminal error registry).

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T5-3-offline-queue-indexeddb-client-event-id-idempotency.md
