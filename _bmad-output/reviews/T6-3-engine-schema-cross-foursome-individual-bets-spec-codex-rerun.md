# Codex Review

- Generated: 2026-05-04T12:45:48.833Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T6-3-engine-schema-cross-foursome-individual-bets.md

## Summary

Re-review of the updated T6-3 spec markdown. The two called-out fixes appear addressed in the spec text:
- Validation ordering now matches middleware reality (requireSession → requireEventParticipant → handler Zod → in-tx rules), including the intended 403-on-malformed-eventId “no existence leak” behavior.
- Press fire-row naming now aligns with DB columns via `PressFireRow.firedAtHole` + `triggerType`, with an explicit note about divergence from T6-2’s `startHole` naming.

Remaining gaps are mostly around round/press identity and a couple of missing validations that can lead to incorrect persistence or nonsensical bets.

Overall risk: medium

## Findings

1. [high] Triggered press outputs lack round identity, making persistence/dedupe ambiguous (especially for flattened output)
   - File: _bmad-output/implementation-artifacts/tournament/T6-3-engine-schema-cross-foursome-individual-bets.md:165-276
   - Confidence: high
   - Why it matters: Your DB schema for `individual_bet_presses` requires `fired_at_round_id` (and uniqueness is scoped by `(bet_id, fired_at_round_id, fired_at_hole, trigger_type)`), but the engine’s `PressFireRow` type and the top-level `ComputeIndividualBetOutput.triggeredPresses: PressFireRow[]` do not carry any round identifier.

- Per-round output (`perRound[i].triggeredPresses`) can be associated with `perRound[i].eventRoundId`, but the *flattened* `output.triggeredPresses` cannot.
- This creates a realistic foot-gun for T6-4: persisting/deduping triggered presses using the flattened array is impossible to do correctly without extra context, and bugs here would cause presses to be written against the wrong round or deduped incorrectly across rounds.
   - Suggested fix: Make the round identity explicit in the press row shape that crosses the engine boundary. Options:
- Add `eventRoundId: string` (or `firedAtEventRoundId`) to `PressFireRow`, and require it on engine output for triggered presses.
- Alternatively, drop `ComputeIndividualBetOutput.triggeredPresses` (flattened) entirely and require consumers to use `perRound[].triggeredPresses` (which has round context), but then update AC-8/AC-8b/AC-9 and the type contract accordingly.
- If you keep both, ensure the flattened array is an array of `{ eventRoundId, ...PressFireRow }` to be safely persistable.

2. [medium] Route/business rules don’t specify/require playerAId != playerBId (self-bet)
   - File: _bmad-output/implementation-artifacts/tournament/T6-3-engine-schema-cross-foursome-individual-bets.md:120-155
   - Confidence: high
   - Why it matters: As specified, the route verifies both players are participants, normalizes ordering, and inserts the bet. There’s no explicit rule preventing a bet where `playerAId === playerBId`.

That creates nonsensical semantics (a player vs themselves), makes the UNIQUE constraint behavior odd (the canonicalization step doesn’t change anything), and can create downstream edge cases in the engine (winner comparisons, handicap indexing, holeScores map keys colliding).
   - Suggested fix: Add an explicit validation:
- In Zod (preferred) or in-tx rule: if `playerAId === playerBId`, return 400 (invalid_body) or 422 (invalid_participants) with a dedicated code.
- Add an integration test case for self-bet rejection.

3. [medium] Round identifier duality (roundId vs eventRoundId) is easy to mis-wire in engine inputs and press indexing
   - File: _bmad-output/implementation-artifacts/tournament/T6-3-engine-schema-cross-foursome-individual-bets.md:167-233
   - Confidence: medium
   - Why it matters: The engine input mixes:
- `applicableRounds[].roundId` (runtime `rounds` row id)
- `applicableRounds[].eventRoundId` (scheduled `event_rounds` id)
- `holeScoresByCell` key uses `roundId`
- `pressesByRound` is keyed by `eventRoundId`

This can work, but it’s a common source of subtle bugs (e.g., accidentally keying presses by runtime round id; or building holeScores keys using eventRoundId). Those bugs would manifest as “no presses applied” or “no scores found,” silently producing incorrect money.
   - Suggested fix: Strengthen the contract to reduce mis-wiring:
- Rename fields to be unambiguous: `runtimeRoundId` and `eventRoundId`.
- In AC-5 boundary validation, add a fast-fail check that every `pressesByRound` key corresponds to an `applicableRounds[].eventRoundId` (and perhaps warn/throw on unknown keys).
- Add a unit test that would fail if the two ids are swapped (e.g., provide presses keyed by runtime id and assert it throws).

4. [low] Skipping holes with missing scores may produce invalid press-trigger behavior on later holes
   - File: _bmad-output/implementation-artifacts/tournament/T6-3-engine-schema-cross-foursome-individual-bets.md:181-188
   - Confidence: medium
   - Why it matters: The spec states: if either player is missing a `hole_scores` row, the engine “SKIP that hole.” For match-play state (and auto-press triggers), skipping earlier holes but still evaluating later holes can produce match states/triggers that wouldn’t be valid in a strictly chronological interpretation (you can’t know you’re ‘2-down at hole 4’ if hole 2 is missing).

This is especially relevant because you intend to emit `triggeredPresses` for T6-4 to persist; persisting a press that was inferred from partial/non-contiguous data could be hard to unwind later.
   - Suggested fix: If the intended behavior is to only evaluate contiguous holes from 1..k where both scores exist:
- Change the rule to “stop evaluating the round at the first hole with missing data for either player.”
- Or, keep skip semantics but explicitly state (and test) that press triggering only considers holes where both scores exist and accepts non-contiguous evaluation as designed.
Add at least one fixture to lock the intended behavior.

## Strengths

- Validation-order conflict called out in prior review is now corrected and explicitly documented (lines 136–155).
- Press fire-row naming now aligns with DB columns via `firedAtHole`/`triggerType`, and the intentional divergence from T6-2 is clearly noted (lines 234–251).
- Round independence is explicitly specified (lines 187–188, AC-9).
- Added AC-8b to cover the hole-18 trigger suppression case, matching the T6-2 precedent (lines 303–307).

## Warnings

None.
