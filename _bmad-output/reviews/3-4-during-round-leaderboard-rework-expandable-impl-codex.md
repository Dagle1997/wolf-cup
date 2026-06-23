# Codex Review

- Generated: 2026-06-23T16:47:53.215Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx, apps/tournament-web/src/routes/events.$eventId.leaderboard.test.tsx

## Summary

Adds an expandable per-player scorecard panel on the round-scope leaderboard, with lazy React Query fetch, cents→dollars adaptation, single-open state, and tests covering the core behaviors. Implementation largely matches the described story, but there are a few correctness/a11y edge cases and some test gaps that could allow regressions (especially around the “whole-dollar” money assumption, expanded state across scope changes, and ARIA wiring to a <tr>).

Overall risk: medium

## Findings

1. [medium] Cents→dollars adapter can produce fractional dollars without validation/rounding
   - File: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx:209-224
   - Confidence: high
   - Why it matters: `toGridHole` converts `moneyNet` from integer cents to “whole dollars” by dividing by 100. If the backend ever returns non-whole-dollar cents (e.g., 250, -125), this will produce fractional values (2.5, -1.25). Depending on how `ScorecardGrid` formats numbers, that could render incorrect/ugly values or break assumptions elsewhere. The comment asserts whole-dollar F1 money, but the code does not enforce that invariant.
   - Suggested fix: Defensively enforce the invariant in the adapter: e.g. `moneyNet: api.moneyNet === null ? null : Math.trunc(api.moneyNet / 100)` or (better) validate `api.moneyNet % 100 === 0` and either round consistently or throw/log and render unavailable/error for unexpected values. Consider adding a test for a non-multiple-of-100 value if you choose a policy.

2. [medium] Expanded row state is not reset when scope/round availability changes (can cause surprising auto-reopen + immediate fetch)
   - File: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx:289-365
   - Confidence: high
   - Why it matters: `expandedPlayerId` persists across scope toggles and across cases where `roundId` becomes null (event scope or “no rounds yet”). When switching back to round scope, the previously expanded player will immediately re-open (and immediately mount `RowScorecard`, triggering a fetch and refetch interval). This may be unintended UX and can cause unexpected network activity after scope changes.
   - Suggested fix: Add an effect to clear expansion when expansion is not applicable or when the scope changes: e.g. `useEffect(() => { if (!data.round?.id) setExpandedPlayerId(null); }, [roundId, scope, eventId]);` (or at least clear on `scope` change).

3. [low] ARIA controls points at a conditionally rendered <tr>; consider using a dedicated panel element with a landmark/region role
   - File: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx:475-531
   - Confidence: medium
   - Why it matters: The toggle uses `aria-controls={panelId}` and the controlled element is `<tr id={panelId}>…`. While this is technically an element with an id, many assistive tech patterns work better when `aria-controls` references a dedicated panel container (e.g., a `<div>` with `role="region"` and an accessible name). Also, because the target is conditionally rendered, `aria-controls` points to a non-existent id when collapsed (often tolerated, but not ideal).
   - Suggested fix: Move the `id` onto a `<div>` inside the expanded `<td>` and consider `role="region"` + `aria-label`/`aria-labelledby` (e.g., “Scorecard for Steve”). Keep `<tr>` purely structural; keep `aria-expanded` on the button as-is.

4. [low] Tests don’t assert “no scorecard fetch until expanded” and don’t cover moneyEnabled=false gating
   - File: apps/tournament-web/src/routes/events.$eventId.leaderboard.test.tsx:85-172
   - Confidence: high
   - Why it matters: The story emphasizes lazy-fetch only while expanded and `$` row gating when `f1.mode==='money' && f1.moneyEnabled===true`. Current tests confirm the URL uses `round.id`, expand/collapse/single-open via `aria-expanded`, and gating for `scores_only`, but they do not explicitly prove that no `/scorecard` request occurs prior to clicking expand, nor do they cover the `moneyEnabled === false` case (money mode but not enabled). These gaps could allow regressions (e.g., eager prefetching, or showing $ row when moneyEnabled is false).
   - Suggested fix: Add a test that renders the page and asserts `fetch` has only been called for `/leaderboard` until a toggle is clicked. Add a second gating test: `mode:'money', moneyEnabled:false` and assert `$` values are not present even if the mock supplies `moneyNet`.

## Strengths

- RowScorecard is mounted only when expanded, which is a clean way to ensure the scorecard query doesn’t run for every row by default.
- Using a single `expandedPlayerId` enforces the “single-open” requirement and prevents steady-state fan-out of polling requests.
- `showMoney` gating is explicitly tied to both money mode and `moneyEnabled===true`, matching the stated exposure constraint.
- Inline handling for 403/404 as “unavailable” prevents scorecard failures from taking down the leaderboard table.
- Tests cover core UX (expand/collapse), round.id vs eventRoundId, cents→dollars for representative values (+/-/0/null), and event-scope non-expandability.

## Warnings

None.
