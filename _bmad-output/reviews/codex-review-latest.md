# Codex Review

- Generated: 2026-06-17T01:03:14.454Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/foursome-teams.ts, apps/tournament-api/src/services/money.ts, apps/tournament-api/src/services/money-detail.ts, apps/tournament-api/src/services/press-orchestrator.ts, apps/tournament-api/src/services/team-standings.ts, apps/tournament-api/src/routes/money.ts

## Summary

The alphabetical-team bug is largely fixed by centralizing team resolution in `resolveFoursomeTeams` and wiring all three call sites to it. However, the new resolver does not validate slot integrity (duplicates/missing/out-of-range), which can still silently form wrong partnerships (now consistently wrong across services). Separately, money vs detail/press/standings use different locked-handicap loaders (event vs round) and money.ts selects an arbitrary runtime round when multiple exist, both of which can cause money/press/detail disagreements in real cash settle-up scenarios. Team standings’ hole-counting relies on engine behavior that isn’t enforced in code (counts a hole when only one side’s bestNet is non-null).

Overall risk: high

## Findings

1. [high] `resolveFoursomeTeams` can still silently form WRONG partnerships when slot_number data is invalid (duplicates/missing/out-of-range)
   - File: apps/tournament-api/src/services/foursome-teams.ts:27-41
   - Confidence: high
   - Why it matters: This is the exact class of bug you just fixed (wrong partners => wrong best-ball nets => wrong money). Today you’ve eliminated the *alphabetical* silent mispairing, but you still have a silent mispairing path if `pairing_members.slot_number` is mis-seeded (duplicate 1s, missing 2, 0-based slots, slot 99, etc.). The function just sorts and takes the first two as teamA, last two as teamB. That can produce a deterministic but incorrect partnership with no logging/errors, and all three wired sites will “agree” while being wrong.
   - Suggested fix: In `resolveFoursomeTeams`, validate that:
- slotNumber is a finite integer
- the set of slotNumbers is exactly {1,2,3,4} (or explicitly support {0,1,2,3} if that’s a real schema)
- playerIds are 4 unique values
If validation fails, return null (and have callers log+surface) or throw a typed error so money/press doesn’t silently proceed with bad teams.

2. [high] Locked-handicap override source is inconsistent across money vs detail/press/standings; can break reconciliation
   - File: apps/tournament-api/src/services/money.ts:66-208
   - Confidence: medium
   - Why it matters: `computeMoneyMatrix` applies locked handicaps via `loadLockedHandicapsByEvent` (money.ts:66-67, 207-208). But `computeFoursomeResults` (used by money-detail and team-standings) applies `loadLockedHandicapsByRound` (money-detail.ts:44-47, 200-201), and press-orchestrator also uses `loadLockedHandicapsByRound` (press-orchestrator.ts:60-61, 435-436). If the underlying data model is round-scoped (or can differ by round/event state), you can get money matrix totals that do not match foursome-results, my-money, team-standings, and press decisions—i.e., real-money disputes where different screens disagree.
   - Suggested fix: Unify handicap-override semantics for all money-critical computations:
- Either always load “effective for this round” and use that everywhere (including money.ts), or
- Ensure `loadLockedHandicapsByEvent` and `...ByRound` are guaranteed identical and document/enforce it.
At minimum, add an invariant test that money.ts and money-detail.ts compute identical net/best-net on the same inputs with locks enabled.

3. [high] Money matrix chooses an arbitrary runtime `rounds` row when multiple exist; can desync money vs detail/standings
   - File: apps/tournament-api/src/services/money.ts:245-258
   - Confidence: high
   - Why it matters: In money.ts you query all `rounds` for an `event_round_id` and then take `runtimeRoundRows[0]` without `orderBy` or `limit(1)` (money.ts:247-258). money-detail.ts does `.limit(1)` (money-detail.ts:121-127) but also without ordering. If multiple runtime rounds exist (due to replay/import/bug), money.ts may compute against a different round than money-detail/team-standings, producing different results and violating the reconciliation invariant.
   - Suggested fix: Enforce uniqueness at the DB level if possible; otherwise select deterministically:
- Add `.orderBy(desc(rounds.createdAt), desc(rounds.id)).limit(1)` (or similar) everywhere you pick “the runtime round”.
- Consider asserting if >1 runtime round exists for an event_round_id in money-critical paths (log loudly / fail fast).

4. [medium] Team standings may count a hole for one team without confirming the hole is “complete” for both teams
   - File: apps/tournament-api/src/services/team-standings.ts:84-96
   - Confidence: medium
   - Why it matters: `computeTeamStandings` counts a hole when `bestNet` for that side is non-null (team-standings.ts:85-96). This assumes the engine only produces a side’s bestNet when the *entire* 4-player hole is complete. If engine behavior ever returns teamA best net when only teamA has scores (or in any partial-data edge), standings could count holes asymmetrically across teams, skewing toPar/net totals and potentially deciding payouts/awards incorrectly.
   - Suggested fix: Make the “hole complete” predicate explicit and symmetric in standings aggregation, e.g. require:
- `hole.teamABestNet != null && hole.teamBBestNet != null` before counting for either team, and/or
- require exactly 2 non-null grosses for that team (not 1) if you intend “fully scored holes only”.
Add a test that partial hole scoring does not change standings until all 4 scores are present.

5. [medium] Money vs money-detail differ on missing-handicap behavior; can cause silent mismatches if player HI lookup is incomplete
   - File: apps/tournament-api/src/services/money.ts:361-363
   - Confidence: medium
   - Why it matters: money.ts explicitly skips a foursome if any member is missing handicap (`handicapIndexByPlayer[id] === undefined`) (money.ts:361-363). computeFoursomeResults does not perform an equivalent guard before calling `compute2v2BestBall` (money-detail.ts:193-246). If a player row is missing/filtered (tenant mismatch, deleted player, etc.), money.ts will drop that foursome from the money matrix while money-detail/team-standings might still compute (or throw and skip) differently. That is a reconciliation-breaker and would be very hard to debug mid-event.
   - Suggested fix: Mirror the same guardrail in computeFoursomeResults (and/or make a shared helper): verify all 4 members have handicap values before running the engine, and log loudly when skipping so operators can fix data before settle-up.

6. [low] Duplicate-slot tie-break uses `localeCompare()` which can be locale-dependent; better to use a deterministic bytewise compare
   - File: apps/tournament-api/src/services/foursome-teams.ts:31-35
   - Confidence: medium
   - Why it matters: This is only used when slot_numbers collide (already an invalid state), but `localeCompare()` without an explicit locale can theoretically vary with runtime locale/ICU behavior. In money-critical code, deterministic ordering should not depend on environment settings, even as a tiebreak.
   - Suggested fix: Prefer a deterministic comparator like `(a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0)` or `localeCompare('en')` with fixed options. More importantly: reject duplicate slots rather than relying on a tiebreak (see first finding).

## Strengths

- All three wired paths (money.ts, money-detail.ts, press-orchestrator.ts) now call a single `resolveFoursomeTeams`, reducing drift risk for partnership formation.
- `computeTeamStandings` keys teams by sorted player IDs (`key = [...ids].sort().join('|')`), which is stable across rounds regardless of teamA/teamB side or within-team order.
- Team standings gross calculation correctly restricts to the team’s own two players before taking `Math.min(...grosses)` (team-standings.ts:87-95).

## Warnings

None.
