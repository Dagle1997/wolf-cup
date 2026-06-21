# Codex Review

- Generated: 2026-06-21T21:25:57.027Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/1-2-additive-schema-game-config-provenance-pin.md

## Summary

Most prior review findings appear addressed at the AC level (canonical config_json, per-player HI+CH as a single JSON snapshot, round_pin keyed by UNIQUE(round_id) with tenant denormalization, explicit fail-closed reads, pin immutability semantics, and migration/meta files listed). A few concrete spec contradictions/ambiguities remain that could lead to an incorrect implementation (notably Task 3 contradicting AC6, and the drift-test requirement not being carried through into the Tasks/test plan).

Overall risk: medium

## Findings

1. [medium] Task 3 contradicts AC6’s decided storage shape for per-player handicaps
   - File: _bmad-output/implementation-artifacts/tournament/1-2-additive-schema-game-config-provenance-pin.md:26-43
   - Confidence: high
   - Why it matters: AC6 explicitly decides a single JSON column `per_player_handicaps_json` keyed by playerId, but Task 3 re-opens the decision by stating the per-player snapshot can be “JSON or a child `round_pin_handicaps` table”. This is a direct contradiction that can cause the dev implementation to diverge from the accepted decision and tests.
   - Suggested fix: Update Task 3 to match AC6 unambiguously: specify the exact column name/type (`per_player_handicaps_json` as JSON/text) and remove mention of a child table from this story.

2. [medium] AC3 requires a Zod↔engine drift test, but Tasks/tests section doesn’t explicitly include it
   - File: _bmad-output/implementation-artifacts/tournament/1-2-additive-schema-game-config-provenance-pin.md:20-46
   - Confidence: high
   - Why it matters: AC3’s main guardrail against schema/engine divergence is the drift test asserting identical accept/reject verdicts between the Zod schema and `validateResolvedConfig`. Task 6 currently lists “Zod round-trip” cases but does not explicitly require the dual-validator drift assertion. This can easily regress into “Zod-only” tests that won’t catch divergence.
   - Suggested fix: Amend Task 6 (or add a dedicated task) to explicitly require the drift test: run a shared table of configs through BOTH Zod and `validateResolvedConfig` and assert the verdicts match (and, if desired, align reason codes).

3. [medium] Cannot confirm new FK targets exist based on this spec’s cited schema references (course_revisions especially)
   - File: _bmad-output/implementation-artifacts/tournament/1-2-additive-schema-game-config-provenance-pin.md:25-57
   - Confidence: medium
   - Why it matters: The review request asks to “Confirm … all FKs target existing tables.” This markdown asserts `course_revision_id` FK → `course_revisions.id` “exists — verified” (AC5), but the Dev Notes references list does not cite the schema file/table definition for `course_revisions`. Within the provided evidence, existence/naming can’t actually be verified, and a misnamed table/column would break migrations at deploy time.
   - Suggested fix: Add an explicit reference line (like the others) to the exact schema file exporting `courseRevisions`/`course_revisions`, and ensure the story names match the actual Drizzle table identifier and PK column type. If the table name differs (e.g., `courseRevisions` mapping), reflect the exact DB table name in AC5.

4. [low] playerId-keyed JSON map needs explicit key type/validation to avoid string-vs-id mismatches
   - File: _bmad-output/implementation-artifacts/tournament/1-2-additive-schema-game-config-provenance-pin.md:26-27
   - Confidence: medium
   - Why it matters: AC6 specifies `{ [playerId]: { hi, ch } }`. In JSON, object keys are strings; if `playerId` is a non-string type in code (number/UUID wrapper), serialization/lookup mismatches can happen silently and cause recompute to miss handicaps or read the wrong entry.
   - Suggested fix: Specify `playerId` is a string key (e.g., the `players.id` string) and implement the Zod schema as `z.record(z.object({hi: z.number(), ch: z.number()}))` with an optional refinement that keys match the round roster if that data is available at pin time.

5. [low] AC10 says “Enums validated in Zod, not DB CHECK constraints” but tasks don’t warn about Drizzle enum helpers that emit CHECKs
   - File: _bmad-output/implementation-artifacts/tournament/1-2-additive-schema-game-config-provenance-pin.md:33-45
   - Confidence: medium
   - Why it matters: Even though this migration is CREATE TABLE only, the story explicitly prohibits DB CHECK constraints for enums. Drizzle patterns like `text({ enum: [...] })` (or equivalent) can emit CHECK constraints in SQLite, creating inconsistency with AC10 and increasing the chance of future rebuild-style diffs if a value set changes.
   - Suggested fix: In the schema tasks, explicitly instruct: store enums as plain `text` (no enum/check in DDL) and enforce allowed values in Zod/guards only, per AC10.

## Strengths

- AC1 resolves the prior column-vs-JSON duplication by clearly declaring `config_json` canonical and making `lock_state`/`config_version` denormalized mirrors with mismatch rejection + unit test (line 18).
- AC5 cleanly resolves round_pin keying/tenancy concerns: UNIQUE(round_id), tenant_id copied/validated but not part of the key (line 25).
- AC3 explicitly defines fail-closed-at-read behavior as a typed `{ok:false, reason}` result rather than null/defaulting (line 20).
- AC11 makes pin immutability/idempotency semantics explicit (“first pin wins”, re-pin ignores new data) and ties it to a unit test (line 34).
- Files list and boundary largely conform to “apps/tournament-api + tracking artifacts”, and migration meta artifacts are included (lines 81–93).
- AC4’s “registered modifiers only” reconciliation is internally consistent with the stated `net-skins` decision and avoids silent computation on unsupported modifiers (line 21).

## Warnings

None.
