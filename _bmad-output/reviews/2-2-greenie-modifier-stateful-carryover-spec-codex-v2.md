# Codex Review

- Generated: 2026-06-22T02:57:41.937Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/2-2-greenie-modifier-stateful-carryover.md

## Summary

Core money math in the three goldens is internally consistent with the existing 2v2 split rule (pts * (pv/2) per cross-edge). The corrected count-based model + “winner sweeps” carry fold yields a valid points-conservation invariant in AC10 *if* it’s scoped to (greenie enabled, carryover ON) and the settleable-prefix/barrier is computed from raw inputs. Biggest remaining money risk is the AC8 “BARRIER” depending on whether the engine supplies placeholder hole states for unplayed holes; if the holes list can be sparse, carry can still bridge across an absent par-3 and later be retroactively revalued/changed. There’s also a concrete naming/contract inconsistency in the spec about expected fixture/test field names (perPlayerCents vs perPlayerNetCents, totalCents vs ledgerTotalCents).

Overall risk: medium

## Findings

1. [high] AC8 BARRIER may not actually prevent carry bridging if the holes array can omit (unplayed) par-3s
   - File: _bmad-output/implementation-artifacts/tournament/2-2-greenie-modifier-stateful-carryover.md:62-63
   - Confidence: medium
   - Why it matters: AC8’s money-safety guarantee (“BREAK at the first incomplete par-3 so no later par-3 can collect a carry across an unplayed gap”) only holds if the resolver *sees* that gap as a par-3 with missing nets. If the engine’s `holes` input can be sparse (common pattern: only holes played/entered exist), then an unplayed par-3 simply won’t be iterated, so no barrier triggers and carry can incorrectly roll into a later par-3. That is exactly the retroactive money flip AC8 is trying to prevent.
   - Suggested fix: Clarify the input contract explicitly in AC8/Task 2: either (A) `computeFoursome` always receives all course holes 1..18 with missing nets represented (so the barrier is observable), or (B) the fold must consult course/hole metadata to detect missing holeNumbers that are par-3s and treat them as an immediate barrier. Add a unit test covering the sparse-hole case if it’s possible in production (e.g., holes contain H1(par3 complete unclaimed) and H5(par3 complete a1 box) but H3(par3) absent → H5 award must be 0).

2. [medium] Golden fixture/test contract naming is inconsistent (risk of wrong assertions or fixture shape drift)
   - File: _bmad-output/implementation-artifacts/tournament/2-2-greenie-modifier-stateful-carryover.md:88-91
   - Confidence: high
   - Why it matters: Task 4/AC11 references asserting `perPlayerCents` and `totalCents` (line 90), while the later “Golden harness” section describes the expected fixture shape as `expected:{perPlayerNetCents, edges, ledgerTotalCents}` (line 148) and Dev Notes use `perPlayer: ...` plus `ledgerTotalCents` (lines 126–130). If devs follow the wrong field names, you can get fixtures that load but don’t assert what you think, or tests that fail/are patched in unsafe ways (money story).
   - Suggested fix: Pick one canonical fixture contract and repeat it consistently in AC1/Task 4/Dev Notes. If you’re mirroring the existing `guyan-2v2` golden harness, use its exact keys everywhere (likely `perPlayerNetCents` + `ledgerTotalCents`). Update line 90 to match line 148 (or vice versa) so there’s zero ambiguity at implementation time.

3. [medium] AC10 conservation property needs explicit preconditions to avoid false failures (or accidentally testing the wrong thing)
   - File: _bmad-output/implementation-artifacts/tournament/2-2-greenie-modifier-stateful-carryover.md:68-70
   - Confidence: high
   - Why it matters: AC10 states a conservation invariant “(carryover ON)” but doesn’t explicitly say the property is conditioned on greenie being enabled and `carryover === true`. In Task 6 you also randomize `carryover` (line 103–105). If the property is executed when greenie is disabled (fold returns 0/0) or when carryover is OFF (unclaimed holes expire), RHS as written can be non-zero while LHS is zero, causing noisy failures or tempting developers to ‘fix’ the invariant incorrectly (money-safety regression).
   - Suggested fix: Make the property’s preconditions explicit in AC10 and Task 6: only assert the invariant when `greenieActive(config) && greenieCarryover(config) === true`. Alternatively, define two properties: ON-conservation (current invariant) and OFF-decay (e.g., LHS ≤ RHS and any pending carry is always 0).

4. [low] Unclaimed vs contested detection should define behavior for missing/undefined claims explicitly
   - File: _bmad-output/implementation-artifacts/tournament/2-2-greenie-modifier-stateful-carryover.md:56-61
   - Confidence: medium
   - Why it matters: The model relies on distinguishing “unclaimed (zero boxes)” vs “contested (rawA=0 but boxes exist)”. In real inputs, ‘no boxes checked’ may appear as `claims` missing entirely, `claims[playerId].greenie` undefined, or empty objects. If that isn’t explicitly normalized, implementation can accidentally treat ‘no data’ as contested/unclaimed incorrectly, altering carry behavior (especially increment vs preserve).
   - Suggested fix: In AC5/Task 2, explicitly define `checkedCount` as the number of foursome playerIds where `claims?.[playerId]?.greenie === true`, and define `zeroBoxes` as `(countA + countB) === 0` (treat missing claims as false). Add a small unit test for `claims` undefined/empty resulting in unclaimed behavior.

## Strengths

- All three golden hand-calcs are internally consistent with the engine’s 2v2 split: for pv=500, pts=3 → cross-edges 750 and per-player nets ±1500; pts=1 → edges 250 and nets ±500; pts=2 → edges 500 and nets ±1000 (lines 124–131).
- AC6 clearly defines won/unclaimed/contested transitions and explicitly calls out the two non-derivable money rules requiring ratification (winner-sweeps; contested preserves pot).
- AC8 correctly identifies the retroactive-money-risk of filtering incomplete par-3s and specifies BREAK semantics, plus tasks include a direct barrier regression test (lines 62–63, 97–98).
- Fail-closed variant allowlisting (AC11/Task 1) addresses the real hazard introduced by adding `carryover` to a shared `ModifierVariant` while keeping Zod `.strict()`.

## Warnings

None.
