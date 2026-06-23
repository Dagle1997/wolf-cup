# Codex Review

- Generated: 2026-06-23T17:04:46.904Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx, apps/tournament-web/src/routes/events.$eventId.leaderboard.test.tsx

## Summary

The scope-gate fix (expandable requires BOTH `roundId !== null` and `data.scope === 'round'`) does resolve the prior Medium: an event-aggregated leaderboard will not render expand controls or open a round scorecard even if the API mistakenly includes a `round` object. The new defensive test covers that contrived case. No new security/data-loss issues are evident in runtime behavior.

One potentially new build-breaking issue was introduced: `roundId` is typed as `string | null` but is passed to `RowScorecard` as `string` via a boolean `expandable` gate that does not narrow types in TS control-flow analysis. If your CI runs `tsc` with `strictNullChecks` (common), this can fail typechecking even though runtime is safe and Vitest may still transpile without type errors.

Overall risk: medium

## Findings

1. [high] Potential TS typecheck failure: `roundId` remains `string | null` when passed to `RowScorecard` (boolean gate doesn’t narrow)
   - File: apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx:356-540
   - Confidence: medium
   - Why it matters: `roundId` is defined as `const roundId = data.round?.id ?? null;` (type `string | null`) (line ~360). `RowScorecard` requires `roundId: string` (lines ~235–243) but is invoked as `<RowScorecard roundId={roundId} ... />` (line ~539) under `{expandable && isOpen ? ...}` where `expandable` is a separate boolean (line ~485). TypeScript does not generally narrow `roundId` based on the value of an unrelated boolean variable, so a `tsc`/typecheck step can fail even though the runtime gate is correct.
   - Suggested fix: Preserve narrowing at the call site, e.g. inline the condition:
- `const canExpand = data.scope === 'round' && data.round?.id;` and then render with `canExpand && isOpen ? <RowScorecard roundId={canExpand} .../> : null` (where `canExpand` is `string | undefined`, narrowed to `string`).
Or use `roundId !== null && data.scope === 'round' && isOpen ? ... <RowScorecard roundId={roundId} .../> ... : null` (no intermediate boolean).
As a last resort, `roundId!` is ok but less self-documenting.

## Strengths

- Scope-gate fix is correct and defensive: `expandable = roundId !== null && data.scope === 'round'` prevents event-scope expansion even if API misbehaves (apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx:482–487).
- New test explicitly locks in the defensive behavior for `scope='event'` + `round` present (apps/tournament-web/src/routes/events.$eventId.leaderboard.test.tsx:173–180).
- Lazy-fetch behavior is covered by a test and the component only mounts the query while expanded (test: 182–193; component: 533–543).
- Money cents→dollars adapter is null-preserving and covered by a direct assertion test (component: 209–224; test: 124–142).
- Inline handling of 403/404 as “unavailable” keeps the leaderboard resilient to partial failures (component: 250–279; test: 156–164).

## Warnings

None.
