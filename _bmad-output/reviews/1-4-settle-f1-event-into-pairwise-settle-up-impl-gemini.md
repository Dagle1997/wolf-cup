# Gemini Review

- Generated: 2026-06-21T23:35:31.276Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/games-money.ts, apps/tournament-api/src/services/pin-round-at-start.ts, apps/tournament-api/src/services/money.ts, apps/tournament-api/src/services/money-detail.ts, apps/tournament-api/src/services/leaderboard.ts, apps/tournament-api/src/routes/money.ts, apps/tournament-api/src/routes/admin-event-rounds.ts, apps/tournament-api/src/engine/handicap-strokes.ts, apps/tournament-api/src/lib/env.ts, apps/tournament-api/src/services/games-money.test.ts, apps/tournament-api/src/services/games-money.disjointness.test.ts

## Summary

The F1 Epic 1 settlement integration achieves its major dual-read and deterministic pinning objectives. However, there are significant flaws in the "fail-closed" and "money-safety" guarantees. Missing handicaps are silently masked as scratch (0) instead of failing closed, F1 rounds with missing pins fall back to live-handicap computations (violating the immutable settlement rule), and strict engine assertions risk crashing the entire event-wide money computation.

Overall risk: high

## Findings

1. [high] Missing handicaps silently settle as scratch instead of failing closed
   - File: apps/tournament-api/src/services/pin-round-at-start.ts:152-165
   - Confidence: high
   - Why it matters: The PR claims to "fail-closed on missing handicap" (AC11). However, when a player's `hi` is `null`, `pin-round-at-start.ts` defaults their handicap to `0` and stores `{ hi: 0, ch: <scratch_ch> }` in the pin. Consequently, the safety check `h === undefined` in `games-money.ts` never triggers. A player missing a handicap index will silently settle their foursome's money under scratch math instead of safely marking the foursome as `unsettleable`.
   - Suggested fix: If `hi === null`, omit the player from `perPlayerHandicaps` entirely rather than defaulting to `0`. This ensures `games-money.ts` encounters an `undefined` entry and correctly triggers the `missing_handicap` fail-closed path.

2. [high] F1 event leaderboard falls back to live handicap when round pin is missing
   - File: apps/tournament-api/src/services/leaderboard.ts:438-445
   - Confidence: high
   - Why it matters: AC5 strictly requires that an unsettled F1 round "is fail-closed (unsettleable) on read, never settled against live data." If an F1 round lacks a pin (or has a corrupt one), `loadF1RoundPins` simply omits it from the map. The loop then skips the F1 branch and falls through to the legacy `accum.handicapIndex === null` logic, computing a proportional net score using the player's live, unpinned `handicapIndex`.
   - Suggested fix: Modify `loadF1RoundPins` to return both the pins Map and an `isF1` boolean. In `assignRanksAndBuildRows`, if `isF1` is true but `pin` is undefined, explicitly set `netComputable = false` and `break` instead of allowing execution to fall through to the legacy non-F1 branch.

3. [high] F1 settlement crashes if pinned CH or SI triggers an engine throw
   - File: apps/tournament-api/src/services/games-money.ts:363-365
   - Confidence: high
   - Why it matters: The `allocateStrokesFromCourseHandicap` kernel strictly throws `TypeError` or `RangeError` if the course handicap is a float or if the stroke index isn't `1..18`. Because `games-money.ts` only checks `Number.isFinite(h.ch)` (which allows floats) and doesn't sanitize `si`, a corrupted pin or invalid hole row will throw synchronously. Because there is no `try/catch` encompassing the `allocateStrokesFromCourseHandicap` call, this breaks the AC11 isolation contract and crashes the entire event's money computation.
   - Suggested fix: Change the check on line 331 to `Number.isInteger(h.ch)`. Additionally, wrap the `netByHole` computation loop in a `try/catch` block that surfaces an `unsettleable` result if an allocation throw occurs.

4. [low] Event-scope leaderboard surfaces the last round's pinned CH instead of nullifying it
   - File: apps/tournament-api/src/services/leaderboard.ts:416-422
   - Confidence: high
   - Why it matters: The comments state: "Surface a single pinned CH only when the player has exactly one F1 round in scope... otherwise null". However, the code continuously overwrites `pinnedCH` during the `accum.perRound` loop. For an event-scope read across multiple rounds, it does not default to `null` but instead misleadingly exposes the CH from the last processed round.
   - Suggested fix: When constructing the `partial` array row on line 469, verify `accum.perRound.size === 1`. If there is more than one round, explicitly set `courseHandicap` and `pinnedHandicapIndex` to `null`.

## Strengths

- The deterministic F1 routing in the `computeMoneyMatrix` acts as a solid dual-read boundary, averting legacy double-counting while preserving standard individual bets.
- The audience-bounding redaction correctly strips other players' dollars in the unlocked matrix state, adhering tightly to the scores-only visibility intent.
- Engine testing leverages fast-check properties to forcefully prove the zero-sum ledger mathematical invariants.

## Warnings

- Truncated file content for review: apps/tournament-api/src/routes/admin-event-rounds.ts
