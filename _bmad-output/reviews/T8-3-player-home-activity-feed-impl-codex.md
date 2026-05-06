# Codex Review

- Generated: 2026-05-06T22:53:01.612Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/lib/activity-headline.ts, apps/tournament-web/src/lib/activity-headline.test.ts, apps/tournament-web/src/components/activity-feed.tsx, apps/tournament-web/src/components/activity-feed.test.tsx, apps/tournament-web/src/components/tournament-toast.tsx, apps/tournament-web/src/components/tournament-banner.tsx, apps/tournament-web/src/routes/events.$eventId.index.tsx, apps/tournament-web/src/routes/events.$eventId.index.test.tsx

## Summary

Implementation largely matches the ACs: ActivityFeed consumes the hook (no polling), two-stage “Load more” behavior is present, empty-state precedence is enforced, and Toast/Banner headline generation is consolidated behind `buildActivityHeadline` with substantial test coverage.

Main correctness risk is routing for `scorer.transferred`: the feed unconditionally creates a `/rounds/$roundId/score-entry` link even if `roundId` is missing, which can generate malformed URLs (or unexpected router behavior). A secondary risk is that the shared headline helper happily formats missing/invalid numeric fields into `NaN`-laden strings (e.g. `+NaN`, `$NaN`), which is user-visible if upstream validation ever loosens/regresses.

Overall risk: medium

## Findings

1. [high] `scorer.transferred` can generate a malformed round link when `roundId` is missing
   - File: apps/tournament-web/src/components/activity-feed.tsx:136-156
   - Confidence: high
   - Why it matters: For `route.kind === 'round'`, the code does `const roundId = String(row.event['roundId'] ?? '')` and always renders a `<Link to="/rounds/$roundId/score-entry" params={{ roundId }}>`. If the event payload ever omits `roundId` (or it is null/undefined), this produces `/rounds//score-entry` and still renders as a link. That’s a broken navigation at best; depending on TanStack Router configuration, it can also surface route resolution errors or unexpected matches.
   - Suggested fix: Guard round routing on a non-empty roundId. For example:
- In `routeForType`, return `{ kind: 'none' }` unless `row.event.roundId` is a non-empty string; or
- In `FeedRow`, if `route.kind === 'round'` but `!roundId`, fall back to the non-link `<div>`.
Add a test case asserting `scorer.transferred` without `roundId` renders as a non-link (or at least does not produce `/rounds//score-entry`).

2. [medium] Shared headline helper can emit user-visible `NaN`/placeholder strings if upstream payload is missing fields
   - File: apps/tournament-web/src/lib/activity-headline.ts:35-127
   - Confidence: medium
   - Why it matters: Multiple builders coerce unknown fields with `Number(...)` and then format them directly (`toParDescriptor(toPar)`, `toFixed(2)`, `${multiplier}x`, etc.). If any expected field is missing or non-numeric (e.g. `toPar`, `stakePerHoleCents`, `totalPotCents`, `holeNumber`), the UI will show degraded copy like `+NaN`, `$NaN/hole`, `hole NaN`, etc. Even if current Zod validation prevents this, the helper is now shared across three surfaces; a future schema relaxation/regression would fan out the issue.
   - Suggested fix: Add minimal defensive formatting:
- Use `const n = Number(x); const safe = Number.isFinite(n) ? n : null;` and branch to a fallback string when null.
- For money fields, fall back to `$0.00` or `$(unknown)` rather than `$NaN`.
Consider adding one or two tests that omit these fields and assert the fallback behavior.

## Strengths

- ActivityFeed correctly consumes `useActivityFeed` and implements the intended local-slice → remote-backfill Load more flow, with empty-state precedence (`rows.length === 0` returns early).
- Synchronous re-entry guard (`loadingMoreRef`) is correctly positioned before the awaited `loadMore()` call to prevent rapid double-click duplication during remote fetch.
- Headline consolidation is cleanly isolated in a pure helper, and the matrix-style tests cover surface differentiation and the toPar descriptor mapping well.
- Routing uses the TanStack `to` + `params` pattern, and component tests validate at least one concrete href generation (`score.committed` → leaderboard).

## Warnings

None.
