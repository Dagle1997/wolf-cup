# Gemini Review

- Generated: 2026-06-23T03:27:38.300Z
- Model: gemini-pro-latest
- Reasoning effort: xhigh
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/index.css, apps/tournament-web/src/components/activity-feed.test.tsx, apps/tournament-web/src/components/activity-feed.tsx, apps/tournament-web/src/components/award-celebration.test.tsx, apps/tournament-web/src/components/award-celebration.tsx, apps/tournament-web/src/components/back-link.test.tsx, apps/tournament-web/src/components/back-link.tsx, apps/tournament-web/src/components/button.tsx, apps/tournament-web/src/components/card.tsx, apps/tournament-web/src/components/empty-state.test.tsx, apps/tournament-web/src/components/empty-state.tsx, apps/tournament-web/src/components/error-card.test.tsx, apps/tournament-web/src/components/error-card.tsx, apps/tournament-web/src/components/form-field.tsx, apps/tournament-web/src/components/global-nav.test.tsx, apps/tournament-web/src/components/global-nav.tsx, apps/tournament-web/src/components/head-to-head-card.tsx, apps/tournament-web/src/components/hole-badge.test.tsx, apps/tournament-web/src/components/hole-badge.tsx, apps/tournament-web/src/components/install-prompt.test.tsx, apps/tournament-web/src/components/install-prompt.tsx, apps/tournament-web/src/components/loading-card.test.tsx, apps/tournament-web/src/components/loading-card.tsx, apps/tournament-web/src/components/not-found.test.tsx, apps/tournament-web/src/components/not-found.tsx, apps/tournament-web/src/components/page-shell.test.tsx, apps/tournament-web/src/components/page-shell.tsx, apps/tournament-web/src/components/scorecard-grid.test.tsx, apps/tournament-web/src/components/scorecard-grid.tsx, apps/tournament-web/src/components/scrollable-table.test.tsx, apps/tournament-web/src/components/scrollable-table.tsx, apps/tournament-web/src/components/theme-toggle.tsx, apps/tournament-web/src/components/tournament-banner.test.tsx, apps/tournament-web/src/components/tournament-banner.tsx, apps/tournament-web/src/components/tournament-toast.test.tsx, apps/tournament-web/src/components/tournament-toast.tsx, apps/tournament-web/src/components/update-banner.tsx, apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx, apps/tournament-web/src/routes/events.$eventId.team-standings.tsx, apps/tournament-web/src/routes/events.$eventId.money.tsx, apps/tournament-web/src/routes/events.$eventId.match-play-standings.tsx, apps/tournament-web/src/routes/events.$eventId.index.tsx, apps/tournament-web/src/routes/index.tsx

## Summary

The Tournament app exhibits a strong foundation with excellent use of the TanStack suite, a robust CSS variable token system for dark mode, and comprehensive automated test coverage for complex logic like scorecard rendering and activity feeds. However, the review identified critical contrast failures in the new dark mode theme (specifically for primary calls-to-action and scorecard badges), omissions of key accessible primitives (like `ScrollableTable` missing from the actual scorecard), state loss bugs in the activity banner, and several mobile PWA regressions (missing safe-area insets and sub-44px tap targets). Addressing these will significantly elevate the physical usability and professional polish of the app.

Overall risk: medium

## Findings

1. [high] Severe Contrast Failure in Dark Mode (Live Round CTA)
   - File: apps/tournament-web/src/routes/events.$eventId.index.tsx:228-254
   - Confidence: high
   - Why it matters: The primary 'Enter scores' CTA uses `background: 'var(--color-accent)'` with `#fff` text. In dark mode, `--color-accent` flips to `#fbbf24` (amber-400), which yields a contrast ratio of ~1.2:1 against white text. This makes the most important button on the event home page completely unreadable for dark mode users.
   - Suggested fix: Change the background to a token explicitly designed for text-on-dark contrast (e.g., `--color-brand-primary`), or flip the text color to a dark token when the amber background is active.

2. [high] Contrast Failure in Dark Mode (Hole Badges)
   - File: apps/tournament-web/src/components/hole-badge.tsx:96-148
   - Confidence: high
   - Why it matters: The component uses hardcoded Tailwind literal colors (`text-blue-600`, `text-amber-600`) that do not adapt to the theme. Against a true dark surface (`#171717`), `text-blue-600` has a contrast ratio of 3.1:1 and `text-amber-600` is 3.4:1, failing WCAG AA requirements and significantly impairing readability outdoors.
   - Suggested fix: Replace literal Tailwind utility classes with semantic `var(--color-*)` tokens (e.g., `--color-danger`, `--color-warning-text`, or specific badge tokens) that naturally adapt to the active color scheme.

3. [medium] Missing ScrollableTable Wrapper on Scorecard Grid (A11y/Usability)
   - File: apps/tournament-web/src/components/scorecard-grid.tsx:157-315
   - Confidence: high
   - Why it matters: The scorecard tables hand-roll `<div className="overflow-x-auto">` instead of utilizing the newly created `<ScrollableTable>` primitive. This strips the tables of keyboard focusability, an explicit focus ring, and an accessible ARIA region name, directly violating the primitive's adoption requirements.
   - Suggested fix: Replace `<div className="overflow-x-auto py-2 px-1">` with `<ScrollableTable label="Front 9">` (and similarly for the Back 9 table) to inherit the required a11y behaviors.

4. [medium] Missing Safe Area Insets for iOS PWA Nav
   - File: apps/tournament-web/src/components/global-nav.tsx:48-61
   - Confidence: high
   - Why it matters: The application targets a 'phone-first PWA' experience. When added to the iOS home screen (standalone mode), elements with `position: 'sticky', top: 0` will render directly underneath the hardware notch and system status bar, rendering the header text and theme toggle unclickable.
   - Suggested fix: Add `paddingTop: 'env(safe-area-inset-top)'` to the nav's styling container to ensure it respects the physical notch bounds on iOS devices.

5. [medium] State Loss: Storm Banner Overwrites Previous Storms
   - File: apps/tournament-web/src/components/tournament-banner.tsx:94-104
   - Confidence: high
   - Why it matters: If multiple 'storms' (batches of 3+ events) occur in the same session, `flushStorm` calls `setStormFired(batch)` directly. This completely overwrites any previously active storm banner. The overwritten events disappear from the UI but are not marked as dismissed, meaning they will unexpectedly reappear as zombies on the next page refresh.
   - Suggested fix: Use a functional state update for `setStormFired` to merge new batches into the existing storm if one is active: `setStormFired((prev) => prev ? [...prev, ...batch] : batch)`.

6. [medium] Sub-44px Tap Target (Mobile Accessibility)
   - File: apps/tournament-web/src/routes/index.tsx:267-285
   - Confidence: high
   - Why it matters: The 'Show/Hide past & cancelled' toggle explicitly applies `minHeight: 'auto'` and `padding: 0` in combination with `data-skip-base-style`. This creates a text-height-only bounding box (often <20px), heavily violating the 44x44px minimum tap target required for touch screens.
   - Suggested fix: Remove `minHeight: 'auto'` to restore the minimum control height, or add explicit vertical padding (e.g., `padding: '12px 0'`) to pad out the interactive area.

7. [low] PageShell Omitted on Landing Page Breaks Visual Cohesiveness
   - File: apps/tournament-web/src/routes/index.tsx:203-296
   - Confidence: high
   - Why it matters: The application's home page completely omits the `<PageShell>` wrapper, opting for hand-rolled padding. On wide screens or tablets, this causes the layout to stretch infinitely wide, breaking alignment and consistency with the rest of the application's strict 960px bounds.
   - Suggested fix: Wrap the returned content of `IndexPage` in `<PageShell title="Your events">` instead of a raw `div` with inline padding.

8. [low] Inconsistent Component Usage Causes Bloated Banner Buttons
   - File: apps/tournament-web/src/components/tournament-banner.tsx:203-254
   - Confidence: high
   - Why it matters: Banner action buttons (Review, Dismiss) use standard `<button>` tags without `data-skip-base-style`, inheriting the global base styles (solid green background, 48px min-height, 16px padding). Inside a compact banner, these massive buttons stretch the container, creating a rough and unprofessional appearance.
   - Suggested fix: Replace raw buttons with the `<Button variant="secondary">` primitive, or add `data-skip-base-style` with contextual padding/sizing tailored for compact banner placement.

## Strengths

- Excellent, granular test coverage for complex UI logic (e.g., ActivityFeed hydration, TournamentBanner storm collapse, ScorecardGrid).
- Clean and scalable approach to custom CSS token management, seamlessly avoiding Tailwind CSS v4 pipeline quirks by collapsing the palette inline.
- Data loading states are handled exceptionally cleanly using the `FetchOutcome` union pattern across route boundaries, preventing flash-of-error states.

## Warnings

None.
