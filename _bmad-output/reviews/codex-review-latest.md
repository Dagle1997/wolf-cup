# Codex Review

- Generated: 2026-06-19T04:08:33.033Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/api/src/services/bets.settlement.integration.test.ts, apps/api/src/services/bets.ts

## Summary

The test largely exercises the intended odds_win path end-to-end (DB seed → live while active → settle after finalized → settleUp math), and the dollar expectations you listed match the current services/bets.ts logic (profit-only on hit; stake on miss; House side excluded from settleUp). The main correctness risks are (a) state/order coupling across the three `it` blocks and (b) potentially ambiguous bet selection via `byBettor(...)` if additional bets are ever added with the same (subjectA, market), which could let the test assert against the wrong row while still going green.

Overall risk: medium

## Findings

1. [medium] Test cases are stateful/order-dependent: later assertions assume the round was finalized by a previous `it`
   - File: apps/api/src/services/bets.settlement.integration.test.ts:89-133
   - Confidence: high
   - Why it matters: `it("rolls up the right settle-up…")` (lines 121–133) assumes the round has already been flipped to `finalized` in the prior test (lines 97–119). If the runner ever shuffles test order, runs tests in isolation, retries only failures, or parallelizes within-file in the future, this can produce misleading results (either spurious failures or “green” runs that didn’t actually validate the live→finalized transition as intended for that specific assertion). Given this is meant to prevent false confidence before a live event, removing ordering assumptions makes the signal stronger.
   - Suggested fix: Make each `it` self-contained: in the settle-up test, explicitly set `rounds.status` to `finalized` (or assert it is finalized) before calling `getBetsBoard`. Alternatively, collapse the live→finalized→settleUp checks into a single `it` so the transition is proven within one test run.

2. [medium] `byBettor(subject, market)` lookup does not include bettor/layer/odds/stake, so it can silently select the wrong bet if duplicates appear
   - File: apps/api/src/services/bets.settlement.integration.test.ts:100-102
   - Confidence: high
   - Why it matters: Despite the helper name, the predicate is only `(subjectA.id, oddsMarket)`. Today it’s unique for your three seeded bets (P1/perfect_day, P2/money, P1/stableford), so it works. But if anyone adds another odds_win bet on the same subject+market (e.g., another bettor also backing P1 stableford), `find` will return the first match and the test could go green while validating the wrong row (classic false-confidence failure mode for money assertions).
   - Suggested fix: Disambiguate with additional identifiers that must be unique for the scenario: include `sideA.id` (bettor), `sideB?.id` (layer/house), and/or assert `amountDollars` and `odds` on the selected bet before asserting payout/winner. Even better: capture inserted bet IDs and select by `id`.

3. [low] Finalized-path test doesn’t assert the board’s round status is actually finalized (could hide a regression where the wrong round is read)
   - File: apps/api/src/services/bets.settlement.integration.test.ts:97-119
   - Confidence: medium
   - Why it matters: You update the round to `finalized` (line 98) and then assert settlement outcomes. If a regression caused `getBetsBoard(R)` to ignore `roundId` and instead return the active round, or if the update unexpectedly didn’t affect the row you think it did, the outcomes would likely stay `live` and the test would fail—so this isn’t a huge gap. But explicitly asserting `board.round?.id === R` and `board.round?.status === "finalized"` makes the test’s intent and failure mode clearer and reduces the chance of a confusing/partial false positive in future refactors (e.g., if bets were filtered/loaded from a different source).
   - Suggested fix: Add `expect(board.round?.id).toBe(R)` and `expect(board.round?.status).toBe("finalized")` in the finalized test (and similarly assert `"active"` in the live test).

## Strengths

- The seeded `round_results` values do make P1 the sole leader in stableford (40 vs 30/25/20) and money (30 vs 10/-5/-35), so each market has a non-null winner and perfect_day resolves to P1 under computeDayMarkets’ tie rules.
- Bet 1 assertions match americanProfit and odds_win semantics: +1650 on $100 returns profit 1650, winningSide 'A'.
- Bet 2 correctly asserts the miss payout equals the stake (50), not profit; it would fail if the code incorrectly used americanProfit(50, 300)=150.
- Bet 3 correctly exercises the vs-House path (sideB null) and asserts Carl wins 200 profit on +200 with $100 stake; also verifies `sideB` is null on the board object.
- Settle-up math and ledger direction are correctly asserted: Alice +1600, Bob -1600, Carl +200; House excluded; player-sum +200 (House loss).
- The live→finalized gating is meaningfully exercised because round_results already exist while status is active, yet the test expects all outcomes to remain `live` until status flips terminal.

## Warnings

None.
