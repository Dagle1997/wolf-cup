# Codex Review

- Generated: 2026-04-28T14:50:57.488Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/lib/offline-queue.ts, apps/tournament-web/src/hooks/useOfflineQueue.ts

## Summary

Round-3 items are largely resolved as described: kind validation is now non-mutable via an exported predicate, and drain now pre-serializes `entry.body` before deciding whether to quarantine, avoiding late-stage stringify exceptions that would previously hit the BREAK path. One subtle gap remains: `JSON.stringify` can return `undefined` (without throwing) for certain top-level values (e.g., functions/symbols), which is not currently treated as malformed and will result in `fetch` being called with an effectively empty body while still setting `Content-Type: application/json`. This is unlikely but can cause hard-to-debug server errors/retry/purge behavior.

Overall risk: medium

## Findings

1. [medium] Drain pre-serialization misses the case where JSON.stringify returns undefined (no throw), allowing empty-body requests with Content-Type: application/json
   - File: apps/tournament-web/src/hooks/useOfflineQueue.ts:98-125
   - Confidence: high
   - Why it matters: The round-3 fix correctly catches stringify *throws* (e.g., circular refs / BigInt) and quarantines. However, `JSON.stringify` can also return `undefined` without throwing when the *top-level* value is not representable in JSON (notably `function` and `symbol`). In that case, `serializedBody` becomes `undefined` at runtime, `isMalformed` remains false because it only checks `serializedBody === null`, and the code proceeds to `fetch` with `body: serializedBody` while still setting JSON content-type. This can yield confusing 4xx responses, trigger retry/failsafe purge, and effectively lose the original mutation even though it was “malformed”.
   - Suggested fix: Tighten the malformed check to treat non-string results as malformed:
- initialize `serializedBody` as `string | null` but assign via a temp: `const s = JSON.stringify(entry.body); serializedBody = typeof s === 'string' ? s : null;`
- or add `serializedBody === null || typeof serializedBody !== 'string'` (or specifically handle `undefined`) to `isMalformed`.
Also consider adding a test case for `entry.body` being a function/symbol to ensure it quarantines.

2. [low] Pre-serializing at drain time can silently transform structured-cloneable but non-JSON shapes (Map/Set/etc.) without quarantine
   - File: apps/tournament-web/src/hooks/useOfflineQueue.ts:94-125
   - Confidence: medium
   - Why it matters: Because IndexedDB can store many values via structured clone (e.g., `Map`, `Set`, class instances), entries may enqueue successfully but serialize to unexpected JSON later (e.g., `JSON.stringify(new Map([['a',1]]))` becomes `{}`), potentially producing incorrect requests. This isn’t new behavior introduced by the round-3 fix, but the new early-serialization step is a good place to optionally detect and quarantine/throw for non-plain-JSON bodies to avoid silent corruption.
   - Suggested fix: If the API contract requires JSON-safe bodies, consider validating at enqueue (preferred) or drain that `entry.body` is JSON-compatible (plain object/array/string/number/boolean/null) before storing/sending, and quarantine otherwise. Add targeted tests if you adopt this.

## Strengths

- Round-3 HIGH issue (late stringify TypeError causing BREAK) is addressed by pre-serializing once and reusing the result in fetch (useOfflineQueue.ts:98-125).
- Round-3 MED issue (mutable exported Set) is addressed by keeping the Set module-private and exporting a read-only predicate `isValidKind` (offline-queue.ts:35-45).
- Malformed-entry quarantine is now type-tight for url/clientEventId/kind/body and catches stringify exceptions (useOfflineQueue.ts:94-116), reducing N+1 blocking risk.
- Heartbeat scheduling avoids timer stacking by clearing before setting a new timeout (useOfflineQueue.ts:216-225).

## Warnings

None.
