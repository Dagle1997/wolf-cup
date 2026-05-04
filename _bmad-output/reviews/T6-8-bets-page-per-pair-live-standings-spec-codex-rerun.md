# Codex Review

- Generated: 2026-05-04T20:46:30.123Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T6-8-bets-page-per-pair-live-standings.md

## Summary

Spec is much clearer after scoping to bet-party-only. Remaining issues are mostly internal contradictions/ambiguities that could cause incorrect implementation or regress the stated “no-existence-leak” invariant, plus one UI copy mismatch with the 9-hole support you explicitly added.

Overall risk: medium

## Findings

1. [high] No-existence-leak handling for malformed UUID is still ambiguous (403 vs 400)
   - File: _bmad-output/implementation-artifacts/tournament/T6-8-bets-page-per-pair-live-standings.md:97-102
   - Confidence: high
   - Why it matters: AC-5 says malformed UUID should return 403 `not_party_to_bet`, but immediately allows that a Zod parse “may still return 400”. This creates two distinct observable behaviors (400 vs 403) for different inputs, and—more importantly—doesn’t clearly constrain the final implementation/test expectations. If implementers follow the parenthetical, they may ship 400 for malformed and 403 for unknown/different-event. If your intended invariant is “never 404 and never distinguish unknown vs other-event”, you should still pin down malformed handling explicitly to avoid inconsistent implementations and brittle tests.
   - Suggested fix: Pick one invariant and encode it unambiguously:
- Option A (simplest, strictest): treat malformed `betId` the same as unknown/different-event and always return 403 `not_party_to_bet` after `requireEventParticipant` (i.e., don’t Zod-reject `betId` with 400 on this route).
- Option B: keep 400 for malformed, but then update AC-5 to explicitly require 400 for malformed and 403 for well-formed-but-unknown/different-event, and clarify that this does not violate the “no existence leak” goal (because it only leaks format validity, not existence). Also ensure the tests assert the chosen behavior.

2. [medium] Followups section contradicts v1 visibility model (organizer cannot fetch `bets/:betId` as non-party)
   - File: _bmad-output/implementation-artifacts/tournament/T6-8-bets-page-per-pair-live-standings.md:19-31
   - Confidence: high
   - Why it matters: In v1 scope/out-of-scope you explicitly remove organizer-as-non-party access to `/:betId` and state visibility is bet-party-only (lines 21–30). But Followups says the organizer can audit bets “by fetching individual `bets/:betId`” (line 149), which is not true under the v1 auth model and could mislead stakeholders/QA about expected access paths.
   - Suggested fix: Edit Followups line 149 to remove “or by fetching individual `bets/:betId`” (or qualify it: “only if the organizer is also a bet party / group member; otherwise deferred to T6-8a”). Ensure the “audit indirectly via Money matrix” remains the stated v1 workaround.

3. [medium] UI acceptance text hard-codes “of 18” but spec now supports 9-hole rounds via `holesToPlay`
   - File: _bmad-output/implementation-artifacts/tournament/T6-8-bets-page-per-pair-live-standings.md:109-118
   - Confidence: high
   - Why it matters: AC-1/AC-4 explicitly pin `holesRemaining` to `round.holesToPlay − holesPlayed` and call out non-18 rounds (lines 63–65). But AC-7’s UI copy example says “through hole H of 18” (line 116). That’s inconsistent and will either produce wrong UI for 9-hole rounds or create confusion in tests/QA expectations.
   - Suggested fix: Change the UI copy requirement to use the round’s holes-to-play, e.g. “through hole H of {holesToPlay}” (or “through hole H” without the denominator). Update the web test expectation accordingly.

4. [low] `holesPlayed` definition doesn’t explicitly cap by `round.holesToPlay`
   - File: _bmad-output/implementation-artifacts/tournament/T6-8-bets-page-per-pair-live-standings.md:60-66
   - Confidence: medium
   - Why it matters: You define `holesPlayed` as “count of holes where BOTH viewer + opponent have a hole_scores row in this round” (line 63). If data contains extra hole_scores rows beyond the configured holes-to-play (or if a round is 9-hole but scores were entered for 10–18), `holesPlayed` could exceed `holesToPlay` and yield negative `holesRemaining` per your formula (line 64). Even if that’s “bad data”, defining the behavior prevents UI/engine surprises.
   - Suggested fix: Clarify in AC-1 that the count only includes holes `<= round.holesToPlay` (and optionally require clamping `holesRemaining = max(0, holesToPlay - holesPlayed)` to avoid negative display values).

## Strengths

- Auth-scope reduction to bet-party-only is clearly captured in v1 Scope + Out of scope + Visibility model (lines 11–30), and it eliminates the earlier organizer/non-party contradictions.
- No-existence-leak is explicitly called out as an invariant for unknown betId and betId-from-different-event returning 403 `not_party_to_bet` (lines 29, 97–102), aligning with the stated T6-5 pattern.
- `holesRemaining` is now correctly tied to `round.holesToPlay` (not hard-coded 18) and `holesPlayed` requires both parties’ hole_scores presence (lines 63–65).
- Risk section acknowledges engine-input assembly divergence and pins v1 to a verbatim inline duplication of the money.ts pattern with a named followup to dedupe later (lines 162–165), which is a reasonable regression-avoidance tactic.

## Warnings

None.
