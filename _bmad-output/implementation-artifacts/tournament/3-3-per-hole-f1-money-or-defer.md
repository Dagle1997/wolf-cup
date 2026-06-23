# Story 3.3: Per-hole F1 money — real per-hole settlement on the during-round scorecard

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!--
SOURCING NOTE (director, 2026-06-23): Sourced from `scoreboard-rework-spec.md`
(the authoritative Epic-3 "Scoreboard rework" design, "Suggested story split" S3 +
"API — NEW scorecard endpoint" `moneyNet`), NOT from the create-story `epics_file`
(`epics-f1-rules-games.md`), which has a DIFFERENT, colliding "Epic 3: Teams & the
Event Pot". The scoreboard Epic-3 stories (3-1..3-5) are tracked in sprint-status.yaml.
3-1 and 3-2 were built the same way.

KEY DECISION (Josh, 2026-06-23): BUILD REAL per-hole F1 money — NOT the flagged
$-row deferral. Pull the Epic-4 per-hole seam forward. GOLDEN-GATED per NFR-C1:
the per-hole-money golden hand-calc fixture is authored FIRST and Josh approves it
BEFORE settlement code merges. This fills the `moneyNet` field 3-2 returns as null.
-->

## Story

As a **Tournament player watching the live during-round board in money mode**,
I want **the scorecard's per-hole `$` column to show the REAL F1 (Guyan 2v2) money my team won or lost on each hole**,
so that **the expandable per-player card (Story 3-4 / Pete Dye brochure p4) shows running per-hole dollars that reconcile exactly with the settled event money — never a fabricated `$0`.**

This is **S3 of the scoreboard rework**. It is the **money-correctness gate** of Epic 3: it pulls the Epic-4 per-hole-money seam forward by exposing the per-hole decomposition the F1 settlement engine **already computes internally and currently discards**, then surfaces it through the single F1 chokepoint (`games-money.ts`) into the 3-2 scorecard API's `moneyNet` field.

**This is a money-bearing, golden-gated story (NFR-C1).** The hand-calc golden fixture (per-hole money for a known foursome, including a greenie-carryover case) is authored and **Josh-approved BEFORE the settlement code merges**. The base Epic-1/2 goldens (round totals) MUST remain **byte-identical** — the per-hole change is purely additive and the round totals (`cross` / `perPlayerCents` / `totalCents`) do not move.

## Background — the seam (evidence, 2026-06-23)

- `engine/games/compute-foursome.ts` already computes each settled hole's team points (`pts`, teamA-signed) and point value (`pv`), and moves `half = pts*(pv/2)` into all four cross-team cells (L77–94). It then **sums these away** and returns only the round-total `Ledger` (`cross`, `perPlayerCents`, `totalCents`) — the per-hole breakdown is lost.
- Per-player per-hole money is therefore **already determined**: on a settled hole, each **teamA** player nets `+pts*pv` cents and each **teamB** player nets `−pts*pv` cents (the Wolf Cup ±N per-player point model, expressed pairwise — see the L88–90 comment). Σ over holes of a player's per-hole money **equals** their round `perPlayerCents[p]` by construction.
- `services/games-money.ts` `settleFoursome` calls `computeFoursome` → `ledgerToEdges` and exposes only round-level `SettlementEdge[]`. `computeF1FoursomeResults` (money-detail.ts L468–473) and `scorecard.ts` (L207–208) both **zero / null** per-hole money with a "3-3 / Epic-4 seam" comment.
- **Exposure model (canonical, must be mirrored — do NOT invent a new one):** F1 dollars are exposed on reader surfaces ONLY when `isF1 && lockState === 'locked' && f1MoneyEnabled()`. `unlocked` ⇒ scores-only (no public dollars; private My Money). Evidence: `events-leaderboard.ts` `resolveF1Mode` (`mode = locked ? 'money' : 'scores_only'`, `moneyEnabled = f1MoneyEnabled()`); `money-detail.ts` `exposeMoney = f1MoneyEnabled() && f1.lockState === 'locked'`; `lib/env.ts` `f1MoneyEnabled()` reads `TOURNAMENT_F1_MONEY_ENABLED`. A live money board IS a locked F1 event (the organizer's lock toggle is independent of round lifecycle).
- **Golden-safety (verified for the cited tests; verify the rest at build):** the golden tests assert on **specific fields** (`ledger.perPlayerCents` / `ledger.totalCents` / `ledger.cross`) via `toEqual`/`toBe`, NEVER a whole-`Ledger` deep-equal (`guyan-2v2.golden.test.ts:34-38`, `games.property.test.ts`). Adding an additive `Ledger.perHole` field (default `[]`) should not break them — but the build MUST grep for any `toEqual(ledger)` / `toMatchSnapshot` on a whole `Ledger`, and any `Ledger`-constructing fixture/helper that would need the new field, before declaring done (Task 1).

## Acceptance Criteria

1. **GOLDEN FIRST (NFR-C1 hard gate) — base-flat per-hole numbers JOSH-APPROVED 2026-06-23.** The base-flat per-hole money (h1..h6 teamPts +1/+3/−4/+4/−5/+4 → a1=a2 = +5/+15/−20/+20/−25/+20, b1=b2 negated; per-player column sums +$15/+$15/−$15/−$15 matching the already-approved round ledger) was hand-calc'd from the existing approved `guyan-2v2-base-flat.json` and **approved by Josh at the spec gate**. The greenie-carryover fixture's per-hole numbers are authored in Task 0 and follow the same loss-less invariant. Before any settlement code merges, the per-hole-money golden fixture is authored and **Josh-approved**. It hand-calcs, for a known foursome + net scores + config, the **per-hole** team points, point value, and each player's per-hole cents — and asserts the **loss-less decomposition invariant** (the ONE unconditionally-correct check): for every player, `Σ_holes perHole.perPlayerCents[player] === ledger.perPlayerCents[player]`. It also asserts the round ledger stays **zero-sum** (`Σ_players ledger.perPlayerCents === 0`). It does NOT assert any `Σ |per-hole delta| === totalCents` relation — `ledger.totalCents` is `Σ |cross cell|` (abs-of-the-round-sum), which is NOT equal to the sum of per-hole absolute deltas once teams trade holes (the per-hole signs cancel inside each cross cell before the abs); summing abs per-hole would over-count and fail the gate. The per-player signed invariant above is the correct, definition-independent loss-less proof. The golden MUST include at least: (a) the **base flat** case (reuse the `guyan-2v2-base-flat.json` scenario so the per-hole rows sum to the already-approved per-player totals), with **at least one hole each side wins** so the cancellation case is actually exercised; and (b) a **greenie-carryover** case proving the carried greenie's money lands as per-hole money on the **resolving** par-3 (stateful modifier attribution). The earlier deferred par-3(s) still carry their **base** per-hole money (they are `$0` only if their base hole was itself a push — do NOT assert a blanket `$0`); the core assertion is that the carried greenie's contribution appears on the resolving hole, not the deferred ones. The existing base/greenie/polie/sandie/nine-hole/front-back goldens MUST still pass **byte-identical** on their round-total assertions.

2. **Engine: additive per-hole breakdown on `Ledger`.** `engine/games/types.ts` gains a `PerHoleMoney` type and `Ledger.perHole: PerHoleMoney[]` (default `[]`). `compute-foursome.ts` records, for **exactly the holes whose `pts`/`pv` the engine includes in the cross accumulation** — i.e. holes that pass the SAME complete-cell gate (`members.every(p => hole.net[p] !== undefined)`), so `perHole` rows correspond 1:1 with what moves `cross`/`perPlayerCents` — a row `{ holeNumber, teamPointsA, pointValueCents, teamASignedPerPlayerCents, perPlayerCents }` where `teamASignedPerPlayerCents = teamPointsA * pv` is **one teamA player's signed per-hole cents (NOT the team-total, which would be 2× that)**, `perPlayerCents[teamA player] = +teamPointsA*pv`, `perPlayerCents[teamB player] = −teamPointsA*pv`. A **push hole** (settled, `pts === 0`) emits a row with all-zero money (NOT omitted) — so a halved hole shows `$0`, distinct from an unsettled hole (no row). A hole that fails the complete-cell gate (any member's net missing) emits **no** row. `perHole` is sorted ascending by `holeNumber`. The round totals `cross` / `perPlayerCents` / `totalCents` are **unchanged** (the per-hole record is taken from the same `pts`/`pv` already used for the cross accumulation, captured BEFORE the `pts===0` short-circuit so pushes still emit a zero row). Greenie/polie/sandie awards already folded into `pts` are included in the hole's money on the hole where they land.

3. **Chokepoint: per-hole money surfaced through `games-money.ts` only.** `settleFoursome`'s `ok` result gains an **additive** `perHole` field (`{ kind: 'ok'; edges; perHole }`) — its existing `edges` property is unchanged, so the existing caller `computeF1EventEdges` (which does `edges.push(...result.edges)`) is **unaffected** (verify it still reads `.edges` and ignores `perHole`). A new exported `computeF1PerHoleMoneyForPlayer(txOrDb, { roundId, playerId, tenantId }): Promise<Map<number, number> | null>` returns, for the player's foursome in that round, a `Map<holeNumber, cents>` of **player-signed** per-hole money (positive = player won that hole's money). **The map has one entry per SETTLED hole (1:1 with the engine's `perHole` rows for this player), including an explicit `0` entry for each settled push hole; it OMITS unsettled/incomplete holes** — so a consuming `map.has(n)` distinguishes "settled `$0`" from "not settled". Settles ONLY from the **pinned** inputs (same path as `computeF1EventEdges` — pinned CH via `allocateStrokesFromCourseHandicap`, pinned course-rev stroke index/par, claims fold). It returns **`null`** (NOT an empty map, NOT zeros) when ANY of: the event is not F1; money is not exposed (`!f1MoneyEnabled() || lockState !== 'locked'`); the round is not started/pinned; the player is not in any foursome of the round; or the player's foursome is unsettleable (fail-closed per AC in games-money — missing/corrupt pin, missing handicap, engine throw). Per-foursome fail-closed isolation is preserved: a throw settling the player's foursome yields `null`, never a 500. No F1 money is ever computed outside this chokepoint.

4. **Scorecard API: `moneyNet` filled from the chokepoint (exposure-gated).** `scorecard.ts` `buildPlayerScorecard` calls `computeF1PerHoleMoneyForPlayer`. When it returns a map, each hole's `moneyNet` = the map's value for that hole if the map **has** that key, else `null` (an unsettled/incomplete hole stays `null`, never `0`). **CRITICAL — preserve the push-hole `$0`:** read the map with a presence check (`map.has(n) ? map.get(n)! : null`), NEVER `map.get(n) ?? null` and **NEVER** `map.get(n) || null` — a settled push hole has value `0`, which is falsy/nullish-coalesces wrong and would be erased into `null` (showing `—` instead of `$0`, collapsing the AC#2 push-vs-incomplete distinction). The map contains a `0` entry for every settled push hole (per AC#3, the per-hole map mirrors the engine's `perHole` rows including zero rows); absence of a key means the hole was not settled. When it returns `null` (not F1 / not exposed / unsettleable), `moneyNet` stays `null` on **every** hole — exactly the 3-2 behavior (the 3-1 component renders `null → "—"`, and `0 → "$0"`). The scorecard's per-hole `netScore` (already from the pinned CH, 3-2 AC#4) and the money's underlying net are the SAME allocation, so the displayed net and the displayed money can never disagree. **`moneyNet` is INTEGER CENTS** (the API contract — same unit as every other cents field in the codebase; the web `$`-row formats cents → dollars). It is a whole-dollar amount whenever the configured point value is whole-dollar (Guyan = $5 = 500 cents, so `pts * 500` is always a whole-dollar multiple); the engine's existing `pv % 2 !== 0 → throw` guard ensures the 2v2 half-split is integer cents but does NOT by itself promise multiples of 100 — so do NOT claim "whole-dollar" from pv-even, and do NOT introduce any rounding to force whole dollars (that would corrupt money). The contract is integer cents; whole-dollar is a property of the Guyan config, not an invariant this story enforces.

5. **Money exposure is never wider than the leaderboard's** *(DECISION RATIFIED — Josh, 2026-06-23 spec gate)*. The scorecard route's existing participant-or-organizer gate (3-2 AC#9) is unchanged; money visibility is bounded by the SAME `locked && f1MoneyEnabled()` gate the leaderboard money mode uses, applied inside `computeF1PerHoleMoneyForPlayer`. So a participant viewing the during-round **public** board sees per-hole dollars exactly when (and for the same players) the leaderboard money mode would. **RATIFIED DECISION:** the during-round scorecard is a PUBLIC, EVENT-WIDE board — **every joined participant can see every player's per-hole money** when the event is in money mode (locked). "Joined participant" = anyone on the event roster / a group member (whether they joined via Google SSO + GHIN selection or via a per-player join code already bound to their GHIN — both populate the same participant membership the gate checks). The audience is **membership-based, NOT foursome-scoped**: a player in foursome 1 sees foursome 2's money, exactly like the leaderboard. The organizer's existing **lock toggle is the "turn money on" switch**; an `unlocked` event is scores-only (the `—` column). For Pete Dye the organizer locks the event → all joined players see running money on the board (and the brochure p4 capture). 3-3 does NOT change join flows, the participant gate, or the lock toggle — it only fills `moneyNet` under that already-established audience+mode. (If a future need arises to show money the instant an event is created with no lock step, that is a lock-toggle-DEFAULT change, separate from 3-3.) Finer per-viewer audience-bounding (e.g. hiding a non-roster cross-group viewer's money) is **out of scope** — it does not exist for the leaderboard either; recorded as a forward concern, consistent across surfaces.

6. **Recompute-on-read, no stored money, money-safety invariant intact (AC2 of the F1 epic).** Per-hole money is derived live from the pinned inputs + (append-only-corrected) scores on every read. A later course/rating/HI edit cannot move a pinned round's per-hole money. The helper NEVER reads a live HI, NEVER calls `calcCourseHandicap`/`buildTeeByPlayer` on this path, and NEVER falls back to a live recompute.

7. **Tests.**
   - **Engine golden** (AC#1): the new per-hole-money golden(s) + the loss-less invariant; all existing round-total goldens still pass.
   - **Engine unit:** `compute-foursome` emits a `perHole` row per settled hole (push ⇒ zero row), no row for an incomplete hole, `Σ perHole === perPlayerCents` per player, and `Ledger.perHole` is order-independent (reverse-input determinism, mirroring `games.property.test.ts`).
   - **Service unit** (`games-money` per-hole): `computeF1PerHoleMoneyForPlayer` returns a correct player-signed map for a locked+flag-on F1 round; returns `null` when the flag is off; `null` when `unlocked`; `null` for a non-F1 event; `null` for a player not in the round; `null` (not a crash) for an unsettleable foursome (missing/corrupt pin, missing handicap). At least one test asserts the map values reconcile with the event edges (`Σ map === computeF1PerPlayerNet` for that player, scoped to the round).
   - **Route integration** (scorecard, extending 3-2's tests): with a locked F1 round + `TOURNAMENT_F1_MONEY_ENABLED=true`, the scorecard `moneyNet` is non-null and whole-dollar on settled holes and `null` on unplayed holes; with the flag off OR `unlocked`, `moneyNet` is `null` on every hole (3-2 parity).
   - No regression to existing tournament-api / engine suites; typecheck + lint clean. (Known flake: `round-lifecycle.integration.test.ts` "no such table" under full-suite load — NOT a regression, do not chase.)

8. **Scope guardrails (additive, tournament-only).** Tournament paths ONLY (FD-1/FD-2). No schema, no migration, no `apps/tournament-web/**` change (the web `$`-row already renders `moneyNet`; wiring the route is 3-4). FORBIDDEN: any edit to `apps/web/**`, `apps/api/**`, `packages/engine/**`. The engine `Ledger` change is additive; no public route contract changes shape (the 3-2 `ScorecardHole` already has `moneyNet`).

## Files this story will edit

- apps/tournament-api/src/engine/games/types.ts
- apps/tournament-api/src/engine/games/compute-foursome.ts
- apps/tournament-api/src/engine/games/perhole-money.golden.test.ts
- apps/tournament-api/src/engine/games/__fixtures__/perhole-money-base-flat.json
- apps/tournament-api/src/engine/games/__fixtures__/perhole-money-greenie-carryover.json
- apps/tournament-api/src/engine/games/compute-foursome.perhole.test.ts
- apps/tournament-api/src/services/games-money.ts
- apps/tournament-api/src/services/games-money.perhole.test.ts
- apps/tournament-api/src/services/scorecard.ts
- apps/tournament-api/src/services/scorecard.test.ts
- apps/tournament-api/src/routes/scorecard.integration.test.ts

## Tasks / Subtasks

- [ ] Task 0 — **GOLDEN FIRST (AC#1, NFR-C1 gate).** Author `__fixtures__/perhole-money-base-flat.json` (reuse the `guyan-2v2-base-flat.json` scenario's scores/config/teams; add an `expected.perHole` block: per-hole teamPointsA / pointValueCents / teamASignedPerPlayerCents / perPlayerCents) and `__fixtures__/perhole-money-greenie-carryover.json` (reuse `greenie-carryover-on.json`; assert the carried greenie's money lands on the resolving par-3). Write `perhole-money.golden.test.ts` asserting both fixtures' per-hole rows AND the loss-less invariant (`Σ perHole.perPlayerCents[p] === ledger.perPlayerCents[p]` for every player + round zero-sum; do NOT assert any `totalCents` relation — see AC#1). **STOP for Josh's golden approval before Task 1** (the director's spec gate covers this approval point).
- [ ] Task 1 — Engine per-hole breakdown (AC#2)
  - [ ] `types.ts`: add `PerHoleMoney = { holeNumber, teamPointsA, pointValueCents, teamASignedPerPlayerCents, perPlayerCents: Record<string, number> }`; add `perHole: PerHoleMoney[]` to `Ledger`.
  - [ ] `compute-foursome.ts`: inside the hole loop, AFTER the complete-cell gate passes and `pts`/`pv` are computed (BEFORE the `pts===0 continue`), push a `perHole` row (zero row when `pts===0`); keep the existing cross accumulation byte-identical. Sort `perHole` by holeNumber (holes are already sorted). Return `perHole` on the `Ledger`.
  - [ ] **Grep for whole-`Ledger` consumers:** `toEqual(ledger)` / `toStrictEqual(ledger)` / `toMatchSnapshot` on a `Ledger`, and any `Ledger`-typed fixture/object literal that the new field would make a type error. Fix any found (or confirm none).
  - [ ] Run the existing goldens — confirm byte-identical round totals.
- [ ] Task 2 — Chokepoint helper (AC#3, #5, #6)
  - [ ] `games-money.ts`: add `perHole` to `settleFoursome`'s `ok` result (`{ kind:'ok'; edges; perHole }`) — ADDITIVE; the `SettleFoursomeResult` type gains the field. **Verify the existing caller `computeF1EventEdges` still reads `result.edges`** (L294-295 `edges.push(...result.edges)`) and is otherwise unchanged (it ignores `perHole`). Add `computeF1PerHoleMoneyForPlayer(txOrDb, { roundId, playerId, tenantId })`: resolve event + lockState (exposure gate: `f1MoneyEnabled() && locked` else `null`); find the runtime round + the player's pairing/foursome; run `settleFoursome` for that foursome (reusing the pinned path); extract the player-signed per-hole map; `null` on not-found / unsettleable / not-exposed. Tenant-scoped; never throws.
- [ ] Task 3 — Scorecard wiring (AC#4)
  - [ ] `scorecard.ts`: call `computeF1PerHoleMoneyForPlayer`; fill `moneyNet` per hole (map value or `null`); leave the existing net/strokes/claims logic untouched. Update the L207 "3-3 seam" comment.
- [ ] Task 4 — Tests (AC#7)
  - [ ] Engine: `compute-foursome.perhole.test.ts` (per-settled-hole row, push zero-row, no-row for incomplete, Σ-invariant, reverse-determinism).
  - [ ] Service: `games-money.perhole.test.ts` (exposure on/off, locked/unlocked, non-F1, player-not-in-round, unsettleable→null, reconcile with edges). Per-pid temp-file libsql DB (T14-2 lesson), not `file::memory:?cache=shared`.
  - [ ] Route: extend `scorecard.integration.test.ts` (money shown when locked+flag; null when off/unlocked).
- [ ] Task 5 — Verify (AC#7, #8)
  - [ ] `pnpm --filter @tournament/api test`, `pnpm --filter @wolf-cup/engine test`, `pnpm -r typecheck`, `pnpm -r lint` clean. Confirm no migration, no `apps/tournament-web/**` / `apps/web/**` / `apps/api/**` / `packages/engine/**` edit. Diff = the declared files only.

## Dev Notes

### Per-player per-hole money — the exact formula (cite in the golden)
On a settled hole, the engine moves `half = pts*(pv/2)` into each of the 4 cross cells (`compute-foursome.ts:91-94`). A teamA player's per-hole net = 2·half = `pts*pv`; a teamB player's = `−pts*pv`. So:
- `teamASignedPerPlayerCents = pts * pv` — **one teamA player's** signed per-hole cents (positive = teamA won the hole). NOT the team total (which is 2× this); named explicitly to stop a future consumer double-counting.
- `perPlayerCents[a] = +pts*pv` for each teamA player; `perPlayerCents[b] = −pts*pv` for each teamB player.
- Push hole (`pts === 0`) ⇒ all zeros (still emit the row).
- **Loss-less invariant (the ONE to assert):** `Σ_holes perHole.perPlayerCents[p] === ledger.perPlayerCents[p]` for every player. This is unconditional (signed sum, no abs). **Do NOT** assert `Σ_holes |…|·2 === totalCents`: `totalCents = Σ|cross cell| = |Σ_holes half|·4` (abs OUTSIDE the round sum), whereas summing abs per-hole is `Σ_holes|half|·4` — the two differ whenever teams trade holes (per-hole signs cancel inside the cross cell first). The per-player signed invariant + the round zero-sum (`Σ_players perPlayerCents === 0`) are the correct loss-less proofs.

### Greenie carryover (stateful — the golden's hard case)
`greenieFold` (`modifiers/greenie.ts`) emits per-hole signed team points (`pointsByHole`) that already resolve carryover across par-3s; `compute-foursome.ts:79` adds `pointsByHole.get(hole)` into that hole's `pts`. Recording per-hole money at that point therefore attributes the carried greenie's dollars to the **resolving** hole automatically — the golden's greenie-carryover case must assert this (money on the resolving par-3, `$0` on the earlier deferred par-3s).

### Exposure gate (mirror, don't reinvent)
`computeF1PerHoleMoneyForPlayer` resolves the event's `gameConfig.lockState` and the env flag exactly as `resolveF1Mode` (`events-leaderboard.ts:46-66`) and `computeF1FoursomeResults` (`money-detail.ts:336-337`) do: `exposed = f1MoneyEnabled() && lockState === 'locked'`. Not exposed ⇒ return `null` (scores-only). This keeps the scorecard's money strictly no-wider than the leaderboard's.

### Reuse, don't rebuild (chokepoint discipline, pattern 16)
- Settlement MUST go through `settleFoursome` / `computeFoursome` (the pinned path) — never an inline recompute. `computeF1PerHoleMoneyForPlayer` reuses `parsePin`, `resolveFoursomeTeams`, `allocateStrokesFromCourseHandicap`, `deriveCurrentClaims`, and the per-foursome try/catch isolation already in `settleFoursome`.
- The player's foursome: find the pairing in the round whose `pairing_members` include `playerId` (tenant-scoped), then settle just that foursome (or settle all and pick — but settling one is cheaper and matches the scorecard's single-player scope).
- Reconciliation test: for a locked+flag round, `Σ map.values()` for a player === that player's round contribution in `computeF1PerPlayerNet` (scoped to the one round) — proves the per-hole decomposition is loss-less end-to-end.

### Scope — DEFERRED to keep the money change minimal (note, do NOT build here)
- **`money-detail.ts` `computeF1FoursomeResults` per-hole fill** (the foursome-results view's `moneyTeamACents` / `teamABestNet` / `teamBBestNet` / `winner`, currently zeroed L468–473). Reads the SAME engine `perHole` primitive; deferred so 3-3's golden-gated change stays scoped to the scorecard $-row (the brochure p4 target). Land in 3-4 or a 3-x followup.
- **My Money F1 `perRound` per-hole** (`computeMyMoney` F1 branch, `perRound: []` today). Filling it must preserve the loss-less My-Money decomposition invariant (Σ perHole === game net). Deferred for the same reason; the My Money summary already shows the correct F1 net.
- Both deferrals are SAFE: they currently show correct round-level money (just no per-hole breakdown), so nothing is wrong, only less detailed.

### Operational note for the brochure capture (3-4 + p4)
Per-hole `$` shows ONLY when the demo/Pete Dye event is **locked** (money mode) AND `TOURNAMENT_F1_MONEY_ENABLED=true`. The capture event must be in money mode; an unlocked event correctly shows scores-only (`—` in the $ column). This is the honest money-safety model, not a bug.

### References
- [Source: scoreboard-rework-spec.md#API — NEW scorecard endpoint] — `moneyNet` = per-hole F1 money; "build it or FORMALLY defer ... never fake $0".
- [Source: apps/tournament-api/src/engine/games/compute-foursome.ts:77-94] — the per-hole `pts`/`pv`/`half` the breakdown records.
- [Source: apps/tournament-api/src/services/games-money.ts:144-301,320-475] — `computeF1EventEdges` / `settleFoursome` (the pinned chokepoint).
- [Source: apps/tournament-api/src/services/money-detail.ts:311-511] — `computeF1FoursomeResults` (exposure gate + the zeroed per-hole seam; deferred fill).
- [Source: apps/tournament-api/src/routes/events-leaderboard.ts:31-66] — `resolveF1Mode` (canonical exposure model).
- [Source: apps/tournament-api/src/services/scorecard.ts:87-212] — `buildPlayerScorecard` (the `moneyNet` consumer).
- [Source: apps/tournament-api/src/engine/games/guyan-2v2.golden.test.ts:30-40] — golden assertion pattern (field-level, not whole-Ledger).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (tournament-director, direct implementation)

### Debug Log References

- New engine golden + unit green first full run: `perhole-money.golden.test.ts` 4/4, `compute-foursome.perhole.test.ts` 5/5. Existing round-total goldens byte-identical (guyan/greenie/polie/sandie/property/ledger-to-edges all pass).
- Service chokepoint: `games-money.perhole.test.ts` 8/8 (exposure on/off, locked/unlocked, non-F1, player-not-in-round, unsettleable→null, reconcile with `computeF1PerPlayerNet`).
- Route: `scorecard.integration.test.ts` 13/13 (8 existing 3-2 + money-shown/flag-off/unlocked + settled-push-$0 + pinned-rev divergence).
- Full regression: engine 596 ✓, wolf-cup-api 616 ✓, tournament-web 404 ✓, tournament-api 1386 ✓ (the one full-suite timeout on `lifecycle-full.e2e` is the documented load flake — passes 1/1 in isolation, NOT a regression). typecheck -r + lint clean.

### Completion Notes List

- **All ACs met.** Engine `Ledger.perHole` (additive, optional in type / always populated) records each settled hole's per-player money BEFORE the `pts===0` short-circuit (push → explicit zero row; incomplete → no row); round totals `cross`/`perPlayerCents`/`totalCents` byte-identical. `-0` normalized on the teamB negation.
- **Golden (NFR-C1) Josh-approved at the spec gate.** `perhole-money-base-flat.json` (sign-cancellation case: A wins 1/2/4/6, B wins 3/5) + `perhole-money-greenie-carryover.json` (carried greenie lands on the resolving par-3; deferred par-3s emit $0 base-push rows). Loss-less invariant asserted per player; NO `totalCents` abs-of-sum relation (correctly dropped per spec review).
- **Chokepoint:** `settleFoursome` ok-result gained an additive `perHole` (caller `computeF1EventEdges` unaffected — reads only `.edges`). New `computeF1PerHoleMoneyForPlayer` settles ONLY the player's foursome through the pinned path; returns a player-signed `Map<hole,cents>` (entry per settled hole incl. explicit 0; unsettled omitted) or `null` (non-F1 / not exposed[flag off OR unlocked] / unpinned / player-not-in-round / unsettleable). Never throws.
- **Scorecard:** `moneyNet` filled via the helper with a `map.has()` guard (a settled push `0` survives — never `?? null`/`|| null`). Exposure mirrors the leaderboard: `locked && f1MoneyEnabled()`.
- **Money exposure RATIFIED (Josh):** event-wide, all joined participants see all players' per-hole money in locked money mode; organizer not exempt while unlocked; the lock toggle is the "turn money on" switch. 3-3 changes no join flow / participant gate / lock toggle.
- **Impl-review (codex+gemini, MANDATORY debate → synthesis HOLD, then fixed):** the High was a course-revision divergence — the scorecard's net/par/si read `event_round.courseRevisionId`/`round.holesToPlay` while money settles from the PINNED `round_pin.courseRevisionId`/`event_round.holesToPlay`, so a post-pin B3 course edit could make displayed net disagree with displayed money. **FIXED:** `buildPlayerScorecard` now sources par/si from the PINNED course revision when a pin exists (falls back to the event-round rev unpinned) and uses `event_round.holesToPlay` (the money source). Net display + per-hole money are now frozen to the same pin by construction. Regression test added (`pinned course revision authority` — pin to rev1, repoint event_round to rev2 with reversed SI, assert the scorecard uses the pinned rev). A settled-push-$0 integration test was added (codex Low).
- **Re-review (parallel-both) after the fix:** gemini clean; codex confirms the divergence is closed (no new High). Codex raised one informational Medium — the scorecard now sources `holesToPlay` from `event_rounds` (the money authority) rather than `rounds`. Verified non-reachable: `holes_to_play` has NO mutation path in the codebase (set once = `event_round.holesToPlay` at start-round, never updated; B3 edit-round-course changes course/tee, not hole count), so the two columns are equal by construction; and `event_rounds.holesToPlay` is the correct authority because the F1 money path (`games-money`/`sub-games`) already uses it — aligning the scorecard to it is the synthesis's directed fix, not a regression. No code change needed.

### Party-phase review (codex+gemini) — adjudication

Gemini clean. Codex raised findings; resolved without 3-3 code change:
- **[High] lockState defaults to 'locked' on null/unexpected (fail-open exposure):** VERIFIED NOT a 3-3 defect. `gameConfig.lockState` is nullable and the ENTIRE codebase defaults unexpected→'locked' (`events-leaderboard.ts:59` resolveF1Mode, `games-money.ts:166` computeF1EventEdges, `money.ts:270`, `game-config-write.ts:113`). My helper (`games-money.ts:561`) is byte-identical in policy — the spec mandated mirroring. **AC5 ("exposure never wider than the leaderboard") provably holds because the gate is IDENTICAL to the leaderboard's**; the scorecard can never be wider. Also gated behind `f1MoneyEnabled` (default off). Changing only my helper would make the scorecard inconsistent with the leaderboard (strictly worse). The null-default money-policy question is pre-existing + cross-cutting (4 sites) → a separate exposure-policy decision, NOT 3-3.
- **[High] party review overclaimed holesToPlay is "pinned":** corrected the party-review wording (course rev is pinned; holesToPlay is live-but-shared, equal by construction). Doc fix, no code.
- **[Medium] partial course_holes: money skips the hole, scorecard throws 500:** theoretical (the course validator T2-4 prevents partial revisions; the scorecard's missing-course-hole throw 500s the whole request before money renders, so no user-facing money inconsistency). Followup.
- **[Medium] `ledger.perHole ?? []` could mask an engine regression:** the golden test asserts `ledger.perHole` directly, so a regression where computeFoursome stops populating it is caught at the test layer. Optional hardening (throw instead of `?? []`) noted.
- **[Low] test claims unverifiable from the limited diff:** artifact of not passing the test files to the party-phase review; the tests exist and pass.

### Followups (deferred, not 3-3 defects)

- **Cross-cutting exposure policy (codex party High #1):** whether an F1 event with a null/unset `lock_state` should default to money-mode ('locked') or scores-only ('unlocked'). Pre-existing across 4 sites (leaderboard, matrix, chokepoint, write path); 3-3 mirrors it. A future money-policy decision for Josh — out of scope for 3-3 (AC5 holds because all sites agree).

- **Perf (codex M2 / gemini M1, should_fix):** the scorecard read calls `computeF1PerHoleMoneyForPlayer`, which re-queries the foursome (scores/claims/holes/pin) and settles — duplicating some of the builder's reads. The heavy `settleFoursome` only runs AFTER the exposure gate (`locked && f1MoneyEnabled()`), so non-F1/unlocked/flag-off rounds short-circuit after ~2 cheap queries; the duplicate-load only hits locked money-mode polling (≤12 players). Optimization = share loaded state (round/eventRound/pin/course_holes/foursome scores) between the builder and the money path in one pass, or memoize per (round,foursome) with a short TTL. Sized as a 3-4/perf followup.
- **money-detail.ts `computeF1FoursomeResults` per-hole fill + My Money F1 `perRound`** — same engine primitive (`Ledger.perHole`), deferred per the spec to keep the golden-gated change minimal. They currently show correct round-level money (just no per-hole breakdown). Land at 3-4 or a 3-x followup.
- **Operational (brochure):** per-hole `$` shows only when the demo/Pete Dye event is LOCKED (money mode) + `TOURNAMENT_F1_MONEY_ENABLED=true`. Lock the capture event before shooting p4.

### File List

- `apps/tournament-api/src/engine/games/types.ts` (modified — `PerHoleMoney` type + `Ledger.perHole`)
- `apps/tournament-api/src/engine/games/compute-foursome.ts` (modified — record per-hole money additively)
- `apps/tournament-api/src/engine/games/__fixtures__/perhole-money-base-flat.json` (new golden fixture)
- `apps/tournament-api/src/engine/games/__fixtures__/perhole-money-greenie-carryover.json` (new golden fixture)
- `apps/tournament-api/src/engine/games/perhole-money.golden.test.ts` (new — golden + loss-less invariant)
- `apps/tournament-api/src/engine/games/compute-foursome.perhole.test.ts` (new — structural unit)
- `apps/tournament-api/src/services/games-money.ts` (modified — settleFoursome perHole + computeF1PerHoleMoneyForPlayer)
- `apps/tournament-api/src/services/games-money.perhole.test.ts` (new — chokepoint helper)
- `apps/tournament-api/src/services/scorecard.ts` (modified — moneyNet via chokepoint + pinned-rev/holesToPlay alignment)
- `apps/tournament-api/src/routes/scorecard.integration.test.ts` (modified — money exposure + push-$0 + pinned-rev divergence)
