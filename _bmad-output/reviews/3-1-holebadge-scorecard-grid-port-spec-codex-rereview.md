# Codex Review

- Generated: 2026-06-22T22:14:52.705Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/3-1-holebadge-scorecard-grid-port.md

## Summary

Prior HIGH around moneyNet semantics (null=unknown vs 0=even), unplayed-hole rendering contract, totals-over-played-holes, back-9 gating, token-mapping + grep enforcement, and testability via data-* hooks are all now explicitly specified in this revised 3-1 story.

One remaining potential HIGH blocker is still present: the spec defines summing only non-null moneyNet values for $ totals, but does not define how to render totals when *all* played holes have moneyNet=null (empty non-null set). In that case, a naïve sum will produce 0, which is indistinguishable from legitimate even-money and violates the “never fabricate a value” intent.

No other new High blockers are evidenced, but there are a couple of smaller spec inconsistencies that could cause dev/test churn if not clarified.

Overall risk: high

## Findings

1. [high] $ totals can still fabricate “0” when all played holes have moneyNet=null (empty non-null set)
   - File: _bmad-output/implementation-artifacts/tournament/3-1-holebadge-scorecard-grid-port.md:21-24
   - Confidence: high
   - Why it matters: AC #6 establishes a critical semantic distinction: moneyNet=null means unknown/not-supplied, while 0 is a legitimate even-money result. The spec then says “The `$` column total sums only non-null `moneyNet` of played holes” (line 23). If all played holes have moneyNet=null, the non-null set is empty; an implementation that reduces/sums will likely yield 0, which would be displayed as an even-money total and incorrectly imply computed/known money. This reintroduces the original class of defect (unknown money rendered as 0), just at the totals level rather than per-cell.
   - Suggested fix: Explicitly specify (and test) the $ total rendering rule for the empty-non-null case. For example: “$ Out/In/Tot totals render `—` unless at least one played hole in that section has moneyNet != null; otherwise show the numeric sum (including 0 when it is a real sum).” Add a ScorecardGrid test covering: played holes present, all moneyNet=null → $ totals are `—` (not 0).

2. [medium] Unplayed handicap-stroke dot rule conflicts with the general stroke-dot rule (single-dot vs two-dot)
   - File: _bmad-output/implementation-artifacts/tournament/3-1-holebadge-scorecard-grid-port.md:19-23
   - Confidence: high
   - Why it matters: AC #3 says relativeStrokes>=2 should show two dots (line 19). AC #5 says an unplayed Score cell renders an em-dash “plus a single handicap-stroke dot when relativeStrokes > 0” (line 22). If a hole is unplayed and relativeStrokes=2, these requirements disagree, which can lead to inconsistent UI and/or flaky tests depending on which interpretation the implementer follows.
   - Suggested fix: Clarify whether unplayed holes should (a) follow the same 1-dot/2-dot rule as played holes, or (b) intentionally collapse to a single indicator dot for any relativeStrokes>0. Update AC #5 wording and tests accordingly.

3. [medium] Header styling guidance is internally inconsistent (keep bg-green-700 vs replace with var(--color-brand-primary))
   - File: _bmad-output/implementation-artifacts/tournament/3-1-holebadge-scorecard-grid-port.md:45-73
   - Confidence: high
   - Why it matters: Task 3 says “bg-green-700 header is standard-palette so keep” (line 45), while the deterministic mapping table says `bg-green-700` should be replaced with an inline style using `var(--color-brand-primary)` (line 72). This is likely to cause unnecessary back-and-forth during implementation and could lead to mismatched themes if different contributors follow different parts of the spec.
   - Suggested fix: Pick one rule and make it consistent across AC #7 / Task 3 / the mapping table. If the goal is brand-consistent theming across light/dark, prefer the tokenized header background; if the goal is exact Wolf parity, prefer keeping `bg-green-700` and remove it from the “must replace” mapping table.

## Strengths

- moneyNet is now explicitly `number | null` with correct semantics (null=unknown, 0=even) and a per-cell em-dash render rule (line 23).
- Unplayed-hole contract is explicit: no HoleBadge for null gross; em-dash + stroke indicator; other cells render `—` (line 22).
- Totals contract is spelled out as summing only played holes (and only non-null money) with `—` when played-hole count is 0 (line 21).
- Back-9 rendering gate is explicit and aligned to the referenced Wolf behavior (line 20).
- Token-mapping + explicit grep enforcement reduces risk of silent Tailwind-v4 no-op classes (lines 63–76).
- Tests are guided away from brittle className assertions via stable data-* hooks (lines 84–87).
- Scope guardrails (tournament-only paths, no cross-app imports, no API/wiring) are clearly stated (lines 78–83).

## Warnings

None.
