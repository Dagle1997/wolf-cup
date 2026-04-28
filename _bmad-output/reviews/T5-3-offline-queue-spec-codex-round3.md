# Codex Review

- Generated: 2026-04-28T13:19:47.670Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-3-offline-queue-indexeddb-client-event-id-idempotency.md

## Summary

Round-2 items are mostly addressed in intent (transient-4xx no longer blocks; overwrite semantics clarified; retryCount increments narrowed; query invalidation decoupled). However, the spec now contains internal contradictions that would likely cause an incorrect implementation (or incorrect tests), and the new 30s heartbeat needs tighter lifecycle/closure requirements to avoid stale-round drains and timer leaks. As written, it is close but not fully “Ready for Dev” because a developer cannot implement + test it unambiguously without resolving these conflicts.

Overall risk: high

## Findings

1. [high] Spec contradiction: transient 4xx handling says CONTINUE, but tests still require BREAK (reintroduces/obscures the Round-2 fix)
   - File: _bmad-output/implementation-artifacts/tournament/T5-3-offline-queue-indexeddb-client-event-id-idempotency.md:161-216
   - Confidence: high
   - Why it matters: AC #4 explicitly changed semantics to **CONTINUE** after transient 4xx (non-terminal) so unrelated entries can drain (lines 172-174). But AC #7’s `useOfflineQueue.test.tsx` test #3 still asserts the opposite: that on a transient 4xx for entry 1, the drain **breaks** and entries 2–3 are not POSTed (lines 212-216). This is a hard inconsistency: either the implementation matches AC #4 and the test must change, or the test encodes the old behavior and the Round-2 fix is effectively “papered over.”
   - Suggested fix: Update AC #7 test #3 to match AC #4: for transient 4xx on entry 1 of 3, drain should increment retryCount/persist (and potentially failsafe), then **continue** and attempt entries 2–3. If you still want a BREAK behavior for some 4xx classes, re-spec that explicitly and revert the AC #4 bullet accordingly.

2. [high] Off-by-one ambiguity: when exactly does the universal failsafe purge (5th transient 4xx vs 6th)?
   - File: _bmad-output/implementation-artifacts/tournament/T5-3-offline-queue-indexeddb-client-event-id-idempotency.md:54-216
   - Confidence: high
   - Why it matters: Risk Acceptance §2(l) says: “When `retryCount >= MAX_TRANSIENT_RETRIES` … **the next time** that entry hits a transient 4xx, it is treated as terminal” (lines 54-55). That wording implies purge on the *(MAX+1)th* transient 4xx if `retryCount` is incremented after each attempt.

But AC #4 says on a transient 4xx you increment retryCount and then “if `retryCount >= MAX_TRANSIENT_RETRIES (5)` → … purge” (line 173), which implies purge on the **5th** transient 4xx (starting from 0). AC #7 test #4 also expects purge “on the 5th attempt” (lines 215-217).

This is a correctness boundary that affects data loss timing and test expectations.
   - Suggested fix: Choose one rule and state it consistently:
- Option A (common): increment first; if `retryCount >= 5` then purge (purge on 5th transient 4xx).
- Option B: if `retryCount >= 5` before increment, then purge on next transient (purge on 6th).
Then align §2(l), AC #4, and AC #7 test wording to match.

3. [medium] 30s heartbeat retry via setTimeout: spec doesn’t require unmount cleanup or protection against stale roundId/drain closures
   - File: _bmad-output/implementation-artifacts/tournament/T5-3-offline-queue-indexeddb-client-event-id-idempotency.md:149-175
   - Confidence: medium
   - Why it matters: AC #4 adds `setTimeout(drain, 30_000)` after 5xx/network break (line 174) and claims “timeout-driven retries are bounded” and “successful 200 cancels any pending timeout via clearTimeout” (line 174). But the spec doesn’t require:
- Clearing the timer on hook unmount (preventing a post-unmount drain call/state update).
- Ensuring the scheduled callback uses the **latest** `roundId`/drain function if `useOfflineQueue(roundId)` is re-rendered with a new roundId.

Without these requirements, an implementation can legitimately satisfy the spec text but still leak timers or drain the wrong round after navigation—exactly the risk you called out in 2(a).
   - Suggested fix: In AC #2 / AC #4, explicitly require:
- Store timer id in a ref; `clearTimeout` on unmount and before scheduling a new one.
- Ensure the scheduled function calls the latest `drain` (e.g., `drainRef.current()`), not a stale closure.
- Clear any pending timer when a drain run observes an empty queue or completes without hitting the 5xx/network break (not only on a 200).

4. [medium] Decoupling query invalidation to “observe pendingCount decrement” is not verifiable in isolation and may be insufficient signal
   - File: _bmad-output/implementation-artifacts/tournament/T5-3-offline-queue-indexeddb-client-event-id-idempotency.md:169-174
   - Confidence: medium
   - Why it matters: AC #4 now says T5-3 does not invalidate query keys, and that T5-2 will invalidate “after observing pendingCount decrement” (line 170). PendingCount is an aggregate and does not indicate *which* entry succeeded or what data to invalidate; it can also change due to quarantine, failsafe purge, discard, etc. This pushes correctness onto T5-2 in a way that’s hard to test/guarantee from T5-3 alone and may lead to stale UI if T5-2 misses edge cases (e.g., pendingCount decremented due to quarantine/failsafe but no server mutation landed).
   - Suggested fix: Keep “no TanStack coupling” but add a queue-level success signal that’s semantically tied to server success, e.g. emit a `tournament-offline-queue-entry-succeeded` CustomEvent with `{ entryId, kind, clientEventId }` on 2xx only, or have `drain()` return a result summary (succeeded/failed/conflict/quarantined). Then T5-2 can invalidate based on succeeded entries rather than a count delta.

5. [low] Terminal error registry is module-global but spec doesn’t address reset/isolation (test flakiness and cross-round contamination risk)
   - File: _bmad-output/implementation-artifacts/tournament/T5-3-offline-queue-indexeddb-client-event-id-idempotency.md:128-130
   - Confidence: medium
   - Why it matters: AC #1 specifies a module-local Map for terminal errors (lines 128-130). With a shared module singleton, registrations can persist across tests and across multiple hook instances/rounds in a single session. The spec doesn’t state whether re-register overwrites vs merges, nor any reset mechanism for tests. This can cause order-dependent tests or unexpected behavior when multiple consumers register the same kind.
   - Suggested fix: Specify registry semantics: overwrite vs union, and add a `clearTerminalErrorsForTest()` export guarded for test builds or document that tests must `vi.resetModules()` between cases. Also clarify whether `registerTerminalErrors` replaces prior codes for that kind (recommended).

6. [low] Test plan and Tasks section have inconsistent test counts (minor but indicates spec drift)
   - File: _bmad-output/implementation-artifacts/tournament/T5-3-offline-queue-indexeddb-client-event-id-idempotency.md:193-257
   - Confidence: high
   - Why it matters: AC #7 enumerates 9 + 4 + 1 = 14 tests (lines 201-221) and requires net +14 (line 197). But Tasks step 7/8/9 still describe “(8 tests) / (3 tests) / (1 test)” (lines 252-255), which conflicts with the later “confirm net +14… (9 lib tests + 4 hook tests + 1…)” (line 256). This won’t break code, but it will confuse implementation tracking.
   - Suggested fix: Update Tasks steps 7-9 to match the AC #7 enumerated counts (9 / 4 / 1) or adjust AC #7 attribution to match intended counts.

## Strengths

- Round-2 intent is reflected in core ACs: transient 4xx no longer blocks unrelated entries (AC #4), 5xx/network break + heartbeat is specified, and a single-flight drain lock with finally-release is called out (lines 174-180).
- resolveConflict('overwrite') semantics are now explicit and consistent: body is replaced verbatim and retryCount reset; no contradictory “mutates overwriteFlag” language remains (lines 76-86, 126-127).
- retryCount increment scope is explicitly narrowed (transient 4xx only) and 409 is treated as a user-decision hold (lines 54-55, 171-174).
- Quarantine semantics are well specified (atomic move transaction; non-transient; continues draining) (lines 88-91, 187-192).

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T5-3-offline-queue-indexeddb-client-event-id-idempotency.md
