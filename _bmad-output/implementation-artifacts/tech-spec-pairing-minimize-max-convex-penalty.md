---
title: 'Worst-Player-Protecting Pairing — Convex Repeat Penalty + Tie-Break'
slug: 'pairing-minimize-max-convex-penalty'
created: '2026-06-02'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['TypeScript', '@wolf-cup/engine (pure, zero-dep)', 'Vitest']
files_to_modify: ['packages/engine/src/pairing.ts', 'packages/engine/src/pairing.test.ts', 'apps/api/src/scripts/_audit_pairing_engine_replay.ts (new — counterfactual validation)']
code_patterns: ['engine pure zero-dep functions', 'Fisher-Yates + 10 random restarts keep lowest cost', 'raw pair counts live in pairingHistory; cost transform happens at read time']
test_patterns: ['engine unit tests in packages/engine/src/*.test.ts', 'property-based assertions (group sizes, all-assigned, remainder) survive cost changes', 'reproducible balance audit via _audit_pairing_balance.ts against _audit/wolf-cup-prod.db']
---

# Tech-Spec: Worst-Player-Protecting Pairing — Convex Repeat Penalty + Tie-Break

**Created:** 2026-06-02

## Overview

### Problem Statement

The pairing engine (`suggestGroups`, `packages/engine/src/pairing.ts`) minimizes the **group SUM** of raw pair counts. The co-play balance evaluation (`_bmad-output/implementation-artifacts/pairing-balance-evaluation.md`, verified against the real prod snapshot) proved this halves random aggregate repeats (12 vs 29.2; 0/2000 sims beat it) **but does not protect the worst-off individual**: the most-concentrated regular (Jason Moses) carries **7 repeat-slots ≈ random's 7.46**, and **53% of random partitions do as well or better** for their worst player. Because every additional pairing costs the same marginal "+1" under a sum objective, the most-available regular absorbs the league's unavoidable repeats. This is the Story-9.1 objective drift — AC3 specified *minimize-the-maximum* + balance across groups, but the shipped engine minimizes the sum.

### Solution

Two complementary levers — and an honest note on what each does (per adversarial review F1):

1. **Convex repeat penalty** — weight each grouped pair by `pairPenalty(c) = c²` (on its *historical* count) instead of the raw count, so re-pairing an already-high pair costs far more (3rd pairing marginal +5 vs 1st +1). **This is still a *sum* objective, reweighted** — it strongly discourages *pair* concentration but, on its own, does not directly minimize the worst *player's* total (a player accumulating many distinct count-1 partners is barely touched, since a fresh pairing still costs only 1). So:
2. **Worst-player tie-break** — across the existing 10 random restarts, when the convex cost ties, prefer the assignment that **minimizes the most-loaded player** (the max over players of the summed historical counts with their assigned groupmates). This is the lever that directly targets the actual objective (protect the worst-off individual); the convex penalty narrows the field, the tie-break picks the flattest-per-player option within it.

Both are drop-in changes to cost computation/selection — the pure greedy + Fisher-Yates + restarts structure and the First/Last hard pins are unchanged. `pairingHistory` continues to store **raw counts**; the transforms happen only at cost/selection time, and the returned `totalCost` stays raw for the UI.

### Scope

**In Scope:**
- Convex (quadratic, `c²`) penalty applied to pair counts in the engine's penalty cost (greedy incremental step + restart selection). `groupCost` stays raw.
- A **worst-player tie-break** across the 10 random restarts in `suggestGroups` (lowest max-player-load breaks equal penalty cost).
- Optional injectable `rng` (default `Math.random`) for deterministic tests + reproducible replay.
- Engine unit tests for the new cost/selection semantics (property-based + discriminating convex/tie-break fixtures).
- A counterfactual **engine-replay** harness to **validate** the worst-player repeat-slots drop below the random *median* AND below the old-actual 7, while total repeats stay well under random (29.2).

**Out of Scope:**
- **Recency weighting** (penalizing the same pair two weeks running) — deferred to a separate future spec (Josh, 2026-06-02).
- **Hard lexicographic minimize-max** as the primary objective — rejected in favor of the convex-penalty + tie-break approach (Josh, 2026-06-02).
- Any schema / persistence change (`pairingHistory` stays raw counts).
- Any change to First/Last pin handling, group sizes, batting order, or UI.
- Backfilling or re-deriving historical pairings.

## Context for Development

### Codebase Patterns

- **Engine is pure & zero-dep:** `packages/engine/src/pairing.ts`. `suggestGroups({matrix, playerIds, pins, groupSize})` runs 10 random restarts (Fisher-Yates shuffle of unpinned players, `pairing.ts:92-96` → greedy lowest-**incremental**-cost assignment, `:100-122`), then `:124-131` keeps the assignment with the lowest `totalCost` (computed via `groupCost`, `:124`). `groupCost(matrix, group)` (`:34-42`) = Σ over C(n,2) pairs of `matrix.get(pairKey) ?? 0`. **This is the only place the objective lives.**
- **`groupCost` is used ONLY inside the engine** (`pairing.ts:124` + tests) — verified via grep; no external caller. Safe to add a *parallel* penalty cost without changing `groupCost`'s public meaning.
- **`totalCost` IS surfaced in two UIs** (corrected per review F3) — `result.totalCost` renders *"Repeat pairing cost: {n}"* in: (a) `apps/web/src/routes/admin/rounds.tsx:1573` **with `heatColor()`** (green/yellow/red, thresholds at `rounds.tsx:1169-1173`: 0→green, ≤2→yellow, else red), and (b) `apps/web/src/routes/attendance.tsx:603` (NOT under `admin/`) as a **plain `font-semibold` span, no heatColor**. ⇒ **Keep the returned `totalCost` as the RAW repeat-weight** — the `rounds.tsx` heatColor thresholds are tuned to raw magnitudes; optimize on the convex penalty internally only.
- **Matrix = raw pair counts**, built from `pairingHistory` (season-scoped) by both callers (`admin/rounds.ts:1252` from-attendance and `admin/pairing.ts:143` suggest). The transform lives inside the engine so BOTH callers get it free — callers pass raw counts unchanged; `pairingHistory` write path (`recordPairings`, `admin/rounds.ts:37-65`, +1 per grouped pair at finalize) is untouched.
- **Non-deterministic** by design (Math.random in shuffle/restarts). Tests assert **properties** (sizes, all-assigned, remainder); the few `totalCost` assertions use RAW values (`pairing.test.ts:19=6`, `:138=0`, `:153=6`) → **all still pass** under the keep-raw-totalCost design. Zero existing tests break.
- **First/Last pins** are hard constraints applied before the greedy fill (`pairing.ts:83-89`); unchanged. Recoverable per week from `attendance.group_request` — the replay validation will honor them for an apples-to-apples comparison.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `packages/engine/src/pairing.ts` | `groupCost` (keep raw) + new `pairPenalty`/`groupPenaltyCost`/`maxPlayerRepeatLoad` + `suggestGroups` selection + worst-player tie-break + optional `rng` |
| `packages/engine/src/pairing.test.ts` | property-based tests; existing ones unchanged; ADD convex-selection, tie-break, deterministic-rng cases |
| `apps/web/src/routes/admin/rounds.tsx:1573` (+ `heatColor` `:1169-1173`) and `apps/web/src/routes/attendance.tsx:603` (plain span) | render `totalCost` — confirm display unchanged (no edit expected) |
| `_bmad-output/implementation-artifacts/pairing-balance-evaluation.md` | metric definitions + baselines (old-actual 7/12; random 7.46/29.2) this must beat |
| `apps/api/src/scripts/_audit_pairing_balance.ts` | random baseline + metric helpers to reuse in the replay harness |

### Technical Decisions

- **Keep `totalCost` RAW for display; optimize on convex internally** (investigation, 2026-06-02) — add `pairPenalty(c)=c²` + a penalty-cost used for restart SELECTION and the greedy incremental step, but return `totalCost = groupCost(raw)` of the chosen assignment. Preserves the admin "Repeat pairing cost" UI + `heatColor` thresholds and breaks no existing test.
- **The mechanism is reweighted-sum + worst-player tie-break, NOT true min-max** (review F1, 2026-06-02). `Σ c²` is still a sum objective; it discourages high-count *pairs* but not a player with many distinct count-1 partners. The **tie-break is the lever that targets the worst player**: key = `maxPlayerRepeatLoad` = max over players of `Σ (historical count with each assigned groupmate)`; lower wins when penalty cost ties. Extract `maxPlayerRepeatLoad` as an exported, unit-testable helper. (Helper name avoids collision with the existing per-group `maxPairCount` response field in `admin/pairing.ts:181` — review F4.)
- **Quadratic `c²`, exposed as a named constant** `REPEAT_PENALTY_EXP = 2` (Josh, 2026-06-02) — marginal 2nd/3rd/4th pairing = +3/+5/+7; `penalty(0)=0` keeps new pairings free. Named (not inlined) so it's the retune escape hatch if AC9 underdelivers.
- **Feasibility is proven, not assumed** (review F2, 2026-06-02). The worst player (Jason) needs 18 partner-slots (3/wk × 6 wks) and co-attends 19 distinct players across his weeks → a fresh-first lower bound is **≈ 2 forced repeat-slots**, well under random's 7.46. So AC9's bar is **arithmetically reachable**; the residual risk is *heuristic quality* (greedy + 10 restarts finding a near-global assignment for all players at once), not arithmetic — not a hand-waved "raise the exponent."
- **Add optional `rng?: () => number` to `SuggestGroupsInput`** (default `Math.random`) — keeps the engine pure while enabling deterministic tie-break tests AND a reproducible engine replay. Used at the shuffle (`pairing.ts:94`). The replay supplies `mulberry32(seed)`; determinism also relies on stable `Map` iteration order (true in V8) (review F10).
- **Recency weighting out of scope** (Josh, 2026-06-02).
- **Validation = counterfactual engine REPLAY, not re-running the read-only audit.** `_audit_pairing_balance.ts` reads ACTUAL historical groups (old engine) — re-running shows the *same* numbers. A new sibling `_audit_pairing_engine_replay.ts` replays each finalized week's real roster + pins through the NEW `suggestGroups` (seeded `rng`), feeding pairingHistory forward week-by-week, then reports the new engine's worst-player repeat-slots + total repeats vs old-actual (7/12) and the random baseline (7.46/29.2). **Bar (strengthened per review F7): new-engine worst-player below the random *median* AND below the old-actual 7**, with total repeats well under random (29.2), reported as a min/median/max distribution over ≥20 seeds (not just an average vs a 2000-sim mean).

## Implementation Plan

### Tasks

- [x] **Task 1: Convex-penalty primitives (no behavior change yet)**
  - File: `packages/engine/src/pairing.ts`
  - Action: add `export const REPEAT_PENALTY_EXP = 2;` and `export function pairPenalty(count: number): number` → `count <= 0 ? 0 : count ** REPEAT_PENALTY_EXP`. Add `export function groupPenaltyCost(matrix, group): number` — mirrors `groupCost` but sums `pairPenalty(matrix.get(pairKey) ?? 0)`. Add `export function maxPlayerRepeatLoad(matrix, groups): number` — for each player in each group, `load = Σ over groupmates q of (matrix.get(pairKey(p,q)) ?? 0)`; return the **max load over all players** (0 if none).
  - Notes: **`groupCost` stays UNCHANGED (raw sum)** — it feeds the displayed `totalCost`. `pairPenalty(0)=0` so brand-new pairings are free; weight is on the *historical* count so a pair already at count 2 costs 4 to re-pair vs 1 at count 1. Helper is `maxPlayerRepeatLoad` (worst *player*), deliberately distinct from the per-group `maxPairCount` field in `admin/pairing.ts:181` (review F4).

- [x] **Task 2: Optimize on the convex penalty; tie-break on the worst player; keep `totalCost` raw**
  - File: `packages/engine/src/pairing.ts` (`suggestGroups`)
  - Action: (a) greedy incremental step (`:107-110`) — sum `pairPenalty(matrix.get(...) ?? 0)` instead of the raw count. (b) restart selection (`:124-131`) — compute `penaltyCost = Σ groupPenaltyCost` and `thisLoad = maxPlayerRepeatLoad(matrix, currentGroups)`; track `bestPenalty`/`bestLoad` (both init `Infinity`); replace best when `penaltyCost < bestPenalty` **OR** (`penaltyCost === bestPenalty` AND `thisLoad < bestLoad`). (c) return `totalCost = Σ groupCost(raw)` of the chosen `bestGroups`.
  - Notes: penalty drives BOTH the greedy and the selection (consistent); the worst-player tie-break is what actually targets the objective (review F1); raw `totalCost` computed once at the end for display. Remainder logic unchanged. **Greedy caveat (review F8):** because `pairPenalty(0)=0`, the greedy is byte-identical to the old raw greedy whenever every candidate group is all-fresh (low-history weeks); it only diverges once a candidate group already contains a prior partner. The tie-break carries the load in low-history weeks.

- [x] **Task 3: Inject an optional deterministic RNG**
  - File: `packages/engine/src/pairing.ts`
  - Action: add `readonly rng?: () => number;` to `SuggestGroupsInput`; `const rng = input.rng ?? Math.random;` and use `rng()` in the Fisher-Yates shuffle (`:94`).
  - Notes: keeps the engine pure (caller supplies the seed); required for the deterministic tie-break test and the reproducible replay harness. Default `Math.random` → production behavior unchanged. The shuffle is the only nondeterministic source; given a fixed shuffle the greedy + selection are deterministic (also relies on stable `Map` iteration order, true in V8 — review F10).

- [x] **Task 4: Engine unit tests**
  - File: `packages/engine/src/pairing.test.ts`
  - Action: ADD —
    - `pairPenalty` (0/1/2/3 → 0/1/4/9); `groupPenaltyCost` convex sum; `maxPlayerRepeatLoad` (hand-computed fixture).
    - **Discriminating convex test (review F11 — the old AC4 fixture did NOT distinguish convex from raw):** construct a choice where raw-sum **ties** but convex differs — e.g. an arrangement putting two count-1 pairs in one group (raw 2, convex 1+1=2) vs one count-2 pair in a group (raw 2, convex 4). Under raw the engine is indifferent; under `c²` it must prefer the two-count-1 arrangement. Assert the convex engine picks it (seeded, large majority).
    - **Worst-player tie-break:** two assignments with EQUAL penalty cost but different `maxPlayerRepeatLoad`; under a fixed seeded `rng` the lower-load one is chosen (assert via the exported helper + a crafted matrix).
    - **Determinism:** same inputs + fixed seeded `rng` → identical groups twice.
    - **Raw `totalCost`:** returned value is the raw pair-count sum, not the penalty sum.
    - **Re-confirm the existing `≥0.8` separation test (`:90-114`) still passes under the convex greedy** (review F9 — counts 10 → convex 100 vs raw 10, still strongly separated; keep it as a deliberate regression check).
    - Pins + all other existing property tests remain unchanged and must stay green.

- [x] **Task 5: Counterfactual engine-replay validation harness**
  - File: `apps/api/src/scripts/_audit_pairing_engine_replay.ts` (new)
  - Action: read the 6 finalized rounds in date order from `_audit/wolf-cup-prod.db`. For each week: roster = that round's `round_players`; run the NEW `suggestGroups` with `rng = mulberry32(seed)` and the matrix accumulated from the REPLAY's own prior-week groupings (NOT history). Accumulate pair counts. After all weeks compute worst-player `repeatSlots` + `totalRepeats`. Repeat across **≥20 seeds** → report **min / median / max** worst-player (not just an average). Compare to old-actual (7/12) and the random baseline (reuse `mulberry32` + the `totalRepeats`/`repeatSlotsByPlayer` helpers from `_audit_pairing_balance.ts`).
  - **Pin handling (review F5/F6 — measured, not assumed):** `attendance.group_request` rows in the snapshot cover only **04-17 (4), 05-01 (4), 05-08 (1), 05-15 (1)**; weeks **04-24 and 05-29 have ZERO pins**, and the lone **05-22** row belongs to the rained-out non-replay week (ignore it). So 2 of 6 replay weeks run unpinned — consistent with the random baseline, which is also unpinned. To avoid pin-translation drift, **run the harness with `DB_PATH=_audit/wolf-cup-prod.db` so the drizzle `db` points at the snapshot and the replay can call the production `buildGroupRequestPins` directly** (rather than re-implementing the first-click-wins overflow logic); the engine + harness still read rosters via the audit libsql client. If reuse proves impractical, re-implement the overflow logic and assert parity against `buildGroupRequestPins` on the pinned weeks.
  - Notes: counterfactual ("what if the new engine had run all season"); directional evidence, not a guarantee for future fields. Engine importable via `@wolf-cup/engine`.

- [x] **Task 6: Validate + record results**
  - Files: run Task 5; append a "Post-change validation" section to `_bmad-output/implementation-artifacts/pairing-balance-evaluation.md`
  - Action: run the replay; record the new-engine worst-player **min/median/max** + total-repeats vs old-actual (7/12) and random (median + 7.46 avg / 29.2), with the seed methodology and the which-weeks-pinned note. **Pass condition: median worst-player < random median AND < old-actual 7.** If unmet, raise `REPEAT_PENALTY_EXP` (e.g. 3) and re-run, documenting the final value.
  - Notes: data-backed proof, mirroring how the original evaluation was earned rather than asserted. Also report the random *median* worst-player (the harness should compute it, since "below the average" is a weak bar — review F7).

### Acceptance Criteria

- [x] **AC1 (convex primitive):** Given `pairPenalty`, when called with 0/1/2/3, then it returns 0/1/4/9 (`c²`).
- [x] **AC2 (new pairings free):** Given a group whose pairs have no history, when `groupPenaltyCost` is computed, then it is 0 — a first-time pairing is never penalized.
- [x] **AC3 (display unchanged):** Given any suggestion, when `suggestGroups` returns, then `totalCost` equals the RAW Σ of grouped-pair counts (not the penalty sum), so `rounds.tsx:1573` (+ `heatColor`) and `attendance.tsx:603` render exactly as before.
- [x] **AC4 (convex discriminates from raw):** Given a choice where the raw-sum cost **ties** but the convex cost differs — two count-1 pairs in one group (raw 2 / convex 2) vs one count-2 pair in a group (raw 2 / convex 4) — when `suggestGroups` runs across N seeded restarts, then it picks the lower-**convex** arrangement (two count-1 pairs) in the large majority of runs, whereas the raw engine would be indifferent. (This fixture, unlike a count-2-vs-count-1 choice, actually proves the convex change matters — review F11.)
- [x] **AC5 (worst-player tie-break):** Given two assignments with EQUAL convex penalty cost but different `maxPlayerRepeatLoad`, when selection runs under a fixed seeded `rng`, then the assignment with the lower max-player-load (the flatter-per-player option) is chosen.
- [x] **AC6 (determinism):** Given identical `playerIds`/`matrix`/`pins` and a fixed seeded `rng`, when `suggestGroups` is called twice, then it returns identical groups (relies on the injected `rng` + stable `Map` order).
- [x] **AC7 (pins still hard):** Given First/Last pins, when `suggestGroups` runs, then each pinned player is in its pinned group (behavior unchanged).
- [x] **AC8 (no regression):** Given the pre-existing engine test suite, when run after the change, then every prior test still passes — including the `≥0.8` separation test (`:90-114`) under the convex greedy (raw `groupCost`/`totalCost` semantics intact).
- [x] **AC9 (validation — the real bar):** Given the counterfactual replay over the 6 finalized 2026 rounds (seeded, history fed forward; pins on 4 weeks, 2 weeks unpinned per F5), when the NEW engine's season is simulated across **≥20 seeds**, then the **median** worst-player repeat-slots is **below the random median AND below the old-actual 7**, while total repeats stay **well under random (~29.2)**; the min/median/max distribution is recorded in `pairing-balance-evaluation.md`. Feasibility is pre-established (forced floor ≈ 2, decision log); if the bar is missed it indicates heuristic quality, so raise `REPEAT_PENALTY_EXP` and re-validate, documenting the final value.

## Additional Context

### Dependencies

- No new libraries. Engine stays pure + zero-dep. Reuses `pairKey`, the `pairingHistory` read path, the `mulberry32` PRNG + `totalRepeats`/`repeatSlotsByPlayer` helpers from `_audit_pairing_balance.ts`, and — for pinned replay weeks — the production `buildGroupRequestPins` (called with `DB_PATH=_audit/wolf-cup-prod.db` so drizzle sees the snapshot; review F6). The replay script imports the engine via `@wolf-cup/engine`.
- No DB / schema / migration changes. No API or web changes (callers pass raw counts unchanged; `totalCost` display is preserved).

### Testing Strategy

- **Unit (engine, Vitest):** `pairPenalty`, `groupPenaltyCost`, `maxPlayerRepeatLoad`; the **discriminating** convex fixture (raw-tie / convex-break, AC4); worst-player tie-break (seeded, deterministic); determinism with a fixed `rng`; raw-`totalCost` assertion; the existing `≥0.8` separation test re-confirmed; pins unchanged. **All pre-existing `pairing.test.ts` cases must remain green** (they assert raw values — that's the guardrail that the display semantics didn't drift).
- **Validation (data-backed):** the counterfactual replay harness vs old-actual (7/12) and the seeded random baseline (median + 7.46 avg / 29.2), as a min/median/max distribution over ≥20 seeds. Hand-spot-check one replayed week's grouping.
- **No API/web tests** — both `suggestGroups` callers and the `totalCost` display are unchanged.
- **Manual (optional):** open the admin Suggest panel and confirm "Repeat pairing cost" still renders sensible raw numbers and groups look balanced.

### Notes

- **Pre-mortem risks:**
  - *Greedy/selection desync* — if the greedy used the penalty but selection used raw (or vice-versa), it would optimize inconsistently. Mitigation: penalty drives BOTH the greedy incremental step and the restart selection; raw is computed only at the end for display.
  - *Penalty on count vs marginal* — DECISION: weight = `pairPenalty(historicalCount)` with `penalty(0)=0` (new pairings free), which convexly steers away from already-high pairs. Not the marginal `penalty(c+1)−penalty(c)` (which would charge 1 even for a brand-new pairing).
  - *Convex penalty is reweighted-sum, not min-max* (review F1) — on its own it discourages high-count *pairs*, not a player with many distinct fresh partners. The **worst-player tie-break** (`maxPlayerRepeatLoad`) is the lever that targets the actual objective; don't rely on `c²` alone to lower the worst player.
  - *Greedy unchanged in low-history weeks* (review F8) — with `penalty(0)=0`, an all-fresh candidate group has incremental cost 0 (identical to raw), so early-season weeks behave exactly as today; the change only bites once a candidate group holds a prior partner. The tie-break does the work in those weeks.
  - *Replay pin recovery is partial* (review F5) — pins exist only for 04-17/05-01 (4 each) + 05-08/05-15 (1 each); 04-24 and 05-29 replay unpinned, and the 05-22 pin row is a rained-out non-replay week (ignore). Consistent with the unpinned random baseline; stated so "honors real pins" isn't overclaimed.
  - *Replay is counterfactual* — it validates "what if the new engine had run all season" on real rosters; directional evidence, not a guarantee for future fields. State this in the results.
- **Feasibility (review F2):** the worst player's forced-repeat lower bound is ≈ 2 (Jason needs 18 partner-slots, co-attends 19 distinct), so AC9's bar is arithmetically reachable; residual risk is heuristic quality (greedy + 10 restarts), not arithmetic.
- **Known limitations:** greedy + 10 restarts is a heuristic — the convex penalty + worst-player tie-break *improve* the worst case but don't guarantee a global optimum. Acceptable for league sizes (≤ ~20 players).
- **Future considerations (out of scope):** recency weighting (separate spec); promoting `REPEAT_PENALTY_EXP` to runtime config if retuning becomes frequent; if a future change ever makes the displayed `totalCost` convex, recalibrate the `heatColor` thresholds in `rounds.tsx`/`attendance.tsx` (left raw here precisely to avoid that).

## Review Notes

- Adversarial review completed (2026-06-02) — two independent reviewers: a fresh BMAD adversarial-review subagent (diff-only, information-asymmetric) + external Codex (`gpt-5.2`, high effort). Both converged on the same top finding.
- **Findings: 5 real fixed, rest documented/cosmetic.** Resolution approach: auto-fix the real ones.
  - **F1 (High, both reviewers):** replay engine-arm could silently drop remainder players when a roster isn't a multiple of 4, while the random arm keeps everyone → biased comparison. *Verified all 6 snapshot rounds are clean groups of 4, so the reported numbers were unbiased*, but added an upfront roster-shape guard (and per-week `remainder===0` assertion) that **fails loudly** if a future snapshot violates it.
  - **F2 (Med, both):** injected `rng()` was unclamped — a `>=1` value could index the shuffle out of bounds. Clamped the Fisher-Yates index to `[0, i]` and documented the `[0,1)` contract.
  - **F3 (Med, both):** removed the `bestGroups!` non-null assertion in favor of a defensive guard (a NaN penalty would otherwise crash).
  - **F4 (Low):** documented that `REPEAT_PENALTY_EXP` must stay a positive integer (the tie-break uses exact `===` on integer penalties).
  - **F10 (Low):** harness AC9 gate now compares median-to-median for both metrics (was median-vs-avg on total).
  - Documented-limitation / cosmetic (no code change): tie-break is restart-shallow (already spec F1/F8); single-rng correlated seasons (mitigated by bumping seeds 50 → 200); even-length median; worst-player tally double-counts ties ("for color").
- **Post-fix validation:** engine suite 538/538, full workspace typecheck clean, replay re-run at 200 seeds → **AC9 PASS** (median worst-player 5 < random median 7 and < old-actual 7; median total 13 < random median 29).
