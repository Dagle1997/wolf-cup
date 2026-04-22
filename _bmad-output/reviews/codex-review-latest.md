# Codex Review

- Generated: 2026-04-22T17:40:15.425Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/web/src/components/CtpSideGameCard.tsx, apps/web/src/routes/index.tsx

## Summary

Round-1 items look effectively closed: (1) explicit error handling is now present in the CTP card, (2) the title now respects server-provided `sideGame.name`, and (3) the responsive grid is now 2-col on very small screens and 4-col from `sm` up. `shortName()` is being fed a reasonable disambiguation scope (the set of names currently shown on the card).

No functional regressions jumped out in the `index.tsx` swap to `CtpSideGameCard` for `calculationType === 'manual'`. The only remaining issues I can substantiate from the diff are minor UX/correctness caveats around when the new error message appears and what it promises about retry behavior.

PASS: Yes—this is shippable as-is if you’re OK with the small UX caveats below (both low-risk).

Overall risk: low

## Findings

1. [low] CTP error message can appear even while previously-loaded winners are still displayed (background refetch error), which may look like flicker or false alarm
   - File: apps/web/src/components/CtpSideGameCard.tsx:49-91
   - Confidence: high
   - Why it matters: With React Query, a background refetch can fail while `data` remains populated from a prior success. In that state, `isError` becomes true but the UI will still render winners (because `winners = data?.currentWinners`), causing the red error line to appear transiently even though the card is still “working.” This matches your concern (D) about flashing/flicker.
   - Suggested fix: Gate the alert on missing data, or differentiate “stale/offline” from “no data.” For example:
- `if (isError && !data) { ... }`
- or show a subtler indicator when `isError && data` (e.g., “Live updates paused”).
Optionally use `isFetching`/`fetchStatus` to avoid showing the alert during active retries if that feels noisy.

2. [low] "Will retry" copy may be misleading in terminal rounds where polling is disabled
   - File: apps/web/src/components/CtpSideGameCard.tsx:44-90
   - Confidence: high
   - Why it matters: When `isTerminal` is true, `refetchInterval` is disabled (line 55). React Query will still do its built-in retries for a failing request, but after those are exhausted there may be no further automatic attempts (especially if window-focus refetch is not relied upon). The UI message (lines 88-90) asserts ongoing retry regardless of terminal state.
   - Suggested fix: Adjust the message based on `isTerminal`:
- Non-terminal: “Couldn’t load CTP state — will retry.”
- Terminal: “Couldn’t load CTP state.” / “Refresh to retry.”
Or keep one message that doesn’t promise retry behavior.

## Strengths

- Round-1 fixes are implemented in a straightforward, low-risk way: `name` is passed from `sideGame.name`, the 2-col/4-col grid breakpoint is corrected, and an explicit error state is now rendered for CTP fetch failures.
- `contextNames` is built from the exact set of names displayed on the card (PAR3 holes’ current winners), which is the correct scope for disambiguating collisions among those visible labels.
- Polling stops on terminal statuses, preventing needless network traffic after finalization/completion/cancellation.

## Warnings

- Truncated file content for review: apps/web/src/routes/index.tsx
