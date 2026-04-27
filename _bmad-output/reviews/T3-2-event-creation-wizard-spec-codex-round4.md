# Codex Review

- Generated: 2026-04-27T14:21:14.813Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T3-2-event-creation-wizard.md

## Summary

One concrete spec inconsistency remains: the planned “transactional rollback” backend test is described as using an invalid `course_revision_id` to trigger an in-transaction failure, but AC #3 now mandates a pre-flight existence check that returns 400 before the transaction begins. As written, that rollback test case is no longer achievable and will either be redundant with the new pre-flight 400 test or require a different failure mechanism.

Overall risk: medium

## Findings

1. [medium] Rollback test case is no longer implementable as described after adding pre-flight unknown course_revision check
   - File: _bmad-output/implementation-artifacts/tournament/T3-2-event-creation-wizard.md:109-121
   - Confidence: high
   - Why it matters: The spec now mandates (AC #3) a pre-flight `SELECT ... WHERE id IN (...)` and early 400 `{ code: 'unknown_course_revision' }` if any `course_revision_id` is missing. However, the backend test plan still includes a separate “Transactional rollback” test that uses an invalid `course_revision_id` to force an insert failure during the transaction (line 120-121). With the pre-flight in place, that scenario never reaches the transaction, so the rollback behavior won’t be exercised. This creates a gap: the story intends to prove atomicity (no partial rows across 4 tables on a mid-transaction failure), but the listed mechanism can’t trigger that mid-transaction failure anymore.
   - Suggested fix: Update the rollback test to force a failure *inside* the transaction using a different mechanism. Examples that fit the spec’s constraints: (1) in the test, pre-seed an `invites` row with a known token and mock `crypto.randomBytes(32)` to return bytes that base64url-encode to that same token, causing a UNIQUE violation on `invites.token` during the transaction; then assert 500 + zero rows across all 4 tables. Or (2) mock `randomUUID()` for one child insert to reuse an existing primary key to trigger a PK conflict mid-transaction. Also update the Risk Acceptance §9 list / AC #13 bullet (line 120-121) to match the new approach so it’s unambiguous.

## Strengths

- AC #3’s pre-flight `course_revision_id` existence check cleanly converts an otherwise-500 FK violation into a deterministic 400 with a useful `{ missing: [...] }` payload.
- The spec is explicit about transaction scope (4 tables) and context_id stamping requirements, including test coverage for context_id consistency.
- Invite token generation is correctly pinned to `crypto.randomBytes(32).toString('base64url')` with an exact test assertion (charset + length 43), which prevents accidental regression to UUIDs.

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T3-2-event-creation-wizard.md
