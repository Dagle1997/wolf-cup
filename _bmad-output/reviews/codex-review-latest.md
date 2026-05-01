# Codex Review

- Generated: 2026-05-01T17:19:15.606Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/api/src/lib/side-game-calc-db.ts, apps/api/src/routes/leaderboard.ts, apps/api/src/routes/admin/side-games.ts, apps/api/src/routes/history.ts, apps/api/src/db/migrations/0028_skins_rename.sql

## Summary

The two Round 4 Medium issues appear addressed in principle (finalized-round skins gating and name-based skins identification/guard). However, there are still two concrete behavior gaps that can cause skins to disappear or never compute under certain real statuses / boot-order conditions. I don’t see any new High-severity security or data-loss bugs introduced, but these gaps are deploy-relevant because they undermine the “belt-and-suspenders” intent and can regress skins display in production edge cases.

Overall risk: medium

## Findings

1. [medium] Skins “boot-order belt” doesn’t work if calculationType is NULL: leaderboard won’t compute skins, and also won’t show stored winner
   - File: apps/api/src/routes/leaderboard.ts:284-351
   - Confidence: high
   - Why it matters: You added name-based detection (isSkinsGame) to handle legacy/partial migration rows, but the live-calculation branch still requires `activeSideGame.calculationType` to be truthy (line 291). If a legacy skins row has `name='Skins'` (or 'Most Skins') but `calculationType` is NULL, then:
- `isSkinsGame` becomes true (lines 284-288)
- the live compute block is skipped entirely because `activeSideGame.calculationType` is falsy (line 291)
- the finalized winner block is also skipped because `!isSkinsGame` is false (line 350)
Net effect: skins shows neither `sideGameSkinHolders` nor a winner, even though you intended name-based fallback coverage. This contradicts the comment about handling partial migrations / legacy seeds.
   - Suggested fix: Allow the skins path to run even when `calculationType` is NULL, e.g.:
- Change the `if` guard to `(activeSideGame.calculationType && activeSideGame.calculationType !== 'manual') || isSkinsGame`
- And pass a non-null calc type into `computeSideGameLeaderLive`, e.g. `calculationType: activeSideGame.calculationType ?? (isSkinsGame ? 'auto_skins' : null)`.
Add a regression test (or route-level test) for an activeSideGame with name 'Skins' and NULL calculationType to ensure `sideGameSkinHolders` is populated.

2. [medium] Skins completeness gate is only skipped for roundStatus === 'finalized', but other “finished” statuses (e.g. 'completed') may still incorrectly apply the gate
   - File: apps/api/src/lib/side-game-calc-db.ts:214-262
   - Confidence: medium
   - Why it matters: `computeSideGameLeaderLive` skips the skins per-hole completeness gate only when `roundStatus === 'finalized'` (lines 242-244). But your own status comment lists multiple terminal-ish statuses: `'finalized' | 'completed' | 'cancelled'` (line 219). Elsewhere, `/leaderboard/history` explicitly includes `'completed'` rounds, and `buildLeaderboard` computes live side-game leaders for any status other than exactly `'finalized'` (apps/api/src/routes/leaderboard.ts:289-294). If a round is effectively “done” but stored as `completed` (or another terminal status you use operationally), skins may reintroduce the original problem: the field completeness set is built and the calc can zero out skins if any roster player lacks a hole score (late subs, roster tweaks).
   - Suggested fix: Decide which statuses should be treated as “final scores are authoritative” and skip the skins completeness gate for all of them (e.g. `roundStatus !== 'active'` or `roundStatus === 'finalized' || roundStatus === 'completed'`). Also consider aligning `buildLeaderboard`’s “use stored sideGameResults vs live compute” logic with the same terminal-status set.

## Strengths

- Good invariant enforcement for skins: `computeSideGameWinnerForRound` now proactively deletes any persisted `sideGameResults` rows for `auto_skins` before exiting (apps/api/src/lib/side-game-calc-db.ts:49-69), which prevents Champion-track contamination even if data was historically wrong.
- Admin POST guard now blocks manual skins results by both `calculationType` and legacy names (apps/api/src/routes/admin/side-games.ts:265-282), addressing the prior bypass vector.
- History aggregation adds an explicit exclusion filter for skins by calc-type and name (apps/api/src/routes/history.ts:107-143), which is a sensible defense-in-depth layer if anything slips into `sideGameResults`.
- Migration 0028 promotes calc type by name first, renames, then deletes historical `side_game_results` for skins (apps/api/src/db/migrations/0028_skins_rename.sql:32-50). The step ordering is coherent and matches the runtime assumptions.

## Warnings

None.
