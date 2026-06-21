# Gemini Review

- Generated: 2026-06-21T22:26:19.241Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/standard-guyan-seed.ts, apps/tournament-api/src/services/game-config-write.ts, apps/tournament-api/src/services/resolve-game-config.ts, apps/tournament-api/src/routes/admin-event-game-config.ts, apps/tournament-api/src/engine/types/activity-events.ts, apps/tournament-api/src/lib/audit-log.ts, apps/tournament-web/src/routes/admin.events.$eventId.game-config.tsx, apps/tournament-web/src/routes/admin.events.$eventId.index.tsx, apps/tournament-api/src/services/resolve-game-config.test.ts, apps/tournament-api/src/services/game-config-write.test.ts, apps/tournament-api/src/routes/admin-event-game-config.test.ts

## Summary

The implementation correctly establishes the F1 "Rules & Games" setup with strong authorization and hierarchy isolation, preventing cross-event leaks. Transaction boundaries correctly encapsulate the config write, audit logging, and activity emission. However, the system is vulnerable to a race condition during the preset find-or-create flow because the `rule_sets` table lacks a uniqueness constraint, which could fragment the source of truth for the F1 preset.

Overall risk: high

## Findings

1. [high] Concurrent seeding race condition due to missing unique constraint on rule_sets
   - File: apps/tournament-api/src/services/standard-guyan-seed.ts:74-113
   - Confidence: high
   - Why it matters: The find-or-create operation for the 'Standard Guyan' preset relies on a `SELECT` followed by an `INSERT`. Because the `rule_sets` table lacks a `UNIQUE(tenant_id, name)` constraint (as confirmed in the review request), concurrent requests for the same tenant will both see `existing` as empty and insert duplicate rule sets. This breaks the singleton assumption of the preset and fragments data across the tenant, as subsequent reads will non-deterministically select one of the duplicated presets.
   - Suggested fix: Add a `UNIQUE(tenant_id, name)` constraint to the `rule_sets` database schema. Then update the find-or-create logic to use an `ON CONFLICT DO NOTHING` / upsert pattern (or gracefully catch the unique violation) to guarantee exactly one row is created under concurrency.

2. [low] Duplicate database query for pairing ID in resolveEventGameConfig
   - File: apps/tournament-api/src/services/resolve-game-config.ts:78-119
   - Confidence: high
   - Why it matters: The `resolveEventGameConfig` function executes identical database queries to look up the pairing ID by `foursomeNumber` and `eventRoundId`. The first lookup is done during the hierarchy validation phase, and the second occurs later when preparing to load the foursome-level game config. This causes an unnecessary database roundtrip.
   - Suggested fix: Store the `pairingRows[0].id` fetched during the hierarchy validation phase in a local variable (e.g., `let pairingId: string | null = null;`) and reuse it during the `loadLevelRow` phase instead of querying the `pairings` table again.

## Strengths

- Excellent defense-in-depth on hierarchy validation (`resolve-game-config.ts`), executing checks prior to loading configs to ensure no cross-event data leak is possible.
- Strong transaction boundaries in the write path (`game-config-write.ts`), ensuring the DB row, audit trail, and feed activity are committed atomically.
- DRY input validation securely defers config logic validation to the engine's `parseGameConfig`, failing closed accurately.
- Comprehensive test coverage for API routing, error conditions, missing configurations, and endpoint authorization.

## Warnings

None.
