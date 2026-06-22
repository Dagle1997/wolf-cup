# Party-Mode Written Review — Story 2.3: Polie Modifier (stateless, gross bogey-or-better)

**Mode:** Single non-interactive written review (no open questions). Perspectives: Analyst, Architect, PM, QA, Dev.
**Subject:** F1 Epic 2, Story 2.3 — the stateless claim-modifier sibling of greenie.
**Prior gate:** Dual-model impl review (codex gpt-5.2 + gemini-pro, high) → synthesis **SHIP**, `must_fix=None` (the lone Medium ruled redundant defense-in-depth by both critiques).

---

## 📊 Analyst (Mary)

**Faithful to the group's real game?** Yes, and it was corrected to Josh's exact model mid-flight: a polie is a made putt/chip longer than the flagstick, **un-detectable by software** → a per-player checkbox the scorer marks (accepted-as-entered, FR16). All four players can each have one; **each is worth 1 team point** (`rawA = #A − #B`), so equal polies net to $0 — consistent with every other team point. **Stateless** (no carryover), contested on **any** hole. The single real-world variable between groups — "must it be bogey-or-better?" — is captured as the one Y/N lever, on **gross** (Josh's explicit choice). No modeling gaps; the model is the group's game.

**Notable judgment:** Josh flagged that the group plays "net off the low," which the shipped base engine does NOT do (full-CH net). The story correctly **did not silently absorb** this — it's logged as a 🔴 HIGH pre-F1-launch investigation (it affects the base skin/net-skins thresholds, not polie, which gates on raw gross). That's the right call: surface, don't bury.

---

## 🏛️ Architect (Winston)

**Clean reuse of the greenie seam, minus the statefulness.** poliePoints is a per-hole pure function folded into `pts` exactly where greenie's per-hole points are, before the `pts===0` short-circuit — so a polie-only hole still settles, an all-push hole stays inert (the NFR-C4 adversarial falls out for free), and the `pts*(pv/2)` split is untouched (NFR-C7). Valuation-at-hole-PV is automatic.

**The one architectural addition — gross into the engine — is justified and minimal.** The engine carried net only; the gross gate needs gross. Threading `HoleState.gross` sourced **directly from raw `grossStrokes`** (never reconstructed from net) is the correct decision precisely because net is relative/off-the-low and non-invertible. Gross is read **only** by the polie gate; base game + greenie ignore it → base-money-neutral (the existing golden gate + service test (d) prove it). The service change mirrors the greenie dense-holes change in footprint.

**Fail-closed posture stays coherent:** the coercion-safe `isBogeyOrBetter` (finite-number guard before compare) + the registry allowlist (polie rejects foreign levers; greenie/net-skins reject `polieBogeyOrBetter`) extend the 2.2 pattern consistently. No structural concerns.

---

## 📋 PM (John)

**AC coverage (AC1–AC11):** all satisfied. Golden-first (NFR-C1) with Josh's manual ratification of the numbers; count model; gross gate with the gate-moves-money contrast ($10 ON vs $5 OFF); all-push → empty edges; order-independence; fail-closed allowlist; base-neutral service change. Scope held: engine + one service file, no route/migration/UI (Story 2.1 ships the checkbox).

**Process:** the spec went through a model correction (Josh reversed the "scope bogey-or-better out" decision and chose gross), a full re-review, and a 2-High Codex catch (coercion + service-test gaps) — both fixed before build. The expanded scope (gross threading) was surfaced and re-approved at the gate, not smuggled. Followups (off-the-low; optional gross guard) are logged, not lost.

---

## 🧪 QA (Quinn)

**Coverage is thorough for a money modifier:** 3 goldens (anything / bogey-or-better-with-money-moving-contrast / all-push) + golden-gate-through-the-chokepoint; 24 resolver unit tests including the **coercion edge cases** (null/NaN/string gross voided), foreign-key isolation, incomplete-hole, segmented-PV valuation, and every fail-closed reason string; a **non-tautological additivity property** (all four players asserted, shuffle-invariant); and — the most important — a **DB-backed end-to-end service test** proving the gross gate works through `computeF1PerPlayerNet` (eligible pays / double-bogey voids / gate-off counts / disabled neutral). That service test is exactly what closes the "silently void all gated polies" risk.

**Gap checked + acceptable:** the optional service-side type guard on `grossStrokes` — both reviewers' critiques ruled it redundant (integer column + arithmetic use + engine fail-closes). Logged as optional.

---

## 👷 Dev (James)

**Clean, idiomatic, mirrors greenie.** Pure functions, integer discipline, stateless (no fold), self-guarding `poliePoints` (returns 0 inactive) with the active check hoisted out of the loop. The signed-zero artifact in the property test was caught and fixed at the test layer (engine output was correct). typecheck + lint clean; full suite green.

**Optional followups (non-blocking, logged):** service-boundary finite-gross guard; the carried-over `parByHole ?? 0`. Both redundant today.

---

## 🎯 Consolidated Verdict

**SHIP.** Meets AC1–AC11, money math is golden-gated + additivity-proven, the gross gate is coercion-safe and proven end-to-end through the chokepoint, and base money is neutral. No blocking gaps, no open questions. The off-the-low concern is correctly externalized as a pre-launch base-engine investigation, not a polie blocker. Recommend proceeding to commit (flag OFF, local only).

---

### Evidence (concrete artifacts backing every claim above)

So the assertions are verifiable, not rhetorical (per the party-phase codex review):
- **Count model / sign / coercion edge cases:** `apps/tournament-api/src/engine/games/modifiers/polie.test.ts` (24 tests, incl. null/NaN/string-gross voided, B-team sign, all-four-nets-out, foreign-key, segmented-PV).
- **Golden gate (the NFR-C1 money values) + gate-moves-money + order-independence:** `apps/tournament-api/src/engine/games/polie.golden.test.ts` (5 tests) over `__fixtures__/polie-anything.json`, `polie-bogey-or-better.json`, `polie-all-push.json`.
- **Fail-closed allowlist (exact reason strings, cross-modifier rejection):** `polie.test.ts` "fail-closed variant allowlist" describe + `apps/tournament-api/src/engine/games/registry.ts` polie/greenie/net-skins branches.
- **Base-money-neutrality + end-to-end gross gate through the live chokepoint:** `apps/tournament-api/src/services/games-money.polie.test.ts` (4 DB-backed tests: eligible pays / double-bogey voids / gate-off counts / disabled base-neutral) + the unchanged Story 1.4 golden gate.
- **Additivity property (non-tautological, all four players, shuffle-invariant):** `apps/tournament-api/src/engine/games/games.property.test.ts`.
- **Whole suite:** `pnpm --filter @tournament/api test` → 1331 passed / 0 failed; `pnpm -r typecheck` + `pnpm --filter @tournament/api lint` clean.
