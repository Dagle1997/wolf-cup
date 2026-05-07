# Codex Review

- Generated: 2026-05-07T02:51:23.855Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/awards.ts, apps/tournament-api/src/services/awards.test.ts, apps/tournament-api/src/routes/scores.ts, apps/tournament-api/eslint.config.js, apps/tournament-web/src/hooks/use-auth-session.ts, apps/tournament-web/src/components/award-celebration.tsx, apps/tournament-web/src/components/award-celebration.test.tsx, apps/tournament-web/src/routes/__root.tsx

## Summary

Implements the T8-4 awards detection service + scores-route best-effort integration, plus a new AwardCelebration UI and an extracted auth-session hook. Backend award gating/idempotency logic matches the stated v1 trade-offs, and unit tests cover the awards service behaviors. Main issues found are (1) AwardCelebration’s “most recent eagle wins” logic actually depends on array order (can be wrong if rows/batches aren’t chronological), and (2) the critical best-effort isolation contract in scores.ts isn’t evidenced by a test in the provided changes.

Overall risk: medium

## Findings

1. [medium] AwardCelebration picks the “most recent eagle” by array order, not by time; can render the wrong eagle
   - File: apps/tournament-web/src/components/award-celebration.tsx:106-115
   - Confidence: high
   - Why it matters: The component comment/spec says “the most recent eagle is rendered” and “don’t rely on stream order,” but the implementation uses `reverse().find(...)` over `entries`, which reflects insertion order (stream batch order and `rows` iteration order), not `arrivedAt`/`createdAt`. If `rows` is newest-first (common) or the stream delivers out-of-order batches, an older eagle could incorrectly win. This is user-visible and contradicts the stated AC (#8).
   - Suggested fix: Select by timestamp, not array position. Example:
- `const mostRecentEagle = entries.filter(e => e.awardType === 'first_eagle_of_event').reduce((best, e) => !best || e.arrivedAt > best.arrivedAt ? e : best, null as CelebrationEntry | null);`
- Then fall back to most recent overall by `arrivedAt` similarly.
Add a test where two eagle awards arrive in non-chronological order (e.g., provider rows sorted newest-first or a batch with older-last) and assert the newer `data-row-id` wins.

2. [medium] Best-effort isolation in scores.ts is a key contract but no test is shown to prevent regressions
   - File: apps/tournament-api/src/routes/scores.ts:526-548
   - Confidence: medium
   - Why it matters: AC #5 requires awards failures to never reject a legitimate score commit. The implementation correctly wraps `evaluateAwards()` in try/catch and swallows errors, but the provided changes don’t include an integration test demonstrating that a thrown `evaluateAwards` still yields a 201/200 score response and persists the hole_score row. Without a test, this behavior is easy to accidentally break (e.g., moving the call, removing the catch, or rethrowing).
   - Suggested fix: Add/extend a route-level test for `POST /api/rounds/:roundId/holes/:holeNumber/scores` that forces `evaluateAwards` to throw (e.g., module mock of `../services/awards.js` to throw, or a controlled DB failure inside `emitActivity` for awards only) and assert:
1) HTTP response remains success (201 for new insert),
2) hole_scores row exists,
3) transaction did not roll back because of the awards error.

3. [low] Auth-resolve “catchup” effect re-scans the entire activity `rows` on every rows change; could become unnecessarily expensive
   - File: apps/tournament-web/src/components/award-celebration.tsx:45-70
   - Confidence: high
   - Why it matters: The effect is described as “auth-resolve catchup,” but it depends on `[myPlayerId, rows]` and loops over all `rows` each time `rows` changes. Even with `seenIdsRef` short-circuiting per-id, this is still O(n) per poll/update and may add avoidable overhead as activity history grows.
   - Suggested fix: Run the scan only when auth transitions null→id (store previous `myPlayerId` in a ref), or track a high-water mark (e.g., last scanned row id / createdAt) so you only consider newly added rows. Keep the stream handler as the primary path.

4. [low] `seenIdsRef` grows without bound across the session
   - File: apps/tournament-web/src/components/award-celebration.tsx:39-92
   - Confidence: medium
   - Why it matters: Each award row id is retained forever in `seenIdsRef`. Over a long-running session with many activity events, this can accumulate. Likely small in v1, but it is unbounded memory growth.
   - Suggested fix: Optionally prune `seenIdsRef` alongside `entries` by removing ids once the TTL expires, or cap the set size (e.g., keep only ids for the last N minutes / last N entries).

## Strengths

- Backend awards detection matches the ACs: cheap `toPar` precheck (no DB read on non-sub-par), candidate list includes birdie and conditionally eagle, and eagle commits can emit both awards (apps/tournament-api/src/services/awards.ts:44-53).
- Idempotency check is correctly scoped to (eventId, tenantId, type, awardType via `json_extract`) and logs both skip and emit paths (awards.ts:55-100).
- scores route integrates awards evaluation after press orchestrator and isolates it with a swallow-on-error posture, preserving score commit flow (scores.ts:526-548).
- Auth-session query extraction preserves the same TanStack queryKey, helping ensure deduped network usage across InstallPromptHost and AwardCelebration (use-auth-session.ts:76-84).
- Good test coverage added around awards service behavior (first birdie, first eagle independence, idempotency, scope guard against skins_pot_streak) and core AwardCelebration behaviors (affected-player gating, TTL dismiss, catchup, eagle priority).

## Warnings

- Truncated file content for review: apps/tournament-api/src/routes/scores.ts
