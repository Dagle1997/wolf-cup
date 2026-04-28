# Codex Review

- Generated: 2026-04-28T12:32:27.174Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md

## Summary

Round-1 issues are mostly addressed with concrete spec-level sharpening (explicit ON CONFLICT form; FK PRAGMA requirement; explicit choice against triggers; added pairing CHECK; single-tenant risk note; request_id decision deferred). However, a few new/remaining issues are still actionable: the STOP contingency would intentionally violate the epic’s dual-UNIQUE requirement without an explicit approval gate; the new chk_rounds_event_pairing CHECK may be overly restrictive depending on intended future “event-only”/“round-only” intermediate states; the PRAGMA assertion wording is ambiguous and may be implementationally wrong with drizzle/libsql; and several AC/test steps under-spec the required NOT NULL `context_id` inserts, risking failing tests/seed steps.

Overall risk: medium

## Findings

1. [high] Contingency for failing dual-UNIQUE test unilaterally drops an epic-mandated constraint (needs explicit approval gate)
   - File: _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md:84-89
   - Confidence: high
   - Why it matters: Epic AC is cited as requiring TWO UNIQUE constraints on `hole_scores` (lines 60-63, 82). The proposed contingency (lines 84-88) changes the shipped schema to ONE UNIQUE, which is not a mechanical sharpening—it's a functional spec deviation. Even with a STOP-before-commit gate (lines 341-342), the instruction is to proceed by editing the migration/spec and commit that change. That risks shipping something that no longer satisfies the epic acceptance criteria and could cascade into later stories that assume dual-UNIQUE semantics.
   - Suggested fix: Change the contingency to: STOP and escalate for a user/owner decision (or require an explicit sign-off checkpoint) before dropping the dedupe UNIQUE. If you want a narrow escape valve, make it conditional on an explicit “Epic AC exception approved” note and require updating the epic traceability section to reflect the deviation.

2. [medium] `chk_rounds_event_pairing` CHECK may be too strict if any legitimate state needs exactly one of event_id/event_round_id set
   - File: _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md:105-113
   - Confidence: high
   - Why it matters: The new constraint `((event_id IS NULL) = (event_round_id IS NULL))` (line 202) enforces “both NULL or both non-NULL.” This blocks any state where a round is attached to an `event` but not to an `event_round`, or vice versa. Your Risk Acceptance §5 only describes two allowed states: both non-null (v1) and both null (v1.5 standalone) (lines 105-112), so the CHECK matches this spec—but it also hard-codes that assumption into the DB. If later requirements introduce an event-scoped-but-not-round-scoped flow (or a migration path where one column is populated before the other in separate statements), the DB will reject it.
   - Suggested fix: Confirm explicitly in the spec (and epic trace) that there is no intended “event-only” or “event_round-only” state, including during write flows. If such a state might be needed, relax the CHECK (or defer it to app-layer validation) and add a targeted test to enforce only the intended v1 invariant in code (T5.8) rather than schema.

3. [medium] PRAGMA foreign_keys setup/verification is ambiguous and likely incorrect as written for `db.run` + “returns 1”
   - File: _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md:228-229
   - Confidence: medium
   - Why it matters: The spec mandates `await db.run(sql\`PRAGMA foreign_keys = ON\`)` (line 228) and also says the test “SHALL also assert PRAGMA foreign_keys returns 1” (line 228-229). In SQLite, `PRAGMA foreign_keys = ON` does not itself return `1`; `PRAGMA foreign_keys;` does. Also, depending on the drizzle/libsql API, `db.run(...)` may not return query rows at all. This can lead to tests that either incorrectly “assert on” the wrong call or can’t access the PRAGMA value, undermining the core goal (ensuring FK enforcement is actually ON).
   - Suggested fix: Spell out two distinct steps: (1) execute `PRAGMA foreign_keys = ON;` and (2) query `PRAGMA foreign_keys;` using the correct API that returns rows (e.g., `db.get`/`db.all`/libsql `execute` depending on your test harness), then assert the returned value is `1`.

4. [medium] AC/tests under-spec required NOT NULL `context_id` insert values (likely to cause failing seed inserts)
   - File: _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md:275-280
   - Confidence: high
   - Why it matters: AC #6 asserts every table has `context_id TEXT NOT NULL` (line 279) with no default mentioned, while many test steps talk about inserting seed rows (players/rounds/hole_scores) without explicitly requiring `contextId` values (e.g., AC #4 seed steps lines 231-234, 241-244). If `context_id` truly has no default, any insert that omits it will fail. This is an easy place for dev/test drift because the spec sometimes includes `...tenantId, contextId` (line 72) but the explicit test steps often don’t.
   - Suggested fix: Add an explicit test setup requirement that all inserted rows in tests provide a `contextId` constant (and optionally rely on tenant_id default). Alternatively, if your ecosystemColumns() provides a default context_id in practice, correct AC #6 to reflect that.

5. [low] Spec expects specific generated CHECK constraint names that drizzle-kit may not guarantee
   - File: _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md:333-334
   - Confidence: medium
   - Why it matters: Task step 7 requires verifying specific CHECK constraint names in generated SQL (line 333). Depending on how Drizzle emits CHECK constraints and names them across versions, these names may be unstable or not present (e.g., emitted as unnamed CHECK clauses). That can create false failures during “by-eye” review and encourages brittle expectations about auto-generated SQL rather than validating behavior.
   - Suggested fix: Either (a) require functional presence of constraints by expression (not by name), or (b) explicitly require Drizzle schema to set those names and add a test that inspects `sqlite_master` to assert name presence if names are truly important.

## Strengths

- The dual-UNIQUE risk is now concretely test-driven and tied to the exact Drizzle insert form the production code must use (lines 67-76, 90-94, 230-245).
- FK enforcement is explicitly called out as mandatory for the libsql in-memory test environment, reducing false confidence about CASCADE/RESTRICT (lines 226-229, 291-293).
- The decision to avoid triggers is clearly stated with ownership pushed to later stories (T5.8/T5.9), preventing schema scope creep (lines 115-122, 123-130).
- `chk_rounds_event_pairing` directly addresses the prior partial-null inconsistency risk by preventing silent ‘half-associated’ rounds (line 202-203) and adds a corresponding test (line 289-291).
- Acceptance criteria are largely implementation-checkable (table shapes, indexes, and concrete test cases) rather than aspirational statements.

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md
