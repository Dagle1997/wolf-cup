# Codex Review

- Generated: 2026-05-01T12:20:42.186Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/handicap.ts, apps/tournament-api/src/services/handicap.test.ts, apps/tournament-api/src/services/leaderboard.ts, apps/tournament-api/src/services/leaderboard.test.ts, apps/tournament-api/src/services/index.ts, apps/tournament-api/src/routes/events-leaderboard.ts, apps/tournament-api/src/routes/events-leaderboard.integration.test.ts, apps/tournament-api/src/app.ts, apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx, _bmad-output/implementation-artifacts/tournament/T5-5-cross-group-stroke-play-leaderboard-v1.md

## Summary

Implements the requested leaderboard service + route + web page with good baseline coverage (service unit fixtures, route integration, stable ordering, 1224 ranking, slope-aware net math). However there are a few correctness/security-adjacent gaps: (1) `computeLeaderboard` round-scope does not verify the round belongs to the given event (cross-event score mixing possible if called outside the route’s ownership check), (2) `round=current` resolution likely misbehaves if `round_states` is historical (it matches any past `in_progress`/`complete_editable` row), and (3) API status-code behavior for unknown events and invalid UUIDs doesn’t fully match AC-4. There’s also a tenant-scoping hole in `fetchRoundSummary` joins, and net allocation is hard-coded to 18 holes.

Overall risk: high

## Findings

1. [high] computeLeaderboard round-scope does not verify round belongs to eventId (cross-event score mixing risk)
   - File: apps/tournament-api/src/services/leaderboard.ts:132-156
   - Confidence: high
   - Why it matters: For `opts.scope === 'round'`, the service only checks `rounds.id = opts.roundId` and `rounds.tenantId` (lines 134–142). It does not constrain the round to the provided `eventId`. If `computeLeaderboard` is called from any future route/job without the route-level ownership check (or if that check regresses), a caller could pass `eventId=A` and `roundId` from `eventId=B` and the service would aggregate `hole_scores` for the other event’s round (lines 203–216) while still using the participant set for event A (lines 100–130). If player IDs overlap across events, this can incorrectly pull strokes from the wrong event into the leaderboard; even without overlap it silently produces misleading output.
   - Suggested fix: In the `scope === 'round'` branch, validate ownership by joining `rounds -> eventRounds` (or using `rounds.eventId` if authoritative) and require `eventRounds.eventId = eventId` (and tenant filters on joined tables). If ownership fails, prefer signaling not-found (e.g., throw a typed error) rather than returning `[]` so the route can return 404 consistently.

2. [high] round=current resolution likely wrong if roundStates is a history table (matches any prior state)
   - File: apps/tournament-api/src/routes/events-leaderboard.ts:152-208
   - Confidence: high
   - Why it matters: `resolveCurrentRoundId` filters by `roundStates.state = 'in_progress' | 'complete_editable'` (lines 166–179) but does not restrict to the latest state per round. If `round_states` records transitions (common for “states” tables), a round that was previously `in_progress` but is now `finalized` would still match and could be incorrectly selected as “current”. The same issue applies to `fetchRoundSummary`, which left-joins `roundStates` without choosing the most recent row (lines 218–230). Your integration tests seed exactly one state row per round, so this bug would not be caught.
   - Suggested fix: Join against a subquery/CTE that selects the latest `round_states` row per `round_id` (e.g., max `entered_at`) and use that derived current state for both current-round resolution and summary. Alternatively, if schema guarantees one row per round, document/enforce that with a uniqueness constraint and adjust inserts accordingly.

3. [medium] AC-4 status codes: unknown event and invalid event UUID handling doesn’t match stated acceptance criteria
   - File: apps/tournament-api/src/routes/events-leaderboard.ts:47-76
   - Confidence: high
   - Why it matters: AC-4 calls for 400 on bad UUID and 404 on unknown event/round. The route validates UUID format only for `round` (lines 99–104) but not for `eventId`, so malformed `eventId` will currently fall through to an `event_not_found` 404 (lines 68–75) rather than a 400. Separately, because `requireEventParticipant` runs before the handler (lines 47–51), a well-formed but unknown event will typically return 403 from middleware, not the desired 404. This mismatch is explicitly codified in the integration test (apps/tournament-api/src/routes/events-leaderboard.integration.test.ts:311–325), which contradicts the AC list in the review request.
   - Suggested fix: Decide the contract and make it consistent:
- If you want AC-4 behavior, validate `eventId` with `UUID_RE` and return 400 on invalid format; and reorder middleware so event existence is checked before `requireEventParticipant`, or update `requireEventParticipant` to distinguish “event not found” (404) vs “not a participant” (403).
- If 403-on-unknown-event is intentional for privacy, update the written AC/spec accordingly and remove the unreachable event-existence check block (lines 64–75) or move it earlier.

4. [medium] Tenant scoping gap: fetchRoundSummary joins eventRounds/roundStates without tenant filters
   - File: apps/tournament-api/src/routes/events-leaderboard.ts:210-231
   - Confidence: high
   - Why it matters: Focus area #2 requires tenant scoping on every joined table. `fetchRoundSummary` filters only `rounds.tenantId` (line 221) but left-joins `eventRounds` and `roundStates` without any tenant predicate. While UUID collisions across tenants are unlikely, the code as written violates the stated convention and can become a real issue if IDs are not globally unique or if the join conditions change.
   - Suggested fix: Add tenant constraints for joined tables, e.g. include `and(eq(rounds.id, roundId), eq(rounds.tenantId, TENANT_ID), eq(eventRounds.tenantId, TENANT_ID), eq(roundStates.tenantId, TENANT_ID))` while keeping left-join semantics (or put tenant constraints directly into the join conditions).

5. [medium] Net handicap allocation hard-codes 18 holes; will be wrong for 9-hole or non-18 formats
   - File: apps/tournament-api/src/services/handicap.ts:62-87
   - Confidence: high
   - Why it matters: `allocateNetThroughHole` uses a fixed denominator of 18 (lines 85–86). Yet both the comments and surrounding system already model `holesToPlay` (e.g., seeded rounds include `holesToPlay?: 9 | 18` in tests). If a 9-hole round is ever created (even accidentally), net allocation will be half a course handicap through 9 rather than fully allocated for that round, and event-scope net sums will be distorted. This is especially relevant because leaderboard.ts computes per-round allocation (apps/tournament-api/src/services/leaderboard.ts:254–272), so it’s already structured to support per-round `holesToPlay` correctly once plumbed.
   - Suggested fix: Change `allocateNetThroughHole` to accept `holesToPlay` (or rename to clarify it is 18-hole-only) and pass the round’s `holesToPlay` from the round context query. Add at least one fixture covering a 9-hole round once T5-5c lands (or add a guard that throws if holesToPlay !== 18 in v1 to fail loud instead of silently miscomputing).

## Strengths

- `calcCourseHandicap` correctly ports the USGA formula, includes input validation, and normalizes signed zero (apps/tournament-api/src/services/handicap.ts:40–60) with good unit coverage (handicap.test.ts).
- Leaderboard sorting + ranking match AC-2/1224 semantics, including stable secondary ordering by playerId to prevent UI flicker (apps/tournament-api/src/services/leaderboard.ts:281–322).
- Event-scope net computation is correctly per-round (separate course handicap per tee), then summed (apps/tournament-api/src/services/leaderboard.ts:254–272), aligning with AC-3’s intent.
- Route integration tests cover many important branches including cross-event round 404, round=current selection branches, and fresh-after-commit propagation (events-leaderboard.integration.test.ts).
- Web page polling interval + T-N rendering logic is implemented as requested (apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx:138–241).

## Warnings

None.
