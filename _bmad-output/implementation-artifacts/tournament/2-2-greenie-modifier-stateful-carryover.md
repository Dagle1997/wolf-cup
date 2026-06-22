# Story 2.2: Greenie modifier (stateful carryover) + golden

Status: in-progress

<!-- F1 Epic 2 (Full Game Vocabulary), Story 2.2 — the FIRST money-bearing
resolver of Epic 2 and the FIRST STATEFUL modifier in the engine. Source:
epics-f1-rules-games.md#Story-2.2. NFR-C1 HARD GATE: the hand-calc golden
(embedded in Dev Notes below) is Josh-approved BEFORE any resolver code merges.
Tournament paths only (FD-1/FD-2). Engine + config-schema + ONE narrowly-scoped
service change (dense holes in games-money for the AC8 carryover barrier) — NO
route, NO schema migration, NO new UI (Story 2.1 already ships the per-player
greenie checkbox in score-entry AND populates holeState.claims; this story
CONSUMES those checkboxes and adds the dense-holes precondition for carryover).

MODEL CONFIRMED BY JOSH 2026-06-22 (corrects the first spec draft):
- The SYSTEM's only job is the per-player greenie CHECKBOX on par-3s; the GROUP
  manually decides who actually earned it (closest-to-pin + green-in-reg + 2-putt
  are HUMAN judgments, never validated in software). Boxes are accepted as
  entered (FR16).
- A greenie is a TEAM point scored +1 to each player on the winning team / -1 to
  each opponent (same shape as the base low-ball/skin/total points).
- COUNT-BASED, per hole: greenie points to A = (# A boxes checked) - (# B boxes
  checked), range -2..+2. Both teammates inside both opponents => the team wins
  TWO greenies (+2). At most one team legitimately scores; software just counts.
- Automatic carryover ON/OFF (Josh choice 2026-06-22): an UNCLAIMED par-3 (zero
  boxes) rolls 1 greenie to the next par-3 when ON; expires when OFF (FR40).
-->

## Story

As the F1 engine,
I want a pure greenie resolver — counting the per-player greenie checkboxes on par-3s, including the **carryover** stateful behavior — matched to a hand-approved golden,
so that closest-to-the-pin money settles deterministically from what the group checked, including the case where an unclaimed greenie carries to the next par-3.

## ⚠️ NFR-C1 HARD GATE (money story) — read first

This is a **money-bearing, golden-bearing** story. Per NFR-C1 and the Epic-1 retrospective lesson ("never delegate the money-safety review; front-load fail-closed/edge tests into the spec"), the ordering is **non-negotiable**:

1. The **golden fixture(s)** are authored to the **hand-calc embedded in Dev Notes → "Golden hand-calc (Josh-approves at the spec gate)"**. The hand-calc — including the exact `SettlementEdge[]` — is approved at the **spec gate** (the NFR-C1 approval touchpoint). **No resolver code merges before that approval.** Auto-approve of a clean spec is **explicitly disabled** here (the spec carries money values requiring human sign-off — see "Spec-gate note").
2. The resolver is written to **match** the approved golden, never the reverse.
3. Every edge case in AC 5–11 ships as a test **in this story**.

## Acceptance Criteria

**NFR-C1 golden gate**

1. The first artifact is a hand-authored, hand-approved golden fixture set (`engine/games/__fixtures__/greenie-*.json`) asserting the exact `SettlementEdge[]` for greenie sequences on **par-3s** (greenies are contested **only on par-3s**), covering: (i) a **carryover** to the next par-3 — an unclaimed par-3 greenie rolling to the **next par-3**, with the **intervening non-par-3 holes skipped, never landed on** (corrected NFR-C4); (ii) **multi-par-3 accumulation** — unclaimed on the 1st and 2nd par-3s, the **3rd par-3's won greenie is worth 3 points** (1 won this hole + 2 carried); (iii) a **two-greenies-on-one-hole** case (both teammates checked → team +2 points); and (iv) the matching **carryover-OFF** fixture with **identical inputs** proving the lever flips the 3rd-par-3 award from **3 → 1**. No resolver code merges before the hand-calc (Dev Notes) is approved. [AC1]

**Registry contract — `modifiers/greenie.ts`**

2. `modifiers/greenie.ts` registers a **pure resolver** that counts the per-player greenie **checkboxes** from `holeState.claims` (populated by Story 2.1) and reads the `{enabled, variant}` config. Pure: no DB, no `Date`, no randomness; it reads structurally **only its own foursome's** claims, considering **only `teamA ∪ teamB` members** (any foreign `claims` key is ignored — FR23). `registerModifier('greenie')` is added to `registry.ts`. [AC2]
3. The greenie config lever is **carryover on/off** — **the only greenie lever** (FR2) — carried on the modifier `variant` as a new optional `carryover?: boolean` (added to `ModifierVariant` in `types.ts` and the Zod `modifierSchema` in `config-schema.ts`, preserving `.strict()`). When greenie is enabled, `carryover` **defaults to `true`** (Standard Guyan = "greenie carryover"). [AC3]
4. Greenies are **accepted as entered** — the system does **not** validate closest-to-pin, green-in-regulation, or the 2-putt (all human judgments, Josh); the scorer simply checks each player who the group says earned a greenie, and an unearned player is just unchecked (FR16), exactly like every other claim (Story 2.1). **No new UI** — Story 2.1 already renders the par-3 greenie checkbox. [AC4]

**Per-hole count + stateful carryover (the money core)**

5. **Per-par-3 raw points** (before carry): `rawA = (count of teamA members with greenie checked) − (count of teamB members checked)`, range **−2…+2**. A member is **"checked"** iff `holeState.claims[playerId]?.greenie === true`; an absent player key or `undefined`/`false` is **unchecked**. Each unit is a team point (+1 each winner-team player / −1 each opponent). A hole is **"won"** when `rawA ≠ 0`; **"unclaimed"** when **zero** boxes are checked (across all four members); **"contested"** when boxes are checked on both teams but `rawA = 0` (e.g. 1 each). [AC5]
6. **Carryover fold** (stateful, par-3-only). The resolver folds over par-3s **sorted by `holeNumber`**, threading a non-negative integer **carry pot** (in **points**, never cents). Per settleable par-3 (`carriedIn` = pot entering the hole):
   - **won** (`rawA ≠ 0`) → the **winning team sweeps the pot**: `award = rawA + sign(rawA) * carriedIn`; `carriedOut = 0` (carryover stops once won). *(e.g. rawA=+1 with carriedIn=2 → +3 to A — each A teammate +3 pts; rawA=+2 with carriedIn=2 → +4 to A.)* **[RATIFIED by Josh 2026-06-22: "you get the greenie for that hole plus the two carryovers → +3 each teammate. Carryover stops once won."]**
   - **unclaimed** (zero boxes) → `award = 0`; `carriedOut = carryover ? carriedIn + 1 : 0` (one greenie rolls when ON; expires when OFF, FR40).
   - **contested** (boxes both teams, `rawA = 0`) → `award = 0`; `carriedOut = carriedIn` (the pending pot is **preserved, not incremented and not forfeited**). **[Josh 2026-06-22: this CANNOT occur in real play — closest-to-pin always yields a clear single winner (walked off / measured if close), so both teams are never both checked. Kept purely as a defensive accepted-as-entered safety rule so malformed input can never move money.]**
   Non-par-3 holes are **skipped** (the pot never lands on a par-4/5). Identifies par-3s from `holeState.par`. [AC6]
7. The per-hole greenie `award` (signed, A-positive) is **folded into the existing per-hole `pts`** and distributed through the **same `pts * (pointValueCents / 2)` 4-cross-pair split** used by Story 1.1 (NFR-C7 — the split path is **not** forked; greenie only changes `pts`). Each greenie point is worth the hole's `pointValueCents`; a swept pot is **valued at the collecting hole's** point value (carry tracked in integer **points**, not cents). [AC7]
8. **Completeness / recompute-on-read — BARRIER, not filter, over a DENSE hole array** (money-critical; two dual-model Highs converge here): the fold iterates par-3s (`par === 3`) in **`holeNumber` order** and, at the **first incomplete par-3** (any of the four members' net missing), **BREAKS** — that par-3 and **every par-3 after it are deferred** (no award; carry frozen at its pre-barrier value). The incomplete par-3 is **NOT dropped/filtered** (filtering bridges the carry across the gap → money **retroactively vanishes** when the gap completes). **Precondition — the `holes` array MUST be DENSE**: it must contain a row for **every in-play hole**, including holes with **no or partial scores** (an unplayed par-3 must appear as a present-but-incomplete row, else the barrier cannot see the gap and a later complete par-3 would wrongly bridge it). The service layer (`games-money.ts`, Task 3b) is changed to emit dense holes; an unplayed/partial hole carries an empty/partial `net` (the base game's complete-cell gate already skips such holes — no base-money change). The engine's greenie fold relies on this density as a documented precondition. Result: only the **maximal contiguous run of complete par-3s from the start** settles; the rest resolve on the next read once the gap closes (monotonic — never a retroactive reversal of an already-shown award). [AC8]
9. **Order invariance (precise NFR-C6)**: the fold runs over par-3s **sorted by `holeNumber`**, so the ledger is **invariant to input / iteration / insertion order** for a fixed hole sequence (carryover inherently respects `holeNumber` order — *not* claimed to be invariant to reordering the holes themselves). The existing "shuffle the input array" order-independence property must still pass with greenie active (the `holeNumber` sort restores canonical order). [AC9]

**Properties, fail-closed, loss-less**

10. A **`fast-check` property proves carryover-pot conservation**, made **non-tautological** by surfacing fold state. **Preconditions** (stated in the property): greenie **enabled**, carryover **ON**, and the sum is taken **only over the settleable contiguous-complete par-3 prefix** (the AC8 barrier prefix). The fold returns `{ pointsByHole: Map<number,number>, finalCarryPoints: number, settleablePar3Count: number }` (`settleablePar3Count` = par-3s in that prefix; `finalCarryPoints` = pot pending at the end). The property asserts, over arbitrary box sequences:
    `Σ|pointsByHole.values()| + finalCarryPoints === Σ_overSettleablePar3s( zeroBoxes ? 1 : |rawA| )`
    where the **right side is computed independently from the raw input holes** (`rawA = #A − #B` per par-3; `zeroBoxes` true when no boxes checked) — neither side derived from the other (no `finalCarry = count − sum` tautology, no re-implementing the fold). This proves the carry mechanism **creates and loses no points**. The existing **loss-less + zero-sum** (NFR-C3) and **foursome-isolation** (FR23) properties are extended to cover greenie (greenie added to `configArb`; random per-player checkboxes added to `holeArb`). [AC10]
11. The greenie golden(s) are green and the `compute-foursome` ledger **including greenie lowers loss-lessly to edges** (NFR-C3: `sum(edges) === ledger.totalCents`, edges reconstruct per-player balances). **Fail-closed, per-modifier variant allowlist** (FR44 — `carryover` lives on the shared `ModifierVariant`, so a misplaced key must NOT be silently ignored in a money engine): `validateResolvedConfig` enforces, for each **enabled** modifier — (i) **greenie**: only `carryover` may be set; `basis`/`bonus` on an enabled greenie → reject `unsupported_greenie_variant:…`; (ii) **net-skins**: keeps its net/single requirement AND a `carryover` set on an enabled net-skins → reject `unsupported_net_skins_variant:…` (carryover is greenie-only); (iii) an unknown modifier `type` still fails closed via the existing `unknown_modifier:…` path. A **terminal pending carry** (pot pending after the last settleable par-3) contributes **0 money** (no phantom edge; surfaced as `finalCarryPoints`). [AC11]

**Scope guard**

12. All work is `apps/tournament-api/**` (engine + the single dense-holes `games-money.ts` change + tests) only (FD-1/FD-2). **Out of scope**: adding greenie to the `Standard Guyan` seed/template (Story 2.7); the score-entry greenie UI (Story 2.1, already shipped); polie (2.3); sandie (2.4); birdie variants (2.5); cap (2.6); any route/schema change or any service change beyond the dense-holes array. [AC12]

## Tasks / Subtasks

- [x] **Task 1 — config lever plumbing (AC: 3,11)**
  - [x] `engine/games/types.ts`: add optional `carryover?: boolean` to `ModifierVariant` (documented greenie-only).
  - [x] `engine/games/config-schema.ts`: add `carryover: z.boolean().optional()` to the variant object in `modifierSchema`, keeping `.strict()`.
  - [x] `engine/games/registry.ts`: `registerModifier('greenie')`. In `validateResolvedConfig`, enforce the per-modifier variant allowlist (AC11): enabled greenie with `variant.basis`/`variant.bonus` → `unsupported_greenie_variant:…`; enabled net-skins with `variant.carryover` → `unsupported_net_skins_variant:…` (extend the existing net-skins branch). Disabled modifiers stay inert (variant unconstrained).
- [x] **Task 2 — pure resolver / fold `modifiers/greenie.ts` (AC: 2,5,6,7,8,9)**
  - [x] Export `greenieActive(config): boolean` (present + enabled) and `greenieCarryover(config): boolean` (`variant?.carryover ?? true`), mirroring `netSkinsActive`.
  - [x] Export the pure fold returning **`{ pointsByHole: Map<number,number>; finalCarryPoints: number; settleablePar3Count: number }`** (holeNumber → signed A-positive greenie **points**; carry tracked in integer **points**). Algorithm: take **all** holes, **sort by holeNumber**, iterate; `par !== 3` → `continue`; `par === 3` but **incomplete** (any of 4 nets missing) → **`break`** (BARRIER per AC8 — do **not** filter/drop, do not advance carry past it); else compute `rawA = #A − #B` (count boxes for `teamA ∪ teamB` members only; ignore foreign keys) and apply the AC6 won/unclaimed/contested rule, updating the carry pot. `settleablePar3Count` counts par-3s actually folded. Emit map entries only for non-zero awards. Inactive greenie → empty map / `finalCarryPoints:0` / `settleablePar3Count:0`.
- [x] **Task 3 — wire into `compute-foursome.ts` (AC: 7)**
  - [x] Compute the fold once (after the sort / dup-hole guard) and take `.pointsByHole`. In the per-hole loop, after the complete-cell `continue`, set `pts = holeNetPointsA(...) + (pointsByHole.get(hole.holeNumber) ?? 0)` BEFORE the `if (pts === 0) continue` short-circuit (so the greenie point is valued at THIS hole's `pointValueCents` — AC7). No change to the `pts * (pv/2)` split; keep the `pointValueCents` even-guard.
- [x] **Task 3b — DENSE holes from the service `services/games-money.ts` (AC: 8)** — the **only** change to the money chokepoint, narrowly scoped: build the `holes` array from **every in-play hole**, where the in-play set is **exactly the keys of `siByHole`** (the stroke-index map games-money already derives from the pinned course revision filtered to `holes_to_play` — see the `games-money.ts:416` "outside holes-in-play (e.g. >holesToPlay)" guard; this correctly handles 9-hole and other partial formats with no new definition). Iterate those hole numbers (not just `netByHole`), attaching whatever `net` cells exist (empty/partial for unplayed/partial holes) + that hole's claims; par from `parByHole`. An unplayed par-3 thus appears as a **present-but-incomplete** row so the engine's greenie barrier (AC8) sees the gap. Verify the base game is unchanged (complete-cell gate already skips empty-net holes) — run `games-money.disjointness.test.ts` + the money integration tests; assert byte-identical base-money on a partially-scored fixture. Add a test proving an unplayed par-3 between two complete par-3s defers the later greenie (the dense-array barrier).
- [x] **Task 4 — golden fixtures + harness (AC: 1,11)**
  - [x] `__fixtures__/greenie-carryover-on.json`, `greenie-carryover-off.json`, and `greenie-two-on-one-hole.json` transcribed **exactly** from the approved Dev-Notes hand-calc (same `name`/`_contract`/`_handCalc` style as `guyan-2v2-base-flat.json`).
  - [x] `engine/games/greenie.golden.test.ts` (mirror `guyan-2v2.golden.test.ts`). **Fixture key names match the existing harness exactly**: `expected.perPlayerNetCents`, `expected.edges`, `expected.ledgerTotalCents` — asserted against `ledger.perPlayerCents`, `ledgerToEdges(...)`, and `ledger.totalCents` respectively (do not invent `perPlayerCents`/`totalCents` keys in the JSON). New file; Epic-1 golden test untouched.
- [x] **Task 5 — resolver + wiring tests `modifiers/greenie.test.ts` (AC: 5,6,7,8,11)** — front-loaded edges:
  - [x] count model: 1 box → +1; both A boxes → +2; one A + one B box → 0 (contested), pot preserved.
  - [x] carryover ON accumulation (1st+2nd par-3 unclaimed → 3rd won worth 3); OFF expiry (3rd worth 1).
  - [x] **winner-sweeps-with-multi-greenie**: rawA=+2 with carriedIn=2 → +4 (the AC6 default).
  - [x] **non-par-3 never lands the pot** (carry rolls past par-4/5).
  - [x] **foreign claim key** (playerId not in foursome) ignored.
  - [x] **incomplete-par-3 BARRIER**: H1(par3,complete,unclaimed), H3(par3,**incomplete**), H5(par3,complete, a1 box) → H5 award MUST be **0** (no carry bridged); after H3 completes unclaimed → H5 collects **3**.
  - [x] **value-at-collecting-hole** (front/back segmented PV via `computeFoursome`): a front par-3 carry collected on a back par-3 uses the **back** PV; assert exact cents (proves points-not-cents + valued-at-collection).
  - [x] **terminal pending carry** → 0 money; `finalCarryPoints` reflects the pot.
  - [x] **fail-closed**: enabled greenie with `variant.basis/bonus` → `unsupported_greenie_variant`; enabled net-skins with `variant.carryover` → `unsupported_net_skins_variant`.
  - [x] greenie inactive (absent/disabled) → empty map / 0 edges (inert).
- [x] **Task 6 — property test extension `games.property.test.ts` (AC: 9,10)**
  - [x] Extend `configArb` to randomly include an enabled greenie (carryover random); extend `holeArb` to attach random per-player greenie checkboxes.
  - [x] New **carryover-conservation** property (ON): `Σ|pointsByHole.values()| + finalCarryPoints === Σ_settleablePar3( zeroBoxes ? 1 : |#A−#B| )`, RHS computed independently from raw inputs; also assert `finalCarryPoints >= 0`.
  - [x] Confirm existing **order-independence** + **loss-less/zero-sum** + **isolation** still pass with greenie active.
- [x] **Task 7 — regression gate (AC: all)** — `pnpm --filter @tournament/api test`, `pnpm -r typecheck`, `pnpm -r lint` green; engine + wolf-cup + web unchanged (no web/Wolf Cup edits). Epic-1 golden (`guyan-2v2-*.json`) byte-identical (greenie inactive ⇒ zero change).

## Dev Notes

### Golden hand-calc (Josh-approves at the spec gate) — NFR-C1

**Isolation device:** every player's net = par on every hole ⇒ all base points are 0 (low-ball tie, skin 0, team-total tie, net-skins equal-level no-blood). So each ledger reflects **greenie points only**. Teams A={a1,a2}, B={b1,b2}, flat $5/point (`pointValueCents = 500`), net-skins ON (contributes 0 here).

> **On the pairwise edge values (your "no half points" note):** a greenie point is never a half *point*. The `SettlementEdge[]` is the pairwise *who-pays-whom* representation: in a 2v2, one **odd** team point ($5) makes each loser pay **each** winner **$2.50** (so each loser pays $5 total, each winner receives $5 total). An **even** point count produces whole-dollar edges. **Per player the money is always a whole multiple of $5** (e.g. +$15 / +$5 / +$10 below). These per-game edges aggregate into the whole-dollar pairwise settle-up. This is identical to the already-approved Epic-1 base golden (which has $7.50 edges). The fixture headlines `perPlayerNetCents` (whole) with `edges` as the pairwise IR.

**Fixture 1 — `greenie-carryover-on.json` (carryover = true)** — proves carry + skip + accumulation. Inputs (all nets = par):

| Hole | Par | greenie boxes | rawA | carryIn → carryOut | award to A |
|------|-----|---------------|------|--------------------|------------|
| 1 | 3 | none | 0 | 0 → 1 | 0 (unclaimed, rolls) |
| 2 | 4 | — | — | 1 (untouched) | — (not a par-3) |
| 3 | 3 | none | 0 | 1 → 2 | 0 (unclaimed, rolls) |
| 4 | 5 | — | — | 2 (untouched) | — (not a par-3) |
| 5 | 3 | **a1** | +1 | 2 → 0 | **+1 + 2 = +3** (sweep) |

Round greenie pointsA = **+3**. perPlayer: a1=a2=**+1500c (+$15)**; b1=b2=**−1500c**. Edges (4 × 1500/2 = 750, sorted from,to): `b1→a1 750`, `b1→a2 750`, `b2→a1 750`, `b2→a2 750`. `ledgerTotalCents = 3000`. Conservation: Σ|award| = 3, finalCarry = 0; RHS = (H1 unclaimed 1) + (H3 unclaimed 1) + (H5 |rawA|=1) = 3 ⇒ 3+0 = 3 ✓.

**Fixture 2 — `greenie-carryover-off.json` (carryover = false, IDENTICAL inputs)** — proves the lever. H1, H3 unclaimed → expire (carry stays 0). H5: rawA=+1, carriedIn=0 → award **+1**. pointsA = **+1**. perPlayer: a1=a2=**+500c (+$5)**; b1=b2=**−500c**. Edges (4 × 250): `b1→a1 250`, `b1→a2 250`, `b2→a1 250`, `b2→a2 250`. `ledgerTotalCents = 1000`. *(The contrast: identical inputs; carryover flips H5 from +3 → +1, i.e. $15/side → $5/side.)*

**Fixture 3 — `greenie-two-on-one-hole.json`** — proves the COUNT model end-to-end. One par-3 (hole 3, par 3), all nets = par, **a1 AND a2 both checked**, b none → rawA=**+2**, no carry. pointsA = **+2**. perPlayer: a1=a2=**+1000c (+$10)**; b1=b2=**−1000c**. Edges (4 × 2×500/2 = 500, whole-dollar since +2 is even): `b1→a1 500`, `b1→a2 500`, `b2→a1 500`, `b2→a2 500`. `ledgerTotalCents = 2000`.

> **Fixtures 1–3's `expected` blocks are the NFR-C1 artifact. Approving this spec = approving these numbers + the AC6 carryover rules. The resolver is written to match.**

### Money rules — RATIFIED by Josh 2026-06-22 (encoded in AC6)

1. **Winner sweeps the pot.** Pot pending + par-3 won → winning team collects `boxes-this-hole + entire carried pot` (single winner with 2 carried → **+3**; two teammates with 2 carried → **+4**). Carryover stops once won (`carriedOut = 0`).
2. **Contested hole** (boxes on both teams, net 0): cannot occur in real play (closest-to-pin has a clear winner); kept as a defensive rule — awards 0, preserves the pending pot.

### Follow-up logged (separate story, NOT this one) — settle-up edge representation

Josh's settle-up mental model is **whole-dollar, 1-to-1**: each loser pays one winner the full per-player amount (b1→a1 the full $X, b2→a2 the full $X), and the 2v2 game carries a single **running total**. The engine's per-player nets and ledger total already **match this exactly**; the only difference is the `SettlementEdge[]` IR, which Epic 1's `ledger-to-edges.ts` writes as **four `pv/2` cross-legs** (hence the $2.50 / $7.50 leg amounts) rather than two whole-dollar 1-to-1 legs. Because that function feeds **all** F1 settlement and the already-approved Epic-1 base golden, changing it is an **Epic-1-level decision, out of scope for the greenie story** — logged as a future story: *"F1 settle-up edges as whole-dollar 1-to-1 (winner↔loser) pairings instead of the 4-way half split."* Story 2.2 reuses the existing representation (money identical).

### Reuse the shipped seams (verified by direct read 2026-06-22)

- **`engine/games/modifiers/net-skins.ts`** — resolver template; `netSkinsPoints(hole, teamA, teamB): number` returns signed A-positive team points. greenie mirrors the *signed-team-points* contract but adds the cross-hole carry fold. [Source: …/modifiers/net-skins.ts]
- **`engine/games/games/guyan-2v2.ts`** — `holeNetPointsA` (line 31) `lb+sk+tt+ns`; `netSkinsActive(config)` (line 19) is the `greenieActive` template. greenie does NOT go inside `holeNetPointsA` (per-hole, stateless) — it is a separate fold added to `pts` in `compute-foursome`. [Source: …/games/guyan-2v2.ts:19,31,61]
- **`engine/games/compute-foursome.ts`** — settle loop: sort by holeNumber (32), dup-hole guard (36–42), complete-cell `continue` (50), `pts` (52), even-pv guard (56), `half = pts*(pv/2)` 4-cross split (62–65). greenie folds into `pts` at ~52; split untouched (NFR-C7). [Source: …/compute-foursome.ts]
- **`engine/games/registry.ts`** — `registerModifier` (22), `validateResolvedConfig` (63), net-skins fail-closed branch (89–95) as the `unsupported_*_variant` template; `unknown_modifier` (82–84). [Source: …/registry.ts]
- **`engine/games/types.ts`** — `ModifierVariant` (21), `HoleClaims` (46) `{greenie?,polie?,sandie?}`, `HoleState.claims` (64), `SettlementEdge` (90). [Source: …/types.ts]
- **Golden harness** — `guyan-2v2.golden.test.ts`: load fixture → `computeFoursome` → assert `perPlayerCents`/`totalCents` → `ledgerToEdges` deep-equal. Fixture shape `{name,_contract,input:{config,teamSplit,holes,sourceId},expected:{perPlayerNetCents,edges,ledgerTotalCents},_handCalc}`. [Source: …/guyan-2v2.golden.test.ts + __fixtures__/guyan-2v2-base-flat.json]
- **Property harness** — `games.property.test.ts`: `holeArb` (11, par ∈ {3,4,5}), `configArb` (27), order-independence (40), loss-less+zero-sum (51), isolation (73). `fast-check` is a dev dep. [Source: …/games.property.test.ts]
- **`services/games-money.ts`** — ALREADY derives `holeState.claims` (the greenie checkboxes) from the append-only `hole_claim_writes` log (latest-`set`-per-cell, scoped to the foursome) + `par` from the pinned course revision (Story 2.1). The hole array is currently built from `netByHole` (`games-money.ts:413-435`) → **sparse** (a fully-unplayed par-3 has no row). Task 3b makes it **dense** (iterate in-play holes from `parByHole`/`siByHole`) so the AC8 barrier sees unplayed-par-3 gaps. This is the ONLY chokepoint change and is base-money-neutral (complete-cell gate already skips empty-net holes). [Source: …/services/games-money.ts:413-435]

### Why no config_version bump (verified)

`ENGINE_CONFIG_VERSION = 1` (registry.ts:14). Adding greenie as a newly registered modifier does **not** change any existing config's meaning (net-skins unchanged), so configs stay `configVersion: 1`. An older engine reading a greenie config correctly **fails closed** via `unknown_modifier:greenie` (FR44) — the backward-compat protection. No bump (contrast Story 2.5, which changes birdie semantics).

### Naming caveat (does NOT affect this story)

Epic 2.5 refers to a `net-birdie` type; Epic 1 shipped the type string **`net-skins`** (registry.ts:37). 2.2 registers a brand-new `greenie` type and is unaffected.

### Out of scope

Seed/template adoption of greenie (2.7); score-entry greenie UI (Story 2.1, shipped); polie (2.3); sandie (2.4); birdie variants + config_version bump (2.5); cap + its property (2.6); player self-report (Epic 6). No route, no migration, no web edit; the only `services/*` change is the dense-holes array in `games-money.ts` (Task 3b).

### Project Structure Notes

New: `engine/games/modifiers/greenie.ts`, `modifiers/greenie.test.ts`, `greenie.golden.test.ts`, three `__fixtures__/greenie-*.json`, `services/games-money.greenie.test.ts`. Edits: `engine/games/types.ts`, `config-schema.ts`, `registry.ts`, `compute-foursome.ts`, `games.property.test.ts`, and `services/games-money.ts` (dense holes, Task 3b). All `apps/tournament-api/**` (ALLOWED). A `greenieActive`/`greenieCarryover` helper lives in `modifiers/greenie.ts` (mirrors `netSkinsActive`'s by-concern location); no `guyan-2v2.ts` edit required.

### Testing standards

Vitest + fast-check (existing deps; no new deps). Pure engine — no DB. Must-have tests enumerated in Task 5/6: three goldens green; count model (1/2/contested); carryover ON accumulation + OFF expiry; winner-sweep; non-par-3-skip; foreign-key-ignored; incomplete-par-3 barrier; value-at-collecting-hole (segmented PV); terminal-pending-carry; fail-closed (both variant rejections); inert; carryover-conservation property; existing properties green; Epic-1 golden byte-identical.

### References

- [Source: epics-f1-rules-games.md#Story-2.2] · [Source: architecture-f1-rules-games.md] (FR2, FR16, FR40, FR44, NFR-C1/C3/C4/C6/C7)
- [Source: apps/tournament-api/src/engine/games/types.ts] · [registry.ts] · [compute-foursome.ts] · [games/guyan-2v2.ts] · [modifiers/net-skins.ts] · [config-schema.ts] (verified by direct read 2026-06-22)
- [Source: apps/tournament-api/src/engine/games/guyan-2v2.golden.test.ts] + [__fixtures__/guyan-2v2-base-flat.json] · [Source: …/games.property.test.ts]
- [Source: apps/tournament-api/src/services/games-money.ts] (Story 2.1 claim/checkbox population — consumed, not edited) · [Source: 2-1-inline-claim-capture-hole-claims.md]

## Files this story will edit

- apps/tournament-api/src/engine/games/modifiers/greenie.ts
- apps/tournament-api/src/engine/games/modifiers/greenie.test.ts
- apps/tournament-api/src/engine/games/greenie.golden.test.ts
- apps/tournament-api/src/engine/games/__fixtures__/greenie-carryover-on.json
- apps/tournament-api/src/engine/games/__fixtures__/greenie-carryover-off.json
- apps/tournament-api/src/engine/games/__fixtures__/greenie-two-on-one-hole.json
- apps/tournament-api/src/engine/games/types.ts
- apps/tournament-api/src/engine/games/config-schema.ts
- apps/tournament-api/src/engine/games/registry.ts
- apps/tournament-api/src/engine/games/compute-foursome.ts
- apps/tournament-api/src/engine/games/games.property.test.ts
- apps/tournament-api/src/services/games-money.ts
- apps/tournament-api/src/services/games-money.greenie.test.ts
- _bmad-output/implementation-artifacts/tournament/2-2-greenie-modifier-stateful-carryover.md
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

## Spec-gate note (auto-approve disabled for this money story)

Although `.director-config.json` has `auto_approve_clean_specs: true`, this spec carries **money values** (the embedded golden `SettlementEdge[]`) under the **NFR-C1 hard gate** plus **two carryover rules requiring Josh's ratification** (AC6). The director presents this for a **manual gate** even if the codex+gemini ensemble returns clean.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context).

### Debug Log References

- Golden gate ran FIRST: 3 fixtures authored to the Dev-Notes hand-calc, `greenie.golden.test.ts` green before any resolver consumed them (NFR-C1).
- Full `@tournament/api test`: the only failure is the pre-existing T10-2/T10-3 **load-induced flake** (`round-lifecycle.integration.test.ts` finalize-before-handoff 500-instead-of-422 under concurrent test-file DB contention). It passes 24/24 in isolation and consecutive full-suite runs alternate pass/fail on that one test; Story 2.2 touches zero lifecycle/handoff code. Not a regression.

### Completion Notes List

- **Edge-representation note (intentional deviation from the Dev-Notes hand-calc):** the spec's Dev-Notes hand-calc tables show the pre-2.1a 4-leg `pv/2` edge layout (e.g. `4 × 750`). Story **2.1a** shipped AFTER that draft and rewrote `ledger-to-edges.ts` to the WHOLE-DOLLAR 1-to-1 layout (2 legs). Per the explicit resume instruction in sprint-status ("the greenie golden lands against whole-dollar 1-to-1 edges"), the three goldens were authored against the **current** representation: `b1→a1`, `b2→a2` (e.g. `2 × 1500`). **Per-player nets and ledger totals are byte-identical to the approved hand-calc** (e.g. a1=a2=+1500, total 3000); only the `edges` IR follows the already-Josh-approved 2.1a change. Each fixture `_handCalc` documents this.
- AC6 carryover rules implemented exactly: won → winner sweeps pot (`rawA + sign*carry`), carry resets; unclaimed → `+1` when ON / expire when OFF; contested → award 0, pot preserved (defensive — cannot occur in real play).
- AC8 BARRIER (not filter): the fold `break`s at the first incomplete par-3; the dense `holes` array (Task 3b, built from `siByHole.keys()`) lets the barrier see an unplayed-par-3 gap. DB-proven in `games-money.greenie.test.ts`: with the gap open a1 nets **0** (sparse would wrongly net +1000); once filled, a1 nets **+1500** — monotonic release, no retroactive vanish.
- AC11 fail-closed allowlist: enabled greenie with `basis`/`bonus` → `unsupported_greenie_variant:…`; enabled net-skins with `carryover` → `unsupported_net_skins_variant:carryover`. `ModifierVariant` keys made optional so greenie's variant is `{ carryover }` only; `.strict()` Zod still rejects unknown keys.
- AC10 carry-conservation property is non-tautological (LHS from surfaced fold state, RHS re-derived independently from raw holes).
- Two ALLOWED test fixtures outside the declared file list were updated because greenie is now a **registered** modifier (they used `greenie` as the "unknown modifier" example → switched to `not-a-real-modifier`): `__fixtures__/cascade-resolver-lock-gate.json`, `db/schema/game-config.test.ts`.
- Base money byte-identical: the Story 1.4 golden gate (Epic-1 fixtures through the dense-holes chokepoint) + `games-money.greenie.test.ts` base-neutral case both green. typecheck + lint clean across all workspaces.

**Impl-review ensemble (codex gpt-5.2 high + gemini-pro high) — applied/deferred:**
- **APPLIED (codex Medium):** `validateResolvedConfig` now type-checks greenie's `carryover` lever — a non-boolean (e.g. `"false"`/`0`/`null`) reaching `computeFoursome` directly (bypassing Zod) is rejected `unsupported_greenie_variant:carryover_type` instead of being mis-interpreted by `greenieCarryover`'s `?? true`. Mirrors the net-skins value-check; closes a fail-closed defense-in-depth gap (AC11). Test added.
- **DEFERRED (codex Low → followup, unreachable-by-construction):** `games-money.ts` dense-holes uses `par: parByHole.get(holeNumber) ?? 0`. `siByHole` and `parByHole` are built from the SAME `holesInPlay` map (games-money.ts:246-247) → identical keysets, so the `?? 0` fallback can never trigger for a `siByHole.keys()` iteration. Pre-existing pattern (the prior sparse build used the same default). Hardening it to fail-closed would add dead code and change the base-money path for a corrupt-data case that cannot occur. Logged as a non-blocking followup; not changed in this money story.
- Gemini review: zero findings ("exceptionally solid"). Codex critique of gemini: SHIP, confirmed gemini's no-findings holds for the production path while upholding the Medium as defense-in-depth.
- **APPLIED (codex re-review Medium):** non-object `variant` (string/boolean/null/array) on an enabled modifier → reject `invalid_variant_shape:${type}` (completes the carryover-type guard: a malformed variant container would otherwise read as "absent" via optional chaining and silently default the levers). Test added (greenie/net-skins).
- **SHIP verdict (synthesis, codex gpt-5.2 + gemini-pro, high confidence): `must_fix_before_send` = None.** No reachable production-path money-correctness bug remains. Production always pins a Zod/`parseGameConfig`-validated config (`modifierSchema` is `.strict()` → unknown variant keys already rejected at write); `parByHole`+`siByHole` share the `holesInPlay` source (`par ?? 0` unreachable); the service always builds dense holes.
- **APPLIED (party-review codex Medium — consistency):** `validateResolvedConfig` now also type-checks `m.enabled` is strictly boolean (`invalid_modifier_enabled:${type}`). `enabled` is read on EVERY modifier to decide active/inactive, so it is as load-bearing as `type`; guarding it completes the direct-caller fail-closed posture consistently with the variant-shape + carryover-type guards (resolves the reviewer's "same threat model, why deferred?" critique). Test added. With this, all THREE load-bearing fields `validateResolvedConfig` reads to move money — `type` (hasModifier), `enabled` (boolean), and the variant levers (allowlist + shape + carryover-type) — are now fail-closed.
- **FOLLOWUP (deferred on SCOPE grounds — general `validateResolvedConfig` hardening, applies to ALL modifiers, pre-existing since Story 1.1; NOT greenie-specific; production is Zod/`.strict()`-protected so these are non-blocking `should_fix`/`optional`):** (a) reject unknown keys inside an object-shaped `variant` (Zod `.strict()` already rejects them at write; the engine allow-lists known keys, so a stray key defaults its lever — lower-stakes than enabled/type which flip activation); (b) replace `par ?? 0` with a fail-closed throw (unreachable-by-construction today — `parByHole`/`siByHole` share `holesInPlay`); (c) assert/normalize the dense-holes precondition at the greenie-fold boundary for any future direct caller (currently documented in `greenie.ts` JSDoc + guaranteed by the service); (d) guard `validateResolvedConfig` against a malformed TOP-LEVEL config shape (non-array `config.modifiers`, null entries) so it returns a reason instead of throwing for arbitrary unvalidated JSON — today a throw is still caught by the `games-money.ts` service `try/catch` (→ that foursome unsettleable, never an event-wide crash). These are a general-engine hardening pass, intentionally out of this focused greenie story.

**Final review state:** codex (gpt-5.2 high) + gemini (gemini-pro high) both fresh on the final diff — gemini 0 findings; codex consistency-resolved with only the deferred general-engine Low above. Mandatory impl debate synthesis = SHIP (must_fix=None). Party review = SHIP, no open questions.

### File List

New:
- apps/tournament-api/src/engine/games/modifiers/greenie.ts
- apps/tournament-api/src/engine/games/modifiers/greenie.test.ts
- apps/tournament-api/src/engine/games/greenie.golden.test.ts
- apps/tournament-api/src/engine/games/__fixtures__/greenie-carryover-on.json
- apps/tournament-api/src/engine/games/__fixtures__/greenie-carryover-off.json
- apps/tournament-api/src/engine/games/__fixtures__/greenie-two-on-one-hole.json
- apps/tournament-api/src/services/games-money.greenie.test.ts

Edited:
- apps/tournament-api/src/engine/games/types.ts (carryover on ModifierVariant; keys optional)
- apps/tournament-api/src/engine/games/config-schema.ts (carryover in modifierSchema, keys optional, .strict() preserved)
- apps/tournament-api/src/engine/games/registry.ts (registerModifier('greenie') + per-modifier variant allowlist)
- apps/tournament-api/src/engine/games/compute-foursome.ts (fold greenie points into pts)
- apps/tournament-api/src/engine/games/games.property.test.ts (greenie arbs + carry-conservation property)
- apps/tournament-api/src/services/games-money.ts (dense holes from siByHole.keys())
- apps/tournament-api/src/engine/games/__fixtures__/cascade-resolver-lock-gate.json (unknown-modifier fixture → not-a-real-modifier)
- apps/tournament-api/src/db/schema/game-config.test.ts (unknown-modifier cases → not-a-real-modifier)
