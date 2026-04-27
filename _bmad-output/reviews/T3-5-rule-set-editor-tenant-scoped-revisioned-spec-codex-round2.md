# Codex Review

- Generated: 2026-04-27T16:38:38.907Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T3-5-rule-set-editor-tenant-scoped-revisioned.md

## Summary

Round-2 review: the four R1 issues appear addressed in-spec (explicit v1 single-tenant posture, event immutability test rewritten without a non-existent column, zero-revisions GET behavior defined, and MAX+INSERT wrapped in a transaction with UNIQUE→409 conflict handling). New issues found are mainly spec/test contract ambiguity and a missing read-path validation that could lead to UI/runtime breakage if stored JSON shape drifts/corrodes.

Overall risk: medium

## Findings

1. [medium] GET /rule-sets/:id deserializes configJson but does not validate it against RuleSetConfigSchema (shape corruption can crash UI / violate “schema is the contract”)
   - File: _bmad-output/implementation-artifacts/tournament/T3-5-rule-set-editor-tenant-scoped-revisioned.md:46-259
   - Confidence: high
   - Why it matters: The spec states the Zod schema is “load-bearing” and “the contract” (lines 46-49), but the GET handler acceptance criteria only JSON.parse’s the DB value and returns it (lines 258-259). If configJson is syntactically valid JSON but semantically wrong (missing keys, wrong types, extra nesting), the backend will still return 200 and the frontend may error (e.g., reading `greenies.carryover` from an unexpected shape) or accidentally allow saving an unintended normalized shape. This is especially likely if manual SQL edits happen (already acknowledged as a possibility) or if future schema evolution occurs.
   - Suggested fix: After JSON.parse, run `RuleSetConfigSchema.safeParse(parsed)` in the GET handler. If it fails, return a 500 (e.g., `invalid_config_shape`/`corrupt_config_json`) with a structured log including the Zod issues, rather than returning an invalid object. Consider also validating defaults used for the zero-revisions UI path to ensure parity.

2. [medium] Spec has inconsistent response-shape expectations around `requestId` (tests vs ACs) which can cause implementation churn and brittle tests
   - File: _bmad-output/implementation-artifacts/tournament/T3-5-rule-set-editor-tenant-scoped-revisioned.md:192-271
   - Confidence: high
   - Why it matters: AC #3 and AC #5 require success responses to include `requestId` (lines 249 and 271). But the backend test targets section describes responses without `requestId` (e.g., POST /rule-sets happy expects `{ ruleSetId, revisionId, revisionNumber: 1 }` at line 196; POST /:id/revisions happy similarly at line 201). The spec also says “Tests assert exact JSON response shapes” (line 406), so this mismatch will likely produce failing tests or force last-minute spec interpretation.
   - Suggested fix: Make the contract consistent in one place: either (a) update the test target bullets to include `requestId` everywhere success/error shapes include it, or (b) drop `requestId` from success responses in the ACs if that matches existing API conventions. Then explicitly state in the backend test AC that `requestId` is asserted (or explicitly ignored) to avoid ambiguity.

3. [low] Body-too-large test/wording references PATCH though endpoints are POST/GET only
   - File: _bmad-output/implementation-artifacts/tournament/T3-5-rule-set-editor-tenant-scoped-revisioned.md:160-207
   - Confidence: high
   - Why it matters: The test list includes “Body too large (PATCH/POST 8 KB cap)” (line 206) but the router defines only POST and GET (lines 161-163, 233-235). This is minor, but it can confuse the implementer and the test author about what should be covered.
   - Suggested fix: Adjust wording to just POST (or specify the exact endpoints that should enforce bodyLimit) and ensure the test hits one of the POST routes with a payload >8KB.

## Strengths

- R1 tenant-scoping gap is now explicitly acknowledged as an intentional v1 posture with a planned hardening sweep (§3a), reducing the risk of silent security assumptions.
- Event immutability test approach no longer depends on a non-existent `pinned_rule_set_revision_id` column; it now correctly asserts “events untouched” and “prior revisions untouched” via before/after snapshots (§4, AC #7).
- GET zero-revisions behavior is now defined (200 with `latestRevision: null` plus a structured WARN) and the UI behavior is specified (AC #4).
- Concurrency/race story is now realistic: transaction added, UNIQUE constraint treated as the real safety net, and 409 handling is specified (AC #5).

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T3-5-rule-set-editor-tenant-scoped-revisioned.md
