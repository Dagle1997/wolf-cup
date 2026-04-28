# Codex Review

- Generated: 2026-04-28T17:46:54.882Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx

## Summary

Round-2 fixes largely address the originally reported issues (sync-throw safety in Promise.allSettled, retry dedupe stability, banner text). However, the new retry/dedupe path still has an edge-case where the UI may prevent the user from performing the instructed “tap Save again to retry” flow, and the clientEventId cache is in-memory only (potentially reintroducing duplicate submissions across reloads if the offline queue persists).

Overall risk: medium

## Findings

1. [high] Partial-enqueue failure path can block the advertised “tap Save again to retry” behavior and may leave queued items undrained
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:393-472
   - Confidence: medium
   - Why it matters: In the partial-failure branch (some enqueues resolved, some rejected), the UI sets an error message telling the user to “tap Save again to retry” (lines 464-466) but then returns without calling queue.drain() (lines 463-472). At the same time, the Save button is disabled whenever queue.pendingCount > 0 (isPending at line 393; disabled at line 556). If any enqueues succeeded, pendingCount will likely be > 0, so Save may be disabled and the user cannot immediately retry enqueuing the missing cells, contradicting the guidance and potentially stalling completion until an external/heartbeat drain happens (which is not shown/guaranteed from this file).
   - Suggested fix: Consider (a) calling `void queue.drain()` even on partial failure so successful enqueues flush promptly, and/or (b) not disabling Save purely on `pendingCount > 0` (maybe only disable on `queue.isDraining`), and/or (c) adjusting the retry message to match the actual constraints (e.g., “wait for sync, then tap Save again”). Add a test covering a simulated partial enqueue failure where some promises reject and ensure the UI still permits retrying the missing cells.

2. [medium] clientEventId dedupe cache is not persisted; reload/navigation can reintroduce duplicate submissions if the offline queue persists
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:397-441
   - Confidence: medium
   - Why it matters: The retry-dedupe fix relies on `clientEventIdCache` (useRef Map) to reuse IDs across retries for the same (hole, player) (lines 397-441) and clears it on `currentHole` change (lines 406-408). This works for same-session retries, but if the app is refreshed or the component remounts while there are still queued mutations for the current hole (common in offline-queue designs), the cache will be empty and a new Save attempt will generate new clientEventIds. That can reintroduce the “duplicate cell under different IDs” problem across reloads, depending on how the server dedupes and whether the queue persists across reloads.
   - Suggested fix: If offline queue entries persist across reloads, consider deriving/reusing `clientEventId` from any existing queued mutation for (roundId, hole, playerId), or persisting the cache to sessionStorage keyed by (roundId, hole, playerId), or making the server idempotency key independent of clientEventId (e.g., unique on roundId+hole+playerId with upsert semantics). Add an integration test that reloads with pending queued items and re-saves the same hole to verify no duplicate submissions are created.

## Strengths

- Sync-focus requirement appears preserved: `scoreInputRefs.current[0]?.focus()` is still executed synchronously before any `await` (lines 415-421), and the new `.map()` try/catch does not introduce an earlier await.
- Sync-throw handling in the enqueue construction is now robust: exceptions in the `.map()` callback are converted to rejected promises so `Promise.allSettled` observes all outcomes (lines 422-460).
- Retry dedupe within a single hole/session is correctly stabilized via a per-(hole,player) cache and reuse (lines 432-441), and the banner text now uses `members.length` (lines 539-545).

## Warnings

None.
