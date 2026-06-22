# Story 2.1a: F1 settle-up edges as whole-dollar 1-to-1 (winner↔loser) pairings

Status: ready-for-dev

<!-- Inserted 2026-06-22, user-directed, BEFORE Story 2.2 (greenie). MONEY STORY.
Changes how the F1 2v2 game ledger is lowered to SettlementEdge[] — from the
Story-1.1 four-way pv/2 cross-split to whole-dollar 1-to-1 slot pairings. Engine-
only (Epic-1 ledger-to-edges.ts). NO schema, NO route, NO UI, NO service-logic
change beyond what ledgerToEdges returns. Per-player nets + ledger total are
IDENTICAL; only the edge layout changes. Tournament paths only (FD-1/FD-2). -->

## Story

As a player settling up after an F1 2v2 round,
I want the who-pays-whom to be whole-dollar, one loser paying one winner (the running 2v2 game total),
so that nobody ever sees a confusing half-dollar leg (e.g. "$7.50") and the settle-up matches how we actually pay each other ("I pay Tom, you pay Bill").

## ⚠️ NFR-C1 (money story) — golden gate

The three Epic-1 base goldens are the hand-calc artifact. Their `perPlayerNetCents` and `ledgerTotalCents` are **UNCHANGED**; only the `edges` arrays change (4 legs → 2 legs). The new edge values are approved at the spec gate before the change merges. Auto-approve is disabled (money values).

## Problem (evidence)

`engine/games/compute-foursome.ts:62-65` adds the **same** `half = pts * (pv/2)` to **all four** cross-team cells every hole, so the cross matrix is **always symmetric within a team**: `cross[a1][b1] = cross[a1][b2] = cross[a2][b1] = cross[a2][b2]`, hence `perPlayerCents[a1] = perPlayerCents[a2]` and `perPlayerCents[b1] = perPlayerCents[b2] = −perPlayerCents[a1]` (verified by direct read). `engine/games/ledger-to-edges.ts:18-28` then emits **one edge per cross cell = 4 legs of `pv/2`**. When a team's net points total is **odd**, `pv/2` is a half-dollar, so the real pairwise settle-up shows legs like **$2.50 / $7.50** — confusing to players and not how the group settles. (Confirmed with Josh 2026-06-22: the per-player money is correct, but the *leg layout* should be whole-dollar 1-to-1.)

## Acceptance Criteria

1. `ledgerToEdges` lowers the foursome ledger to **at most two** `SettlementEdge`s by **slot-paired 1-to-1** matching, using the **passed `teamSplit`** (teams are NEVER inferred from ledger balances — so an all-zero push is handled by the per-pair rule below, not a crash): `teamA[0]↔teamB[0]` and `teamA[1]↔teamB[1]`, where the slot order is the stable `pairing_members.slot_number` order already carried by `teamSplit` (teamA = slots 1&2, teamB = slots 3&4). For pair `i`, let `p = perPlayerCents[teamA[i]]`: if `p > 0` → `{ from: teamB[i], to: teamA[i], cents: p }`; if `p < 0` → `{ from: teamA[i], to: teamB[i], cents: −p }`; if `p === 0` → no edge. A **push** (all four per-player = 0) yields an **empty** edge array (no crash). Because the 2v2 ledger is symmetric within a team, any 1-to-1 matching is per-player-equivalent; slot order is chosen as the stable, deterministic pairing. `sourceType:'f1_game'`, caller-supplied `sourceId`, sorted by `(fromPlayerId, toPlayerId)` (unchanged ordering contract). [AC1]
2. **No split-induced halving:** each emitted edge's `cents` equals a player's **full** per-player amount (`perPlayerCents[teamA[i]] = integer points × pointValueCents`) — the `pv/2` halving the 4-way split introduced is **gone**, which is the actual bug Josh saw ($7.50 from a $5 game). The leg is therefore whole-dollar **whenever `pointValueCents` is a whole-dollar amount** — the real-world case (the Standard-Guyan seed is $5 = 500c; whole-dollar point values are the norm). **Whole-dollar point values are now ENFORCED (Josh approved 2026-06-22 — "restrict to whole dollars, no cents; nobody plays $2.50 a point"):** `registry.ts validateSchedule` is tightened from "even cents" to "**whole-dollar (multiple of 100 cents)**" — reason `point_value_not_whole_dollar:${v}`. ×100 subsumes the old even check (so `compute-foursome`'s internal `pv/2` cross-cell stays integer cents). With whole-dollar point values + the 1-to-1 layout, **no half-dollar can ever appear** in a player-facing leg. [AC2]
3. **Loss-less + reconstruction preserved (NFR-C3):** `sum(edge.cents) === ledger.totalCents` (the two 1-to-1 legs sum to the same total the four quarter-legs did — `2·|p| = 4·(|p|/2)`), and the edges **reconstruct all four `perPlayerCents` exactly** (`+p` to each winner, `−p` to each loser). [AC3]
4. **Fail-closed defensive guard, caught per-foursome:** the slot-paired reconstruction is exact only because the 2v2 cross matrix is symmetric within a team. `ledgerToEdges` **verifies** the emitted edges reconstruct `perPlayerCents` exactly and **throws** (`asymmetric_2v2_ledger`) if not. To keep this fail-closed **per foursome** (never an event-wide crash), the `ledgerToEdges` call in `services/games-money.ts` MUST be **inside** the existing per-foursome `try/catch` — it is currently **outside** it (`games-money.ts:452`, after the catch at `:449`), so a throw there would crash the whole compute. Move/wrap the call inside the try so the guard surfaces as `{ kind:'unsettleable', reason:'engine_error' }` for that foursome only (mirrors the AC11 isolation pattern; the catch's comment already anticipates "structural anomaly"). `ledgerToEdges` is scoped to the **symmetric 2v2** ledger; the guard is the boundary, and any future non-2v2 game would get its own edge-lowering (it must not silently reuse this one). (The guard cannot trigger for `guyan-2v2`.) [AC4]
5. **Goldens updated, per-player + total unchanged:** the three base goldens (`guyan-2v2-base-flat.json`, `guyan-2v2-frontback-segmented.json`, `guyan-2v2-nine-hole-front.json`) have their `edges` arrays rewritten to the 2-leg 1-to-1 form; `perPlayerNetCents` and `ledgerTotalCents` are **byte-identical** to before. `_handCalc` notes updated to explain the 1-to-1 layout. [AC5]
6. **All edge-asserting tests audited + updated:** every test that asserts F1 `ledgerToEdges` output (the golden harness; `games.property.test.ts` edge reconciliation; `claims.test.ts:319`; any `games-money` / lifecycle / settle-up test that asserts specific F1 game edges) is updated to the 2-leg form. The 1v1 **bets** engine (`engine/bets/**`, its own `SettlementEdge`) is **NOT** touched. [AC6]
7. **No per-player or total change anywhere:** the dual-read into the pairwise settle-up (Story 1.4) and `services/money*.ts` consume edges that net to identical per-player balances; assert (test) that an example round's per-player settle-up totals are unchanged vs the 4-leg layout. [AC7]
8. Engine-only: `apps/tournament-api/**`. No schema, migration, route, UI, or service-logic change (only the value `ledgerToEdges` returns differs). [AC8]

## Tasks / Subtasks

- [ ] **Task 1 — `ledger-to-edges.ts` 1-to-1 rewrite (AC: 1,2,4)** — replace the 4-cell loop with slot-paired 1-to-1 (teamA[i]↔teamB[i]) using `perPlayerCents` from the passed `teamSplit`; direction by sign; skip 0 (push → empty); keep the `(from,to)` sort. Add the reconstruction guard (throw `asymmetric_2v2_ledger` if the ≤2 edges don't reproduce all four `perPlayerCents`).
- [ ] **Task 1b — move `ledgerToEdges` inside the per-foursome try/catch (AC: 4)** — in `services/games-money.ts`, the `ledgerToEdges` call (currently `:452`, after the catch at `:449`) moves **inside** the `try` (e.g. compute `edges` right after `computeFoursome` at `:438`, return them, or wrap), so the AC4 guard throw is caught and returned as `{ kind:'unsettleable', reason:'engine_error', detail }` for that foursome only — never an uncaught event-wide crash. No other games-money change.
- [ ] **Task 1c — whole-dollar point values in `registry.ts` (AC: 2)** — `validateSchedule`: replace the `v % 2 !== 0 → point_value_not_even` check with `v % 100 !== 0 → point_value_not_whole_dollar` (×100 subsumes even). Update the function comment. Audit + update any registry/config-schema test that asserted an even-but-not-×100 value (e.g. 2c, 50c) as valid → it must now be rejected; confirm the seed ($5=500c) + all 3 goldens (multiples of 100) still pass. The 3 base goldens use whole-dollar point values already, so no golden value changes from this.
- [ ] **Task 2 — `ledger-to-edges.test.ts` (AC: 1,2,3,4)** — new focused unit tests: A-up / B-up / push(0 edges) cases; whole-dollar legs for an ODD-point ledger (the bug case → 2 legs, no half); loss-less + reconstruction; the asymmetry guard throws on a hand-built asymmetric cross matrix.
- [ ] **Task 3 — update the 3 base goldens (AC: 5)** — rewrite each `edges` array to the 1-to-1 2-leg form derived from its (unchanged) `perPlayerNetCents`; leave `perPlayerNetCents` + `ledgerTotalCents` byte-identical; refresh `_handCalc`.
- [ ] **Task 4 — audit + update edge-asserting tests (AC: 6,7)** — grep `ledgerToEdges(` + any literal F1 edge assertions; update `claims.test.ts`, `games.property.test.ts` (the generic reconciliation should still pass — confirm; optionally tighten to assert ≤2 edges + whole-dollar), and any `games-money`/lifecycle/settle-up test asserting specific F1 edges. Add an AC7 per-player-settle-up-unchanged assertion. Do NOT touch `engine/bets/**`.
- [ ] **Task 5 — regression gate** — `pnpm --filter @tournament/api test`, `pnpm -r typecheck`, `pnpm -r lint` green; engine + wolf-cup + web unchanged; confirm NO `perPlayerNetCents`/`ledgerTotalCents` changed in any golden (only `edges`).

## Dev Notes

### Golden hand-calc (Josh-approves at the spec gate) — NFR-C1

The change is purely the edge **layout**. Concrete example — `guyan-2v2-base-flat.json` (unchanged: `perPlayerNetCents = {a1:+1500, a2:+1500, b1:−1500, b2:−1500}`, `ledgerTotalCents = 3000`):

- **Before (4 legs of pv/2 = $7.50):** `b1→a1 750, b1→a2 750, b2→a1 750, b2→a2 750`.
- **After (2 whole-dollar 1-to-1 legs):** `b1→a1 1500, b2→a2 1500`. Sum = 3000 (unchanged). Reconstructs a1 +1500, a2 +1500, b1 −1500, b2 −1500 (unchanged).

Your model exactly: the "$15 game" is the per-player figure; the "$30 layout" is the ledger total (two legs); **b1 pays a1 $15, b2 pays a2 $15** — "I pay Tom, you pay Bill." The other two base goldens follow the identical transform from their own `perPlayerNetCents` (transcribed at implementation; per-player + total unchanged).

> **Approving this spec = approving the 1-to-1 edge layout and that no `perPlayerNetCents`/`ledgerTotalCents` changes.**

### Why slot-paired 1-to-1 is exact (verified)

`compute-foursome.ts` adds the same `half` to all four cross cells per hole → the cross matrix is symmetric within a team → `perPlayerCents[a1]=perPlayerCents[a2]`, `perPlayerCents[b_i] = −perPlayerCents[a_i]`. So pairing `teamA[i]↔teamB[i]` with the full per-player amount reconstructs every balance exactly and is always whole-dollar. The AC4 guard makes this assumption explicit + fail-closed for any future game whose matrix is not symmetric.

### Reuse / source

- [Source: apps/tournament-api/src/engine/games/ledger-to-edges.ts] (the function to rewrite — verified) · [Source: …/compute-foursome.ts:62-65] (symmetry origin — verified)
- [Source: …/engine/games/guyan-2v2.golden.test.ts] + the 3 `__fixtures__/guyan-2v2-*.json` (goldens to update) · [Source: …/games.property.test.ts] (generic edge reconciliation — should stay green)
- Edge-assertion consumers found via `ledgerToEdges(`: `services/games-money.ts:452`, `routes/claims.test.ts:319`, the golden + property tests. The 1v1 **bets** edges (`engine/bets/**`) are a separate system — out of scope.

### Out of scope (+ logged follow-up)

Greenie (2.2, resumes after this); any change to `perPlayerCents`/`totalCents`/the cross matrix/`compute-foursome` math; schema/route/UI; the money-presentation screens (they consume per-player, unchanged).

**Follow-up logged (separate story):** Josh also wants the **1v1 "Action" bets** (the separate `engine/bets/**` system + its stake-entry UI) restricted to **whole-dollar stakes, no cents** — "restrict bets to whole dollars." That is a different engine/validation surface from the F1 point value tightened here, so it is its own story: *"The Action — whole-dollar bet stakes (reject cents at entry + validation)."* Not touched in 2-1a.

### Project Structure Notes

Edit: `engine/games/ledger-to-edges.ts`, 3 `__fixtures__/guyan-2v2-*.json`, edge-asserting tests. New: `engine/games/ledger-to-edges.test.ts`. All `apps/tournament-api/**` (ALLOWED).

### Testing standards

Vitest. Must-have: 1-to-1 direction (A-up/B-up/push); ODD-point whole-dollar legs; loss-less + reconstruction; asymmetry guard throws; 3 goldens green with unchanged per-player/total; per-player settle-up unchanged vs the old layout; full api suite + typecheck + lint green.

### References

- [Source: epics-f1-rules-games.md] (FR settlement / NFR-C3) · [Source: 2-2-greenie-modifier-stateful-carryover.md "Follow-up logged"] (this story is that follow-up) · Josh 2026-06-22 (the 1-to-1 mental model: "$25 game / $50 layout / I pay Tom, you pay Bill").

## Files this story will edit

- apps/tournament-api/src/engine/games/ledger-to-edges.ts
- apps/tournament-api/src/engine/games/ledger-to-edges.test.ts
- apps/tournament-api/src/engine/games/registry.ts
- apps/tournament-api/src/services/games-money.ts
- apps/tournament-api/src/engine/games/__fixtures__/guyan-2v2-base-flat.json
- apps/tournament-api/src/engine/games/__fixtures__/guyan-2v2-frontback-segmented.json
- apps/tournament-api/src/engine/games/__fixtures__/guyan-2v2-nine-hole-front.json
- apps/tournament-api/src/engine/games/games.property.test.ts
- apps/tournament-api/src/engine/games/__fixtures__/cascade-resolver-lock-gate.json
- apps/tournament-api/src/services/game-config-write.test.ts
- apps/tournament-api/src/routes/claims.test.ts
- _bmad-output/implementation-artifacts/tournament/2-1a-f1-settle-up-whole-dollar-one-to-one-edges.md
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

(Plus any additional F1-edge-asserting test surfaced by the Task 4 audit — `games-money.test.ts` / `games-money.disjointness.test.ts` / lifecycle e2e — added to this list at implementation if they assert specific F1 game edges. The 1v1 bets engine is never touched.)

## Spec-gate note (auto-approve disabled — money story)

Carries money values (the goldens' new edge layout) under NFR-C1; presented for a manual gate even if the ensemble is clean.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context).

### Debug Log References

### Completion Notes List

### File List
