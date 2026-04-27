# Codex Review

- Generated: 2026-04-27T14:20:02.139Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T3-2-event-creation-wizard.md

## Summary

Spec is largely consistent and closes the Round-2 items (global CSRF inheritance explicitly documented; invite URL now origin-derived; explicit client coercion boundary; “copied helper” clarified as non-shared). One remaining contract/validation gap: `course_revision_id` is only `min(1)` and FK failures from user input are treated as 500s, which conflicts with the spec’s own “validation → 400” rule and will produce avoidable 500s on malformed/unknown IDs.

Overall risk: medium

## Findings

1. [medium] `course_revision_id` is under-validated; user-supplied FK failures will likely surface as 500 (conflicts with stated “validation → 400” boundary)
   - File: _bmad-output/implementation-artifacts/tournament/T3-2-event-creation-wizard.md:47-201
   - Confidence: high
   - Why it matters: The request schema currently allows any non-empty string for `rounds[].course_revision_id` (line 161-162). A client bug or malicious caller can submit a non-UUID or non-existent ID that passes Zod but fails the DB FK/constraint during the transaction. Per AC #4, “any DB failure” returns a generic 500 (line 199-201), even though this is effectively a validation error from untrusted input. This creates noisy server errors, makes client UX worse (retry prompt instead of “invalid selection”), and contradicts the earlier statement that the handler maps “validation → 400” (line 47).
   - Suggested fix: Tighten boundary validation so bad IDs don’t reach the DB:
- At minimum: change Zod to `z.string().uuid()` for `course_revision_id` (line 161-162).
- Better: also verify existence (and tenant) before insert, e.g. in the transaction: prefetch distinct `course_revision_id`s referenced, ensure they exist, and if not return 400 `{ code: 'invalid_body' }`.
- Alternatively: catch FK-constraint errors specifically and map them to 400 invalid_body (keeping 500 for true server-side failures).

## Strengths

- Global CSRF inheritance is explicitly called out as intentional (AC #1) rather than an omission.
- Client-side coercion is clearly specified as a single boundary transformation (dates/number selects/trim), reducing type drift.
- Transaction + context_id stamping discipline is clearly described, with explicit test targets for rollback + context_id propagation.
- Invite token entropy requirement is explicit and testable (base64url charset + exact length 43).

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T3-2-event-creation-wizard.md
