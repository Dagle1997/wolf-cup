# Party-Mode Review — Story 3-3 (Per-hole F1 money on the during-round scorecard)

**Mode:** non-interactive consolidated written review (no open questions to the user).
**Date:** 2026-06-23 · **Verdict:** SHIP (no blocking concerns; documented followups only).

Five perspectives reviewed the implementation against the story ACs and the actual diff.

---

## 📊 Analyst (Mary)

**Does it deliver the user value?** Yes. The during-round board now shows the one number the group actually argues about — *how much each hole is worth* — and it reconciles to the settled event money by construction (same pinned chokepoint). The Josh-ratified audience rule (event-wide, all joined participants see all players' money in money mode) matches how the Pete Dye group plays: everyone watches everyone's money.

**Scope discipline:** Strong. The story did the *minimum* money-bearing change (expose a decomposition the engine already computed and discarded) and explicitly deferred the two adjacent consumers (foursome-results, My-Money per-hole) rather than smuggling them into a golden-gated change. That is the correct call — those surfaces still show correct round-level money today.

**Risk to the brochure timeline:** Low. 3-3 is API/engine only; the brochure p4 needs 3-4 to wire a route. Nothing here blocks 3-4.

**No concerns.**

---

## 🏛️ Architect (Winston)

**Chokepoint integrity (pattern 16):** Preserved. Per-hole money is only ever produced inside `settleFoursome`/`computeFoursome` and surfaced through `computeF1PerHoleMoneyForPlayer`. No inline recompute, no second money path. The scorecard is a thin consumer.

**Additive engine change:** `Ledger.perHole` is optional in the type (so hand-built `Ledger` literals in `ledger-to-edges.test.ts` stay valid) but always populated by `computeFoursome`. Round totals (`cross`/`perPlayerCents`/`totalCents`) are untouched — proven by the existing goldens passing byte-identical. This is the right way to extend a money primitive.

**Money-safety invariant (AC2):** Honored and *strengthened*. The impl-review High (net display read a different course revision than the money) is now closed: when a pin exists, `buildPlayerScorecard` reads par/si from the **pinned** course revision (frozen) and the hole count from `event_round.holesToPlay` — the exact same inputs the money path uses (the course rev is *pinned*; holesToPlay is *live but shared* with the money path, and the two `holes_to_play` columns are equal by construction with no mutation path). So a post-pin course edit can't split the displayed net from the per-hole money. This is a genuine architectural improvement to the 3-2 net path, not just a 3-3 add.

**Layering / boundary (FD-1/FD-2):** Clean — tournament-api only. No `apps/web`/`apps/api`/`packages/engine` edits. The new `scorecard.ts → games-money.ts` import introduces no cycle (games-money doesn't import scorecard).

**One noted (non-blocking) item:** the scorecard read now triggers a per-foursome settlement (the perf Medium). Acceptable: the heavy path runs only after the `locked && f1MoneyEnabled` gate, so non-money rounds short-circuit cheaply. Documented as a shared-loading followup. **No blocking concern.**

---

## 📋 PM (John)

**ACs:** All eight are met and evidenced in the Dev Agent Record. AC1 (golden) was Josh-approved at the spec gate before any settlement code — the NFR-C1 hard gate was honored in sequence. AC5 (audience) was ratified by Josh with the event-wide clarification folded into the story.

**Decision log is intact:** the exposure model (locked-only public board, organizer not exempt while unlocked, My-Money separate) and the golden numbers are both recorded as ratified. Good auditability for a money feature.

**Followups are explicit and sized**, not hand-waved: per-hole fills for the other two surfaces, perf, and the operational "lock the event before the brochure shoot." **No concern.**

---

## 🧪 QA (Quinn) — *the most important seat for a money story*

**Test pyramid is complete and at the right layers:**
- **Engine golden** (hand-calc, the release gate): base-flat *with sign-cancellation* (A wins 4 holes, B wins 2) — this is the case that would have falsely "passed" the wrong abs-of-sum invariant, so it actively guards the loss-less proof. Plus greenie-carryover proving stateful attribution lands on the resolving par-3.
- **Engine structural unit:** incomplete hole → no row; settled push → explicit zero row; reverse-input determinism; per-player loss-less sum. Covers what the goldens (all-settled) don't.
- **Service chokepoint:** exposure on/off, locked/unlocked, non-F1, player-not-in-round, unsettleable→null, **and reconciliation with `computeF1PerPlayerNet`** (Σ per-hole map === round net) — the end-to-end loss-less proof through the DB.
- **Route integration:** money shown (locked+flag) matching the golden, null (flag off), null (unlocked), **settled push $0 preserved (not null)**, and the **pinned-rev divergence regression** (repoint event_round to a reversed-SI rev, assert the scorecard uses the pin).

**Edge cases I probed and found covered:** negative-zero on push rows (normalized + asserted); the `map.has()` vs `?? null` footgun (explicitly tested at the route via the push-$0 case); fail-closed isolation (missing/corrupt pin, missing handicap) returning null not 500.

**Gap I looked for and accept as deferred:** no test for the *deferred* surfaces (foursome-results / My-Money per-hole) — correct, since 3-3 doesn't touch them. The known full-suite `lifecycle-full.e2e` timeout is the documented load flake (passes isolated), not a regression.

**Verdict: exemplary coverage for a money-bearing change. No coverage hole that blocks.**

---

## 💻 Dev (Amelia)

**Code quality:** The engine change is a 12-line insert that records what was already computed; readable and well-commented on *why* it sits before the `pts===0` short-circuit. The `-0` normalization is the kind of thing that bites later — good that it's handled at the source and asserted.

**The helper** is defensive in the right order (cheap gates first: round → event config → exposure, then the heavy settle), so the common pre-launch path (flag off) costs ~2 queries. Fail-closed returns `null` everywhere money shouldn't show.

**The scorecard fix** is the highest-value change: sourcing par/si from the pinned rev makes 3-2's AC#4 consistency invariant ("net must equal money net") true *by construction* instead of by assumption.

**Followup I'd pick up next:** the perf shared-loading — fold the builder's and the money path's foursome reads into one pass. Not now; it's a Medium and the gate protects the hot path.

**No drift, no dead code, no boundary violation. Ship it.**

---

## Consolidated outcome

- **Blocking issues:** none.
- **Accepted/ratified decisions:** golden numbers (Josh), exposure model + event-wide audience (Josh).
- **Documented followups (not 3-3 defects):** perf shared-loading on the polled read; per-hole fills for foursome-results + My-Money; operational lock-the-event before the brochure capture.
- **Recommendation:** SHIP.
