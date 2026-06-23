# Codex Review

- Generated: 2026-06-23T16:59:11.792Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/3-4-during-round-leaderboard-rework-expandable-party-review.md, apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx

## Summary

Implementation largely matches the party review (single-open expandable row, lazy fetch-on-expand via mount/unmount, 15s polling parity, cents→dollars adapter, showMoney gating passed into ScorecardGrid, scope-toggle clears expansion). Two places look overstated/under-enforced: (1) “event-scope non-expandable / only in round scope” is asserted in comments/review but the code only gates on `data.round?.id`, not `data.scope`; if the API ever includes a `round` in event scope, expansion would incorrectly appear and fetch a round scorecard while showing event-aggregated standings. (2) The review’s testing/“regression-tested” claims aren’t verifiable from the provided diff (no tests shown). No obvious crashers, but money-unit assumptions should be double-checked because this is a dollars/cents seam.

Overall risk: medium

## Findings

1. [medium] “Only in round scope / event-scope non-expandable” is not actually enforced (gated only by roundId presence)
   - File: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx:356-485
   - Confidence: medium
   - Why it matters: Party review/AC characterization says expansion is round-scope only and event-scope is non-expandable. The implementation sets `roundId = data.round?.id ?? null` and uses `const expandable = roundId !== null` (line ~482) without checking `data.scope`. If the backend ever returns a non-null `round` even when `scope==='event'` (allowed by the current response type), the UI would: (a) show expansion affordances in event scope, and (b) fetch `/api/rounds/:roundId/.../scorecard` for a round that may not correspond to the event-aggregated standings being displayed. That’s a correctness/UX mismatch and could mask an API contract regression.
   - Suggested fix: Make the gating match the stated behavior: e.g. `const expandable = data.scope === 'round' && roundId !== null;` and consider deriving `roundId` only when `data.scope==='round'`. Also consider rendering the round header (name/status) only when `data.scope==='round'` to avoid the same mismatch.

2. [medium] Money-unit seam relies on undocumented invariant; if violated, ScorecardGrid could display incorrect money values
   - File: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx:190-224
   - Confidence: medium
   - Why it matters: The adapter unconditionally converts `moneyNet` from integer cents to dollars via `/ 100` (lines ~216–218) based on a comment that ScorecardGrid “expects WHOLE DOLLARS” and that F1 money is always whole-dollar. If that invariant ever changes (different point value, fractional dollar outcomes, or ScorecardGrid actually expecting cents), the display could be wrong (potentially 100× off or improperly formatted). The party review treats this as “handled explicitly” and “true” without any runtime validation here.
   - Suggested fix: At minimum, assert/guard the invariant in dev (e.g., `moneyNet % 100 === 0` before dividing if whole-dollars is required) or update ScorecardGrid to accept cents and format there. If fractions are possible, ensure ScorecardGrid formats dollars correctly (2dp) and update types/comments accordingly.

3. [low] aria-controls references a region that is conditionally mounted (ID absent while collapsed)
   - File: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx:493-539
   - Confidence: high
   - Why it matters: When collapsed, the expand button’s `aria-controls={panelId}` points to an element that does not exist in the DOM until expansion (panel div only renders when open, line ~535). This is a known disclosure-pattern nuance; some a11y tooling flags it. Party review already lists this as a minor a11y followup, so it’s consistent—but it is not “fully polished” a11y-wise.
   - Suggested fix: Either keep the region mounted (but visually hidden) so the ID always exists, or drop `aria-controls` and rely on `aria-expanded` + button label; alternatively render an empty placeholder element with that ID when collapsed.

4. [low] panelId/data-testid derived from unsanitized playerId string (assumes UUID-like)
   - File: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx:484-498
   - Confidence: medium
   - Why it matters: `panelId = scorecard-panel-${row.playerId}` becomes a DOM `id` and is referenced by `aria-controls`. If `playerId` ever contains characters that are problematic in HTML ids or CSS selectors (less likely if UUIDs, but not guaranteed by type), assistive-tech linkage and tests using `data-testid` could break. The party review states this is “a UUID playerId”, but the code only types it as `string`.
   - Suggested fix: If playerId is guaranteed UUID, consider documenting/typing it (e.g., branded type) or sanitize (`encodeURIComponent`/replace non-id chars) when constructing DOM ids.

## Strengths

- RowScorecard is isolated and failure-contained (pending/error/unavailable states do not break leaderboard rendering).
- Expansion is single-open and resets on scope toggle, limiting network fanout and avoiding surprising reopen behavior.
- Money exposure is display-gated via `showMoney = f1?.mode === 'money' && f1.moneyEnabled === true`, aligning with the stated exposure intent (even though server-side gating remains the true control).
- Uses runtime `round.id` (not `eventRoundId`) for the scorecard endpoint, matching the documented requirement in code comments.

## Warnings

None.
