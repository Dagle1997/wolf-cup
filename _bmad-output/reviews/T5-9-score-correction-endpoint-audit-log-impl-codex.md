# Codex Review

- Generated: 2026-05-02T12:16:05.056Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/score-corrections.ts, apps/tournament-api/src/routes/score-corrections.integration.test.ts, apps/tournament-api/src/app.ts, _bmad-output/implementation-artifacts/tournament/T5-9-score-correction-endpoint-audit-log.md

## Summary

Implements T5-9 score-corrections endpoints with in-tx auth-first checks, state gating via getRoundState, append-only score_corrections writes, hole_scores updates (including finalized), audit + activity emission, and post-commit breadcrumb logging for finalized rounds. Integration tests cover the core auth/state/error cases and the no-existence-leak regressions for POST/GET.

Overall risk: medium

## Findings

1. [medium] Finalized-round post-commit breadcrumb log (AC-4) is not asserted by tests; easy to regress to in-tx logging or omission
   - File: apps/tournament-api/src/routes/score-corrections.integration.test.ts:330-338
   - Confidence: high
   - Why it matters: AC-4 explicitly requires an info-level breadcrumb only AFTER the transaction commits (to avoid misleading logs on rollback). The implementation does log outside the tx (apps/tournament-api/src/routes/score-corrections.ts:363-374), but the current test for finalized corrections only asserts 200 + hole_scores updated and does not validate that the breadcrumb is emitted (or that it’s not emitted on failure). This is a correctness/observability contract that can silently regress without breaking other assertions.
   - Suggested fix: Add a test that spies on the logger used by the handler (e.g., inject a test logger via c.set('logger', ...) or spy on moduleLogger.info) and asserts: (1) when state is finalized and the request succeeds, one log with event 'correction_post_finalize_pending_t6' is emitted; (2) when the transaction fails/rolls back (e.g., force audit insert to fail), no such log is emitted.

2. [medium] Omitting `putts` clears existing putts to NULL (potential unintended data loss given `putts` is optional)
   - File: apps/tournament-api/src/routes/score-corrections.ts:60-316
   - Confidence: high
   - Why it matters: The schema marks `putts` as optional/nullable (line 62), but the handler treats `undefined` as an instruction to overwrite the cell with NULL: `putts: body.putts ?? null` both in the correction record (lines 289-292) and in the hole_scores UPDATE (lines 312-316). A client correcting only gross strokes and omitting putts will unintentionally wipe an existing putts value. This is a concrete data-loss footgun unless the API contract explicitly intends “missing == clear”. Current tests don’t assert putts behavior, so this could ship unnoticed.
   - Suggested fix: If the intended semantics are “omit == keep existing”, change logic to preserve cell.putts when body.putts is undefined (and record newValueJson accordingly), e.g. `const putts = body.putts === undefined ? cell.putts : body.putts;` then update/set based on that. If the intended semantics are “omit == clear”, consider making `putts` required (nullable) to force callers to be explicit and add a test that demonstrates/locks the behavior.

## Strengths

- Auth-leak invariant is implemented as described: POST and GET perform auth checks inside the transaction before state/existence reads (apps/tournament-api/src/routes/score-corrections.ts:220-237, 440-456).
- Organizer identity uses caller identity (`player.id`) rather than the URL `:playerId`, avoiding the spec’s fail-open/fail-closed pitfall (apps/tournament-api/src/routes/score-corrections.ts:223-229).
- T6 breadcrumb log is emitted outside the transaction callback, satisfying the post-commit requirement in implementation (apps/tournament-api/src/routes/score-corrections.ts:363-374).
- score_corrections is append-only in this change (only INSERTs; no UPDATE/DELETE).
- Tenant scoping is consistently applied in the route’s direct queries and in the auth helper joins (apps/tournament-api/src/routes/score-corrections.ts:95-103, 112-119, 264-271, 460-465).
- Integration tests include explicit no-existence-leak regressions for POST and GET (apps/tournament-api/src/routes/score-corrections.integration.test.ts:429-437, 472-480).

## Warnings

None.
