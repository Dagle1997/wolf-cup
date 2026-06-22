# Codex Review

- Generated: 2026-06-22T03:05:10.574Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/2-2-greenie-modifier-stateful-carryover.md

## Summary

Round-3 re-review of the spec only (no code diff provided). The four prior findings appear resolved in the current spec text:
- AC8 now explicitly requires a DENSE `holes` array and positions the barrier as a BREAK (not a filter), with Task 3b updating `games-money.ts` as the chokepoint and adding a specific “unplayed par-3 between complete par-3s” test.
- Golden harness key naming is reconciled to `expected.perPlayerNetCents / expected.edges / expected.ledgerTotalCents` asserted against `ledger.perPlayerCents / ledgerToEdges / ledger.totalCents`.
- AC10 conservation property now states explicit preconditions and confines the sum to the settleable contiguous-complete par-3 prefix.
- AC5 now defines “checked” strictly as `claims[pid]?.greenie === true`, treating absent/undefined/false as unchecked.

The three golden hand-calcs (Fixtures 1–3) remain internally consistent with AC5–AC7 and unchanged.

One NEW spec risk remains around the dense-holes construction: “in-play holes” is referenced but not precisely defined, which can cause an incorrect dense-hole set (and thus an incorrect AC8 barrier) in non-18-hole or subset-of-holes formats.

Overall risk: medium

## Findings

1. [medium] Dense-holes requirement depends on an undefined/ambiguous “holes-in-play” set; wrong set can create a false barrier and defer legitimate greenie settlement
   - File: _bmad-output/implementation-artifacts/tournament/2-2-greenie-modifier-stateful-carryover.md:64-90
   - Confidence: medium
   - Why it matters: AC8’s money-critical guarantee (no carry bridging) is now correctly tied to emitting a DENSE hole array, but Task 3b describes implementation as “iterate `parByHole` ∩ holes-in-play / `siByHole`” without defining how “holes-in-play” is determined. If an implementer mistakenly densifies over *all* course holes (e.g., all 18) when the round is actually a 9-hole / subset format, an unplayed par-3 that is *not in play* will appear as present-but-incomplete and will trigger the AC8 BREAK, incorrectly deferring later (in-play) par-3 greenies. That is a direct money-settlement correctness risk, not just a documentation nit.
   - Suggested fix: Tighten the spec to define the exact authoritative source of “holes in play” used by `services/games-money.ts` when densifying (e.g., an explicit `holesInPlay: number[]` from the pinned course revision/round context; or “use the same hole-set already used to price/settle base points”). Add a small test in `games-money.greenie.test.ts` that exercises a subset format (e.g., front-9 only): ensure holes *not* in play are not emitted, and that a par-3 on the back that’s not in play cannot create a barrier that blocks a later in-play par-3.

## Strengths

- AC8 now explicitly frames the completeness rule as a BREAK barrier over a DENSE hole array (closing the previously identified bridging gap).
- Task 3b is correctly positioned as the single service-layer chokepoint change, with an explicit base-money-neutrality assertion and a targeted barrier test.
- Golden fixture math is consistent with the existing 2v2 split model (odd points produce $2.50 pairwise edges; per-player totals remain whole multiples of pointValue).
- AC10’s conservation property is now stated with preconditions and exposes fold state to avoid the prior tautology risk.

## Warnings

None.
