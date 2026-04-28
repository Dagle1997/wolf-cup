# Codex Review

- Generated: 2026-04-28T19:24:49.962Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/scores.ts, apps/tournament-api/src/routes/scores.course.test.ts, apps/tournament-api/src/app.ts, apps/tournament-web/src/lib/round-cache.ts, apps/tournament-web/src/lib/round-cache.test.ts, apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx, apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx, apps/tournament-web/PORTS.md

## Summary

Core functionality is in place (new /api/events/:eventId/rounds/:roundId/course endpoint + IDB cache-aside + banner + integration tests). The cache-aside read-before-write ordering for the banner is implemented correctly in the frontend. Main concerns are (1) backend correctness/security edge cases in the course endpoint around event-round consistency and param validation ordering, and (2) a frontend runtime-type mismatch where offline/no-cache throws a TypeError but the UI assumes ApiError, yielding confusing output.

Overall risk: medium

## Findings

1. [high] Course endpoint does not verify eventRounds belongs to the requested eventId (possible cross-event course leakage within tenant if data integrity is off)
   - File: apps/tournament-api/src/routes/scores.ts:688-701
   - Confidence: high
   - Why it matters: The handler verifies `round.eventId === :eventId` (lines 662-677) but then loads `eventRounds` solely by `eventRounds.id === round.eventRoundId` (lines 689-701) without also asserting `eventRounds.eventId === eventId`. If `round.eventRoundId` ever points at an event_round from a different event (buggy seed/migration, manual DB edit, or partial corruption), the endpoint can return a course revision for the wrong event while still passing requireEventParticipant for the requested event. That’s a correctness bug and a potential information leak across events (even if tenant-scoped).
   - Suggested fix: Add `eq(eventRounds.eventId, eventId)` to the `eventRounds` WHERE clause, and consider returning `course_not_found` (or `round_not_found`) when the chain breaks. Add a backend test that seeds a round with `eventId=A` but `eventRoundId` pointing to an `eventRounds` row with `eventId=B` and assert 404.

2. [medium] invalid_event_id validation occurs after requireEventParticipant middleware; may never return the documented 400 and may cause unexpected middleware behavior
   - File: apps/tournament-api/src/routes/scores.ts:640-661
   - Confidence: high
   - Why it matters: The route runs `requireSession` → `requireEventParticipant` before checking `UUID_RE` for `eventId` (lines 640-660). If a client calls `/api/events/not-a-uuid/rounds/.../course`, the middleware will run first and may (a) do DB work with an unvalidated string, (b) return a different status (commonly 404/403), or (c) throw if it assumes UUID formatting. This undermines the endpoint’s own 400 `invalid_event_id` contract (and you currently only test invalid_round_id, not invalid_event_id).
   - Suggested fix: Move param validation ahead of `requireEventParticipant` (e.g., a small inline middleware that validates `eventId`/`roundId` and returns 400), or ensure `requireEventParticipant` itself validates/parses `eventId` safely. Add a backend test for `400 invalid_event_id`.

3. [medium] Frontend can throw TypeError (offline+no-cache) but UI assumes ApiError; renders confusing “status undefined”
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:167-373
   - Confidence: high
   - Why it matters: `fetchOrCacheRoundDetail` deliberately throws a `TypeError` when `navigator.onLine===false` and the cache is empty (lines 171-180). The component types `error` as `ApiError` and renders based on `error.status` (lines 350-369). With a TypeError, `error.status` is `undefined`, so the UI falls into the generic branch and displays "Couldn't load round (status undefined)." That’s likely not an intended offline-first UX and can make debugging/support harder.
   - Suggested fix: Either (a) normalize network/offline errors into an `ApiError`-like shape (e.g., `{status: 0, code: 'offline_no_cache'}`) or (b) add a runtime guard in the render path: `if (!('status' in error))` show an explicit offline/no-cache message. Add a test for offline+no-cache behavior if it’s an AC.

4. [low] Missing backend test coverage for eventId/roundId mismatch (same tenant) and invalid_event_id path
   - File: apps/tournament-api/src/routes/scores.course.test.ts:273-358
   - Confidence: high
   - Why it matters: Current tests cover happy paths, invalid_round_id, no session, and foreign-tenant 404. They don’t cover (1) `invalid_event_id` and (2) eventId/roundId mismatch within tenant (round exists but belongs to a different event) which is explicitly handled in code (scores.ts lines 662-677). These are exactly the kinds of edge cases that regress when middleware ordering or obfuscation rules change.
   - Suggested fix: Add tests: (a) `/api/events/not-a-uuid/...` → 400 invalid_event_id (after you fix middleware ordering), and (b) seed two events in same tenant and call course endpoint with eventId A and roundId from event B → 404 round_not_found.

## Strengths

- Frontend cache-aside implementation for course reads cache BEFORE writing fresh and compares hashes before overwrite (load-bearing for the banner); integration test covers this behavior.
- Course query `enabled: eventId !== null` gating is correct given the detail query provides eventId; `eventId!` is safe under that condition.
- Network-vs-HTTP error separation is mostly sound: fetch helpers throw structured `{status}` errors for HTTP failures and allow network TypeErrors to fall through to cache.
- Backend course endpoint consistently applies tenant predicates on all SELECTs shown (rounds, eventRounds, courseRevisions, courses, courseHoles, courseTees).
- IDB cache library is small, uses overwrite-on-write semantics (good for cache-aside), and includes test-only connection reset to avoid deleteDatabase blocking.

## Warnings

None.
