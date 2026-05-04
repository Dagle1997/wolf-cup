# Codex Review

- Generated: 2026-05-04T15:43:01.535Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T6-5-head-to-head-money-matrix-api-ui.md, apps/tournament-api/src/engine/formats/best-ball-2v2.ts, apps/tournament-api/src/engine/rules/individual-bets.ts, apps/tournament-api/src/services/press-orchestrator.ts, apps/tournament-api/src/db/schema/bets.ts, apps/tournament-api/src/db/schema/press.ts

## Summary

The provided materials are primarily the T6-5 spec doc plus existing engine/schema/service files (no T6-5 implementation diff/files included yet), so this review focuses on spec internal consistency and any concrete issues visible in the included code that could impact the money-matrix aggregation.

Main spec issues: there are a couple of direct AC contradictions (status codes for malformed eventId; visibilityMode semantics) and a likely ID-type mismatch risk (viewerPlayerId vs session.userId) that should be resolved before implementation to avoid rework and auth bugs.

Engines shown look broadly consistent with integer-cents + anti-symmetry goals, but there are a few validation gaps (e.g., 2v2 pairing uniqueness, playerA!=playerB) that could matter if upstream data is ever malformed.

Overall risk: medium

## Findings

1. [high] Spec contradiction: malformed eventId status code is 400 in AC-5 but 403 in AC-6(f)
   - File: _bmad-output/implementation-artifacts/tournament/T6-5-head-to-head-money-matrix-api-ui.md:119-141
   - Confidence: high
   - Why it matters: This is a direct acceptance-criteria conflict: AC-5 requires UUID validation returning 400 (invalid_event_id), while AC-6(f) requires malformed eventId to return 403 to avoid existence leakage. The implementation and tests can’t satisfy both simultaneously, and teams will diverge on expected behavior.
   - Suggested fix: Decide and document the exact contract. Common pattern: (1) malformed UUID -> 400 invalid_event_id; (2) well-formed but non-existent or unauthorized -> 403 (no-existence-leak). Update AC-6(f) to refer to non-existent-but-well-formed IDs (or update AC-5 if you truly want 403 for malformed too) and align integration tests accordingly.

2. [high] Spec contradiction: visibilityMode described as always 'open' in v1, but also described as echoing group config
   - File: _bmad-output/implementation-artifacts/tournament/T6-5-head-to-head-money-matrix-api-ui.md:50-53
   - Confidence: high
   - Why it matters: The response field semantics affect both API consumers and future v1.5 filtering work. If v1 always returns 'open', clients can treat it as constant; if it echoes group config, clients may display/branch on it. The spec currently says both, which will cause mismatch between implementation and tests/docs.
   - Suggested fix: Pick one:
- If v1 truly hard-codes: set visibilityMode: 'open' always, and explicitly state group config is ignored until v1.5.
- If v1 echoes config but does not filter: keep the field as config value and clarify that filtering is deferred.
Then ensure route/service tests assert the chosen behavior.

3. [medium] Potential ID mismatch in spec: computeMoneyMatrix expects viewerPlayerId but route AC passes session.userId
   - File: _bmad-output/implementation-artifacts/tournament/T6-5-head-to-head-money-matrix-api-ui.md:80-127
   - Confidence: medium
   - Why it matters: If `session.userId` is an auth user identifier (not the same as `players.id`), passing it as `viewerPlayerId` will break: participant checks, row highlighting, and potentially matrix indexing (leading to missing/zeroed rows or incorrect 403s). The spec uses both terms without asserting they are the same domain ID.
   - Suggested fix: Clarify the ID domain explicitly in the ACs:
- If session contains `playerId`, rename accordingly and pass `session.playerId`.
- If session only has `userId`, add a deterministic lookup to playerId in the route/service boundary (and test it). Also ensure `requireEventParticipant` is keyed to the same ID type.

4. [low] compute2v2BestBall does not validate pairings are 4 distinct playerIds; malformed inputs could yield confusing ledgers
   - File: apps/tournament-api/src/engine/formats/best-ball-2v2.ts:165-230
   - Confidence: medium
   - Why it matters: The engine assumes a true 2v2 with four distinct players. If upstream pairing construction ever duplicates an id (or overlaps teamA/teamB), results become undefined and could later violate money-matrix invariants (or silently produce misleading zeros). While DB-driven pairings likely prevent this, the engine is reusable/pure and would benefit from explicit boundary checks.
   - Suggested fix: Add boundary validation at the top of compute2v2BestBall to ensure teamA/teamB contain exactly 4 distinct ids and no overlap. Throw a clear error (RangeError) on violation so callers can surface a controlled 422/500 depending on layer.

5. [low] computeIndividualBet does not validate playerAId != playerBId
   - File: apps/tournament-api/src/engine/rules/individual-bets.ts:160-183
   - Confidence: high
   - Why it matters: A self-bet is nonsensical and could mask data bugs in bet creation. It will likely compute as all-halved (net 0) and silently pass, making it harder to detect bad rows and potentially confusing downstream aggregation.
   - Suggested fix: Add a simple boundary check: if bet.playerAId === bet.playerBId throw RangeError. Also consider schema/route-layer prevention if not already present.

## Strengths

- Spec explicitly calls out integer-cents discipline and confines formatting to a UI boundary helper (good anti-drift posture).
- Existing engines shown enforce integer validation for key money config inputs (e.g., best-ball config cents; individual bet stake and press multipliers).
- 2v2 best-ball engine maintains anti-symmetry via paired bumpPair updates (matrix-friendly).
- Team press log schema uses integer multipliers + uniqueness constraints; orchestrator explicitly handles UNIQUE collisions to avoid tx aborts under WAL races.

## Warnings

None.
