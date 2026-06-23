# Codex Review

- Generated: 2026-06-23T16:18:27.632Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/scorecard.ts, apps/tournament-api/src/routes/scorecard.integration.test.ts

## Summary

(1) Divergence closure: Yes. In `buildPlayerScorecard`, when a `round_pin` exists the scorecard now resolves `courseRevisionId` from `round_pins.courseRevisionId` (lines 129-167) and iterates holes using `event_rounds.holesToPlay` (lines 115-128, 222). This matches the money engine’s stated authority (`round_pin.courseRevisionId` + `event_round.holesToPlay`), so a post-pin event_round course edit can no longer make displayed par/si/net disagree with per-hole money.

(2) No NEW high found in the provided changes.

(3) Unpinned fallback: Correct. If no pin row exists, `pinnedCourseRevisionId` is null and `courseRevisionId` falls back to `eventRound.courseRevisionId` (line 166). Holes are also sourced from `eventRound.holesToPlay` (line 222).

(4) Tests: The new integration tests do exercise the fix and the new $0-vs-null behavior:
- “pinned course revision authority” directly simulates the post-pin event_round course edit and asserts the scorecard still uses pinned par and stroke allocation (integration test lines 520-564).
- Money tests verify: flag gate (lines 481-490), lock gate (492-501), golden per-hole money on settled holes and null on unplayed (464-479), and that a settled push preserves an explicit 0 rather than null (503-517). Together these prove the critical behaviors that were at risk.

One medium-risk behavioral change remains worth calling out (below): `holesToPlay` is now taken from `event_rounds` only, which could change output if `rounds.holesToPlay` can diverge in real data.

Overall risk: low

## Findings

1. [medium] Potential regression if rounds.holesToPlay and event_rounds.holesToPlay can diverge
   - File: apps/tournament-api/src/services/scorecard.ts:101-223
   - Confidence: medium
   - Why it matters: The builder previously iterated `1..rounds.holesToPlay` but now iterates `1..event_rounds.holesToPlay` (lines 115-128, 222). If production data can legitimately have per-round holes differing from the event-round default (or if the two columns can drift), the scorecard could return an unexpected number of holes (and money settlement may or may not match, depending on what other paths assume). This is not proven safe by the diff alone because the schema stores both values.
   - Suggested fix: If the invariant is “must always match”, add a defensive check and throw a `ScorecardDataError` (or pick a documented precedence and log) when they differ, plus a regression test that forces a mismatch. If per-round override is real/desired, reconsider using only event_round.holesToPlay and align the money path similarly (or explicitly document precedence).

## Strengths

- Pinned course revision authority is now enforced in the read path: `courseRevisionId` resolves to `round_pins.courseRevisionId` when present, eliminating the post-pin edit divergence (scorecard.ts lines 129-167).
- `moneyNet` is sourced through a single chokepoint (`computeF1PerHoleMoneyForPlayer`) and is read with a `.has()` presence check, correctly preserving settled $0 push holes (scorecard.ts lines 205-217, 247-251).
- Integration tests cover: flag gating, lock gating, settled-vs-unsettled nullability, explicit $0 push behavior, and the post-pin event_round course edit scenario that previously caused divergence (scorecard.integration.test.ts lines 463-565).

## Warnings

None.
