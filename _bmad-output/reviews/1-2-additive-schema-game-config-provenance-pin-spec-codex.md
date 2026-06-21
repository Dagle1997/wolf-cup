# Codex Review

- Generated: 2026-06-21T21:21:47.410Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/1-2-additive-schema-game-config-provenance-pin.md

## Summary

Spec is directionally solid (additive-only, no CHECK constraints, clear table goals), but several acceptance criteria remain underspecified in ways that could yield incompatible implementations or subtle integrity gaps—especially around (a) duplicated fields between columns vs JSON, (b) the round-pin per-player handicap representation, (c) the shape of the “global team composition seam”, and (d) tenancy/FK consistency in the round-pin store. Also, the declared “Files this story will edit” list omits the new migration + drizzle meta outputs that are explicitly required by AC10.

Overall risk: medium

## Findings

1. [high] Ambiguity: duplicated `lock_state` / `config_version` in columns vs `lockState` / `configVersion` in `config_json`—no source-of-truth defined
   - File: _bmad-output/implementation-artifacts/tournament/1-2-additive-schema-game-config-provenance-pin.md:18-21
   - Confidence: high
   - Why it matters: AC1 requires `lock_state` and `config_version` columns, while AC3’s JSON shape also includes `lockState?` and `configVersion`. Without an explicit source-of-truth and sync rule, two compliant implementations could diverge: one might persist only in JSON and mirror into columns; another might treat columns as authoritative and ignore JSON fields. This can break query behavior (filtering by lock/version), cause stale reads, or create subtle mismatches during updates.
   - Suggested fix: Clarify one of:
- Remove `lockState`/`configVersion` from JSON and store only in columns; or
- Make JSON authoritative and define deterministic mirroring (e.g., on write: reject if column != JSON; on read: compute derived fields); or
- Make columns authoritative and require JSON omit/ignore those fields.
Also explicitly define nullability and default behavior for lock/version.

2. [high] Ambiguity: round-pin per-player HI+CH storage is explicitly left as “JSON or child table” with no required shape/keys
   - File: _bmad-output/implementation-artifacts/tournament/1-2-additive-schema-game-config-provenance-pin.md:25-43
   - Confidence: high
   - Why it matters: AC6/Task 3 allow two fundamentally different schemas (single JSON column vs normalized child table). That affects querying, idempotency semantics, migrations, and downstream consumers (Story 1.4 recompute/settlement path). Two devs could implement different shapes and both claim compliance, but Story 1.4 would only work with one.
   - Suggested fix: Pick one representation now and specify:
- If JSON: exact JSON schema (array vs map), required keys (player_id? participant_id?), numeric types/precision, and whether HI/CH are integers/decimals.
- If child table: table name, PK/unique constraints (e.g., UNIQUE(round_id, player_id)), and FK strategy.
Tie it to how the engine identifies players in pairings/scorecards to avoid later remapping work.

3. [high] Tenancy/integrity gap risk: `round_pin` has `ecosystemColumns()` + `round_id` FK, but uniqueness/keying is specified only by `round_id`
   - File: _bmad-output/implementation-artifacts/tournament/1-2-additive-schema-game-config-provenance-pin.md:25-45
   - Confidence: medium
   - Why it matters: AC5 says the pin store is keyed UNIQUE on `round_id`; Task 3 adds `ecosystemColumns()` (tenant_id/context_id). If `rounds` is tenant-scoped (likely, given ecosystemColumns is pervasive), then `round_pin.tenant_id` could drift from `rounds.tenant_id` with no DB-level protection, and UNIQUE(round_id) alone doesn’t prevent cross-tenant mismatches if IDs are not globally unique (or if imports/tests reuse IDs). This is a provenance table—integrity matters.
   - Suggested fix: Clarify the intended keying model:
- Option A: Make `round_id` the PRIMARY KEY and drop tenant_id/context_id from `round_pin` (derive tenancy via join).
- Option B: Keep ecosystem columns and enforce consistency: either composite FK (tenant_id, round_id) -> rounds(tenant_id, id) (if rounds has tenant_id), and/or UNIQUE(tenant_id, round_id).
Explicitly state whether `rounds.id` is globally unique across tenants.

4. [medium] “Global-team-composition seam” is required but has no defined column(s) or JSON shape
   - File: _bmad-output/implementation-artifacts/tournament/1-2-additive-schema-game-config-provenance-pin.md:28-43
   - Confidence: high
   - Why it matters: AC8/Task 3 require a seam but leave it undefined. That’s likely to fragment later Epic 3 work (different column naming, shape, and normalization choices), and it impacts additive-only discipline because you may later need to rebuild/transform rather than add cleanly.
   - Suggested fix: Define the seam now at least at the storage-contract level:
- Column name (e.g., `global_team_snapshot_json`), type (TEXT JSON), and nullable.
- Minimal schema placeholder (e.g., `{ version: 1, teams: [] }`), or `NULL` until populated.
- Whether it’s intended to store resolved team assignments per player or abstract team definitions.

5. [medium] Zod validator “agrees with validateResolvedConfig” is not operationally defined; drift test criteria are underspecified
   - File: _bmad-output/implementation-artifacts/tournament/1-2-additive-schema-game-config-provenance-pin.md:20-56
   - Confidence: high
   - Why it matters: AC3/Dev Notes require the Zod schema to “reuse / agree with” `validateResolvedConfig` and mention a drift test. But it doesn’t define the contract precisely: does Zod validate the same input type (unresolved vs resolved)? Should it call the engine function directly? What constitutes “agree” (same error class? same accept/reject only)? Without that, implementers could either duplicate logic (risk divergence) or over-couple layers (risk circular deps).
   - Suggested fix: Make one function the source of truth:
- Prefer: implement a single validator in the engine layer (pure) and have Zod refine by calling it, or have validateResolvedConfig call the Zod schema.
- Specify drift test mechanism: a fixed corpus of configs (valid/invalid) asserting accept/reject parity, and what to do when engine introduces new rules.
Also clarify whether `config_json` is a *resolved* config or a *seed* config; wording says GameConfig but also references validateResolvedConfig.

6. [medium] “Fail closed at read” behavior is not defined (error vs null vs fallback), which affects API semantics and recovery
   - File: _bmad-output/implementation-artifacts/tournament/1-2-additive-schema-game-config-provenance-pin.md:20-21
   - Confidence: high
   - Why it matters: AC3 says unknown/too-new config is rejected at write and “fails closed at read.” Those are different paths: read can fail for other reasons (corrupt JSON, manual edits, older rows from prior versions). Without specifying behavior, one implementation may throw 500s while another silently defaults, affecting safety and operability.
   - Suggested fix: Define explicit read semantics:
- For `game_config`: on parse/validation failure, return a typed error (e.g., 409/422) and do not attempt settlement.
- For `round_pin`: on pinned snapshot parse failure, block recompute/settlement with an explicit “pinned provenance invalid” error.
Also specify logging/telemetry expectations if applicable.

7. [medium] Pin-writer idempotency semantics are under-specified when the second call provides different data
   - File: _bmad-output/implementation-artifacts/tournament/1-2-additive-schema-game-config-provenance-pin.md:34-45
   - Confidence: high
   - Why it matters: AC11/Task 4 state idempotent under UNIQUE(round_id) with “re-call = no-op / returns existing”. If a retry races with a slightly different payload (e.g., tee corrected, GHIN HI refreshed, or bugfix), a naive “INSERT OR IGNORE” would silently keep the first write, potentially pinning incorrect provenance forever. Conversely, “UPSERT overwrite” breaks provenance immutability.
   - Suggested fix: Specify idempotency rule:
- If row exists: compare stored snapshot to incoming payload; if identical, return existing; if different, return an error (conflict) and require explicit admin/unpin flow (future story) rather than silent overwrite.
- Clarify whether updates are ever allowed (likely no for provenance).

8. [medium] Potential forward dependency: `course_revision_id` FK/column is required but the target table/constraints are not confirmed to exist in current schema
   - File: _bmad-output/implementation-artifacts/tournament/1-2-additive-schema-game-config-provenance-pin.md:25-43
   - Confidence: medium
   - Why it matters: AC5/Task 3 require pinning `course_revision_id`/tee. The spec doesn’t cite the schema file/table that owns course revisions, unlike `rule_set_revisions` and `rounds` which are explicitly referenced (lines 52–53). If course revisions aren’t already in prod schema, adding an FK would violate the story’s “no forward dependency” boundary and could break migrations.
   - Suggested fix: Either:
- Cite the existing schema/table for `course_revision_id` and confirm it’s in prod and stable; or
- Store `course_revision_id` as a plain text/integer without FK for now (validated in code), deferring the FK to the story that introduces the course revision table.
Also specify whether tee is an enum/string and whether it must be non-null.

9. [low] Additive/allowlist mismatch: required migration + drizzle meta outputs aren’t included in “Files this story will edit” list
   - File: _bmad-output/implementation-artifacts/tournament/1-2-additive-schema-game-config-provenance-pin.md:33-90
   - Confidence: high
   - Why it matters: AC10/Task 5 require generating `0019_*` under `src/db/migrations/` (and drizzle typically emits/updates metadata under `src/db/migrations/meta/**`). But the allowlisted file list (lines 79–90) omits these outputs. If your process enforces FD-1/FD-2 via declared file allowlists, this will either block the PR or encourage “sneaking in” unreviewed generated files.
   - Suggested fix: Add explicit entries for:
- `apps/tournament-api/src/db/migrations/0019_*.sql`
- Any expected drizzle meta files updated/created (e.g., `apps/tournament-api/src/db/migrations/meta/*`).
If the team wants to avoid tracking meta diffs, state that explicitly (but that’s a repo policy decision).

## Strengths

- Clear additive-only intent with explicit T13-4 warning to avoid CHECK constraints and table rebuilds (lines 33–34, 58–60).
- Boundary is mostly clean: this story builds storage + a pin-writer that accepts pre-resolved inputs, deferring lifecycle wiring to Story 1.4 (line 34).
- Spec acknowledges the modifier constraint change and ties it to the already-shipped engine reality (AC4), which prevents silent unsupported computation.
- Good test intent: parity/drift checks between Zod validation and engine validation, plus idempotency/uniqueness coverage (lines 45–46, 55–56).

## Warnings

None.
