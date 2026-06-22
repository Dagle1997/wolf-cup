# Story 2.4a: Strip polie's bogey-or-better gate → pure count (matching sandie)

Status: ready-for-dev

<!-- F1 Epic 2, inserted 2026-06-22 (user-directed). Source: Josh's FR16 ruling
during Story 2.4 — the system does NOT validate claim eligibility (the scorer
just doesn't check the box if the player didn't earn it; an engine gross gate
silently voids a human-entered claim, against FR16). Story 2.3 shipped polie WITH
a bogey-or-better gross gate; Story 2.4 (sandie) shipped pure count. This story
makes polie consistent: remove the gate, polie becomes a PURE COUNT claim like
sandie. The "polie must be bogey-or-better" rule moves to the Rules Sheet (2.7).
MONEY STORY (changes polie settlement) → golden + dual-model impl debate.
Tournament paths only (FD-1/FD-2). Engine-only.

KEEP the gross threading: `HoleState.gross` (2.3) + `games-money.ts` populating it
STAY — they are reusable and Story 2.5 (gross/natural birdie) needs per-player
gross. Only polie STOPS READING gross. (Removing the threading would be a larger,
counter-productive revert.)
-->

## Story

As the F1 engine,
I want polie's bogey-or-better gross gate removed so polie is a pure count of checked boxes (identical money model to sandie),
so that a scorer-checked polie always counts (FR16 — the group decides eligibility at check-time), and the codebase has ONE claim-count model for polie/sandie.

## ⚠️ NFR-C1 HARD GATE (money story) — read first

This **changes shipped polie money** (a previously-gate-voided polie now counts). Per NFR-C1: the updated golden `SettlementEdge[]` is Josh-approved at the **spec gate** before resolver code merges; auto-approve is **disabled** (see Spec-gate note). The resolver is written to match the approved golden.

## Acceptance Criteria

**NFR-C1 golden gate**

1. The golden set is updated to the count-only model: `__fixtures__/polie-anything.json` is **retained** (its config has no variant; its count math is unchanged) as the canonical polie count golden, and `__fixtures__/polie-bogey-or-better.json` is **removed** (its `polieBogeyOrBetter:true` config no longer validates — see AC5). A **behavior-change golden/test** proves the strip: a polie checked by a player who scored **double-bogey gross** — which the 2.3 gate VOIDED — now **counts**, changing the ledger (the old gated result was $10/side; count-only is $5/side on the same inputs). No resolver change merges before the hand-calc (Dev Notes) is approved. [AC1]

**Resolver — `modifiers/polie.ts` becomes pure count**

2. `modifiers/polie.ts`: remove `polieBogeyOrBetter`, `isBogeyOrBetter`, and `polieEligible`; `poliePoints(hole, teamA, teamB, config)` becomes a **pure count** — `rawA = (#teamA polie boxes) − (#teamB polie boxes)`, counting `claims[p]?.polie === true` for `teamA ∪ teamB` only (foreign keys ignored, FR23), self-guarding `if (!polieActive(config)) return 0`. It **no longer reads `hole.gross`**. Identical shape to `sandiePoints`. [AC2]
3. **No carryover, any hole, stateless** (unchanged); a checked polie **always counts** (no eligibility gate). [AC3]

**Type + schema + registry cleanup (remove the lever)**

4. `types.ts`: remove `polieBogeyOrBetter?` from `ModifierVariant` (no longer used) **and update the `HoleState.gross` JSDoc** (which currently names polie's gate as the reader) to say gross is retained for future score-based consumers (Story 2.5 gross-birdie), not polie. `config-schema.ts`: remove `polieBogeyOrBetter` from the variant `modifierSchema`. **Fail-closed preserved (NFR-C4, the codex-High check):** the variant object is `.strict()`, which **REJECTS** unknown keys (it does NOT strip them) — so after removal, a stale config carrying `{polieBogeyOrBetter:…}` fails Zod validation at the write boundary (`parseGameConfig`) rather than being silently stripped. (`HoleState.gross?` STAYS — reusable, Story 2.5 needs it.) [AC4]
5. `registry.ts`: the **polie** branch becomes the **no-lever** form (matching sandie) — an enabled polie with **any** non-empty `variant` (any key) → `unsupported_polie_variant:${Object.keys(variant)[0]}` (truly fail-closed; polie now has zero valid levers). Remove the now-dead cross-rejections that named `polieBogeyOrBetter` (the `unsupported_greenie_variant:polieBogeyOrBetter` and `unsupported_net_skins_variant:polieBogeyOrBetter` checks — once the key is removed from `ModifierVariant`, those `m.variant?.polieBogeyOrBetter` reads no longer compile) **and update the registry sandie-branch comment** that references `polieBogeyOrBetter`. **Fail-closed rationale (corrected per codex-Med — NOT "sandie's Object.keys covers it"):** a greenie/net-skins config carrying the now-removed `polieBogeyOrBetter` key fails closed via (i) Zod `.strict()` at the write boundary (production path), and (ii) the residual direct-caller unknown-key-on-greenie/net-skins case is the **same general-engine unknown-key gap deferred since 2.2/2.3** (not newly introduced by this story) — greenie/net-skins allow-list their own known keys; truly-unknown-key rejection on object variants remains the deferred followup. The shared guards (`invalid_modifier_enabled`, `invalid_variant_shape`, `unknown_modifier`, `duplicate_modifier`) and greenie/net-skins/sandie's own allowlists are otherwise unchanged. [AC5]

**Wiring + properties + tests**

6. `compute-foursome.ts` polie wiring is **unchanged** (`polieOn ? poliePoints(...) : 0` still folds into `pts` before `pts===0`); the change is purely inside `poliePoints` (no longer reading gross) + the config validation. [AC6]
7. **Tests updated, not weakened (gemini-High — account for EVERY existing `polieBogeyOrBetter` reference so the build stays green).** `modifiers/polie.test.ts`: remove the gross-gate tests (gate ON/OFF, eligible/voided/absent-gross/non-finite-gross) **AND the two cross-modifier tests that assert `unsupported_greenie_variant:polieBogeyOrBetter` / `unsupported_net_skins_variant:polieBogeyOrBetter`** (those reason strings + the `polieBogeyOrBetter` key are removed — the tests would not compile); **keep** the count model + foreign-key + incomplete-hole + all-push + value-at-hole + inert tests; **add** a "double-bogey-gross polie now counts (gate removed)" test + the no-variant fail-closed tests (any variant key, incl. an unknown key, → `unsupported_polie_variant:<key>`). **The registry polie no-lever validation is tested HERE** (via `validateResolvedConfig` in `polie.test.ts`), exactly as sandie's no-lever branch is tested in `sandie.test.ts` — no separate `registry.test.ts` is introduced (consistent with the shipped per-modifier test placement). `services/games-money.polie.test.ts`: replace the gate end-to-end tests (eligible/voided/gate-off) with a **count-only end-to-end test** (a polie claim counts through `computeF1PerPlayerNet` regardless of the player's gross). `games.property.test.ts`: the polie arb drops `polieBogeyOrBetter` (polie has no variant — `{type:'polie', enabled:true}`); the polie additivity property already used the gate-off path, so it stays valid (now unconditional). **Grep gate:** before the regression run, `grep -r polieBogeyOrBetter apps/tournament-api/src` must return ZERO matches (proves no dangling reference). [AC7]
8. **Loss-less + regression (NFR-C3):** the updated polie goldens are green and lower loss-lessly to edges. **Byte-identical** Epic-1 / greenie / sandie goldens (this story touches only polie's gate). polie-anything.json stays byte-identical (config + math unchanged). [AC8]

**Scope guard**

9. **All CODE changes are `apps/tournament-api/**`** (FD-1/FD-2): `modifiers/polie.ts`, `types.ts`, `config-schema.ts`, `registry.ts`, `games.property.test.ts`, `modifiers/polie.test.ts`, `services/games-money.polie.test.ts`, the polie goldens/fixtures. **KEEP** `HoleState.gross` + the `games-money.ts` gross population (NOT reverted — reusable, Story 2.5). **Out of scope**: the par/bogey-or-better Rules-Sheet text + pills (Story 2.7); greenie/sandie (unchanged); birdie (2.5); cap (2.6); any route/migration. [AC9]

## Tasks / Subtasks

- [ ] **Task 1 — strip the gate from `modifiers/polie.ts` (AC: 2,3)**
  - [ ] Delete `polieBogeyOrBetter`, `isBogeyOrBetter`, `polieEligible`. Rewrite `poliePoints` as a pure count (mirror `sandiePoints`, keeping the self-guard + the `config` param signature for caller compatibility with compute-foursome). Update the file JSDoc (remove the gate description; note the gross threading stays for other consumers).
- [ ] **Task 2 — remove the lever from types + schema + registry (AC: 4,5)**
  - [ ] `types.ts`: remove `polieBogeyOrBetter?` from `ModifierVariant`. `config-schema.ts`: remove it from the variant schema. `HoleState.gross?` stays.
  - [ ] `registry.ts`: rewrite the polie branch to the sandie-style no-lever form (any non-empty variant → `unsupported_polie_variant:${firstKey}`). Remove the dead `unsupported_greenie_variant:polieBogeyOrBetter` and `unsupported_net_skins_variant:polieBogeyOrBetter` checks.
- [ ] **Task 3 — goldens (AC: 1,8)**
  - [ ] Remove `__fixtures__/polie-bogey-or-better.json` (invalid config). Keep `polie-anything.json` (byte-identical). Add `__fixtures__/polie-counts-regardless.json` — the OLD bogey-or-better inputs (a1 par-gross, a2 bogey-gross, b1 **double-bogey** gross, each with a polie claim), config count-only → **b1's polie counts** → a1=a2=+$5 (the 2.3 gate gave +$10). Update `polie.golden.test.ts`: drop the removed fixture + the gate-contrast test; assert the two count goldens; keep the order-independence case.
- [ ] **Task 4 — tests (AC: 7)** — per AC7: trim gate tests, add behavior-change + no-variant fail-closed tests in `polie.test.ts`; replace the service gate tests with a count-only end-to-end test; update the property arb.
- [ ] **Task 5 — regression gate (AC: all)** — **first** run `grep -r polieBogeyOrBetter apps/tournament-api/src` → MUST be empty (no dangling reference: type, schema, registry checks, polie.ts, all tests). Then `pnpm --filter @tournament/api test`, `pnpm -r typecheck`, `pnpm -r lint` green; Epic-1/greenie/sandie goldens byte-identical; polie-anything.json byte-identical; engine + wolf-cup + web unchanged.

## Dev Notes

### Golden hand-calc (Josh-approves at the spec gate) — NFR-C1

All nets = par (base 0); flat $5/point; net-skins ON (0 here); polie ON (count-only). The behavior-change fixture reuses the **identical inputs** of the removed 2.3 `polie-bogey-or-better.json`:

**`polie-counts-regardless.json`** (count-only) — proves the gate removal moves money:

| Hole | Par | polie box | that player's GROSS | 2.3 gate verdict | 2.4a (count-only) |
|------|-----|-----------|---------------------|------------------|-------------------|
| 1 | 4 | a1 | 4 (par) | counted (+1) | counts (+1) |
| 2 | 5 | a2 | 6 (bogey) | counted (+1) | counts (+1) |
| 3 | 4 | b1 | 6 (double bogey) | **VOIDED (0)** | **counts (−1)** |

Round polieA (count-only) = +1 +1 −1 = **+1** → a1=a2=**+500c (+$5)**; b1=b2=**−500c**. Edges `b1→a1 500`, `b2→a2 500`; `ledgerTotalCents = 1000`. **Contrast:** the 2.3 gated engine gave +2 → $10/side; removing the gate makes b1's double-bogey polie count → $5/side. (gross is present in the fixture but unread — documents that polie ignores it now.)

**`polie-anything.json`** (retained, byte-identical) — the count model on its own inputs: a1(+1), a1+a2(+2), b1(−1), contested(0) → +2 → a1=a2=+$10, total $20.

> **Approving this spec = approving the count-only polie numbers + the gate removal.**

### Reuse / consistency

- After this story, `poliePoints` and `sandiePoints` are **structurally identical** (pure count, self-guard). One-modifier-one-file is retained (architecture pattern 18); a shared helper is explicitly NOT extracted in this story (out of scope — could be a later refactor).
- `HoleState.gross` + `games-money.ts` gross population are **unchanged** — reusable infrastructure; Story 2.5 (gross/natural birdie) consumes per-player gross. [Source: epics-f1-rules-games.md#Story-2.5]

### Why no config_version bump

Removing a modifier's lever does not make older configs invalid in a way that needs versioning: a pre-2.4a polie config with `variant:{polieBogeyOrBetter:…}` now **fails closed** (`unsupported_polie_variant:polieBogeyOrBetter`) rather than silently mis-settling — the correct fail-closed posture (FR44). No prod F1 rounds exist (flag OFF), so no stored config is affected. No bump.

### Out of scope

Rules-Sheet par/bogey-or-better text + pills (2.7); greenie/sandie; birdie (2.5); cap (2.6). Do NOT revert the gross threading. No route/migration/web edit.

### Project Structure Notes

Edits: `modifiers/polie.ts`, `types.ts`, `config-schema.ts`, `registry.ts`, `games.property.test.ts`, `modifiers/polie.test.ts`, `services/games-money.polie.test.ts`, `polie.golden.test.ts`. New: `__fixtures__/polie-counts-regardless.json`. Removed: `__fixtures__/polie-bogey-or-better.json`. All `apps/tournament-api/**`.

### References

- [Source: 2-3-polie-modifier.md] (the gated polie this strips) · [Source: 2-4-sandie-modifier-par-vs-any-score-variant.md] (the count-only pattern polie now matches) · FR16, FR44, NFR-C1/C3/C7.

## Files this story will edit

- apps/tournament-api/src/engine/games/modifiers/polie.ts
- apps/tournament-api/src/engine/games/modifiers/polie.test.ts
- apps/tournament-api/src/engine/games/polie.golden.test.ts
- apps/tournament-api/src/engine/games/__fixtures__/polie-counts-regardless.json
- apps/tournament-api/src/engine/games/__fixtures__/polie-bogey-or-better.json
- apps/tournament-api/src/engine/games/types.ts
- apps/tournament-api/src/engine/games/config-schema.ts
- apps/tournament-api/src/engine/games/registry.ts
- apps/tournament-api/src/engine/games/games.property.test.ts
- apps/tournament-api/src/services/games-money.polie.test.ts
- _bmad-output/implementation-artifacts/tournament/2-4a-strip-polie-bogey-or-better-gate.md
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

## Spec-gate note (auto-approve disabled for this money story)

This **changes shipped polie money** (a gate-voided polie now counts) under NFR-C1. Manual gate even if the codex+gemini ensemble is clean.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context).

### Debug Log References

- Golden gate ran FIRST (new polie-counts-regardless.json + kept polie-anything.json) green before the strip. **Grep gate** `grep -r polieBogeyOrBetter apps/tournament-api/src` = **0** (no dangling reference).
- Full `@tournament/api test`: **1348 passed / 0 failed** (down 6 from 1354 — ENTIRELY from intentionally removing the gate tests for the now-removed gate; 0 failures; polie COUNT coverage retained + the behavior-change newly tested). typecheck + lint clean.

### Completion Notes List

- Stripped polie's bogey-or-better gross gate per Josh's FR16 ruling: polie is now a **pure count** claim identical to sandie (`poliePoints = #A − #B`, self-guard, no gross read). Removed `polieBogeyOrBetter`/`isBogeyOrBetter`/`polieEligible` from polie.ts; removed the lever from `ModifierVariant` (types.ts) + config-schema; merged the polie + sandie registry branches into one no-lever check (any non-empty variant → `unsupported_{type}_variant:<key>`); removed the dead greenie/net-skins `polieBogeyOrBetter` cross-rejections.
- **KEPT `HoleState.gross` + the games-money gross threading** (reusable; Story 2.5 gross/natural birdie consumes it). Updated the `HoleState.gross` JSDoc to reflect it's now an unread-but-retained input for future score-based modifiers.
- **Goldens:** removed `polie-bogey-or-better.json` (its `polieBogeyOrBetter:true` config no longer validates); added `polie-counts-regardless.json` (the OLD gated inputs, count-only → b1's double-bogey polie now counts → **$5/side** vs the 2.3 gated **$10/side** — proves the strip moves money); `polie-anything.json` config/holes/expected byte-identical (doc text only updated).
- **Impl review (codex gpt-5.2 + gemini-pro, high): synthesis SHIP, must_fix=None.** Both reviewers raised a backward-compat HIGH (removing the key hard-rejects any persisted `polieBogeyOrBetter` config); BOTH critiques downgraded it (missing_evidence / theoretical — zero production records). **Code-level data check (this story):** `git log -S polieBogeyOrBetter -- db/ routes/` is EMPTY → the key NEVER appeared in any seed or config-writing route (only the engine modifier + tests) → no persisted config carries it. Combined with F1-flag-OFF + fail-closed safety (a legacy config fails loudly as unsettleable, never mis-settles), zero-impact.

### Flagged followups (impl review — non-blocking per synthesis SHIP)

- **(should_fix — Josh, before F1 goes live)** Definitive prod-DB scan for any `game_config`/`round_pin` JSON containing `polieBogeyOrBetter` (the code-level check above is strong but only the prod DB is authoritative). If any exist, a tiny migration strips the key. Today: F1 flag OFF, no real rounds, no code path ever wrote it → expected zero.
- **(should_fix — release note)** Document the intentional backward-incompatibility + fail-closed: a config with a removed key is REJECTED (unsettleable), never silently re-interpreted. This is correct money-safety behavior.
- **(should_fix — deferred since 2.2)** the unknown-key-on-greenie/net-skins validator gap (a direct caller bypassing Zod with a stray key on greenie/net-skins isn't loudly rejected — zero money impact, those modifiers ignore unknown keys; Zod `.strict()` covers production).
- **(reminder for Story 2.5)** gross-birdie must re-add its own end-to-end gross-consumption test (the polie gate's gross-threading test was removed with the gate).

### File List

New: `apps/tournament-api/src/engine/games/__fixtures__/polie-counts-regardless.json`
Removed: `apps/tournament-api/src/engine/games/__fixtures__/polie-bogey-or-better.json`
Edited: `modifiers/polie.ts` (pure count), `modifiers/polie.test.ts` (count-only tests + behavior-change + no-variant fail-closed), `types.ts` (remove lever + gross JSDoc), `config-schema.ts` (remove lever), `registry.ts` (merge polie+sandie no-lever branch; remove dead cross-rejections), `polie.golden.test.ts` (swap fixtures, drop gate-contrast), `games.property.test.ts` (polie arb no lever), `services/games-money.polie.test.ts` (count-only end-to-end), `modifiers/sandie.test.ts` (drop obsolete polieBogeyOrBetter test), `__fixtures__/polie-anything.json` (doc text only). All `apps/tournament-api/**`.
