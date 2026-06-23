# Gemini Critique

- Generated: 2026-06-23T16:51:43.818Z
- Critiquing: gpt-5.2
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Evidence files: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx

## Verdict

**SHIP** — overall agreement: partial

## Summary

The prior reviewer found two UX/logic issues and two minor/a11y issues. Finding 1 complains about a lack of documentation for an invariant that is, in fact, explicitly documented right above the flagged code. Finding 2 accurately catches a sloppy UI state bug where changing tabs preserves the expanded player ID, causing a surprise pop-open and fetch when returning to the tab. Finding 3 correctly notes an ARIA violation, and Finding 4 assumes missing test coverage without providing the test file. The code is safe to ship with a minor tweak to clear the expanded state on scope toggle.

## Critiques of prior findings

1. [disagree] Finding 1 [medium] Cents→dollars adapter can produce fractional dollars without validation/rounding
   - Reasoning: The reviewer asks to "Consider documenting the invariant", but the code explicitly documents this exact invariant on lines 216-218 right above the division (`// cents → whole dollars... F1 Guyan money is whole-dollar... so /100 is an exact integer`). Furthermore, even if a fractional dollar were produced in the future, standard frontend number formatters will either round or display the 50 cents safely; this isn't a medium-severity risk.

2. [partial] Finding 2 [medium] Expanded row state not reset when scope/round availability changes
   - Reasoning: I agree with the technical observation: changing the scope tab unmounts the scorecard but leaves `expandedPlayerId` populated, leading to a surprise auto-reopen and immediate fetch when returning to the 'current' scope. However, severity is Low, not Medium, as it's a minor UX glitch that doesn't corrupt data or break the app. It's easily fixed by resetting the state on toggle.

3. [agree] Finding 3 [low] aria-controls points at a conditionally rendered <tr>
   - Reasoning: This is a correct strict-accessibility catch. When `isOpen` is false, the element matching `panelId` is entirely removed from the DOM, causing `aria-controls` to point to a non-existent element.

4. [missing_evidence] Finding 4 [low] Tests don't assert "no scorecard fetch until expanded"...
   - Reasoning: The test file (`.test.tsx` or `.spec.tsx`) is not included in the provided context, making it impossible to evaluate what the tests assert.

## Additional findings (Gemini caught, prior reviewer missed)

No additional findings.

## Consensus recommendations

- Reset `expandedPlayerId` to `null` in the scope toggle's `onClick` handler (`setScope(val); setExpandedPlayerId(null);`) to prevent surprise re-opens.
- For strict ARIA compliance, consider always rendering the expanded `<tr>` but applying a `hidden` attribute or `display: none` when `!isOpen`, so `aria-controls` always resolves to a valid DOM ID.

## Warnings

None.
