# Codex Review

- Generated: 2026-06-21T12:46:58.880Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/routes/admin.events.$eventId.bets.tsx, apps/tournament-web/src/routes/events.$eventId.bets.tsx, apps/tournament-web/src/routes/events.$eventId.settle-up.tsx, apps/tournament-web/src/index.css, apps/tournament-web/src/components/scrollable-table.tsx, apps/tournament-web/src/components/page-shell.tsx

## Summary

Story 1.4 flows are mostly present (edit-in-form, two-step confirm, void confirm, terminal-state action suppression). Biggest pre-cohesion issues are (1) stake parsing/rounding that can silently change amounts (especially for legacy cent stakes), (2) mutation error banners persisting across mode changes, (3) destructive-confirm buttons inheriting the base “green primary” styling (red text on green), and (4) the admin bets table not using ScrollableTable (mobile overflow + missing scroll-region focus ring/name).

Overall risk: high

## Findings

1. [high] Whole-dollar enforcement can silently change stake via Math.round (and edit-load rounds legacy cents)
   - File: apps/tournament-web/src/routes/admin.events.$eventId.bets.tsx:126-173
   - Confidence: high
   - Why it matters: Acceptance requires whole-dollar stakes on create + edit. Right now the code *rounds* instead of *validating* at the conversion boundary:
- buildBody uses `Math.round(Number(stakeDollars)) * 100` (line 129). If a non-integer slips through (browser quirks, programmatic mutate, or future refactors), you’ll send a different stake than the user typed.
- loadForEdit sets `stakeDollars` to `Math.round(b.stakeCents / 100)` (line 170). If there are any existing bets with non-$1 increments (legacy data, migrations, manual admin edits), the form will display a rounded whole-dollar value. If the admin saves without noticing, you silently change the stake and therefore recompute the ledger incorrectly.
This is a money-integrity risk, not just UX.
   - Suggested fix: Make stake conversion *strict* and non-lossy:
- Replace Math.round with a strict integer parse + explicit error/throw if invalid.
  - e.g. `const n = Number(stakeDollars); if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) throw ...; const stakeCents = n * 100;`
  - Consider also rejecting exponent forms (`1e2`) if you want “digits only”: `if (!/^\d+$/.test(stakeDollars)) ...`.
- In `loadForEdit`, set `stakeDollars` from the exact value: `String(b.stakeCents / 100)` and let the existing `Number.isInteger(...)` validation fail if it’s not whole dollars (and/or show a targeted warning that the bet must be corrected to whole dollars).

2. [high] Mutation error alerts persist across mode changes (create/edit/void) and can show at the wrong time
   - File: apps/tournament-web/src/routes/admin.events.$eventId.bets.tsx:149-535
   - Confidence: high
   - Why it matters: React Query mutations keep `isError` until `.reset()` is called. In this UI:
- `create.isError`, `edit.isError`, and `voidBet.isError` are rendered unconditionally (lines 503–535).
- Switching between create ↔ edit mode (or after canceling edit via `exitEdit`, lines 149–154) does not reset mutation state.
Result: an old “Couldn’t add the bet” banner can remain visible while editing, or an edit error can persist after exiting edit, which is confusing and can cause admins to mistrust what action failed.
   - Suggested fix: Reset and scope error banners:
- Call `create.reset()` when entering edit mode; call `edit.reset()` when exiting edit mode; call `voidBet.reset()` when leaving a void-confirm flow or when switching to edit/create.
- Only render create errors when `!editingBetId`, only render edit errors when `editingBetId`, and consider rendering void errors near the row action area (or at least clear on `setConfirmVoidId(null)`).

3. [medium] Canceling edit does not clear an armed void confirmation (state not fully reset)
   - File: apps/tournament-web/src/routes/admin.events.$eventId.bets.tsx:149-154
   - Confidence: high
   - Why it matters: Your UX goal calls out “Canceling fully resets state.” `exitEdit()` clears edit state but does not clear `confirmVoidId` (lines 149–154). If an admin clicks “Void” on a row while in edit mode (arming `confirmVoidId`), then hits “Cancel” on the edit form, the table can still be sitting in a “Confirm void / Cancel” state for some bet. That increases accidental-action risk and feels like the UI didn’t really cancel/exit the operation.
   - Suggested fix: Add `setConfirmVoidId(null)` to `exitEdit()`. Optionally also clear `confirmEditing` when arming void, and consider disabling row actions while editing (or vice versa) to reduce cross-flow state collisions.

4. [medium] Destructive confirm buttons inherit base green primary styling (red text on green) → misleading and contrast-risky
   - File: apps/tournament-web/src/routes/admin.events.$eventId.bets.tsx:445-606
   - Confidence: high
   - Why it matters: The base layer styles every `<button>` with a brand-primary background and white text (index.css lines 192–222). In the confirm flows you set only `style={{ color: 'var(--color-danger)' }}` (edit confirm line 452, void confirm line 591). That produces red text on a green button background—visually confusing (looks like a primary action, not destructive) and can reduce readability/contrast depending on theme.
Given these actions recompute money/void bets, the destructive affordance needs to be unambiguous.
   - Suggested fix: Introduce a destructive button variant:
- Either set `data-skip-base-style` on destructive buttons and fully style them (background/border `var(--color-danger)`), or extend the base button styling to support a `data-variant="danger"`.
- Ensure hover/active/disabled states are also coherent and accessible in light + dark themes.

5. [medium] Admin bets table is not wrapped in ScrollableTable (mobile overflow + missing named scroll region focus ring)
   - File: apps/tournament-web/src/routes/admin.events.$eventId.bets.tsx:537-635
   - Confidence: high
   - Why it matters: You already have a ScrollableTable primitive specifically to prevent 375px-page overflow and to provide a focusable, named scroll region with a visible focus ring (scrollable-table.tsx lines 35–46; index.css lines 272–275).
This admin page renders a raw `<table>` directly (line 545). On mobile, the Actions column (with multiple buttons) is a common cause of horizontal overflow, and without the scroll-region wrapper keyboard users miss the focus outline + ARIA name pattern you’ve standardized elsewhere.
   - Suggested fix: Wrap the bets table:
```tsx
import { ScrollableTable } from '../components/scrollable-table';
...
<ScrollableTable label="Bets">
  <table>...</table>
</ScrollableTable>
```
Then remove redundant inline table width/borderCollapse if base styles already cover it.

6. [medium] Two-step confirm UX/a11y: no focus management; confirm buttons not associated with the warning text
   - File: apps/tournament-web/src/routes/admin.events.$eventId.bets.tsx:290-501
   - Confidence: medium
   - Why it matters: For screen-reader and keyboard users:
- Entering edit mode via the row button (lines 612–615) does not move focus to the form or announce which bet is loaded beyond a generic banner. On long pages, users may not realize the form changed.
- The warning is `role="alert"` (line 497), but the “Confirm change” button has no `aria-describedby` linking to that warning, so the relationship between the confirm control and its consequence text is weaker than it needs to be.
Similar issues apply to the void confirm UI in-row (lines 586–606): no ARIA relationship to any confirmation text and no focus shift when the confirm UI appears.
   - Suggested fix: Add minimal, high-impact a11y improvements:
- On `loadForEdit`, scroll the form into view and focus the first control (Round or Stake) via a ref.
- Give the warning paragraph an `id` and set `aria-describedby` on the confirm button.
- Consider adding `aria-label` on row Edit/Void buttons including the matchup (e.g., `Edit bet: Alice vs Bob`) to disambiguate repeated “Edit” controls.

7. [low] Design-token cohesion gaps: hardcoded spacing/radius/colors remain on bets + money-related pages
   - File: apps/tournament-web/src/routes/events.$eventId.bets.tsx:80-176
   - Confidence: high
   - Why it matters: Ahead of a design-cohesion pass, there are a few high-signal literals that will fight the token system:
- `netColor` returns `'#dc2626'` for negative (line 82) instead of `var(--color-money-neg)`.
- Card styling uses `borderRadius: 8`, `padding: 12`, `marginBottom: 12`, and font sizes like `'0.85rem'` / `'1.1rem'` (lines 154–173) instead of `--radius-*`, `--space-*`, `--font-*`.
These are exactly the literals your token system was intended to eliminate.
   - Suggested fix: Swap to tokens:
- Replace `'#dc2626'` with `var(--color-money-neg)`.
- Replace `8/12/0.85rem/1.1rem` with `var(--radius-*)`, `var(--space-*)`, `var(--font-*)`.
Optionally use existing primitives (e.g., `.card`) to reduce per-page inline styles.

8. [low] Settle-up banner uses literal rem spacing instead of spacing tokens
   - File: apps/tournament-web/src/routes/events.$eventId.settle-up.tsx:151-164
   - Confidence: high
   - Why it matters: The settle-up alert banner mixes token colors with literal spacing values (`padding: '0.5rem 1rem'`, `marginBottom: '1rem'`, lines 154–159). It’s not a correctness issue, but it will stand out after a cohesion pass when other spacing is standardized on `--space-*`.
   - Suggested fix: Replace with `padding: 'var(--space-2) var(--space-4)'` and `marginBottom: 'var(--space-4)'` (or similar) to match the spacing scale.

## Strengths

- Terminal-state suppression is implemented for void/finalized/unsettleable rows (admin.events.$eventId.bets.tsx:584–586), matching the invariant.
- Two-step confirm flows exist for both edit and void, and the edit warning is only shown at the confirmation step (admin.events.$eventId.bets.tsx:445–501).
- Stake input uses type=number with step=1 + integer validation gate before enabling submit (admin.events.$eventId.bets.tsx:366–377, 264–273).
- Use of `role="alert"` / `role="status"` is a good baseline for announcing state changes (admin.events.$eventId.bets.tsx:291–298, 497–500).

## Warnings

None.
