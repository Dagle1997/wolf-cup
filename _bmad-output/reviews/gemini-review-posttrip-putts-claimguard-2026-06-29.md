# Gemini Review

- Generated: 2026-06-29T13:29:09.875Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/scores.ts, apps/tournament-api/src/routes/admin-event-rounds.ts, apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx, apps/tournament-web/src/routes/admin.events.$eventId.start-round.tsx

## Summary

The code correctly implements the server-side guard for claim modifiers and the UI updates for putting games. However, there is a critical runtime error in the React component due to calling a `Set` method on an `Array`. Additionally, marking `putts_required` as a terminal offline-queue error creates a silent data loss risk for `grossStrokes` if the client gets out of sync or runs an older version.

Overall risk: high

## Findings

1. [critical] TypeError crash on `puttsPlayerIds.has()`
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:1395
   - Confidence: high
   - Why it matters: The API returns `puttsPlayerIds` as a `string[]` (and it is typed as `string[] | null` in `RoundDetail`). Arrays do not have a `.has()` method. This will throw a `TypeError` and crash the score entry page for participants in active putting games. Additionally, if the array is `null` or `undefined` (e.g., when communicating with older server builds), it will throw before evaluating.
   - Suggested fix: Use optional chaining and the array `.includes()` method: `!puttsPlayerIds?.includes(m.playerId)`. Alternatively, convert `puttsPlayerIds` to a `Set` safely before the loop.

2. [high] Silent data loss of `grossStrokes` due to terminal queue error
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:433-434
   - Confidence: high
   - Why it matters: Coupling the `putts` requirement to the `grossStrokes` write via a 422 rejection, combined with treating it as a terminal error in the offline queue, risks permanent data loss. If an older client (or a desynchronized client that missed the putting game update) enqueues a valid `grossStrokes` score without putts, the server rejects it. The queue drops the mutation immediately, and because the `StaleQueueBanner` is hidden for active scorers, the user is never notified that their score was silently discarded.
   - Suggested fix: Decouple the writes: have the server accept and persist the valid `grossStrokes` write while leaving `putts` null, deferring strict enforcement to round finalization. If it must be enforced per-hole, the frontend needs an active-scorer-visible error surface to recover and correct dropped queue items.

3. [medium] Unsafe property access on `resolved.config.modifiers`
   - File: apps/tournament-api/src/routes/admin-event-rounds.ts:686-688
   - Confidence: medium
   - Why it matters: In the `noClaimModifiersForAnyFoursome` pre-flight check, if the parsed raw JSON config lacks a `modifiers` array and `resolveConfig` does not enforce default arrays for sparse inputs, calling `.some()` on `undefined` will throw an unhandled `TypeError`. This would result in a 500 error blocking the organizer from starting the round.
   - Suggested fix: Use optional chaining and a nullish fallback: `(resolved.config.modifiers ?? []).some(...)`.

## Strengths

- Tenant-scoping is flawlessly applied in the new helper and transaction reads.
- The fail-open design of `noClaimModifiersForAnyFoursome` gracefully catches config/JSON parsing errors without blocking the critical `start-round` path.
- Prompt mapping securely integrates with existing `start` functions and nicely separates orthogonal checks.

## Warnings

- Truncated file content for review: apps/tournament-api/src/routes/scores.ts
- Truncated file content for review: apps/tournament-api/src/routes/admin-event-rounds.ts
- Truncated file content for review: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx
