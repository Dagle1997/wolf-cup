# Codex Review

- Generated: 2026-06-23T16:23:42.521Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/3-3-per-hole-f1-money-or-defer-party-review.md, apps/tournament-api/src/services/scorecard.ts, apps/tournament-api/src/services/games-money.ts

## Summary

The implementation does add per-hole F1 money to the scorecard via a single chokepoint (settleFoursome → computeFoursome) and preserves the “$0 vs —” distinction correctly using Map.has(). However, the party review overstates some money-safety guarantees and (based on only the provided diff/files) overclaims test coverage. There is also a potentially serious money-exposure fail-open default around lock state, and an unpinned (mutable) dependency on event_round.holes_to_play that can change recomputed money after a pin.

Overall risk: high

## Findings

1. [high] Money exposure gate is fail-open when lock_state is unexpected (defaults to locked)
   - File: apps/tournament-api/src/services/games-money.ts:549-563
   - Confidence: high
   - Why it matters: computeF1PerHoleMoneyForPlayer is intended to return money only when the event is locked. But it interprets ANY lockState other than the literal string 'unlocked' as 'locked' (lines 561-562). If lock_state is ever NULL/corrupt/migrated/new value, this will expose per-hole money when it should be hidden. This is a money/audience safety issue and needs a human decision if relying on DB constraints is acceptable.

Related: computeF1EventEdges similarly defaults unknown lock_state to 'locked' (lines 165-168), so this exposure behavior is systemic, not just scorecard.
   - Suggested fix: Treat unknown/invalid lock_state as 'unlocked' (fail-closed), or validate against an enum and return null/blocked on invalid. If DB guarantees correctness, add an explicit comment + invariant test/migration constraint to make that guarantee real.

2. [high] Party review claims “hole count is pinned” / frozen, but implementation reads holesToPlay live from event_round
   - File: apps/tournament-api/src/services/games-money.ts:564-571
   - Confidence: high
   - Why it matters: Money recomputation depends on eventRounds.holesToPlay at read time (also in computeF1EventEdges at 174-177 and 245-246). That value is not read from the round pin, so changing holes_to_play after round start can change both settlement and per-hole money despite the “pinned inputs” narrative. The party review/headers describe hole count as part of pinned safety, which is not true in the shown code.
   - Suggested fix: If holes_to_play must be money-safe, persist it into round_pins at pin time and read it from the pin; or enforce/lock event_round immutability after round start and document that operational invariant explicitly (and ideally enforce in code/DB).

3. [medium] Settlement proceeds with partial/incomplete course_holes for an in-play round; scorecard throws instead
   - File: apps/tournament-api/src/services/games-money.ts:589-603
   - Confidence: high
   - Why it matters: computeF1PerHoleMoneyForPlayer only checks holesInPlay.length === 0, not that holes 1..holesToPlay exist. If a pinned revision is missing some in-play holes, money settlement will silently run on the subset present (and may produce a misleading per-hole map). Meanwhile scorecard.ts will throw a 500 when an in-play hole row is missing (scorecard.ts 223-229). This creates inconsistent behavior and risks showing money computed on incomplete course data.
   - Suggested fix: Validate that the pinned revision has a complete hole set for 1..holesToPlay (or whatever the supported hole numbering policy is). If incomplete, fail-closed (return null/unsettleable) so money cannot be shown on partial inputs.

4. [medium] Missing ledger.perHole is silently treated as “no settled holes,” which can mask a real engine regression
   - File: apps/tournament-api/src/services/games-money.ts:463-471
   - Confidence: medium
   - Why it matters: settleFoursome returns perHole: ledger.perHole ?? []. If ledger.perHole is unexpectedly absent (type suggests optional), the scorecard will show moneyNet = null for every hole even though edges/round money may exist. That degrades Story 3-3 behavior silently and could ship unnoticed.
   - Suggested fix: If Story 3-3 requires perHole always present for settled holes, treat missing perHole as an internal error/unsettleable result (fail-closed) or at least log/telemetry it so the regression is detectable.

5. [low] Party review’s QA/test claims are not verifiable from the provided diff/files
   - File: _bmad-output/reviews/3-3-per-hole-f1-money-or-defer-party-review.md:46-58
   - Confidence: high
   - Why it matters: The party review asserts extensive new test coverage (service chokepoint tests, route integration tests, pinned-rev regression tests, etc.). None of that is present in the provided diff/file contents, so the written review materially overstates what can be evidenced here. This affects confidence in “SHIP” justification, even if tests exist elsewhere.
   - Suggested fix: If those tests exist outside this diff, link them explicitly (file paths) in the review record. If they don’t, add at least one targeted test for the high-risk exposure gate + $0 preservation + holesToPlay immutability/pin assumptions.

## Strengths

- Scorecard correctly preserves settled push holes as $0 using Map.has() rather than falsy coalescing (scorecard.ts 247-251).
- Per-hole money is derived via the same settleFoursome chokepoint used for event settlement, preventing a second independent money calculation path.
- Money is tenant-scoped on all shown queries, and computeF1PerHoleMoneyForPlayer fail-closes to null in many anomaly cases (missing round/eventRound/pin, player not in pairing, unsettleable).
- Scorecard’s par/si sourcing from the pinned revision (when present) is an architectural improvement for consistency with pinned settlement inputs.

## Warnings

None.
