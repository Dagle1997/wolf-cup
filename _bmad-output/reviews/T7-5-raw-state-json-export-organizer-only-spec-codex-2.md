# Codex Review

- Generated: 2026-05-05T14:08:12.939Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T7-5-raw-state-json-export-organizer-only.md

## Summary

Spec edits do address the round-1 issues you listed (auth-vs-existence order is now explicit; audit_log entity_type mapping is enumerated; Drizzle predicate pairing is corrected; moneyMatrix viewer fallback is specified; FK-closure invariant is tightened). A couple of new/remaining correctness/security risks are introduced/left ambiguous, mainly around audit_log filtering edge cases (empty predicates/empty IN-lists) and the RULE_SET mapping being tenant-wide rather than event-scoped. The new top-level `warnings: string[]` is fine as long as the round-trip helper ignores non-table keys.

Overall risk: medium

## Findings

1. [medium] auditLog OR-filter can break on empty events / empty id lists (or(...[]) and inArray([], ...) edge cases)
   - File: _bmad-output/implementation-artifacts/tournament/T7-5-raw-state-json-export-organizer-only.md:66-83
   - Confidence: high
   - Why it matters: AC-7 explicitly requires a 200 “empty-event happy path” with empty arrays, including “no audit rows”. As written, the recommended query construction builds `predicates` and then `or(...predicates)` (line 78). If all per-type id arrays are empty, many ORMs either (a) throw when calling `or()` with zero args, or (b) generate invalid SQL / unexpected truthiness. Separately, some SQL builders generate invalid `IN ()` for `inArray(col, [])` or treat it inconsistently across dialects. Either case can turn an empty event into a 500, directly violating AC-7.
   - Suggested fix: In implementation, explicitly guard the empty case: if there are no non-empty per-type id arrays, skip querying audit_log (return `[]`), or use an always-false predicate (e.g., `sql`false``) as the WHERE. Also filter out predicates whose id list is empty before calling `or(...)` to avoid `IN ()` generation.

2. [medium] RULE_SET auditLog mapping is tenant-wide, which can over-export and leak unrelated rule-set audit within the tenant
   - File: _bmad-output/implementation-artifacts/tournament/T7-5-raw-state-json-export-organizer-only.md:54-64
   - Confidence: medium
   - Why it matters: The story framing and v1 scope describe an “event-scoped JSON dump” (lines 13–16, 52–55). But the RULE_SET mapping says `ruleSetRevisions.id WHERE tenant_id = event.tenant_id` (line 60), which is not event-scoped. That can cause the export to include audit_log rows for rule_set revisions unrelated to the event, increasing payload size and potentially disclosing unrelated operational history inside the same tenant. It also weakens the intended “enumerate exact (entity_type, entity_id) pairs owned by the event” constraint (line 54).
   - Suggested fix: Prefer an event-derived ruleSetRevisionId set (e.g., revisions actually referenced by the event via event/ruleset linkage, rounds, or whatever writers stamp for this event). If truly unavoidable in v1, call out explicitly in AC/scope that RULE_SET audit export is tenant-wide and add a dedicated test assertion limiting it (or a follow-up ticket to tighten to event-relevant ids).

3. [low] Top-level `warnings` field is fine, but round-trip helper must explicitly ignore non-table keys
   - File: _bmad-output/implementation-artifacts/tournament/T7-5-raw-state-json-export-organizer-only.md:114-118
   - Confidence: high
   - Why it matters: You added `warnings: string[]` at the top level (lines 114–118, 182). You also state the round-trip helper “iterates Object.keys from the export and re-inserts” (lines 289–290). If that helper attempts to treat every top-level key as a table insert, it will now try to insert `warnings` and fail. Even if the helper is smarter (table allowlist), this is the one new schema-expanding change most likely to cause accidental test breakage.
   - Suggested fix: Ensure the round-trip helper uses an explicit allowlist of table-shaped arrays to insert (or checks that the value is an array of objects and the key corresponds to a known table), and explicitly skips `schemaVersion`, `exportedAt`, `event`, `roster`, `players`, `warnings`, `moneyMatrix`, `settleUp`, etc.

4. [low] moneyMatrix parity test can become viewer-dependent if fixtures include `self_only` visibility
   - File: _bmad-output/implementation-artifacts/tournament/T7-5-raw-state-json-export-organizer-only.md:106-121
   - Confidence: medium
   - Why it matters: The spec now documents that `self_only` can truncate the computed matrix depending on viewer (lines 112–113), and that the export will emit a warning rather than fail. However, AC-5 requires byte-for-byte parity between exported matrix and recomputed matrix (lines 237–242). If any seeded/fixture event used in the parity test includes a `self_only` group, parity will hinge on using the exact same viewer id in both computations, and may still not represent a “complete matrix” as intended by the export’s purpose.
   - Suggested fix: Make the parity integration fixture explicitly enforce only `open`/`participant` modes (and assert that in the test), or, if you want coverage for `self_only`, add a separate test that asserts `warnings` contains `self_only_visibility_may_truncate_money_matrix` and relaxes/adjusts parity expectations accordingly.

## Strengths

- Auth-vs-existence resolution order is now explicit and consistent with the described middleware/handler responsibilities (lines 21–27).
- audit_log entity_type mapping is enumerated and includes a forward-compatibility test strategy to prevent silent drops (lines 54–84).
- Drizzle predicate composition is corrected to preserve (type,id) pairing and avoid cross-type collisions (lines 66–81).
- moneyMatrix viewer fallback is deterministic and acknowledges visibility-mode limitations, with a machine-readable warning mechanism (lines 106–118).
- FK-closure invariant is clarified in AC-4 with explicit out-of-scope exceptions, aligning better with the round-trip DB replay goal (lines 226–236).

## Warnings

None.
