# Codex Review

- Generated: 2026-04-28T14:48:33.036Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/lib/offline-queue.ts, apps/tournament-web/src/lib/offline-queue.test.ts, apps/tournament-web/src/hooks/useOfflineQueue.ts

## Summary

Round-2 items appear genuinely addressed (single VALID_KINDS import, explicit id-missing skip before any quarantine/removal, and a snapshot-semantics test that matches the new freeze+copy behavior). However, exporting VALID_KINDS as a shared Set introduces a new footgun (runtime mutability by consumers). Separately, the drain’s “malformed entry” guard is still incomplete: certain corrupted shapes (non-string url/clientEventId, circular body) will bypass quarantine and instead trigger the “network/5xx” BREAK path, potentially blocking the entire queue behind one bad row.

Overall risk: medium

## Findings

1. [high] Malformed-entry quarantine misses type/serializability checks; a corrupted row can BREAK drain and block N+1
   - File: apps/tournament-web/src/hooks/useOfflineQueue.ts:94-120
   - Confidence: high
   - Why it matters: The comment says corrupted entries are quarantined, but `isMalformed` only checks truthiness and VALID_KINDS membership. A row with `url` as a truthy non-string (e.g., `{}`) or `clientEventId` as a truthy non-string will pass `isMalformed` and proceed to `fetch(entry.url, …)` (or `JSON.stringify(entry.body)`). If `fetch` is invoked with an invalid URL type, or `JSON.stringify` throws (e.g., circular body), the code falls into the `catch` at lines 108–120, sets `needsHeartbeat = true`, and `break`s. That leaves the bad entry in the queue and prevents processing subsequent entries (N+1 blocked) while repeatedly retrying via heartbeat.
   - Suggested fix: Strengthen the pre-fetch validation to check types and serializability, and quarantine on failure instead of treating it as a network/server outage. For example:
- `typeof entry.url === 'string' && entry.url.length > 0`
- `typeof entry.clientEventId === 'string' && entry.clientEventId.length > 0`
- optionally `typeof entry.roundId === 'string' && entry.roundId.length > 0`
- attempt `JSON.stringify(entry.body)` in a try/catch *before* the fetch; if it throws, quarantine (or mark errored) and continue.
Also consider validating that `retryCount` is a finite number before using it.

2. [medium] Exported VALID_KINDS is a mutable Set; external mutation can silently change runtime validation behavior
   - File: apps/tournament-web/src/lib/offline-queue.ts:29-40
   - Confidence: high
   - Why it matters: `VALID_KINDS` is exported as a `ReadonlySet<MutationKind>`, but that is TypeScript-only. At runtime it is a real mutable `Set`, so any importing code can do `VALID_KINDS.add('hole_score')` / `.clear()` / `.delete(...)` and affect *all* validators (enqueue + drain) because they share the same object. This expands the public API surface in a way that can cause hard-to-debug acceptance/rejection of queue entries and weakens the “single source of truth” goal by making the source externally mutable.
   - Suggested fix: Avoid exporting a mutable Set instance. Options:
- Export an immutable tuple/array of kinds (e.g., `export const VALID_KINDS = ['…'] as const`) and have each consumer build its own `new Set(VALID_KINDS)`.
- Export a predicate `export function isValidKind(x: unknown): x is MutationKind` that closes over a non-exported Set.
- If you keep exporting the Set, at least document it as internal/unstable and do not rely on its immutability; note that `Object.freeze(new Set())` does not prevent `.add()` from mutating internal Set data.

## Strengths

- Round-2 fixes are not just cosmetic: `entry.id === undefined` is checked before any use of `entry.id` (useOfflineQueue.ts 82–92), eliminating the previous unsafe access path.
- VALID_KINDS is now used by both enqueue and drain, removing the previous duplicated runtime list and reducing one common drift vector (offline-queue.ts 35–40; useOfflineQueue.ts 24, 98).
- Terminal-error registry snapshot semantics are correctly implemented via `Object.freeze([...codes])` (offline-queue.ts 126–129) and pinned by a dedicated test (offline-queue.test.ts 189–196).
- Heartbeat timer handling clears stale timers before scheduling new ones, preventing timer stacking across repeated failures (useOfflineQueue.ts 205–214).

## Warnings

None.
