# Codex Review

- Generated: 2026-04-27T16:51:01.028Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/admin-rule-sets.ts, apps/tournament-api/src/routes/admin-rule-sets.test.ts, apps/tournament-api/src/app.ts, apps/tournament-web/src/routes/admin.rule-sets.$id.edit.tsx, apps/tournament-web/src/routes/admin.rule-sets.$id.edit.test.tsx

## Summary

Backend endpoints + SPA editor largely match the described design (tx create, immutable revisions, bodyLimit on POSTs, two-stage parse on GET, carryover↔validation refine duplicated client/server, query invalidation, abort-on-unmount pattern). Main gap: AC #1 claims 4 routes on adminRuleSetsRouter but only 3 are implemented. Also, the GET corrupt_config_json path is implemented but untested, and GET 200 responses omit requestId (inconsistent with the other responses).

Overall risk: medium

## Findings

1. [high] AC #1 mismatch: adminRuleSetsRouter defines 3 routes, not 4
   - File: apps/tournament-api/src/routes/admin-rule-sets.ts:125-442
   - Confidence: high
   - Why it matters: Acceptance criteria #1 explicitly requires “4 routes mounted on adminRuleSetsRouter at paths prefixed /rule-sets”. This router currently defines only 3 endpoints: POST /rule-sets, GET /rule-sets/:id, POST /rule-sets/:id/revisions (lines 130-223, 228-314, 319-442). If AC #1 is authoritative, this implementation will be rejected even if the story text says “3 backend endpoints”.
   - Suggested fix: Reconcile the spec: either (a) implement the missing 4th /rule-sets-prefixed route (whatever AC #1 intended—e.g., a list endpoint) or (b) correct AC #1/stakeholder expectation to 3 routes. Without clarity, adding an arbitrary endpoint risks changing contracts.

2. [medium] GET /rule-sets/:id does not include requestId in 200 response (inconsistent with other responses)
   - File: apps/tournament-api/src/routes/admin-rule-sets.ts:228-314
   - Confidence: medium
   - Why it matters: Both POST responses include requestId (lines 218-221, 437-440) and error responses include requestId (e.g., lines 235-238, 281-284, 294-297). The GET success response (lines 300-313) and the zero-revisions 200 response (lines 257-262) omit requestId, reducing traceability/debuggability and making client handling inconsistent if it expects requestId everywhere.
   - Suggested fix: If the broader API contract is “always return requestId”, add `requestId` to the GET 200 payload(s) as well. If not required, consider aligning AC/docs/tests to explicitly permit omission.

3. [medium] Two-stage parse has distinct 500 codes, but corrupt_config_json path is untested
   - File: apps/tournament-api/src/routes/admin-rule-sets.test.ts:163-224
   - Confidence: high
   - Why it matters: AC #4 calls out distinct 500 codes for JSON.parse failure vs Zod shape failure. Implementation provides both (corrupt_config_json at apps/tournament-api/src/routes/admin-rule-sets.ts:270-285; corrupt_config_shape at 286-298), but tests only assert corrupt_config_shape (test at lines 202-223). A regression could break corrupt_config_json without CI catching it.
   - Suggested fix: Add a test that tampers `rule_set_revisions.config_json` to a non-JSON string (e.g., '{') and asserts 500 code=corrupt_config_json.

## Strengths

- AC #8 satisfied: app.ts mounts a 4th router at /api/admin (apps/tournament-api/src/app.ts:62-65).
- AC #1 partially satisfied: all router paths are prefixed with /rule-sets and both POST endpoints enforce bodyLimit(8 KiB) while GET does not (apps/tournament-api/src/routes/admin-rule-sets.ts:130-143, 228-314, 319-332).
- AC #3 satisfied: POST /rule-sets creates rule_set + revision 1 in a single db.transaction and returns 201 with {ruleSetId, revisionId, revisionNumber:1, requestId} (apps/tournament-api/src/routes/admin-rule-sets.ts:176-221).
- AC #4 behavior implemented: GET returns latestRevision with configJson deserialized object; two-stage parse uses distinct error codes and structured logs; zero-revisions returns 200 latestRevision:null with warn log (apps/tournament-api/src/routes/admin-rule-sets.ts:249-263, 267-298).
- AC #5 satisfied: POST /:id/revisions preflights rule_set existence (404), wraps MAX-select + INSERT in a tx, maps UNIQUE/PK constraint to 409 revision_number_conflict (apps/tournament-api/src/routes/admin-rule-sets.ts:361-416).
- AC #7 covered by tests: prior rule_set_revisions row is byte-identical after new revision insert, and events table remains unchanged post-call (apps/tournament-api/src/routes/admin-rule-sets.test.ts:227-316).
- AC #2/#9 satisfied: RuleSetConfigSchema duplicated client+server including the carryover↔validation refine; route exports both Route and EditRuleSetPage; beforeLoad uses the same auth-status loader pattern (apps/tournament-web/src/routes/admin.rule-sets.$id.edit.tsx:59-90, 197-525).
- AC #10-#13 largely satisfied: form initializes from query once, carryover toggle updates both fields in one state update, save invalidates query, abort controllers tracked and aborted on unmount (apps/tournament-web/src/routes/admin.rule-sets.$id.edit.tsx:204-211, 236-245, 295-302, 267-271).
- Backend tests count appears to meet the stated target (15 tests in apps/tournament-api/src/routes/admin-rule-sets.test.ts).
- Frontend tests meet the stated target (4 tests in apps/tournament-web/src/routes/admin.rule-sets.$id.edit.test.tsx).

## Warnings

None.
