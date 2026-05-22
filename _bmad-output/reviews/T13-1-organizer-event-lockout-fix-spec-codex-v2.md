# Codex Review

- Generated: 2026-05-22T20:50:58.681Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T13-1-organizer-event-lockout-fix.md

## Summary

The prior High (over-broad access from exempting the GLOBAL `player.isOrganizer` flag) appears resolved in this spec revision: the exemption is explicitly event-scoped via `events.organizer_player_id === player.id`, and AC-2 includes the distinguishing negative test (global organizer but not THIS event’s organizer → 403). The spec also preserves the no-existence-leak behavior by returning the same 403 for nonexistent/foreign-tenant events, and it adds tenant-scoped test coverage for the organizer lookup.

No new Highs are clearly introduced by Option B in the spec as written. Remaining risk is mainly around ensuring the “tenant-scoped” organizer lookup is implemented with the correct predicate (so the intended security property actually holds), and acknowledging the known interim UI gating mismatch (global flag) which is not an auth boundary but can become misleading as multi-org evolves.

Overall risk: medium

## Findings

1. [medium] Tenant-scoped organizer exemption is specified, but the exact query predicate is still slightly ambiguous—easy to implement incorrectly
   - File: _bmad-output/implementation-artifacts/tournament/T13-1-organizer-event-lockout-fix.md:31-55
   - Confidence: medium
   - Why it matters: This story’s core security property is: only the organizer of *this* event in *this* tenant bypasses membership; everyone else (including other global organizers) gets the same 403 without revealing event existence. The spec repeatedly says “tenant-scoped lookup” (lines 31-33, 52-55), but it doesn’t concretely pin down the safest implementation shape. A common failure mode is: fetch `events` by `id` alone (or by `id` + tenant) and then compare `organizer_player_id` in application code, or accidentally omit tenant filtering. Any omission of tenant scoping could allow cross-tenant organizer bypass. Any split-logic could also make existence/timing differences more pronounced than necessary.
   - Suggested fix: Make the organizer exemption a single existence check with all constraints in SQL/ORM, e.g. `SELECT 1 FROM events WHERE id=:eventId AND tenant_id=:tenantId AND organizer_player_id=:playerId LIMIT 1;` and `next()` only if a row exists. Keep returning the same 403 on all failures. (Optionally, explicitly assert/mention that the existing `group_members` lookup is also tenant-scoped, if the schema includes tenanting.)

2. [low] Web “Manage event” link remains globally gated; acceptable as non-boundary, but may reintroduce a UX dead-end under multi-org without further work
   - File: _bmad-output/implementation-artifacts/tournament/T13-1-organizer-event-lockout-fix.md:37-64
   - Confidence: high
   - Why it matters: You explicitly note this is interim and not an authorization boundary (lines 37-39). Still, as soon as the product moves toward multi-organizer where the global flag may be absent or not aligned, legitimate per-event organizers could again lack a UI path to admin—even though they can now view the event. This is not a current security bug per the spec, but it is a likely UX regression once multi-org begins.
   - Suggested fix: Add a follow-up item (or an explicit non-goal/assumption) that when multi-org work lands, the UI gate should switch to an event-specific signal (e.g., event-detail response includes `isEventOrganizer`, or compare `event.organizer_player_id` to session player id).

## Strengths

- Correctly addresses the prior High by avoiding the GLOBAL `isOrganizer` exemption and instead using `events.organizer_player_id` (event-specific) (lines 31-35, 47-55).
- Preserves the no-existence-leak invariant by using the same 403 for nonexistent and foreign-tenant events (lines 31-33, 52-55).
- Acceptance Criteria add the key distinguishing negative test: global organizer but not this event’s organizer → 403 (lines 50, 54-56).
- Test plan covers cross-tenant organizer row and nonexistent event cases, which are exactly where scoping bugs tend to hide (line 55).
- Keeps the membership query first, preserving current behavior/performance on the common path (lines 31-33, 72-73).

## Warnings

None.
