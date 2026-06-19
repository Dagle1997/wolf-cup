# Codex Review

- Generated: 2026-06-19T13:52:05.243Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/api/src/services/bets.ts, apps/api/src/routes/bets.ts, apps/web/src/routes/bets.history.tsx, apps/web/src/routes/bets.tsx, apps/api/src/services/bets.settlement.integration.test.ts

## Summary

Adds a new public API endpoint (/bets/history), a season aggregation service (getSeasonBetHistory), a web page to display it, and expands the existing odds_win integration test coverage to include season history + pendingCount.

Core aggregation logic largely reuses settleBet, which is the right approach for correctness parity with the live board. House (null sideB) handling is mostly correct (skipped from people ledger; player side still booked).

Overall risk: medium

## Findings

1. [medium] Season history “people” list includes participants from push outcomes (net $0), which can diverge from live board settle-up semantics and UI messaging
   - File: apps/api/src/services/bets.ts:446-473
   - Confidence: high
   - Why it matters: Acceptance criterion #1 says season net should match the live board’s settle-up for the same rounds. getBetsBoard’s settleUp only includes stakeholders who had money move (it never ‘touches’ stakeholders on push), while getSeasonBetHistory explicitly registers stakeholders even when the outcome is a push:
- touch() sets a 0 entry (line 448-450)
- touch() is called before the push early-return (lines 466-468)

This means a season with only pushes will return a non-empty people[] of $0 entries, while the board settleUp would be empty. That can also make the web page show a table of all $0 rows instead of the “No settled bets yet this season” empty state (apps/web/src/routes/bets.history.tsx lines 48-58).
   - Suggested fix: Decide the intended semantics:
- If pushes should be excluded from the season record roster, move touch() to only run for o.status === 'settled' (and maybe only when payout != 0), matching board behavior.
- If pushes should be included, adjust the acceptance expectation and consider changing the web empty-state logic/message to handle ‘settled but no net movement’ (all nets 0) distinctly.

2. [medium] Potential N+1 / unnecessary heavy computation per round in getSeasonBetHistory (computeStrokeTotals + computeDayMarkets per terminal round)
   - File: apps/api/src/services/bets.ts:452-474
   - Confidence: high
   - Why it matters: For each round that has at least one bet, getSeasonBetHistory runs:
- computeStrokeTotals(roundId, tee) (queries roundPlayers + holeScores)
- computeDayMarkets(roundId, true) (queries roundResults)

That’s 2+ queries per round, plus the initial rounds and bets queries. For a season with many rounds and/or many holeScores rows, /bets/history can become noticeably slow. It also computes stroke totals even for rounds whose bets are exclusively odds_win (which don’t use totals at all), and computes day markets even if there are no odds_win bets.
   - Suggested fix: Optimize by inspecting roundBets first:
- Only call computeStrokeTotals if the round has any betType !== 'odds_win'.
- Only call computeDayMarkets if the round has any betType === 'odds_win'.
If this endpoint becomes hot, consider batching totals/results fetches by roundId and computing in-memory to reduce query count.

## Strengths

- Correctly selects ‘current season’ via latest seasons.startDate, matching the stated rule (apps/api/src/services/bets.ts lines 419-423).
- Correctly excludes The House (null sideBPlayerId) from the per-person ledger while still booking wins/losses for the player side, preserving the intended non-zero-sum behavior (apps/api/src/services/bets.ts lines 466-473).
- Correct pending semantics for non-terminal rounds (counts all bets as pending) and for terminal rounds with ungradeable bets (settleBet returns 'live' → pendingCount++), avoiding incorrectly booking $0 outcomes (apps/api/src/services/bets.ts lines 454-465).
- Integration test expansion covers: current season selection, pendingCount while round active, aggregation parity after finalize, and House exclusion (apps/api/src/services/bets.settlement.integration.test.ts lines 100-171).
- API routes set cache-control: no-store consistently for both /bets and /bets/history (apps/api/src/routes/bets.ts lines 13-24).

## Warnings

None.
