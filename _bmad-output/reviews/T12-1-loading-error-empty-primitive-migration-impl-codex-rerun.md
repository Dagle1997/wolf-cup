# Codex Review

- Generated: 2026-05-21T20:08:32.737Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/routes/index.tsx, apps/tournament-web/src/routes/events.$eventId.bets.tsx, apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx

## Summary

All three previously flagged copy/title regressions appear resolved in the provided route files:
- `/` error state now passes the full string "Couldn't load your events. Refresh to retry." and wires `onRetry`.
- `/events/:eventId/bets` empty state now uses the exact single title "No bets yet — organizer can add via admin." (no splitting).
- `/events/:eventId/courses/:courseId` pending/error/forbidden branches now render `PageShell title="Course"` (restoring the heading), while the success path intentionally keeps its custom gradient header.

No definite new copy regressions are visible in these route files, but there is one potential new TypeScript/behavior risk around passing `query.error` into `ErrorCard` without typing the query error type.

Overall risk: medium

## Findings

1. [medium] Potential type/contract mismatch: `useQuery<FetchOutcome>` leaves `query.error` as `unknown`, now passed directly to `ErrorCard`
   - File: apps/tournament-web/src/routes/events.$eventId.bets.tsx:94-120
   - Confidence: medium
   - Why it matters: In both updated routes, the previous implementation safely rendered errors via `String(query.error)`. After the change, `query.error` (typed as `unknown` because `useQuery` doesn’t specify the error generic) is passed directly into `ErrorCard`. If `ErrorCard`’s `error` prop is typed as `Error | string` (or similar), this becomes a TypeScript compile error. Even if it compiles (e.g., `error: unknown`), `ErrorCard` might not render unknown values as expected, potentially hiding useful diagnostics or rendering `[object Object]`.
   - Suggested fix: Either (a) type the query error: `useQuery<FetchOutcome, Error>({...})` (or your app’s error type), or (b) pass a normalized value: `error={query.error instanceof Error ? query.error : String(query.error)}`. Apply similarly in the course route.

2. [medium] Potential type/contract mismatch: `useQuery<FetchOutcome>` leaves `query.error` as `unknown`, now passed directly to `ErrorCard`
   - File: apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx:101-126
   - Confidence: medium
   - Why it matters: Same pattern as the bets route: `useQuery<FetchOutcome>` makes `query.error` `unknown`, and the new `ErrorCard error={query.error}` could either fail typechecking or produce inconsistent rendering depending on `ErrorCard`’s implementation.
   - Suggested fix: Type the query error (`useQuery<FetchOutcome, Error>`) or normalize before passing into `ErrorCard` (e.g., `String(query.error)` or `instanceof Error` check).

## Strengths

- Index route error copy is restored verbatim and now includes an explicit retry handler (`onRetry={eventsQuery.refetch}`) while keeping the same user-facing message (apps/tournament-web/src/routes/index.tsx:113-123).
- Bets empty state now uses the exact single title string as requested (apps/tournament-web/src/routes/events.$eventId.bets.tsx:137-145).
- Course route pending/error/forbidden branches correctly restore `PageShell title="Course"` while the success path retains its intentional custom header (apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx:108-142, 156-171).

## Warnings

None.
