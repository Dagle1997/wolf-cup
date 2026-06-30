# Gemini Review

- Generated: 2026-06-26T04:06:34.926Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/admin-event-rounds.ts, apps/tournament-api/src/routes/scores.ts, apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.tsx, apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx

## Summary

The addition of putts tracking cleanly introduces the `putting_contest` configuration without disrupting existing skins logic or score entry for groups without the game enabled. However, there is a severe data loss bug caused by adding `currentPutts` to the auto-save dependency array. Because the backend's score endpoint relies on `clientEventId` idempotency to ignore duplicate submissions silently (`onConflictDoNothing`), subsequent saves triggered by adjusting the putts stepper will be dropped by the server.

Overall risk: high

## Findings

1. [high] Adding currentPutts to auto-save dependencies causes data loss due to server-side deduplication
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:1492
   - Confidence: high
   - Why it matters: The `currentPutts` state was added to the dependency array of the score enqueue hook. Because score auto-advance triggers when `allValid` is true, the initial auto-save often fires with `putts: null` if the scorer hasn't touched the stepper yet. If the scorer then clicks the putts stepper, `currentPutts` updates and re-triggers the effect, enqueuing a new save. However, because the client reuses the same `clientEventId` per hole/player, the backend's `onConflictDoNothing` uniquely ignores the subsequent saves (returning a `200 OK deduped` response). The user's entered putts are silently dropped by the server.
   - Suggested fix: Remove `currentPutts` (and `puttsPlayerIds`) from the auto-save dependency array. Instead, use a `useRef` to store the latest `currentPutts` state so the save handler reads the current putts without triggering an excessive resave loop when the stepper is clicked. Alternatively, if your system supports explicit score updates, generate a new `clientEventId` for explicit stepper interactions after the initial save.

## Strengths

- Tenant-scoping constraints are consistently applied in all new sub_games and sub_game_participants DB queries.
- Gracefully handles `puttingBuyIn` via the `dollarsToCents` conversion, robustly defaulting empty or invalid strings to 0.
- The sub-game configuration endpoint safely leverages the existing DELETE-then-INSERT atomic pattern, averting race conditions.
- The putts seeding correctly preserves pre-existing server-side putts for non-putting-game players without overwriting them with `null`.

## Warnings

- Truncated file content for review: apps/tournament-api/src/routes/admin-event-rounds.ts
- Truncated file content for review: apps/tournament-api/src/routes/scores.ts
- Truncated file content for review: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx
