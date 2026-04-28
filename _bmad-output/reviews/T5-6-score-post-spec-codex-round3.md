# Codex Review

- Generated: 2026-04-28T15:34:51.351Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-6-score-post-require-scorer-for-round-middleware.md

## Summary

Round-2 items are mostly addressed conceptually (round existence check, revised AC#1, conflict fallback). However, the spec still contains a few concrete internal contradictions that could easily lead to incorrect/unsafe implementation—most notably tenant-scoping omissions in the handler sketch despite an explicit “EVERY query is tenant-scoped” requirement, and a reintroduced `computeExpectedCells` call-signature mismatch inside the transaction sketch. Error taxonomy also contradicts the described middleware vs handler responsibilities for `round_not_found` and `hole_number_exceeds_holes_to_play`.

Overall risk: medium

## Findings

1. [high] Tenant scoping requirement contradicts handler sketch (several queries/updates shown without tenant filter)
   - File: _bmad-output/implementation-artifacts/tournament/T5-6-score-post-require-scorer-for-round-middleware.md:99-207
   - Confidence: high
   - Why it matters: Section §10 states EVERY SELECT/INSERT/UPDATE in middleware + route MUST filter on `tenant_id = TENANT_ID` (line 390-393). But the transaction sketch omits tenant filters in multiple places (e.g., `roundStates` select/update, `holeScores` conflict lookup, and `holeScores` actualCount query). This inconsistency is easy for devs to copy/paste and accidentally ship cross-tenant reads/writes or state transitions, which is a security/data-isolation bug.
   - Suggested fix: Make the sketch and AC#2 unambiguous by including tenant filters everywhere they apply:
- `roundStates`: add `eq(roundStates.tenantId, TENANT_ID)` on select/update.
- `holeScores` existing-row lookup in conflict handler: add `eq(holeScores.tenantId, TENANT_ID)`.
- `actualCount` count(*) query: add `eq(holeScores.tenantId, TENANT_ID)`.
- `rounds` update for openedAt/openedBy: add tenant filter if schema is tenant-scoped.
Also ensure tests assert tenant isolation for at least one of these paths.

2. [medium] `computeExpectedCells` call in handler sketch still uses old signature (passes roundId, spec says it takes a round row)
   - File: _bmad-output/implementation-artifacts/tournament/T5-6-score-post-require-scorer-for-round-middleware.md:190-205
   - Confidence: high
   - Why it matters: You state the round-2 mismatch was resolved by changing the helper signature to `computeExpectedCells(tx, round: Round)` (line 291-292). But the transaction sketch still shows `computeExpectedCells(tx, roundId)` (line 192). A developer following the sketch will either reintroduce the mismatch or implement the helper incorrectly, breaking auto-complete logic or causing redundant queries.
   - Suggested fix: Update the transaction sketch to call `computeExpectedCells(tx, roundRows[0])` (or `round` variable) and ensure the helper definition in §7 matches the call site. Add an integration test that completes the last expected cell and asserts the state transition occurs.

3. [medium] Error taxonomy contradicts middleware contract for `round_not_found` (middleware vs handler source)
   - File: _bmad-output/implementation-artifacts/tournament/T5-6-score-post-require-scorer-for-round-middleware.md:54-360
   - Confidence: high
   - Why it matters: Middleware §3 step 5 clearly does a round existence check and returns 404 `round_not_found` (line 57-59, reiterated in AC#1 line 415). But the error taxonomy table lists `round_not_found` as “handler defense-in-depth” (line 358). This is a spec-level contradiction that can cause wrong precedence assumptions and mismatched tests (e.g., whether middleware tests should cover `round_not_found`).
   - Suggested fix: Pick one canonical source and reflect it everywhere:
- If middleware is authoritative, move `round_not_found` taxonomy entry to middleware/lookup section and note handler may still return it only as a safety net.
- Update precedence ordering to explicitly include `round_not_found` before pairings/scorer lookups.
- Ensure test attribution includes a middleware test for non-existent roundId returning `round_not_found`.

4. [medium] `hole_number_exceeds_holes_to_play` is in taxonomy/ACs but missing from the handler sketch’s step ordering
   - File: _bmad-output/implementation-artifacts/tournament/T5-6-score-post-require-scorer-for-round-middleware.md:97-209
   - Confidence: high
   - Why it matters: The spec says the handler additionally validates `holeNumber <= round.holesToPlay` (line 97-98) and the taxonomy lists a 422 `hole_number_exceeds_holes_to_play` path (line 366). But the handler sketch does not show this check between fetching `roundRows` and attempting the insert. This gap can lead to scoring holes beyond the configured round length (notably for 9-hole rounds), conflicting with your own taxonomy/AC expectations.
   - Suggested fix: In the handler sketch (and AC#2), add explicit logic right after the round lookup:
- `if (holeNumber > roundRows[0].holesToPlay) return 422 { code: 'hole_number_exceeds_holes_to_play' }`.
Add an integration test for a 9-hole round attempting to post hole 10 returning 422.

5. [low] `currentScorerName` lookup on 403 paths lacks a defined fallback if players row missing
   - File: _bmad-output/implementation-artifacts/tournament/T5-6-score-post-require-scorer-for-round-middleware.md:69-75
   - Confidence: medium
   - Why it matters: Middleware plans an extra query for `currentScorerName` (line 74). If the scorer_player_id references a missing/deleted player row (or fixture data is incomplete in tests), response shape becomes unclear (null? empty string? 500?). This can make the 403 contract brittle.
   - Suggested fix: Specify: if no players row found, return `currentScorerName: null` (or omit field) but still return the correct 403 code. Add a test covering the null-name fallback if that scenario is plausible in your data model.

## Strengths

- Middleware now clearly checks round existence before pairings/scorer lookups, addressing the prior false `player_not_in_any_foursome` on non-existent rounds (line 57-59).
- AC #1 is rewritten to match the new middleware contract and removes the old `invalid_player_id`/body-cache confusion (line 406-424).
- Conflict-path defensive fallback (`conflictingEntry: null`) is explicitly documented (line 138-145, 396-399).
- The 403 split between `player_not_in_your_foursome` vs `not_scorer_for_this_foursome` is well-motivated and testable (line 68-73, 443-453).

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T5-6-score-post-require-scorer-for-round-middleware.md
