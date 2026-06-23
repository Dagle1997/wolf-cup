# Codex Review

- Generated: 2026-06-23T00:18:02.809Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/components/hole-badge.tsx, apps/tournament-web/src/components/hole-badge.test.tsx, apps/tournament-web/src/components/scorecard-grid.tsx, apps/tournament-web/src/components/scorecard-grid.test.tsx

## Summary

PASS. The applied fixes appear correct and I don’t see any new High-severity issues in the provided files.

1) `formatMoney(0)` now returns `'0'` (apps/tournament-web/src/components/scorecard-grid.tsx:42-46). This preserves `+$` / `-$` formatting for non-zero values, and the empty-sum → `—` guards remain gated on `count > 0` for front/back/total money totals (lines 218-223, 297-308). Per-hole still explicitly renders `value === 0 ? '0' : formatMoney(value)` (lines 149-153), so `$0` cannot appear.

2) HoleBadge dot `data-testid` hooks were added and are inert (apps/tournament-web/src/components/hole-badge.tsx:66-94). The new tests correctly assert rendered dot counts using `queryAllByTestId` (hole-badge.test.tsx:120-161). The two-dot case is capped at 2 for any `relativeStrokes >= 2` (hole-badge.tsx:82-86), matching the tests.

3) scorecard-grid tests now pin Par/Net totals and back-9 “In” total behavior, plus the moneyNet===0 and non-null zero-sum section total semantics (scorecard-grid.test.tsx:149-203). These align with the component logic as implemented.


Overall risk: low

## Findings

No concrete findings were identified from the supplied evidence.

## Strengths

- `formatMoney` change cleanly aligns section-total zero rendering with per-hole zero rendering while keeping the empty-sum (`count > 0`) guard intact.
- Added DOM-level dot-count tests reduce risk of JSX regressions (not just attribute-level assertions).
- New scorecard-grid tests explicitly lock in the AC #4 / AC #6 contracts (section totals and zero-vs-unknown money semantics).

## Warnings

None.
