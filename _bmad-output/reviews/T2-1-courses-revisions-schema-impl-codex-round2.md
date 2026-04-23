# Codex Review

- Generated: 2026-04-23T17:02:06.251Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/db/schema/courses.ts, apps/tournament-api/src/db/schema/courses.test.ts, _bmad-output/implementation-artifacts/tournament/T2-1-courses-revisions-schema.md

## Summary

Requested checks: (1) The round-1 MED fix is present: a `beforeAll` runs after `migrate()` and asserts `PRAGMA foreign_keys` returns `1` on the mocked connection (apps/tournament-api/src/db/schema/courses.test.ts:70-82). (2) The round-1 HIGH is explicitly documented/accepted: `courses.ts` now contains an explicit comment explaining the intentional `tenant_id` default for v1 and flags it as a future hardening item (apps/tournament-api/src/db/schema/courses.ts:23-33), and the spec’s risk-acceptance section documents both the composite-FK gap and the `tenant_id` default gap together (T2-1-courses-revisions-schema.md:30-44). (3) No new High/Med issues found in the provided files. (4) Implementation matches the updated spec on table shapes, indexes, mixed RESTRICT/CASCADE posture, and the explicit v1-gap test documenting cross-tenant mismatch.

Overall risk: low

## Findings

1. [low] FK PRAGMA assertion may be brittle if libsql returns string/boolean instead of number
   - File: apps/tournament-api/src/db/schema/courses.test.ts:77-82
   - Confidence: medium
   - Why it matters: The new defense-in-depth assertion is good, but it assumes the result shape `{ rows: [{ foreign_keys: 1 }] }` with a numeric `1`. If libsql/drizzle changes to return `'1'` (string) or `true`, the assertion could fail even when FK enforcement is enabled, creating noisy failures unrelated to actual FK posture.
   - Suggested fix: Coerce the value before asserting, e.g. `expect(Number((row as any)?.foreign_keys)).toBe(1)` (or accept `1 | '1' | true`).

2. [low] Spec says re-import query is ordered by revision_number, but test doesn’t assert ordering
   - File: apps/tournament-api/src/db/schema/courses.test.ts:501-513
   - Confidence: high
   - Why it matters: AC #8 in the spec explicitly mentions returning revisions ordered by `revision_number`. The current test validates both revisions exist and have correct metadata, but not ordering, so it won’t catch accidental changes where consumers rely on ordering but forget `orderBy()`.
   - Suggested fix: Either (a) add `.orderBy(courseRevisions.revisionNumber)` and assert `[1,2]` order, or (b) adjust the spec wording if ordering is not intended as part of the contract.

## Strengths

- Round-1 MED fix is implemented in a way that will fail fast before FK-related tests become misleading (courses.test.ts:70-82), and it reuses the same mocked module instance so it’s checking the relevant connection.
- Round-1 HIGH (tenant_id default / multi-tenant risk) is not silently ignored; it’s explicitly documented in schema comments (courses.ts:23-33) and in spec risk acceptance alongside the composite-FK gap (T2-1 spec:30-44).
- Mixed FK delete posture (RESTRICT courses→revisions, CASCADE revisions→tees/holes) is consistently implemented in schema (courses.ts:74-77, 104-107, 129-132) and tested (courses.test.ts:406-486).
- The explicit “[v1-gap]” test cleanly documents the composite-FK tenant mismatch behavior as an assertion-flip point for future hardening (courses.test.ts:515-555), aligning with the spec’s stated v1 posture.

## Warnings

None.
