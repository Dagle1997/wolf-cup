# Codex Review

- Generated: 2026-06-22T00:05:41.033Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/leaderboard.ts, apps/tournament-api/src/services/money-detail.ts, apps/tournament-api/src/services/games-money.disjointness.test.ts

## Summary

(1) Corrupt-but-schema-valid pinned CH (e.g., non-integer) no longer propagates an exception into the leaderboard or /foursome-results read paths: leaderboard wraps `allocateStrokesFromCourseHandicap` in a try/catch and fail-closes net to null (leaderboard.ts: 498-512), and /foursome-results’ F1 net cell computation does the same (money-detail.ts: 455-462). Pin JSON parse is also guarded on the leaderboard pin-load path (leaderboard.ts: 392-399).

(2) The leaderboard’s F1 net now matches the settlement holes-in-play behavior: pinned stroke-index is restricted to `holeNumber <= holesToPlay` (leaderboard.ts: 420-428) and the net build ignores holes without an in-play SI (leaderboard.ts: 499-506). This aligns the leaderboard’s F1 net with the settlement filter for 9-hole rounds.

(3) No concrete new money-safety regression is evidenced in the provided diff: non-F1 events still take the legacy proportional net path (leaderboard.ts: 525-547) and the legacy compute2v2BestBall money-detail path remains intact behind the non-F1 branch (money-detail.ts: 135-309).

Overall risk: low

## Findings

No concrete findings were identified from the supplied evidence.

## Strengths

- Fail-closed behavior for missing/corrupt pins is preserved: F1 rounds without a valid pin never fall back to live HI/course (leaderboard.ts: 516-524).
- Tenant scoping is applied on pin reads via joins and tenant predicates (leaderboard.ts: 372-389).
- Holes-in-play consistency hardening is explicit and localized to the pinned SI map and net computation (leaderboard.ts: 420-428, 499-506; money-detail.ts: 396-399).
- Blast-radius isolation: per-round/per-cell try/catch prevents a single corrupt value from crashing the whole response (leaderboard.ts: 498-512; money-detail.ts: 455-462).

## Warnings

- Truncated file content for review: apps/tournament-api/src/services/money-detail.ts
- Truncated file content for review: apps/tournament-api/src/services/games-money.disjointness.test.ts
