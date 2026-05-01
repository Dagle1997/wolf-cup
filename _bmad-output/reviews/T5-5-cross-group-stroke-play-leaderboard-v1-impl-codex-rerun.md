# Codex Review

- Generated: 2026-05-01T12:25:01.837Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/handicap.ts, apps/tournament-api/src/services/leaderboard.ts, apps/tournament-api/src/services/leaderboard.test.ts, apps/tournament-api/src/services/index.ts, apps/tournament-api/src/routes/events-leaderboard.ts, apps/tournament-api/src/routes/events-leaderboard.integration.test.ts, apps/tournament-api/src/app.ts, apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx, _bmad-output/implementation-artifacts/tournament/T5-5-cross-group-stroke-play-leaderboard-v1.md

## Summary

Re-review of T5-5 after mechanical fixes: the new defense-in-depth join in `computeLeaderboard` correctly enforces (round ∈ event) and is tenant-scoped; the tenant filters added to `fetchRoundSummary` preserve left-join semantics and close the prior join-scoping gap. The `round_states` PK invariant note is accurate and clearly flags the future migration hazard. Remaining issues are mostly around a now-inconsistent/likely-unreachable 404 branch and a small UI empty-state mismatch.

Overall risk: low

## Findings

1. [medium] `event_not_found` 404 branch appears unreachable (middleware returns 403 first) and handler comment contradicts integration test behavior
   - File: apps/tournament-api/src/routes/events-leaderboard.ts:64-75
   - Confidence: high
   - Why it matters: The handler asserts it returns 404 when the event doesn’t resolve, but the route is mounted with `requireEventParticipant` ahead of the handler, and the integration test locks in 403 for unknown event IDs. This makes the 404 branch misleading at best and potentially dead code. It increases the chance of future regressions/spec confusion (e.g., someone relying on 404 here, or reordering middleware later and unintentionally changing the privacy posture).
   - Suggested fix: Decide on the contract and align code + comments + frontend: (a) privacy-preserving: remove the existence check (or change it to only run when middleware can pass) and update the comment to reflect 403-on-unknown; or (b) if you truly want 404 for unknown event, you must check existence before `requireEventParticipant` (or adjust the middleware to distinguish unknown vs not-a-participant) and update the integration test accordingly.

2. [low] Leaderboard page shows “No participants yet.” when API returns empty rows for “no rounds yet” (participants may still exist)
   - File: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx:212-216
   - Confidence: high
   - Why it matters: For `round=current` when an event has zero rounds, the API intentionally returns `rows: []` (integration test seeds participants but no rounds). The UI uses `rows.length === 0` to render “No participants yet.”, which is misleading in that scenario (you can end up showing both “No rounds yet.” and “No participants yet.”).
   - Suggested fix: Special-case the empty-rows message based on scope/round: e.g., if `data.scope === 'round' && data.round === null`, omit the “No participants yet.” message (or replace with “No rounds yet.” only / “Leaderboard unavailable until rounds are created.”). Alternatively, change the API to return participant rows even when there are zero rounds, but that would diverge from the current locked-in test/spec behavior.

## Strengths

- `computeLeaderboard` round-scope now correctly joins `event_rounds` and filters by `eventRounds.eventId` + tenant, preventing cross-event roundId leakage even if callers bypass the route guard (services/leaderboard.ts:141–155).
- `fetchRoundSummary` now scopes tenant constraints into the left-join predicates for `eventRounds` and `roundStates`, preserving left-join semantics while preventing cross-tenant accidental matches (routes/events-leaderboard.ts:233–246).
- The `round_states.round_id` PK invariant is documented directly where the assumption matters, with explicit guidance on what must change if the table becomes historical (routes/events-leaderboard.ts:162–170).
- Good test coverage for ranking semantics, round=current resolution, cross-event round queries, and fresh-after-commit propagation; overall regression risk is reduced.

## Warnings

None.
