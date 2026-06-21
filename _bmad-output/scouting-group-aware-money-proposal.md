# Group-Aware Money — odds model proposal (Phase 2)

Status: **REVIEWED — Design A rejected.** Adversarial review (Fable) + code verification killed Design A. Path forward: a cheap pre-test regression first; build the one-parameter tilt (A′) only if it passes; gate on paired Δlog-loss.

## Review outcome (2026-06-10)

Two facts in the original draft below were WRONG (verified against code):

- **Money is EXACTLY zero-sum within a group**, not "plus small external pots." The batting-order correction tx rolls back on `|groupSum| > 0.001` (rounds.ts:1063-1065). ⇒ a table-based design must sample a _joint_ historical group money vector, never independent per-position marginals (which would recreate the impossible "all four win money" sims).
- **Money settles on NET / handicap-adjusted scores**, not "the money half is not equalized." `recalculateMoney` → course handicap → play off low man → net scores into `calculateHoleMoney`/bonuses (rounds.ts:128-173). ⇒ the differentiating money-skill spread is small (residue = wolf-call strategy + bonus capture + handicap lag, the last already in stableford).

Why Design A is rejected:

- Within-group **stableford-rank key** inherits the equalization problem that killed tee form and **erases the personal money-history signal** — the model's primary edge — flattening the board (likely worse log-loss).
- **Breaking the paired (stableford, money) draw** removes a real positive correlation (both from the same net scores) → thins tails → inflates favorites / crushes longshots → worse upset-week log-loss. Directional bias.

### Path forward

1. **Pre-test (kill-test) first — before any model code.** Leave-future-out regression on history: `money_total_i,r ~ ownMoneyStrength_i,<r + meanGroupmateStrength_-i,<r`. If the groupmate coefficient is ≈0 or sign-unstable across seasons, the idea is dead at the source (same as tee) and we never touch the simulator. ~half a day.
2. **If it passes, build Design A′ (one parameter), not the rank→money table:** keep `computeOddsLine`'s paired draw byte-for-byte and apply an affine tilt to the drawn money:
   `money_i' = money_i(drawn) − λ · (meanGroupmateMoneyStrength − fieldMeanMoneyStrength)`, with λ = the regression's groupmate coefficient. Preserves the paired coupling, personal marginals, an ≈zero-sum within-group tilt; needs no calibration table; degrades to exactly v1 when λ̂≈0.
3. **Ship gate = PAIRED per-week Δlog-loss** (v2−v1 on identical weeks), bootstrap CI of the _difference_ excluding 0; mean Δ ≤ −0.03 nats; ≥60% weeks improved; Brier no worse. (Two separate CIs won't separate at n≈15-35 weeks — wrong test.)
4. **New failure mode to handle:** group membership becomes an odds input, and admins can edit groups/batting order up to (and in) the round. Live pre-round line must key on pairings-as-of-open or re-open on group edit. (Finalize snapshot is unaffected.)

Higher-yield aside: the hand-set `SHRINKAGE_PSEUDO_ROUNDS: 8` / `RECENCY_HALF_LIFE: 4` (odds.ts:60-61) were never backtested — a small grid search over them against the new harness is cheaper than any group-aware build and is detectable at n≈20 weeks.

---

_Original draft below (contains the two corrected errors; kept for the record)._

Status: **DRAFT for adversarial review.** Ships only if it beats the persisted baseline on log-loss/Brier (`src/scripts/backtest-odds.ts`).

## Verified facts (the design rests on these)

1. **Money is generated WITHIN the foursome.** `wolf_decisions` records per-hole wolf calls, partners, bonuses (greenies/polies), and win/loss/push **per `group_id`** (schema.ts:333). `round_results.money_total` is each player's net from that within-group wolf/skins game. Within a group it is ~zero-sum (a betting game among the 4, plus small external pots: skins carry-overs, greenies/polies).
2. **Money is SCORED field-wide.** `computeAndStoreHarvey` (admin/rounds.ts:125-158) ranks `money_total` across **all** players in the round via `computeRanks`, not within group. Harvey money points come from that field-wide rank.
3. **Net Stableford is handicap-equalized per tee** (`calcCourseHandicap`, course.ts:14-17) — members are engineered to be roughly even on the stableford half.
4. **Current odds model** (`computeOddsLine`, engine/src/odds.ts): each of 20k sims draws, for every player **independently**, one of their own past `(stableford, money)` rounds (recency-weighted + shrinkage), then ranks the field with the real Harvey ranker; win = argmax combined points over members.

## The flaw group-awareness fixes

The model draws each player's money as an **independent personal attribute** and ranks it field-wide. But a player's money this week is structurally a function of **who they're paired with** (known at line time):

- Strong money player among 3 weak groupmates → takes most of the group's money → high field-wide money rank.
- Same player in a shark-tank foursome → money is split among strong rivals → lower money.

The current model is blind to this. It will draw the same money distribution for a player whether they're the clear best in their group or the weakest — so the money half of the line ignores the one structural, fully-observed input that differentiates it from a season money ranking. (Independent draws can also produce impossible sims where all four in a group "win money.")

## Proposed design (A) — within-group money allocation

Keep everything else identical. Change only how the **money** component of each sim is generated: instead of an independent personal draw, generate group-conditional money, then feed it to the unchanged field-wide Harvey money ranking.

Per sim, for each group in the target round:

1. Draw each player's performance as today (recency-weighted from their history) to establish **within-group order**.
2. Rank the group's players by a within-group key (candidate keys below).
3. Assign each a money value by sampling the calibrated distribution **money | within-group finish position** (1st…Nth) for their slot.
4. The resulting group-aware money totals flow into the existing field-wide money ranking (no change downstream).

This makes money group-conditional: a player ranks 1st-in-group more often when paired with weak players → draws "group-winner" money more often → higher expected money, and vice-versa.

### Calibration (from history)

For every historical finalized group-round: rank the group's players by the chosen key, record `(finishPosition → money)`. Aggregate across all groups/seasons into an empirical distribution of money per within-group position (optionally split by group size 3 vs 4). Sample from the distribution (not just its mean) to preserve variance.

Estimated sample: ~4-6 groups/round × ~15-20 rounds/season ≈ 60-120 group-instances/season × multiple seasons → adequate for a 4-bucket conditional (far better than the per-tee slices that killed the tee idea). **To verify against the real DB.**

### Open decisions (for review)

- **Within-group key.** (a) drawn net stableford rank — natural, already drawn, but stableford is equalized so the rank is noisy; (b) the player's own **money-strength** (historical money mean/percentile) vs groupmates — models "the best money player in the group wins the pot" more directly; (c) a blend. Lean (b) or a blend.
- **Zero-sum normalization.** Calibrated per-position money won't sum to zero per group (external pots exist). Enforce sum-to-pot, or leave unnormalized and let the field-wide rank absorb it? Lean: leave unnormalized for v1, measure.
- **Correlation with stableford.** A player's drawn stableford and group-aware money should stay positively correlated (good rounds tend to win money). Does sampling money by position break the within-player stableford↔money coupling the current paired draw preserves?
- **Subs.** Subs are rank-fillers; they still occupy a within-group slot and absorb money. Keep them in the allocation but never emit a line (as today).
- **Determinism.** Weights/sampling only, seeded from `roundId` — must stay byte-identical per read.

## Alternatives considered

- **(B) Keep personal money draw, scale by group strength** vs the groups the player historically played in. More assumptions, indirect; harder to defend.
- **(C) Simulate the actual wolf/skins game** from drawn hole-level performances + a wolf-call policy. Most principled, far too heavy for v1 (needs per-hole draws + a calling model), and the call policy is itself unmodeled.

## The crux (the question that decides this, à la the tee idea)

Does conditioning money on group composition add **real predictive signal**, given that (a) net stableford is equalized so within-group ordering is noisy, and (b) wolf money has a large call/luck component? Group-dependence is structurally real, but "real structure" is not the same as "improves out-of-sample prediction." **The backtest is the arbiter** — this must beat the persisted v1 baseline on log-loss/Brier (held-out weeks) or it does not ship, same discipline that killed the tee feature.

## Plan if it survives review

1. Build the calibration query + the group-aware money draw behind a model flag.
2. Backtest candidate vs baseline (`backtest-odds.ts`) on real history; require a clear log-loss/Brier improvement with CI separation.
3. Only then wire it in, bump `ODDS_MODEL_VERSION`, and re-snapshot is NOT retroactive (frozen lines stay frozen; new model applies going forward).
