# Story 2.4: Sandie modifier (count-based claim, no engine gate) + golden

Status: ready-for-dev

<!-- F1 Epic 2 (Full Game Vocabulary), Story 2.4 — the 3rd stateless claim modifier
(after greenie 2.2, polie 2.3). Source: epics-f1-rules-games.md#Story-2.4. NFR-C1
HARD GATE: the hand-calc golden (Dev Notes) is Josh-approved BEFORE resolver code.
Tournament paths only (FD-1/FD-2). ENGINE-ONLY — NO route, NO migration, NO UI,
NO service change. Story 2.1 already ships the per-player sandie checkbox AND
populates holeState.claims; this story CONSUMES those checkboxes.

MODEL — RATIFIED BY JOSH 2026-06-22 (corrects the epics' gated draft):
- A sandie = an "up-and-down from the sand" (out of a greenside bunker + one putt).
  Scorer-checked, accepted as entered (FR16), exactly like greenie/polie.
- ALL FOUR players can each have a sandie; **each is worth 1 team point** (+1 to the
  maker's team / −1 to the opponents). COUNT-BASED: sandieA = (# teamA sandies) −
  (# teamB sandies), range −2..+2. STATELESS — no carryover.
- **NO engine-enforced score gate.** The epics drafted a `par_or_better` vs
  `any_score` GROSS gate, but Josh ratified 2026-06-22 that the system must NOT
  validate eligibility (FR16 — "accepted as entered; the system does NOT validate
  eligibility… correctness is the group's, trust + audit"). The scorer simply does
  not check the box if the player did not earn the sandie under the group's rule;
  re-validating gross ≤ par in the engine would SILENTLY VOID a human-entered claim,
  which contradicts FR16. So a checked sandie **always counts** — no gross, no
  variant lever. The "sandies must be par-or-better" rule is a **Rules Sheet** item
  (Story 2.7), documentation for the group, NOT a settlement gate.
- Consequence: sandie's engine config is just `{ type:'sandie', enabled }` — no
  variant. (`HoleState.gross` from 2.3 is NOT read by sandie.)
- FOLLOW-UP (separate story, NOT this one): strip the equivalent bogey-or-better
  gate from polie (2.3, shipped) for the same FR16 reason. Logged in the followups
  section; polie keeps running as-is until then.
-->

## Story

As the F1 engine,
I want a pure, **stateless** sandie resolver that counts the per-player sandie checkboxes — matched to a hand-approved golden,
so that up-and-down-from-the-sand money settles deterministically from what the group checked, with the par-or-better convention left to the group (FR16) and the Rules Sheet (2.7).

## ⚠️ NFR-C1 HARD GATE (money story) — read first

Money-bearing, golden-bearing. The **golden fixture(s)** are authored to the Dev-Notes hand-calc; the exact `SettlementEdge[]` is approved at the **spec gate** (NFR-C1). **No resolver code merges before that approval.** Auto-approve **explicitly disabled** (money values — see "Spec-gate note"). Every edge case in AC 5–9 ships as a test **in this story**.

## Acceptance Criteria

**NFR-C1 golden gate**

1. The first artifact is a hand-authored, hand-approved golden fixture set (`engine/games/__fixtures__/sandie-*.json`) asserting the exact `SettlementEdge[]` for: (i) the **count model** — one box → +1; both teammates → +2; one each → 0 (contested); all four → 0; and (ii) an **all-push hole** (base 0, no sandie) → **empty `SettlementEdge[]`** (no crash, no phantom split). No resolver code merges before the hand-calc (Dev Notes) is approved. [AC1]

**Registry contract — `modifiers/sandie.ts`**

2. `modifiers/sandie.ts` registers a **pure resolver** that counts the per-player sandie **checkboxes** from `holeState.claims` (Story 2.1). Pure: no DB, no `Date`, no randomness; reads structurally **only its own foursome's** claims (`teamA ∪ teamB` members; foreign keys ignored — FR23). It does **not** read gross or any variant. To match the shipped greenie/polie pattern (resolver self-guards for any direct caller), `sandiePoints(hole, teamA, teamB, config)` takes `config` and **returns 0 when `!sandieActive(config)`** — `sandieActive` is the only thing it reads from config (sandie has no lever). `registerModifier('sandie')` is added to `registry.ts`. [AC2]
3. Sandie has **no config lever** — it is a binary on/off modifier (`{ type:'sandie', enabled }`). There is no `variant` for sandie; an enabled sandie carrying **any** `variant` key fails closed (AC10). (The par-or-better convention is a Rules-Sheet concept, Story 2.7, not an engine setting — FR16.) [AC3]
4. Sandies are **accepted as entered** — the system does **not** validate the up-and-down or the score (FR16); the scorer checks the box per the group's rule. **No new UI** — Story 2.1 already renders the sandie checkbox. [AC4]

**Per-hole count (the money core) — STATELESS**

5. **Per-hole raw points**: a member's sandie is **"checked"** iff `holeState.claims[playerId]?.sandie === true`. `rawA = (count of teamA members checked) − (count of teamB members checked)`, range **−2…+2**. A checked sandie **always counts** (no score/eligibility gate — FR16). Each unit is a team point (+1 each winner-team player / −1 each opponent). [AC5]
6. The per-hole sandie `award` (signed, A-positive) is **folded into the existing per-hole `pts`** and distributed through the **same `pts * (pointValueCents / 2)` 4-cross-pair split** (NFR-C7 — split path not forked), valued at the hole's `pointValueCents`. Per-player swing = `|rawA| * pointValueCents`; hole total = `2 * |rawA| * pointValueCents`. Computed **only on a complete hole** (all four nets present — the existing base gate). Stateless ⇒ a missing hole contributes nothing. [AC6]
7. **Order invariance (NFR-C6)**: invariant to the order of the `holes` input array (no cross-hole state); the existing "shuffle the input array" property must still pass with sandie active. [AC7]

**All-push + properties + fail-closed + loss-less**

8. **All-push hole**: a complete hole where every net ties the base to 0 AND no sandie is checked → `pts=0` → skipped (`if (pts === 0) continue`) → **empty `SettlementEdge[]`** when it is the only hole (golden + unit test; reuses the polie/greenie behavior). [AC8]
9. The sandie golden(s) are green and the `compute-foursome` ledger **including sandie lowers loss-lessly to edges** (NFR-C3). The existing **loss-less + zero-sum** (NFR-C3) and **foursome-isolation** (FR23) properties are extended to cover sandie (sandie added to `configArb`; random per-player sandie checkboxes added to `holeArb`). A new **`fast-check` sandie-additivity property** (non-tautological), constrained to **sandie-only config, FLAT PV, nets=par**: `perPlayerCents[a1] === perPlayerCents[a2] === cents * Σ_completeHoles (#A − #B)` (RHS from raw inputs), `b1===b2===−a1` (all four asserted), shuffle-invariant. [AC9]
10. **Fail-closed, per-modifier variant allowlist** (FR44, the shipped 2.2/2.3 pattern). For an **enabled** sandie, the shared guards run **first, in the shipped loop order** — `duplicate_modifier` → `unknown_modifier` → `invalid_modifier_enabled` (non-boolean `enabled`) → `invalid_variant_shape` (non-object `variant`) — exactly as today; only then does the sandie branch run. The sandie branch enforces that sandie carries **no lever at all**: an enabled sandie with a **non-empty** `variant` (ANY key — known OR unknown) → reject `unsupported_sandie_variant:${firstKey}` (truly fail-closed; `firstKey = Object.keys(variant)[0]`). This is **stricter than greenie/polie** (which allow-list one valid key each) — correct here because sandie has zero valid keys, so any key is a misconfig (closes the unknown-key gap that greenie/polie defer to Zod `.strict()`). **An absent `variant` or an empty `variant:{}` is ALLOWED** (inert — no keys). (No `sandieScore` key exists, so greenie/net-skins/polie need no new cross-rejection.) [AC10]

**Scope guard**

11. **All CODE changes are `apps/tournament-api/**`** (FD-1/FD-2): engine (`registry.ts`, `compute-foursome.ts`, `modifiers/sandie.ts`, `games.property.test.ts`) only. **NO `types.ts`/`config-schema.ts` variant change** (sandie has no variant — `HoleClaims.sandie?` already exists from 2.1). **NO `services/games-money.ts` change.** The only non-code edits are director tracking artifacts under `_bmad-output/**` (ALLOWED). **Out of scope**: the par-or-better Rules-Sheet text (Story 2.7); the score-entry sandie UI (2.1, shipped); birdie (2.5); cap (2.6); the polie-gate-strip follow-up; the off-the-low base-net investigation (2.3 followup); any route/migration. [AC11]

## Tasks / Subtasks

- [ ] **Task 1 — registry registration + fail-closed (AC: 2,10)**
  - [ ] `engine/games/registry.ts`: `registerModifier('sandie')`. In `validateResolvedConfig`, add a sandie branch (after the shared shape/enabled guards): an enabled sandie with a non-empty `variant` (any key) → `unsupported_sandie_variant:${Object.keys(m.variant)[0]}` (truly fail-closed; sandie has no valid lever). Absent/empty variant passes. Disabled modifiers stay inert. (No new key on `ModifierVariant`; no cross-modifier change.)
- [ ] **Task 2 — pure resolver `modifiers/sandie.ts` (AC: 2,5,7)**
  - [ ] Export `sandieActive(config): boolean` and `sandiePoints(hole, teamA, teamB, config): number` (signed A-positive; **self-guards** `if (!sandieActive(config)) return 0`; else `rawA = #A_sandie − #B_sandie` counting `claims[p]?.sandie === true` for `teamA ∪ teamB` only; foreign keys ignored). Pure; stateless; no gross. Mirrors `poliePoints`'s self-guard signature exactly (minus the gate).
- [ ] **Task 3 — wire into `compute-foursome.ts` (AC: 6,8)**
  - [ ] Hoist `const sandieOn = sandieActive(config)` before the loop; in the per-hole loop add `+ (sandieOn ? sandiePoints(hole, teamA, teamB, config) : 0)` to `pts` BEFORE the `pts===0` short-circuit (valued at hole PV; split untouched; all-push stays inert). (sandiePoints also self-guards; the hoist just avoids a per-hole `find()`.)
- [ ] **Task 4 — golden fixtures + harness (AC: 1,8,9)**
  - [ ] `__fixtures__/sandie-count.json` (count model on multiple holes incl. +2 and contested-0) + `sandie-all-push.json` (all-push → empty edges), transcribed exactly from the approved Dev-Notes hand-calc.
  - [ ] `engine/games/sandie.golden.test.ts` (mirror `polie.golden.test.ts`); assert `perPlayerNetCents` / `edges` (post-2.1a whole-dollar 1-to-1) / `ledgerTotalCents`; an order-independence case (reversed holes byte-identical).
- [ ] **Task 5 — resolver + wiring tests `modifiers/sandie.test.ts` (AC: 5,6,8,10)** — front-loaded edges:
  - [ ] count model: 1 → +1; both A → +2; one each → 0; all four → 0; B-team sign (−1, −2).
  - [ ] counts on par-3/4/5 (any hole); foreign claim key ignored; incomplete hole 0; all-push → empty edges (via computeFoursome); value-at-hole segmented PV.
  - [ ] fail-closed: enabled sandie with `basis`/`bonus`/`carryover`/`polieBogeyOrBetter` → `unsupported_sandie_variant:<key>`; enabled sandie with an **unknown** key (e.g. `{foo:1}` cast) → `unsupported_sandie_variant:foo` (truly fail-closed); valid enabled sandie with no variant OR empty `variant:{}` passes; disabled sandie with a stray variant stays inert.
  - [ ] sandie inactive (absent/disabled) → 0 (inert).
- [ ] **Task 6 — property test extension `games.property.test.ts` (AC: 7,9)**
  - [ ] Extend `configArb` (random enabled sandie — sandie has no variant, so just enabled/absent); extend `holeArb` (random per-player sandie boxes). configArb composes each modifier with ONLY its own valid lever so configs stay valid.
  - [ ] New **sandie-additivity** property (sandie-only, flat PV, nets=par): all four per-player cents === `±cents * Σ(#A−#B)`, RHS from raw inputs, shuffle-invariant. Confirm existing order-independence/loss-less/isolation still pass with sandie active.
- [ ] **Task 7 — regression gate (AC: all)** — `pnpm --filter @tournament/api test`, `pnpm -r typecheck`, `pnpm -r lint` green; engine + wolf-cup + web unchanged. Epic-1 + greenie + polie goldens byte-identical (sandie inactive ⇒ zero change).

## Dev Notes

### Golden hand-calc (Josh-approves at the spec gate) — NFR-C1

**Isolation device:** every player's net = par on every hole ⇒ all base points 0. So each ledger reflects **sandie points only**. Teams A={a1,a2}, B={b1,b2}, flat $5/point (`pointValueCents = 500`), net-skins ON (0 here), sandie ON. (No gross needed — sandie has no score gate.)

> **Edge IR note:** the exact `edges` use the **shipped post-2.1a `ledgerToEdges` canonicalization** — slot-paired whole-dollar 1-to-1 (`teamA[i]↔teamB[i]`), sorted by `(fromPlayerId, toPlayerId)`. Asserted against the live function.

**Fixture 1 — `sandie-count.json`** — proves the count model end-to-end (all nets = par), including the **contested (one-each)** and **all-four** zero cases:

| Hole | Par | sandie boxes | rawA | award to A |
|------|-----|--------------|------|------------|
| 1 | 4 | a1 | +1 | +1 |
| 2 | 5 | a1, a2 | +2 | +2 (both teammates) |
| 3 | 3 | b1 | −1 | −1 |
| 4 | 4 | a1, b1 | 0 | 0 (contested — one each) |
| 5 | 4 | a1, a2, b1, b2 | 0 | 0 (ALL FOUR — 2 vs 2 nets out) |

Round sandieA = +1 +2 −1 +0 +0 = **+2**. perPlayer: a1=a2=**+1000c (+$10)**; b1=b2=**−1000c**. Edges `b1→a1 1000`, `b2→a2 1000`. `ledgerTotalCents = 2000`. (H4 contested + H5 all-four both yield `pts=0` → skipped → no edges; the round total is unchanged, but the golden now exercises both zero cases per AC1.)

**Fixture 2 — `sandie-all-push.json`** — one hole (hole 1, par 4), all nets = par, **no sandie boxes** → base 0 + sandie 0 → `pts=0` → **empty edges**. perPlayer all 0; `edges = []`; `ledgerTotalCents = 0`.

> **Fixtures 1–2's `expected` blocks are the NFR-C1 artifact. Approving this spec = approving these numbers + the count-only (no-gate) model.**

### Reuse the shipped seams (verified by direct read 2026-06-22)

- **`engine/games/modifiers/polie.ts`** (2.3, shipped) — the template, MINUS the gross gate. sandie is the simplest claim modifier: pure count, no gross, no variant. [Source: …/modifiers/polie.ts]
- **`engine/games/compute-foursome.ts`** — greenie + polie already fold into `pts` before `pts===0`; sandie adds a 3rd stateless per-hole term the same way. [Source: …/compute-foursome.ts]
- **`engine/games/registry.ts`** — `validateResolvedConfig` has the per-modifier allowlist + shared guards; sandie adds a no-variant branch. [Source: …/registry.ts]
- **`engine/games/types.ts`** — `HoleClaims.sandie?` exists (2.1). **No `ModifierVariant` change** (sandie has no lever). [Source: …/types.ts]
- **Golden + property harness** — `polie.golden.test.ts` + `games.property.test.ts` (2.3). [Source: …]

### Why no config_version bump (verified)

`ENGINE_CONFIG_VERSION = 1`. Adding sandie as a newly registered modifier does not change any existing config's meaning, so configs stay `configVersion: 1`. An older engine reading a sandie config **fails closed** via `unknown_modifier:sandie` (FR44). No bump.

### Out of scope

Par-or-better Rules-Sheet text (2.7); score-entry sandie UI (2.1, shipped); birdie (2.5); cap (2.6); the polie-gate-strip follow-up; the off-the-low base-net investigation (2.3 followup). No route, no migration, no web edit, no service change, no `types.ts`/`config-schema.ts` variant change.

### Project Structure Notes

New: `engine/games/modifiers/sandie.ts`, `modifiers/sandie.test.ts`, `sandie.golden.test.ts`, two `__fixtures__/sandie-*.json`. Edits: `engine/games/registry.ts`, `compute-foursome.ts`, `games.property.test.ts`. All `apps/tournament-api/**` (ALLOWED).

### Testing standards

Vitest + fast-check. Pure engine — no DB. Must-have: two goldens green; count model (1/2/contested/all-four/B-sign); any-hole; foreign-key ignored; incomplete-hole 0; all-push empty edges; value-at-hole (segmented PV); fail-closed (sandie carries no variant); inert; additivity + order-independence property; Epic-1 + greenie + polie goldens byte-identical.

### References

- [Source: epics-f1-rules-games.md#Story-2.4] (the gated variant is SUPERSEDED by Josh's FR16 drop-the-gate decision 2026-06-22) · [Source: architecture-f1-rules-games.md] (FR16, FR44, NFR-C3/C6/C7)
- [Source: apps/tournament-api/src/engine/games/modifiers/polie.ts] (2.3 template, minus the gate) · [registry.ts] · [compute-foursome.ts] · [types.ts] (verified by direct read 2026-06-22)
- [Source: 2-3-polie-modifier.md] (the gross-gated sibling; its gate is the follow-up strip target)

## Flagged followups (NOT this story)

- **Strip polie's bogey-or-better gate (2.3, shipped).** For the same FR16 reason sandie has no gate, polie's `polieBogeyOrBetter` gross gate silently voids a human-entered claim. Recommend a small follow-up story to make polie count-only (remove the lever + 1 fixture; keep the reusable gross threading). Josh decision pending; polie runs as-is until then.
- **🔴 off-the-low base-net** (carried from 2.3) — pre-F1-launch base-money investigation; unrelated to claim modifiers.

## Files this story will edit

- apps/tournament-api/src/engine/games/modifiers/sandie.ts
- apps/tournament-api/src/engine/games/modifiers/sandie.test.ts
- apps/tournament-api/src/engine/games/sandie.golden.test.ts
- apps/tournament-api/src/engine/games/__fixtures__/sandie-count.json
- apps/tournament-api/src/engine/games/__fixtures__/sandie-all-push.json
- apps/tournament-api/src/engine/games/registry.ts
- apps/tournament-api/src/engine/games/compute-foursome.ts
- apps/tournament-api/src/engine/games/games.property.test.ts
- _bmad-output/implementation-artifacts/tournament/2-4-sandie-modifier-par-vs-any-score-variant.md
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

## Spec-gate note (auto-approve disabled for this money story)

Although `.director-config.json` has `auto_approve_clean_specs: true`, this spec carries **money values** (the embedded golden `SettlementEdge[]`) under the **NFR-C1 hard gate**. The director presents this for a **manual gate** even if the codex+gemini ensemble returns clean.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context).

### Debug Log References

- Golden gate ran FIRST: 2 fixtures + `sandie.golden.test.ts` green before the resolver settled them. NFR-C1 honored.
- Full `@tournament/api test`: 1354 passed / 0 failed (up from 1331 — +sandie golden 3, resolver 20, property +1). typecheck + lint clean. No lifecycle flake this run.

### Completion Notes List

- Implemented Josh's ratified PURE COUNT model (FR16, no engine gate): sandie = count checked boxes → team points (`rawA = #A − #B`), stateless, any hole, always counts when checked. Anyone can get one; all four → 0 (2-vs-2); a team gets +2 if both teammates have one + neither opponent.
- **Simplest modifier yet** — engine-only: NO gross read, NO variant lever, NO `types.ts`/`config-schema.ts`/`games-money.ts` change. It's a gate-less polie. The "par/bogey-or-better / up-and-down" rules + on/off pills move to the Rules Sheet (Story 2.7), per Josh.
- `sandiePoints` self-guards (returns 0 when `!sandieActive`), mirroring `poliePoints`; compute-foursome hoists `sandieOn` and folds it into `pts` before the `pts===0` short-circuit (all-push → empty edges; split untouched, NFR-C7).
- **Fail-closed (truly):** an enabled sandie with ANY non-empty `variant` (known OR unknown key) → `unsupported_sandie_variant:${firstKey}` (stricter than greenie/polie, since sandie has zero valid levers). Absent/empty variant passes.
- **Impl review (codex gpt-5.2 + gemini-pro, high): synthesis SHIP, must_fix=None.** Gemini 0 findings ("exceptional"); codex 3 Lows, all optional. Folded the one worth doing (present-but-disabled `sandieActive` boundary test); both reviewers confirmed clean on re-review.

### Flagged followups (impl review — OPTIONAL, non-blocking per synthesis)

- **(optional, intentional — NOT changing)** `sandiePoints` re-checks `sandieActive` per hole despite the hoisted `sandieOn`. This is the deliberate self-guard for direct callers (parity with shipped `poliePoints`); documented in the resolver JSDoc.
- **(optional, theoretical)** the registry's `Object.keys(variant)` fail-closed ignores symbol/non-enumerable keys — unreachable for JSON-sourced, Zod-`.strict()`-validated configs (the production path). Same general-engine deferred theme as 2.2/2.3.

### File List

New:
- apps/tournament-api/src/engine/games/modifiers/sandie.ts
- apps/tournament-api/src/engine/games/modifiers/sandie.test.ts
- apps/tournament-api/src/engine/games/sandie.golden.test.ts
- apps/tournament-api/src/engine/games/__fixtures__/sandie-count.json
- apps/tournament-api/src/engine/games/__fixtures__/sandie-all-push.json

Edited:
- apps/tournament-api/src/engine/games/registry.ts (registerModifier('sandie') + no-variant fail-closed branch)
- apps/tournament-api/src/engine/games/compute-foursome.ts (fold sandiePoints into pts)
- apps/tournament-api/src/engine/games/games.property.test.ts (sandie arb + additivity property)
