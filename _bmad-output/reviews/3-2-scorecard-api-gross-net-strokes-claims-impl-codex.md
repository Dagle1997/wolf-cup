# Codex Review

- Generated: 2026-06-23T13:43:28.538Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/scorecard.ts, apps/tournament-api/src/routes/scorecard.ts, apps/tournament-api/src/services/scorecard.test.ts, apps/tournament-api/src/routes/scorecard.integration.test.ts, apps/tournament-api/src/app.ts

## Summary

Implementation largely matches the Story 3-2 acceptance criteria: pure builder, gross from hole_scores, strokes allocated from the PINNED CH via allocateStrokesFromCourseHandicap, net null when unplayed or when strokes are unknown (no pin/null ch), claims folded via deriveCurrentClaims with restrictToPlayerIds, and moneyNet is consistently null. Main concerns are (a) potentially non-deterministic reads when multiple round_pin rows could exist, (b) hard-coded tenant handling in the route, and (c) no test proving the new route remains reachable when mounted alongside scoresRouter (possible path shadowing depending on scoresRouter definitions).

Overall risk: medium

## Findings

1. [medium] Pinned handicap selection is non-deterministic if multiple roundPins rows exist for a round
   - File: apps/tournament-api/src/services/scorecard.ts:146-168
   - Confidence: medium
   - Why it matters: The scorecard’s relativeStrokes/netScore are money-adjacent and must be stable. The query reads roundPins by roundId+tenantId with .limit(1) but no ORDER BY (createdAt, id, etc.). If the table can contain more than one row per round (e.g., re-pin, replay, bug, or backfill), which row is returned is undefined, causing inconsistent stroke allocation and net scoring across requests.
   - Suggested fix: If roundPins is logically 1:1 with roundId, enforce it at the schema/DB constraint level (unique index) and/or add an explicit orderBy (e.g., orderBy(desc(roundPins.createdAt))) before limit(1). Add a test covering multiple roundPins rows to ensure latest pin wins (or ensure duplicates are impossible).

2. [medium] Hard-coded TENANT_ID in the route risks incorrect tenant scoping if/when multi-tenant is introduced (and differs from typical session-scoped patterns)
   - File: apps/tournament-api/src/routes/scorecard.ts:35-36
   - Confidence: medium
   - Why it matters: The route’s authorization and existence checks are tenant-scoped via a constant (TENANT_ID = 'guyan') rather than deriving tenant context from the session/request. If other endpoints derive tenant dynamically (or future work introduces multiple tenants), this endpoint could incorrectly deny valid access or (worse) read from the wrong tenant if the constant is ever changed incorrectly. This is also an easy place for an IDOR-like bug to emerge later because tenant binding is not coupled to the authenticated principal.
   - Suggested fix: Derive tenantId from the same source used elsewhere (e.g., session, env, or a tenant middleware) and pass it through consistently to both auth queries and buildPlayerScorecard. Add an integration test that asserts the tenant used comes from request/session context (not a constant) if multi-tenant is expected.

3. [medium] No integration test proves the scorecard route is reachable when mounted alongside scoresRouter (possible path shadowing/regression)
   - File: apps/tournament-api/src/app.ts:138-148
   - Confidence: medium
   - Why it matters: In production the app mounts both scoresRouter and scorecardRouter at the same base path (/api/rounds). The provided integration test mounts only scorecardRouter (apps/tournament-api/src/routes/scorecard.integration.test.ts:214-220), so it cannot detect a routing conflict where a broader/more-generic route in scoresRouter (e.g., '/:roundId/*' or '/:roundId') could intercept GET /:roundId/players/:playerId/scorecard depending on how Hono matches routes and how scoresRouter is defined.
   - Suggested fix: Add an integration test that mounts the real app (or mounts both routers in the same Hono instance in the same order as app.ts) and asserts GET /api/rounds/:roundId/players/:playerId/scorecard returns the expected payload. If a conflict exists, resolve by tightening scoresRouter routes or mounting scorecardRouter before any catch-all in scoresRouter.

4. [low] ScorecardDataError for round-not-found maps to 500 in the route in a TOCTOU scenario
   - File: apps/tournament-api/src/services/scorecard.ts:93-105
   - Confidence: medium
   - Why it matters: The route pre-checks round existence and returns 404 round_not_found, but buildPlayerScorecard can still throw ScorecardDataError('round not found') (e.g., if the round is deleted between the route’s check and the builder’s query). The route currently maps all ScorecardDataError to 500 (apps/tournament-api/src/routes/scorecard.ts:133-147), so this rare race would return 500 instead of the intended 404 taxonomy.
   - Suggested fix: Either: (a) treat specific ScorecardDataError messages/variants like round-not-found as 404 in the route, or (b) adjust buildPlayerScorecard to assume the round exists and remove the extra round existence query when called from this route (if safe), or (c) add a structured error code to ScorecardDataError for reliable mapping.

## Strengths

- Builder correctly uses the pinned CH from roundPins.perPlayerHandicapsJson (never derives from live HI) and allocates per-hole strokes via allocateStrokesFromCourseHandicap (consistency invariant).
- No-pin/null-ch paths fail closed: relativeStrokes=0 and netScore=null even when gross is present, matching the “don’t fabricate net” requirement.
- Claims are derived via deriveCurrentClaims with restrictToPlayerIds and are emitted as explicit booleans for every hole (no undefined).
- moneyNet is consistently null on every hole (clean Story 3-3 seam).
- Good unit test coverage for core ACs: 9-hole behavior, net/gross/unplayed semantics, no-pin behavior, claim folding (latest wins + remove), claim isolation, missing course hole → ScorecardDataError.

## Warnings

None.
