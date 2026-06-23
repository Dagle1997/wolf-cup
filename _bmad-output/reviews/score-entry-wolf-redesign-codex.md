# Codex Review

- Generated: 2026-06-23T20:26:11.351Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx

## Summary

Layout-only redesign mostly preserves the existing score-entry interaction wiring (same scoreInputRefs assignment, same score-input testids, same handleScoreChange/handleBlur usage, and claim toggle testids/aria-pressed semantics). The main concrete risk introduced by the diff is an explicit reduction of bonus toggle tap targets to 40×40px (previously documented as >=44px), plus removal of the per-player ClaimChips container testid that any existing tests may rely on.

Overall risk: medium

## Findings

1. [high] Bonus toggle buttons reduced to 40×40px, violating previously documented >=44px tap-target floor (a11y/usability regression)
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:1494-1578
   - Confidence: high
   - Why it matters: The removed ClaimChips component explicitly enforced a minimum 44px tall tap target (and documented it as an NFR). The new “Bonuses” card renders the G/P/S toggles as fixed 40×40px buttons. On mobile, this increases mis-taps and can fail internal tap-target requirements (and potentially platform guidance like Apple’s 44pt targets). Because these toggles are part of core score entry (not a rare settings screen), accuracy matters.
   - Suggested fix: Increase the interactive target to at least 44×44 (e.g., width/height 44) or keep the visible square 40×40 but add padding/min-width/min-height or a larger hit area via ::before/::after, ensuring the actual clickable area meets the requirement without changing visuals significantly.

2. [medium] Removed data-testid `claim-chips-{playerId}` container may break existing UI tests
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:1024-1578
   - Confidence: medium
   - Why it matters: The diff removes the entire ClaimChips component, including the wrapper `data-testid={`claim-chips-${playerId}`}`. Even though individual toggle testids `claim-{type}-{playerId}` are preserved, any tests that asserted presence/structure via the container testid will now fail. This is a concrete regression risk if tests exist around the old chip row.
   - Suggested fix: If tests rely on the container, either (a) update tests to use the preserved `claim-{type}-{playerId}` ids, or (b) add an equivalent stable container testid in the new Bonuses card (e.g., `data-testid="bonuses"` and/or `data-testid={`bonuses-row-${playerId}`}`).

3. [low] First-name extraction can render blank for leading-whitespace/empty names
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:1494-1545
   - Confidence: medium
   - Why it matters: `const first = member.name.split(/\s+/)[0] ?? member.name;` will produce `''` (empty string) for names that are empty or start with whitespace, resulting in a blank label in the score grid card header. While names are probably well-formed, this is a cheap robustness improvement.
   - Suggested fix: Use trimming and a fallback for empty results, e.g. `const trimmed = member.name.trim(); const first = trimmed.split(/\s+/)[0] || member.name;`

## Strengths

- Score input refs (`scoreInputRefs.current[idx] = el`) and `data-testid={`score-input-${idx}`}` are preserved, which should keep auto-advance + any tests keyed to those inputs working.
- Score input still uses `inputMode="numeric"`, `pattern="[0-9]*"`, and `maxLength={2}`; placeholder now shows par, which supports the “no steppers, use keypad + auto-advance” flow.
- Claim toggle buttons preserve `data-testid={`claim-${type}-${member.playerId}`}`, `aria-pressed`, and a descriptive `aria-label` including player name and hole number.

## Warnings

- Truncated file content for review: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx
