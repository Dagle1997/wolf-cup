# Codex Review

- Generated: 2026-05-22T21:01:00.252Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/middleware/require-event-participant.ts, apps/tournament-api/src/middleware/require-event-participant.test.ts, apps/tournament-api/src/routes/events.integration.test.ts, apps/tournament-web/src/routes/events.$eventId.index.test.tsx

## Summary

(1) Yes — the strengthened middleware test now actually guards the `events.id = :eventId` conjunct. In `require-event-participant.test.ts` the new case “403 for the organizer of a DIFFERENT event” (lines 266-287) authenticates as `eventB.organizerId` but requests `eventA.eventId`. If the organizer exemption query were regressed to drop `eq(events.id, eventId)`, the fallback organizer lookup would still match *event B’s* row on `organizerPlayerId` (+ tenant) and incorrectly allow access to event A; this test would then fail (would return 200 instead of asserted 403). 

(2) Yes — the organizer exemption logic is event-specific and tenant-scoped in `require-event-participant.ts`. The normal participant check is tenant-scoped on both joined tables (lines 74-88). The organizer fallback is explicitly constrained by `events.id = eventId`, `events.organizer_player_id = player.id`, and `events.tenant_id = TENANT_ID` (lines 100-110). It also does not consult `player.isOrganizer`, so a “global organizer flag” alone does not grant access; only being the organizer *of this event* does. The added tests also cover (a) foreign-tenant event row → 403 and (b) nonexistent event → 403 (test file lines 289-344), preserving the no-existence-leak posture.

(3) No new concrete issues detected in the provided diff/content. The additional API integration test for GET /api/events/:eventId (events.integration.test.ts lines 220-231) further confirms the exemption is keyed on `events.organizer_player_id` (since the mocked session player is `isOrganizer:false`). The tournament-web test additions are contained to tests and appear consistent with the expected route (`/admin/events/$eventId`).

(4) Allowlist confirmed: all touched files are under `apps/tournament-api/**` and `apps/tournament-web/**`.

Overall risk: low

## Findings

No concrete findings were identified from the supplied evidence.

## Strengths

- The revised organizer-of-different-event test meaningfully prevents a specific high-impact regression (dropping `events.id = :eventId` in the organizer exemption query).
- Organizer exemption query is explicitly constrained by both event id and tenant id, and tests cover foreign-tenant and nonexistent-event cases to maintain no-existence-leak behavior.
- Integration test proves the exemption does not depend on the global `players.is_organizer` flag by succeeding with `isOrganizer:false` in the session mock.

## Warnings

None.
