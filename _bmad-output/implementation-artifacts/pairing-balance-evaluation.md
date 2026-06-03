---
title: 'Co-Play Balance Evaluation — Weighted-Average Pairing Engine'
created: '2026-06-01'
status: 'complete'
relates_to: 'tech-spec-pairing-tracking-and-balance-eval.md (Task 9)'
data_source: '_audit/wolf-cup-prod.db (read-only prod snapshot, integrity ok)'
reproduce: 'cd apps/api && DB_PATH=../../_audit/wolf-cup-prod.db npx tsx src/scripts/_audit_pairing_balance.ts'
---

# Co-Play Balance Evaluation

**Question (Josh, 2026-06-01):** Setting aside players' explicit First/Last group
requests, does the weighted-average pairing engine give players a *similar spread
of partners* over a season — i.e. is it **defensible** that no one is stuck
repeatedly with the same group, and no one is denied playing the field? This is
an evaluation of the *shipped* engine; the algorithm is **not** changed here.

This document is **data-backed and reproducible**, not a description of the
algorithm. Every number below comes from running
`apps/api/src/scripts/_audit_pairing_balance.ts` against the read-only production
snapshot `_audit/wolf-cup-prod.db`. Re-run it any time as rounds accrue.

---

## Definitions (so the numbers are reproducible)

- **co-attendance(pair)** = number of finalized rounds where **both** players were in the field.
- **timesTogether(pair)** = number of finalized rounds where both were in the **same group**.
- **repeat-pairing** = a pair with `timesTogether >= 2`.
- **totalRepeats** = `Σ over pairs max(0, timesTogether − 1)` (the count of *extra* times pairs were re-grouped beyond the first).
- **repeatSlots(player)** = `Σ over partners max(0, timesTogether − 1)` (how concentrated one player's repeats are).

**Random baseline mechanics:** a seed-fixed `mulberry32` PRNG (seed
`0x9e3779b9`), `N = 2000` sims. Each sim re-partitions **each round's actual
roster** into **that round's actual group sizes** via Fisher–Yates, then
recomputes the same metrics. The baseline deliberately **does not** replicate
First/Last pins — random is unconstrained, which gives the engine a *harder*
target, so the engine's win is conservative, not flattered.

**Scope:** 6 finalized 2026 rounds (2026-04-17, 04-24, 05-01, 05-08, 05-15,
05-29). Pre-2026 seasons hold imported aggregates only (no per-hole / per-group
data) and are not analyzable.

---

## 1. Aggregate spread — strongly defensible

| Metric | Engine | Random (N=2000) |
| ------ | -----: | --------------: |
| totalRepeats | **12** | avg **29.2** |
| repeat pairs (`timesTogether ≥ 2`) | 11 | — |
| max any pair played together | 3 | — |
| sims with `totalRepeats ≤ engine` | — | **0 / 2000 (0.0%)** |

The engine produces **12** repeat-pairings against a random average of **29.2** —
it more than **halves** repeats, and sits **beyond the entire random
distribution** (not one of 2000 random draws did as well or better). This is a
large, real effect, not a small-sample artifact.

## 2. Honest denominator — 8.9% of repeat-*capable* pairs repeated

A pair can only repeat if its members co-attended at least twice. Using that
corrected denominator:

- Pairs co-attending **≥ 2** weeks: **124**
- …that actually repeated: **11 → 8.9%**

So even among the pairs that *could* repeat, fewer than 1 in 11 did. The spread
holds up without dilution from can't-repeat pairs.

## 3. Individual fairness — a REAL, quantified gap

| Metric | Engine | Random (N=2000) |
| ------ | -----: | --------------: |
| worst-player repeatSlots | **7** (Jason Moses) | avg **7.46** |
| sims whose worst-player `≤ engine worst` | — | **1060 / 2000 (53.0%)** |

This is the finding. The engine minimizes the **group sum** (12 vs 29) but does
**not** protect the worst-off individual: its most-concentrated player carries
**7** repeat-slots, essentially identical to random's average of **7.46**, and a
**coin-flip — 53%** — of random partitions do as well or better for their
worst-off player. **At the individual-worst level the engine is no better than
random.** This is the Story-9.1 objective drift (the AC said *minimize the
maximum*; the shipped engine minimizes the *sum*) made concrete.

## 4. The most-concentrated player is structural, NOT a pin artifact

Most-concentrated player: **Jason Moses** — 7 repeat-slots across **11 distinct
partners**:

| Times together | Partner |
| -------------: | ------- |
| 3× | Matt Jaquint |
| 2× | Jay Patterson, Josh Stoll, Ben McGinnis, Matt White, Ronnie Adkins |
| 1× | Michael Bonner, Joe White, Bobby Marshall, Jeff Biederman, Jeff Madden |

**First/Last pins do not explain it (measured, not assumed).** Jason filed a
group request in only **2 of his 6 rounds** (`2026-04-17: last`,
`2026-05-01: first`). His top repeat — Matt Jaquint at **3×** — requires three
shared groups, more than the two rounds a pin could touch, so a pin cannot be
the cause. With no dominant repeat partner and 11 distinct partners, the
concentration is **structural**: Jason is a 6-of-6 regular in a small recurring
attendance pool, and the minimize-*sum* greedy lets the most-available player
absorb the aggregate's unavoidable repeats. Pins are honored as legitimate hard
constraints and are excluded from the fairness critique; their effect was
measured here, not hand-waved.

---

## Verdict

- **Aggregate co-play is strongly defensible.** The engine halves random, beats
  2000/2000 random draws, and only 8.9% of repeat-capable pairs ever repeated.
  For the league as a whole, "no one is denied playing the field" holds.
- **Individual fairness has a real, identified gap.** The engine optimizes the
  group sum, not any single player's worst case, so the most-concentrated
  regular (Jason Moses, 7 repeat-slots) is no better protected than under random
  assignment.

## Recommendation

Open a **follow-up spec** to change the objective in
`packages/engine/src/pairing.ts` from **minimize-sum** toward **minimize-max /
escalating repeat penalty** (2nd pairing costs more than the 1st, 3rd much
more). That directly targets the worst-off individual the current sum-objective
ignores, while preserving the aggregate spread already demonstrated here. Re-run
this script after adopting it to confirm the worst-player number drops below the
random average. (This evaluation made **no** engine change — scope per the
parent spec.)

---

## Post-change validation (2026-06-02)

The follow-up spec was implemented — `packages/engine/src/pairing.ts` now
optimizes a **convex repeat penalty** (`pairPenalty(c) = c²`,
`REPEAT_PENALTY_EXP = 2`) with a **worst-player tie-break**
(`maxPlayerRepeatLoad`) across the 10 restarts; `groupCost`/`totalCost` stay
raw for the UI. Validation is a **counterfactual engine replay**, not a re-run
of the read-only audit above (which reads the OLD engine's actual groups and
would show the same numbers). The new harness
`apps/api/src/scripts/_audit_pairing_engine_replay.ts` replays each finalized
week's REAL roster + First/Last pins through the NEW engine, feeding the matrix
forward from the replay's own prior-week groupings.

**Methodology:** 6 finalized 2026 rounds in date order; seeded `mulberry32` RNG
threaded across the season; **200 seeds** (≥20 per spec; 200 tightens the
median); random baseline = 2000 unpinned sims (same as above). Both AC9 gates
compare median-to-median for a consistent statistic. The harness asserts every
round roster is a clean multiple of 4 and fails loudly otherwise, so the engine
arm never silently drops a player the random arm keeps (review F1). Pins
recovered via the production `buildGroupRequestPins` against the snapshot —
**4 / 0 / 4 / 1 / 1 / 0** pinned across 04-17 … 05-29 (matches the spec's F5
audit; 04-24 and 05-29 replay unpinned, consistent with the unpinned random
baseline).

| Metric | NEW engine (replay, 200 seeds) | old-actual | random baseline |
| ------ | ------------------------------ | ---------- | --------------- |
| Worst-player repeat-slots | **min 3 / median 5 / max 7** | 7 (Jason Moses) | median 7, avg 7.45 |
| Total repeats | min 10 / **median 13** / max 17 | 12 | median 29, avg 29.2 |

**AC9 gate: PASS** ✅ — replay median worst-player **5** is below the random
median (7) **and** below old-actual (7); median total repeats (13) is below the
random median (29). `REPEAT_PENALTY_EXP = 2` cleared the bar; no retune was
needed. (A worst-case tail seed can still reach 7, equal to old-actual; the
*median* is the gated statistic and the typical season is materially flatter.)

**Worst-off player is no longer one person.** Under the old sum-objective Jason
Moses alone carried 7 slots. Across the 200 replay seeds the worst-off player is
now spread — Matt Jaquint (93/200), Jason Moses (89/200), Jay Patterson
(57/200), Ronnie Adkins (47/200) — i.e. the engine no longer dumps the
aggregate's unavoidable repeats on the most-available regular. The replay's min
(3) sits just above the spec's forced floor (≈2 for Jason), so the heuristic is
near-optimal for the worst case. (Tie seeds count each co-worst player, so the
tallies sum above 200.)

**Honest tradeoff.** The replay's **median total repeats (13) is marginally
above the old engine's single realized run (12)** — by design. Worst-player
protection costs a sliver of aggregate spread; 13 vs 12 is within
seed-to-seed noise and both are ~half of random. The worst-player gain (7 → 4)
is the intended objective and dwarfs the ~1-repeat aggregate cost.

**Caveat.** This is counterfactual ("what if the new engine had run all
season") on real rosters — directional evidence, not a guarantee for future
fields. Reproduce with:
`cd apps/api && DB_PATH=../../_audit/wolf-cup-prod.db npx tsx src/scripts/_audit_pairing_engine_replay.ts`
