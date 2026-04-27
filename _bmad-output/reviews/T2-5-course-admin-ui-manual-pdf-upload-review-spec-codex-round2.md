# Codex Review

- Generated: 2026-04-27T01:14:20.164Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T2-5-course-admin-ui-manual-pdf-upload-review.md

## Summary

Round-1 fixes appear correctly incorporated (tenantId/contextId explicitly required on all 4 inserts; validation errors rendered as a single top-level list; bodyLimit error contract specified; mirror claim now points to exact parser schema location). One new medium-risk issue is introduced around `source_url` validation/safety, plus one ambiguity around passing `source_url` through `validateCourse`.

Overall risk: medium

## Findings

1. [medium] `source_url: z.string().url()` allows non-http(s) schemes (e.g., `javascript:`) → potential stored XSS / unsafe link injection later
   - File: _bmad-output/implementation-artifacts/tournament/T2-5-course-admin-ui-manual-pdf-upload-review.md:160-187
   - Confidence: high
   - Why it matters: Zod’s `.url()` accepts any syntactically-valid URL scheme; `javascript:...` and other non-web schemes can pass. Since `source_url` is persisted (AC #4 mentions storing it in `course_revisions`), any future UI that renders it as a link risks stored XSS or unsafe navigation.
   - Suggested fix: Restrict schemes explicitly, e.g. `z.string().url().refine(u => /^https?:\/\//.test(u), 'source_url must be http(s)')`, or store only if `new URL(u).protocol` is `http:`/`https:`. Also ensure any rendering uses safe link handling/escaping.

2. [low] Ambiguity: `validateCourse(body)` may fail if T2-4 validator expects exact ParsedCourse shape (and `source_url` is extra)
   - File: _bmad-output/implementation-artifacts/tournament/T2-5-course-admin-ui-manual-pdf-upload-review.md:183-191
   - Confidence: medium
   - Why it matters: AC #2 explicitly adds `source_url` beyond the referenced ParsedCourse schema, while AC #3 says to call `validateCourse(body)`. If T2-4’s validator is implemented with a strict schema (or otherwise rejects unknown keys), any request that includes `source_url` could be rejected even though the endpoint intends to persist it.
   - Suggested fix: Make the contract explicit: either (a) call `validateCourse` on the ParsedCourse subset (`const { source_url, ...course } = body; validateCourse(course)`), or (b) update/confirm T2-4 validator accepts optional `source_url` (documented) so this isn’t implementation-dependent.

## Strengths

- Round-1 High issue appears cleanly resolved: tenantId/contextId requirements are explicitly stated for courses, course_revisions, course_tees, and course_holes with the NOT NULL/no-default warning (AC #4, lines 194-199).
- Round-1 Med issue resolved: spec now consistently requires rendering validation errors as a single top-level list, with inline row-mapping deferred (§6 and AC #11, lines 88-89 and 235-236).
- Round-1 Med issue resolved: body-limit error response shape is now explicitly specified as `{ error: 'bad_request', code: 'body_too_large', requestId }` (AC #1, lines 156-159) and test expectation updated (lines 129-130).
- Mirror claim is now grounded with an explicit file+line reference and snake_case field list (AC #2, lines 186-187).

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T2-5-course-admin-ui-manual-pdf-upload-review.md
