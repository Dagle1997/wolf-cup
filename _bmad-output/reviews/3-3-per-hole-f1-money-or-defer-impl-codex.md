# Codex Review

- Generated: 2026-06-23T16:02:41.689Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/games/types.ts, apps/tournament-api/src/engine/games/compute-foursome.ts, apps/tournament-api/src/services/games-money.ts, apps/tournament-api/src/services/scorecard.ts, apps/tournament-api/src/engine/games/perhole-money.golden.test.ts, apps/tournament-api/src/engine/games/compute-foursome.perhole.test.ts, apps/tournament-api/src/services/games-money.perhole.test.ts, apps/tournament-api/src/routes/scorecard.integration.test.ts, apps/tournament-api/src/engine/games/__fixtures__/perhole-money-base-flat.json, apps/tournament-api/src/engine/games/__fixtures__/perhole-money-greenie-carryover.json

## Summary

Adds an additive per-hole money decomposition (`Ledger.perHole`) to the pure engine settlement, threads it through the pinned settlement chokepoint, and exposes it on the during-round scorecard via a new helper (`computeF1PerHoleMoneyForPlayer`) gated by (flag && locked). The decomposition logic itself looks consistent with the existing cross-matrix math and is well-defended by new unit + golden + integration tests.

Main risks are (a) potential inconsistency between the scorecard’s displayed net/relative strokes (built from `event_round.courseRevisionId` / `round.holesToPlay`) and the per-hole money settlement (built from the *pinned* `round_pin.courseRevisionId` / `event_round.holesToPlay`), and (b) performance: scorecard reads now trigger a full foursome settlement recompute per request, which may be expensive under polling.

Overall risk: medium

## Findings

1. [high] Scorecard stroke allocation/course data source can diverge from pinned money settlement inputs (risk of moneyNet not matching displayed netScore/relativeStrokes)
   - File: apps/tournament-api/src/services/scorecard.ts:115-219
   - Confidence: high
   - Why it matters: `computeF1PerHoleMoneyForPlayer` settles money using the *pinned* course revision (`round_pins.courseRevisionId`) and its stroke indexes/par (games-money.ts:589-603). But `buildPlayerScorecard` derives `par/si` (and therefore `relativeStrokes` and `netScore`) from `eventRounds.courseRevisionId` (scorecard.ts:115-139) and loops holes based on `round.holesToPlay` (scorecard.ts:204), not the pinned revision or the same holesToPlay source the money path uses.

If `event_round.courseRevisionId` (or `round.holesToPlay`) ever differs from what was pinned at round start (whether via admin edit, data repair, or corruption), the scorecard could show:
- netScore/relativeStrokes computed from one SI table, while moneyNet is computed from a different SI table;
- holes displayed that aren’t in the money settlement’s in-play set (or vice versa).

Now that money is visible per hole, this mismatch becomes user-facing and can lead to disputes (“my net says X but money says Y”).
   - Suggested fix: Human decision needed: pick the authoritative source for *scorecard* par/si/holesToPlay when money is exposed.

Mechanically, to ensure scorecard and money cannot diverge:
- Prefer `round_pins.courseRevisionId` (when a pin exists) for `course_holes` in `buildPlayerScorecard`, matching the money-safety invariant.
- Prefer the same holesToPlay source across both paths (either both use `event_round.holes_to_play` or both use `round.holes_to_play`, but be consistent).
- Add a targeted test that simulates a mismatch (pin courseRevisionId != eventRound courseRevisionId) and asserts the chosen behavior (either hard-fail, or consistently use pin).

2. [medium] Potential performance regression: scorecard now runs full pinned foursome settlement (multiple queries + compute) per request
   - File: apps/tournament-api/src/services/scorecard.ts:187-234
   - Confidence: medium
   - Why it matters: `buildPlayerScorecard` now calls `computeF1PerHoleMoneyForPlayer` unconditionally (scorecard.ts:187-199). That helper performs several DB round-trips (round lookup, event config lookup, eventRound lookup, pin parse, course holes load, pairing lookup, score load for all 4 players, claim fold) and then runs the settlement (games-money.ts:531-642 plus settleFoursome at 321-484).

The scorecard endpoint is explicitly polled (“Live-board freshness”, integration test asserts no-store), so this can amplify load quickly (N users × polling interval × heavy recompute). Even though it’s per-foursome (not whole-event), it’s still significantly more work than the prior score-only path.
   - Suggested fix: Consider short-circuiting earlier to avoid the heavy path when obviously unnecessary (e.g., skip money compute if no eventId/eventRoundId, or if flag off cached globally).

If polling load becomes an issue:
- Add request-level caching/memoization per (roundId, playerId) with a very short TTL.
- Or restructure to compute money only when the caller asks for it (query param/field selection), or batch via a dedicated money endpoint.
- Or reuse data already fetched in `buildPlayerScorecard` (pin row, course holes) by refactoring `computeF1PerHoleMoneyForPlayer` to accept preloaded pinned inputs while still going through the same settlement kernel.

3. [low] No end-to-end test asserting scorecard preserves a settled $0 push (0 vs null)
   - File: apps/tournament-api/src/routes/scorecard.integration.test.ts:459-497
   - Confidence: high
   - Why it matters: The implementation correctly uses `map.has()` to preserve an explicit 0 (scorecard.ts:229-234), and the engine has unit coverage for push rows (`compute-foursome.perhole.test.ts`:40-49). However, the new scorecard integration tests only assert non-zero settled holes vs unplayed holes, not a settled push hole. That leaves a small gap where a future refactor could reintroduce `|| null`/`?? null` behavior without being caught at the route level.
   - Suggested fix: Add one integration (or service-level) scenario where a hole is fully scored for all 4 players but ties (pts===0), and assert `moneyNet === 0` for that hole while still `moneyNet === null` for unplayed holes.

## Strengths

- Engine per-hole decomposition is computed under the same complete-cell gate as settlement and is additive (does not affect `cross`/`perPlayerCents`/`totalCents`), with explicit push-row emission before the pts===0 short-circuit (compute-foursome.ts:74-125).
- Good -0 handling on the teamB negation path to avoid `-0` serialization/equality quirks (compute-foursome.ts:99-104), plus unit test guarding against -0 in push rows.
- Chokepoint discipline is strong: per-hole money is surfaced only by threading through `settleFoursome` and `computeFoursome`, and exposure is fail-closed to `null` under (non-F1 / flag off / unlocked / unpinned / player not in round / unsettleable) (games-money.ts:531-634).
- Test suite is comprehensive at multiple levels: engine golden fixtures (including stateful greenie-carryover attribution), structural unit tests (incomplete holes vs push rows), service-level gating + reconciliation with `computeF1PerPlayerNet`, and route integration tests for exposure gating.

## Warnings

None.
