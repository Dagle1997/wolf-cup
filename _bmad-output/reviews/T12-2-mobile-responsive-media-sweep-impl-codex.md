# Codex Review

- Generated: 2026-05-21T20:36:17.262Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/index.css, apps/tournament-web/src/routes/events.$eventId.money.tsx, apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx, apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx, apps/tournament-web/src/routes/admin.events.$eventId.pairings.tsx, apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx, apps/tournament-web/src/routes/admin.events.new.tsx, apps/tournament-web/src/routes/admin.courses.new.tsx

## Summary

All 7 route tables (including both tables in admin.courses.new) are wrapped with a matching `<div style={{ overflowX: 'auto' }}>…</div>` and JSX nesting/closing tags appear correct in the provided file contents. The index.css min-height bump is limited to the same three base-layer selectors (text-ish inputs, select, button) and continues to exclude checkbox/radio/range (and textarea remains unchanged). Main remaining concern is accessibility/keyboard discoverability for horizontally scrollable tables that contain no focusable elements.

Overall risk: low

## Findings

1. [medium] Horizontally scrollable table wrappers are not keyboard-focusable (hard to scroll for keyboard-only users on non-interactive tables)
   - File: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx:215-249
   - Confidence: high
   - Why it matters: With `overflowX: 'auto'` on a plain `div` that is not focusable, keyboard-only users may have no practical way to horizontally scroll to off-screen columns when the table itself has no focusable controls (leaderboard is all static cells). Similar wrappers exist on other mostly-static tables (money matrix, course preview, group members). Tabbing won't move focus into the region (no focus targets), so the horizontal overflow can become effectively inaccessible.
   - Suggested fix: Make the scroll container focusable and label it, e.g. `<div tabIndex={0} role="region" aria-label="Leaderboard table" style={{ overflowX: 'auto' }}>…</div>`. Optionally add `aria-describedby` text like “Scroll horizontally to see all columns.” Apply similarly to other non-interactive wrapped tables.

2. [low] Wrapper/table tags are written on the same line, increasing the chance of future mismatched closing tags during edits
   - File: apps/tournament-web/src/routes/admin.courses.new.tsx:486-602
   - Confidence: high
   - Why it matters: The pattern `<div …><table> … </table></div>` is correct as-is, but keeping opening tags and closing tags adjacent on single lines makes it easier to accidentally introduce a `</table></div>` mismatch or move content outside the wrapper in future modifications—especially in long tables like the Tees/Holes grids.
   - Suggested fix: Consider formatting as multi-line nested JSX for maintainability: `<div …>\n  <table>…</table>\n</div>` (no behavior change).

## Strengths

- All provided `<table>` elements in the 7 touched routes appear to be fully contained by the new overflow wrapper, with matching open/close tags (no malformed JSX nesting visible).
- No wrappers were applied to non-table elements in the provided diff/files.
- The min-height change in `index.css` is scoped to the same three selectors and continues to exclude checkbox/radio/range; `textarea` rules are unchanged.

## Warnings

None.
