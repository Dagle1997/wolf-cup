---
title: 'Weekly Harvey-Points Win Odds — Scouting "The Line"'
slug: 'scouting-harvey-win-odds'
created: '2026-06-01'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
adversarialReview: '_bmad-output/reviews/tech-spec-scouting-harvey-win-odds-adversarial.md (2 ensemble rounds: BMAD adversarial-general + codex; criticals confirmed dead in round 2)'
reviewResolution: 'RESOLVED: F1/F2 (subs = non-bettable rank fillers from pooled prior; settlement on top member; GHIN rejected; flip-rate measurement + regression test). F3/F4 (realistic favorite-leaning public for fun P&L + calibration-vs-baselines as the real validity metric; dead sharp scenario removed). F6 (no-roster → gated "line opens when pairings set"). F8 (calibration judged vs baselines, reliability by fair price). F11 (hold = 1−1/λ). F13 (wrap calculateHarveyPoints in sim loop). F5 (line freezes at pairings-lock; roster churn = documented re-price vector). F9 (SIM_COUNT=20000). F10 (all constants pinned). F12 (dead-heat 1/k settlement; float-safe exact tie detection). F15 (MIN_PLAYER_ROUNDS=2 → "—"). Round-2 re-review (criticals confirmed DEAD by both reviewers): NEW-1 (public bettor model now PINNED deterministically — softmax on recent-form z, never reads posted odds). codex cap/vig (effective hold recomputed post-cap). Flip-rate now a 5% acceptance gate (Task 14). Calibration reports bootstrap CIs + paired diffs (low-power season). F12 defensive 2×-int compare + precondition documented. NEW-3 (sub-prior is a new unfiltered query) flagged in Task 5. OPEN (documented dev-time considerations, non-blocking): F7 (bonus — dissolves with F1), F14 (money comparability — only rank matters; note), F16 (handicap anti-persistence — accepted v1 limitation), F18 (benchmark ledger recompute; add response-time budget), NEW-2 (pooled-sub is an approximation graded vs actual — standing sensitivity via Task 14), F19 (re-verify q>=p post-rounding; guard q>=1).'
tech_stack: ['TypeScript', 'Hono (apps/api)', 'Drizzle/libsql (better-sqlite/@libsql)', '@wolf-cup/engine (pure TS, vitest)', 'React + TanStack Query + Tailwind (apps/web)', 'lucide-react icons']
files_to_modify: ['packages/engine/src/rng.ts (new — mulberry32)', 'packages/engine/src/rng.test.ts (new — seed vector)', 'packages/engine/src/odds.ts (new)', 'packages/engine/src/odds.test.ts (new)', 'packages/engine/src/index.ts', 'apps/api/src/routes/scouting.ts', 'apps/api/src/routes/scouting.integration.test.ts', 'apps/web/src/components/ScoutingPanel.tsx']
code_patterns: ['pure engine helpers + co-located *.test.ts, re-exported from engine/index.ts', 'Hono route returns assembled JSON; bulk-load season data once', 'frozen/blind pre-round filter (scheduledDate < target, finalized official)', 'reuse calculateHarveyPoints for ranking (bonus argmax-invariant → use 0)']
test_patterns: ['engine: vitest unit tests co-located (scouting.test.ts pattern), committed PRNG test vector', 'api: in-memory libsql file::memory:?cache=shared + drizzle migrate + seed tables + app.request(); retrospective/calibration tests must additionally seed harvey_results']
---

# Tech-Spec: Weekly Harvey-Points Win Odds — Scouting "The Line"

**Created:** 2026-06-01

## Overview

### Problem Statement

The scouting report (`/scouting/:roundId` + `ScoutingPanel.tsx`) shows per-player current-season form, but nothing synthesizes it into "who's most likely to win this week." A bare "% chance to win" reads as discouraging; the same number framed as **betting odds** ("+450", "longshot +2500") is fun and engaging. We already have everything needed to price it — per-round Stableford and money totals (`round_results`), and the production Harvey ranking engine (`calculateHarveyPoints`) — and because the report is **frozen to form going into the week**, we can also later grade how each week's opening line held up against what actually happened.

### Solution

Add a **deterministic, seedable Monte-Carlo / bootstrap odds model** in `@wolf-cup/engine` that simulates the week's field from each full member's prior `(stableford, money)` round tuples, ranks each simulated field through the production `calculateHarveyPoints`, and produces every member's probability and American odds of **winning the most Harvey points that week**. Surface it in `ScoutingPanel` as a top-level "📊 The Line" board plus per-row chips, and — for past/finalized weeks — a presentation-only **retrospective** grading the opening line against the actual Harvey winner from `harvey_results`.

### Scope

**In Scope:**

- **Engine module** (`packages/engine/src/odds.ts`): seedable PRNG (mulberry32), **paired bootstrap** resampling of each member's `(stableford, money)` round tuples, **small-sample shrinkage** toward a field baseline, **recency weighting**, simulate ~10k fields through `calculateHarveyPoints`, convert probability → **American odds** with book-like rounding. Fully deterministic given the seed + inputs. Unit-tested (vitest) like `scouting.ts`.
- **Bet definition:** odds to **win the most Harvey points among full members** that round. **Subs are NOT bettable but ARE included in the simulated rank field** (corrected per adversarial review F1). Harvey points are rank-based over the *full* field, so removing a sub applies a per-member, non-uniform shift that **can reorder the member winner** — the earlier "argmax-equivalent" claim was FALSE (codex counterexample). Subs occupy rank slots in the sim but are never eligible to win; the argmax is taken **over members only**.
  - **How subs are modeled (F1):** their job is only to sit in a plausible rank slot, not to be predicted. Draw each sub's `(stableford, money)` from a **pooled sub-class prior** built from historical `is_sub = 1` rounds (`round_results`); **fall back to the field baseline** when no sub history exists. **GHIN is explicitly rejected** — it only informs the Stableford half (which handicaps already flatten to ~average), says nothing about the money half (the real differentiator), and breaks frozen-report determinism (GHIN data drifts) for near-zero signal.
  - **Settlement (F2):** the bet is among **members**; if a *sub* posts the overall weekly high, member tickets still settle on the **top member** (the market was never over subs). The retrospective may note "a sub posted the week's high" as color, but grades chalk/upset on the top member. `busted` now means only that the winning *member* was off the posted board (ungated / "—" priced).
  - **Measurement (F1):** quantify on real finalized rounds how often excluding subs would change the top member; if negligible it's a documented approximation, but the pooled-sub-filler path is the safe default regardless.
- **Honesty gate:** below ~3 prior finalized season rounds (field level) the line is withheld with an "Odds open in a few weeks" message; members with too-few personal rounds shrink hard toward baseline and may render "—" instead of a price.
- **API:** extend `GET /scouting/:roundId` with an `odds` block (field-wide, ranked favorites → longshots), computed **strictly from rounds before the target round's date** (blind to the target result — reuse the existing pre-round filter).
- **Retrospective (this spec):** on a past/finalized target round, add a presentation-only grade comparing the opening line (favorite + each member's price) to the **actual** Harvey winner read from `harvey_results`. This read is separate and **never feeds the model**.
- **House-grade odds + House P&L + validity (this spec):** a **fair probability** under the hood (honesty layer) plus a **posted line carrying overround/vig** (`hold = 1 − 1/λ`). From week ≥3, a presentation-only **House P&L ledger** simulates ~20 flat-stake bettors using a **realistic favorite-leaning public** (independent of our prices, so the number tracks line quality — F4) settled vs. actual results — the entertaining scoreboard. Beside it, the **real validity metric**: out-of-sample **log-loss/Brier vs. baselines** (uniform / handicap-only / last-week) — the honest proof the line beats dumb guessing. Entertainment-only.
- **UI** (`apps/web/src/components/ScoutingPanel.tsx`): new top-level "📊 The Line" board (field-wide ranked), compact odds chip on collapsed player rows, full odds line on expand, and the retrospective grade panel on past weeks.
- **Tests:** extend `scouting.integration.test.ts` — determinism (same `roundId` → identical odds), blindness (target result excluded), gate behavior, sub exclusion, retrospective grading.

**Out of Scope:**

- **Tee-conditional modeling** (shifting odds by next week's tee color) — future enhancement.
- **Per-foursome money odds** and **"perfect day" odds** — explicitly deferred by user.
- **Persisting odds snapshots** to the DB — recomputed deterministically on read instead (the frozen-form filter + seed make every read identical).
- Any change to **how Harvey points are scored or stored**.
- Surfacing odds **outside the scouting report** (leaderboard/home).

## Context for Development

### Codebase Patterns

- **Pure engine helpers**: stat/scoring primitives live in `packages/engine/src/*.ts` (e.g. `scouting.ts`, `harvey.ts`) with co-located vitest specs (`*.test.ts`) and are re-exported from `packages/engine/src/index.ts`. `odds.ts` follows this exactly.
- **Scouting endpoint shape**: `apps/api/src/routes/scouting.ts` already bulk-loads the season's `round_results` (`stablefordTotal`, `moneyTotal`) for the field, builds a `roundOrder`/`teeByRound` map, and assembles a per-group JSON response. The odds block plugs into this existing data load — the `(stableford, money)` pairs the model needs are already fetched in `resultRows`.
- **Frozen / blind-to-result filter** (already present, `scouting.ts`): season rounds are `type='official'`, `status='finalized'`, and `scheduledDate < target.scheduledDate`. The target round and all later rounds are excluded by construction — the model inherits this blindness for free.
- **Harvey scoring** (`packages/engine/src/harvey.ts` `calculateHarveyPoints`): per round, `stablefordPoints + moneyPoints`, each rank-based over the field (best=N, worst=1, ties split). Production caller `apps/api/src/routes/admin/rounds.ts::computeAndStoreHarvey` ranks over **all** `round_results` rows and stores into `harvey_results` (`stablefordRank`, `moneyRank`, `stablefordPoints`, `moneyPoints`). Reused verbatim inside the simulation.
- **UI panel**: `ScoutingPanel.tsx` renders groups; collapsed `PlayerRow` is `[chevron] [name] [· headline (truncate)]` (room for a right-aligned `ml-auto` odds chip); expanded rows show `statLines` + `HoleAverages`. Top-level board renders above `data.groups`.
- **Subs**: `round_players.isSub` (0/1) per round; display convention is "subs always render below full members."

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `packages/engine/src/harvey.ts` | `calculateHarveyPoints` reused as the in-sim ranker; argmax invariant to multiplier/bonus |
| `packages/engine/src/scouting.ts` | Pattern for engine stat helpers + thresholds; co-located tests |
| `packages/engine/src/index.ts` | Re-export surface for the new `odds.ts` |
| `apps/api/src/routes/scouting.ts` | Host endpoint; existing field data load + frozen/blind filter to extend with the `odds` block |
| `apps/api/src/routes/admin/rounds.ts` | `computeAndStoreHarvey` — production Harvey ranking reference; `harvey_results` write |
| `apps/api/src/db/schema.ts` | `round_results`, `harvey_results`, `round_players.isSub` columns |
| `apps/web/src/components/ScoutingPanel.tsx` | Board + chips + expand line + retrospective panel + week selector + House ledger |
| `apps/api/src/routes/scouting.integration.test.ts` | Where new odds/retrospective tests are added (must seed `harvey_results`) |
| `packages/engine/src/index.ts` | Add `export * from './odds.js'` |
| `packages/engine/src/shuffle.ts` | Existing shuffle uses bare `Math.random()` — NOT seedable; confirms a new `mulberry32` is required |
| `apps/api/src/index.ts` | Scouting mounted at `/api` (route `/api/scouting/:roundId`) |
| `apps/web/src/routes/index.tsx` | `<ScoutingPanel roundId={currentRound.id}>` — only renders the current round today |

### Investigation findings (Step 2)

- **F1 — No seedable PRNG exists.** `packages/engine/src/shuffle.ts` uses bare `Math.random()` (line 16); it cannot give the frozen-report determinism. **Action:** add `mulberry32(seed: number)` to the engine (own module or in `odds.ts`), with a committed seed→output test vector. The odds sim and the deterministic bettor allocation both draw from it.
- **F2 — Retrospective/House ledger need past-week access in the UI.** `ScoutingPanel` is only ever mounted with `currentRound.id` (`index.tsx`). **Action:** add a **week selector** (list the season's rounds; default = current/upcoming) so any finalized week's frozen line + grade is viewable, plus an always-visible **cumulative House ledger** card. The cumulative ledger is computed server-side over finalized weeks ≥3 and returned on any scouting response.
- **F3 — Reuse `calculateHarveyPoints` with bonus 0.** `harveyBonus` is triplicated (admin/rounds.ts:68, score-corrections.ts:42, seed-demo.ts:85), not in the engine. Bonus/multiplier are argmax-invariant, so the sim ranks with `'regular', 0` and we **do not** touch the triplicated helper (pre-existing smell, out of scope).
- **F4 — API response shape.** `/api/scouting/:roundId` gains: an `odds` block (always, subject to the gate) with both the **posted** (vig'd) American odds and the **fair** probability per member; a `retrospective` block **only when the target round is finalized and has `harvey_results`**; and a `houseLedger` block (cumulative + per-week) over finalized weeks ≥3. Existing `groups`/`rivalry`/`luckyCharm` payload is unchanged (additive).
- **F5 — Test seeding.** The current integration test imports seasons/players/rounds/groups/roundPlayers/roundResults/holeScores/wolfDecisions but **not** `harveyResults`; retrospective/calibration/ledger tests must seed `harvey_results` for the target (and prior) finalized rounds.

### Implementation-readiness decisions (party-mode round 3, 2026-06-01)

- **Ledger = recompute-on-read, no persistence, memoized per request** (Winston): pricing each past week re-runs the model for that week's pre-week field, so cost is ~`weeks × SIM_COUNT` rank-sorts per request (bounded, expected <~100ms at ~20 weeks × 10k; each sim is ~20 cheap integer ranks). Memoize per-week odds within a single request. **Documented consequence:** a score correction to an *old* round **retroactively re-prices ledger history** — accepted as entertainment-only, stated in the spec so it's not a surprise.
- **PRNG in its own module** (Amelia): new `packages/engine/src/rng.ts` exporting `mulberry32(seed: number)` with a **committed seed→first-N-outputs test vector** (`rng.test.ts`). `odds.ts` imports it; `shuffle.ts` can later accept an injected rng to retire the F1 `Math.random` debt (note only, not in scope).
- **Two decorrelated seed streams** (Amelia): the simulation draws off `seed = roundId`; the bettor allocation draws off a derived stream (e.g. `roundId * 0x9E3779B1` truncated to u32) so bettor picks don't correlate with score draws. Both fully deterministic/reproducible.
- **Calibration math pinned** (Mary; sharpened by F4/F8): **Brier** = mean over the week's members of `(outcome − fair_p)²`, outcome = 1 for the actual **top member** else 0. **Log-loss** (winner) = `−ln(fair_p_winner)`, `fair_p` floored `1e-6`. These are weak in absolute terms (one winner per ~16 members), so they are **always reported against baselines** (uniform `1/N`, handicap-only, last-week-winner) — beating baselines is the signal, not the raw number. Reliability buckets, if shown, bucket by **fair** price (not vig'd). Aggregate over weeks ≥3. **House P&L uses POSTED (vig'd) odds; calibration/validity uses FAIR probability** — strictly separate.
- **Probability floor** (Quinn): floor `fair_p` at `1e-6` before log-loss so a winner who never appeared in any sim (`fair_p = 0`) can't produce `Infinity`.
- **UX (Sally):** **week selector** — compact segmented control / dropdown at the panel top, default = current/upcoming week, scrubbing loads that week's frozen line + ✅/🎲/💥 grade. **"🏛️ The House" ledger card** — own card, leads with cumulative units (green/red), hold% beneath, tiny weekly sparkline, "books open after week 3" placeholder until a week ≥3 exists; stacks above the board on mobile.
- **Scope fence reaffirmed** (John): week selector + House ledger live in **blocks B/C**; the **core** current-round line + board + chips ships independently of them.

#### Resolutions for F5 / F12 (2026-06-01)

- **Tie settlement = dead-heat, fractional (F12).** If `k` members tie for the most Harvey points: the sim's `1/k` win-split, the bettor settlement (paid at posted odds on `1/k` of stake — standard dead-heat), and the retrospective (co-winners) **all use the same `1/k` convention**. One rule, three places.
- **Float determinism is safe by construction (F12).** Every `rankScores` output equals `N − pos − (gs−1)/2` → always a **multiple of 0.5**, so combined `stablefordPoints + moneyPoints` is a multiple of 0.5, **exactly representable in IEEE-754**. **Implement defensively:** compare ties on `Math.round(2 × points)` (integer half-points), and note the precondition — this holds **only because the sim uses `multiplier = 1` and integer bonus (0)**; a fractional bonus/multiplier would break exact-equality (codex/NEW-4). Downstream floats (`fairProb`, overround, American conversion) are never equality-compared — only formatted via deterministic arithmetic + `Math.round` — so JSON stays byte-identical (AC-A2 holds). Dead-heat splits among tied **members** only.
- **The line "freezes" only once pairings are locked (F5).** The target round's roster *is* the field, and roster edits (add/remove/sub-swap) before pairings are published legitimately **re-price** the line — same class of event as a prior-round score correction. Determinism is "given inputs"; this is a third documented re-price vector, not a bug. Before a roster exists, the line is `gated` ("line opens when pairings are set", F6).

### Technical Decisions

- **Determinism is mandatory** (the report is frozen): seed the PRNG from `roundId` (or a stable derived value); **no `Math.random()` / `Date.now()`** anywhere in the model. Same inputs ⇒ byte-identical odds on every read.
- **Reuse `calculateHarveyPoints`** for in-sim ranking so odds stay consistent with real scoring. Multiplier/bonus are argmax-invariant, so use defaults (`'regular'`, bonus 0) in the sim.
- **Paired bootstrap**: resample each member's `(stableford, money)` as a **tuple from one past round**, preserving real correlation and fat tails. Independent money draws break the real zero-sum, but only relative **rank** matters, so this is an accepted approximation.
- **Shrinkage**: regress thin samples toward a pooled field baseline (~4 pseudo-rounds) so a 2-round hot streak isn't a false favorite. **Recency weighting**: recent rounds drawn more often.
- **Subs included as non-bettable rank fillers** (`isSub`), drawn from a pooled sub-class prior (field-baseline fallback); argmax over members only. **Corrected per adversarial F1** — the old "exclude, it's argmax-equivalent" claim was false. GHIN rejected (see Scope).
- **Strict form-going-in**: reuse the existing pre-round filter in `scouting.ts`; the model never reads the target round's results. The **retrospective** reads the target `harvey_results` separately and is presentation-only.

#### Refinements from party-mode review (2026-06-01)

- **Determinism is "given inputs," not across input edits** (Winston): the seed (derived from `roundId`) makes odds byte-identical for fixed inputs. A **score correction to a prior round legitimately re-prices** past lines on next read (recompute-on-read; no DB snapshot per scope). State this explicitly so re-pricing isn't read as a bug.
- **Named constants — PINNED (F10).** All live in `odds.ts` with rationale comments:
  - `SIM_COUNT = 20000` — bumped from 10k (F9): SE at p≈0.05 ≈ 0.15pp, comfortably below display resolution even on longshot tails; still milliseconds.
  - `SHRINKAGE_PSEUDO_ROUNDS = 4` — thin samples regress to baseline.
  - `RECENCY_HALF_LIFE = 4` rounds — a round ~4 weeks back is weighted ½ vs. the latest.
  - `MIN_FIELD_ROUNDS = 3` — the honesty gate ("books open after week 3").
  - `MIN_PLAYER_ROUNDS = 2` — a member below this is shrunk to baseline and shows **"—"** instead of a price (F15).
  - `OVERROUND = 1.18` — fixed (was a range); ⇒ hold = `1 − 1/1.18` ≈ **15.3%**.
  - `WIDE_OPEN_FACTOR = 1.5` — `wideOpen` triggers when the favorite's fair prob `< 1.5 × (1/N)` (scale-free; "nobody separated from the pack"). Defines AC-A5.
  - **Tier thresholds (scale-free, vs. uniform `u = 1/N`):** Favorite = fair prob `≥ 2u`; Longshot = fair prob `≤ 0.5u` **or** posted `≥ +1500`; Live = between.
  - `LONGSHOT_CAP = +2500` — displayed-odds ceiling (dignity cap). **NOTE (cap/vig, codex):** capping longshots changes the book's effective margin, so the disclosed hold must be **recomputed from the actually-posted prices after caps**, not reported as a flat `1−1/λ`.
  - `N_BETTORS = 20`, `STAKE_UNIT = 1`.
  - **Public bettor model (pinned — fixes NEW-1 determinism gap):** each of `N_BETTORS` bettors is drawn multinomially with weights `w_i ∝ softmax(PUBLIC_FAV_BIAS × z_i)`, where `z_i` = field z-score of member *i*'s **mean Harvey points over the last `RECENCY_HALF_LIFE` rounds** — a public-perception signal computed **only from historical results, NEVER from our posted odds / fairProb** (else the circularity returns — codex). `PUBLIC_FAV_BIAS = 1.0`. Draws use **only** the derived bettor seed stream (`W.roundId * 0x9E3779B1 >>> 0`); the 20-bettor multinomial *is* the noise (no separate noise term needed). Fully deterministic.
- **mulberry32 test vector** (Amelia/Quinn): commit a known `seed → first-N outputs` vector so the determinism test is real, not circular.
- **Argmax tie rule** (Amelia): when ≥2 members tie for the most Harvey points in a sim, **split the win fractionally** (1/k each) — no phantom edge to the nominal favorite.
- **Shrinkage baseline defined** (Amelia/Mary): regress each member toward the **pooled field mean of `(stableford, money)`** over eligible members, weight `SHRINKAGE_PSEUDO_ROUNDS`.
- **Fine odds resolution near favorites** (Mary): handicaps equalize by design, so net spreads are tight — coarse rounding would cluster everyone at one price and read broken. Keep resolution fine in the favorite/live range; coarsen only deep in longshot territory.
- **Plain-language label** (Mary): present as **"to win the week"** with "(most Harvey pts)" as a quiet subtitle — the model carries the rigor, the word stays glanceable.

#### UX decisions (Sally)

- **Price-first**: the board and chips lead with American odds; the underlying **% appears only on expand/long-press**, never as the headline ("odds fun, % depressing").
- **Tier labels**: **Favorite** (negative odds), **Live** (mid), **Longshot** (~+1500 and out) — gives the board its texture.
- **Chip rendering**: `ml-auto`, fixed-width, `tabular-nums` so the price doesn't jitter the truncating headline on collapsed `PlayerRow`.
- **Retrospective verdict badge** (past/finalized weeks): **✅ Chalk** (favorite won) / **🎲 Upset** (a listed longshot won) / **💥 Busted** (winner was off the board, e.g. a sub or ungated member). Sub-won-the-week renders as 💥 with "won by a sub," not a blank.
- **"Wide-open week" state**: when no member meaningfully separates (prices within a tight band), render a **🌀 Wide-open week** treatment instead of a flat list of near-identical prices — turn the flatness into a feature, not a bug.
- **Cap long odds**: floor displayed longshots at a dignified ceiling (e.g. "+2500 / longshot") rather than showing `+50000`. Keep longshot framing upside-positive (feelings — being publicly worst-priced every week is its own "% is depressing").
- **Confidence signal + "for entertainment"**: thin-sample lines carry a small confidence indicator (sample size / spread) and a light "for fun" framing, so a fragile estimate never masquerades as a hard fact.

#### Model justification & known limitations (advanced-elicitation, 2026-06-01)

- **Where the edge comes from** (first-principles): net Stableford is *engineered to equalize* members, so the forecastable signal is **not** "predicting golf" — it's pricing the part the handicap *doesn't* erase: (1) **handicap lag / current form** (the `handicapTrend` signal — a player improving faster than their index over-performs net), and (2) the **money half of Harvey** (wolf/skins/birdies are **not** handicap-equalized, so consistent winners separate there). State this as the epistemic justification.
- **Stationarity**: resampling historical net Stableford assumes the net distribution is ~stationary, which holds *by design* (handicap updates re-center net); recency weighting absorbs residual drift.
- **A near-flat early-season board is CORRECT, not a bug** — gated below `MIN_FIELD_ROUNDS`, and rendered as "wide-open week" when present.
- **Retrospective = calibration / accountability backbone** (critical-perspective): publishing a number *and publicly grading it weekly* is what keeps this evidence-first. Over a season, favorites should cash near their implied rate; the retrospective is the mechanism that proves (or disproves) the line — this is the justification for keeping it in this spec.
- **Known limitation — money-rank approximation** (red-team): independent paired bootstrap drops the real **anti-correlation** of money across players (one's win is another's loss, especially within a foursome), so simulated money-rank probabilities are approximate. Accepted for v1; candidate for a copula / within-group balancing in a later iteration. Document, don't hide.
- **Monte-Carlo error** (red-team): size `SIM_COUNT` so the MC standard error is below the odds **display resolution** (~±0.5% at p≈0.1 for 10k); document the error band so determinism-via-seed isn't read as false precision.
- **Sandbagging incentive** (pre-mortem): publishing odds mildly incentivizes gaming one's index to sit as a longshot. Out of scope to act on; named here, and `sandbagger.ts` already exists as a future cross-reference.

#### House-grade odds & House P&L (party-mode round 2, 2026-06-01)

- **Two lines, not one** (Mary/Vinny): the model computes the **fair probability** (sums to ~100% — the truth, shown as the under-the-hood %) and a **posted line with overround** (`OVERROUND` ≈ 1.15–1.20; implied probs sum to >100%). The gap is the **house hold**, disclosed openly ("house holds ~17% this week"). v1 uses a **proportional overround**; favorite-longshot-bias correction (odds-ratio / Shin) is a future enhancement. American odds shown to users are the **posted** (vig'd) line; the **%** revealed on expand is the **fair** probability.
- **House P&L is the model's scoreboard** (Winston): a calibrated line + vig profits over volume; a season-losing house = a miscalibrated line. So the P&L feature *is* the validity test Josh asked for, not decoration.
- **Bettor model — CORRECTED per adversarial F3/F4** (the old "public bets ∝ posted-implied" was circular — it returns `H·(1−1/λ)` regardless of who wins, proving only that vig exists; and the "sharp where `fair_p > posted_implied`" scenario is mathematically dead under proportional vig since `posted = λ·fair > fair` for everyone). Constants `N_BETTORS = 20`, `STAKE_UNIT = 1` (flat), allocation **deterministic** off the derived bettor seed stream:
  - **Realistic public (the fun layer):** bettors back members via the **pinned public model** above — `w_i ∝ softmax(PUBLIC_FAV_BIAS × z_i)` over recent-form z-scores, **independent of our posted prices** (must NOT read posted odds/fairProb — codex). Now the house P&L actually *moves with line quality*: if our prices are right relative to where the public piles in, the house wins; if we misprice where the public loads, it can lose. Settle at **posted** odds against **actual** results.
  - **The P&L is the entertaining scoreboard, NOT the validity proof.** Label it as assuming a typical favorite-leaning public. The dead sharp/value scenario is **removed**. Disclose the **effective** hold (post-cap), not the nominal `1−1/λ`.
- **Ledger** (Quinn): per week (≥3 prior rounds) report **weekly + cumulative** house P&L and **theoretical vs. realized hold** (note: expected hold = `1 − 1/λ` ≈ 13–17% for λ=1.15–1.20, **not** the overround % — F11 corrected).
- **The real validity metric — calibration vs. baselines (F4):** out-of-sample, does our line predict the actual weekly winner **better than** dumb baselines — **uniform 1/N**, **handicap-only**, **last-week's-winner**? Score with **log-loss + Brier** over weeks ≥3, with confidence intervals. Beating the baselines = the edge is real; losing to them = no vig saves it. This is the honest scoreboard the house P&L sits on top of. (Brier alone is weak with one winner per ~16 members — always report it *relative to baselines*, never as an absolute pass/fail.)
- **Ledger edge cases** (Quinn): **off-board winner ⇒ house keeps every stake** (big green week, e.g. winner was a sub or ungated); **no qualified favorite / gate not met ⇒ no book posted that week** (no P&L line, excluded from cumulative).
- **The unbridgeable gap — entertainment only** (Vinny): the model **cannot price dives, round-dumping, index sandbagging, or flight-ducking** — the amateur-integrity hole no book could cover. Stated plainly in the UI as *why* it's for fun.
- **Scope fences** (John): **out** — Kelly / variable staking, intra-week line movement (balancing action), parlays / multiple markets, real currency. The House P&L + calibration is a **separable third AC block**, gated to weeks ≥3, built after core line + retrospective.

## Implementation Plan

Dependency order: **engine foundation → core API/UI line (Block A) → retrospective (Block B) → House P&L + calibration (Block C)**. Block A is independently shippable.

### Tasks

#### Engine foundation

- [x] **Task 1: Seedable PRNG.**
  - File: `packages/engine/src/rng.ts` (new)
  - Action: export `mulberry32(seed: number): () => number` (returns a function yielding floats in `[0,1)`); add a small `pickWeightedIndex(rng, weights: number[]): number` helper (cumulative-weight draw) used by both bootstrap and bettor allocation.
  - Notes: pure/deterministic; no `Math.random`/`Date.now`. This is the root fix for F1.

- [x] **Task 2: Export surface.**
  - File: `packages/engine/src/index.ts`
  - Action: add `export * from './rng.js';` and `export * from './odds.js';`.

#### Block A — Core odds model + line

- [x] **Task 3: Odds model (engine).**
  - File: `packages/engine/src/odds.ts` (new)
  - Action: implement `computeOddsLine(input): OddsResult` where `input = { field: Array<{ playerId; history: Array<{ stableford; money; orderIndex }> }>, seed, constants }`. Steps, in order:
    1. **Gate:** if distinct prior finalized rounds `< MIN_FIELD_ROUNDS` → return `{ gated: true }`.
    2. **Field baseline:** pooled mean `(stableford, money)` over all eligible members' history.
    3. **Per-member effective sample:** recency-weighted (half-life `RECENCY_HALF_LIFE`) + shrinkage toward baseline (`SHRINKAGE_PSEUDO_ROUNDS` pseudo-rounds at baseline).
    4. **Simulate** `SIM_COUNT` fields with `mulberry32(seed)`: each **member** draws a `(stableford, money)` **tuple** via recency-weighted bootstrap (`pickWeightedIndex`) + shrinkage pseudo-rounds from baseline; each **sub** (non-bettable) draws from the **pooled sub-class prior** (field-baseline fallback) so it occupies a realistic rank slot; rank the **full field incl. subs** via `calculateHarveyPoints(field, 'regular', 0)`; **`argmax` over MEMBERS ONLY** of `stablefordPoints + moneyPoints`; **ties split** `1/k`.
    5. **fairProb** = wins / SIM_COUNT per member (sums to 1).
    6. **Posted line:** `applyOverround(fairProb, OVERROUND)` → implied probs sum to `OVERROUND`; convert to American via `probToAmerican` with **fine resolution near favorites, capped long odds**; classify `tier` (Favorite/Live/Longshot).
    7. **wideOpen** flag when spread between top and median posted implied is below a threshold.
    8. **confidence** per member from sample size + field spread.
  - Output: `{ gated:false, hold, wideOpen, lines: OddsLine[] /* sorted favorites→longshots */ }`, `OddsLine = { playerId, fairProb, postedAmerican, impliedProb, tier, confidence }`.
  - Notes: constants live here with rationale comments: `SIM_COUNT`, `SHRINKAGE_PSEUDO_ROUNDS`, `RECENCY_HALF_LIFE`, `MIN_FIELD_ROUNDS`, `OVERROUND`, `LONGSHOT_CAP`. Bonus argmax-invariant → `0`.

- [x] **Task 4: Self-consistency estimator (engine).**
  - File: `packages/engine/src/odds.ts`
  - Action: export a **genuinely independent** `estimateStrengthOrder(field): playerId[]` for the cross-check test — NOT mean-Harvey-finish through the same `calculateHarveyPoints` (that's circular, F17). Use a different basis (e.g. mean raw Stableford + mean money z-scores, or a last-week-naive order). It need only agree with the bootstrap on gross favorite ordering; divergence flags a real bug, not just a typo.

- [x] **Task 5: `odds` block on the endpoint (API).**
  - File: `apps/api/src/routes/scouting.ts`
  - Action: add `isSub` to the roster query; build the sim **field = members (`isSub = 0`) + subs (`isSub = 1`) as non-bettable rank fillers** from the already-loaded `resultRows` + `roundOrder`; load the **pooled sub-class prior** from historical `is_sub = 1` `round_results` (field-baseline fallback) — note this is a **NEW access pattern, NOT filtered by `scoutedIds`** (join `round_results` → `round_players` for the `is_sub` flag, since `round_results` has no `isSub` column), distinct from the existing scouted-only load (NEW-3); compute field baseline; call `computeOddsLine({ seed: roundId, ... })` (odds lines emitted for **members only**); attach `odds` to the JSON (additive — `groups`/`rivalry`/`luckyCharm` unchanged). Also add a `weeks: [{ roundId, date, label, status }]` list for the UI selector.
  - Notes: model reads only rounds **before** the target date (existing `lt(scheduledDate)` filter) — blindness preserved. **Field requires a posted roster** (F6): if the target round has no roster yet, emit `odds.gated` with reason `"line opens when pairings are set"`.

- [x] **Task 6: "The Line" board + chips + expand (Web).**
  - File: `apps/web/src/components/ScoutingPanel.tsx`
  - Action: render a top-level **📊 The Line** card (field-wide, favorites→longshots, posted American odds, tier labels) above `data.groups`; **🌀 Wide-open week** treatment when `odds.wideOpen`; "odds open in a few weeks" when `odds.gated`. Add a fixed-width `tabular-nums ml-auto` odds chip to collapsed `PlayerRow`; reveal **fair %** + confidence only on expand.

#### Block B — Retrospective

- [x] **Task 7: `retrospective` block (API).**
  - File: `apps/api/src/routes/scouting.ts`
  - Action: when the target round is `finalized` and has `harvey_results`, read them, compute the **top MEMBER** by `stablefordPoints + moneyPoints` (the bet's winner; a sub posting the overall high is settled around — noted as `subSpoiled: true` color only), and emit `{ winningMember, subSpoiled, verdict: 'chalk'|'upset'|'busted', favorite, postedRecap }`. `busted` = the winning **member** was off the posted board (ungated / "—"). Presentation-only; never feeds the model. (F2 corrected.)

- [x] **Task 8: Week selector + retrospective grade (Web).**
  - File: `apps/web/src/components/ScoutingPanel.tsx`
  - Action: add a compact week selector (segmented/dropdown from `weeks`, default current) that switches `roundId`; on finalized weeks render the **✅ Chalk / 🎲 Upset / 💥 Busted** grade panel (sub-won → 💥 "won by a sub").

#### Block C — House P&L + calibration

- [x] **Task 9: `houseLedger` block (API).**
  - File: `apps/api/src/routes/scouting.ts`
  - Action: load season-wide finalized rounds + results + rosters + `harvey_results` up to the viewed week. For each week `W` with `≥ MIN_FIELD_ROUNDS` prior rounds: compute `W`'s **posted** odds (memoized via `mulberry32(W.roundId)`), determine `W`'s actual **top member**, simulate `N_BETTORS` flat `STAKE_UNIT` bettors off a **derived seed stream** (`W.roundId * 0x9E3779B1 >>> 0`) using the **pinned public bettor model** (multinomial on `softmax(PUBLIC_FAV_BIAS × recent-form z); NEVER reads posted odds` — F4/NEW-1), settle at posted odds vs. actual, and compute weekly + cumulative P&L + **effective hold recomputed from posted prices after `LONGSHOT_CAP`** (not nominal `1−1/λ` — codex cap/vig). Separately compute the **validity block**: our line's **log-loss + Brier vs. baselines** (uniform `1/N`, handicap-only, last-week-winner), `fair_p` floored at `1e-6`, **with bootstrap confidence intervals + paired week-level diffs** (the ~20-round season is low-power — report uncertainty, don't over-claim). Emit `{ openWeeks, perWeek[], cumulativeUnits, theoreticalHold, effectiveHold, realizedHold, validity: { logLoss, brier, baselines: { uniform, handicapOnly, lastWeek }, ci } }`.
  - Notes: recompute-on-read, memoized per request; off-board winning member ⇒ house keeps all stakes; weeks below the gate excluded. **Wrap `calculateHarveyPoints` in the sim loop so a thrown `HarveySumViolationError` can't 500 the additive scouting response** (F13).

- [x] **Task 10: "🏛️ The House" ledger card (Web).**
  - File: `apps/web/src/components/ScoutingPanel.tsx`
  - Action: render the ledger card (cumulative units green/red, hold%, weekly sparkline, public-vs-sharp lines, calibration summary); "books open after week 3" placeholder until `openWeeks > 0`; stacks above the board on mobile; include the "for entertainment — can't price dives/sandbagging" caveat line.

#### Tests

- [x] **Task 11: `rng.test.ts`** — committed seed→first-N-outputs vector; basic uniformity sanity.
- [x] **Task 12: `odds.test.ts`** — determinism, tie-split, shrinkage pulls thin samples to baseline, gate, single-member "lock" (no divide-by-zero), all-identical-history (no false favorite), overround/hold math, `probToAmerican` incl. longshot cap, and the self-consistency cross-check (favorite order agrees with `estimateStrengthOrder`).
- [x] **Task 13: `scouting.integration.test.ts`** — `odds` block present + sorted; **blindness** (insert a target-round result → odds byte-identical); **subs included as rank fillers but emit no OddsLine** (lines members-only); **a sub ranked between two members can flip the member winner** (F1 regression guard, mirrors the codex counterexample); **no-roster round → gated "line opens when pairings are set"** (F6); **determinism** (two calls → identical JSON); retrospective `chalk`/`upset`/`busted` + `subSpoiled` color (F2); ledger cumulative units + realized hold to fixed decimals across 3 seeded weeks; off-board-winner keeps stakes; below-gate week excluded; log-loss finite when a winner had `fair_p = 0`.

- [~] **Task 14: Sub-exclusion flip-rate measurement (F1).** — PARTIAL (mechanism guard done; real-round measurement pending prod data)
  - File: `packages/engine/src/odds.test.ts` (or a one-off script under `scripts/`)
  - Action: over real finalized rounds, compute the top member with vs. without subs in the rank field; report the % of rounds the winner differs. **Acceptance threshold:** if `> 5%` of rounds flip, the pooled-class filler is load-bearing → escalate sub modeling (individual sub priors / handicap-conditioned) before relying on the line; if `≤ 5%`, the pooled filler is an adequate safety margin. Note (codex/NEW-2): this measures the *exclusion* impact, not the pooled-prior's accuracy — pooled subs are an approximation graded against actual sub scores, so keep this as a standing sensitivity check.
  - **Status (2026-06-01):** The F1 *mechanism* is proven with a hardcoded, hand-verified counterexample in `odds.test.ts` ("including a sub flips the top member C → B") — confirming subs are load-bearing rank fillers, not argmax-invariant. The **real-round 5% flip-rate measurement** requires the production season's finalized `round_results` + `round_players.is_sub`, which are not available in this dev environment. **TODO before trusting the line in prod:** run the exclusion-flip script against the live DB (the user flagged this as the early signal to verify). If `>5%`, invest in per-sub priors before relying on the line.

### Acceptance Criteria

#### Block A — Core line (must-ship)

- [ ] **AC-A1 (happy path):** Given a season with `≥ MIN_FIELD_ROUNDS` prior finalized rounds and a target round's member field, when `GET /api/scouting/:roundId` is called, then the response includes an `odds` block with one `OddsLine` per **full member** (no subs), sorted favorites→longshots, each carrying a **posted American price** and tier.
- [ ] **AC-A2 (determinism):** Given the same `roundId` and unchanged inputs, when the endpoint is called twice, then the `odds` block is **byte-identical**.
- [ ] **AC-A3 (blindness):** Given a target-round result row is inserted, when the endpoint is called, then the `odds` block is **unchanged** (model reads only pre-round data).
- [ ] **AC-A4 (gate):** Given fewer than `MIN_FIELD_ROUNDS` prior rounds, when called, then `odds.gated = true` and the UI shows "odds open in a few weeks" (no prices).
- [ ] **AC-A5 (wide-open):** Given the favorite's fair prob `< WIDE_OPEN_FACTOR × (1/N)` (i.e. `< 1.5/N`), when rendered, then the board shows the **🌀 Wide-open week** treatment rather than a flat list of identical prices.
- [ ] **AC-A6 (fair vs posted):** Given the `odds` block, then implied probabilities of the **posted** line sum to ≈ `OVERROUND` (>1), while each `OddsLine.fairProb` is the true probability and all `fairProb` sum to ≈ 1; the **% shown to users on expand is `fairProb`**.
- [ ] **AC-A7 (edge — single member / all-tie):** Given a one-member field, then that member is a "lock" with no divide-by-zero; given all members with identical history, then no false favorite emerges (prices within the wide-open band).

#### Block B — Retrospective

- [ ] **AC-B1 (chalk):** Given a finalized target round whose actual Harvey winner was the posted favorite, when called, then `retrospective.verdict = 'chalk'` (✅).
- [ ] **AC-B2 (upset):** Given the actual winner was a listed non-favorite, then `verdict = 'upset'` (🎲).
- [ ] **AC-B3 (busted / sub-spoiled):** Given the winning **member** was off the posted board (ungated / "—"), then `verdict = 'busted'` (💥). Given a **sub** posted the overall weekly high, then `subSpoiled = true` is surfaced as color but the verdict still grades on the top member (the bet was never over subs). (F2)
- [ ] **AC-B4 (not yet final):** Given the target round is not finalized / has no `harvey_results`, then no `retrospective` block is emitted and the UI shows the line as still open.
- [ ] **AC-B5 (selector):** Given the week selector, when a past finalized week is chosen, then that week's frozen line **and** its grade render.

#### Block C — House P&L + calibration

- [ ] **AC-C1 (ledger math):** Given ≥3 seeded finalized weeks with `harvey_results`, when called, then `houseLedger` reports deterministic weekly + cumulative units, **theoretical hold (`1 − 1/λ`)**, the **effective hold recomputed from posted prices after `LONGSHOT_CAP`**, and realized hold — reproducible to fixed decimals.
- [ ] **AC-C1b (P&L is non-circular — F4):** Given a fixed set of results, when the bettor model is the realistic favorite-leaning public, then changing the *posted line* changes the house P&L (i.e. the number is NOT invariant to who wins), proving it tracks line quality rather than just returning the hold.
- [ ] **AC-C1c (validity vs baselines — F4):** Given ≥3 weeks, then the `validity` block reports our line's log-loss/Brier **alongside** uniform-`1/N`, handicap-only, and last-week-winner baselines, so "is the line good" is judged relatively, never as an absolute Brier number.
- [ ] **AC-C2 (off-board winner):** Given a week whose actual winner was off-board, then the house **keeps all `N_BETTORS × STAKE_UNIT` stakes** for that week.
- [ ] **AC-C3 (gate exclusion):** Given a week with `< MIN_FIELD_ROUNDS` prior rounds, then it contributes **no** P&L line and is excluded from the cumulative.
- [ ] **AC-C4 (calibration separation & floor):** Given calibration is computed, then **Brier/log-loss use `fairProb`** (not posted), the winner's `fairProb` is floored at `1e-6` so **log-loss is finite** even when a winner never appeared in any sim.
- [ ] **AC-C5 (books-open placeholder):** Given fewer than one qualifying week, then the "🏛️ The House" card shows "books open after week 3" and no ledger figures.

## Additional Context

### Dependencies

- **No new external libraries.** Pure-TS engine module + existing Hono/Drizzle/React/TanStack/Tailwind stack.
- **Engine → API → Web** build order: `rng.ts` + `odds.ts` must compile/export before `scouting.ts` consumes them; `ScoutingPanel` consumes the new response blocks last.
- **Data dependency:** `round_results` (`stableford_total`, `money_total`) for the model; `harvey_results` for retrospective + ledger; `round_players.is_sub` to exclude subs from the field. No schema changes.
- **Reuses** `calculateHarveyPoints` (engine) verbatim as the in-sim ranker.

### Testing Strategy

- **Engine unit (vitest, co-located):** `rng.test.ts` (seed vector + uniformity); `odds.test.ts` (determinism, tie-split, shrinkage, gate, single-member, all-tie, overround/hold, American conversion + longshot cap, self-consistency cross-check). These are the fast, exhaustive correctness layer.
- **API integration (in-memory libsql + migrate + seed + `app.request`):** extend `scouting.integration.test.ts` — seed `harvey_results` (new); cover odds-block shape + sort, **blindness**, **determinism (identical JSON)**, sub-exclusion, retrospective verdict variants (chalk/upset/busted incl. sub-won), ledger cumulative figures across 3 weeks, off-board-keeps-stakes, below-gate exclusion, finite log-loss at `fair_p = 0`.
- **Manual:** load the scouting tab on the current round (see the line + chips), scrub the week selector to a finalized past week (see the grade + frozen line), confirm "🏛️ The House" shows cumulative units/hold once ≥3 weeks exist; verify chip doesn't jitter the collapsed row on a narrow viewport (375px).
- **Determinism caveat to verify:** correcting a prior round's score *re-prices* that week's line + ledger history on next read — confirm this is the observed (and documented) behavior, not a regression.

### Notes

User framing: "odds are fun, % chance to win is depressing." Bet target chosen = most Harvey points (not Stableford-only or money-only; "perfect day" combo deferred). Retrospective explicitly desired ("set odds for previous weeks, then check against real data — don't let actual results taint the initial execution; we check after, not before").

**AC partitioning (John, party-mode):** Step 3 must split acceptance criteria into (A) **core** — odds model + "The Line" board + chips (posted line w/ vig + fair % under the hood); (B) **retrospective** — the past-week grader; and (C) **House P&L + calibration** — bettor sim, ledger, Brier/log-loss/reliability, gated weeks ≥3. Separable blocks in that dependency order, so the core line can ship even if (B)/(C) review drags.

**Edge cases to force in ACs (Quinn, party-mode):** single eligible member ("lock", no divide-by-zero), all members with identical history (no false favorite), member exactly at the gate threshold, empty `round_results`, retrospective when the target round isn't finalized (no `harvey_results` → "line still open"), retrospective where the actual winner was a sub (💥 "won by a sub"). Signature tests: **determinism** (two calls → identical JSON), **blindness** (insert a target-round result, assert odds unchanged), and a committed **mulberry32 test vector** (seed → first-N outputs).

**Self-consistency cross-check test (advanced-elicitation):** in the engine suite, compute a cheap independent estimator (Elo/strength-rating or analytic rank-probability) alongside the bootstrap and assert they agree on **favorite ordering** and **top-p within tolerance** — a free guard that catches a bootstrap implementation bug which still looks plausible.

## Review Notes (quick-dev, 2026-06-01)

- **Adversarial review completed — 2 codex rounds (gpt-5.2, high reasoning).**
- **Round 1: 7 findings, all fixed.** F1 [critical] frozen-determinism break (unordered DB rows attached the RNG stream to different players/rounds) → `computeOddsLine` now normalizes input internally (field by playerId, history by orderIndex, sub prior by tuple). F2 [high] `fairProb×OVERROUND>1` produced absurd favorite prices → `FAVORITE_CAP=10000` floors negative odds. F3 ledger order-sensitivity (fixed by F1 + pre-index). F4 recency anchor → true prior-round horizon (`priorRoundCount−1`). F5 ledger quadratic scans → pre-indexed `resultByRound` map. F6 additive blocks could 500 → each block wrapped in try/catch. F7 dead-heat collapse + DB-order winner → sorted co-winner set; retrospective grades on the full winner set.
- **Round 2: confirmed R1 F1–F7 genuinely dead; 5 new edge findings.** R2-F1 [high] over-wide try/catch could wipe a valid odds line when only the retrospective DB read failed → retrospective moved to its own try/catch. R2-F2 [med] last-week baseline non-deterministic on ties → lowest-id tie-break. R2-F3 [med] last-week baseline invalid distribution at N=1 → falls back to uniform. R2-F4 [med] retrospective could treat a non-roster harvey row as a member → restricted to the known roster member set. R2-F5 [low] `impliedProb>1` for heavy favorites — **acknowledged, intentional**: `impliedProb = fairProb×OVERROUND` is deliberately unclamped so the posted line sums to `OVERROUND` (AC-A6); the UI only ever displays `fairProb`, never `impliedProb`.
- **Findings: 12 total, 11 fixed, 1 acknowledged as intentional invariant. Resolution: auto-fix (all findings classified real).**
- **Tests:** engine 522 pass (incl. 23 odds + 9 rng, with order-independence + favorite-cap + sub-flip + house-P&L regression guards) + lint clean; api scouting 17 pass (4 existing + 13 new) + lint clean; web typecheck + lint clean. No regressions.
- **Task 14 (sub-exclusion flip-rate) PARTIAL:** the F1 *mechanism* is proven with a hand-verified counterexample; the real-round 5% acceptance measurement requires production data and remains a pre-trust TODO (the user flagged this as the early signal to verify).
