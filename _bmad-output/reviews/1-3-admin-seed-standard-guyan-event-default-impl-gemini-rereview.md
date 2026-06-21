# Gemini Review

- Generated: 2026-06-21T22:35:33.994Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/standard-guyan-seed.ts, apps/tournament-api/src/services/game-config-write.ts, apps/tournament-api/src/services/resolve-game-config.ts, apps/tournament-api/src/services/game-config-write.test.ts, apps/tournament-api/src/services/resolve-game-config.test.ts

## Summary

The prior HIGH risk regarding the concurrent preset-seed race has been successfully resolved using deterministic primary keys and an idempotent `onConflictDoNothing()` approach. The write path now correctly validates event configurations before triggering any side effects, ensuring atomicity. Furthermore, `resolve-game-config.ts` has been fixed to gracefully handle corrupt JSON. However, a few concrete risks remain: the write path is still vulnerable to an unhandled exception if an existing row has corrupt JSON, a race condition exists that could allow duplicate configuration rows on concurrent first writes, and a redundant database query in the resolution service introduces slight inefficiency.

Overall risk: medium

## Findings

1. [medium] Unguarded JSON.parse in game-config-write.ts can cause 500s on corrupt data
   - File: apps/tournament-api/src/services/game-config-write.ts:94
   - Confidence: high
   - Why it matters: While the read service (`resolve-game-config.ts`) was updated to wrap `JSON.parse` in a try/catch, the write service parses `existing.configJson` without this protection. If an existing database row somehow contains invalid JSON, the update endpoint will throw an unhandled exception (500) and crash. This permanently blocks the user from fixing the broken configuration via an update.
   - Suggested fix: Wrap `JSON.parse(existing.configJson)` in a `try-catch` block. If parsing fails, either return an explicit fail-closed error (`{ ok: false, reason: 'existing_config_corrupt' }`) or bypass the prior config while still allowing the overwrite.

2. [medium] Race condition on concurrent first writes creates duplicate game_config rows
   - File: apps/tournament-api/src/services/game-config-write.ts:62-74
   - Confidence: high
   - Why it matters: The service uses a standard read-modify-write pattern to check for an existing config row. If two 'first writes' for the exact same event happen concurrently, both transactions will see `existing === null` and both will execute an `insert` with different newly generated `randomUUID()` IDs. If there is no unique constraint on `(tenantId, level, refId)`, this creates duplicate configuration rows. Later reads use `.limit(1)` without an `ORDER BY`, which will arbitrarily select between the duplicates, leading to unpredictable data drift where reads and updates may target different rows.
   - Suggested fix: Instead of branching logic based on a preliminary `select`, utilize a true database-level upsert with `.onConflictDoUpdate()` tied to a unique constraint on `(tenantId, level, refId)`. Alternatively, acquire a pessimistic lock on the event entity beforehand.

3. [low] Redundant database query for pairings in resolve-game-config.ts
   - File: apps/tournament-api/src/services/resolve-game-config.ts:110-122
   - Confidence: high
   - Why it matters: The exact same `select` query against the `pairings` table is executed twice for the same inputs: once around line 79 to validate that the foursome belongs to the event round, and again at line 110 to fetch the pairing row for retrieving the foursome configuration. This unnecessarily duplicates database load and adds latency.
   - Suggested fix: Extract the `pairingId` from the first validation query and store it in a variable (e.g., `let resolvedPairingId: string | null = null;`), then use that ID directly to load the level row instead of executing a second SELECT.

## Strengths

- Successfully addressed the previous race condition by leveraging deterministic primary keys and idempotent inserts (`onConflictDoNothing`), eliminating duplication.
- The write service successfully implements a fully fail-closed boundary, validating the domain model prior to creating any side effects or records.
- The `resolve-game-config.ts` logic rigorously asserts event hierarchy before executing queries, strictly preventing cross-tenant and cross-event data leaks.
- Comprehensive tests verify atomic transaction commits and specific business rule preservations (like preserving point values on a lock state change).

## Warnings

None.
