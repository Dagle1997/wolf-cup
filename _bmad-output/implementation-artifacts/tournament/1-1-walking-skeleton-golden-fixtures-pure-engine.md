# Story 1.1: Walking skeleton — golden fixtures + pure engine for the base Guyan 2v2 game

Status: done

<!-- F1 "Rules & Games" Epic 1 (The Rule-Set Spine). Source of truth:
_bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md#Story-1.1.
This is the FOUNDATION story — golden-bearing (NFR-C1 hard gate). -->

## Story

As the F1 platform (foundation),
I want hand-approved golden fixtures and a pure settlement engine for the base 2v2 Guyan game (low-ball + net-birdie point) that matches them,
so that all later F1 money is built on a hand-proven, deterministic core with zero live-data risk.

## Acceptance Criteria

**Golden-fixtures-first (NFR-C1 hard gate)**

1. The FIRST build artifact is a hand-authored, hand-approved golden fixture set under `apps/tournament-api/src/engine/games/__fixtures__/*.json` for the base 2v2 game. The fixture input contract supplies as GIVEN: **per hole** — an explicit **`holeNumber`** (course hole number, 1–18; required so front/back segments and the carryover ordinal in later epics are deterministic), the hole **`par`**, and each player's **`net`** for that hole (hand-calc, independent of the allocation wired in Story 1.4); and **once per foursome** (constant across holes) — the **intra-foursome team split** (which two of the four players form each team). [AC1]
2. The base game is the **standard Guyan 2v2** — a faithful **replication of Wolf Cup `packages/engine/src/money.ts` `calc2v2` + `bonuses.ts` `apply2v2`** (READ-ONLY reference, **replicated, never imported**; FD-1/FD-2), adapted to **FIXED 2v2 teams** (the team split is set from slots 1&2 vs 3&4 — no per-hole "pick a partner" wolf rotation, and **no skins-holes-1&3 exception**; every hole plays the 2v2 game). Decision ratified by Josh 2026-06-21 ("pull wolf money 100%; same core but set 2v2"). [AC2]

**Money-flow semantics — Wolf Cup 3-point model (per-player point ledger → `SettlementEdge[]`)**

2a. **Three team points per hole, each `+1 / −1` per player (zero-sum; 2 win, 2 lose).** Per hole the engine awards three independent team points; each point gives **+1 to each winning-team player and −1 to each losing-team player** (Wolf Cup's per-player point model, `lb`/`sk`/`tt`):
   - **(1) Low ball** — each team's **best (min) net**; lower wins the point; tie → 0.
   - **(2) Skin** — **follows the low-ball winner**, but only if the winning team's low ball is **≤ par** (the **NET ≤ par** gate, exactly as Wolf Cup `skinTeam` codes it); low-ball tie OR winning-low > par → 0.
   - **(3) Team total** — each team's **combined (sum) net** of both players; lower wins the point; tie → 0. **Independent of low ball** — it can go to the other team.
   A team's net hole points = (points it won − points it lost) ∈ [−3, +3] before bonuses. [AC2a]

2b. **Net-skins bonus (on top of the 3 base points) — replicates Wolf Cup `competitiveScoreSkins`/`apply2v2` NET path.** A **net-skins** modifier (labeled **"net skins"** in the rules setup; **default ON**; toggleable off in game rules — Josh 2026-06-21) awards bonus points by **NET level, winner-takes-all**: each team's best net level is `birdie` (net = par−1) → 1, `eagle` (par−2) → 2, `double_eagle` (par−3+) → 3 (Wolf Cup `detectBonusLevel`/`skinCount`); the team with the **strictly higher** best-level wins **that many** bonus points; **equal best-levels = NO blood**; both level-0 = none. The bonus is also **`+N / −N` per player** (Wolf Cup `bonusSkins[p] = skinsA − skinsB`), added to the 3 base points. **Story 1.1 scope = NET, single.** The gross-dependent **double-birdie/eagle** bonus (`competitiveScoreSkins` lines 117–137, needs a natural/gross birdie) = **Story 2.5**; **greenie/polie/sandie claims** = **Epic 2**. Net-birdie and net-eagle are ONE mechanism — `enabled`/`basis` co-governs all levels (off → no net point at any level). Type id renamed **`net-skins`** (no legacy config exists). [AC2b]

2c. **Point → cents → per-player ledger → edges.** Each point = `pointValueCents` (flat OR front/back segmented per `pointValueSchedule`, AC4). A player's hole money = `(net points that hole) × pointValueCents`, integer cents (NFR-C2). The engine accumulates a **per-player point/cents ledger** over the round (zero-sum — the four players sum to 0, the Wolf-Cup `validateZeroSum` invariant); `ledger-to-edges` then lowers the per-player balances to a **canonical, deterministic `SettlementEdge[]`** (AC17). Because both teammates always receive identical team points, within-team balances are equal each hole; the canonical edge decomposition is the **4 cross-team edges** of `(per-player net cents ÷ 2)` (whole-dollar point values keep this integer). The fixtures assert BOTH the per-player net cents AND the netted edge list. [AC2c]

3. Each fixture asserts the **exact `SettlementEdge[]`** (`{fromPlayerId, toPlayerId, cents}`, `from` PAYS `to`), not merely a money total — so a `ledger-to-edges` rounding error or a wrong payee cannot pass. The hand-approval covers the cash, not the total. [AC3]
4. The fixture set covers **both point-value shapes** — a single value all round AND a **front/back segmented** schedule ($5 front / $10 back) — including a **segment→hole boundary** case. Segments map by **course hole number** (front 1–9 / back 10–18). The **9-hole-round** case is covered (FR3, R5). [AC4]
5. **No settlement engine code is written or committed before that fixture set is approved by Josh** (NFR-C1 hard gate). Enforcement is split, because "approved" is not machine-checkable: (a) the **human approval gate** — the director pauses after Task 1 and Josh signs off the hand-calc `_handCalc` blocks before any resolver/engine code is written; (b) the **CI-checkable invariant** — the golden `__fixtures__/*.json` exist and are consumed by table-driven tests that assert the *exact* `expected.edges`, and those tests run green in the standard `pnpm --filter @tournament/api test` suite that CI already executes (no bespoke CI job required — the ordering is enforced by the human gate + task sequence, and the suite simply proves the committed engine matches the committed goldens). The `_handCalc` block is the durable approval artifact. [AC5]
6. All **product/code** work is confined to `apps/tournament-api` (Tournament paths only; FD-1/FD-2) — no edits to `apps/api`, `apps/web`, or `packages/engine`. The only non-app paths this story writes are BMAD **process artifacts** (this story file and `sprint-status.yaml`, both under `_bmad-output/implementation-artifacts/tournament/`, an ALLOWED tracking path) — they are not application code and do not weaken AC6's code-confinement. [AC6]

**Pure engine modules (pattern 1)**

7. `engine/games/` contains `types.ts` (game shape `{scope, countingRule, pointValueSchedule, cap?, settlement, modifiers[]}` where **`pointValueSchedule` expresses flat OR front/back segmented** — a valid TS identifier, serialized identically in the JSON fixtures so the TS↔JSON contract cannot drift; `modifier {type, enabled, variant}`; `holeState` carrying **holeNumber + par + per-player net** (the per-hole data); the **team split** is a **separate foursome-level input** (constant across holes, AC1/AC12), NOT a `holeState` field; `ledger`; `contribution`), `registry.ts` (`register(type, resolver)`, stable application order), `resolver.ts` (cascade deep-merge, most-specific-wins, lock-gated), `compute-foursome.ts`, `ledger-to-edges.ts`, `modifiers/net-birdie.ts`, and `games/guyan-2v2.ts`. [AC7]
8. None of the engine modules import `db`, `Date`, or random — deps-in only (callers pass scores/net/par/team-split/config). [AC8]

**computeFoursome — base 2v2 + net-birdie**

9. Given per-player **net** (already allocated), par, and the team split as inputs to a resolved config, `computeFoursome(itsOwnConfig, itsOwnInputs)` returns a foursome ledger settling 2v2 **team-low-net** + net-birdie in **integer cents** (NFR-C2), applying the point value **per hole** (flat or front/back per the schedule), reading structurally only its own foursome's config + inputs (FR23 isolation by signature). [AC9]
10. The engine consumes **net as a given** — it does NOT take gross scores or compute allocation (gross→net is the Story 1.4 service layer); this keeps the engine pure and the goldens allocation-independent. [AC10]
11. The **net level** (birdie/eagle/double_eagle) is detected from **net vs par** — mirroring Wolf Cup's `detectBonusLevel` (par−1 → birdie/1, par−2 → eagle/2, par−3+ → double_eagle/3); par is required, hence it lives in `holeState`. The bonus is winner-takes-all by level (AC2b). [AC11]
12. The **team split is an explicit engine input** (slots 1&2 vs 3&4); the engine never reads `pairings` — Story 1.4 feeds the split from the shipped `resolveFoursomeTeams`. [AC12]
13. Output is **order-independent** — invariant to map/iteration/insertion order, via stable sorts, no `Map`-iteration-order dependence (NFR-C6). [AC13]
14. Ties / pushes / halves resolve deterministically per the configured rule (FR42). [AC14]
15. A **fixed, named, total-conserving remainder rule — lowest-`playerId`-first** — is defined here as the single canonical rule every later split path references, so the paths cannot diverge (NFR-C7). **Application point:** the rule fires **only** when an integer-cents amount is divided among N>1 recipients and the division is inexact (`amount % N ≠ 0`); the `amount % N` leftover pennies are handed out one each to recipients in ascending `playerId` order. **In the base 2v2 + net-birdie game of this story there is no such division** — every pairwise edge is exactly `pointValueCents` (integer), so the rule is defined-but-inert here (its first live use is the Epic 2 cap collapse / Story 3.4 pot split). The engine exposes the named helper now; a unit test asserts its behavior on a constructed odd split so later epics inherit a proven primitive. [AC15]
16. The **segment→hole boundary** is golden-tested (front/back point value applies to the right holes; R5). [AC16]

**Ledger → edges (SettlementEdge IR)**

17. `ledger-to-edges.ts` lowers a computed foursome ledger to `SettlementEdge {fromPlayerId, toPlayerId, cents, sourceType: 'f1_game', sourceId}` (`from` PAYS `to`), and the edge sum reconciles loss-lessly to the ledger total (NFR-C3). **`sourceId` is a caller-supplied input** (passed into `ledgerToEdges(ledger, { sourceId })`), NOT derived inside the engine — keeping the engine pure (no id-generation, no `Date`/random). Story 1.4 supplies the real `sourceId` (the game-config / round identity that makes edges idempotent and de-dup-able at the betting chokepoint); the fixtures pass a fixed literal `sourceId` so `expected.edges` is deterministic. [AC17]

**Cascade resolver**

18. When resolving config for an (event, round, foursome), `resolver.ts` deep-merges with **precedence Foursome > Round > Event** (most-specific level wins). Implementation: start from the Event (broadest) config and apply Round, then Foursome on top, so a more-specific level overrides; absent levels are skipped. Gated by `lock_state`, golden-tested **including the lock gate** (R6). **Merge semantics (precise):** scalars (e.g. `pointValueSchedule`, `cap`, `lock_state`) are overridden by the most-specific level that sets them; the **`modifiers[]` array is merged by modifier `type`** (a more-specific level's entry for a given `type` replaces the same-`type` entry from a broader level; types only present at a broader level are retained) — arrays are NOT concatenated and NOT wholesale-replaced. **Lock gate (precise):** when the resolved **event-level** `lock_state` is `locked`, lower-level (round/foursome) overrides are **ignored** by the resolver (the event config wins outright); when `unlocked`, the cascade merge applies. In Epic 1 only event/round levels are ever populated, but the resolver is written and tested for all three. The lock-gate fixture asserts both branches (locked → event config returned despite a round override present; unlocked → round override merged). [AC18]
19. The resolver is **level-parameterized from day one** (consumes config rows keyed by `level` ∈ event|round|foursome) so adding **foursome-level** rows in Epic 6 composes with no engine change (in E1 only event/round levels are populated). [AC19]
20. An unknown modifier `type`, or a `config_version` newer than the engine supports, **fails closed** (returns unsettleable + surfaced) — never silent-ignored (pattern 6, FR44). [AC20]

**Property suite (fast-check)**

21. `engine/games/*.property.test.ts` (`fast-check`) proves, for arbitrary configs: **foursome isolation** (changing foursome B's config never moves foursome A's ledger), **loss-less decomposition** (`sum(splits) == combined`), and **order-independence** (NFR-C3/C6). [AC21]
22. **cap-never-exceeds is explicitly deferred to Epic 2** (the cap mechanic does not exist yet) — no cap logic in this story. [AC22]

**Closing goal**

23. When 1.1 closes, the **Standard Guyan base** fixture is green; the Wolf-Cup-variant / "345"-cap / segmented-with-modifiers fixtures are authored in Epic 2 with their mechanics (this story authors the base + the point-value-schedule/segment goldens only). [AC23]

## Tasks / Subtasks

- [ ] **Task 1 — Author + hand-approve golden fixtures FIRST (AC: 1,2,3,4,5)** — HARD GATE
  - [ ] Study the shipped precedent `apps/tournament-api/src/engine/bets/__fixtures__/*.json` — reuse the `{name, _contract, input, expected, _handCalc}` shape, integer cents, `fromPlayerId PAYS toPlayerId` direction convention.
  - [ ] Net-birdie rule RE-GROUNDED on Wolf Cup `bonuses.ts` (AC2b: winner-takes-all by net level — par win=1, birdie win=2, eagle win=3 skins; equal level=no blood; net-only single for 1.1). Hand-calc per that rule.
  - [ ] Author base 2v2 fixture: per hole, winning team (lower team-low-net) collects `1 + skinCount(best net level)` skins, each skin = 4 cross-pair edges of `pointValueCents` (AC2a+AC2b); halve/equal-level = no blood. Include a **par win** (1 skin), a **net-birdie win** (2 skins), a **net-eagle win** (3 skins), and an **equal-birdie no-blood** hole. Hand-calc the netted `expected.edges` (exact `SettlementEdge[]`) and fill `_handCalc`.
  - [ ] Author front/back segmented fixture ($5 front / $10 back) incl. a **segment→hole boundary** assertion (hole 9 vs 10).
  - [ ] Author 9-hole-round fixture (front-9 only) per FR3/R5.
  - [ ] Author lock-gate + cascade resolver fixtures (event-only; event+round override; locked vs unlocked) for AC18.
  - [ ] **STOP and present the hand-calc fixtures to Josh for approval (NFR-C1). Do NOT write resolver/engine code until approved.**
- [ ] **Task 2 — `types.ts` (AC: 7,8)** — game shape, `pointValueSchedule` (flat | front/back segmented), `modifier`, `holeState` (holeNumber + par + per-player net), the **foursome-level team split** input (separate from `holeState`), `ledger`, `contribution`. No db/Date/random imports.
- [ ] **Task 3 — `registry.ts` (AC: 7,20)** — `register(type, resolver)` with a **stable application order**; unknown type fails closed.
- [ ] **Task 4 — `resolver.ts` (AC: 18,19,20)** — cascade deep-merge most-specific-wins (Foursome→Round→Event), level-parameterized (event|round|foursome), `lock_state`-gated; unknown modifier / too-new `config_version` fails closed.
- [ ] **Task 5 — `modifiers/net-skins.ts` (AC: 11,2b)** — net-level detection (`detectBonusLevel`-equiv: par−1/−2/−3+ → 1/2/3) + winner-takes-all-by-level bonus points (equal level = no blood), `+N/−N` per player. Net-only, single. Default ON. Replicates Wolf Cup `competitiveScoreSkins`/`apply2v2` net path (READ-ONLY ref, never imported).
- [ ] **Task 6 — `games/guyan-2v2.ts` (AC: 9,14,2a,2b)** — the 3 base team points (low ball; skin gated NET ≤ par; team total), each `+1/−1` per player, composed with the net-skins bonus; replicates Wolf Cup `money.ts` `calc2v2` with FIXED teams. Per-player zero-sum ledger.
- [ ] **Task 7 — `compute-foursome.ts` (AC: 9,10,12,13)** — `computeFoursome(config, inputs) → ledger`; net-as-given; team split as explicit input; order-independent (stable sorts).
- [ ] **Task 8 — `ledger-to-edges.ts` (AC: 17)** — lower ledger → `SettlementEdge[]` (`sourceType: 'f1_game'`), loss-less reconcile to ledger total. Reuse the `engine/bets/settlement-edge.ts` conventions (direction, integer-cents guards).
- [ ] **Task 9 — Golden tests green (AC: 3,16,23)** — table-drive the `__fixtures__/*.json` through the engine; assert exact `expected.edges`. Mirror `engine/bets/settlement-edge.test.ts`.
- [ ] **Task 10 — Property tests (AC: 13,21)** — `fast-check`: foursome isolation, loss-less decomposition, order-independence. (cap-never-exceeds deferred — AC22.)
- [ ] **Task 11 — Regression gate (AC: 6)** — `pnpm --filter @tournament/api test`, `pnpm -r typecheck`, `pnpm -r lint` green; engine + wolf-cup suites unchanged.

## Dev Notes

### The golden gate is the law of this story (NFR-C1)
Fixtures are authored and **Josh-approved before any resolver/engine code**. The approval artifact is the per-fixture `_handCalc` string (a full hand-trace of net totals → hole points → edges). This mirrors how `engine/bets/` shipped (the betting epic's hard gate). The director will pause at Task 1 completion for Josh's sign-off; the spec gate auto-approving does NOT waive this in-story human gate.

### Reuse the shipped seams (verified paths — do NOT reinvent)
- **`SettlementEdge` IR** — type at `apps/tournament-api/src/engine/bets/types.ts`; helpers at `apps/tournament-api/src/engine/bets/settlement-edge.ts` (`netPairwise`, integer-cents + equal-from/to guards, deterministic sort by `(fromPlayerId, toPlayerId)`). Story 1.1's `ledger-to-edges.ts` emits the SAME IR with `sourceType: 'f1_game'`. The bets settle-up (`netPairwise`) is what Story 1.4 routes F1 edges through later — 1.1 only needs to emit a clean edge list.
- **Golden fixture shape** — `apps/tournament-api/src/engine/bets/__fixtures__/*.json`: `{name, _contract, input, expected, _handCalc}`; integer cents; `fromPlayerId PAYS toPlayerId`; the engine **consumes net-per-hole as a GIVEN** (it never re-derives net — exactly Story 1.1 AC10). Copy this contract verbatim.
- **Golden test pattern** — `apps/tournament-api/src/engine/bets/settlement-edge.test.ts` (and the per-bet `*.test.ts`) table-drive the JSON fixtures and assert exact edges. Mirror it.
- **`resolveFoursomeTeams`** — `apps/tournament-api/src/services/foursome-teams.ts` (`FoursomeTeams` interface, slots 1&2 vs 3&4; returns `null` on corrupt slot data per the Pete Dye hardening). NOT consumed by the engine in 1.1 (the team split is an explicit fixture/engine input); Story 1.4 wires it. Cited so the dev keeps the split convention identical.
- **`fast-check ^4.8.0`** — already in `apps/tournament-api/package.json`. Zero new dependencies for the property suite (pattern 18).

### Module layout (new — parallels `engine/bets/`)
```
apps/tournament-api/src/engine/games/
  types.ts            registry.ts        resolver.ts
  compute-foursome.ts ledger-to-edges.ts index.ts (barrel)
  modifiers/net-birdie.ts
  games/guyan-2v2.ts
  __fixtures__/*.json
  *.test.ts  *.property.test.ts
```
`engine/games/` sits beside the existing `engine/bets/`, `engine/formats/`, `engine/rules/` — same purity rules (no db/Date/random).

### Counting rule + money flow (pin in fixtures + `guyan-2v2.ts`) — see AC2, AC2a–2c
- **REPLICATES Wolf Cup `money.ts` `calc2v2` + `bonuses.ts` `apply2v2`** (READ-ONLY ref), fixed 2v2 teams, every hole.
- **3 base team points/hole**, each `+1`/`−1` per player (zero-sum): **Low ball** (team best/min net; lower wins; tie 0) · **Skin** (follows low-ball winner, gated winning low-ball **NET ≤ par**; tie/over-par 0) · **Team total** (team combined/sum net; lower wins; tie 0; independent of low ball).
- **net-skins bonus** (default ON, labeled "net skins" in setup, toggleable off): winner-takes-all by NET level (birdie 1 / eagle 2 / double_eagle 3 via `detectBonusLevel`); strictly-higher best level wins that many points; **equal level = no blood**; `+N/−N` per player (`bonuses.ts` `bonusSkins[p]=skinsA−skinsB`). **Story 1.1 = NET single.** Gross double-birdie/eagle → Story 2.5; greenie/polie/sandie claims → Epic 2.
- **money:** each point = `pointValueCents`; player hole money = `(net points) × pointValueCents`; per-player ledger zero-sum (`validateZeroSum`-equiv). `ledger-to-edges` lowers per-player balances to **4 cross-team edges of `(per-player cents ÷ 2)`** (whole-dollar values keep it integer). The earlier "4 edges of `pointValueCents` per skin" was WRONG (2× over-count) — corrected to the per-player point model.
- **point value**: per hole; flat OR front/back per `pointValueSchedule`. Segments by course hole number (1–9 / 10–18). 9-hole rounds = front only (AC4, AC16).
- **remainder pennies**: lowest-`playerId`-first, total-conserving (NFR-C7); the `÷2` edge split is integer for whole-dollar point values; first live remainder use is Epic 2 cap / Story 3.4 pot (AC15).

### Out of scope (explicit)
Schema/db (`game_config`, pin store) = Story 1.2. Seed UI + point-value control = Story 1.3. Live settlement wiring (`services/games-money.ts`, dual-read, gross→net allocation, `resolveFoursomeTeams` feed, leaderboard money mode) = Story 1.4. Claims/greenie/polie/sandie/cap/Wolf-variant/"345" + cap-never-exceeds property = Epic 2. Global teams + pot = Epic 3.

### Project Structure Notes
- New code only under `apps/tournament-api/src/engine/games/**` — additive, no edits to existing modules. Aligns with the established `engine/<domain>/` convention (`bets`, `formats`, `rules`, `validators`).
- No DB migration in this story (pure engine). No route/UI changes.
- `index.ts` barrel exports the public engine surface (`computeFoursome`, `ledgerToEdges`, `registry`, `resolveConfig`, types) for Story 1.4 to consume.

### Testing standards
- Golden JSON fixtures + table-driven `*.test.ts` (Vitest) asserting **exact `SettlementEdge[]`** — the bets-module pattern.
- `fast-check` property tests for isolation / loss-less / order-independence (NFR-C3/C6).
- Gate: `pnpm --filter @tournament/api test` + `pnpm -r typecheck` + `pnpm -r lint` green; no regression in engine or wolf-cup suites (NFR-X2).

### References
- [Source: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md#Story-1.1]
- [Source: _bmad-output/planning-artifacts/tournament/architecture-f1-rules-games.md] (patterns 1/6/14/16/18; D1–D7)
- [Source: _bmad-output/planning-artifacts/tournament/prd-f1-rules-games.md] (FR3, FR23, FR42, FR44; NFR-C1/C2/C3/C6/C7)
- [Source: apps/tournament-api/src/engine/bets/types.ts] (SettlementEdge type — verified)
- [Source: apps/tournament-api/src/engine/bets/settlement-edge.ts] (edge helpers + invariants — verified)
- [Source: apps/tournament-api/src/engine/bets/__fixtures__/h2h-net-a-clean-win.json] (golden fixture shape — verified)
- [Source: apps/tournament-api/src/services/foursome-teams.ts] (resolveFoursomeTeams / slot convention — verified)
- [Source: packages/engine/src/money.ts] **(Wolf Cup — READ-ONLY canonical reference, NEVER imported; FD-1/FD-2):** `calc2v2` — the 3 base team points (low ball `lb`, skin `skinTeam` gated NET ≤ par, team total `tt`), each `+1/−1` per player via `player()`, zero-sum (`validateZeroSum`). F1 replicates this with FIXED teams ("pull wolf money 100%" — Josh 2026-06-21).
- [Source: packages/engine/src/bonuses.ts] **(Wolf Cup — READ-ONLY canonical reference, NEVER imported):** `detectBonusLevel` (net-level birdie/eagle/double_eagle), `skinCount` (1/2/3), `competitiveScoreSkins` + `apply2v2` — the net-skins winner-takes-all-by-level bonus (`+N/−N` per player) F1 replicates. The natural-gross double-birdie/eagle blocks (lines 117–137) are Story 2.5. Story 2.8 cross-validates F1 output against Wolf Cup.
- [Source: HANDOFF-f1-build.md] (build constraints, ratified decisions, golden-bearing list)

## Files this story will edit

- apps/tournament-api/src/engine/games/types.ts
- apps/tournament-api/src/engine/games/registry.ts
- apps/tournament-api/src/engine/games/resolver.ts
- apps/tournament-api/src/engine/games/compute-foursome.ts
- apps/tournament-api/src/engine/games/ledger-to-edges.ts
- apps/tournament-api/src/engine/games/index.ts
- apps/tournament-api/src/engine/games/modifiers/net-skins.ts
- apps/tournament-api/src/engine/games/games/guyan-2v2.ts
- apps/tournament-api/src/engine/games/__fixtures__/guyan-2v2-base-flat.json
- apps/tournament-api/src/engine/games/__fixtures__/guyan-2v2-frontback-segmented.json
- apps/tournament-api/src/engine/games/__fixtures__/guyan-2v2-nine-hole-front.json
- apps/tournament-api/src/engine/games/__fixtures__/cascade-resolver-lock-gate.json
- apps/tournament-api/src/engine/games/compute-foursome.test.ts
- apps/tournament-api/src/engine/games/ledger-to-edges.test.ts
- apps/tournament-api/src/engine/games/resolver.test.ts
- apps/tournament-api/src/engine/games/games.property.test.ts
- _bmad-output/implementation-artifacts/tournament/1-1-walking-skeleton-golden-fixtures-pure-engine.md
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Tournament Director cycle, 2026-06-21)

### Debug Log References

- `npx vitest run src/engine/games/guyan-2v2.golden.test.ts` → 1 passed (base golden green).

### Completion Notes List

- **Model defined + Josh-approved (NFR-C1 gate cleared 2026-06-21):** standard Guyan 2v2 = Wolf Cup money replicated (3 points: low ball · skin[NET ≤ par] · team total, each +1/−1 per player) + net-skins bonus (winner-takes-all by net level, default ON), FIXED 2v2 teams. Money model corrected from an initial wrong "4 edges of pointValue per skin" to the per-player point model (`+N/−N`, lowered to 4 cross-team edges of `cents÷2`). Net-skins renamed from `net-birdie`. Spec re-grounded on `packages/engine/src/{money.ts,bonuses.ts}` (READ-ONLY).
- **DONE (core slice, base golden GREEN):** `types.ts`, `modifiers/net-skins.ts`, `games/guyan-2v2.ts` (3 points + net-skins), `compute-foursome.ts` (cross-team ledger, order-independent, complete-cell gate), `ledger-to-edges.ts` (4-edge lowering, sorted), `guyan-2v2.golden.test.ts`, `__fixtures__/guyan-2v2-base-flat.json` (hand-approved).
- **REMAINING (Story 1.1):** `registry.ts` + `resolver.ts` (cascade deep-merge + lock gate, AC18–20) · `index.ts` barrel · fixtures: segmented front/back (AC4), 9-hole front-only (AC16), cascade-resolver/lock-gate (AC18) · property tests (`fast-check`: isolation/loss-less/order-independence, AC21) · regression gate (AC: 6/Task 11) · then director steps 6–10 (impl codex-review, party-mode, commit with status=done).

### File List

- apps/tournament-api/src/engine/games/types.ts (new)
- apps/tournament-api/src/engine/games/modifiers/net-skins.ts (new)
- apps/tournament-api/src/engine/games/games/guyan-2v2.ts (new)
- apps/tournament-api/src/engine/games/compute-foursome.ts (new)
- apps/tournament-api/src/engine/games/ledger-to-edges.ts (new)
- apps/tournament-api/src/engine/games/guyan-2v2.golden.test.ts (new)
- apps/tournament-api/src/engine/games/__fixtures__/guyan-2v2-base-flat.json (new, hand-approved)
