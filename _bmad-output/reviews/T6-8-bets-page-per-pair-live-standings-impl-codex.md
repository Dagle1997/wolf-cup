# Codex Review

- Generated: 2026-05-04T20:58:03.804Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/bets.ts, apps/tournament-web/src/routes/events.$eventId.bets.tsx, apps/tournament-web/src/routes/events.$eventId.bets.test.tsx, apps/tournament-api/src/routes/bets.integration.test.ts

## Summary

API endpoints and web route largely match the story: /bets/mine is participant-gated and only returns bets where viewer is a party; /bets/:betId enforces UUID format (400) and uses a uniform 403 not_party_to_bet for not-found/wrong-event/non-party, satisfying the “no existence leak” goal. Sign flip is implemented for both total and per-round.

Main correctness risks are in computeBetStandingForViewer: it can silently drop rounds (and even whole bets in the list endpoint) when “structural” data is missing, while still returning the original applicableRoundIds; press ordering/id handling is also potentially nondeterministic/unstable. Test coverage is good for the access-control invariants, but does not actually assert perRoundStanding sign-flip nor holesPlayed counting edge cases.

Overall risk: medium

## Findings

1. [high] computeBetStandingForViewer can return partial rounds but still reports full applicableRoundIds (contract mismatch)
   - File: apps/tournament-api/src/routes/bets.ts:420-533
   - Confidence: high
   - Why it matters: The function comment says it returns null “if any structural data is missing … caller treats as skip this bet”, but the implementation uses `continue` when a round is missing pieces (event_round, runtime round, tee, course revision) and proceeds with the remaining rounds. This creates a concrete inconsistency: `applicableRoundIds` is always derived from individualBetRounds (all configured rounds), but `engineOut.perRound` (and thus `perRoundStanding`) will only include the subset of rounds successfully assembled. Clients may think a bet applies to rounds that never appear in perRoundStanding, and the total may effectively be computed from only a subset of rounds.
   - Suggested fix: Decide on one behavior and enforce it:
- If spec requires “all-or-nothing”, then when any applicable round can’t be assembled, return null (or throw) immediately rather than `continue`.
- If partial computation is allowed, then also filter `applicableRoundIds` down to the rounds actually included in `applicableRoundsForEngine`/`engineOut.perRound`, and consider including a warning/flag that some rounds are unavailable.

2. [medium] GET /bets/mine silently skips bets that fail compute (data loss in response)
   - File: apps/tournament-api/src/routes/bets.ts:690-694
   - Confidence: high
   - Why it matters: In `/bets/mine`, any bet for which computeBetStandingForViewer returns null is simply omitted from the returned list. That can make a real bet “disappear” for a user due to a transient DB inconsistency (missing runtime round row, missing tee row, bad configJson, engine throw), with no error surfaced. This is especially risky for live standings/visibility: users may interpret “no bets” as no action needed when the system is actually failing to compute.
   - Suggested fix: Prefer returning an explicit error (500) if any of the viewer’s bets cannot be computed, or include the bet with a degraded payload (e.g., computed=false + reason) so the UI can show “standing unavailable”. At minimum, log with betId and include count of skipped bets.

3. [medium] Press rows are loaded without deterministic ordering; engine behavior may depend on order
   - File: apps/tournament-api/src/routes/bets.ts:535-562
   - Confidence: medium
   - Why it matters: `individualBetPresses` are selected with no `orderBy`, then pushed into `pressesByRound` in DB-return order. If the engine assumes presses are applied in firedAtHole order (common for match-play press logic), nondeterministic DB ordering can yield incorrect or flaky standings/triggeredPresses output.
   - Suggested fix: Add `orderBy(individualBetPresses.firedAtRoundId, individualBetPresses.firedAtHole, individualBetPresses.createdAt?)` (whatever columns exist) and/or explicitly sort each round’s list by firedAtHole before passing to the engine.

4. [medium] API may emit empty betPressId (""), causing unstable identifiers (and React key collisions)
   - File: apps/tournament-api/src/routes/bets.ts:631-637
   - Confidence: high
   - Why it matters: `betPressId: p.id ?? ''` can produce an empty string id for triggered presses if the engine produces presses without ids (e.g., derived/auto presses). This can lead to duplicate identifiers in the API response and downstream UI issues (e.g., `key={p.betPressId}` collisions) or inability to correlate press history entries.
   - Suggested fix: Guarantee a stable unique id in the response. If DB ids aren’t available, synthesize one (e.g., `${p.firedAtRoundId}:${p.firedAtHole}:${p.triggerType}:${p.multiplier}:${index}`) and keep the DB id in a separate optional field if needed.

5. [low] Potential N+1 / over-fetching in /bets/mine (loads all event bets then per-bet/per-round queries)
   - File: apps/tournament-api/src/routes/bets.ts:669-694
   - Confidence: high
   - Why it matters: The handler selects all bets for the event (including bets the viewer is not party to) and then does heavy per-bet engine-input assembly with multiple queries per applicable round. This is likely acceptable for v1, but it will scale poorly as events/bets grow and may add latency to a page that polls every 15s.
   - Suggested fix: At minimum, filter in SQL (`where eventId AND (playerAId=viewer OR playerBId=viewer)`). Longer-term: batch-load per-eventRounds, runtime rounds, tees, course holes, hole scores, and presses for all relevant bets to reduce query count.

6. [low] Tests don’t assert perRoundStanding sign-flip or holesPlayed edge cases (spec concerns)
   - File: apps/tournament-api/src/routes/bets.integration.test.ts:582-624
   - Confidence: high
   - Why it matters: The story explicitly calls out “sign-flip correctness on perRoundStanding (not just totalNet)” and holesPlayed counting logic (“BOTH parties scored AND ≤ holesToPlay”). Current tests validate totalNet sign flip with real scores, but do not assert `perRoundStanding[].netToViewerCents` flips, nor that holesPlayed ignores holes where only one party has a score or holes beyond holesToPlay.
   - Suggested fix: Extend test (e) to assert `perRoundStanding[0].netToViewerCents` is +500 for viewer A and -500 for viewer B. Add a holesPlayed test: insert only one player’s score on hole 2 and ensure holesPlayed remains 1; and/or set holesToPlay=9 and insert scores for hole 10 and ensure it’s not counted.

## Strengths

- /bets/:betId enforces uniform 403 not_party_to_bet for not-found/wrong-event/non-party, preventing existence leaks in those cases (and has integration tests for unknown and wrong-event ids).
- Sign flip is applied to both total net and per-round net (netToViewerCents), aligning with the viewer perspective goal.
- holesPlayed counting explicitly requires both parties to have scores and bounds by holesToPlay, matching the described logic.
- Web page uses no-store fetch + polling cadence, and has smoke tests for happy/empty/403 states.

## Warnings

None.
