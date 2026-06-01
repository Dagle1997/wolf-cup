# Adversarial Review — Scouting Harvey-Win-Odds Tech-Spec

**Date:** 2026-06-01
**Spec:** `_bmad-output/implementation-artifacts/tech-spec-scouting-harvey-win-odds.md`
**Reviewers (ensemble):** BMAD adversarial-general (info-asymmetric subagent, repo read access) + codex (gpt-5.5, high reasoning, quantitative adversary)
**Headline:** Both reviewers independently flagged the subs-exclusion equivalence claim (Critical) and the proportional-vig "sharp/value" test as vacuous (High). The spec's "ready-for-dev" status is revoked pending fixes to F1–F6.

| ID | Severity | Validity | Finding |
|----|----------|----------|---------|
| F1 | Critical | Real (proven, both reviewers) | **"Subs excluded = argmax-equivalent" is FALSE.** Harvey points are rank-based over the FULL field (incl. subs); removing a sub adds a per-member, non-uniform delta (`#subs below i` in each of stableford & money), which CAN reorder the member-vs-member combined-points argmax. Codex gave a 3-member/3-sub counterexample where member-only winner = A but full-field top-member = B. The bet, model, and retrospective all rest on this. **Fix:** simulate subs IN the rank field (drawn from baseline since thin history) so member Harvey points match production; only members are eligible to win. |
| F2 | Critical | Real | **Settlement undefined when a sub actually wins overall.** `harvey_results` is written for subs (no `isSub` filter in `computeAndStoreHarvey`), so the retrospective's "actual winner" can be a sub. Spec hand-waves to `busted`. Define precisely: bet = top MEMBER; a sub-overall-win settles on the top member (not auto-bust/void), or the market is void — pick one and price to it. |
| F3 | High | Real (both) | **"Sharp/value" stress test is vacuous under proportional vig.** Posted `q_i = λ·p_i` with λ>1 ⇒ `p_i > q_i` is impossible for all i ⇒ the value-bettor scenario selects the empty set every week and reports zero. **Fix:** give sharps an INDEPENDENT estimate `r_i` (bet when `r_i > q_i`), or use a margin-weighted vig (Shin/odds-ratio), or drop the scenario. |
| F4 | High | Real | **Public-proportional P&L is circular — proves balanced-book arithmetic, not model quality.** Bettors ∝ posted implied ⇒ stakes ∝ p_i ⇒ payout = H/λ regardless of who wins ⇒ guaranteed hold even with garbage probabilities. Does NOT demonstrate real-world profitability. **Fix:** adversarial/realistic handle (favorite bias, longshot chasing, overlay concentration); report P&L variance, P(weekly loss), drawdown, worst-case liability — not just expected hold. Add an AC asserting house behavior, not just determinism. |
| F5 | High | Real | **Determinism ignores roster churn.** The upcoming round's roster (the field) is edited via add/remove/sub-swap endpoints up to round day; each edit re-prices the line. Spec only acknowledged prior-round score corrections as a re-price vector. The line meaningfully "freezes" only once pairings are locked — state this. |
| F6 | High | Real | **Field source undefined for the default (upcoming) round before pairings exist.** Existing endpoint returns empty groups when no roster (`scoutedIds.length === 0`). Spec says "member field" as if obvious. Define: odds open only once pairings are posted; before that, "line opens when pairings are set." |
| F7 | High | Partial | **Bonus argmax-invariance** asserted, but production `harveyBonus` keys on full-field size (incl. subs) vs sim members-only. Dissolves once F1's fix includes subs (field sizes align); flag as dependent on F1. |
| F8 | Medium | Real | **Calibration is low-power and baseline-free.** Brier over ~16 members with one winner is dominated by near-zero loser terms (looks good regardless); winner-only log-loss is noisy; reliability mixes vig'd buckets with fair outcomes. Need baselines (uniform 1/N, handicap-only, prior-week naive) + confidence intervals + a pass/fail threshold. Calibrated fair-p does NOT prove vig profitability. |
| F9 | Medium | Real | **MC error vs "byte-identical" = false precision near favorites.** 10k sims give ~±0.5% SE at p≈0.1 (worse, relatively, on longshot tails, amplified in American odds). Pricing finer than the error band near favorites is false precision. Bound adjacent-favorite gap vs error band; raise SIM_COUNT or smooth/analytic for tails. |
| F10 | Medium | Real | **TBD constants but marked ready-for-dev.** `RECENCY_HALF_LIFE` = "TBD", `wideOpen` threshold undefined, `OVERROUND` a range not a value, `LONGSHOT_CAP` missing from the constants list. AC-A5 is untestable without a numeric threshold. Resolve before dev. |
| F11 | Medium | Real | **Hold mislabeled.** "The overround is the hold" is wrong; expected hold = `1 − 1/λ` ≈ 13.0–16.7% for λ=1.15–1.20, not 15–20%. Fix the disclosed math. |
| F12 | Medium | Real | **Tie handling must match settlement & threatens determinism.** 1/k sim split only correct if settlement is dead-heat fractional; many ties likely (integer Stableford, zero-money). Also double-handled (`rankScores` already half-point-averages). Float exact-tie detection risks cross-platform byte-identical drift. |
| F13 | Medium | Real | **`validateHarveyTotal` throws inside the hot sim loop** (SIM_COUNT × weeks calls). A degenerate simulated field (float drift) tripping the invariant would 500 the entire additive scouting response, taking down the existing groups/rivalry/luckyCharm payload. Bypass/guard validation in the sim path. |
| F14 | Medium | Real | **Money comparability across weeks.** Bootstrapping raw dollars from different pot sizes / side-game formats / participation reranks incomparable values. Clarify whether the sim bootstraps raw vs rank, and normalize money across weeks. |
| F15 | Medium | Real | **Zero-prior-rounds member in a gated-open field** isn't addressed: priced at pure baseline (no signal) yet still gets a price/tier. The "—" threshold is undefined and has no AC. |
| F16 | Medium | Real | **Handicap anti-persistence / double-counting.** Strong recent net rounds trigger handicap cuts; using them directly double-counts form and ignores the correction. Recency weighting may overweight exactly the handicap-trigger rounds. Consider modeling gross + handicap history rather than raw net. |
| F17 | Low | Real | **Self-consistency cross-check is circular** — same tuples, same Harvey function, no resampling ⇒ catches only gross coding errors, not the modeling-assumption risks (subs, money anti-correlation) it's sold to guard. Use a genuinely independent estimator (handicap-only / prior-week naive). |
| F18 | Low | Real | **Ledger recompute cost un-benchmarked.** ~200k engine invocations per read; per-request memoization doesn't help across the many users on the current-round tab. No response-time AC; the "<100ms" estimate is unverified. |
| F19 | Low | Real | **Rounding can create accidental overlays / invalid odds.** Re-verify `q_i ≥ p_i` after American rounding; guard `q_i ≥ 1` for big favorites (`p_i ≥ 1/λ`). |

---

## Round 2 — Re-review after fixes (2026-06-01)

Both reviewers (BMAD adversarial-general + codex, independently) **confirmed the criticals are dead**.

**Resolved:** F2, F3, F5, F6, F7, F8, F9, F10, F11, F12 (claim verified true — BMAD brute-forced 200k fields; combined points always multiples of 0.5), F13, F15, F17.
**Resolved as approximation (gated):** F1 — subs as pooled-class rank fillers + argmax-over-members is structurally correct; the pooled prior is an approximation, gated on the Task 14 flip-rate (>5% ⇒ escalate sub modeling).

**New issues surfaced in round 2, now addressed:**
- **NEW-1 (High):** "realistic public" was non-deterministic as written → **PINNED** (`softmax(PUBLIC_FAV_BIAS × recent-form z)`, multinomial off the bettor seed stream, **never reads posted odds** — closes the re-circularity risk codex warned about).
- **codex cap/vig (Med):** `LONGSHOT_CAP` distorts the margin → ledger now reports **effective hold recomputed from posted prices after caps**, not nominal `1−1/λ`.
- **OOS power (Med):** ~20-round season is low-power → calibration reports **bootstrap CIs + paired week-level diffs**.
- **NEW-2 (Med):** pooled subs graded vs actual sub scores = standing sensitivity → folded into Task 14 as a standing check.
- **NEW-3 (Low):** sub-prior is a new unfiltered query → flagged in Task 5.
- **NEW-4 (Low):** F12 exact-equality precondition (multiplier=1, bonus=0) + defensive `2×`-int compare documented.

**Outcome:** spec promoted to `ready-for-dev`. Remaining open items (F14, F16, F18, F19) are non-blocking documented dev-time considerations.
