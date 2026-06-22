# Party-Mode Written Review — Story 2.2: Greenie Modifier (Stateful Carryover)

**Mode:** Single non-interactive written review (no open questions). Perspectives: Analyst, Architect, PM, QA, Dev.
**Subject:** F1 Epic 2, Story 2.2 — first stateful, money-bearing modifier in the tournament engine.
**Prior gate:** Dual-model impl review (codex gpt-5.2 + gemini-pro, high) → synthesis **SHIP**, `must_fix_before_send = None`, after two fail-closed hardening fixes.

---

## 📊 Analyst (Mary)

**Does it model the real-world game the group plays?** Yes. The model matches the ratified mental model: the *software's only job* is the per-player greenie checkbox on par-3s; closest-to-pin / green-in-reg / 2-putt remain human judgments (FR16, accepted-as-entered). Count-based `rawA = #A − #B` correctly captures "both teammates inside both opponents → team wins two greenies (+2)," and the automatic carryover (unclaimed par-3 rolls 1 to the next par-3; winner sweeps) is the lever Josh chose 2026-06-22.

**Concern raised + resolved:** the *contested* case (boxes on both teams, rawA=0) cannot occur in real play (closest-to-pin has a clear winner). The implementation keeps it as a **defensive accepted-as-entered rule** (award 0, pot preserved) so malformed input can never move money — this is the right call: model the happy path, fail safe on the impossible one.

**Verdict:** Faithful to the domain. No modeling gaps.

---

## 🏛️ Architect (Winston)

**Layering is clean and consistent with Epic 1's contracts:**
- The stateful fold lives in `modifiers/greenie.ts` (by-concern location, mirrors `net-skins.ts`), NOT inside the per-hole stateless `holeNetPointsA` — correct, because carryover is cross-hole.
- `compute-foursome.ts` folds greenie points into the existing `pts` *before* the `pts===0` short-circuit and reuses the unchanged `pts*(pv/2)` 4-cross split (NFR-C7 — the split path is not forked). Valuation-at-collecting-hole falls out naturally because the point is added at that hole's `pointValueCents`.
- Carry is tracked in integer **points**, never cents — the right invariant; it makes "swept pot valued at the collecting hole" exact and avoids cent-rounding drift.

**The AC8 BARRIER (break-not-filter) is the load-bearing architectural decision** and it is correct: filtering an incomplete par-3 would let a later complete par-3 bridge the gap and *retroactively materialize/vanish money* when the gap fills. Breaking freezes the carry and defers all later par-3s — monotonic, recompute-on-read safe. The **dense-holes precondition** (service builds holes from `siByHole.keys()`) is the necessary counterpart, and it is base-money-neutral because the base complete-cell gate already skips empty-net rows. The DB-backed test proves the distinction (a1 nets 0 with the gap open, +1500 once filled — sparse would have wrongly bridged to +1000).

**Fail-closed posture:** the per-modifier variant allowlist + the two added guards (carryover-type, non-object-variant-shape) keep `validateResolvedConfig` coherent as `computeFoursome`'s standalone guard. Residual hardening (strict `m.enabled` boolean, unknown-key rejection inside object variants) is correctly deferred — those are general engine concerns pre-existing since Story 1.1 and fully covered by Zod in production.

**Verdict:** Architecturally sound. No structural concerns.

---

## 📋 PM (John)

**AC coverage (AC1–AC12):** all satisfied.
- AC1 golden gate: 3 hand-approved fixtures (carryover-on, carryover-off identical-inputs lever proof, two-on-one-hole) authored FIRST, green before resolver merge.
- AC2–AC5 registry/count contract; AC6 carryover rules (won-sweeps / unclaimed-rolls / contested-preserves); AC7 valuation; AC8 barrier; AC9 order-invariance; AC10 conservation property; AC11 fail-closed + terminal-carry-zero; AC12 scope guard (tournament paths only).
- Scope discipline held: no route, no migration, no new UI (Story 2.1 already ships the checkbox). The only service change is the narrowly-scoped dense-holes array.

**Process note (good):** the spec carried money values under NFR-C1; auto-approve was correctly disabled and the spec was manually Josh-approved. The edge-representation deviation (goldens authored against the post-2.1a whole-dollar 1-to-1 layout, not the spec's stale 4-leg hand-calc text) was the *documented resume intent* and per-player nets/totals are byte-identical — surfaced transparently, not silently.

**Verdict:** Ships the agreed scope. Followups logged, not smuggled.

---

## 🧪 QA (Quinn)

**Test coverage is strong for a money modifier:**
- Goldens (3) + golden-gate-through-the-live-chokepoint (existing Story 1.4 gate re-runs Epic-1 fixtures through the dense-holes path → base money byte-identical).
- Unit edges: count model (1/2/contested-pot-preserved), carryover ON accumulation + OFF expiry, winner-sweep-multi (+4), B-team sign-symmetric sweep (−3), non-par-3 skip, foreign-key isolation, incomplete-par-3 barrier (deferred → released), value-at-collecting-hole (segmented PV), terminal-pending-carry → 0 money, inert (absent/disabled), and both fail-closed variant rejections.
- Property: carry-conservation is **non-tautological** (LHS from surfaced fold state, RHS re-derived independently from raw holes) — this is the right way to test a conservation law. Order-independence + loss-less/zero-sum + isolation extended to greenie-active and still green.
- DB-backed service test proves the dense-array barrier end-to-end (the most important money test in the set).

**Gaps I checked for and found acceptable:** the 4-leg→2-leg edge representation is covered by asserting exact `edges` in the goldens against the live `ledgerToEdges`. The known T10-2/T10-3 lifecycle flake is unrelated (passes 24/24 in isolation; zero lifecycle code touched).

**Verdict:** No coverage holes that block. The conservation property + DB barrier test are exactly what a stateful money fold needs.

---

## 👷 Dev (James)

**Implementation quality:** pure functions, integer-cents/integer-points discipline, stable `holeNumber` sort, no Date/random/DB in the engine. The fold's early returns and the `break` (not `continue`/`filter`) are exactly per AC8. `greenieActive`/`greenieCarryover` mirror `netSkinsActive`. The two review-driven fixes are minimal, in the right file, and tested.

**Nits (non-blocking, already deferred to a followup story):** strict `m.enabled` typing, unknown-key rejection in object variants, `par ?? 0` → fail-closed throw (unreachable today), and asserting the dense-holes precondition at the fold boundary for hypothetical direct callers. All theoretical for the Zod-validated production path.

**Verdict:** Clean, idiomatic, matches the surrounding engine code.

---

## 🎯 Consolidated Verdict

**SHIP.** The implementation meets AC1–AC12, the money math is conservation-proven and golden-gated, the AC8 barrier + dense-holes change are correct and base-money-neutral, and the fail-closed posture is coherent. No blocking gaps, no open questions for the user. Deferred items are genuine defense-in-depth followups, not regressions or scope gaps. Recommend proceeding to commit (flag OFF, local only).
