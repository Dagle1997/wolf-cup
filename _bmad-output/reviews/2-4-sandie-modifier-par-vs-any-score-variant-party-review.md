# Party-Mode Written Review — Story 2.4: Sandie Modifier (pure count, no gate)

**Mode:** Single non-interactive written review (no open questions). Perspectives: Analyst, Architect, PM, QA, Dev.
**Subject:** F1 Epic 2, Story 2.4 — the simplest claim modifier (a gate-less polie).
**Prior gate:** Dual-model impl review (codex gpt-5.2 + gemini-pro, high) → synthesis **SHIP**, `must_fix=None` (3 codex Lows, all optional; the one worth doing was folded).

---

## 📊 Analyst (Mary)

This story is most notable for a **mid-flight model correction the user drove, and the implementation honored.** The epics drafted a gross `par_or_better` vs `any_score` gate; the user realized — correctly, and citing the spirit of **FR16** — that an engine-enforced score gate is redundant and against the design: the scorer is the rule engine (they don't check "sandie" unless the player earned it), and re-validating in software would **silently void a human-entered claim**. The shipped sandie is therefore a **pure count**: anyone can get one, all four → 0, a team gets +2 when both teammates have one and neither opponent does. That's exactly the real game. The "par-or-better / up-and-down" wording correctly becomes **Rules-Sheet documentation (Story 2.7)**, not money logic. No modeling gaps.

---

## 🏛️ Architect (Winston)

**The cleanest modifier in the epic.** sandie is a stateless per-hole count folded into `pts` exactly where greenie/polie fold — before the `pts===0` short-circuit, so a sandie-only hole settles and an all-push hole stays inert (empty edges, free). The `pts*(pv/2)` split is untouched (NFR-C7). Crucially, the simplification *removed* surface area: **no `types.ts`/`config-schema.ts` change (no variant), no `games-money.ts` change (no gross)** — the change set is just `registry.ts` + `compute-foursome.ts` + the new resolver/tests. That's the right footprint for "count the boxes."

**Fail-closed is actually stronger here:** because sandie has zero valid levers, the registry rejects **any** non-empty variant (known or unknown key) — strictly more fail-closed than greenie/polie's allow-list, and the correct rule for a lever-less modifier. The self-guard on `sandiePoints` keeps parity with `poliePoints`. No structural concerns.

---

## 📋 PM (John)

**AC coverage (AC1–AC11):** all satisfied for the reworked pure-count model. Golden-first (NFR-C1) with Josh's manual ratification; count model incl. the all-four-→0 case; all-push → empty edges; order-independence; the no-variant fail-closed allowlist. Scope held tight: engine-only, no service/schema/UI.

**Process:** the spec was reworked **twice** (gated → pure-count) as the user clarified intent, each rework fully re-reviewed before the gate. The deferred **polie-gate-strip** follow-up is logged (user agreed), and the Rules-Sheet/pills work is correctly attributed to Story 2.7. Followups (self-guard intentional; symbol-key theoretical) are logged, not smuggled.

---

## 🧪 QA (Quinn)

**Coverage is complete for a pure-count money modifier:** 2 goldens (count incl. 1/2/contested/all-four + all-push) + golden-gate; 20 resolver unit tests incl. B-team sign, foreign-key isolation, incomplete-hole, segmented-PV valuation, every fail-closed reason string (incl. an **unknown** variant key), the present-but-disabled boundary, and inert; a **non-tautological additivity property** (all four players, shuffle-invariant). The full suite is 1354 green; Epic-1/greenie/polie goldens are byte-identical (sandie inactive ⇒ zero change), which is the regression that matters.

**No gaps that block.** The two remaining codex Lows are an intentional self-guard and a JSON-context-only theoretical key edge.

---

## 👷 Dev (James)

Clean, idiomatic, mirrors polie minus the gate. Pure functions, integer discipline, stateless, self-guarded resolver, hoisted active-check. The `exactOptionalPropertyTypes` cast wrinkle in the unknown-key test was caught and fixed. typecheck + lint clean. The fail-closed `Object.keys(variant)[0]` reason string is a tidy way to surface the offending key.

---

## 🎯 Consolidated Verdict

**SHIP.** Meets AC1–AC11, the count math is golden-gated + additivity-proven, fail-closed is genuinely strict, base/greenie/polie money is byte-identical, and the model faithfully reflects the user's FR16-grounded "just count the boxes" decision. No blocking gaps, no open questions. Recommend proceeding to commit (flag OFF, local only). The polie-gate-strip follow-up remains queued.

---

### Evidence (concrete artifacts backing every claim above)

- **Count model / sign / boundary / fail-closed:** `apps/tournament-api/src/engine/games/modifiers/sandie.test.ts` (20 tests — 1/2/contested/all-four, B-sign, foreign-key, incomplete-hole, segmented-PV, present-but-disabled, every `unsupported_sandie_variant:<key>` incl. an unknown key).
- **Golden (NFR-C1 money values) + order-independence:** `apps/tournament-api/src/engine/games/sandie.golden.test.ts` over `__fixtures__/sandie-count.json` (+$10/side, $20) + `sandie-all-push.json` (empty edges).
- **Additivity property (non-tautological, all four, shuffle-invariant):** `apps/tournament-api/src/engine/games/games.property.test.ts`.
- **Wiring + fail-closed registration:** `apps/tournament-api/src/engine/games/compute-foursome.ts` (fold before `pts===0`) + `registry.ts` (registerModifier('sandie') + no-variant branch).
- **Base/greenie/polie byte-identical + whole suite:** `pnpm --filter @tournament/api test` → 1354 passed / 0 failed; `pnpm -r typecheck` + lint clean.
