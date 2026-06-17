# Codex Review

- Generated: 2026-06-17T15:53:32.783Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/match-play-standings.ts, apps/tournament-api/src/services/money-detail.ts, apps/tournament-api/src/services/team-standings.ts, apps/tournament-api/src/routes/money.ts, apps/tournament-api/src/routes/money.integration.test.ts, apps/tournament-web/src/routes/events.$eventId.match-play-standings.tsx, apps/tournament-web/src/routes/events.$eventId.index.tsx

## Summary

Phase 2 match-play standings is generally consistent with the existing 2v2 engine’s per-hole `winner` semantics and uses the same stable 2-man team key pattern as Phase 1. The main correctness risk is that the service treats any partially-scored round (≥1 completed hole) as a completed match and immediately awards win/halve/loss points, which can silently produce wrong standings during live scoring or if a round is left incomplete.

Overall risk: medium

## Findings

1. [high] Partially-scored rounds are counted as full matches and can award incorrect points/W-H-L
   - File: apps/tournament-api/src/services/match-play-standings.ts:111-148
   - Confidence: high
   - Why it matters: The code increments `matchesPlayed` and awards win/halve/loss points as soon as `completedHoles > 0` (line 124), using only holes whose `winner != null` (lines 114–121). If a round is mid-progress, the standings will award a full 1 / 0.5 / 0 result based on the *current* hole tally, which can flip later as more holes are completed. Worse, if scoring stops partway (e.g., only a few holes ever entered), the match will be permanently recorded as a win/halve/loss based on that partial snapshot—exactly the “half-finished match counting as halved” failure mode you called out.
   - Suggested fix: Only treat a foursome as a completed match when all holes in play are complete, e.g. require `completedHoles === foursome.perHole.length` (or compare against the round’s `holesToPlay`) before incrementing matchesPlayed / W-H-L / points. If you want live/in-progress display, return separate fields like `matchesInProgress` and/or compute a `currentStatus` without awarding points until completion.

2. [medium] Outcome logic assumes “most holes won after N holes” rather than true match-play closeout; can flip results if users enter strokes after match is decided
   - File: apps/tournament-api/src/services/match-play-standings.ts:14-21
   - Confidence: medium
   - Why it matters: The service defines match outcome as `aHoles > bHoles` over counted holes (lines 135–148) and explicitly states no early-closeout modeling (header comment). In real match play, once a team is up by more than the holes remaining, later holes do not change the match result. If players still enter gross scores on remaining holes “for fun” or for posting, counting those holes can incorrectly turn a win into a halve (e.g., 2 up with 2 to play, then lose the last 2: official win vs your algorithm’s tie). This is a silent, product-owner-visible correctness issue if the event is expected to follow match-play rules.
   - Suggested fix: If the product truly wants standard match play, compute match result by tracking running ‘holes up’ and stop counting once |up| > holesRemaining (or treat remaining as unplayed/conceded). If the product instead wants a ‘play all holes, most holes won’ variant, consider making that explicit in naming/UI copy to prevent expectations mismatch.

3. [low] Unscored events will often return non-empty `teams` (zeroed rows), preventing the web empty-state from showing
   - File: apps/tournament-api/src/services/match-play-standings.ts:107-125
   - Confidence: high
   - Why it matters: `ensureRow()` is called before the `completedHoles === 0` guard (lines 108–109 vs 124). For a configured round with pairings but no scores, `computeFoursomeResults` typically still returns a foursome with `perHole` winners all null, so standings returns 2 teams with 0 matches/points. The web route shows “No matches scored yet” only when `teams.length === 0` (apps/tournament-web/src/routes/events.$eventId.match-play-standings.tsx:97–103), so users may see a standings table full of zeros instead of the intended empty state.
   - Suggested fix: Decide desired UX. If you want the empty state until at least one match is actually scored, don’t create/retain rows unless the match is eligible to be counted (or add a separate `hasAnyCompletedHole` flag in the response and drive the empty state off that).

4. [low] Test coverage misses critical tie/partial/9-hole behaviors that are most likely to hide silent wrong standings
   - File: apps/tournament-api/src/routes/money.integration.test.ts:688-744
   - Confidence: high
   - Why it matters: Current tests cover (a) full 18-hole win and (b) no-scores → no phantom matches. They do not cover: partially-scored round (should it count?); an actual halved match; multiple rounds aggregation; 9-hole rounds; tie-break sorting when points equal (holesDiff/teamKey). Given the high impact of awarding 0.5/1.0 points incorrectly, these missing cases are where regressions or spec misunderstandings will slip through unnoticed.
   - Suggested fix: Add fixtures for: (1) only first N holes scored (assert no match counted, if that’s the intended rule), (2) exact tie on completed full round (assert 0.5 each), (3) holesToPlay=9, (4) two rounds with reshuffled foursomes but same team pairs, (5) deterministic ordering when points equal but holesDiff differs / equal.

## Strengths

- Correctly reuses `computeFoursomeResults`’s per-hole `winner` field (`teamA`/`teamB`/`tie`/`null`) and treats `null` as incomplete holes, aligning with money-detail/team-standings gating.
- Stable team bucketing via sorted player-id `teamKey` mirrors `team-standings.ts`, so the same pair aggregates across rounds even when foursomes reshuffle.
- Deterministic sort includes a final stable key tiebreaker (`teamKey.localeCompare`) and returns a simple, consistent response shape.
- Route is protected by the existing auth chain and sets `cache-control: no-store`; integration tests cover auth rejection and basic happy path.

## Warnings

None.
