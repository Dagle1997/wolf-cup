# Codex Review

- Generated: 2026-04-27T16:35:42.629Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T3-5-rule-set-editor-tenant-scoped-revisioned.md, apps/tournament-api/src/db/schema/rules.ts

## Summary

Spec is largely internally consistent with T3-1 schema and the stated immutability posture (insert-only revisions, UNIQUE(rule_set_id, revision_number) safety net, greenies carryover↔validation refine). Two concrete gaps stand out: (1) tenant scoping is not actually enforced in queries/handlers as written (only stamped on insert), which can violate the “tenant-scoped” goal and cross-tenant isolation; (2) the AC/test plan includes an impossible “pin a fictional pinned_rule_set_revision_id” event test even though the column explicitly does not exist yet. There are also a couple of underspecified edge cases around “rule_set exists but has zero revisions” and concurrency semantics of SELECT MAX + INSERT.

Overall risk: medium

## Findings

1. [high] Tenant scoping not enforced on read/write paths (only stamped on INSERT) → cross-tenant access risk
   - File: _bmad-output/implementation-artifacts/tournament/T3-5-rule-set-editor-tenant-scoped-revisioned.md:112-256
   - Confidence: high
   - Why it matters: The story goal says “tenant-scoped” and FD-1/FD-2 isolation is a focus area, but the spec’s query shapes shown/required only filter by `id` / `rule_set_id` and do not include `tenantId` or `contextId` constraints. Stamping `tenantId='guyan'`/`contextId='library:guyan'` on insert (lines 134-136, 238-239, 255-256) does not prevent an organizer from reading or appending revisions to a rule_set belonging to a different tenant if IDs are guessable/known, because GET (lines 245-247) and POST /:id/revisions preflight (line 252) are specified as `WHERE id = :id` only. This is a concrete scope/authorization hole relative to “tenant-scoped.”
   - Suggested fix: In the spec/ACs, require all rule_set existence checks and revision queries to include tenant scoping, e.g. `WHERE id=:id AND tenant_id=:tenant` (or `context_id='library:'+tenant`). Do the same for MAX(revision_number) query and INSERT values. If tenant is currently single-tenant, explicitly document that assumption as a constraint and still filter by the stamped tenant/context to prevent future footguns.

2. [medium] AC/test plan requires an events “pin” test using a non-existent column (cannot be implemented as described)
   - File: _bmad-output/implementation-artifacts/tournament/T3-5-rule-set-editor-tenant-scoped-revisioned.md:141-148
   - Confidence: high
   - Why it matters: The spec explicitly says the pinning column does not exist yet (line 143), but then mandates a test that “pin[s] a fictional pinned_rule_set_revision_id to revision 1’s id” (line 147). That is not implementable against the stated schema. This will either block implementation or lead to a misleading test that doesn’t validate what it claims.
   - Suggested fix: Rewrite AC #7 / Risk Acceptance §4 test requirement to only assert what is possible now: that POST /revisions performs no UPDATE/DELETE/INSERT on `events` (byte-identical snapshot), without referencing any pinned column. If you want stronger immutability verification, assert rule_set_revisions rows are unchanged and no other tables were modified.

3. [medium] GET /rule-sets/:id assumes a latest revision always exists; behavior undefined if rule_set has zero revisions
   - File: _bmad-output/implementation-artifacts/tournament/T3-5-rule-set-editor-tenant-scoped-revisioned.md:242-248
   - Confidence: medium
   - Why it matters: AC #4 mandates returning `latestRevision: { ... }` (line 247) after selecting the latest revision (line 246). But the spec does not define what happens if a `rule_sets` row exists with no corresponding `rule_set_revisions` rows (possible via manual SQL, partial data restore, or failed transaction in older data). In that case, `ORDER BY ... LIMIT 1` yields 0 rows; the response shape becomes ambiguous and the frontend may crash if it assumes `latestRevision` is always present.
   - Suggested fix: Decide and codify one of: (a) treat “no revisions” as invariant violation → 500 `rule_set_has_no_revisions`; (b) return `latestRevision: null` and have UI handle/create first revision. Add a backend test for this edge case whichever you choose.

4. [low] Concurrency semantics: SELECT MAX + INSERT not specified as transactional; repeated 409s possible under contention
   - File: _bmad-output/implementation-artifacts/tournament/T3-5-rule-set-editor-tenant-scoped-revisioned.md:114-140
   - Confidence: medium
   - Why it matters: The spec relies on UNIQUE(rule_set_id, revision_number) and returning 409 on conflict (lines 139-140, 256-257). With SELECT MAX + INSERT outside a transaction (not specified in AC #5), concurrent saves can legitimately collide; the “no auto-retry” UI is intentional, but without a transaction you can also get more conflicts than necessary under moderate concurrency. This isn’t a correctness bug given the 409 contract, but it’s an availability/UX sharp edge.
   - Suggested fix: If you want to reduce conflicts without changing the 409 posture, specify using a transaction for the MAX+INSERT step (still catching UNIQUE and returning 409). Alternatively, document explicitly that the handler is non-atomic by design and 409 is expected under concurrency.

## Strengths

- RuleSetConfigSchema is fully spelled out with explicit numeric constraints and a single cross-field refine for greenies (lines 51-94), matching the stated contract and defense-in-depth posture.
- Immutability discipline is clearly stated (no UPDATEs; insert-only revisions) and backed by DB UNIQUE(rule_set_id, revision_number) in the referenced T3-1 schema (apps/tournament-api/src/db/schema/rules.ts lines 73-83).
- UI behavior around greenies carryover auto-switch + disabled invalid selection is clearly specified and mirrors the server-side refine (lines 165-167, 285-288).
- 409 revision_number_conflict no-auto-retry is explicitly reasoned and aligns with “don’t overwrite someone else’s intent” (lines 294-295, 384-385).
- Path footprint is explicitly limited to tournament-only areas and auto-generated routeTree, consistent with the zero-SHARED expectation (lines 205-216).

## Warnings

None.
