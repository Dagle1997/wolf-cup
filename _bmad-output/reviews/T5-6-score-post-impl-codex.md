# Codex Review

- Generated: 2026-04-28T15:51:49.043Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/lib/audit-log.ts, apps/tournament-api/src/lib/audit-log.test.ts, apps/tournament-api/src/lib/activity.ts, apps/tournament-api/src/lib/activity.test.ts, apps/tournament-api/src/middleware/require-scorer-for-round.ts, apps/tournament-api/src/middleware/require-scorer-for-round.test.ts, apps/tournament-api/src/routes/scores.ts, apps/tournament-api/src/routes/scores.integration.test.ts, apps/tournament-api/src/types/hono.d.ts, apps/tournament-api/src/app.ts

## Summary

Overall the scorer-gate middleware + score POST handler look coherent and tenant-scoped in all visible queries. The idempotent insert vs. cell-conflict split is implemented and covered by integration tests. The main correctness risk I see is concurrency: state transitions and their audit rows can be duplicated under concurrent first-commit / last-cell commits. Secondarily, the UNIQUE-detection heuristic is both too broad (message substring match) and potentially brittle (extendedCode type), which could misclassify other constraint errors as “hole already scored”. There are also a couple of spec-paths claimed in comments that are not pinned by tests (notably malformed JSON and “no audit on dedupe”).

Overall risk: high

## Findings

1. [high] Round state transitions are not concurrency-safe (can double-transition and double-audit under concurrent writes)
   - File: apps/tournament-api/src/routes/scores.ts:251-320
   - Confidence: high
   - Why it matters: The handler reads round_states (rs.state) early (lines 105-138) then conditionally performs transitions (not_started→in_progress; in_progress→complete_editable) and writes audit rows. With two concurrent score commits, both transactions can observe the same pre-state and both execute the update + audit. That can produce duplicated `round.state_changed` audit rows and potentially overwrite `openedAt/openedByPlayerId` (lines 267-272). Similar duplication can happen for auto-complete (lines 283-320). This violates “single-writer enforcement” intent at the state-transition layer even if score cells are unique.
   - Suggested fix: Make transitions conditional and audit only when a transition actually occurred. Example: update roundStates with a WHERE that includes the expected prior state (e.g., `where round_id=? and tenant_id=? and state='not_started'`) and check the affected-row count; only if 1 row was updated should you write the state-change audit and set openedAt. Do the same for auto-complete (`state='in_progress'` guard) to prevent duplicate audits and flapping under concurrency.

2. [high] `isUniqueConstraintError` is overly broad and may misclassify unrelated errors; also likely misses numeric extendedCode
   - File: apps/tournament-api/src/routes/scores.ts:363-386
   - Confidence: high
   - Why it matters: The conflict branch (lines 171-209) assumes a caught UNIQUE error means “cell already scored”. But `isUniqueConstraintError` returns true if the error message merely contains `'UNIQUE'` (line 380), which can match other constraints (including unrelated unique indexes / PK collisions) and incorrectly return 409 with a misleading `hole_already_scored`. Also, the comment says libsql uses extended-result-code 2067, but the function only checks `extendedCode === 'SQLITE_CONSTRAINT_UNIQUE'` (line 379). If `extendedCode` is numeric (2067) in some libsql/drizzle versions, this check won’t work and you’ll fall back to brittle message matching.
   - Suggested fix: Prefer structured checks only: `code === 'SQLITE_CONSTRAINT_UNIQUE'` and/or numeric `extendedCode === 2067`. Avoid message substring matching (or at least narrow it to known patterns from libsql). If possible, additionally disambiguate by inspecting which constraint/index failed (SQLite error messages often include the index name) so only the (round_id, player_id, hole_number) unique triggers `hole_already_scored`.

3. [medium] Hard-coded TENANT_ID ('guyan') across request-handling and audit writes limits true tenant scoping
   - File: apps/tournament-api/src/routes/scores.ts:43-44
   - Confidence: high
   - Why it matters: Tenant scoping is implemented in WHERE clauses, but it is scoped to a compile-time constant (e.g., scores.ts line 43, middleware line 32, audit-log.ts line 21). If the API is intended to serve multiple tenants/environments, requests from other tenants will be unable to operate correctly, and audit rows will be written under the wrong tenant.
   - Suggested fix: Derive tenantId from env/config per deployment, or from the session/context (if multi-tenant per request). Thread it through middleware/handler and into `writeAudit` instead of using a module-local constant.

4. [medium] Several claimed error paths/behaviors are not actually pinned by tests (notably malformed JSON and “no audit on dedupe”)
   - File: apps/tournament-api/src/middleware/require-scorer-for-round.test.ts:274-437
   - Confidence: high
   - Why it matters: The middleware implements a dedicated malformed JSON guard returning 400 `{code:'invalid_body', reason:'malformed_json'}` (require-scorer-for-round.ts lines 86-100), but there is no test that sends invalid JSON to verify this doesn’t regress to a 500. Separately, the scores integration test for dedupe says “no audit” (scores.integration.test.ts lines 299-332) but it does not assert audit_log row count stayed constant, so a future regression could silently write audit/activity on deduped replays.
   - Suggested fix: Add a middleware test that sends a non-JSON body (or invalid JSON) and asserts 400 + `reason:'malformed_json'`. In the dedupe integration test, assert `auditLog` count remains 1 after the replay (or remains unchanged before vs after).

5. [low] Middleware depends on `scorePostBodySchema` exported from the route module, creating a tight coupling/cycle risk
   - File: apps/tournament-api/src/middleware/require-scorer-for-round.ts:29-31
   - Confidence: medium
   - Why it matters: The middleware imports `scorePostBodySchema` from `../routes/scores.js` (line 30), while the route imports the middleware (scores.ts lines 34-35). In ESM this can work due to live bindings, but it’s fragile: changes in module initialization order or future refactors can turn this into runtime undefined/TDZ issues and makes the middleware harder to reuse independently.
   - Suggested fix: Move the schema into a shared module (e.g., `src/schemas/score-post.ts`) imported by both middleware and route to eliminate the circular dependency and improve reuse.

## Strengths

- Middleware implements a clear, test-covered decision tree (misuse 500s, path 400s, round_not_found 404, foursome/scorer 422/403), and stores the parsed body in context to avoid double-parsing.
- Handler cleanly separates idempotent replay (onConflictDoNothing on the 4-col dedupe key) vs. cell-level UNIQUE conflict (409 with a best-effort `conflictingEntry`).
- Audit logging is integrated transactionally with score commits and state transitions, and integration tests verify audit payload shape `{from,to}` for transitions.

## Warnings

None.
