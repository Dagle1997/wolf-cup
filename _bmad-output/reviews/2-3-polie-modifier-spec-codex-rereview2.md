# Codex Review

- Generated: 2026-06-22T16:13:10.605Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/2-3-polie-modifier.md

## Summary

The three previously raised spec issues appear resolved in this revision:

1) **Polie-additivity fast-check property constrained to flat PV**: AC9 now explicitly constrains the additivity property to a `{kind:'flat', cents}` schedule and states segmented front/back valuation is instead covered by goldens (AC9, lines 69–70; Task 6, lines 103–105).

2) **Order-independence explicitly tested (AC1(iv))**: AC1 now requires `polie.golden.test.ts` to recompute Fixture 1 with the `holes` array reversed and assert byte-identical ledger + edges (AC1, line 53; Task 4, lines 91–94). AC9/Task 6 also reiterate shuffle invariance.

3) **AC7 over-claim corrected**: AC7 now correctly scopes invariance to **reordering the input array** (each `HoleState` keeps its `holeNumber` → PV), and explicitly disclaims invariance to **renumbering** holes under segmented PV (AC7, line 65).

No new blocking contradiction is evident in the golden numbers (Fixtures 1–2), the count model, or the fail-closed allowlist as written. There are, however, two small remaining spec risks worth tightening before the money gate (below).

Overall risk: medium

## Findings

1. [medium] AC9 additivity property only asserts per-player cents for a1/b1, not all four players (can miss within-team misallocation)
   - File: _bmad-output/implementation-artifacts/tournament/2-3-polie-modifier.md:69-70
   - Confidence: high
   - Why it matters: AC9’s additivity check, as written, proves correctness for `perPlayerCents[a1]` (and `b1` as its negation) but does not require the same for `a2`/`b2`. A bug that redistributes cents within a team (e.g., a1 gets too much, a2 too little) could still satisfy (a) a1 formula, (b) b1 negation, and (c) global zero-sum/loss-less properties—yet be money-wrong per player. The goldens cover only fixed cases, so the property is the main broad net for this class of regression.
   - Suggested fix: In AC9/Task 6, require the property to assert the formula for **both** A players and both B players, e.g. `a1===a2===cents*ΣrawA` and `b1===b2===-cents*ΣrawA` (or assert equality within each team + sign). This keeps the test non-tautological while closing the redistribution gap.

2. [low] Fail-closed reason string uses `scope=` though the config key is `polieScope` (potential mismatch/confusion)
   - File: _bmad-output/implementation-artifacts/tournament/2-3-polie-modifier.md:71-75
   - Confidence: medium
   - Why it matters: AC10 specifies `polieScope` as the only allowed key for polie, but the “unknown value” reason string is defined as `unsupported_polie_variant:scope=${value}` (line 72). This is slightly inconsistent with the stated key name and with the other examples that embed the key name (e.g., `basis=${value}`, `bonus=${value}`). If implementation/tests naturally choose `polieScope=${value}` instead, you could get avoidable churn at the money gate over exact error strings.
   - Suggested fix: Either (a) explicitly justify that `scope=` is the canonical label for `polieScope`, or (b) align the string to `unsupported_polie_variant:polieScope=${value}` (or `:polieScope=${value}`) to match the actual variant key.

## Strengths

- AC1(iv) now explicitly adds a golden-level reversed-holes recomputation asserting byte-identical ledger+edges (order-independence is no longer implicit).
- AC7 now correctly scopes invariance to array order (not renumbering) and ties PV correctness to `holeNumber` under segmented schedules.
- AC9/Task 6 correctly constrain the additivity property to flat PV and defer segmented PV valuation coverage to goldens, avoiding an incorrect ‘single constant’ assumption.
- Fixtures 1–2 hand-calc numbers are internally consistent with the stated point-value semantics (PV=500, total rawA=+2 ⇒ per-player ±1000, ledgerTotalCents=2000; all-push/no-claim ⇒ empty edges, total 0).
- Fail-closed allowlist is explicitly enumerated per modifier and includes cross-modifier rejection of stray `polieScope`, aligning with the 2.2 pattern of rejecting misplaced known levers.

## Warnings

None.
