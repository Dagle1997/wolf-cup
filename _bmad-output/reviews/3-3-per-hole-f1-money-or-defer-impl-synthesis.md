# Codex Synthesis (Debate Tribunal)

- Generated: 2026-06-23T16:11:19.192Z
- Synthesized sources: codex-review, gemini-review, codex-critique-of-gemini, gemini-critique-of-codex
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Evidence files: apps/tournament-api/src/services/scorecard.ts, apps/tournament-api/src/services/games-money.ts

## Verdict

**HOLD** — confidence: high

## Executive summary

Decision: whether to ship Story 3-3 (per-hole F1 money on the during-round scorecard). Reviewers converged on a must-fix correctness issue: the scorecard’s par/si/net can be built from a different course revision (and possibly a different holesToPlay) than the pinned money computation, producing user-visible disagreement after a post-pin course edit. Verdict: HOLD until the scorecard read path is aligned to the pinned course revision (and holesToPlay) used by money settlement; then address agreed perf/test follow-ups.

## High-confidence findings (consensus)

1. [critical] Pinned-vs-live course revision mismatch can make scorecard net/par/si disagree with displayed per-hole money after post-pin course edits
   - File: apps/tournament-api/src/services/scorecard.ts
   - Affirming sources: codex-review, codex-critique-of-gemini, gemini-critique-of-codex
   - Summary: buildPlayerScorecard reads course_holes (par/si) using event_round.courseRevisionId, while per-hole money is settled from round_pin.courseRevisionId (pinned). If a course edit occurs after pinning (B3 scenario), the scorecard’s displayed par/si/net can diverge from the per-hole money shown on the same scorecard, because money is computed against pinned hole metadata while scorecard net/par/si is computed against a potentially different revision.
   - Recommended action: In buildPlayerScorecard, when a round_pin exists, source course_holes (par/si) from round_pins.courseRevisionId (pinned) instead of event_round.courseRevisionId, so the scorecard’s net/par/si share the same pinned course revision as computeF1PerHoleMoneyForPlayer. Add a regression test that edits the course revision post-pin and asserts scorecard net/par/si remain consistent with money settlement inputs.

2. [medium] Performance: polled scorecard read triggers full foursome settlement / redundant queries in the money path
   - File: apps/tournament-api/src/services/scorecard.ts; apps/tournament-api/src/services/games-money.ts
   - Affirming sources: codex-review, gemini-review, gemini-critique-of-codex
   - Summary: On each scorecard poll, the route/build calls computeF1PerHoleMoneyForPlayer, which settles the player’s foursome (and performs multiple DB reads). Reviewers agree this can be heavier than necessary for a frequently polled UI, even though it is gated by the money exposure conditions (locked + flag) and needs foursome-wide data to settle correctly.
   - Recommended action: Reduce duplicate reads/settlement work on the polled scorecard path (e.g., load/shared round+eventRound+pin+course_holes once, or provide a combined builder that returns scorecard holes plus per-hole money with shared queries). Keep the exposure gate behavior unchanged.

3. [low] Missing integration coverage for settled $0 push hole (distinguish 0 from null/absent)
   - File: apps/tournament-api/src/services/scorecard.ts
   - Affirming sources: codex-review, gemini-critique-of-codex
   - Summary: The implementation correctly uses presence checks (map.has) to preserve a settled push hole as 0 rather than collapsing to null, but there is no end-to-end/integration test that locks this behavior in (especially across JSON, routing, and UI rendering expectations).
   - Recommended action: Add an integration/e2e test scenario where a hole is settled as a push and ensure the API returns moneyNet=0 for that hole (not null) and the consumer renders it as “$0”, while unsettled holes remain null/“—”.

## Divergent findings (need resolution)

1. How serious is the scorecard polling performance overhead (and is it truly “redundant”)?
   - Reviewers agree there is overhead, but disagree on characterization/severity because of the exposure gate and the inherent need for foursome-wide computation.
   - Positions:
     - **gemini-review** (Calls it redundant and low risk overall): "[medium] Redundant foursome settlement + ~10 duplicate DB queries on the polled scorecard route; load shared state once. Overall risk LOW."
     - **codex-critique-of-gemini** (Agrees directionally but says “redundant” is overstated): "Gemini's perf concern directionally valid but overstated as 'redundant' given the early exposure gate + the money needs foursome-wide data."
   - Synthesizer lean: Lean toward codex-critique-of-gemini: keep this as a Medium “should fix” optimization, not a blocker. The exposure gate limits how often the heavy path runs, and correct per-hole money inherently depends on foursome-wide state; the actionable improvement is query/state sharing rather than attempting to avoid settlement.

## Dismissed findings

1. “Overall risk LOW” (ignores course-revision divergence now that money is user-visible)
   - Raised by: gemini-review
   - Dismissal reason: disagreed_with_justification
   - Reasoning: Both critiques note Gemini missed the key correctness issue: the scorecard can read a different course revision than the pinned money computation, producing visible inconsistency; this elevates release risk to HOLD until fixed (codex-critique-of-gemini, gemini-critique-of-codex).

## Prioritized actions

1. [must_fix_before_send] Fix the HIGH correctness divergence: in buildPlayerScorecard, when a round_pin exists for the round, read par/si (course_holes) from round_pins.courseRevisionId (pinned) rather than event_round.courseRevisionId, so the scorecard’s net/par/si are derived from the same pinned course revision as computeF1PerHoleMoneyForPlayer. Also align holesToPlay sourcing across scorecard vs money (money uses event_round.holesToPlay; scorecard currently loops to rounds.holesToPlay) so the set of in-play holes is consistent.
2. [must_fix_before_send] Add a regression test for the post-pin edit scenario: pin a round, then modify course data by creating/selecting a different course revision for the event_round; assert the scorecard continues to use pinned course_holes for par/si/net and that displayed net inputs cannot disagree with money inputs.
3. [should_fix] Performance: reduce duplicate DB reads and settlement work on the polled scorecard route by sharing loaded state (round/eventRound/pin/course_holes) between the scorecard builder and per-hole money computation, or by creating a single internal query/build path that returns both scorecard holes and per-hole money with reused inputs.
4. [should_fix] Testing: add an integration/e2e test for a settled push hole to ensure moneyNet preserves an explicit 0 (distinct from null/unsettled) all the way through the API surface.
5. [optional] Documentation hygiene: update/clarify scorecard.ts doc-comments that currently claim the scorecard net “can never diverge from the money engine's net” given mixed courseRevisionId/holesToPlay sources; ensure comments match the post-fix reality.

## Open questions (for human judgment)

- Holes-to-play authority: should the scorecard UI always follow event_round.holesToPlay (as money does) or rounds.holesToPlay? If both can differ legitimately, what is the intended behavior when they conflict (and should the API throw vs pick one)?
- If a round has no pin: should the scorecard par/si come from event_round.courseRevisionId (current behavior) or should it attempt any fallback/consistency rule to reduce surprises before pinning?

## Warnings

None.
