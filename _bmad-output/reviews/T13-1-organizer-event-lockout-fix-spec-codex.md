# Codex Review

- Generated: 2026-05-22T20:24:27.401Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T13-1-organizer-event-lockout-fix.md

## Summary

Only an implementation artifact (_bmad-output/…/T13-1-organizer-event-lockout-fix.md) was provided; no code diffs or source files were included, so I cannot verify the actual middleware change, route mounting, or tests. Based on the plan/ACs described in the artifact, the approach (organizer exemption in requireEventParticipant while still verifying event existence in-tenant, plus an organizer-only Manage link) addresses the reported login trap, but there are a couple of concrete security/authorization edge cases and test gaps that should be explicitly covered to avoid over-broad access and tenant boundary leaks.

Overall risk: medium

## Findings

1. [high] Potential authorization broadening: global `player.isOrganizer` exemption may allow access to participant routes for any event unless tenant + event scoping is enforced
   - File: _bmad-output/implementation-artifacts/tournament/T13-1-organizer-event-lockout-fix.md:31-36
   - Confidence: medium
   - Why it matters: The story explicitly chooses to exempt the GLOBAL `player.isOrganizer` flag (lines 31–36). If `isOrganizer` is not strictly tenant-scoped (or if the existence lookup is not constrained by `tenantId`), an organizer session could gain participant-level read access to events they do not organize and/or events in other tenants. Even if that matches today’s admin model, it is still an access expansion for participant routes (which may expose participant-only data) and is worth explicitly constraining and testing to prevent accidental cross-tenant disclosure.
   - Suggested fix: In the organizer branch, ensure the existence check filters by BOTH `events.id == eventId` AND `events.tenantId == c.get('tenantId')` (or equivalent in your stack), and add a test case: organizer + event that exists in a different tenant → 403 `not_event_participant` (no-existence-leak preserved across tenants). If possible, also consider checking `events.organizer_player_id == player.id` if/when event-specific scoping becomes required, but at minimum enforce tenant scope now.

2. [medium] AC-2 test matrix omits the critical “event exists but in a different tenant” no-existence-leak scenario
   - File: _bmad-output/implementation-artifacts/tournament/T13-1-organizer-event-lockout-fix.md:47-56
   - Confidence: high
   - Why it matters: AC-1/AC-2 specify “exists in the tenant” (lines 47–52) but the enumerated four middleware tests (line 55) don’t include a cross-tenant existence case. Since the organizer branch adds a new existence lookup, this is exactly where a missing tenant filter would silently ship and become a cross-tenant info leak.
   - Suggested fix: Extend AC-2 (or add AC-2e) to include: (e) organizer + eventId that exists in another tenant → 403 `not_event_participant`; and ideally (f) non-organizer + membership in another tenant should not pass either (depending on how memberships are keyed).

3. [medium] AC-3 integration assertion should prove the middleware chokepoint actually guards the affected endpoint/route; current text is non-specific and could miss the real trap path
   - File: _bmad-output/implementation-artifacts/tournament/T13-1-organizer-event-lockout-fix.md:17-24
   - Confidence: medium
   - Why it matters: The incident chain claims the event-home hits an event-detail endpoint mounted with `requireEventParticipant` (line 18), and that fixing the middleware fixes all participant-facing event routes (line 24). Without seeing code, there’s risk the integration test might target a different endpoint than the one that caused the lockout (e.g., leaderboard vs. the exact “event detail used by events.$eventId.index”). If the trap involves a specific loader/data endpoint, the integration test should cover that exact path to prevent regressions.
   - Suggested fix: Make AC-3 name the exact HTTP route/path that `events.$eventId.index.tsx` calls (the event-detail endpoint) and assert organizer-without-membership gets 2xx on that endpoint specifically. Keep the generic “any gated route” as secondary coverage.

4. [low] Client-side organizer-only “Manage event” link relies on session flag; ensure server-side admin route remains the authority
   - File: _bmad-output/implementation-artifacts/tournament/T13-1-organizer-event-lockout-fix.md:37-39
   - Confidence: low
   - Why it matters: The plan gates the link on `session.player.isOrganizer` (lines 37–39). That’s fine for UI, but it’s not an auth control. If the admin route is ever loosened or misconfigured, the link could become a path to privileged UI for non-organizers. This is a minor risk assuming `requireOrganizer` remains on the admin routes.
   - Suggested fix: Confirm (in code/tests) that `/admin/events/:eventId` is protected by `requireOrganizer` server-side and add/keep an integration test that a non-organizer gets 403 on that admin endpoint regardless of link visibility.

## Strengths

- Fix is correctly targeted at a single middleware chokepoint (`requireEventParticipant`), which (if truly used broadly) minimizes drift across routes (artifact lines 24, 79–80).
- Explicitly preserves the no-existence-leak invariant by returning 403 for nonexistent eventIds even for organizers (lines 31–33, 47–52).
- Acceptance criteria include both unit-level middleware coverage (AC-2) and an integration-level assertion (AC-3), which is the right shape for preventing recurrence.
- Path footprint is explicitly constrained to tournament-only allowed directories, with no forbidden areas listed (lines 28–30, 95–103).

## Warnings

None.
