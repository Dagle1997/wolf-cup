# Codex Review

- Generated: 2026-04-26T19:32:50.480Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T2-5-course-admin-ui-manual-pdf-upload-review.md

## Summary

Spec is mostly coherent and stays within tournament-only paths, but it has a concrete correctness gap around tenant_id/context_id persistence (impacts UNIQUE handling and possibly NOT NULL constraints), plus a couple ambiguities that will cause implementation/tests to diverge (validation error rendering, bodyLimit error code contract).

Overall risk: high

## Findings

1. [high] ACs don’t consistently require inserting tenant_id (and likely across all 4 tables), undermining UNIQUE constraint handling and possibly causing NOT NULL insert failures
   - File: _bmad-output/implementation-artifacts/tournament/T2-5-course-admin-ui-manual-pdf-upload-review.md:44-207
   - Confidence: high
   - Why it matters: The story goal and UNIQUE-conflict section rely on the unique index `(tenant_id, club_name, name)` (lines 69-70, 201-203). But AC #4’s insert bullets omit `tenant_id` entirely (lines 195-198) and only mention `contextId='library:guyan'`. If the T2-1 schema has `tenant_id` as NOT NULL (likely) or the unique index depends on it (certain), failing to set it will either: (a) hard-fail inserts (500) instead of the intended behavior, or (b) default/wrong tenant_id leading to incorrect duplicate detection / cross-tenant collisions.

The spec earlier states `courses` insert includes `tenant_id` (line 48) but AC #4 contradicts that (line 195). This inconsistency is likely to slip into implementation or tests and break the duplicate_course behavior in AC #5.
   - Suggested fix: Make AC #4 (and any related task text) explicitly require setting `tenant_id='guyan'` (and `context_id='library:guyan'` if applicable) on every inserted row that has those columns—at minimum `courses`, and very likely `course_revisions`, `course_tees`, `course_holes` if the schema is tenant-scoped. Also ensure the 409 duplicate_course test seeds an existing course with the same tenant_id.

2. [medium] Validation error rendering requirement is internally inconsistent (row-level inline vs top-level list), making frontend tests/behavior ambiguous
   - File: _bmad-output/implementation-artifacts/tournament/T2-5-course-admin-ui-manual-pdf-upload-review.md:88-236
   - Confidence: high
   - Why it matters: Risk Acceptance §6 claims “errors … display inline” and “maps each error string back to the offending row + displays in red” (lines 88-89). But AC #11 explicitly says v1 renders a single top-level error list and “future polish could map errors to specific rows” (line 235). AC #9 also implies row relevance (“inline above the relevant row”) in tests list (line 135-136).

This will directly affect how component tests are written (AC #14) and what “done” looks like in UI review.
   - Suggested fix: Pick one contract for T2-5: either (a) top-level list only, or (b) minimal row association (even partial). Update AC #11 and the frontend test bullets (lines 132-137) to match.

3. [medium] Body limit / error-code contract for JSON POST is underspecified and may not match existing T2-3 behavior (file_too_large vs invalid_body etc.)
   - File: _bmad-output/implementation-artifacts/tournament/T2-5-course-admin-ui-manual-pdf-upload-review.md:94-130
   - Confidence: medium
   - Why it matters: AC #1 requires `bodyLimit({ maxSize: 64 * 1024, onError: 400 mapper })` but doesn’t specify the exact response payload/code produced by the mapper (line 158). The backend test plan asserts “1 MB body → 400 file_too_large” (line 129), but that error code sounds tied to multipart upload and may not be what the JSON bodyLimit middleware emits.

If the code mapping is inconsistent, tests will become brittle or will incorrectly encode behavior that differs from existing middleware conventions.
   - Suggested fix: Specify the exact error response shape/code for bodyLimit failures for this JSON endpoint (e.g., `{ error:'bad_request', code:'file_too_large' }` if you truly reuse that mapping from T2-3) and ensure AC #1 and the backend test bullet (line 129) match that contract.

4. [medium] SaveCourseRequestSchema “mirrors ParsedCourseSchema” claim is not verifiable from this spec and has drift risk (naming + field optionality)
   - File: _bmad-output/implementation-artifacts/tournament/T2-5-course-admin-ui-manual-pdf-upload-review.md:160-187
   - Confidence: medium
   - Why it matters: AC #2 asserts the schema mirrors T2-3’s ParsedCourseSchema so parse-pdf output is directly POSTable (line 186). But the spec doesn’t cite the actual ParsedCourseSchema shape (the References section is truncated at line 399-400), and AC #4 uses camelCase DB column names (clubName/sourceUrl/extractionDate) while request uses snake_case (`club_name`, `source_url`). That’s fine if mapping exists, but the “directly POSTable” promise is easy to break if ParsedCourseSchema uses different naming/optionality (e.g., `source_url` present/required, totals possibly nullable, yardages value types).

If drift exists, the pre-populate + submit flow (AC #10 → AC #11) will fail despite “mirror” wording.
   - Suggested fix: Add an explicit reference (path + snippet) to the existing ParsedCourseSchema fields/names and confirm they match exactly (including `club_name` vs `clubName`, `source_url` presence, and hole yardages value types). If mapping is required, soften the “directly POSTable” claim and specify the transformation step.

## Strengths

- Paths/footprint are tournament-only and explicitly avoid SHARED/FORBIDDEN edits (lines 140-152, 283-286, 359-360).
- Transaction + UNIQUE-conflict behavior is explicitly called out with rollback expectations and specific libsql rawCode 2067 handling (lines 44-66, 67-77, 201-207).
- Rating ×10 boundary transform is specified with rounding examples and clear separation of storage vs form shape (lines 36-43, 209-212).
- Backend test intent includes rollback/no-partial-write checks, and it explicitly requires using the real T2-4 validator (lines 121-131, 244-247).

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T2-5-course-admin-ui-manual-pdf-upload-review.md
