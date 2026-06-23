# Codex Review

- Generated: 2026-06-23T18:51:50.808Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/leaderboard.ts, apps/tournament-api/src/routes/events-leaderboard.ts, apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx, apps/tournament-web/src/routes/events.$eventId.leaderboard.test.tsx, apps/tournament-api/src/services/leaderboard.test.ts

## Summary

Adds netToPar to leaderboard rows (par-of-scored-holes) and moneyCents to the leaderboard route (scope-summed F1 edges), plus a Wolf-lean web row with multi-open expandable scorecards. The core logic is close, but there are a few concrete correctness/reliability risks: (1) money aggregation calls computeF1EventEdges even when money isn’t exposed, so a money-engine failure can now 500 the leaderboard in scores-only/non-F1; (2) netToPar can diverge from F1 net in the presence of out-of-play holes (holesToPlay) and possibly pinned-vs-eventRound course revision differences; (3) the web’s money formatting truncates cents (potential misstatement if cents aren’t whole dollars); (4) tests don’t cover the new route-level moneyCents aggregation/exposure gate and the web tests don’t assert moneyCents is null/“—” outside money mode (they currently hardcode moneyCents even in scores_only fixtures).

Overall risk: medium

## Findings

1. [high] Leaderboard endpoint can now fail (500) due to money-edge computation even when money isn’t exposed
   - File: apps/tournament-api/src/routes/events-leaderboard.ts:49-63
   - Confidence: high
   - Why it matters: computeScopeMoneyByPlayer always calls computeF1EventEdges() first (line 53) and only then checks the exposure gate (locked + flag). If computeF1EventEdges throws or depends on pinned data that’s missing/corrupt, the entire leaderboard request will be caught by the route-level try/catch and return 500 (lines 207–240), even for scores-only/unlocked mode or when TOURNAMENT_F1_MONEY_ENABLED is off. That’s a reliability regression: the leaderboard previously depended only on computeLeaderboard.
   - Suggested fix: Gate before calling computeF1EventEdges. Example: call resolveF1Mode(eventId) (or a minimal game_config lookup) first; if not (isF1 && lockState==='locked' && f1MoneyEnabled()) then return null without calling computeF1EventEdges. Also consider wrapping computeF1EventEdges in its own try/catch and degrade to null (moneyCents null) on failure while still returning the base leaderboard rows.

2. [medium] netToPar may diverge from F1 net due to holesToPlay/out-of-play handling and pinned-vs-eventRound course revision choice
   - File: apps/tournament-api/src/services/leaderboard.ts:292-618
   - Confidence: high
   - Why it matters: Two divergence vectors:
1) F1 net allocation explicitly skips out-of-play holes using the pinned SI map (siByHole restricted to holesToPlay) (lines ~545–549), but netToPar sums par for *all* scored holes in perRoundHoleGross (lines 601–615) without any holesToPlay/SI filter. If stray hole_scores exist beyond holesToPlay (which your F1 net path intentionally ignores), netToPar will include those holes’ par and produce an inconsistent “To Par” vs the computed net.
2) parByRoundHole is loaded from eventRounds.courseRevisionId (lines 292–307), while F1 net is based on the pinned courseRevisionId from roundPins. The comment asserts par is stable across revisions, but that’s an assumption; if pars differ across revisions, To Par will not reconcile with the net calculation basis and could confuse users in locked money mode.
   - Suggested fix: (Mechanically fixable) When computing totalPar for netToPar, align the hole set with the same hole inclusion rules used for netSum:
- If there’s an F1 pin for the round, only include holes where pin.siByHole has an entry (i.e., holes in play), mirroring the net loop.
- Optionally also exclude holes > holesToPlay for non-F1 rounds if that’s a leaderboard invariant.
(Human decision / FD-?) Decide whether To Par must use the pinned courseRevision’s par for F1 rounds to avoid revision drift; if yes, load par from the pin’s courseRevisionId when pin exists, otherwise from eventRounds.courseRevisionId.

3. [medium] moneyCents route behavior (aggregation + exposure gating + round scope filtering) is not tested; web tests don’t assert $ is suppressed outside money mode
   - File: apps/tournament-web/src/routes/events.$eventId.leaderboard.test.tsx:52-168
   - Confidence: high
   - Why it matters: The new moneyCents field is computed in the API route, but there are no tests in this diff that validate:
- sign correctness (to=+, from=−),
- round-scope filtering by sourceId prefix `${roundId}:`,
- exposure gating (non-F1 / unlocked / flag off) returning null (not 0),
- behavior for players with no edges in money mode producing $0.
Additionally, the web tests construct leaderboard fixtures that always include moneyCents values even when f1.mode is 'scores_only' (leaderboard() helper rows hardcode moneyCents at lines ~60–62). Since the UI always renders the $ column from row.moneyCents (no additional UI gate), these tests would still pass even if the UI incorrectly showed money in scores-only mode (because the fixture wrongly supplies it).
   - Suggested fix: Add tournament-api route-level tests for GET /api/events/:eventId/leaderboard that stub/seed F1 edges and assert:
- in locked+flag mode: per-player cents sums match expected,
- in round scope: only edges with sourceId starting `${roundId}:` are included,
- in unlocked or flag-off: moneyCents is null for all rows.
Update web tests’ leaderboard() fixture builder so that when mode!=='money' or moneyEnabled===false, it sets moneyCents:null (matching the contract). Add an assertion that in scores_only (or moneyEnabled=false) the table shows '—' (not +$15).

4. [low] formatMoneyCents truncates cents to whole dollars and can misstate values if cents aren’t multiples of 100
   - File: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx:126-132
   - Confidence: high
   - Why it matters: formatMoneyCents uses Math.trunc(cents/100) and then displays only whole dollars. If cents can ever be non-multiples of 100 (future config changes, different games, fractional settlements), the display will be wrong (e.g., 150 → +$1 instead of +$1.50; -50 → $0). The comments suggest “whole-dollar F1 Guyan money”, but the route/API contract is still “integer cents”, so this is a latent correctness footgun.
   - Suggested fix: Either (a) enforce/validate at the API boundary that moneyCents is always a multiple of 100 for this page and render '—' or round safely when not, or (b) format with dollars+two-decimal cents (reusing the existing format-cents logic you removed from skins). If whole-dollar display is desired, consider rounding (Math.round) and explicitly documenting/guarding the invariant.

## Strengths

- netToPar computation is fail-closed: it stays null when net isn’t computable or par data is missing (apps/tournament-api/src/services/leaderboard.ts:594–618).
- moneyCents is added additively at the route layer without changing the underlying LeaderboardRow contract; the API still includes gross/net/skins/CH fields (route maps baseRows and spreads).
- Multi-open expansion state is correctly implemented with immutable Set updates (new Set(prev)) and scope toggle clears expanded state to prevent unwanted refetches.

## Warnings

- Truncated file content for review: apps/tournament-api/src/services/leaderboard.ts
