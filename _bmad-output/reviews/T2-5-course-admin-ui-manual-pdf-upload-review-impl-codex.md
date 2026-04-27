# Codex Review

- Generated: 2026-04-27T12:51:53.607Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/admin-courses.ts, apps/tournament-api/src/routes/admin-courses.test.ts, apps/tournament-web/src/routes/admin.courses.new.tsx, apps/tournament-web/src/routes/admin.courses.new.test.tsx

## Summary

Backend save endpoint is correctly mounted on the existing admin-courses router with the required middleware order, validates via Zod + T2-4 before opening a single libsql transaction, and writes all 4 tables with tenant/context fields. The UI route exports both Route and NewCoursePage and implements upload pre-populate + save flows with reasonable error mapping and solid baseline tests. Main gaps: UNIQUE predicate is overly broad (may misclassify non-UNIQUE constraint errors as duplicates), AbortController ref can be overwritten leaving in-flight requests un-aborted on unmount, and a couple AC-relevant tests are missing (auth guard, 500/save_failed, Infinity rating rejection).

Overall risk: medium

## Findings

1. [high] UNIQUE conflict predicate is overly broad: treats generic SQLITE_CONSTRAINT as duplicate_course
   - File: apps/tournament-api/src/routes/admin-courses.ts:292-301
   - Confidence: high
   - Why it matters: AC requires 409 only for UNIQUE conflicts on (tenant_id, club_name, name). The current predicate returns true for `e.code === 'SQLITE_CONSTRAINT'` (line 299), which can include NOT NULL, FK, CHECK, etc. That would incorrectly return 409 duplicate_course for unrelated DB failures, masking real bugs and violating the response contract (AC #5/#6).
   - Suggested fix: Remove the `e.code === 'SQLITE_CONSTRAINT'` branch. Match only UNIQUE-specific sentinels (rawCode 2067 and/or code/extendedCode === 'SQLITE_CONSTRAINT_UNIQUE'). If drizzle/libsql sometimes reports numeric extended codes, consider checking `extendedCode === 2067` too, but keep it UNIQUE-specific.

2. [medium] AbortController ref is overwritten between upload and save; unmount may not abort all in-flight requests
   - File: apps/tournament-web/src/routes/admin.courses.new.tsx:141-448
   - Confidence: high
   - Why it matters: The component uses a single `abortRef` for both upload and save (set at lines 289-290 and 392-393; unmount abort at 145-147). If an upload is in-flight and the user submits (submit is not disabled by `uploading` at line 452), `abortRef.current` will point to the save controller and unmount will not abort the upload request. That can lead to state updates after unmount (despite `ac.signal.aborted` checks) because that upload controller was never aborted.
   - Suggested fix: Use separate refs (e.g., `uploadAbortRef` and `saveAbortRef`) and abort both on unmount, or abort any existing controller before replacing it. Also consider disabling Submit while `uploading` to prevent concurrent requests.

3. [medium] Frontend tests explicitly skip auth-guard behavior (beforeLoad redirect + non-organizer ForbiddenMessage) required by AC
   - File: apps/tournament-web/src/routes/admin.courses.new.test.tsx:1-8
   - Confidence: high
   - Why it matters: AC #8 requires specific beforeLoad behavior (ensureQueryData auth-status, anonymous redirect, non-organizer forbidden). The test file states the loader/auth guard is not exercised and is covered by manual walkthrough instead. That leaves the acceptance-critical route guard unverified in automated tests.
   - Suggested fix: Add route-level tests that execute `Route.options.beforeLoad` (or mount a TanStack Router instance) to assert: (1) anonymous calls `window.location.assign('/api/auth/google')`, (2) organizer renders `NewCoursePage`, (3) non-organizer renders `ForbiddenMessage`, and that ensureQueryData uses the expected queryKey/staleTime/retry settings.

4. [low] Missing backend test coverage for AC-relevant failure modes: Infinity rating rejection and non-UNIQUE DB failure → 500 save_failed
   - File: apps/tournament-api/src/routes/admin-courses.test.ts:525-787
   - Confidence: medium
   - Why it matters: AC #2 explicitly calls out `.finite()` to prevent Infinity bypass; there is no test asserting Infinity is rejected with 400 invalid_body. AC #6 requires non-UNIQUE DB failures map to 500 save_failed; there is no test that forces a non-UNIQUE DB error and asserts the 500 shape. These are key regression points.
   - Suggested fix: Add a test that sends `tees[0].rating = Infinity` and expects 400 invalid_body. Add a test that forces a non-UNIQUE failure (e.g., temporarily stub `db.transaction` to throw a non-unique error, or trigger a controlled constraint failure not caught by Zod) and assert 500 `{ error:'internal', code:'save_failed', requestId }`.

## Strengths

- Correct middleware order and distinct bodyLimit onError shapes for parse-pdf vs JSON save (admin-courses.ts:73-86, 303-316).
- validateCourse runs before opening the transaction; transactional insert covers all 4 tables and sets tenantId/contextId everywhere (admin-courses.ts:349-423).
- Rating ×10 storage discipline implemented and asserted (admin-courses.ts:398-409; admin-courses.test.ts:566-568).
- Backend test suite is substantial (10+ cases) and uses real T2-4 validator (no mocking).
- UI exports both Route and NewCoursePage; form covers required sections and implements top-level validation error list rendering (admin.courses.new.tsx:136-676).
- Frontend tests cover pre-populate, save success/reset, validation_failed list, upload error messaging, and duplicate_course behavior (admin.courses.new.test.tsx:64-292).
- Path allowlist appears respected: only the four story files are changed in the provided diff.

## Warnings

None.
