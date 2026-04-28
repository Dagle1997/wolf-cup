# Codex Review

- Generated: 2026-04-28T19:29:30.306Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/scores.ts, apps/tournament-api/src/routes/scores.course.test.ts, apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx

## Summary

Round-1 issues are largely addressed with real behavioral changes (UUID guard before participant lookup, round.eventId URL match check, offline-no-cache UI, and new backend tests). However, the fixes introduced a couple of new/remaining correctness gaps: (1) the param guard now runs before auth, so unauthenticated requests with malformed params get 400 (not 401); (2) the frontend only handles “offline + no cache” for the round-detail query, not for the course query, so you can end up in a partially-cached offline state with silent course failure and no offline indicator; (3) the new defense-in-depth eventRounds.eventId mismatch path isn’t tested and currently returns `course_not_found` (not `round_not_found`), which may or may not match the intended contract.

Net: probably close, but I’d address the medium issues (especially the frontend partial-cache/offline behavior) before calling it ready-to-commit.

Overall risk: medium

## Findings

1. [medium] Param guard runs before requireSession: unauthenticated + malformed params return 400 instead of 401 (auth precedence changed)
   - File: apps/tournament-api/src/routes/scores.ts:669-673
   - Confidence: high
   - Why it matters: The router chain is `courseRouterParamGuard` → `requireSession` → `requireEventParticipant`. This means unauthenticated callers can receive detailed 400 error codes (`invalid_event_id` / `invalid_round_id`) rather than a uniform 401. If the API contract expects auth to be enforced before any validation responses (or you want to minimize information leakage), this is a behavior regression. Your tests only assert 401 for a well-formed request (test at scores.course.test.ts:336-344), so this edge case isn’t pinned.
   - Suggested fix: Decide the intended precedence. If 401 should win when no session, move `requireSession` before `courseRouterParamGuard` OR make `courseRouterParamGuard` defer/skip when there is no session (e.g., only run it after `requireSession` but before `requireEventParticipant`, which was the original round-1 motivation). Add a test for `GET /api/events/not-a-uuid/...` with no session to pin the desired behavior.

2. [medium] Frontend doesn’t handle courseQuery failure/offline-no-cache; can render “online” UI with missing course and no offline indicator
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:315-434
   - Confidence: high
   - Why it matters: `offline-no-cache` is only rendered when the *round-detail* query errors (lines 350-362). But the course is fetched via a second query (`courseQuery`). If the detail is cached (or loads from network) but the course fetch fails offline with no cached course, `fetchOrCacheRoundCourse` throws a `TypeError` (lines 211-218) which becomes `courseQuery.error`—and is never rendered/handled. Also, `isOffline` only flips true when `setCourseSource('cache')` runs, but on errors `setCourseSource` is never called, so the offline chip may be absent even when the device is offline and the course fetch is failing repeatedly.
   - Suggested fix: Handle `courseQuery.error` explicitly. Options: (a) if `courseQuery.error` is a non-ApiError (network/offline) and there is no cached course, show a dedicated partial-cache placeholder (or at least the offline chip + a warning that course data isn’t cached); (b) set a source flag on error paths so the offline chip reflects reality; (c) consider disabling the course query refetch interval when `navigator.onLine === false` to avoid repeated failing executions.

3. [low] Defense-in-depth event_rounds.event_id mismatch returns course_not_found and is untested (may not match intended 404 code)
   - File: apps/tournament-api/src/routes/scores.ts:705-729
   - Confidence: high
   - Why it matters: You added the eventRounds.eventId verification (`erRows[0]!.eventId !== eventId`), which blocks cross-event leakage as intended. However, on mismatch you return `{ code: 'course_not_found' }` (lines 724-728). Your review summary text claims mismatch → `round_not_found`, and there is no test covering the event_round.event_id mismatch case—only the round.event_id mismatch case is tested (scores.course.test.ts:355-383). If clients or specs distinguish these codes, this could be a contract mismatch.
   - Suggested fix: Align the code+tests+contract: either change this path to return `round_not_found` (if that’s the intended obfuscation) or update the summary/contract and add a dedicated test that forces `event_rounds.event_id` to differ from the URL `:eventId` and asserts the chosen code.

4. [low] Standalone/null event_id edge case behavior is unclear: round.eventId mismatch happens before eventRoundId-null handling
   - File: apps/tournament-api/src/routes/scores.ts:679-703
   - Confidence: medium
   - Why it matters: The handler first checks `roundRows[0]!.eventId !== eventId` (line 689) and only afterwards checks `round.eventRoundId === null` to return `course_not_found` (lines 697-702). If a v1.5 standalone round can have `round.eventId === null` (not shown here, but your prompt asks about null handling), then this endpoint will return `round_not_found` (due to mismatch) instead of `course_not_found`, contradicting the comment and potentially the intended UX.
   - Suggested fix: Clarify the actual v1.5 data shape. If standalone rounds have `eventId` null, decide the desired response and implement it explicitly (e.g., handle `round.eventId === null` separately before comparing, or document that these rounds are unreachable via the event-scoped route). Add a test for the null eventId shape if it’s possible in your DB.

## Strengths

- Backend: The round.eventId URL match check (scores.ts:679-694) is a real fix and prevents cross-event round/course access even if middleware passes for the URL’s event.
- Backend: courseRouterParamGuard correctly pins 400 invalid_event_id/invalid_round_id before participant lookup, and you added tests for invalid_event_id + cross-event round.eventId mismatch.
- Frontend: The offline-no-cache branch now correctly distinguishes non-HTTP network errors from ApiError HTTP failures and avoids the previous “status undefined” rendering.
- Frontend: Cache-aside functions avoid cache fall-through on HTTP errors (isApiError gate), which prevents masking real authorization/404 issues with stale cached data.

## Warnings

None.
