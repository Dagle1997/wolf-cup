# Codex Review

- Generated: 2026-04-28T12:26:04.947Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md

## Summary

Spec is unusually concrete (table shapes, FK posture, migration additivity, and required tests), which is good for a schema-only story. Main risk is the “two overlapping UNIQUE constraints + targeted UPSERT” design on SQLite: it’s easy for the *other* UNIQUE constraint to still abort the insert even when the dedupe target matches, depending on how the INSERT is written and which constraint SQLite reports as the conflict. A few important invariants are intentionally left to later stories (holes_to_play mirroring, v1 non-null event refs, score_corrections append-only), but some of these are actually enforceable at the schema level (SQLite triggers) and the spec should explicitly choose/decline that with rationale.

No path-allowlist violations are evident within this spec; it claims only tournament-api schema/migration/test files plus PORTS.md. No Wolf Cup writes are required by the spec.

Overall risk: medium

## Findings

1. [high] Dual-UNIQUE + targeted `ON CONFLICT(...) DO NOTHING` may not behave as specified on SQLite because the *other* UNIQUE can still fail the statement
   - File: _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md:58-74
   - Confidence: high
   - Why it matters: The spec requires: (A) identical (round_id, player_id, hole_number, client_event_id) replays dedupe silently via `ON CONFLICT (round_id, player_id, hole_number, client_event_id) DO NOTHING`, while (B) different client_event_id for same cell throws SQLITE_CONSTRAINT_UNIQUE (2067). With both UNIQUE(round_id, player_id, hole_number) and UNIQUE(round_id, player_id, hole_number, client_event_id) present, inserting an identical row violates *both* constraints. In SQLite, an UPSERT handler with a specific conflict-target generally only handles conflicts on that target; conflicts on other unique constraints can still abort the statement. If SQLite chooses to report the 3-column unique as the conflict, the dedupe insert could throw instead of deduping. Conversely, if the implementation falls back to `INSERT OR IGNORE` / `ON CONFLICT DO NOTHING` without a target, then the “different client_event_id must throw 409” behavior is lost (it will ignore collisions too). This is load-bearing for offline replay idempotency and for the 409 collision path.
   - Suggested fix: Make the tests in AC #4 prove the behavior using the exact SQL/Drizzle call pattern production will use (including the conflict-target clause). If this proves flaky across SQLite/libsql versions, consider a schema alternative that avoids overlapping UNIQUEs (e.g., enforce cell-level uniqueness via a trigger that raises unless client_event_id matches, or store a single row per cell and track last client_event_id separately). At minimum, document the exact INSERT form required and pin the SQLite/libsql version assumptions.

2. [medium] FK CASCADE/RESTRICT tests can give false confidence unless `PRAGMA foreign_keys=ON` is explicitly set for the libsql connection
   - File: _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md:254-314
   - Confidence: high
   - Why it matters: SQLite (and commonly libsql) requires foreign key enforcement to be enabled per connection. The spec requires tests proving CASCADE and RESTRICT behavior (lines 257-259, 312-314), but does not require turning FK enforcement on. If FK enforcement is off, deletes will succeed and CASCADE won’t run, producing misleading test results and potentially masking production misconfiguration.
   - Suggested fix: Add an explicit step/AC in the test setup to enable and assert FK enforcement (e.g., `PRAGMA foreign_keys=ON;` then assert `PRAGMA foreign_keys;` returns 1) before running CASCADE/RESTRICT assertions.

3. [medium] Append-only invariant for `score_corrections` is stated as “NOT enforceable at schema layer” but SQLite can enforce it with triggers
   - File: _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md:95-102
   - Confidence: high
   - Why it matters: Epic requirement is “append-only; no UPDATE path v1” (line 99). The spec relies on later application code discipline and explicitly says it’s not enforceable in schema. In SQLite, it *is* enforceable via `BEFORE UPDATE` / `BEFORE DELETE` triggers that `RAISE(ABORT, ...)`. Without a schema guard, an accidental future UPDATE/DELETE path (or an ORM helper) can silently violate auditability/correction history, which is typically hard to detect after the fact.
   - Suggested fix: Decide explicitly: either (a) enforce append-only with triggers in the migration and add a test that UPDATE/DELETE fails, or (b) accept the risk but call out that it is enforceable and why you’re deferring. If deferring, consider adding a strong comment + future-story AC to add triggers.

4. [medium] `rounds.event_id` and `rounds.event_round_id` are nullable, but there’s no schema guard against inconsistent combinations or mismatched parentage
   - File: _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md:85-93
   - Confidence: medium
   - Why it matters: Allowing both FKs to be nullable for FD-7 is fine, but the schema (as specified) allows states like: event_round_id set while event_id is NULL, or event_id set that doesn’t match the referenced event_round’s event. That can create rounds that cannot be correctly joined/scoped, and downstream code may assume consistency (especially with CASCADE deletes on both FKs).
   - Suggested fix: If the data model intends consistency when these are present, add a CHECK/trigger: (event_id IS NULL) = (event_round_id IS NULL) for v1, or enforce that if event_round_id is not null then event_id must equal event_rounds.event_id via trigger. If you truly want independence, explicitly document that event_round_id may exist without event_id (and how that’s interpreted).

5. [medium] Tenant scoping is column-level only; FKs and uniqueness do not include tenant/context, enabling cross-tenant linkage if multi-tenant is real
   - File: _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md:242-247
   - Confidence: medium
   - Why it matters: AC #6 requires every table to include tenant_id/context_id, but all FKs described are on `...id` only (e.g., hole_scores.round_id → rounds.id, hole_scores.player_id → players.id). If the system ever runs with multiple tenants/contexts in the same DB, this permits cross-tenant references and uniqueness collisions across tenants (e.g., same round_id across tenants, or linking a hole_score to a round from a different tenant). That’s a security/data-isolation risk that schema constraints could otherwise prevent.
   - Suggested fix: If multi-tenant isolation is in-scope, consider composite keys/foreign keys that include (tenant_id, context_id) and include tenant_id/context_id in relevant UNIQUE constraints and indexes. If the DB is effectively single-tenant (tenant_id default 'guyan'), make that assumption explicit so reviewers don’t over-trust tenant columns as isolation.

6. [low] `score_corrections.request_id` is required but has no uniqueness/idempotency constraint specified
   - File: _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md:184-185
   - Confidence: medium
   - Why it matters: The presence of `requestId TEXT NOT NULL` suggests it may be used for idempotency or dedupe. Without a UNIQUE index (global or scoped to round/tenant), duplicate inserts for the same request can occur, undermining “one correction per request” semantics if callers rely on it.
   - Suggested fix: Clarify intended semantics of requestId. If it’s an idempotency key, add a UNIQUE constraint (likely including tenant/context and maybe round_id) and a test. If it’s only diagnostic, rename/document accordingly.

## Strengths

- Clear schema-only boundary (explicitly forbids routes/middleware/UI) and explicit path footprint list (lines 17-33, 168-173, 285-290).
- Explicit Wolf Cup port provenance and deltas for `hole_scores`, including a PORTS.md entry requirement (lines 34-56, 215-241).
- Additive-only migration requirement is well-defined and includes an operator procedure for verifying no ALTER/DROP (lines 196-203).
- FK delete posture is explicitly enumerated and consistent across tables (lines 146-166).
- Spec requires load-bearing integration tests that hit the real engine (`:memory:` libsql) rather than unit-mocking constraint behavior (lines 71-74, 204-214, 307-316).

## Warnings

None.
