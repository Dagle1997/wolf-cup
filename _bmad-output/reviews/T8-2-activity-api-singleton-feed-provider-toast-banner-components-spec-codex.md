# Codex Review

- Generated: 2026-05-06T02:14:02.610Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T8-2-activity-api-singleton-feed-provider-toast-banner-components.md

## Summary

Round-2 cursor contract is materially clearer (non-empty responses always return a cursor; empty-after polls echo the request cursor to signal “caught up”). However, the spec still contains internal contradictions and a few frontend-provider pseudocode gaps that would likely reintroduce pagination/loop bugs or make the singleton test hard to implement as written.

Overall risk: medium

## Findings

1. [high] Spec still asserts null-terminated pagination/looping in multiple places, contradicting the new cursor-equality “caught up” contract
   - File: _bmad-output/implementation-artifacts/tournament/T8-2-activity-api-singleton-feed-provider-toast-banner-components.md:29-35
   - Confidence: high
   - Why it matters: You rewrote semantics so `nextCursorAfter` is not a terminus signal on non-empty responses, and “caught up” is detected by (a) empty `rows` and (b) `nextCursorAfter === request.afterCursor` (lines 29–33). But the spec still instructs clients/tests to “loop until null” and/or uses conditions that will never become false under the new contract:
- Backend burst-drop test description loops “until null” (line 116).
- Provider burst-drop loop condition is `nextCursorAfter !== null` (lines 186–189) which will be true for any non-empty response, and under your server contract, also true for the empty caught-up response if the request cursor was non-null (it will be echoed).
- AC #3 explicitly says the client loops “while `nextCursorAfter !== null`” (lines 313–314). 
If implemented literally, this can cause infinite loops or tests that never terminate once the client has a non-null cursor and the server returns empty pages by echoing the same cursor.
   - Suggested fix: Update all loop termination language to match the new contract. For `?after` burst-drop catch-up, a robust loop condition is:
- stop when `rows.length === 0` OR when `nextCursorAfter === requestAfterCursor` (explicit caught-up), with a defensive max-iterations cap.
If you want to avoid one extra “empty” request, you can stop when `rows.length < 100` *as an optimization* but don’t describe it as the correctness terminus given lines 33–34. Align backend test #5/AC#3/provider pseudocode to one consistent terminus rule.

2. [high] ActivityFeedProvider bootstrap→live transition is underspecified; given the pseudocode, live polling may never start
   - File: _bmad-output/implementation-artifacts/tournament/T8-2-activity-api-singleton-feed-provider-toast-banner-components.md:162-177
   - Confidence: high
   - Why it matters: The `useQuery` snippet introduces `bootstrapped` and `afterCursor` state (lines 163–170) and sets `refetchInterval: bootstrapped ? 5_000 : false` (line 174). But the pseudocode never shows where `setBootstrapped(true)` happens or where `setAfterCursor(res.nextCursorAfter)` is applied after the bootstrap response. As written, the query runs once (bootstrap), then `bootstrapped` stays false, so `refetchInterval` remains false and live polls never occur. This is a functional correctness gap in the core contract you asked to validate.
   - Suggested fix: Add explicit transition logic in the spec (e.g., in `onSuccess` / `useEffect`):
- On first successful bootstrap response: set `rows`, set `afterCursor = res.nextCursorAfter`, set `cursorBefore = res.nextCursorBefore`, set `bootstrapped = true`.
- Thereafter, on each live poll success: prepend/merge, update `afterCursor`, and keep `bootstrapped` true.
Also clarify how you prevent double-bootstrap when `afterCursor` changes.

3. [high] Provider `queryKey` includes `afterCursor`, which can create multiple queries (cache growth) and undermines the “single subscription” invariant
   - File: _bmad-output/implementation-artifacts/tournament/T8-2-activity-api-singleton-feed-provider-toast-banner-components.md:165-177
   - Confidence: high
   - Why it matters: `queryKey: ['activity', eventId, afterCursor ?? 'bootstrap']` (line 166) means every cursor advancement creates a new query key. In TanStack Query that typically means a distinct cached Query instance, not a single long-lived “subscription.” This can:
- make `queryClient.getQueryCache().getAll().length` grow over time (contradicting the singleton intent),
- complicate correct refetch/interval behavior,
- and make it easier for multiple overlapping queries to exist during rapid cursor updates (especially with the burst-drop inner loop described later).
This is a concrete new failure mode introduced by the bootstrap/live refactor + singleton requirement.
   - Suggested fix: Use a stable key per event, e.g. `['activity', eventId]`, and keep `afterCursor`/`bootstrapped` as internal state used by the queryFn/refetch logic. Alternatively, use `useInfiniteQuery` with a single key and explicit page params. If you keep `afterCursor` in the key, you need explicit cache eviction (`cacheTime/gcTime`) and a revised singleton-test strategy.

4. [medium] Frontend context types still use `ActivityEvent[]` but Banner/Toast requirements and backend response define `ActivityRow` with `id`/`createdAt`
   - File: _bmad-output/implementation-artifacts/tournament/T8-2-activity-api-singleton-feed-provider-toast-banner-components.md:59-75
   - Confidence: high
   - Why it matters: The backend response is explicitly `ActivityRow` with `id` and `createdAt` (lines 59–71) and you justify why consumers need those fields (line 73). But the provider context defines `rows: ActivityEvent[]` and `subscribe(handler: (newRows: ActivityEvent[]) => void)` (lines 135–145). Meanwhile, the banner spec needs `activity.id` for localStorage dismissal (lines 238–239), and the feed UI needs ids for React keys (line 73). If the provider truly exposes only `ActivityEvent`, the banner dismissal keying becomes impossible or forces re-deriving ids (not available) or changing types later (risking T8-3/T8-4 churn).
   - Suggested fix: Make the provider context use `ActivityRow[]` (and `subscribe` emit `ActivityRow[]`), or define a clearly named client type like `ActivityItem = ActivityRow` and use it consistently in provider/hooks/components. If Toast only needs the event payload, it can read `row.event` while still keeping `row.id` for keys/dismissals.

5. [medium] Singleton invariant test spec is internally inconsistent and may not measure what you intend
   - File: _bmad-output/implementation-artifacts/tournament/T8-2-activity-api-singleton-feed-provider-toast-banner-components.md:370-376
   - Confidence: high
   - Why it matters: In the “Round-1 → fixes” notes you say the test should assert `queryClient.getQueryCache().getAll()` count (subscriptions/queries), not fetch count. But AC #11 then describes a different approach: “spy on the provider’s queryFn… advance fake timers… assert the queryFn was registered exactly once” (lines 372–375). In practice:
- Spying on “registration” is non-trivial because `useQuery` takes a function inline; you can spy on calls, not “registration,” unless you refactor to inject the queryFn.
- `getQueryCache().getAll().length` counts Query objects, not “subscriptions,” and with your current `queryKey` including `afterCursor` (line 166), it will likely exceed 1 even with a single provider.
This makes the AC hard to implement faithfully and easy to get false positives/negatives.
   - Suggested fix: Pick one measurable invariant and align code structure to it. Options:
1) Assert exactly one Query exists for `['activity', eventId]` (requires stable key).
2) Assert exactly one network polling loop runs by instrumenting fetch (but accept multiple calls for burst-drop within one tick).
If you truly need “one provider drives all consumers,” a React-level test that mounts multiple consumers and asserts only one provider instance + one query key is present is clearer than “registered once.”

6. [low] Corrupt-row pseudocode type mismatch (`decodedRows` typed as `ActivityEvent[]` but pushes `ActivityRow` objects)
   - File: _bmad-output/implementation-artifacts/tournament/T8-2-activity-api-singleton-feed-provider-toast-banner-components.md:81-90
   - Confidence: high
   - Why it matters: The pseudocode declares `const decodedRows: ActivityEvent[] = [];` (line 83) but pushes `{ id, createdAt, event: parsed }` (line 87), which is an `ActivityRow`. While this is “just spec pseudocode,” it’s likely to be copy/pasted into implementation and cause avoidable type confusion—especially since the spec elsewhere is already juggling `ActivityEvent` vs `ActivityRow`.
   - Suggested fix: Change the pseudocode to `const decodedRows: ActivityRow[] = [];` and ensure naming is consistent with the response shape section (lines 59–71).

7. [low] Client URL construction interpolates cursor directly without encoding
   - File: _bmad-output/implementation-artifacts/tournament/T8-2-activity-api-singleton-feed-provider-toast-banner-components.md:168-172
   - Confidence: medium
   - Why it matters: The queryFn builds `...?after=${afterCursor}` (line 169). Your cursor is base64url so it’s *likely* URL-safe, but relying on that property is brittle if the format ever changes (or if other params are added). Encoding also prevents accidental breakage due to unexpected characters.
   - Suggested fix: Use `encodeURIComponent(afterCursor)` when building the URL, and similarly for `before` if/when used on the client.

## Strengths

- Cursor contract is substantially improved versus round-1: non-empty pages always produce a resumable cursor; caught-up is explicitly signaled by empty rows + cursor non-advancement (lines 29–33).
- Corrupt-row handling correctly separates cursor advancement from decoded-row filtering, preventing “stuck re-fetching” corrupt rows (lines 77–102).
- Mutual-exclusion validation for `after`+`before` is explicit and test-covered in the spec (lines 25–26, 119–120).
- Compound `(createdAt,id)` strict-newer/older predicates and tie-break ordering are clearly specified, addressing same-timestamp stability (lines 39–53, 316–320).

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T8-2-activity-api-singleton-feed-provider-toast-banner-components.md
