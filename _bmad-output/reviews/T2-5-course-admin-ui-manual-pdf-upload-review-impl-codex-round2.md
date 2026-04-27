# Codex Review

- Generated: 2026-04-27T12:56:51.586Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/admin-courses.ts, apps/tournament-api/src/routes/admin-courses.test.ts, apps/tournament-web/src/routes/admin.courses.new.tsx, apps/tournament-web/src/routes/admin.courses.new.test.tsx

## Summary

Round-1 UNIQUE predicate narrowing + AbortController split look clean, and the added backend regression tests meaningfully pin the intended behavior (409 only for unique, 500 otherwise). No new High/Med issues found in the provided diff.

Overall risk: low

## Findings

1. [low] SaveCourseRequestSchema allows whitespace-only name/club_name/tee.color, which can create junk rows and defeat uniqueness expectations via trailing spaces
   - File: apps/tournament-api/src/routes/admin-courses.ts:232-243
   - Confidence: high
   - Why it matters: `z.string().min(1)` treats `'   '` as valid. That can lead to persisted courses/tees with visually-empty identifiers, and can also allow near-duplicate courses that differ only by whitespace (potentially bypassing the intended (tenant, club, name) uniqueness semantics at the user level).
   - Suggested fix: Use `z.string().trim().min(1)` for `name`, `club_name`, and `tees[].color` (and/or trim before insert). Consider normalizing (trim + maybe collapse internal whitespace) consistently on both UI + API boundaries.

## Strengths

- UNIQUE detection predicate is now scoped to UNIQUE-only sentinels (no generic SQLITE_CONSTRAINT), and you added a direct regression test to prevent re-broadening.
- Splitting upload/save AbortControllers plus unmount abort reduces orphaned in-flight requests; submit is also gated while uploading.
- Save handler has clear separation of concerns: JSON parse guard, schema validation, domain validation, then transactional persist with consistent error shapes.
- Good atomicity assertions in tests: verifies all four tables and checks no rows written on 400/401/403/409/500 paths.

## Warnings

None.
