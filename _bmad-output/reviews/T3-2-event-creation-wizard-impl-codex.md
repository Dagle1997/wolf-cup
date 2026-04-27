# Codex Review

- Generated: 2026-04-27T14:33:51.496Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/admin-events.ts, apps/tournament-api/src/routes/admin-events.test.ts, apps/tournament-api/src/app.ts, apps/tournament-web/src/routes/admin.events.new.tsx, apps/tournament-web/src/routes/admin.events.new.test.tsx

## Summary

Backend route + mounting largely meet the stated ACs: /api/admin/events exists with the required middleware chain and 16KiB limit; Zod schema includes date + IANA timezone refines; course_revision_id preflight happens before the transaction; 4 inserts are done inside a single drizzle.transaction; failures log admin_event_create_failed and return 500 create_failed; tests cover token entropy (43 base64url chars) and contextId stamping across all 4 tables.

Main gap found is on the frontend: the course list React Query runs immediately on wizard mount (step 1), despite comments/tests implying it should only run on step 2, which can cause unnecessary requests and test brittleness. Additionally, the server preflight SELECT isn’t wrapped in error handling, so a DB failure there won’t return the specified 500 create_failed shape or emit the required failure log event.

Overall risk: medium

## Findings

1. [medium] Courses query fires on step 1 (wizard mount), not step 2 as intended
   - File: apps/tournament-web/src/routes/admin.events.new.tsx:152-163
   - Confidence: high
   - Why it matters: The code comment says “Course picker query (step 2)” but useQuery is unconditional, so it will fetch /api/courses even while the user is on step 1. This is extra network load and contradicts the wizard’s intended step-driven behavior. In tests, the first test doesn’t configure fetch responses; an unexpected query can yield rejected promises/unhandled error noise and make the suite flaky.
   - Suggested fix: Gate the query with React Query’s `enabled` so it runs only when the rounds UI is reachable, e.g. `enabled: form.step !== 1` (or `form.step >= 2`). Alternatively, move the useQuery call into a Step2 subcomponent that only renders when `form.step === 2 || form.step === 3`.

2. [medium] DB errors during preflight course_revision_id check are not caught/logged and won’t return create_failed shape
   - File: apps/tournament-api/src/routes/admin-events.ts:153-174
   - Confidence: high
   - Why it matters: If `db.select(...courseRevisions...)` throws (DB outage, libsql error), the handler will throw before reaching the transaction try/catch. That means no `admin_event_create_failed` log emission and likely a framework-default 500 response shape, deviating from the story’s “create_failed + requestId + log event” failure handling expectations (even if AC #4 explicitly mentions tx failures, this is still part of the create path).
   - Suggested fix: Wrap the preflight SELECT in a try/catch and on error log `admin_event_create_failed` (or a distinct event) and return `{ error: 'internal', code: 'create_failed', requestId }` with 500 (or another explicitly specified code if desired).

## Strengths

- Admin route is correctly mounted under `/api/admin` alongside adminCoursesRouter (apps/tournament-api/src/app.ts:39-47).
- Middleware ordering matches AC: requireSession → requireOrganizer → bodyLimit(16 KiB) with onError returning 400 body_too_large + requestId (apps/tournament-api/src/routes/admin-events.ts:101-114).
- Zod schema includes end_date >= start_date and round_date within [start,end], rounds min(1)/max(20), holes_to_play 9|18, and IANA tz validation using Intl.DateTimeFormat(...).format(...) (apps/tournament-api/src/routes/admin-events.ts:60-97).
- Preflight course_revision_id existence check runs before transaction and returns 400 unknown_course_revision with missing[] (apps/tournament-api/src/routes/admin-events.ts:153-174); covered by test (admin-events.test.ts:260-277).
- Transaction inserts all 4 tables and stamps the same contextId onto events/event_rounds/invites/groups (apps/tournament-api/src/routes/admin-events.ts:181-230); verified in happy-path test (admin-events.test.ts:158-191).
- Invite token generation uses randomBytes(32).toString('base64url') and tests assert base64url charset and 43-char length (admin-events.ts:178; admin-events.test.ts:154-157).
- Frontend route exports both Route and NewEventWizard, and anonymous redirect uses window.location.assign('/api/auth/google') (admin.events.new.tsx:141-145, 530-545).
- AbortController is aborted on unmount via effect cleanup (admin.events.new.tsx:146-150).

## Warnings

None.
