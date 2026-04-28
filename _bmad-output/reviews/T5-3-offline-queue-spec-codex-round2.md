# Codex Review

- Generated: 2026-04-28T13:16:38.724Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-3-offline-queue-indexeddb-client-event-id-idempotency.md

## Summary

Round-1 issues are mostly resolved in the main AC sections (caller-supplied clientEventId, drain reads response.json().code, fetch contract spelled out, quarantine-before-fetch, CustomEvent use, overwrite overload exists, universal failsafe described + test). However, there are a few concrete internal contradictions and one major behavioral gap: the spec’s “break on transient error and retry on next online event” can stall indefinitely while already online, preventing both progress and the new failsafe from ever triggering. There’s also a direct contradiction re: whether resolveConflict('overwrite') mutates the body vs replaces it verbatim.

Overall risk: medium

## Findings

1. [high] Drain can stall indefinitely after transient failures because retries depend on a future 'online' event
   - File: _bmad-output/implementation-artifacts/tournament/T5-3-offline-queue-indexeddb-client-event-id-idempotency.md:56-175
   - Confidence: high
   - Why it matters: AC #4 specifies that on transient failures (4xx not allowlisted, and 5xx/network) the drain BREAKs and “will retry on next 'online' event” (lines 173–174). If the app is already online (navigator.onLine true) and no further 'online' event fires, the queue may never retry, leaving entries stuck forever. This also undermines the universal failsafe: the “5 passes” required to purge a sticky 4xx may never occur in real usage unless some other code repeatedly calls drain(). The spec currently doesn’t require any re-trigger mechanism (timer/backoff, focus/visibility trigger, or enqueue-triggered drain).
   - Suggested fix: Specify at least one deterministic re-trigger path when BREAK happens while still online (e.g., schedule setTimeout-based retry with backoff; or trigger drain on visibilitychange/focus; or have enqueueMutation optionally kick drain when online; or have useOfflineQueue call drain on mount and on an interval while pendingCount>0). Update tests to pin the chosen behavior (e.g., after a transient 5xx, drain retries after X ms and eventually succeeds).

2. [medium] Contradiction: resolveConflict('overwrite') is described as both body replacement and as mutating overwriteFlag internally
   - File: _bmad-output/implementation-artifacts/tournament/T5-3-offline-queue-indexeddb-client-event-id-idempotency.md:76-282
   - Confidence: high
   - Why it matters: Main spec/AC text says overwrite takes overwriteBody and replaces entry.body verbatim; “T5-3 does NOT mutate the body itself” (lines 78–79, 126, 177). But Risks later states: “AC #1's resolveConflict('overwrite') mutates the entry body to set overwriteFlag: true” (line 281) and implies T5-3 may need changing if T5.10 picks a different field. That directly reintroduces the round-1 concern and can lead to an implementation that incorrectly hardcodes a field name.
   - Suggested fix: Pick one contract and delete the other. If the intended contract is pure replacement, remove/rewriter the Risks bullet at lines 281–282 to match. If you actually want T5-3 to set a flag, then the earlier sections and overload signature should reflect that explicit coupling (field name, shape, tests).

3. [medium] retryCount increment semantics are inconsistent ("every transient-failure" vs only certain 4xx)
   - File: _bmad-output/implementation-artifacts/tournament/T5-3-offline-queue-indexeddb-client-event-id-idempotency.md:54-175
   - Confidence: high
   - Why it matters: Risk Acceptance §2(l) says retryCount is “incremented on every transient-failure pass” (line 54) but immediately says 5xx+network “do NOT count toward the retry-count threshold” (line 54), while AC #1 says retryCount is “incremented only on transient-4xx” (line 119) and AC #4 increments only on 4xx not in allowlist (line 173) and explicitly does not increment for 5xx/network (line 174). This inconsistency can produce divergent implementations (some increment on 5xx but exempt from threshold; others never increment on 5xx). It also affects observability in lastError and the failsafe event detail.
   - Suggested fix: Define one rule unambiguously. Suggested: increment retryCount only for 4xx (excluding 409) where code is not terminal; do not increment for 5xx/network/409. Update §2(l) wording to match AC #4/AC #1.

4. [low] AC #4 mentions query invalidation but then says the API is out of scope; this is self-contradictory for implementers
   - File: _bmad-output/implementation-artifacts/tournament/T5-3-offline-queue-indexeddb-client-event-id-idempotency.md:170
   - Confidence: high
   - Why it matters: Line 170 states “invalidate any TanStack Query keys the consumer registered” but then immediately says the registration API is out of scope and “T5-3's drain just removes the entry.” This creates ambiguity about whether T5-3 needs an invalidation registry surface or not.
   - Suggested fix: Either remove invalidation from AC #4 entirely (if truly out of scope), or define the minimal API and tests for it (if required).

5. [low] Tasks section test counts are out of sync with AC #7 (8/3/1 vs 9/4/1)
   - File: _bmad-output/implementation-artifacts/tournament/T5-3-offline-queue-indexeddb-client-event-id-idempotency.md:252-254
   - Confidence: high
   - Why it matters: AC #7 lists 9 offline-queue tests and 4 useOfflineQueue tests (lines 201–217), but Tasks steps still say 8 and 3 (lines 252–254). That’s minor, but it’s a concrete “Ready for Dev” papercut and can cause churn during implementation/verification.
   - Suggested fix: Update Tasks steps 7–9 to match the enumerated tests (9/4/1) and ensure the stated floor/target is consistent (AC #7 currently mixes +12 and +14 language).

## Strengths

- Round-1 clientEventId contradiction appears genuinely resolved: spec consistently assigns UUID v4 generation to the caller; enqueue validates non-empty and never regenerates (lines 66–69, 121–122, test list line 203).
- Terminal error classification is now clearly tied to response JSON body.code (lines 53–54, 169–173), addressing the prior request/response confusion.
- Conflict handling is much more concrete: 409 retains entry, sets conflictPending, fires CustomEvent with detailed payload, and drain skips conflictPending entries until resolveConflict clears (lines 72–87, 167–172).
- Quarantine behavior is explicitly before fetch and continues draining (lines 175–176, 187–192), matching the prior semantic gap.
- Universal failsafe is explicitly specified and pinned by a test scenario (lines 54–55, 173–174, 216–217).
- Fetch contract is spelled out with method/headers/credentials/body serialization (line 168).

## Warnings

None.
