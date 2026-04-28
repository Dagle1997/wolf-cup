# Codex Review

- Generated: 2026-04-28T12:35:11.982Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md

## Summary

Round-2 issues are mostly addressed with concrete spec sharpening and test-driven verification, especially the STOP-and-ask-Josh contingency and the clarified `chk_rounds_event_pairing` intent. However, two internal contradictions were introduced: (1) FK PRAGMA enablement is specified in two different ways (client.execute vs drizzle db.run), reintroducing ambiguity; and (2) the spec simultaneously requires specific UNIQUE constraint names while also stating naming is not reliable/should not be depended on. These should be reconciled before dev starts to avoid mis-implementation or fragile tests/migration expectations.

Overall risk: medium

## Findings

1. [medium] FK enforcement instructions contradict: AC #4 mandates `client.execute(PRAGMA...)` but Tasks step 8 reintroduces `db.run(PRAGMA...)`
   - File: _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md:231-343
   - Confidence: high
   - Why it matters: Round-2 explicitly resolved PRAGMA ambiguity by requiring `await client.execute('PRAGMA foreign_keys = ON')` on the libsql client and verifying the `.execute()` return shape (lines 231-235). But later, Tasks step 8 (line 342) says the test setup MUST `await db.run(sql\`PRAGMA foreign_keys = ON\`)` (and is truncated). That contradiction can cause developers to enable FK enforcement via the wrong API or think both are required. Worst case: FK enforcement may not actually be enabled (or the verification checks the wrong result shape), leading to tests that falsely pass/fail and runtime behavior that differs from test assumptions.
   - Suggested fix: Pick one canonical method and delete the other. Given the round-2 resolution, keep AC #4’s `client.execute('PRAGMA foreign_keys = ON')` + `client.execute('PRAGMA foreign_keys')` verification, and update Tasks step 8 to match (remove `db.run(...)`). If you truly need both for some reason, explicitly explain why and provide the exact verification step for each (but that’s usually unnecessary).

2. [medium] Constraint naming expectations are internally inconsistent (UNIQUE names required in AC #1 vs later guidance that names may be auto-generated)
   - File: _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md:205-342
   - Confidence: high
   - Why it matters: AC #1 requires the two UNIQUE constraints to be named `uniq_hole_scores_cell` and `uniq_hole_scores_dedupe` (line 206). But Tasks step 7 says inspection should confirm both UNIQUE indexes exist “regardless of drizzle-kit's auto-naming” and that tests should not depend on specific CHECK names (lines 341-342). This sends mixed signals about whether migration output and schema must produce stable, specific names. Developers may waste time trying to force names that drizzle/sqlite may not reliably preserve (or the migration may differ), or tests/review steps may conflict with AC #1.
   - Suggested fix: Reconcile the spec: either (A) explicitly require named UNIQUE indexes/constraints and also require the migration to contain those names (and adjust step 7 to check for them), or (B) remove the naming requirement from AC #1 and instead require only that the two UNIQUE predicates exist (matching step 7’s approach). Given your round-2 stance on names not being guaranteed, option (B) is more consistent unless you have proven drizzle-kit will reliably emit the requested UNIQUE names.

3. [low] Wording: “same cell + same client_event_id allowed (dedupe)” is misleading given a UNIQUE constraint
   - File: _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md:60-66
   - Confidence: high
   - Why it matters: Line 63 says the idempotency UNIQUE means “same cell + same client_event_id allowed (dedupe)”. A UNIQUE constraint does not allow duplicates; the design is that a duplicate insert attempt is ignored via `ON CONFLICT ... DO NOTHING`. This is subtle but important because it affects mental models for downstream writers (T5.6/T5.3) and how they reason about expected row counts and idempotency semantics.
   - Suggested fix: Reword to something like: “Idempotency UNIQUE: `UNIQUE(round_id, player_id, hole_number, client_event_id)` — enables dedupe by making identical replays collide on this constraint so the production INSERT can `ON CONFLICT(...client_event_id) DO NOTHING`.”

4. [low] Potential ambiguity: `rounds` lists `createdAt` but not `updatedAt` while other tables include both
   - File: _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md:199-210
   - Confidence: medium
   - Why it matters: AC #1 specifies `rounds` includes `createdAt` but does not mention `updatedAt` (line 205), while `holeScores` explicitly includes `createdAt`, `updatedAt` (line 206) and `scoreCorrections` intentionally omits `updatedAt` (line 207). If `rounds` is intended to have `updatedAt` (common convention) but it’s omitted here, developers may implement inconsistently or break expectations in later stories that rely on `updatedAt` for sync/audit/debugging. If it’s intentionally omitted, the spec should say so (as it does for `score_corrections`).
   - Suggested fix: Either add `updatedAt` to `rounds` AC shape (and migrate accordingly) or explicitly call out that `rounds` is create-only (no `updatedAt`) and why. Ensure migration + tests align.

## Strengths

- STOP-and-ask-Josh contingency is explicit about the trigger condition (Test 4a failing), the required evidence capture, the required pending_gate marker type (`dual-unique-test-failed`), and that only Josh can authorize deviation (lines 84-92).
- `chk_rounds_event_pairing` strictness is now justified with a clear v1/v1.5 state model and an explicit migration/ADR path if v2 needs asymmetry (line 205).
- Foreign key enforcement verification is concretely specified (PRAGMA enable + PRAGMA readback assertion) and ties to libsql `.execute()` return shape (lines 231-235).
- The dual-UNIQUE behavior is pinned by three concrete integration tests (4a/4b/4c) that encode the intended idempotency/collision semantics (lines 238-253).
- Spec includes explicit file touch list and asserts additive-only migration constraints, reducing risk of accidental destructive schema changes (lines 19-33, 219-226).

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md
