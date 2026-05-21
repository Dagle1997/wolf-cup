# Codex Review

- Generated: 2026-05-21T20:39:15.608Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx, apps/tournament-web/src/routes/events.$eventId.money.tsx

## Summary

The new focusable overflow wrapper (<div style={{ overflowX: 'auto' }} tabIndex={0}>…</div>) does address the prior keyboard-accessibility concern for these routes: it provides a tabbable scroll container so keyboard-only users can focus it and use arrow keys / Page keys to scroll horizontally. tabIndex={0} is a standard/idiomatic approach for making a non-interactive but scrollable region keyboard-focusable. No functional regressions are evident from the diff, but there are a couple of a11y follow-ons to consider (accessible naming and focus visibility) to avoid an unlabeled/unclear extra tab stop.

Overall risk: low

## Findings

1. [medium] Focusable scroll container lacks an accessible name (screen readers may announce an unlabeled focus stop)
   - File: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx:215-248
   - Confidence: high
   - Why it matters: Adding tabIndex={0} puts the wrapper into the tab order. For screen reader users, focusing a generic <div> with no role/label can be announced ambiguously (e.g., "group" or just "blank"), making it unclear what was focused and why. This can also feel like a redundant tab stop without context, even if it enables keyboard scrolling.
   - Suggested fix: Consider adding role="region" plus an accessible name, e.g. role="region" aria-label="Leaderboard table (horizontally scrollable)". Alternatively, aria-labelledby could reference a visible heading ("Leaderboard") or add visually-hidden helper text and connect via aria-describedby (e.g., "Scroll horizontally to see all columns").

2. [medium] Focusable scroll container lacks an accessible name (screen readers may announce an unlabeled focus stop)
   - File: apps/tournament-web/src/routes/events.$eventId.money.tsx:125-158
   - Confidence: high
   - Why it matters: Same pattern as the leaderboard: a focusable wrapper div without role/aria labeling can be confusing in focus order for assistive tech users, even though it enables horizontal scrolling with the keyboard.
   - Suggested fix: Add role="region" and aria-label/aria-labelledby (and optionally aria-describedby with short instructions). Example: <div role="region" aria-label="Money matrix (horizontally scrollable)" tabIndex={0} style={{ overflowX: 'auto' }}>…</div>.

3. [low] Ensure a visible focus indicator for the new tab stop (may be suppressed by global CSS resets)
   - File: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx:215-248
   - Confidence: medium
   - Why it matters: Keyboard users need to see where focus is. Browsers typically draw a focus ring for tabIndex=0 elements, but global CSS (e.g., outline: none) can remove it. If the wrapper gains focus but shows no visible indication, the usability benefit of making it focusable is reduced.
   - Suggested fix: Verify focus styling in the app. If needed, add a class and apply a clear :focus-visible outline (e.g., outline: 2px solid …; outline-offset: 2px;).

## Strengths

- The scroll wrapper is now keyboard-focusable via tabIndex={0}, which is a common and appropriate technique for enabling keyboard scrolling of overflow containers.
- The change is localized (wrapper only) and preserves table semantics (still a real <table> with <th scope="col"> in the leaderboard).
- No new JS event handling or state changes were introduced, reducing regression risk.

## Warnings

None.
