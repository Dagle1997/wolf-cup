# Codex Review

- Generated: 2026-04-27T13:44:52.074Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/db/schema/players.ts, apps/tournament-api/src/db/schema/device_bindings.ts, apps/tournament-api/src/db/schema/events.ts, apps/tournament-api/src/db/schema/groups.ts, apps/tournament-api/src/db/schema/rules.ts, apps/tournament-api/src/db/schema/subgames.ts, apps/tournament-api/src/db/schema/index.ts, apps/tournament-api/src/db/schema/events.test.ts, apps/tournament-api/src/db/schema/groups.test.ts, apps/tournament-api/src/db/schema/rules.test.ts, apps/tournament-api/src/db/schema/subgames.test.ts, apps/tournament-api/src/db/schema/players-t3-extension.test.ts

## Summary

Schema definitions shown align with most AC-level FK delete postures and CHECK/UNIQUE constraints (notably: event_rounds holes_to_play check + uniq composite; groups money_visibility_mode check + composite PK; rule_set_revisions effective_from_round_id ON DELETE SET NULL; device_bindings.session_id nullable + SET NULL; sub_games type/buy-in checks + participant composite PK). The load-bearing cascade behaviors are explicitly pinned by tests.

However, the review cannot verify the migration file (0002_nice_meggan.sql) at all from the provided diff/contents, and the provided test suite does not meet AC #11’s stated “each table has tests for insert + NOT NULL + UNIQUE + CHECK + FK CASCADE/RESTRICT” bar (several tables have only partial coverage). Multi-tenant isolation is only lightly asserted (duplicate-friendly insert across tenants), not “isolation” in the sense of preventing cross-tenant FK/data mixing.

Path allowlist: within the provided diff, changes are confined to apps/tournament-api/src/db/schema/** and test files under the same area (no edits shown under the explicitly FORBIDDEN paths apps/api/**, apps/web/**, packages/engine/**).

Overall risk: high

## Findings

1. [high] Cannot verify migration 0002_nice_meggan.sql correctness/additive-only or FK ON DELETE actions (migration file not provided)
   - File: apps/tournament-api/src/db/schema/*.test.ts:51-56
   - Confidence: high
   - Why it matters: AC focus explicitly gates on migration correctness (additive-only; ON DELETE CASCADE/RESTRICT/SET NULL must match spec). All tests call migrate(db, { migrationsFolder }) (e.g., events.test.ts:51-53; players-t3-extension.test.ts:54-56), but the actual SQL migration content is not present in the diff/contents you provided, so it’s impossible to confirm the database will actually match the TypeScript schema definitions in production.
   - Suggested fix: Include the full contents of apps/tournament-api/src/db/migrations/0002_nice_meggan.sql in the review diff (or paste it). Specifically verify: (1) only CREATE TABLE / ALTER TABLE ADD COLUMN / CREATE INDEX (no DROP/rename), (2) each FK has the intended ON DELETE action, (3) partial unique index on players(ghin) WHERE ghin IS NOT NULL is present, (4) CHECK constraints exist in SQL (holes_to_play, money_visibility_mode, effective_from_hole, sub_games.type, buy_in_per_participant >= 0).

2. [high] AC #11 test coverage is incomplete: several tables lack NOT NULL / FK delete-action / CHECK / UNIQUE tests as required
   - File: apps/tournament-api/src/db/schema/events.test.ts:117-345
   - Confidence: high
   - Why it matters: AC #11 requires per-table tests for insert + NOT NULL + UNIQUE + CHECK + FK CASCADE/RESTRICT. The provided tests cover many constraints but do not fully satisfy that matrix per table. This creates risk that future migration/schema drift (or missing constraints in SQL) won’t be caught.
   - Suggested fix: Add missing negative/constraint tests per table. Concrete gaps visible in provided files:
- invites: no test for FK RESTRICT on created_by_player_id (schema has RESTRICT at events.ts:93-96), and no NOT NULL test coverage for token/expires_at/created_by_player_id.
- events: only one NOT NULL test (timezone) (events.test.ts:130-145); other NOT NULL columns not covered.
- rule_sets: only round-trip insert test; no NOT NULL tests for name/created_at, etc. (rules.test.ts:120-133).
- sub_game_participants: no FK CASCADE test for sub_game_id → sub_games.id (schema has CASCADE at subgames.ts:63-66); also no NOT NULL tests for opted_in_at.
- device_bindings: no NOT NULL tests for required fields like device_info/created_at/player_id (device_bindings.ts:36-42).
- group_members: no explicit FK CASCADE test for group_id → groups.id (you do delete group and check membership removal, groups.test.ts:192-222, which covers it) but still no NOT NULL tests for group_id/player_id.
Ensure each table hits the required categories at least once.

3. [medium] Multi-tenant “isolation” is not actually enforced at the schema layer; current test only checks cross-tenant duplicate inserts, not isolation
   - File: apps/tournament-api/src/db/schema/events.test.ts:155-181
   - Confidence: high
   - Why it matters: AC #14 calls for a multi-tenant isolation test. The current test demonstrates lack of an unintended unique constraint across tenants (events.test.ts:155-181) but does not (and cannot, with the current FK shapes) prevent cross-tenant references or data mixing. Given tenant_id is not part of any FK, a row in tenant A can reference a parent row in tenant B as long as IDs match/exist.
   - Suggested fix: If AC #14 intends true isolation, you’ll need either: (a) composite PK/UKs including tenant_id and matching composite FKs, or (b) triggers enforcing tenant_id consistency across relationships. If AC #14 only intends “no global uniqueness by tenant,” rename/clarify the test/assertion accordingly and add tests on the actual intended tenant semantics.

## Strengths

- Schema matches key AC delete postures in the TypeScript definitions: events.organizer_player_id RESTRICT (events.ts:46-49), event_rounds.event_id CASCADE (events.ts:59-62), event_rounds.course_revision_id RESTRICT (events.ts:64-67), invites.event_id CASCADE + token UNIQUE + created_by_player_id RESTRICT (events.ts:88-96).
- groups.money_visibility_mode CHECK allows the 3 specified values; group_members has composite PK and correct CASCADE/RESTRICT FKs (groups.ts:34-44, 49-63).
- Load-bearing rules decision implemented: rule_set_revisions.effective_from_round_id ON DELETE SET NULL (rules.ts:61-64) and pinned by both single-hop and full event-cascade tests (rules.test.ts:242-297).
- device_bindings extracted into its own file, avoiding the players.ts ↔ auth.ts cycle while still allowing FKs to both players and sessions (device_bindings.ts:1-13, 32-47).
- AC #12b multi-hop cascade chain is explicitly exercised across both branches (event→event_rounds→sub_games→sub_game_participants AND event→groups→group_members) in players-t3-extension.test.ts:267-395.
- Players deviation (no google_sub/apple_sub) is clearly documented in players.ts header (players.ts:10-16), matching the stated approved spec deviation.

## Warnings

None.
