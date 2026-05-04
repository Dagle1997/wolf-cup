# Codex Review

- Generated: 2026-05-04T12:49:38.901Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T6-3-engine-schema-cross-foursome-individual-bets.md

## Summary

Spec is largely internally consistent after the two applied Medium findings (PressFireRow↔DB mapping clarity; pressesByRound key invariant). One remaining correctness risk: the route spec doesn’t address duplicate `applicableRoundIds`, which can violate the `(bet_id, event_round_id)` PK on `individual_bet_rounds` and likely surface as an unhandled DB error. Also, the “malformed/nonexistent :eventId → 403 (no existence leak)” behavior is specified but not covered by the listed integration tests.

Overall risk: medium

## Findings

1. [medium] Route spec doesn’t handle duplicate applicableRoundIds, risking transaction failure on individual_bet_rounds PK
   - File: _bmad-output/implementation-artifacts/tournament/T6-3-engine-schema-cross-foursome-individual-bets.md:146-155
   - Confidence: high
   - Why it matters: `individual_bet_rounds` has `PRIMARY KEY (bet_id, event_round_id)` (Section 5). If the request body contains duplicate `applicableRoundIds`, step (vi) / AC-12(vii) “INSERT N rows” will attempt duplicate `(bet_id, event_round_id)` inserts and likely throw a constraint violation. The spec only calls out catching the UNIQUE violation on `individual_bets`, not this PK violation, so the endpoint may return a 500 instead of a controlled 4xx.
   - Suggested fix: Add explicit validation before insert: `applicableRoundIds` must be a non-empty array of unique strings (Zod `.refine(ids => new Set(ids).size === ids.length, 'duplicate_round_ids')`). Alternatively, dedupe in-handler before insert, or use an upsert/`ON CONFLICT DO NOTHING` when inserting `individual_bet_rounds` (but then define response semantics). Add an integration test covering duplicate `applicableRoundIds` → 400/422 as chosen.

2. [low] No integration test case for the spec’d “malformed/nonexistent eventId returns 403” no-existence-leak behavior
   - File: _bmad-output/implementation-artifacts/tournament/T6-3-engine-schema-cross-foursome-individual-bets.md:138-145
   - Confidence: medium
   - Why it matters: Section 6 / AC-12 explicitly depend on middleware ordering and the invariant that malformed/nonexistent `:eventId` yields 403 from `requireEventParticipant` to avoid existence leaks. AC-13’s test matrix doesn’t include this case, so a regression (e.g., middleware starts throwing 400/500 on malformed IDs) would slip through despite being called out as “INTENDED”.
   - Suggested fix: Add an integration test: authenticated caller hits `POST /api/events/not-a-real-id/bets` with any body and assert 403 `not_event_participant` (and optionally that body validation is not reached). If the project uses UUID-typed IDs anywhere, also test truly malformed UUID strings to ensure the middleware doesn’t throw 500.

## Strengths

- PressFireRow↔DB column alignment comment is now explicit about which fields map to columns vs stamped-at-persist vs engine-only (AC-4 block, lines ~246–268).
- Added pressesByRound key consistency invariant is precise and actionable (AC-5, lines 312–314), and names a specific error string for mismatch.
- The roundId vs eventRoundId duality is clearly documented with a mapping table and a stability rule, reducing a common class of persistence/compute bugs (lines 190–200).
- Acceptance criteria include both unit-level golden fixtures and determinism/no-mutation guarantees, plus route integration tests covering key business-rule failures.

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T6-3-engine-schema-cross-foursome-individual-bets.md
