# Gemini Review

- Generated: 2026-06-23T20:28:17.619Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx

## Summary

The redesign correctly implements the 2-column layout and successfully preserves the iOS keyboard auto-advance hack by retaining `key={member.playerId}`. Dropping steppers cleanly defers to the existing 1.5s debounce without breaking 10+ score entries. However, introducing the hole's par as the input placeholder creates a severe risk of missing data, as empty inputs will visually appear already populated.

Overall risk: high

## Findings

1. [high] Misleading par placeholder creates data-loss risk
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:1512
   - Confidence: high
   - Why it matters: Using `String(par)` as a placeholder for an empty input visually tricks users into believing the par score has already been recorded. In a fast-paced data entry flow, users are highly likely to scan the field, see a valid number, and mistakenly skip explicit entry, resulting in missing scores.
   - Suggested fix: Remove `placeholder={String(par)}` so empty inputs are distinctly blank, which enforces explicit entry from the scorer.

2. [medium] Missing trim causes empty first name display
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:1505
   - Confidence: high
   - Why it matters: If a player's name from the database contains leading whitespace, `member.name.split(/\s+/)[0]` evaluates to an empty string. This will cause the UI to render a completely blank name in the score card header.
   - Suggested fix: Add `.trim()` before splitting: `const first = member.name.trim().split(/\s+/)[0] ?? member.name;`

3. [medium] Active Bonus toggles fail WCAG contrast requirements
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:1541-1542
   - Confidence: high
   - Why it matters: When a bonus is toggled on, the text color changes to `#fff`. For the Sandie toggle (background `#f59e0b`), the resulting contrast ratio is ~2.1:1, failing the WCAG AA requirement (4.5:1). This makes the active toggle illegible, especially outdoors in sunlight.
   - Suggested fix: Use a dark text color (`#000` or `var(--color-text-primary)`) when toggled on, or use a significantly darker shade of the background color for the active state.

## Strengths

- Retaining `key={member.playerId}` on the new input wrappers correctly preserves the iOS keyboard auto-open hack across hole advances.
- Dropping the steppers delegates cleanly to the existing `ADVANCE_DEBOUNCE_MS` (1.5s), successfully covering the 10+ score input edge case without interaction regressions.
- The 2-column CSS Grid seamlessly maintains a left-to-right, row-by-row natural reading order (indices 0, 1, 2, 3), keeping auto-advance intuitive.
- `CLAIM_TYPES` and `ClaimChips` were safely completely removed with no leftover dead/unused state.
- `aria-label` and `aria-pressed` mappings were faithfully ported over to the compact bonus toggles, preserving screen reader accessibility.

## Warnings

- Truncated file content for review: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx
