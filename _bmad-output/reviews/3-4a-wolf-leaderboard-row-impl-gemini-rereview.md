# Gemini Review

- Generated: 2026-06-23T18:59:36.786Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/leaderboard.ts, apps/tournament-api/src/routes/events-leaderboard.ts, apps/tournament-web/src/routes/events.$eventId.leaderboard.test.tsx, apps/tournament-api/src/services/leaderboard.test.ts

## Summary

The previous High severity issue involving out-of-play stray holes inflating `netToPar` has been successfully resolved. The net-to-par calculation now mirrors the net-in-play logic precisely, ensuring stability. Additionally, the added protections preventing the settlement engine from crashing the leaderboard endpoint, along with comprehensive UI tests for money suppression and UI interactions, represent strong stability and functionality improvements. No new bugs or regressions found.

Overall risk: low

## Findings

No concrete findings were identified from the supplied evidence.

## Strengths

- Gracefully degrading the `moneyCents` column to `null` on settlement-engine errors prevents 500s in critical scoring paths.
- Comprehensive test coverage added for all new functionality, specifically for the edge cases around money gating, multi-expand scorecard, and the `netToPar` zero-reconciliation.
- Precise matching of in-play scoping using the pinned `siByHole` for F1 events prevents scoring state anomalies.
- Properly using an environment check before triggering any F1 sub-game resolution logic is an excellent efficiency optimization.

## Warnings

- Truncated file content for review: apps/tournament-api/src/services/leaderboard.ts
