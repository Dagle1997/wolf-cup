# Codex Review

- Generated: 2026-05-05T14:05:02.076Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T7-5-raw-state-json-export-organizer-only.md

## Summary

Spec is mostly coherent and stays within the tournament-only path allowlist (apps/tournament-api/** + artifacts). However, several areas are underspecified or internally inconsistent in ways that can break ACs or the “self-contained writable state” goal: (1) auth/error-code behavior likely depends on requireOrganizer internals, (2) audit_log scoping is incomplete and the proposed Drizzle filter is not actually “correctness ensuring”, and (3) computeMoneyMatrix viewerPlayerId choice may be invalid when organizers are not participants (a spec-stated requirement).

Overall risk: medium

## Findings

1. [medium] Auth chain vs expected 404 is ambiguous; requireOrganizer may preempt route-level 404 and/or still require participation
   - File: _bmad-output/implementation-artifacts/tournament/T7-5-raw-state-json-export-organizer-only.md:21-214
   - Confidence: medium
   - Why it matters: The spec requires requireSession → requireOrganizer and explicitly omits requireEventParticipant (lines 21-24), and AC-6 requires 404 for non-existent events (lines 211-214). But in many codebases, “requireOrganizer” is implemented by loading the event and checking organizer membership; it may return 404/403 itself, or it may implicitly require the caller to be an event participant to establish organizer-ness. If requireOrganizer runs before buildEventExport and returns (for example) 403 for unknown events or for non-participating organizers, AC-6 and the story intent (“organizer not playing can still export”) will fail even if buildEventExport is correct.
   - Suggested fix: Specify (and enforce in tests) the exact behavior of requireOrganizer for: (a) event does not exist, (b) organizer but not a participant, (c) organizerPlayerId is null/absent. If current middleware can’t support this, either (1) change the chain to a middleware that only checks organizer-by-eventId without participant requirement and defers not-found handling to the route, or (2) update AC-6 to match actual middleware behavior and explicitly justify existence-leak posture for organizers.

2. [medium] audit_log filtering allowlist likely incomplete relative to “all event-scoped writable state” and exported tables
   - File: _bmad-output/implementation-artifacts/tournament/T7-5-raw-state-json-export-organizer-only.md:13-249
   - Confidence: medium
   - Why it matters: The export includes many domain tables (line 14), and also includes auditLog (lines 48-60, 172). But the audit entityType allowlist enumerates only: event, round, hole_score, bet, sub_game, gallery_photo, rule_set (lines 50-57). If your system writes audits for other exported/writable entities (groups, group_members, invites, pairings, score_corrections, scorer_assignments, round_states, team_press_log, course/course_revision, etc.), those audit rows will be silently omitted, undermining the “self-contained JSON dump of all writable state” story goal and making third-party verification/forensics incomplete. The spec itself calls out missing future entityTypes (lines 248-250), but AC-9(f) only tests “seed audit rows for THIS event AND unrelated event” (lines 235-236) and does not mandate coverage across all entity types that exist today.
   - Suggested fix: Either (A) redefine scope: explicitly state auditLog is “best-effort for specific entity types” and not part of the ‘all writable state’ guarantee, or (B) expand the entityType list to cover all entity types that can occur for the exported tables today, and require AC-9(f) to seed one row per supported entityType and assert inclusion. Also clarify whether entityType names match table names (e.g., is it 'rule_set_revision' vs 'rule_set'?).

3. [low] Proposed Drizzle filter (inArray on entityId AND inArray on entityType) does not guarantee correct (entity_type, entity_id) pairing
   - File: _bmad-output/implementation-artifacts/tournament/T7-5-raw-state-json-export-organizer-only.md:50-61
   - Confidence: high
   - Why it matters: The spec says the two-filter approach “ensures correctness” (line 60), but logically it only restricts to allowed types and allowed IDs independently; it does not enforce that an ID belongs to the given type. If IDs are UUIDs, collisions are extremely unlikely, but the statement is still incorrect, and the approach can over-include rows if IDs ever collide (including non-random UUID usage, copied fixtures, or a future migration changing ID format).
   - Suggested fix: If Drizzle doesn’t support tuple IN, implement an OR-of-ANDs per type: (entity_type='round' AND entity_id IN roundIds) OR (entity_type='hole_score' AND entity_id IN holeScoreIds) ... This is both correct and documents intended scoping.

4. [medium] moneyMatrix viewerPlayerId choice may be invalid when organizer is not a participant (a stated requirement)
   - File: _bmad-output/implementation-artifacts/tournament/T7-5-raw-state-json-export-organizer-only.md:72-85
   - Confidence: medium
   - Why it matters: The spec explicitly supports “an organizer running an event they're not playing in” (line 23). But moneyMatrix computation passes viewerPlayerId = event.organizerPlayerId (line 75). If computeMoneyMatrix assumes viewerPlayerId is a participant (common for visibility/authorization logic), exports for non-playing organizers could fail or produce a matrix with different redactions than intended. Additionally, the spec assumes organizer view is the canonical superset for participant/self_only modes (lines 82-83), which may not hold if the visibility model is based on per-player relationships rather than organizer role, or if organizerPlayerId is null/undefined for some events.
   - Suggested fix: Specify and test one of: (A) computeMoneyMatrix must accept an organizer viewer even if not a participant (and how it determines organizer privileges), (B) choose a deterministic participant viewerId from exported roster (e.g., first organizer-who-is-participant, else first participant) strictly for computation, while still exporting the full canonical matrix, or (C) extend computeMoneyMatrix API to accept an explicit “isOrganizerView: true”/capabilities object rather than a viewerPlayerId.

5. [medium] Round-trip FK integrity may fail if event rows reference tenant/context tables not included in export
   - File: _bmad-output/implementation-artifacts/tournament/T7-5-raw-state-json-export-organizer-only.md:29-194
   - Confidence: medium
   - Why it matters: AC-4 requires that replaying the export into a fresh DB does not fail any FK constraint (lines 189-194). The export includes tenantId/contextId fields in the top-level event object (line 143) and buildEventExport takes a tenantId (line 31), but the spec does not include any tenant/context tables in the raw dump list (line 14). If the tournament schema enforces FKs from events.*tenant_id/context_id* to tenant/context tables, the “fresh DB → re-insert” helper will fail unless the helper seeds those infra rows or the export includes them. AC-4 currently only mentions excluding auth tables (line 193), not tenant/context infra.
   - Suggested fix: Clarify whether tenant/context are FK-enforced in tournament-api DB. If yes, either (1) include the minimal required infra rows in the export (still ‘event-scoped’ enough for replay), or (2) mandate the test helper seeds required tenant/context rows before reinsertion and explicitly list these as permitted non-event-scoped prerequisites in AC-4.

## Strengths

- Path footprint is explicitly constrained to tournament-only files and avoids Wolf Cup / shared files (lines 100-114, 240-243).
- Clear ACs for headers, filename slug behavior, and timezone-derived YYYYMMDD (lines 128-133, 221-226).
- Good explicit type-discipline requirements (ISO timestamps, integer cents, parsed JSON blobs) and round-trip parity requirement for moneyMatrix (lines 178-200).
- Service/route split is test-friendly and aligns with the stated architecture constraint (lines 25-43).
- Explicitly calls out memory/streaming as deferred follow-up and bounds v1 payload size (lines 19-20, 244-247).

## Warnings

None.
