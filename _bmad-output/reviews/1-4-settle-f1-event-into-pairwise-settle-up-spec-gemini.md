# Gemini Review

- Generated: 2026-06-21T22:48:36.745Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md

## Summary

The F1 settlement integration specification successfully establishes a central chokepoint and utilizes pinned handicaps for money safety. However, the proposed 1.4a/1.4b delivery split poses a critical risk of double-counting money and leaking financial data if shipped independently. Additionally, edge cases around retroactive F1 enablement (missing pins), leaderboard net calculation divergence, and the blast radius of 'fail-closed' states need explicit handling.

Overall risk: high

## Findings

1. [critical] 1.4a/1.4b split causes catastrophic double-counting and data leaks
   - File: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md:104-105
   - Confidence: high
   - Why it matters: The spec suggests shipping 1.4a independently of 1.4b if development stalls. Task 3 (1.4a) routes F1 edges into the live settle-up ledger. However, Task 6 (1.4b) contains the dual-read switch that disables legacy 2v2. Shipping 1.4a without 1.4b will cause BOTH the F1 and legacy 2v2 engines to run concurrently, massively double-counting money in production. Furthermore, missing 1.4b skips the audience visibility bounds (Task 8), leaking financial figures to unauthorized viewers.
   - Suggested fix: The dual-read switch (Task 6) and audience visibility bounds (Task 8) are strict prerequisites for wiring into the existing money routes (Task 3). They must be moved to 1.4a, or 1.4a must be completely hidden behind a feature flag until 1.4b is ready.

2. [high] Missing pin mechanism for rounds already in progress
   - File: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md:25-26
   - Confidence: high
   - Why it matters: AC5 dictates that a pin is created at the `in_progress` round-start transition. If an event is configured as F1 *after* rounds have already started, or if a manual override occurs mid-round, the round will have no pin. Because `games-money.ts` strictly requires a pin, the application will either crash or permanently fail to settle the game.
   - Suggested fix: Implement a fallback mechanism to safely generate the pin on the first read if it's missing (using a snapshot of current state), or provide an explicit admin utility to retroactively pin a round.

3. [high] Leaderboard calculation may diverge from pinned net
   - File: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md:24-25
   - Confidence: high
   - Why it matters: AC4 mandates that the net score `games-money.ts` uses matches the leaderboard's net. However, `games-money.ts` strictly derives net from the *pinned* Course Handicap (CH). If the leaderboard continues to derive net from the *live* Handicap Index, any mid-round HI change will cause the UI to diverge from the actual settlement math, breaking the reconciliation test.
   - Suggested fix: Explicitly state that the leaderboard must also read strictly from the `round_pin` for F1 events to calculate net scores, ensuring exact consistency with the settled money.

4. [medium] Fail-closed blast radius could lock the entire event's money page
   - File: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md:34-35
   - Confidence: high
   - Why it matters: A missing handicap or incomplete hole marks the game as 'unsettleable' and renders a 'Calculation paused' UI. If this failure state halts the entire pairwise settlement calculation, a single incomplete partial foursome could prevent all other valid groups in the event from viewing their settled money.
   - Suggested fix: Clarify that the 'unsettleable' state is isolated to the specific foursome/game instance, ensuring that edges from unaffected groups still settle and render correctly on shared event money pages.

5. [medium] Ambiguity regarding skins and bets coexistence in dual-read switch
   - File: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md:33-34
   - Confidence: high
   - Why it matters: AC10 explicitly states that 'legacy money.ts 2v2 + presses are OFF' for F1 events, but leaves the status of skins and other side bets unstated. It must be completely unambiguous whether they are intended to legitimately coexist or if they should also be disabled to prevent edge conflicts.
   - Suggested fix: Explicitly confirm in AC10 whether skins and other existing side bets remain ON or are turned OFF when the F1 event switch is active.

6. [low] Missing UI components in files list
   - File: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md:99-101
   - Confidence: high
   - Why it matters: AC7 and AC11 require modifications to the 'settle-up' and 'my-money' views. However, only `leaderboard.tsx` and `money.tsx` are listed in the 'Files this story will edit' section. Omitting these files may lead to missed scope during implementation and PR review.
   - Suggested fix: Add the web route files corresponding to the `settle-up` and `my-money` pages to the files list.

## Strengths

- Excellent adherence to the 'money-safety invariant' by enforcing read-time derivation strictly from pinned snapshots.
- Strong use of existing architectural seams (`ledgerToEdges`, `pinRound`, etc.), avoiding redundant calculation logic.
- Comprehensive test requirements, particularly the property-based zero-sum checks and the net-reconciliation assertions.

## Warnings

None.
