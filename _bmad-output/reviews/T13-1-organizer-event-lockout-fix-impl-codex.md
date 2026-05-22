# Codex Review

- Generated: 2026-05-22T20:58:56.730Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/middleware/require-event-participant.ts, apps/tournament-api/src/middleware/require-event-participant.test.ts, apps/tournament-api/src/routes/events.integration.test.ts, apps/tournament-web/src/routes/events.$eventId.index.test.tsx, _bmad-output/implementation-artifacts/tournament/T13-1-organizer-event-lockout-fix.md

## Summary

T13-1 organizer exemption is implemented in the right chokepoint (`requireEventParticipant`) and the authorization predicate is correctly event-specific and tenant-scoped. The new integration test also demonstrates the exemption does not rely on the global `player.isOrganizer` flag. Main gap: one of the new unit tests intended to prove “organizer of a different event can’t access this event” doesn’t actually create a different event organized by that player, so it wouldn’t catch a regression where the `events.id = :eventId` conjunct is accidentally removed.

Overall risk: low

## Findings

1. [medium] Middleware test for “global organizer but not this event” doesn’t prove organizer-of-other-event cannot bypass (would miss missing `events.id = eventId` conjunct regression)
   - File: apps/tournament-api/src/middleware/require-event-participant.test.ts:266-289
   - Confidence: high
   - Why it matters: AC intent is to prove the exemption is scoped to *this* event’s organizer, not “any event organizer” or “any global organizer.” The current test sets `isOrganizer: true` on the requesting player, but does not create any `events` row where `events.organizer_player_id = globalOrgId`. If a future regression accidentally changes the organizer lookup to something like `WHERE organizer_player_id = :playerId AND tenant_id = :TENANT_ID` (omitting `events.id = :eventId`), this test would still return 403 (because `globalOrgId` organizes no events) and would not detect the authorization broadening.
   - Suggested fix: Strengthen the test by seeding a second event where `organizer_player_id = globalOrgId` (in the same tenant), then request the *original* eventId and assert 403. Similarly, you can strengthen the nonexistent-event test by seeding an unrelated event organized by the requester and still asserting 403 for a random/nonexistent `eventId`.

2. [low] AC-6 (sprint-status flip) not evidenced in this diff
   - File: _bmad-output/implementation-artifacts/tournament/T13-1-organizer-event-lockout-fix.md:68-69
   - Confidence: high
   - Why it matters: The story’s AC-6 calls out an atomic sprint-status update. This diff shows only changes under `apps/tournament-api/**` and `apps/tournament-web/**`; no sprint-status YAML change is present, so AC-6 is either unmet or handled outside the provided diff.
   - Suggested fix: If AC-6 is still required for this story, include the sprint-status YAML update in the same change set; otherwise, explicitly drop/adjust AC-6 in the story to match the intended allowlist/scope.

## Strengths

- Authorization logic matches the requested predicate: `events.id = :eventId AND events.organizer_player_id = :playerId AND events.tenant_id = TENANT_ID` (apps/tournament-api/src/middleware/require-event-participant.ts:100-110), so it grants ONLY the organizer of THAT event, and tenant scoping is present to preserve 403 on foreign-tenant/nonexistent events.
- No over-broadening via the global organizer flag: the middleware does not consult `player.isOrganizer` at all; it keys solely off `events.organizer_player_id` (require-event-participant.ts:104-109).
- Organizer lookup runs only on the non-member path (`rows.length === 0`), preserving the existing “member passes” fast path unchanged (require-event-participant.ts:91-114).
- Test coverage is directionally good: unit tests cover organizer pass, foreign-tenant organizer lookup 403, nonexistent event 403; and the integration test proves the real trap endpoint (`GET /api/events/:eventId`) now returns 200 for the event organizer even when `isOrganizer:false` (apps/tournament-api/src/routes/events.integration.test.ts:220-231).
- Web render tests assert the organizer-only admin link presence/absence while keeping the component unchanged, aligning with the note that API 403 was previously short-circuiting the page render (apps/tournament-web/src/routes/events.$eventId.index.test.tsx:152-180).
- No forbidden-path changes observed (diff only touches `apps/tournament-api/**` and `apps/tournament-web/**`).

## Warnings

None.
