# Codex Review

- Generated: 2026-06-23T16:39:42.014Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/3-4-during-round-leaderboard-rework-expandable.md

## Summary

The prior issues you listed appear resolved in this spec: (H1) showMoney vs per-hole nullability is now clearly separated (AC4); (H2) the moneyNet=0/null/$5 cases are explicitly scoped to played holes (AC7); (M3) single-open is decided via expandedPlayerId (AC1); (M4) refetchInterval 15s while open is decided (AC2); (M5) round.id (not eventRoundId) is enforced in AC2 + a dedicated test (AC7); (L6) a11y now explicitly requires aria-controls (AC1). No new HIGH-severity issues are introduced by the spec text.

Overall risk: low

## Findings

1. [medium] No explicit coverage/expectation for negative moneyNet display (moneyNet is player-signed)
   - File: _bmad-output/implementation-artifacts/tournament/3-4-during-round-leaderboard-rework-expandable.md:23-47
   - Confidence: medium
   - Why it matters: The spec states moneyNet is “player-signed” (line 23), so negative values are expected in real play. AC7 tests only cover +$5, 0, and null (line 46) and do not specify how a negative amount must render. If the existing formatter is effectively `+$${amount}` as described (line 27), a negative could display awkwardly (e.g., "+$-5") or otherwise inconsistently, and this story is where that UI becomes visible on the live board.
   - Suggested fix: Add an explicit AC/test case for a negative played-hole moneyNet (e.g., -500 cents → -$5) and clarify the expected string. If the current ScorecardGrid formatting can’t produce that, call it out as a follow-up or adjust the formatter/adapter behavior accordingly (while keeping cents→dollars conversion).

## Strengths

- AC4 now cleanly resolves the showMoney-vs-per-hole moneyNet confusion by defining showMoney as the $-row visibility gate and leaving cell rendering to the grid’s null/0/value handling.
- AC2/AC7 explicitly guards the round.id vs eventRoundId regression with a URL assertion test.
- Single-open behavior + 15s refetch while expanded are clearly decided, limiting fetch fan-out while keeping an open panel live-fresh.
- Error handling is scoped to inline UI (loading/error/unavailable) so the main board remains usable.

## Warnings

None.
