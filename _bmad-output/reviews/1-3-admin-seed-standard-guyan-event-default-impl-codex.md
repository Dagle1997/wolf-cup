# Codex Review

- Generated: 2026-06-21T22:24:33.576Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/standard-guyan-seed.ts, apps/tournament-api/src/services/game-config-write.ts, apps/tournament-api/src/services/resolve-game-config.ts, apps/tournament-api/src/routes/admin-event-game-config.ts, apps/tournament-api/src/engine/types/activity-events.ts, apps/tournament-api/src/lib/audit-log.ts, apps/tournament-web/src/routes/admin.events.$eventId.game-config.tsx, apps/tournament-web/src/routes/admin.events.$eventId.index.tsx, apps/tournament-api/src/services/resolve-game-config.test.ts, apps/tournament-api/src/services/game-config-write.test.ts, apps/tournament-api/src/routes/admin-event-game-config.test.ts

## Summary

Core hierarchy validation in `resolveEventGameConfig` is generally strong (roundId→eventId and foursomeNumber→pairings checks are tenant-scoped and happen before any `game_config` reads). Auth gating on all three admin endpoints matches the intended pattern (middleware + per-handler organizer-of-event check). The main correctness/security concerns are (1) hard-coded tenant handling (route + audit helper), and (2) write-path “fail closed” not being fully side‑effect‑free because preset seeding can commit even when config validation fails. Preset idempotency is also vulnerable to concurrent double-seed due to missing DB uniqueness.

Overall risk: high

## Findings

1. [high] Hard-coded tenantId (`'guyan'`) in router (and audit writer) undermines tenant isolation guarantees
   - File: apps/tournament-api/src/routes/admin-event-game-config.ts:27-34
   - Confidence: high
   - Why it matters: This story is explicitly cross-tenant sensitive. The router pins `TENANT_ID = 'guyan'` (line 28) and uses it for authorization (`isEventOrganizerByEventId`) and for all `game_config` reads/writes. If/when multiple tenants exist in the same DB, this becomes a structural isolation risk: the tenant used for auth + data access is not derived from the authenticated principal/session, and correctness relies on UUID non-collision and external routing discipline rather than enforced tenant scoping.

Related: `writeAudit` uses its own hard-coded `TENANT_ID = 'guyan'`, so even if the API were later made tenant-aware, audit rows would still be written to the wrong tenant partition.
   - Suggested fix: Derive tenantId from the authenticated session/player (e.g., `const tenantId = player.tenantId`) and pass that through to `isEventOrganizerByEventId`, `seedOrUpdateEventGameConfig`, `resolveEventGameConfig`, and all DB queries. Refactor `writeAudit` to accept `tenantId` (and likely `contextId`) as parameters rather than using a module-level constant. Add a regression test that a session/player from tenant B cannot access tenant A’s event/config even if IDs overlap.

2. [medium] Write path can commit preset seed even when config validation fails (not fully fail-closed / atomic)
   - File: apps/tournament-api/src/services/game-config-write.ts:76-118
   - Confidence: high
   - Why it matters: `seedOrUpdateEventGameConfig` calls `seedStandardGuyan(tx, ...)` (lines 81–88) before building and validating the final event config (lines 115–118). If `parseGameConfig(candidate)` fails (e.g., odd cents), the function returns `{ ok:false }` without throwing. In Drizzle, returning normally from the transaction callback commits the transaction, so the preset seed insert(s) can persist even though the event `game_config` write is rejected.

That violates the stated goal of “fail-closed + transactional” behavior for money-config-sensitive operations, and it also makes invalid requests cause durable DB side effects (creating rule_sets/rule_set_revisions). Current tests for odd-cents only assert that `game_config` is empty, not that presets/audit/activity stayed untouched.
   - Suggested fix: Ensure no DB mutations occur until after candidate config has been validated, OR make validation failures trigger a rollback (e.g., throw a typed error inside the tx and translate it to a 400 at the route). Concretely: do a read-only lookup for the preset first; only insert the preset if you already know the input schedule/lock will produce a valid config; and/or move preset creation into a block that only runs after `parseGameConfig(candidate)` succeeds.

3. [medium] Standard Guyan preset seeding is not concurrency-idempotent (race can create duplicate rule_sets)
   - File: apps/tournament-api/src/services/standard-guyan-seed.ts:73-127
   - Confidence: high
   - Why it matters: Idempotency is implemented as “select by (tenantId,name) then insert” (lines 73–113). Without a DB UNIQUE constraint on `(tenant_id, name)`, two concurrent seeds can both observe “no existing” and insert duplicate `rule_sets` (and each will insert its own baseline revision). Downstream, `seedStandardGuyan` uses `limit(1)` to pick an arbitrary matching row; if one duplicate is partially missing a baseline revision, the function can throw even though another duplicate is valid (availability risk).
   - Suggested fix: Add a UNIQUE index/constraint on `rule_sets(tenant_id, name)` and change insertion to an upsert/insert-with-conflict-handling (`onConflictDoNothing` / catch unique violation then re-select). Consider also enforcing uniqueness on `(tenant_id, rule_set_id, revision_number)` for revisions if not already present.

4. [medium] Resolver can throw (500) on corrupt/non-JSON `config_json` because JSON.parse is not guarded
   - File: apps/tournament-api/src/services/resolve-game-config.ts:133-157
   - Confidence: high
   - Why it matters: `loadLevelRow` does `JSON.parse(row.configJson)` without a try/catch (line 153). If the DB ever contains malformed JSON (manual admin edits, migration bug, partial write, etc.), the resolved-config endpoint can crash with an exception, turning what the spec frames as “never a 500” into a 500. Given this endpoint is used for organizer money/config decisions, returning a controlled `{ ok:false, reason }` is safer than crashing.
   - Suggested fix: Wrap JSON.parse in try/catch and treat failures as unsettleable (or at least as “row absent” with an explicit reason surfaced). If you want strict fail-closed, consider returning `{ ok:false, kind:'unsettleable', reason:'invalid_config_json' }` rather than silently ignoring the level.

5. [low] Spec drift: newly-created preset path returns baseConfig from in-memory constant instead of re-reading seeded revision
   - File: apps/tournament-api/src/services/standard-guyan-seed.ts:105-130
   - Confidence: medium
   - Why it matters: On the first seed (no existing rule_set), `seedStandardGuyan` returns `baseConfig: parsedBase.config` (line 129) derived from the code constant, not reloaded from the inserted `rule_set_revision`. If the intent is “DB-seeded source of truth”, this is a minor drift: the caller isn’t strictly reading from the seeded revision in the creation case.
   - Suggested fix: After inserting the baseline revision, re-select it (or at least return the exact `configJson` value you wrote) so the caller always uses the DB revision as the source of truth, even on the first call.

6. [medium] Tests don’t assert ‘no side effects’ on invalid config writes (preset/audit/activity)
   - File: apps/tournament-api/src/services/game-config-write.test.ts:141-148
   - Confidence: high
   - Why it matters: The odd-cents test asserts only that `gameConfig` stays empty. Given the current implementation seeds the preset before validation, this test would still pass even though `rule_sets`/`rule_set_revisions` may have been created. For a money/config-sensitive feature, tests should lock in the intended transactional semantics (no preset/audit/activity writes when the request is rejected).
   - Suggested fix: Extend invalid-write tests to assert `ruleSets`, `ruleSetRevisions`, `auditLog`, and `activity` remain empty when `seedOrUpdateEventGameConfig` returns `{ ok:false }`. Add a route-level test for the same behavior on PUT 400 responses.

## Strengths

- `resolveEventGameConfig` validates round→event and foursome→round pairing membership (both tenant-scoped) before reading any `game_config` rows (`resolve-game-config.ts` 58–95).
- All `game_config` lookups are scoped by `(level, refId, tenantId)` (`resolve-game-config.ts` 140–149; `admin-event-game-config.ts` 62–71).
- All three endpoints are gated by `requireSession` + `requireOrganizer` middleware and then a per-handler `isEventOrganizerByEventId` check (router lines 32–34, handlers 58–60 / 90–92 / 144–146).
- `seedOrUpdateEventGameConfig` validates via `parseGameConfig`, derives denormalized columns via `deriveConfigColumns`, and asserts consistency via `checkConfigColumnsConsistent` before writing the `game_config` row (`game-config-write.ts` 115–127).
- Audit + activity emission is in the same DB transaction as the `game_config` write (`game-config-write.ts` 163–183).
- Activity type wiring appears complete: union, `ACTIVITY_TYPES`, and Zod schemas all include `game.config_seeded` / `game.config_updated` (`activity-events.ts` around 187–533).
- Resolver and route-level tests cover key hierarchy and orphan/unseeded behaviors, including the ‘foursomeNumber requires roundId’ 400 at the route and cross-event roundId 404 behaviors.

## Warnings

None.
