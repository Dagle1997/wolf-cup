# Story 1.4 — multi-perspective review (orchestrator-condensed)

> Produced inline by the Tournament Director. This was the deepest review of the epic: dual-model spec review (caught a CRITICAL unsafe ship-split + a money-safety contradiction) + dual-model impl review with THREE fix rounds (2 CRITICAL + 4 HIGH money-safety bugs the implementation's own happy-path tests missed). Implementation + fixes delegated to focused subagents; reviewed via the codex+gemini ensemble. Full party available on request.

## Analyst — ACs met?
- AC1 chokepoint (`services/games-money.ts`, only path for F1 money) ✓ · AC2 read-time net ONLY from pinned CH + pinned course-rev, every consumer incl. leaderboard ✓ · AC3 `resolveFoursomeTeams` ✓ · AC4 non-tautological mutation-guard (mutate live HI+rating → money unchanged) ✓ · AC5 pin at round-start; no-pin → fail-closed ✓ · AC6 recompute-on-read, no stored money ✓ · AC7 settle-up/money-detail integration ✓ · AC8 leaderboard money mode + signpost ✓ · AC9 durable per-round HI/CH ✓ · AC10 dual-read switch (legacy 2v2+presses OFF for F1; bets/skins coexist) + `TOURNAMENT_F1_MONEY_ENABLED` dark-launch flag + disjointness test ✓ · AC11 fail-closed per-foursome isolated, missing-handicap → unsettleable (not scratch) ✓ · AC12 server-side audience-bounding + unlocked viewer-private ✓ · AC13 FR18 putts no-regression ✓ · AC14 audit ✓ · AC15 fast-check zero-sum + Story 1.1 golden release gate through the live chokepoint ✓.

## Architect
- Single chokepoint; dual-read switch is **strictly additive** (non-F1 events take the exact legacy path — 45 legacy money/leaderboard/handicap tests pass unchanged). The money-safety pin (CH frozen at round-start, reads only the pin) is the seam between live-recalc and settled-freeze. `allocateStrokesFromCourseHandicap` factored out of `getHandicapStrokes` (behavior-preserving, 192 handicap tests).

## PM
- Closes Epic 1: F1 events can settle real money end-to-end on hand-proven math, dark-launched behind the flag. Deferred correctly: finalize/correction + per-hole breakdown (Epic 4); claims/cap/Wolf presets (Epic 2); global teams/pot (Epic 3).

## QA — what the ensemble caught (and the tests now cover)
- **Spec gate caught:** an unsafe ship-split (would double-count/leak) + a pinned-CH-vs-live-GHIN contradiction — both fixed before any code.
- **Impl gate caught (happy-path tests had missed):** live-HI fallback on missing pin (CRIT), event-wide crash on a throwing foursome (CRIT), missing-handicap-settles-as-scratch (HIGH), un-tenant-scoped pin reads (HIGH), /foursome-results legacy-dollar leak (HIGH), then the reader-path 500-on-corrupt-pin (HIGH). All fixed + regression-tested (mutation guard, per-foursome isolation, missing-handicap, tenant isolation, flag-off, corrupt-CH no-500, 9-hole holes-in-play).
- Final: codex 0-finding money-safety sign-off; api 1231 + web 364 green.

## Dev
- Integer-cents; recompute-on-read; fail-closed everywhere on the F1 read path (no live fallback, per-foursome try/catch). No new deps, no migration (reuses 1.2 `round_pin`).

## UX
- Leaderboard mode signpost (money vs scores-only+private My Money); per-round HI/CH shown; unsettleable foursomes show "Calculation paused" without blocking others.

## Followups (non-blocking)
- **Gross-display (gemini Medium):** the F1 leaderboard *net* filters to holes-in-play, but the *gross* total / throughHole don't — for a 9-hole round with stray back-9 scores the gross column could overcount. Affects gross display/stroke-play ranking, NOT settled money. Trivial follow: apply the same `holesToPlay` filter to gross.
- **Deploy gate:** `TOURNAMENT_F1_MONEY_ENABLED` is left OFF; flipping it on in the VPS env (when ready) is the dark-launch flip — a deploy action, not a code change. Nothing exposes F1 money while off.
- Per-hole F1 money breakdown (Epic 4); H1b handicap-allowance % if the group wants relative-to-low allocation.

## Verdict
**No blocking issues; money-safety signed off.** ACs met; the dual-read switch is additive (zero legacy regression); the ensemble caught and fixed 2 CRITICAL + 4 HIGH money-safety bugs before commit. Ready to commit — closes Epic 1.
