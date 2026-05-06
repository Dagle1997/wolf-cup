# Codex Review

- Generated: 2026-05-06T13:14:53.921Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/T8-2-activity-api-singleton-feed-provider-toast-banner-components-party-review.md, apps/tournament-api/src/services/activity-feed.ts, apps/tournament-web/src/providers/activity-feed-provider.tsx, apps/tournament-web/src/providers/activity-feed-provider.test.tsx

## Summary

Evidence from the provided files supports most of the party review’s claims about backend cursor semantics and the “cursor advances past corrupt physical rows” behavior. However, there are two reliability issues in the web provider that the party review treats as non-blocking (or doesn’t mention) but are likely load-bearing in real navigation/backfill scenarios. Additionally, the “250-row burst-drop during bootstrap” test appears to model an impossible backend interaction given the backend’s initial-cursor semantics, which weakens the confidence of the PASS verdict.

Overall risk: medium

## Findings

1. [high] Side effects inside React Query queryFn can leak stale activity into state on eventId changes (navigation race)
   - File: apps/tournament-web/src/providers/activity-feed-provider.tsx:195-255
   - Confidence: high
   - Why it matters: The provider’s useQuery `queryFn` performs side effects: `setRows(...)`, `setCursorBefore(...)`, mutating refs, and notifying subscribers (lines 208–244). If the user navigates between events (this provider explicitly supports eventId changes via URL detection), an in-flight query for the previous `queryKey` can still resolve and execute these side effects after `eventId` has changed and after the “reset state when eventId changes” effect ran (lines 177–183). React Query may drop/ignore results for an unsubscribed observer, but it cannot prevent side effects already executed inside `queryFn`. This can mix activity rows from the old event into the new event’s UI/notifications—trip-day confusing and hard to reproduce.
   - Suggested fix: Make `queryFn` side-effect-free and move state/subscriber updates to `onSuccess` (observer-scoped) or a `useEffect` that reacts to `query.data`. Alternatively, use React Query cancellation properly: accept `{ signal }` in `queryFn` and pass it to `fetch`, and/or capture `eventId` at invocation start and bail out before applying state if it no longer matches current `eventId`.

2. [medium] loadMore() never advances/clears cursorBefore on empty before-page, enabling infinite repeated requests
   - File: apps/tournament-web/src/providers/activity-feed-provider.tsx:257-280
   - Confidence: high
   - Why it matters: Backend semantics (as documented in `getActivityPage`) echo the request cursor when there is “no older” data in before-mode. In `loadMore`, cursorBefore is only updated inside `if (body.rows.length > 0)` (lines 265–278). If the server returns an empty page (end of history), `cursorBefore` remains unchanged, so the UI can keep offering (or repeatedly calling) loadMore and will hit the same URL forever, wasting network and potentially creating a stuck “Load more” UX in T8-3.
   - Suggested fix: Handle the empty-page case explicitly: if `body.rows.length === 0`, set `cursorBefore` to null (or track a `hasMore=false`). If you rely on the backend echo behavior, compare `body.nextCursorBefore` to the requested `cursorBefore`; if equal and rows empty, treat as terminal and clear/disable further loads.

3. [low] Burst-drop test models behavior inconsistent with backend initial-cursor semantics (false confidence)
   - File: apps/tournament-web/src/providers/activity-feed-provider.test.tsx:137-223
   - Confidence: high
   - Why it matters: Backend `getActivityPage` sets `nextCursorAfter` to the NEWEST physical row for initial (DESC) queries (apps/tournament-api/src/services/activity-feed.ts lines 189–200). The provider’s burst loop then uses `?after=<nextCursorAfter>`. Against the real backend, that second request would return only rows STRICTLY newer than the newest row from bootstrap—typically empty—so a 3-call bootstrap accumulation of 250 rows is not a realistic interaction. The current test still exercises the client loop, but it does not validate the real “250 new rows since last cursor” catch-up scenario and may mask regressions in the true burst condition.
   - Suggested fix: Rewrite the test to simulate the intended burst scenario: start with `bootstrapped=true` and a non-null `initialAfterCursor` (i.e., “caught up at T0”), then have subsequent `?after=` calls return 100/100/50 new rows. Alternatively, drive it via provider state by performing an initial fetch, then triggering a refetch where the after-cursor is set, and only then asserting the multi-iteration behavior.

## Strengths

- Backend paging service enforces PAGE_LIMIT=100 and uses strict comparisons for both after and before windows (apps/tournament-api/src/services/activity-feed.ts lines 100–126).
- Corrupt-row defense is implemented with schema lookup + JSON.parse try/catch + Zod safeParse, and cursor advancement is computed from physical SQL rows, not decoded rows (apps/tournament-api/src/services/activity-feed.ts lines 128–167, 176–212).
- Provider keeps cursor state out of the queryKey via refs and uses a stable `queryKey: ['activity', eventId]`, matching the singleton-query intent (apps/tournament-web/src/providers/activity-feed-provider.tsx lines 171–215).

## Warnings

None.
