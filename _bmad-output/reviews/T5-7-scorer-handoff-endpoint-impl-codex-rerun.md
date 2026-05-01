# Codex Review

- Generated: 2026-05-01T13:13:52.285Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/scorer-assignments.ts, apps/tournament-api/src/routes/scorer-assignments.integration.test.ts, apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx, apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx

## Summary

Organizer-vs-scorer path selection in the API handler is now correctly organizer-preferred (organizer-path always used when caller is event organizer). The stale-queue banner is now only rendered in the read-only branch as intended, and the new web AC-8 test plausibly proves the post-200 invalidate→refetch→read-only transition.

The main remaining concern is test strength: the new API integration test (o) does not actually exercise the previously-broken “organizer-also-scorer chooses narrowed scorer-path under contention” failure mode, so it would not have failed before the fix. There’s also some existing web test mocking that returns a single `Response` for multiple fetches, which can cause course-query errors (body already consumed) and reduce confidence / create flakiness as the route makes multiple requests.

Overall risk: medium

## Findings

1. [medium] New API test (o) does not actually protect the organizer-also-scorer contention fix (would likely pass even with the old bug)
   - File: apps/tournament-api/src/routes/scorer-assignments.integration.test.ts:635-658
   - Confidence: high
   - Why it matters: The prior High issue was specifically about path selection when the caller is BOTH organizer and current scorer: choosing the narrowed scorer-path can cause the organizer’s transfer to fail (0 rows updated) if a concurrent transfer changes `scorer_player_id` between the in-tx read and the update. Test (o) only sets `scorer_player_id` to the organizer and then performs a normal transfer with no concurrent writer. In that no-contention scenario, both the old (buggy) scorer-path and the fixed organizer-path would successfully update 1 row, so this test would not fail on regression.

As a result, the suite currently doesn’t lock in the key behavioral guarantee that motivated the fix: organizer override must not be denied by the TOCTOU-narrowing predicate when organizer authority applies.
   - Suggested fix: Strengthen the regression test to force a situation where the narrowed predicate would update 0 rows while organizer-path would still succeed. Options (in increasing complexity):
- Factor the WHERE-clause/path selection into a pure helper and unit-test that `isEventOrganizer === true` omits `scorer_player_id = :fromPlayerId`.
- Use two libsql clients (separate connections) against the shared in-memory DB (`file::memory:?cache=shared`) and coordinate so one connection changes the scorer assignment after the organizer-scorer transaction reads `fromPlayerId` but before it updates. (If Drizzle’s transaction starts `BEGIN IMMEDIATE` and blocks concurrency, you may need a different transaction mode or a lower-level SQL transaction for the test.)
- If concurrency is truly impractical, explicitly document in the test name/comment that it only asserts non-contended success, and add a separate test that inspects the generated SQL or the chosen branch via instrumentation.

2. [low] Some ScoreEntryRoute tests still mock `fetch` with a single reusable `Response`, but the route performs multiple GETs (detail + course); this can produce course-query errors and mask behavior
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx:252-343
   - Confidence: medium
   - Why it matters: `ScoreEntryRoute` issues at least two GETs in normal scorer flow: `/api/rounds/:roundId` and `/api/events/:eventId/rounds/:roundId/course` (see route code). Several tests use `vi.mocked(fetch).mockResolvedValue(jsonOk(buildHappyPathDetail()))` (e.g., around lines 252+). That returns the *same* `Response` instance for every call, and `Response.json()` consumes the body stream; the second consumer (often the course fetch) can fail with “body used already”, pushing the course query into an error state.

This can reduce test fidelity (course query unintentionally failing) and can hide real issues because the component may proceed with `course=null` in tests even though production would have course data.
   - Suggested fix: Prefer URL-based `mockImplementation` that returns a *fresh* `Response` per call and returns an actual course shape for `/course` requests (as your new `mockFetchByUrl` helper already does). Consider updating older tests to use `mockFetchByUrl({ detail, course })` for consistency and to avoid accidental multi-fetch artifacts.

## Strengths

- API handler path selection now clearly enforces organizer precedence via `useOrganizerPath = isEventOrganizer` and is well-documented in-code (apps/tournament-api/src/routes/scorer-assignments.ts:282–310).
- Web fix correctly scopes the stale-queue banner to the `!isScorer` read-only branch (apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:407–423), eliminating the previously-identified false-positive risk for active scorers.
- New web AC-8 test drives a quick post-transfer transition by relying on react-query invalidation rather than the 15s polling interval (apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx:672–714), which is the right signal for “invalidate → refetch → re-render”.

## Warnings

None.
