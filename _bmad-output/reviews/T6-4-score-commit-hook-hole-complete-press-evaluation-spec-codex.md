# Codex Review

- Generated: 2026-05-04T14:19:24.732Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T6-4-score-commit-hook-hole-complete-press-evaluation.md, apps/tournament-api/src/routes/scores.ts, apps/tournament-api/src/engine/formats/best-ball-2v2.ts, apps/tournament-api/src/engine/rules/press.ts, apps/tournament-api/src/db/schema/scoring.ts, apps/tournament-api/src/db/schema/pairings.ts

## Summary

Spec is mostly aligned with existing T5-6 score-commit transaction patterns (single tx, idempotent replay, activity inside tx) and the T6-1/T6-2 engines’ expectations. The two biggest correctness risks are (1) the hole-complete detection query pattern as written can count the wrong pairing membership unless it is constrained to the round’s event_round_id, and (2) the spec simultaneously claims support for non-4-player foursomes while the 2v2 best-ball + press engines are structurally 4-player/2-team only. There’s also an internal mismatch in the activity payload contract that should be resolved before implementation to avoid breaking downstream consumers/tests.

Overall risk: high

## Findings

1. [critical] Hole-complete detection join can be wrong unless constrained to the round’s event_round_id (risk: false “hole complete” and firing presses for the wrong foursome)
   - File: _bmad-output/implementation-artifacts/tournament/T6-4-score-commit-hook-hole-complete-press-evaluation.md:51-70
   - Confidence: high
   - Why it matters: The spec’s hole-complete query joins `hole_scores.player_id → pairing_members.player_id → pairings.id` and then filters by `pairings.foursome_number = :foursomeNumber`. But `pairing_members` is keyed by `(pairing_id, player_id)` and does not include `round_id`; players can appear in multiple pairings across different `event_round_id`s (e.g., multiple days). Without also constraining the join to the committing round’s `rounds.event_round_id`, the join can match the player’s pairing membership from a different event round where the foursome_number happens to match, causing the count to reach 4 even when the current foursome is not complete. That would incorrectly trigger `compute2v2BestBall`/`evaluatePresses` and persist/emit presses for the wrong group.
   - Suggested fix: In the orchestrator, first load `round.eventRoundId` for `roundId` (within tx). Then constrain the membership join with `pairings.event_round_id = round.event_round_id` (and tenant filters). Even safer: compute the current foursome’s member playerIds via `pairings(event_round_id,foursome_number) → pairing_members`, then hole-complete is `count(distinct hole_scores.player_id) where hole_scores.round_id=? and hole_scores.hole_number=? and hole_scores.player_id IN (memberIds)`; compare against `memberIds.length`. This avoids cross-event-round contamination entirely.

2. [high] Spec claims variable foursome size, but engines and orchestrator inputs are 2v2/4-player only (needs explicit guard or revised scope)
   - File: _bmad-output/implementation-artifacts/tournament/T6-4-score-commit-hook-hole-complete-press-evaluation.md:53-71
   - Confidence: high
   - Why it matters: Section 3 says the rule is “all 4 foursome members” but then introduces an edge-case requirement to treat `pairing_members` count as authoritative for <4 players. However, `compute2v2BestBall` requires `pairings: { teamA: [string,string]; teamB: [string,string] }` (apps/tournament-api/src/engine/formats/best-ball-2v2.ts:63-70), and its “complete-cell gate” is explicitly “all 4 foursome members” (best-ball-2v2.ts:224-230). `evaluatePresses` is also defined over a 2-team match snapshot. With 3 players (or any non-4), you cannot form two pairs of two, so evaluation either can’t run or will require non-trivial rule changes. Leaving this ambiguous risks either runtime exceptions or silently skipped/incorrect press behavior.
   - Suggested fix: Make the v1 rule explicit: require exactly 4 pairing members for any foursome where presses are evaluated. If size != 4, return early (no press eval) and log a warning with roundId/foursomeNumber. Alternatively, update the story scope to state non-4 foursomes are out of scope for press evaluation until an engine/generalization exists.

3. [medium] Activity payload contract is internally inconsistent (risk: implementation and tests diverge from epic/consumers)
   - File: _bmad-output/implementation-artifacts/tournament/T6-4-score-commit-hook-hole-complete-press-evaluation.md:72-196
   - Confidence: high
   - Why it matters: Section 4 states the activity payload should be `{ roundId, holeNumber, betOrTeam, from, to, multiplier }` (lines ~72-75). But AC-4(g) specifies payload `{ roundId, holeNumber, team, startHole, multiplier, trigger }` (lines ~193-196). Downstream consumers (T8 engagement surfaces) and the new integration tests (AC-7) need one stable contract; otherwise you’ll ship either failing tests or a breaking event shape.
   - Suggested fix: Pick one payload schema and use it consistently across Section 4, AC-4(g), and the integration tests. If epic lines 1859+ require `from/to/betOrTeam`, map team presses clearly (e.g., `betOrTeam: 'team', from: 'teamA', to: 'teamB'` or similar), or formally update the epic-derived AC and document the deviation.

4. [medium] Press-engine error → 422 relies on global error mapping not shown in scores.ts (risk: 500 instead of 422, or partial behavior in tests)
   - File: apps/tournament-api/src/routes/scores.ts:258-549
   - Confidence: medium
   - Why it matters: The spec requires orchestrator engine errors to surface as `BusinessRuleError('press_engine_error', ..., 422)` and return 422 while rolling back. In this route handler, `BusinessRuleError` is only handled in narrow cases around `transitionState` (scores.ts:466-533). There is no local catch around the transaction body to map a thrown `BusinessRuleError` to an HTTP response. If the app-wide error middleware does not map this code, the endpoint could return 500, violating AC-6.
   - Suggested fix: Either (a) confirm and test that the global Hono error handler maps `BusinessRuleError` (including the new `'press_engine_error'`) to status 422 for this route, or (b) add a local try/catch around `db.transaction(...)` in this handler to convert `BusinessRuleError` to the required JSON `{ error: 'unprocessable', code: 'press_engine_error', requestId }` with 422.

5. [low] Path footprint / audit-log decision is contradictory inside the spec (gate-risk)
   - File: _bmad-output/implementation-artifacts/tournament/T6-4-score-commit-hook-hole-complete-press-evaluation.md:17-81
   - Confidence: high
   - Why it matters: Section 1 lists `apps/tournament-api/src/lib/audit-log.ts` as a MOD, then Section 4 says v1 ships WITHOUT the audit-log MOD and aims for 10 files, but Section 1 also says “11 files total — 5 NEW + 6 additive MOD” and later “10 files”. This inconsistency is likely to cause an implementation/PR that violates the “ALLOWED files” gate or triggers review churn.
   - Suggested fix: Resolve the spec to a single authoritative file list and decision: either remove `audit-log.ts` from the plan entirely for v1, or keep it and update the stated file count and ACs accordingly. Prefer making the footprint list match the intended v1 behavior exactly.

## Strengths

- Existing T5-6 score-commit flow already has strong idempotent replay handling via `ON CONFLICT DO NOTHING` on `(round_id, player_id, hole_number, client_event_id)` and a separate 409 path for cell-level uniqueness (scores.ts:350-431).
- SQLite UNIQUE detection avoids brittle message matching by checking libsql/drizzle error codes (scores.ts:554-586), which is a good precedent for the press-log UNIQUE-violation handling.
- Doing audit/activity writes inside the same transaction as the score insert is consistent with the “fail loud + rollback” requirement for press-engine errors, as long as the error mapping to 422 is verified.

## Warnings

None.
