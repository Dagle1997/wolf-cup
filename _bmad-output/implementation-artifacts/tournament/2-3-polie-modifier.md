# Story 2.3: Polie modifier (stateless, gross bogey-or-better gate) + golden

Status: ready-for-dev

<!-- F1 Epic 2 (Full Game Vocabulary), Story 2.3 — the STATELESS claim modifier
sibling of greenie (2.2). Source: epics-f1-rules-games.md#Story-2.3. NFR-C1 HARD
GATE: the hand-calc golden (Dev Notes) is Josh-approved BEFORE any resolver code
merges. Tournament paths only (FD-1/FD-2). Engine + ONE service change (gross
into the dense holes for the bogey-or-better gate) — NO route, NO schema
migration, NO new UI (Story 2.1 already ships the per-player polie checkbox AND
populates holeState.claims; this story CONSUMES those checkboxes).

MODEL — RATIFIED BY JOSH 2026-06-22 (corrects the first spec draft):
- A polie = making a putt (or chip-in) longer than the flagstick. It CANNOT be
  detected by software — the scorer simply checks the polie box next to each
  player who made one (accepted as entered, FR16), exactly like greenie.
- ALL FOUR players can each have a polie; **each polie is worth 1 team point**
  (+1 to the maker's team / −1 to the opponents). In the 2v2 engine that is
  COUNT-BASED: polieA = (# eligible teamA polies) − (# eligible teamB polies),
  range −2..+2. All four checked ⇒ 2 vs 2 ⇒ nets to $0 (consistent with every
  other team point). STATELESS — no carryover; each hole resolves independently.
- THE ONLY backend rule/lever for polie is a Y/N toggle: **"Polie must be Bogey
  or Better"** (Josh 2026-06-22). When ON, a checked polie only counts if that
  player's **GROSS** score on the hole is **bogey-or-better** (gross ≤ par+1)
  — Josh chose GROSS (not net) 2026-06-22 (matches the event-setup backlog
  "(gross)"). When OFF (default = "polie on anything"), a checked polie always
  counts regardless of score.
- GROSS is required for the gate. The engine's HoleState carries NET only today
  (gross→net is the service layer), so this story threads per-hole GROSS into
  HoleState and populates it in games-money.ts (same footprint as greenie's
  dense-holes service change). GROSS is used ONLY by the polie gate; base game +
  greenie ignore it (no base-money change).
-->

## Story

As the F1 engine,
I want a pure, **stateless** polie resolver — counting the per-player polie checkboxes (each worth 1 team point), gated by an optional **gross bogey-or-better** rule — matched to a hand-approved golden,
so that putt-length ("polie") money settles deterministically from what the group checked, including the case where a polie is voided because the player scored worse than bogey.

## ⚠️ NFR-C1 HARD GATE (money story) — read first

This is a **money-bearing, golden-bearing** story. Per NFR-C1 and the Epic-1 retrospective lesson ("never delegate the money-safety review; front-load fail-closed/edge tests into the spec"), the ordering is **non-negotiable**:

1. The **golden fixture(s)** are authored to the **hand-calc embedded in Dev Notes → "Golden hand-calc (Josh-approves at the spec gate)"**. The hand-calc — including the exact `SettlementEdge[]` — is approved at the **spec gate** (the NFR-C1 approval touchpoint). **No resolver code merges before that approval.** Auto-approve of a clean spec is **explicitly disabled** here (the spec carries money values — see "Spec-gate note").
2. The resolver is written to **match** the approved golden, never the reverse.
3. Every edge case in AC 5–10 ships as a test **in this story**.

## Acceptance Criteria

**NFR-C1 golden gate**

1. The first artifact is a hand-authored, hand-approved golden fixture set (`engine/games/__fixtures__/polie-*.json`) asserting the exact `SettlementEdge[]`, covering: (i) **"polie on anything"** (toggle OFF) — a polie checked on a **non-par-3** hole still counts (polie is NOT par-3-restricted, unlike greenie), incl. the count model (both teammates → +2; one each → 0 contested); (ii) **gross bogey-or-better ON** — a checked polie by a player whose **gross > par+1 is VOIDED** (does not count), for **both** teams; (iii) the **orphaned NFR-C4 all-push hole** — a hole where every player pushes (no base net winner) AND no eligible polie → **empty / zero `SettlementEdge[]`** (not a crash, not a phantom split); and (iv) **order-independence** — `polie.golden.test.ts` recomputes the "anything" fixture with its `holes` array **reversed** and asserts a byte-identical ledger + edges (NFR-C6). No resolver code merges before the hand-calc (Dev Notes) is approved. [AC1]

**Registry contract — `modifiers/polie.ts`**

2. `modifiers/polie.ts` registers a **pure resolver** that counts the per-player polie **checkboxes** from `holeState.claims` (populated by Story 2.1), reads per-player **gross** from `holeState.gross` (for the gate), and reads the `{enabled, variant}` config. Pure: no DB, no `Date`, no randomness; it reads structurally **only its own foursome's** claims/gross, considering **only `teamA ∪ teamB` members** (any foreign `claims`/`gross` key is ignored — FR23). `registerModifier('polie')` is added to `registry.ts`. [AC2]
3. The polie config lever is the **bogey-or-better Y/N toggle** (FR2) — **the only polie lever** — carried on the modifier `variant` as a new optional `polieBogeyOrBetter?: boolean` (added to `ModifierVariant` in `types.ts` and the Zod `modifierSchema` in `config-schema.ts`, preserving `.strict()`). When polie is enabled, `polieBogeyOrBetter` **defaults to `false`** (Standard Guyan = "polie on anything"). [AC3]
4. Polies are **accepted as entered** — the system does **not** validate the real-world rule (a made putt longer than the flagstick); the scorer simply checks each player the group says earned a polie, and an unearned player is just unchecked (FR16), exactly like every other claim (Story 2.1). **No new UI** — Story 2.1 already renders the polie checkbox. [AC4]

**Per-hole count + gross gate (the money core) — STATELESS**

5. **Per-hole eligibility + raw points.** A member's polie is **"checked"** iff `holeState.claims[playerId]?.polie === true`. When `polieBogeyOrBetter === true`, a checked polie is **eligible** iff that player's gross is a **finite number** (`typeof hole.gross?.[playerId] === 'number' && Number.isFinite(...)`) **and** `gross ≤ par + 1` (bogey-or-better). **Fail-closed (HIGH, no JS coercion):** any non-finite gross — `undefined`, `null`, `NaN`, a string, etc. — is **voided**, NOT compared (the predicate must NOT write `gross <= par+1` directly, since `null <= 5` coerces to `true` in JS and would wrongly count an ineligible polie). When `polieBogeyOrBetter` is `false`/absent, every checked polie is eligible (gross unread). `rawA = (count of eligible teamA polies) − (count of eligible teamB polies)`, range **−2…+2**. Each unit is a team point (+1 each winner-team player / −1 each opponent). [AC5]
6. The per-hole polie `award` (signed, A-positive) is **folded into the existing per-hole `pts`** and distributed through the **same `pts * (pointValueCents / 2)` 4-cross-pair split** used by Story 1.1 (NFR-C7 — the split path is **not** forked; polie only changes `pts`). **Money semantics:** one polie team point at a hole moves `pointValueCents` to **each** winning-team player (and −`pointValueCents` from each loser) — the *per-player* swing is `|rawA| * pointValueCents`, the *ledger total* for that hole is `2 * |rawA| * pointValueCents`. Polie is computed **only on a complete hole** (all four members' net present, the existing base gate); an incomplete hole contributes no polie money. Polie is stateless ⇒ the dense-vs-sparse `holes` distinction (greenie's AC8 barrier) is **irrelevant** — a missing hole contributes nothing and never affects another. [AC6]
7. **Order invariance (NFR-C6)**: the ledger is **invariant to the order of the `holes` input array** — polie has no cross-hole state, so each hole's contribution is independent of array position; the existing "shuffle the input array" order-independence property must still pass with polie active. (Each `HoleState` carries its own `holeNumber`; under a segmented schedule a polie point's value is keyed by that `holeNumber` — invariance holds for reordering the array, NOT for renumbering holes.) [AC7]

**All-push hole + properties + fail-closed + loss-less**

8. **All-push hole (the orphaned NFR-C4)**: a complete hole where every player's net ties the base game to zero **and** no eligible polie produces `pts = 0` → the hole is **skipped** (the existing `if (pts === 0) continue`), contributing **no cross-cell money** → an **empty `SettlementEdge[]`** when it is the only hole. Golden fixture + unit test (no crash, no phantom split, no zero-cent edge). [AC8]
9. The polie golden(s) are green and the `compute-foursome` ledger **including polie lowers loss-lessly to edges** (NFR-C3: `sum(edges) === ledger.totalCents`, edges reconstruct per-player balances). The existing **loss-less + zero-sum** (NFR-C3) and **foursome-isolation** (FR23) properties are extended to cover polie (polie added to `configArb`; random per-player polie checkboxes + gross added to `holeArb`). A new **`fast-check` polie-additivity property** (non-tautological), constrained to **polie-only config, FLAT PV, `polieBogeyOrBetter:false`, nets=par** (isolating polie): `perPlayerCents[a1] === perPlayerCents[a2] === cents * Σ_completeHoles (#A_boxes − #B_boxes)` with the RHS computed directly from raw inputs (NOT engine output), `perPlayerCents[b1] === perPlayerCents[b2] === −perPlayerCents[a1]` (assert **all four** players so a within-team misallocation can't hide), AND shuffling the holes array leaves the ledger byte-identical. [AC9]
10. **Fail-closed, per-modifier variant allowlist** (FR44, AC11-of-2.2 pattern — the shared `ModifierVariant` keys mean a *misplaced KNOWN lever* must NOT be silently ignored in a money engine). `validateResolvedConfig` enforces, for each **enabled** modifier, with **exact reason strings consistent with the shipped 2.2 conventions**:
    - **(i) polie** — only `polieBogeyOrBetter` may be set. Reject: `basis` set → `unsupported_polie_variant:basis=${value}`; `bonus` set → `unsupported_polie_variant:bonus=${value}`; `carryover` set → `unsupported_polie_variant:carryover`; `polieBogeyOrBetter` present but **not a boolean** → `unsupported_polie_variant:polieBogeyOrBetter_type`. `polieBogeyOrBetter` true/false (or absent → default false) passes.
    - **(ii) greenie** — keeps its carryover-only allowlist AND `polieBogeyOrBetter` set on an enabled greenie → `unsupported_greenie_variant:polieBogeyOrBetter`.
    - **(iii) net-skins** — keeps its net/single + reject-carryover rules AND `polieBogeyOrBetter` set → `unsupported_net_skins_variant:polieBogeyOrBetter`.
    The existing shared guards from 2.2 — `invalid_modifier_enabled:${type}`, `invalid_variant_shape:${type}`, `unknown_modifier:${type}`, `duplicate_modifier:${type}` — are **unchanged**. (FR44 unknown-KEY-inside-object-variant rejection remains the deferred 2.2 general-engine followup; Zod `.strict()` covers the write path.) [AC10]

**Scope guard**

11. **All CODE changes are `apps/tournament-api/**`** (FD-1/FD-2) — no `apps/api`/`apps/web`/`packages/engine`. Touches: the engine (`types.ts` gross + `polieBogeyOrBetter`, `config-schema.ts`, `registry.ts`, `compute-foursome.ts`, `modifiers/polie.ts`, `games.property.test.ts`) **and ONE service change** — `services/games-money.ts` populates per-player `gross` on the dense holes (it already reads `grossStrokes` from `holeScores`; this is the only chokepoint change, base-money-neutral). The only non-code edits are director tracking artifacts under `_bmad-output/**` (ALLOWED). **Out of scope**: adding polie to the `Standard Guyan` seed/template (Story 2.7); the score-entry polie UI (Story 2.1, shipped); sandie (2.4); birdie (2.5); cap (2.6); any route/migration. [AC11]

## Tasks / Subtasks

- [ ] **Task 1 — gross into HoleState + config lever (AC: 3,5,10)**
  - [ ] `engine/games/types.ts`: add optional `gross?: Record<string, number>` to `HoleState` (per-player gross strokes; used only by the polie gate). Add optional `polieBogeyOrBetter?: boolean` to `ModifierVariant` (documented polie-only).
  - [ ] `engine/games/config-schema.ts`: add `polieBogeyOrBetter: z.boolean().optional()` to the variant object in `modifierSchema`, keeping `.strict()`.
  - [ ] `engine/games/registry.ts`: `registerModifier('polie')`. In `validateResolvedConfig`, add the polie allowlist (AC10): enabled polie with `basis`/`bonus`/`carryover` → `unsupported_polie_variant:<key>`; `polieBogeyOrBetter` non-boolean → `unsupported_polie_variant:polieBogeyOrBetter_type`; extend greenie + net-skins branches to reject a stray `polieBogeyOrBetter`. Disabled modifiers stay inert.
- [ ] **Task 2 — pure resolver `modifiers/polie.ts` (AC: 2,5,7)**
  - [ ] Export `polieActive(config): boolean` (present + enabled), `polieBogeyOrBetter(config): boolean` (`variant?.polieBogeyOrBetter ?? false`), and `poliePoints(hole, teamA, teamB, config): number` (signed A-positive team points; `rawA = #eligibleA − #eligibleB`; a member's polie is eligible iff checked AND (`!bogeyOrBetter` OR `isBogeyOrBetter(hole.gross?.[p], hole.par)`), where `isBogeyOrBetter(g, par) = typeof g === 'number' && Number.isFinite(g) && g <= par + 1` — a finite-number guard BEFORE the comparison so a `null`/`undefined`/`NaN`/string gross is voided, never coerced; count only `teamA ∪ teamB` members; ignore foreign keys). Pure; stateless; returns 0 when polie inactive.
- [ ] **Task 3 — wire into `compute-foursome.ts` (AC: 6,8)**
  - [ ] In the per-hole loop, after the complete-cell `continue`, add `+ (polieActive(config) ? poliePoints(hole, teamA, teamB, config) : 0)` to `pts` BEFORE the `if (pts === 0) continue` short-circuit (so polie is valued at THIS hole's `pointValueCents`, NFR-C7; an all-push + no-eligible-polie hole still short-circuits to no money — AC8). No change to the split.
- [ ] **Task 3b — gross on the dense holes from `services/games-money.ts` (AC: 5,11)** — the ONLY service change, narrowly scoped: build a `grossByHole` map from the same `scoreRows` already read (per-player `grossStrokes`), and attach `gross` to each dense `HoleState` alongside `net`/`claims`. Base money MUST stay byte-identical (gross is only read by the polie gate; the base game + greenie ignore it).
  - [ ] `services/games-money.polie.test.ts` (DB-backed, mirrors `games-money.greenie.test.ts`) MUST prove the gate works **end-to-end through the live chokepoint**, not just base-neutrality (HIGH — a test that only checks "base money unchanged" would still pass if gross were never populated, silently voiding ALL gated polies in prod):
    - **(a) gross is threaded** — seed a polie claim with `polieBogeyOrBetter:true` and a **bogey-or-better gross** → assert the polie money **appears** in the settled edges (proves `games-money.ts` actually populated `gross` and the gate saw it).
    - **(b) gross gate voids** — same seed but a **double-bogey gross** → assert the polie money is **absent** (voided).
    - **(c) gate off** — `polieBogeyOrBetter:false`, same bad gross → polie **counts** (gross unread).
    - **(d) base-neutral** — a base-money fixture with gross attached but polie disabled settles byte-identically to the pre-gross baseline.
- [ ] **Task 4 — golden fixtures + harness (AC: 1,8,9)**
  - [ ] `__fixtures__/polie-anything.json` (toggle OFF; count model on non-par-3 incl. +2 and contested-0), `polie-bogey-or-better.json` (toggle ON; ineligible gross>par+1 polies voided for both teams), `polie-all-push.json` (all-push → empty edges), transcribed **exactly** from the approved Dev-Notes hand-calc.
  - [ ] `engine/games/polie.golden.test.ts` (mirror `greenie.golden.test.ts`); assert `perPlayerNetCents` / `edges` (post-2.1a whole-dollar 1-to-1 layout) / `ledgerTotalCents`. **AC1(iv):** recompute `polie-anything` with `holes` **reversed**, assert byte-identical. **Gate-contrast:** recompute `polie-bogey-or-better`'s inputs with `polieBogeyOrBetter:false` flipped in the config and assert the ledger changes to the gate-OFF values (a1=a2=+500c, total 1000) — proves the gate moves money.
- [ ] **Task 5 — resolver + wiring tests `modifiers/polie.test.ts` (AC: 5,6,8,10)** — front-loaded edges:
  - [ ] count model: 1 box → +1; both A boxes → +2; one A + one B box → 0 (contested); all four → 0.
  - [ ] polie on a par-4 + par-5 counts (NOT par-3-restricted).
  - [ ] gross gate ON: checked polie with gross=par+1 (bogey) counts; gross=par+2 voided; **absent gross** voided (fail-closed); gate OFF ⇒ gross ignored.
  - [ ] foreign claim/gross key (playerId not in foursome) ignored.
  - [ ] incomplete hole contributes 0 (one member's net missing).
  - [ ] all-push hole (base 0, no eligible polie) → 0 money / empty edges via `computeFoursome`.
  - [ ] value-at-hole PV (front/back segmented): a back-nine polie uses the back PV; assert exact cents.
  - [ ] fail-closed: enabled polie with `basis`/`bonus`/`carryover` → `unsupported_polie_variant:<key>`; non-boolean `polieBogeyOrBetter` → `unsupported_polie_variant:polieBogeyOrBetter_type`; enabled greenie/net-skins with `polieBogeyOrBetter` → their respective reject reasons.
  - [ ] polie inactive (absent/disabled) → 0 (inert).
- [ ] **Task 6 — property test extension `games.property.test.ts` (AC: 7,9)**
  - [ ] Extend `configArb` to randomly include an enabled polie (`polieBogeyOrBetter` random); extend `holeArb` to attach random per-player polie checkboxes + gross.
  - [ ] New **polie-additivity** property (polie-only, **flat** PV, `polieBogeyOrBetter:false`, nets=par): `perPlayerCents[a1] === perPlayerCents[a2] === cents * Σ_completeHoles (#A − #B)` (RHS from raw inputs), `b1===b2===−a1`, shuffle-invariant. Confirm existing **order-independence** + **loss-less/zero-sum** + **isolation** still pass with polie active.
- [ ] **Task 7 — regression gate (AC: all)** — `pnpm --filter @tournament/api test`, `pnpm -r typecheck`, `pnpm -r lint` green; engine + wolf-cup + web unchanged. Epic-1 + greenie goldens byte-identical (polie inactive ⇒ zero change); base money byte-identical with gross attached (Task 3b).

## Dev Notes

### Golden hand-calc (Josh-approves at the spec gate) — NFR-C1

**Isolation device:** every player's **net** = par on every hole ⇒ all base points are 0 (low-ball tie, skin 0, team-total tie, net-skins equal-level no-blood). So each ledger reflects **polie points only**. **Gross** is set independently to exercise the bogey-or-better gate (the engine consumes net + gross as given; the service provides consistent values in production). Teams A={a1,a2}, B={b1,b2}, flat $5/point (`pointValueCents = 500`), net-skins ON (contributes 0 here), polie ON.

> **Edge IR note:** the `SettlementEdge[]` uses the post-Story-2.1a **whole-dollar 1-to-1** layout (each loser pays ONE winner the full per-player amount, slot-paired `teamA[i]↔teamB[i]`), identical to the shipped greenie goldens.

**Fixture 1 — `polie-anything.json`** (`polieBogeyOrBetter` absent/false) — proves the count model + non-par-3 + contested. All nets = par; gross omitted (gate off ⇒ gross unused):

| Hole | Par | polie boxes | rawA | award to A |
|------|-----|-------------|------|------------|
| 1 | 4 | **a1** | +1 | +1 (polie on a PAR-4 — not par-3 restricted) |
| 2 | 5 | **a1, a2** | +2 | +2 (both teammates) |
| 3 | 3 | **b1** | −1 | −1 (B scores) |
| 4 | 4 | a1, b1 | 0 | 0 (contested — one each) |

Round polieA = +1 +2 −1 +0 = **+2**. perPlayer: a1=a2=**+1000c (+$10)**; b1=b2=**−1000c**. Edges: `b1→a1 1000`, `b2→a2 1000`. `ledgerTotalCents = 2000`.

**Fixture 2 — `polie-bogey-or-better.json`** (`polieBogeyOrBetter: true`) — proves the GROSS gate voids an ineligible polie **and that this changes the ledger** (vs gate OFF on identical inputs). All nets = par (base 0); gross set per the gate:

| Hole | Par | polie box | that player's GROSS | bogey-or-better? | gate-ON award | (gate-OFF award) |
|------|-----|-----------|---------------------|------------------|---------------|------------------|
| 1 | 4 | a1 | 4 (par) | ✅ ≤5 | +1 | +1 |
| 2 | 5 | a2 | 6 (bogey=par+1) | ✅ ≤6 | +1 | +1 |
| 3 | 4 | b1 | 6 (double=par+2) | ❌ >5 | 0 (VOIDED) | (−1) |

Round polieA (gate ON) = +1 +1 +0 = **+2**. perPlayer: a1=a2=**+1000c (+$10)**; b1=b2=**−1000c**. Edges: `b1→a1 1000`, `b2→a2 1000`. `ledgerTotalCents = 2000`. **The gate's effect is visible in the LEDGER:** the golden test ALSO recomputes these SAME inputs with `polieBogeyOrBetter:false` and asserts the **different** result — polieA = +1 +1 −1 = **+1** → a1=a2=**+500c**, b1=b2=−500c, total 1000. So the toggle flips $10/side → $5/side: B's voided double-bogey polie is the difference.

**Fixture 3 — `polie-all-push.json`** (the orphaned NFR-C4) — one hole (hole 1, par 4), all nets = par, **no polie boxes** → base 0 + polie 0 → `pts=0` → **empty edges**. perPlayer all 0; `edges = []`; `ledgerTotalCents = 0`.

> **Fixtures 1–3's `expected` blocks are the NFR-C1 artifact. Approving this spec = approving these numbers + the gross-bogey-or-better model. The resolver is written to match.**

### Reuse the shipped seams (verified by direct read 2026-06-22)

- **`engine/games/modifiers/greenie.ts`** (2.2, shipped) — the structural sibling. polie is the STATELESS version: no carry pot, no par-3 filter, no fold — just `poliePoints(hole, …)` per hole, plus the gross gate. Mirror `greenieActive`/`greenieCarryover`. [Source: …/modifiers/greenie.ts]
- **`engine/games/compute-foursome.ts`** — greenie folds `pointsByHole.get(holeNumber)` into `pts` before the `pts===0` short-circuit; polie adds a stateless per-hole `poliePoints(hole)` the same way. The `pts===0` skip IS the all-push handling (AC8). [Source: …/compute-foursome.ts]
- **`engine/games/registry.ts`** — `validateResolvedConfig` (2.2) has the per-modifier allowlist + `invalid_variant_shape`/`invalid_modifier_enabled`/carryover-type guards; polie adds its branch + extends greenie/net-skins to reject `polieBogeyOrBetter`. [Source: …/registry.ts]
- **`engine/games/types.ts`** — `ModifierVariant` (keys optional). Add `polieBogeyOrBetter?`. `HoleClaims.polie?` exists (2.1). Add `HoleState.gross?`. [Source: …/types.ts]
- **`services/games-money.ts`** — already reads `scoreRows` with `grossStrokes` and builds dense holes from `siByHole.keys()` (greenie 2.2). Add a `grossByHole` map (same loop) and attach `gross` to each dense `HoleState`. [Source: …/services/games-money.ts]
- **Golden + property harness** — `greenie.golden.test.ts` + `games.property.test.ts` (2.2). polie mirrors them (no carry-conservation property — stateless; the new property is additivity + order-independence). [Source: …]

### Why no config_version bump (verified)

`ENGINE_CONFIG_VERSION = 1`. Adding polie as a newly registered modifier does not change any existing config's meaning (net-skins/greenie unchanged), so configs stay `configVersion: 1`. Adding `HoleState.gross` is an engine-internal input type, not a config change. An older engine reading a polie config correctly **fails closed** via `unknown_modifier:polie` (FR44). No bump.

### Out of scope

Seed/template adoption (2.7); score-entry polie UI (2.1, shipped); sandie (2.4); birdie (2.5); cap (2.6). No route, no migration, no web edit. The only `services/*` change is the gross-on-dense-holes in `games-money.ts` (Task 3b).

### Project Structure Notes

New: `engine/games/modifiers/polie.ts`, `modifiers/polie.test.ts`, `polie.golden.test.ts`, three `__fixtures__/polie-*.json`, `services/games-money.polie.test.ts`. Edits: `engine/games/types.ts`, `config-schema.ts`, `registry.ts`, `compute-foursome.ts`, `games.property.test.ts`, `services/games-money.ts`. All `apps/tournament-api/**` (ALLOWED).

### Testing standards

Vitest + fast-check (existing deps; no new deps). Pure engine — no DB (except the games-money service test). Must-have tests in Task 5/6: three goldens green; count model (1/2/contested/all-four); non-par-3 counts; gross gate (eligible/voided/absent-gross/gate-off); foreign-key ignored; incomplete-hole 0; all-push empty edges; value-at-hole (segmented PV); fail-closed (polie variants + cross-modifier polieBogeyOrBetter rejects); inert; additivity + order-independence property; base money byte-identical with gross attached; Epic-1 + greenie goldens byte-identical.

### References

- [Source: epics-f1-rules-games.md#Story-2.3] · [Source: architecture-f1-rules-games.md] (FR2, FR16, FR44, NFR-C3/C4/C6/C7)
- [Source: event-setup-ux-backlog.md:192] (polie variant: bogey-or-better-**gross** vs any — Josh ratified GROSS 2026-06-22)
- [Source: apps/tournament-api/src/engine/games/modifiers/greenie.ts] (2.2 sibling) · [registry.ts] · [compute-foursome.ts] · [types.ts] · [config-schema.ts] · [services/games-money.ts] (verified by direct read 2026-06-22)
- [Source: 2-2-greenie-modifier-stateful-carryover.md] (the just-shipped pattern this mirrors)

## Files this story will edit

- apps/tournament-api/src/engine/games/modifiers/polie.ts
- apps/tournament-api/src/engine/games/modifiers/polie.test.ts
- apps/tournament-api/src/engine/games/polie.golden.test.ts
- apps/tournament-api/src/engine/games/__fixtures__/polie-anything.json
- apps/tournament-api/src/engine/games/__fixtures__/polie-bogey-or-better.json
- apps/tournament-api/src/engine/games/__fixtures__/polie-all-push.json
- apps/tournament-api/src/engine/games/types.ts
- apps/tournament-api/src/engine/games/config-schema.ts
- apps/tournament-api/src/engine/games/registry.ts
- apps/tournament-api/src/engine/games/compute-foursome.ts
- apps/tournament-api/src/engine/games/games.property.test.ts
- apps/tournament-api/src/services/games-money.ts
- apps/tournament-api/src/services/games-money.polie.test.ts
- _bmad-output/implementation-artifacts/tournament/2-3-polie-modifier.md
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

## Spec-gate note (auto-approve disabled for this money story)

Although `.director-config.json` has `auto_approve_clean_specs: true`, this spec carries **money values** (the embedded golden `SettlementEdge[]`) under the **NFR-C1 hard gate**. The director presents this for a **manual gate** even if the codex+gemini ensemble returns clean.

## Flagged followups (NOT this story)

- **🔴 HIGH — "net off the low" base-money-model question (Josh, 2026-06-22).** The shipped F1 engine computes net off each player's **FULL** USGA course handicap (`engine/handicap-strokes.ts` `allocateStrokesFromCourseHandicap`; `net = gross − strokes(fullCH, SI)`), NOT "off the low man" (relative handicaps, where the lowest CH plays scratch and others get the difference). Josh says the group "usually" plays **net off the low**. If so, the shipped base money (low-ball, skins, team-total, net-skins, greenie — everything that consumes net) is on a different basis than the group's real game. Impact is concentrated in **absolute net-vs-par thresholds** (the skin gate `net ≤ par`; net-skins birdie/eagle levels); low-ball + team-total are comparison-invariant to a *uniform* per-hole shift but the floor/extra allocation is non-linear so margins can differ. **No real money mis-settled yet** (F1 flag OFF, no live F1 rounds). NOT in scope for polie (polie count = checkbox; polie gate = GROSS, both off-the-low-invariant). **Recommend a dedicated investigation + likely a config option (full-CH vs off-the-low) BEFORE F1 goes live for real money.** Logged here for the next planning pass.
- **Gross now carried by the engine** — this story adds `HoleState.gross` (sourced from raw entered `grossStrokes`, never reconstructed from net+handicap, precisely because off-the-low makes net→gross non-invertible). Future score-based gates (e.g. sandie's "up-and-down") can reuse it.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context).

### Debug Log References

- Golden gate ran FIRST: 3 fixtures + `polie.golden.test.ts` green before any consumer. NFR-C1 honored.
- Full `@tournament/api test`: 1331 passed / 0 failed (this run; up from 1296 — +polie golden 5, resolver 24, property +1, service 4). typecheck + lint clean across all workspaces. No lifecycle flake this run.

### Completion Notes List

- Implemented to Josh's ratified model: count-based per-player polie checkboxes (each worth 1 team point, `rawA = #A − #B`), STATELESS (no carryover), any hole; the ONLY lever is `polieBogeyOrBetter` Y/N on **GROSS** (`gross ≤ par+1`).
- **Gross threaded into the engine** (`HoleState.gross`) sourced DIRECTLY from raw `grossStrokes` in `games-money.ts` (never reconstructed from net — net is off-the-low/non-invertible). Base-money-neutral: base game + greenie ignore gross (proven by the existing golden gate + the polie service test (d)).
- **Coercion-safe gate** (`isBogeyOrBetter`): finite-number guard BEFORE the `≤ par+1` compare, so `null`/`undefined`/`NaN`/string gross is voided, never coerced (`null <= par+1` is `true` in JS).
- **Fail-closed allowlist** (registry): polie rejects `basis`/`bonus`/`carryover` + non-boolean `polieBogeyOrBetter`; greenie + net-skins reject a stray `polieBogeyOrBetter`. Exact reason strings consistent with shipped 2.2 conventions.
- **End-to-end service test** (`games-money.polie.test.ts`) proves the gate through the live chokepoint: (a) eligible bogey-gross polie pays, (b) double-bogey voids, (c) gate-off counts, (d) disabled base-neutral.
- **Impl review (codex gpt-5.2 + gemini-pro, high): synthesis SHIP, must_fix=None.** Gemini 0 findings; codex 1 Medium (gross-threading type-guard) — BOTH critiques converged it's redundant defense-in-depth (`grossStrokes` is a drizzle integer column used arithmetically for net; the engine already fail-closes; codex hadn't seen the service test that proves threading).

### Flagged followups (impl review — all OPTIONAL, non-blocking per synthesis)

- **(optional)** Add a service-boundary finite-number guard/coercion on `grossStrokes` when assigning `HoleState.gross` — hardens against numeric-string type drift (base net would coerce-survive but the polie gate would silently void). Redundant today (integer column + Zod-validated scoring API + arithmetic use), so deferred. The one non-fully-redundant sliver: a numeric-string would void polie asymmetrically while base survives.
- **(optional)** `parByHole.get(holeNumber) ?? 0` in the dense-holes build (carried from 2.2) — unreachable today (`siByHole`/`parByHole` share `holesInPlay`); same deferred general-engine item.

### File List

New:
- apps/tournament-api/src/engine/games/modifiers/polie.ts
- apps/tournament-api/src/engine/games/modifiers/polie.test.ts
- apps/tournament-api/src/engine/games/polie.golden.test.ts
- apps/tournament-api/src/engine/games/__fixtures__/polie-anything.json
- apps/tournament-api/src/engine/games/__fixtures__/polie-bogey-or-better.json
- apps/tournament-api/src/engine/games/__fixtures__/polie-all-push.json
- apps/tournament-api/src/services/games-money.polie.test.ts

Edited:
- apps/tournament-api/src/engine/games/types.ts (HoleState.gross + ModifierVariant.polieBogeyOrBetter)
- apps/tournament-api/src/engine/games/config-schema.ts (polieBogeyOrBetter in modifierSchema)
- apps/tournament-api/src/engine/games/registry.ts (registerModifier('polie') + polie allowlist; greenie/net-skins reject polieBogeyOrBetter)
- apps/tournament-api/src/engine/games/compute-foursome.ts (fold poliePoints into pts)
- apps/tournament-api/src/engine/games/games.property.test.ts (polie arbs + additivity property)
- apps/tournament-api/src/services/games-money.ts (grossByHole + attach gross to dense holes)
