# Gemini Review

- Generated: 2026-06-23T19:11:01.408Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx

## Summary

Visual polish to condense the player cards for a 4-player brochure shot. The layout tightening and a11y tap targets are well executed, and React key/ref stability is preserved. However, the intentional removal of the putts input creates a critical data loss risk for active putting games, and leaves orphaned state in the component.

Overall risk: high

## Findings

1. [high] Data Loss Risk: Overwriting putts with null deletes active putting data
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:1567-1599
   - Confidence: high
   - Why it matters: While removing the putts UI was intended for the visual brochure shot, defaulting the save payload to `null` will silently overwrite and delete previously recorded putts every time a hole's score is updated. This causes irreversible data loss for any active tournament tracking putts.
   - Suggested fix: If the UI is deferred for the brochure, ensure the save mutation preserves the previously fetched putts value for the hole instead of unconditionally writing `null`, or keep the input visually hidden.

2. [low] Orphaned `currentPutts` component state
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:1270-1281
   - Confidence: high
   - Why it matters: `handlePuttsChange` and the corresponding `<input>` were removed, but retaining the `currentPutts` state variable to feed `null` to the save payload leaves dead code in the component, confusing future maintenance.
   - Suggested fix: Remove the `currentPutts` state initialization and its setter entirely. Update the save function to either hardcode `null` or pull the existing putts value directly from the round data.

## Strengths

- Successfully condensed the UI to fit 4 players without requiring a scroll, aligning perfectly with the brochure shot goal.
- Maintained strong a11y tap targets (48px for score steppers) despite the tightened padding and layout constraints.
- Preserved React structural stability within the `key={member.playerId}` wrapper, ensuring DOM inputs are reused and the iOS keyboard remains open across hole advances.

## Warnings

- Truncated file content for review: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx
