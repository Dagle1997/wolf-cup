# Codex Review

- Generated: 2026-04-27T01:16:14.425Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T2-5-course-admin-ui-manual-pdf-upload-review.md

## Summary

Reviewed the provided Round-3 spec markdown excerpt for NEW concrete issues only (no prior-round items). No High/Med issues found from the evidence in the file; a couple of small correctness/clarity and input-validation gaps remain.

Overall risk: low

## Findings

1. [low] Spec inconsistency: UI/form state is described as ParsedCourse, but backend request schema adds optional source_url and spec claims “manual entry may supply it” without any UI field
   - File: _bmad-output/implementation-artifacts/tournament/T2-5-course-admin-ui-manual-pdf-upload-review.md:21-233
   - Confidence: high
   - Why it matters: The spec states the frontend form state uses `useState<ParsedCourse>` (line 21), while the save request schema includes an optional `source_url` (lines 183-190) and the narrative says “manual entry may supply it” (line 193). However, the UI scope/idle render requirements list no `source_url` input (lines 100-107, 224-233). This can lead to ambiguity during implementation/tests (either the UI never sends source_url, or the form state type needs to be extended beyond ParsedCourse).
   - Suggested fix: Either (a) explicitly state `source_url` is backend-only and is always omitted/undefined in T2-5 UI (and remove “manual entry may supply it”), or (b) add a `source_url` input to the UI requirements and update the frontend state type to include it (e.g., `ParsedCourse & { source_url?: string }`).

2. [low] SaveCourseRequestSchema allows non-finite tee.rating (e.g., Infinity) which can break Math.round(rating * 10) and DB inserts
   - File: _bmad-output/implementation-artifacts/tournament/T2-5-course-admin-ui-manual-pdf-upload-review.md:167-219
   - Confidence: high
   - Why it matters: `rating: z.number().positive()` (line 169) accepts `Infinity` in Zod. If a client sends `Infinity`, `Math.round(tee.rating * 10)` (line 218) yields `Infinity`, which is not a valid integer for storage and would likely cause a runtime/DB error (500) rather than a clean 400 invalid_body.
   - Suggested fix: Tighten request validation for rating (and optionally other non-int numbers) to `z.number().finite().positive()` so non-finite values are rejected at the 400 invalid_body boundary.

## Strengths

- The `source_url` scheme restriction via `.refine(/^https?:\/\//i)` is clearly documented and correctly addresses stored-XSS via permissive `.url()` schemes (lines 183-193).
- Clear transaction + rollback requirements across 4 tables reduce partial-write/data-integrity risk (lines 46-66, 199-206).
- Explicit UNIQUE-conflict mapping to 409 with the referenced `rawCode: 2067` pattern is concrete and testable (lines 67-78, 208-211).
- Good emphasis that T2-4 validation must run before opening the DB transaction, with a no-write guarantee on validation failure (lines 32-35, 195-198).

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T2-5-course-admin-ui-manual-pdf-upload-review.md
