# Codex Review

- Generated: 2026-06-01T15:49:25.502Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: packages/engine/src/odds.ts, apps/api/src/routes/scouting.ts, packages/engine/src/rng.ts

## Summary

Round-1 findings F1–F7 appear genuinely resolved in the engine/odds core (notably: computeOddsLine now normalizes ordering; favorite odds are capped; recency horizon uses priorRoundCount−1; dead-heat handling is deterministic; ledger no longer does quadratic scans). However, the fixes/added blocks introduced a couple of concrete regressions/edge bugs: (1) the route-level try/catch for the odds block can incorrectly wipe out a valid odds line if only the retrospective DB read fails, and (2) the house-ledger “last week winner” baseline is still order-dependent on ties (and also wrong when N=1).

Overall risk: medium

## Findings

1. [high] Odds line can be incorrectly downgraded to gated if ONLY retrospective fails (try/catch scopes too wide)
   - File: apps/api/src/routes/scouting.ts:131-161
   - Confidence: high
   - Why it matters: The error-isolation fix (F6) is intended to prevent additive blocks from 500’ing, but the current implementation couples unrelated work: computeOddsLine + buildRetrospective are inside the same try/catch. If buildRetrospective throws (e.g., transient DB issue, schema mismatch, or harvey_results access failure), the catch block sets `odds = { gated: true, reason: 'odds unavailable' }` even though the odds line may have been successfully computed. That is a functional regression: consumers lose the core “odds” output due to a retrospective-only failure.
   - Suggested fix: Split the logic into separate try/catch blocks so retrospective failure cannot overwrite a valid odds line. Example: (a) compute odds in its own try; (b) if round.status==='finalized', wrap buildRetrospective in a narrower try/catch that only nulls retrospective while preserving `odds`.

2. [medium] House-ledger last-week baseline is still non-deterministic on dead-heats (depends on DB row order)
   - File: apps/api/src/routes/scouting.ts:608-625
   - Confidence: high
   - Why it matters: You fixed deterministic winner selection for the *current* week (winners sorted) and for retrospective grading. But the “lastWeek” baseline chooses `prevWinner` by scanning `prevRoster` and only updating on `v > mx` (strict). If two members tie for top Harvey points last week, the first encountered in `prevRoster` wins the tie-break. `prevRoster` comes from `rosterByRound` built from an unordered query (no ORDER BY), so the picked `prevWinner` (and thus `lastWeekMap`, and logloss/brier baselines/CI) can change across reads/query plans.
   - Suggested fix: Make tie-breaking deterministic: compute the full co-winner set for prev week and either (a) pick `Math.min(...coWinners)`; or (b) split LAST_WEEK_P mass across all co-winners. Also consider sorting `prevRoster` by playerId before scanning as a backstop.

3. [medium] House-ledger last-week baseline produces an invalid probability distribution when N=1
   - File: apps/api/src/routes/scouting.ts:620-625
   - Confidence: high
   - Why it matters: When `N = memberList.length` equals 1, `others = (1 - LAST_WEEK_P) / Math.max(1, N - 1)` becomes `(1 - p)/1`, and the loop sets the only member to `LAST_WEEK_P` (0.5) if they are `prevWinner`. That yields a total probability sum of 0.5 instead of 1. This directly corrupts `logLossAndBrier(lastWeekMap, ...)` outputs for those weeks.
   - Suggested fix: Special-case N<=1: if N===1, set that member’s probability to 1. More generally, build `lastWeekMap` by normalization (sum then divide) or by explicitly ensuring probabilities sum to 1 across `memberList`.

4. [medium] Retrospective can mis-grade if harvey_results contains rows for players not in the round roster (missing players treated as members)
   - File: apps/api/src/routes/scouting.ts:390-407
   - Confidence: medium
   - Why it matters: `isSubOf` is built only from `roster`. Any `harvey_results` row whose `playerId` is absent from `roster` yields `isSubOf.get(...) === undefined`, which is treated as falsy, so that player is treated as a member for winner selection (`memberMax`/`winnerSet`). If data ever contains extra harvey_results rows (bad import, stale rows, etc.), retrospective can declare an impossible “member winner” not in the pairing roster and label verdicts incorrectly.
   - Suggested fix: Filter `hr` to roster playerIds up front (e.g., `const rosterSet = new Set(roster.map(r=>r.playerId)); const hrInRound = hr.filter(h=>rosterSet.has(h.playerId));`). Optionally treat missing roster entries as invalid and return null to avoid mis-grading.

5. [low] computeOddsLine can return impliedProb > 1 for heavy favorites (API field may violate probability expectations)
   - File: packages/engine/src/odds.ts:286-305
   - Confidence: high
   - Why it matters: With proportional overround, `impliedProb = fairProb * OVERROUND` can exceed 1 when `fairProb > 1/OVERROUND` (~0.847 at 1.18). You fixed the absurd American conversion by clamping/capping in probToAmerican, but `impliedProb` is still returned un-clamped in each line. If any consumer/UI assumes impliedProb ∈ [0,1], it can display nonsense (e.g., 101% implied) or break validation.
   - Suggested fix: Either clamp `impliedProb` to <1 for output (keeping an internal unclamped value for pricing), or rename/document it as “rawImpliedBeforeClamp”. If you clamp, ensure effectiveHold continues to be computed from postedAmerican (as now).

## Strengths

- F1 determinism: computeOddsLine now explicitly sorts field by playerId, each member history by orderIndex (with deterministic tie-break), and subPrior tuples (packages/engine/src/odds.ts:169-182). This removes DB-row-order dependence in the RNG stream and pickWeightedIndex traversal.
- F2 favorite cap: probToAmerican now clamps favorite-side prices to −FAVORITE_CAP and constants pin FAVORITE_CAP=10000 (packages/engine/src/odds.ts:53-63, 142-153, 291). No obvious NaN/sign issues in effectiveHold recomputation.
- F4 recency anchor: horizon uses priorRoundCount−1, fixing the “max observed orderIndex” anchoring bug (packages/engine/src/odds.ts:210-217). Ledger passes priorRoundCount consistent with the number of prior rounds (apps/api/src/routes/scouting.ts:531-552).
- F5 perf: ledger pre-indexes results into Map(round→player→result), eliminating nested filter/find scans (apps/api/src/routes/scouting.ts:510-517, 533-549).
- F7 dead-heats: retrospective computes and grades on the full co-winner set and chooses lowest-id for display; ledger winners are sorted for deterministic selection (apps/api/src/routes/scouting.ts:403-407, 560-563).

## Warnings

None.
