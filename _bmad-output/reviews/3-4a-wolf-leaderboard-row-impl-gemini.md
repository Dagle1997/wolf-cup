# Gemini Review

- Generated: 2026-06-23T18:54:06.689Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/leaderboard.ts, apps/tournament-api/src/routes/events-leaderboard.ts, apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx, apps/tournament-web/src/routes/events.$eventId.leaderboard.test.tsx, apps/tournament-api/src/services/leaderboard.test.ts

## Summary

The PR successfully implements the Wolf lean layout leaderboard and integrates per-player F1 money via strict exposure gating. The front-end perfectly supports the multi-open scorecard interactions and whole-dollar parsing. However, the `netToPar` calculation contains a High-severity logic defect for F1 rounds where "out-of-play" stray holes incorrectly deflate a player's To-Par score. Testing must also be expanded to explicitly cover F1 round `netToPar` rules.

Overall risk: medium

## Findings

1. [high] `netToPar` incorrectly includes par for out-of-play stray holes in F1 rounds
   - File: apps/tournament-api/src/services/leaderboard.ts:601-613
   - Confidence: high
   - Why it matters: In F1 rounds, the `net` allocation loop (lines 544-550) deliberately ignores stray scores beyond `holesToPlay` to prevent them from impacting settled money. However, the `totalPar` calculation loop iterates over all scored holes (`holeGross.keys()`) and unconditionally adds their par. If a player logs a stray score (e.g., hole 10 on a 9-hole round), its par is added to `totalPar` while its net score is omitted from `netSum`. This inflates `totalPar`, artificially lowering the player's To-Par standing (e.g., falsely displaying -4 instead of E) and misrepresenting their leaderboard performance.
   - Suggested fix: Mirror the F1 `netSum` bounds check inside the `totalPar` loop by retrieving the round's pin and skipping holes missing from `siByHole`:
```typescript
const pin = f1RoundPins?.get(roundId);
for (const holeNumber of holeGross.keys()) {
  if (pin && pin.siByHole.get(holeNumber) === undefined) continue;
  const par = parMap.get(holeNumber);
  // ...
```

2. [medium] Missing F1-round tests for `netToPar` calculation
   - File: apps/tournament-api/src/services/leaderboard.test.ts:345-349
   - Confidence: high
   - Why it matters: The new unit test for `netToPar` (line 345) only validates the legacy proportional stroke-play path. It does not test F1-specific rounds, which use an entirely different, strictly-pinned stroke-index allocation path. Lacking tests for F1-specific behavior masks issues like the stray-hole defect identified above and leaves `netToPar` vulnerable to divergence regressions in money modes.
   - Suggested fix: Add a new test block that seeds an F1 event (containing a `game_config` row), posts a score that includes a stray hole beyond `holesToPlay`, and asserts that the computed `netToPar` ignores both the gross strokes and the par of the stray hole.

## Strengths

- Excellent implementation of the MULTI-open Wolf scorecard expansion using React `Set` state, allowing independent, persistent toggles.
- Strict implementation of the F1 money exposure gate (`isF1 && f1.lockState === 'locked' && f1MoneyEnabled()`), ensuring private money remains 100% private.
- Great fail-closed design on `netToPar` calculations (setting to `null` if any hole's par is missing) rather than crashing or showing disjointed partial aggregations.
- Clean, robust handling of Cents-to-Dollars formatting, correctly resolving signed $0 pushes and null-state dashes.

## Warnings

- Truncated file content for review: apps/tournament-api/src/services/leaderboard.ts
