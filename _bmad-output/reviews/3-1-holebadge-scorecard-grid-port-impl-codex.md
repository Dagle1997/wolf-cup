# Codex Review

- Generated: 2026-06-23T00:08:47.273Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/types/scorecard.ts, apps/tournament-web/src/lib/scorecard-fixtures.ts, apps/tournament-web/src/components/hole-badge.tsx, apps/tournament-web/src/components/hole-badge.test.tsx, apps/tournament-web/src/components/scorecard-grid.tsx, apps/tournament-web/src/components/scorecard-grid.test.tsx

## Summary

The port is largely faithful to the Wolf reference and meets most of the story 3-1 acceptance criteria: HoleBadge variant branching matches d=gross-par, bonus dots can co-occur, played/unplayed handling is correct in Score cells, back-9 table is correctly gated by any played hole > 9, and money nullability is respected (played+null renders em-dash; empty-sum section totals render em-dash). The main correctness risk I see is inconsistent formatting for $ totals when the summed value is exactly zero (totals show "$0" while per-hole zeros show "0"), and the totals reducers will silently treat a played hole’s null netScore/grossScore as 0, which can yield incorrect totals while the row shows em-dashes for those cells. Test coverage is good but doesn’t directly assert the rendered dot counts for HoleBadge stroke dots (1 vs 2) or the presence of the actual bonus-dot elements (it only checks data attributes).

Overall risk: medium

## Findings

1. [medium] $ totals render "$0" while per-hole money renders "0" for zero; may violate AC #6’s zero-format expectations
   - File: apps/tournament-web/src/components/scorecard-grid.tsx:34-38
   - Confidence: high
   - Why it matters: AC #6 explicitly calls out that moneyNet of 0 renders as "0". The implementation does this per-hole (moneyCell) but section totals use formatMoney(), which returns "$0" for zero. If the Wolf reference (or AC intent) expects "0" consistently (especially since the row label is already "$"), this will cause wrong renders for exact-zero totals and could fail acceptance/tests later.
   - Suggested fix: Make totals follow the same rule as per-hole cells: if total===0 and count>0, render "0" (no "$"), otherwise render formatMoney(total). Alternatively, change formatMoney(0) to return "0" and ensure callers that need "$0" add it explicitly (if ever needed).

2. [medium] Totals reducers can silently treat null netScore/grossScore as 0 for played holes, producing incorrect Out/In/Tot values
   - File: apps/tournament-web/src/components/scorecard-grid.tsx:40-43
   - Confidence: high
   - Why it matters: sumField() uses (h[key] ?? 0). The component defines “played” solely as grossScore!=null (lines 81-84), but the Net row renders an em-dash if a played hole has netScore==null (lines 195-197 / 271-273) while the Net totals will still include that hole as 0 in the sum (lines 85-88 / 90-93). That yields a numeric Net total that does not reflect the row’s displayed data (and can be wrong without being obvious).
   - Suggested fix: Compute each total from the same predicate used for that row’s cells:
- For gross totals: sum only holes where grossScore!=null.
- For net totals: sum only holes where netScore!=null (or enforce netScore non-null when grossScore is non-null).
If a played hole has null netScore, consider rendering the section Net total as "—" to avoid implying correctness.

3. [low] HoleBadge tests assert data-strokes but not the rendered stroke-dot count (1 vs 2), and bonus-dot rendering is only indirectly covered
   - File: apps/tournament-web/src/components/hole-badge.test.tsx:95-115
   - Confidence: high
   - Why it matters: AC #3 requires the visual stroke dot behavior (===1 → 1 dot; >=2 → 2 dots). Current tests only check the data-strokes attribute, which won’t catch a regression where the DOM dots render incorrectly (e.g., always one dot, none, or two). Similarly, bonus dots are validated via data attributes but not the actual dot elements. Since these are the key UI semantics of HoleBadge, the tests should pin them directly.
   - Suggested fix: Add stable test hooks for dot elements (e.g., data-testid="stroke-dot" on each dot and data-testid="bonus-dot-greenie|polie|sandie"), then assert counts:
- relativeStrokes=1 → 1 stroke-dot
- relativeStrokes=2 → 2 stroke-dots
- each bonus flag adds exactly one corresponding dot and they can co-occur.

## Strengths

- HoleBadge variant branching matches the specified d=gross-par rules (eagle/birdie/par/bogey/double) and is backed by deterministic tests via data-variant (apps/tournament-web/src/components/hole-badge.tsx:53-55; hole-badge.test.tsx:6-51).
- ScorecardGrid correctly gates rendering of the back-9 table on any played hole > 9 and always renders the front-9 table (scorecard-grid.tsx:81-84, 222-305; tests (a) and (b)).
- Unplayed Score cells render an em-dash and (when relativeStrokes>0) exactly one stroke dot regardless of stroke count, satisfying AC #5; this is explicitly tested (scorecard-grid.tsx:115-125; scorecard-grid.test.tsx:71-98).
- Money nullability is correctly handled per-hole (played+null renders em-dash; 0 renders "0"), and section totals render em-dash when there are zero non-null contributions (scorecard-grid.tsx:131-146, 209-216; tests (e) and (f)).
- No evidence of FD-1/FD-2 boundary violations in the provided files (imports are local to tournament-web).
- Token adaptation appears complete in the provided components: muted/border/stripe/header/money colors use var(--color-*) tokens and avoid the listed shadcn semantic aliases.

## Warnings

None.
