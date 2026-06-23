# Codex Review

- Generated: 2026-06-23T15:20:17.990Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/3-3-per-hole-f1-money-or-defer.md

## Summary

Spec is strong on money-safety (golden-first gate, exposure mirroring, recompute-on-read pinned inputs) and gives an implementation path that should be mechanically straightforward. The main remaining risks are (a) unit/rounding ambiguity around `moneyNet`/`pv` and the “whole-dollar” claim, (b) semantic ambiguity in the per-hole fields (notably `teamADeltaCents`), and (c) a couple of assumptions that need explicit confirmation to avoid silent regressions (what exactly `ledger.totalCents` represents; whether “settled hole” is *exactly* the engine’s settleability gate). A few items require a human/product decision (organizer visibility when unlocked; what units the API contract guarantees).

Overall risk: medium

## Findings

1. [high] `moneyNet` “whole-dollar” guarantee is not justified by “pv is even” (units/rounding ambiguity)
   - File: _bmad-output/implementation-artifacts/tournament/3-3-per-hole-f1-money-or-defer.md:47
   - Confidence: high
   - Why it matters: The spec asserts: “`moneyNet` is whole-dollar … engine already throws if `pv` is odd; the per-hole product `pts*pv` is therefore whole-dollar.” Even if `pv` is forced even (so `pv/2` is integer cents), that only guarantees integer **cents**, not a multiple of 100 cents (whole dollars). If any config ever sets `pv=50` cents (or any non-$1 increment), you’d correctly compute integer cents but violate the “whole-dollar” promise—risking UI formatting bugs, bad tests, or (worse) rounding introduced later to force whole dollars. This is money-bearing and golden-gated, so the contract must be explicit.
   - Suggested fix: Decide and document the API contract: is `moneyNet` **cents** (integer) or **dollars** (integer)? If it’s cents, remove the “whole-dollar” claim and test only integer cents. If it must be whole dollars, add an explicit invariant `pv % 100 === 0` (or `teamADeltaCents % 100 === 0`) and a test/validation that fails if a non-dollar pv is configured.

2. [high] Exposure gate may be too strict for organizer/private views; needs explicit product decision
   - File: _bmad-output/implementation-artifacts/tournament/3-3-per-hole-f1-money-or-defer.md:36-50
   - Confidence: medium
   - Why it matters: The spec hard-requires money exposure only when `f1MoneyEnabled() && lockState==='locked'` and applies this inside `computeF1PerHoleMoneyForPlayer` (lines 36, 45, 49–50). That mirrors the **leaderboard** policy, but scorecard access is already “participant-or-organizer” (line 49). If organizers are allowed to view money while unlocked (common operational need), or if “during-round scorecard” is treated as a private surface for participants, this gate will under-expose (money always null) and could be perceived as a regression or block internal workflows. This is not mechanically fixable without a decision because it’s policy, not implementation detail.
   - Suggested fix: Add an explicit AC clarifying whether organizers (and/or the player viewing their own scorecard) can see per-hole money when `lockState!=='locked'`. If yes, define the exact audience rules (e.g., organizer always; player only for self) and ensure it stays “no wider than intended.” If no, explicitly state that even organizers won’t see per-hole money until locked, and confirm that’s acceptable.

3. [medium] `teamADeltaCents` field name/meaning is ambiguous (per-player vs per-team) and can cause downstream misuse
   - File: _bmad-output/implementation-artifacts/tournament/3-3-per-hole-f1-money-or-defer.md:43
   - Confidence: high
   - Why it matters: AC#2 defines `teamADeltaCents = teamPointsA * pv` and parenthetically calls it “a teamA player's per-hole cents” (line 43). The name reads like a **team total** delta, which would be `2 * teamPointsA * pv` in a 2v2. This ambiguity is especially risky because the spec also proposes deferring other consumers (money-detail/My Money) that will later read this field (lines 114–117); a future implementer could easily treat it as team-total and double-count.
   - Suggested fix: Rename to something unambiguous (e.g., `teamADeltaPerPlayerCents` or `perPlayerDeltaCentsForTeamA`) or change semantics to store both: `teamADeltaTeamTotalCents` and `teamADeltaPerPlayerCents`. Update the golden fixture fields to match, so future consumption is forced to be correct.

4. [medium] Loss-less invariant using `ledger.totalCents` assumes a specific definition of total that may not hold
   - File: _bmad-output/implementation-artifacts/tournament/3-3-per-hole-f1-money-or-defer.md:41
   - Confidence: medium
   - Why it matters: AC#1 requires `Σ_holes |teamADelta| * 2 === ledger.totalCents` (line 41) and repeats it in Dev Notes (line 101). This is correct **if** `totalCents` equals the sum of absolute cross-edge transfers (4 edges × `|half|`) aggregated across holes. If `totalCents` is instead defined elsewhere as sum of absolute per-player nets, sum of winners, pot size, etc., the invariant will fail or (worse) pass sometimes and fail on modifiers/carryovers. Since the spec is evidence-based but doesn’t quote the actual `totalCents` definition, this is a correctness-risky assumption.
   - Suggested fix: In the spec, explicitly define `Ledger.totalCents` in terms of existing engine behavior (e.g., “sum of absolute edge amounts output by `ledgerToEdges`”). Alternatively, make the golden assert a more direct invariant that’s definition-independent: `sumPositive(perPlayerCents)==sumNegativeAbs(perPlayerCents)` and/or `Σ_holes Σ_edges(abs(edgeAmount)) == Σ_edges(abs(roundEdges))` (whichever matches current semantics).

5. [medium] “Settled hole” is specified as ‘all four nets present’ but settleability may include additional gates; perHole rows must align exactly with what contributes to settlement totals
   - File: _bmad-output/implementation-artifacts/tournament/3-3-per-hole-f1-money-or-defer.md:43
   - Confidence: medium
   - Why it matters: AC#2 equates “passes the complete-cell gate (all four members have a net)” with “a settled hole” (line 43). In practice, the engine’s settleability might also depend on course snapshot integrity (par/stroke index present), modifier claim validity, or other invariants. If `perHole` emits a row for a hole that later doesn’t affect `cross/perPlayerCents` (or vice versa), you can break the decomposition invariants or show `$0/—` inconsistently on the scorecard.
   - Suggested fix: Tighten the AC wording: define a “settled hole” as “a hole for which the engine would include its `pts/pv` in cross accumulation” (i.e., identical gating). In tests, assert `perHole` rows correspond 1:1 with holes that affect the computed `cross/perPlayerCents` (not just “nets present”).

6. [low] Golden-safety claim focuses on existing assertions but ignores TypeScript shape changes and any snapshot/deep-equal consumers outside cited tests
   - File: _bmad-output/implementation-artifacts/tournament/3-3-per-hole-f1-money-or-defer.md:37-38
   - Confidence: medium
   - Why it matters: The spec claims adding `Ledger.perHole` “cannot break” existing goldens because they assert only specific fields (line 37). Even if those two cited tests don’t deep-equal the full ledger, adding a non-optional field can still break compilation (fixtures constructing `Ledger`), snapshot tests elsewhere, or any `toEqual(ledger)` comparisons not mentioned. This is likely manageable but the “cannot break” statement is stronger than the evidence provided.
   - Suggested fix: Soften/qualify the claim: “should not break the cited goldens; verify no other tests snapshot the full ledger.” Consider making `perHole` optional in the type (or always default to `[]`) to reduce incidental breakage, while still populating it from `computeFoursome`. Add a quick grep task in dev notes: search for `toEqual(ledger)` / snapshots of Ledger.

## Strengths

- Strong money-safety posture: golden-first hard gate with explicit decomposition invariants and Josh approval checkpoint (lines 41–42, 78–79).
- Good user-visible semantics: push hole emits `$0` vs incomplete hole emits `null/—` (line 43, line 47).
- Chokepoint discipline is clear: compute/expose only via `games-money.ts`, fail-closed on unsettleable inputs, and reuse pinned path (lines 45–46, 51–52, 109–113).
- Clear exposure model mirroring existing surfaces and explicit non-goal of audience refinement (lines 36, 49–50).
- Test plan is appropriately multi-layered (engine golden + unit + service + route integration) and includes reconciliation against event edges (lines 53–58, 112).
- Scope guardrails and forbidden paths are explicitly called out, reducing cross-package blast radius (line 60).

## Warnings

None.
