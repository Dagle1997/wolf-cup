# Codex Review

- Generated: 2026-05-01T12:29:13.140Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/T5-5-cross-group-stroke-play-leaderboard-v1-party-review.md, _bmad-output/reviews/T5-5-cross-group-stroke-play-leaderboard-v1-impl-codex-rerun.md, apps/tournament-api/src/services/leaderboard.ts, apps/tournament-api/src/routes/events-leaderboard.ts, _bmad-output/implementation-artifacts/tournament/T5-5-cross-group-stroke-play-leaderboard-v1.md

## Summary

Party-review’s “APPLIED iteration 2” items (service defense-in-depth round∈event join, `round_states` PK-invariant note, and tenant-scoped `fetchRoundSummary` joins) are present in the current code. The main drift is around AC-4 unknown-event status semantics: the party review (and impl-codex rerun) state the implementation returns 403 via middleware and that the handler’s 404 branch is effectively unreachable/deferred; however, the route file still contains a 404 existence-check branch and comments claiming it returns 404 “for trip-day clarity,” leaving code/comments/spec/party-review inconsistent and setting up a future privacy/regression footgun if middleware order changes.

Overall risk: medium

## Findings

1. [medium] AC-4 unknown-event semantics are inconsistent; handler contains a 404 branch and comment that likely never executes (middleware runs first)
   - File: apps/tournament-api/src/routes/events-leaderboard.ts:47-75
   - Confidence: high
   - Why it matters: The route is mounted with `requireEventParticipant` before the handler (lines 47–51). If that middleware returns 403 for unknown events (as the party review and prior codex rerun state), the handler’s “confirm the event exists” query and `event_not_found` 404 response (lines 64–75) will be unreachable in practice. This creates a contract mismatch across (a) spec AC-4 (“unknown event id → 404”), (b) party review (“impl returns 403; followup T5-5f”), and (c) code comment (“we return 404 here”). It’s also a privacy footgun: if middleware order changes later, this code would start leaking event existence via 404 vs 403 without an intentional decision, and tests/spec may no longer match behavior.
   - Suggested fix: Pick and enforce one contract:
- Privacy-preserving 403: remove the existence-check block (or gate it so it only runs when middleware can pass) and update the comment/spec to say unknown events return 403.
- True 404 on unknown events: move the existence check ahead of `requireEventParticipant` (or enhance middleware to distinguish unknown vs non-participant), then update integration tests + spec accordingly.
Also align inline comments with the chosen behavior to avoid future regressions.

## Strengths

- Iteration-2 service defense-in-depth join is present: round scope verifies `rounds.id = opts.roundId` AND `eventRounds.eventId = eventId` with tenant scoping before proceeding (apps/tournament-api/src/services/leaderboard.ts:135–155).
- `round_states.round_id` PK-invariant / history-migration hazard is documented inline where it matters (apps/tournament-api/src/routes/events-leaderboard.ts:162–170).
- `fetchRoundSummary` uses tenant filters on the joined tables inside the LEFT JOIN predicates, preserving left-join semantics while preventing cross-tenant matches (apps/tournament-api/src/routes/events-leaderboard.ts:220–247).

## Warnings

None.
