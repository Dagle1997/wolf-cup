# Codex Review

- Generated: 2026-06-21T21:40:23.107Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/db/schema/game-config.ts, apps/tournament-api/src/db/schema/round-pins.ts, apps/tournament-api/src/db/schema/index.ts, apps/tournament-api/src/engine/games/config-schema.ts, apps/tournament-api/src/services/pin-round.ts, apps/tournament-api/src/db/migrations/0019_true_king_cobra.sql, apps/tournament-api/src/db/schema/game-config.test.ts, apps/tournament-api/src/services/pin-round.test.ts

## Summary

Implements the additive `game_config` + `round_pin` tables, a Zod+engine validator (`parseGameConfig`), and an immutable pin writer. The migration is additive (CREATE TABLE/INDEX only) and the expected UNIQUE constraints/FKs are present. However, there are concrete integrity gaps around (1) canonical JSON enforcement (Zod is non-strict and strips unknown keys, and `pinRound` persists the *raw* input instead of the parsed canonical config), and (2) AC5 tenancy provenance (tenant_id is caller-supplied, not copied from `rounds`, and tests disable FK checks). There are also edge cases where the idempotent path can crash if the existing row isn’t visible/found, and the migration’s `tenant_id DEFAULT 'guyan'` risks silent mis-tenancy if callers omit the column.

Overall risk: high

## Findings

1. [high] Canonical config is not enforced: Zod strips unknown keys and pinRound persists the raw (potentially non-canonical) config_json
   - File: apps/tournament-api/src/engine/games/config-schema.ts:13-55
   - Confidence: high
   - Why it matters: AC1/AC3 emphasize `config_json` being the canonical engine-shaped GameConfig and validation being fail-closed. As written, `gameConfigSchema` uses `z.object(...)` without `.strict()`, so unknown keys are silently stripped. Worse, `pinRound` validates `input.resolvedConfig` via `parseGameConfig`, but then stores `JSON.stringify(input.resolvedConfig)` rather than `JSON.stringify(parsed.config)`. That means configs with extra/unexpected keys can pass validation (because Zod strips them for validation) yet still be persisted with the extra keys, violating canonicalization and potentially creating forward-compat security/correctness issues if the engine later interprets those keys.
   - Suggested fix: Make schemas strict (e.g., `z.object({...}).strict()` for `gameConfigSchema`, `modifierSchema`, and schedule objects). In `pinRound`, serialize the parsed canonical object: `resolvedConfigJson: JSON.stringify(parsed.config)`. Consider also normalizing other JSON payloads similarly (validated+canonicalized before storage). Add a test that includes an extra key in config and asserts it is rejected (strict) or at least not persisted (canonicalization).

2. [high] AC5 tenancy provenance is not guaranteed: round_pin.tenant_id is caller-supplied and can diverge from rounds.tenant_id
   - File: apps/tournament-api/src/services/pin-round.ts:22-68
   - Confidence: high
   - Why it matters: AC5 says tenant is copied from the round. Current `pinRound` takes `tenantId` from input and inserts it directly (line 52), without reading `rounds` or asserting it matches the round’s tenant. If a buggy or compromised caller passes the wrong tenant, you can end up with cross-tenant misattribution. If downstream authorization filters by `round_pin.tenant_id`, this becomes a data isolation/security issue. The schema’s FK `round_id → rounds.id` does not enforce tenant consistency because tenant_id is denormalized and not part of the FK.
   - Suggested fix: Derive tenantId from the referenced `rounds` row inside the same tx (SELECT tenant_id FROM rounds WHERE id=...), then insert using that value (and ignore or remove `tenantId` from PinRoundInput). At minimum, assert `input.tenantId === rounds.tenant_id` and throw on mismatch. Add a test with FKs ON and a real `rounds` row to validate tenant-copy behavior.

3. [medium] Idempotent path can throw/crash if existing row is not found after conflict (assumes existing[0] is always present)
   - File: apps/tournament-api/src/services/pin-round.ts:56-68
   - Confidence: medium
   - Why it matters: On conflict, the code does a follow-up SELECT and returns `existing[0]!` (line 67). If the row is not visible yet (transaction isolation / concurrent writer not committed), was deleted (e.g., round deleted causing cascade), or if there’s any unexpected constraint behavior, `existing[0]` can be undefined and the non-null assertion will cause a runtime crash. Even if rare in SQLite/libsql, this is an avoidable sharp edge in an API intended to be idempotent under concurrency.
   - Suggested fix: Handle the empty-select case explicitly: if no row found, either retry once (if you expect commit visibility), or throw a descriptive error (`pinRound: conflict but no existing pin found for round_id=...`). If you need stronger atomicity, consider a single-statement pattern that returns the existing row without updating data (DB-specific), but still preserve immutability.

4. [medium] Migration sets tenant_id DEFAULT 'guyan' on new tables, risking silent mis-tenancy if callers omit tenant_id
   - File: apps/tournament-api/src/db/migrations/0019_true_king_cobra.sql:1-34
   - Confidence: high
   - Why it matters: Both `game_config` and `round_pin` define `tenant_id text DEFAULT 'guyan' NOT NULL` (lines 11 and 27). In a multi-tenant system, a hard-coded default can silently write rows to the wrong tenant if any insert path forgets to set tenant_id. This is especially dangerous combined with AC2 uniqueness on `(tenant_id, level, ref_id)` and with denormalized tenant usage for access control.
   - Suggested fix: Remove the DEFAULT so tenant_id must be explicitly provided, or replace with a safer mechanism (e.g., application-level enforcement only). If the project intentionally uses a default for local dev, consider gating it behind dev-only migrations or adding tests to ensure production writers always supply tenant_id.

5. [medium] per_player_handicaps_json is not validated; NaN/Infinity or wrong shapes can be persisted and later break settlement determinism
   - File: apps/tournament-api/src/services/pin-round.ts:20-54
   - Confidence: high
   - Why it matters: AC6 calls for per-player HI+CH stored as JSON keyed by playerId. The implementation stringifies `input.perPlayerHandicaps` without validation (line 49). JSON.stringify will coerce `NaN`/`Infinity` to `null`, and incorrect shapes/types could be stored, undermining the “frozen deterministic inputs” goal for provenance pins. Comments in the schema also mention “Zod-validated” but no such validation is present here.
   - Suggested fix: Add a Zod schema for per-player handicaps (e.g., record of `{hi: z.number().finite(), ch: z.number().finite()}`; and if CH must be int, enforce `.int()`). Validate before insert and store the parsed/canonicalized value (like config). Add tests for NaN/invalid shapes being rejected.

6. [low] pinRound tests disable foreign keys, which can mask FK/migration mistakes for round_id/course_revision_id references
   - File: apps/tournament-api/src/services/pin-round.test.ts:13-21
   - Confidence: high
   - Why it matters: The test explicitly turns FKs OFF (line 19) and uses synthetic ids. This makes sense for writer-logic focus, but it also means this story provides no automated assurance that the migration’s FKs (`round_id → rounds`, `course_revision_id → course_revisions`, etc.) actually work end-to-end in libsql/SQLite, nor that tenant-copy-from-round behavior (AC5) is correct.
   - Suggested fix: Keep the current unit test, but add an additional integration-style test with FKs ON that inserts minimal `rounds` and `course_revisions` rows and proves FK enforcement + tenant copying/consistency (once implemented).

## Strengths

- Migration 0019 is additive (CREATE TABLE/INDEX only) and avoids CHECK constraints, aligning with AC10.
- UNIQUE(tenant_id, level, ref_id) for `game_config` is present in both schema and migration (AC2).
- UNIQUE(round_id) for `round_pin` is present (AC5), and the writer uses `ON CONFLICT DO NOTHING` to preserve immutability (AC11).
- `parseGameConfig` composes Zod structural validation with engine semantic validation, and a drift test asserts matching verdicts/reasons for structurally valid cases (AC3).
- `checkConfigColumnsConsistent` and `deriveConfigColumns` provide a clear mechanism to enforce AC1 at write-time (though integration into the actual game_config write path is not shown here).

## Warnings

None.
