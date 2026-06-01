# Wolf Cup — Fairness & Money-Correctness Audit

**Date:** 2026-06-01
**Trigger:** Ball-draw bias bug (fixed `dc9f8e0`, 2026-05-30) raised the question: *what else might be wrong, and can the app be trusted?*
**Scope:** Two axes — (1) randomness/fairness, (2) scoring & money correctness.
**Posture:** Evidence-first. Findings below are backed by code references, a full test run, and an independent re-derivation against the real production database.

---

## Verification posture (read this first)

- **If the money were wrong, who would have caught it?** Every round settles in cash at the table among 4 players, and Matt Jaquint actively checks per-hole math. A systemic money error would have surfaced as people not balancing. The audit confirms why they balance: every round is exactly zero-sum.
- **What this audit proves:** arithmetic integrity (zero-sum), that the *paid* numbers exactly equal what the current engine computes, and that three independently-written computation paths agree to the dollar on every real round.
- **What it does not prove:** the per-hole *rules themselves* match the league's intent. All three paths share the engine's rule definitions. Rule correctness rests on the 1018-test suite (many asserting hand-computed hole outcomes) plus real-world validation — not on re-deriving the rulebook from scratch here. This is stated honestly rather than overclaimed.

---

## 1. Baseline — test suite

`pnpm test` (engine + api), 2026-06-01:

- **engine: 492 passed** (13 files)
- **api: 526 passed** (27 files)
- **Total: 1018 passed, 0 failed** (exit 0). Web suite is separate.

---

## 2. Randomness / fairness sweep

Swept the entire codebase for anything that decides an outcome by chance (`Math.random`, `sort(() => …)`, shuffles).

| Location | Use | Status |
|---|---|---|
| `apps/web/.../ball-draw.tsx` → `@wolf-cup/engine` `shuffle` | Batting order | **FIXED.** Now Fisher–Yates (`packages/engine/src/shuffle.ts`) + a regression test that runs 60,000 shuffles and fails the build if any slot drifts off 25% (`shuffle.test.ts`). |
| `packages/engine/src/pairing.ts:92-95` | Group pairing randomization | **Already correct** Fisher–Yates. No bias. |
| `apps/web/.../stats.tsx:322` | Which highlight slide shows first | Cosmetic. No fairness impact. |
| `apps/api/.../seed-*.ts`, tournament tokens | Dev seed scripts / `crypto.randomBytes` security tokens | Non-production / correct-by-design. |

**Conclusion:** the ball draw was the *only* fairness-affecting randomness bug. It is fixed and is now the most-tested function in the app. The class of bug (non-uniform shuffle) cannot recur silently — the regression guard would fail CI.

---

## 3. Money model (how a dollar is computed)

Pipeline, all in `@wolf-cup/engine` + `apps/api`:

1. **Course handicap** — `calcCourseHandicap(HI, tee)` = `round(HI × slope/113 + (rating − 71))`, slope-aware per tee (`course.ts`).
2. **Relative strokes** — each group plays off the low man: `relCH = CH − min(CH in group)`; per-hole strokes via stroke index (`stableford.ts getHandicapStrokes`).
3. **Per-hole money** — `calculateHoleMoney(net, assignment, decision, par)` (`money.ts`): skins holes (1,3) = individual skin; wolf holes = 2v2 (low ball / skin / team total) or 1v3 (group, wolf ×3, optional blind bonus). **Validated zero-sum per hole.**
4. **Bonus skins** — `applyBonusModifiers` (`bonuses.ts`): score-based birdie/eagle/double-eagle competitive skins + greenies/polies/sandies. **Validated zero-sum.**
5. **Persistence** — `recalculateMoney()` (`rounds.ts:81`) sums per-hole totals and writes `round_results.money_total` (whole dollars, `schema.ts:286`). A separate read-only aggregator `computeRoundMoneyBreakdown()` (`money-breakdown.ts`) drives stats.

`$1 per point.` Subs settle normally in the per-round cash (they appear in the zero-sum); the "subs don't earn" rule is a *season-standings* bucketing concern, not a per-round cash one.

---

## 4. Independent re-derivation + 3-way reconciliation (the core check)

**Method.** Pulled a consistent, read-only snapshot of the production DB (`VACUUM INTO`, integrity_check = ok). Wrote an independent money aggregator from scratch over the engine's pure primitives (`_audit_reconcile.ts` — own group/hole iteration, own relative-CH, own summation). For each finalized round, computed every player's money **three ways** and compared:

1. **PERSISTED** — `round_results.money_total` (what was actually paid)
2. **APP-STATS** — `computeRoundMoneyBreakdown()` (the stats aggregator)
3. **INDEPENDENT** — this audit's from-scratch assembly

**Data.** All 6 finalized 2026 rounds (33, 41, 42, 43, 44, 47) — 76 player-rounds, 1368 hole scores, including 4 sub appearances (rounds 42/43/44). Historical seasons (2015–2025) hold imported aggregates only (no per-hole data) and are not re-derivable.

**Result:**

```
==== ALL THREE PATHS AGREE on every player, every round ====
```

- Exact integer match across all 76 player-rounds, all three methods.
- **Every group and every round sums to exactly $0** (no money created or destroyed).
- Round 41 — which was manually patched in the DB after the late-April engine fixes — now reconciles cleanly against a fresh current-engine recompute, confirming the manual patch was applied correctly.

**Hand-trace (largest-detail spot check).** Round 47, Group 103, Hole 8 (par 5, SI 7, white tee), Ronnie partners Kyle vs Matt White + Scott. Verified by hand: stroke allocation (Scott/Kyle +1, Ronnie/Matt 0), nets (Kyle 3 / Ronnie 5 vs Matt 4 / Scott 7), low ball + team total + skin all to the winning team (±3), plus Kyle's net eagle on the par 5 driving a +2 competitive bonus skin → ±5, zero-sum. Matches the engine to the dollar.

---

## 5. Findings

**No defects found.** No money discrepancy, no zero-sum violation, no second instance of the shuffle-class bug.

**Honest limitations:**
- Rule *semantics* are validated by the test suite + real-world play, not re-derived from an external rulebook (see posture note).
- Re-derivation covers 2026 rounds only (the only rounds with per-hole data). Pre-2026 money is imported and was not independently recomputed.

---

## 6. Reproduce

```bash
# read-only snapshot already at _audit/wolf-cup-prod.db (integrity ok)
cd apps/api
DB_PATH="<repo>/_audit/wolf-cup-prod.db" npx tsx src/scripts/_audit_reconcile.ts   # 3-way reconciliation
DB_PATH="<repo>/_audit/wolf-cup-prod.db" npx tsx src/scripts/_audit_hole.ts        # single-hole hand-trace dump
```

*Audit scripts (`_audit_reconcile.ts`, `_audit_hole.ts`) and the DB snapshot are throwaway artifacts under `_audit/` and `apps/api/src/scripts/` — not for commit.*
