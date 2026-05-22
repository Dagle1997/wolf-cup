# Codex Review

- Generated: 2026-05-22T19:50:21.480Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/components/scrollable-table.tsx, apps/tournament-web/src/components/scrollable-table.test.tsx, apps/tournament-web/src/index.css, apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx, apps/tournament-web/src/routes/events.$eventId.money.tsx, apps/tournament-web/src/routes/admin.events.$eventId.pairings.tsx, apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx, apps/tournament-web/src/routes/admin.events.new.tsx, apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx, apps/tournament-web/src/routes/admin.courses.new.tsx, _bmad-output/implementation-artifacts/tournament/T12-3-scroll-region-accessibility.md

## Summary

Implementation matches the stated ACs for T12-3 based on the provided diff/file contents: `ScrollableTable` wraps children in a focusable horizontal scroll container with `role="region"` + `aria-label={label}` + `tabIndex={0}` + `className="scroll-region"` + `overflowX:'auto'` (apps/tournament-web/src/components/scrollable-table.tsx:35-46). The new CSS focus ring rule mirrors the existing input `:focus-visible` ring in width and offset and uses the `--color-brand-primary` token (apps/tournament-web/src/index.css:137-149). All 8 prior wrappers shown in the story are migrated to `<ScrollableTable label="…">` with meaningful labels across the 7 routes in scope, and the one table-level inline style called out (course scorecard) is preserved on the `<table>` element (events.$eventId.courses.$courseId.tsx:195-232). The 4 new unit tests concretely assert: children render, named region landmark is queryable via `getByRole('region', { name })`, `tabIndex=0`, class presence, and `overflowX:auto` style (apps/tournament-web/src/components/scrollable-table.test.tsx:7-71). No forbidden-path edits are present in the provided changes.

Overall risk: low

## Findings

No concrete findings were identified from the supplied evidence.

## Strengths

- Primitive encapsulates the exact a11y + scrolling contract (role/name/tabIndex/style/class) in one place, reducing future drift (scrollable-table.tsx:35-46).
- Testing-library queries (`getByRole('region', { name })`) verify the accessible name is actually exposed via the platform accessibility tree, not just that an attribute exists (scrollable-table.test.tsx:22-37).
- Route migrations preserve existing table markup and table-level inline styling where present (course scorecard keeps `width: '100%', borderCollapse: 'collapse'`).
- Focus ring implemented with `outline` (not box-shadow) and `:focus-visible`, matching the established input behavior and avoiding mouse/touch rings (index.css:137-149).
- All touched files are within the allowed footprint (`apps/tournament-web/**` plus tournament artifacts); no engine/API/shared-package edits are evidenced.

## Warnings

None.
