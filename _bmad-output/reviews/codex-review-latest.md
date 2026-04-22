# Codex Review

- Generated: 2026-04-22T17:59:55.919Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/web/src/lib/offline-queue.ts, apps/web/src/hooks/useOfflineQueue.ts

## Summary

PASS (ready to commit), with a couple of medium-risk robustness caveats.

A) Round-3 items 1–4
- #1 (ROUND_NOT_ACTIVE terminal): Implemented as terminal and documented (useOfflineQueue.ts:105–110, 111–119). From this diff alone, this item is closed.
- #2 (terminal list incomplete): Expanded terminal classifications for score+wolf and CTP drains (useOfflineQueue.ts:110–120, 170–181). Closed.
- #3 (CTP drain guaranteed-fail requests): CTP drain is per-entry continue and now also purges terminal failures so they won’t accumulate. Behavior matches your stated rationale. Closed.
- #4 (refreshCount unhandled rejection): Wrapped in try/catch and now reads both queues. Closed.
(#5 blocked upgrade is explicitly deferred; note DB_VERSION bump to 2 makes the “blocked” edge case more likely, but that’s consistent with the deferral.)

B) Terminal list coverage vs server error responses
The diff shows expanded lists, but the server routes / error code definitions (rounds.ts, ctp-entries.ts) were not provided, so I can’t evidence-verify “covers everything the server actually returns.” I did flag one concrete risk: classification relies on `Error.message` string equality, so even correct lists can fail to match at runtime depending on `apiFetch` behavior.

C) ROUND_NOT_ACTIVE as terminal
Given the comment’s premise (“server-side locked; won’t accept on any future retry”), the decision is coherent. The only scenario where preserving would be better is if the server can later transition a round back to active and accept writes; that server behavior is not evidenced in the provided files.

D) New regressions
No obvious functional regressions from the expanded lists or refreshCount wrapper. Main new robustness risk: removal of a `finally` guard around `isDrainingRef` reset.

E) Proceed
Yes—PASS, provided you’re comfortable with the two medium caveats below (they’re not blockers but are worth tracking).

Overall risk: medium

## Findings

1. [medium] `drain()` no longer uses `finally`; an unexpected escaping exception can leave `isDrainingRef` stuck true (queue never drains until reload)
   - File: apps/web/src/hooks/useOfflineQueue.ts:46-213
   - Confidence: high
   - Why it matters: You set `isDrainingRef.current = true` and only reset it at the very end (lines 210–212). Most internal operations are wrapped in try/catch, but if any unexpected error escapes (future edits, non-Error throws that break assumptions, runtime exceptions), the hook can get permanently wedged in a “draining” state, preventing further drains.
   - Suggested fix: Wrap the entire drain body in `try { ... } finally { isDrainingRef.current = false; setIsDraining(false); await refreshCount(); }` and keep inner try/catches for classification. This restores the prior safety property without changing current logic.

2. [medium] Terminal/transient classification depends on `Error.message` strict equality; mismatch can cause stuck queues or unintended retry behavior
   - File: apps/web/src/hooks/useOfflineQueue.ts:100-181
   - Confidence: medium
   - Why it matters: Both drains do `const msg = (err as Error).message;` and compare exact strings (e.g., `msg === 'NOT_FOUND'`). If `apiFetch` throws non-Error values, includes prefixes (e.g., `HTTP 404: NOT_FOUND`), or changes message formatting, terminal errors won’t be purged (pendingCount sticks indefinitely) and transient errors may be misclassified. This directly affects offline data durability and user-visible “stuck syncing.”
   - Suggested fix: Have `apiFetch` throw a typed error with a stable `code` field (e.g., `{ code: 'NOT_FOUND', status: 404 }`), or parse the server error response and branch on a dedicated property rather than `message`. As a minimal hardening, defensively handle non-Error throws and consider `includes()` only if server guarantees uniqueness (but prefer structured codes).

3. [low] `refreshCount()` uses `Promise.all`; if either store read fails, badge count won’t update from the other store
   - File: apps/web/src/hooks/useOfflineQueue.ts:33-44
   - Confidence: medium
   - Why it matters: If one queue’s count read fails (e.g., transient IDB issue affecting only one store operation), the `catch` prevents updating `pendingCount` even if the other count is available. This can leave the UI stale longer than necessary.
   - Suggested fix: Use `Promise.allSettled` and sum the fulfilled results, leaving failed ones as 0 (or keep the previous value for the failed component only).

4. [low] CTP terminal purge is skipped if `ctp.id` is unexpectedly undefined; could leave unremovable terminal entries
   - File: apps/web/src/hooks/useOfflineQueue.ts:181-184
   - Confidence: low
   - Why it matters: In the terminal path you only remove when `ctp.id !== undefined`. In normal operation IDB should always supply `id`, but if old/corrupt data exists (or an earlier enqueue path stored objects without id materialized), terminal entries would remain forever.
   - Suggested fix: As a fallback when `id` is missing, delete by scanning for matching (roundId, groupId, holeNumber, timestamp) or add an index-based lookup to support deterministic deletion.

## Strengths

- Score and CTP queues are now clearly separated, with documented ordering and rationale (offline-queue.ts:25–30).
- Terminal error handling now purges dead entries instead of retrying forever, and unrecognized errors default to transient (safer) behavior (useOfflineQueue.ts:102–126, 160–169).
- CTP enqueue deduping is done transactionally to avoid racey duplicate/lost entries (offline-queue.ts:141–168).
- Query invalidation is best-effort and now includes CTP cache keys (useOfflineQueue.ts:200–208).
- refreshCount no longer risks an unhandled rejection and doesn’t zero the badge on IDB read failures (useOfflineQueue.ts:33–43).

## Warnings

None.
