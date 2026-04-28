# Codex Review

- Generated: 2026-04-28T19:07:22.060Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md

## Summary

Spec shows meaningful progress on Round-1 issues (event-scoped endpoint, cache source tagging, retry:false, and ApiError-vs-network discrimination). However, there are several internal contradictions in the spec’s Acceptance Criteria and Risks/Followups that could easily cause an incorrect (and potentially less secure) implementation. These need to be reconciled before the spec is truly “Ready for Dev.”

Overall risk: high

## Findings

1. [high] AC #1 contradicts the corrected event-scoped endpoint + middleware chain (risk of reintroducing permissive route)
   - File: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md:46-55
   - Confidence: high
   - Why it matters: In Risk Acceptance §3, the spec correctly states the intended path is `GET /api/events/:eventId/rounds/:roundId/course` and the auth chain is `requireSession → requireEventParticipant`, plus a defensive `round.event_id === :eventId` check (lines 46-55). But AC #1 later instructs implementers to add `scoresRouter.get('/:roundId/course', requireSession, ...)` (lines 182-187). That AC wording points to a different URL shape (no :eventId) and omits `requireEventParticipant`, which is exactly the Round-1 HIGH that was “resolved.” If a dev follows AC #1 literally, they could implement the wrong route and weaken authorization/tenant isolation.
   - Suggested fix: Update AC #1 to match the resolved design precisely: endpoint path `GET /api/events/:eventId/rounds/:roundId/course`, middleware `requireSession` then `requireEventParticipant`, and include the explicit defensive check `round.event_id === eventId` with the documented 404 behavior. Remove/replace any mention of `scoresRouter.get('/:roundId/course', ...)` if that is not the intended path.

2. [medium] Banner scope is contradictory (implemented now vs deferred to v1.5)
   - File: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md:158-159
   - Confidence: high
   - Why it matters: The spec says the course-revision-superseded banner is added back into scope (line 158) and Test #11 pins it (lines 240-244). But later the spec’s Followups section says the banner is a v1.5 item (line 267) and Risks repeats deferral (line 275). This ambiguity can cause dev/test mismatch (either banner code is written but later “removed as followup,” or tests are skipped/ignored).
   - Suggested fix: Make a single decision in the spec: either (a) banner is in v1 (keep line 158 + Test #11; delete/adjust Followups/Risks references to deferral), or (b) banner is v1.5 (remove Test #11 and the implementation requirement).

3. [medium] Spec still mentions isNetworkError heuristic even though it was replaced (implementation guidance contradiction)
   - File: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md:131-142
   - Confidence: high
   - Why it matters: The spec’s main implementation guidance explicitly replaces the heuristic with `ApiError` vs missing `.status` discrimination (lines 131-142). But the Risks section later states “The spec uses `isNetworkError(err)` heuristic” (line 273), which is no longer accurate and could lead to reintroducing the brittle message-substring approach or confusion during implementation.
   - Suggested fix: Update Risks § navigator.onLine/fetch failure to describe the new approach (status-field discrimination / ApiError vs non-ApiError), and remove references to `isNetworkError(err)` if it’s no longer part of the design.

4. [medium] JSON.stringify equality for course-change detection may be unstable and cause false “updated” banners
   - File: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md:158
   - Confidence: medium
   - Why it matters: Using `JSON.stringify(cached) !== JSON.stringify(fresh)` is sensitive to key order and array ordering. The spec guarantees holes are ordered (line 91-92 / AC #2), but tees ordering is not explicitly specified (line 92) and object key order in `yardagePerTee` can differ depending on construction. This can produce false positives (banner appears every refetch) or flakiness in Test #11 if fixtures serialize differently than runtime data.
   - Suggested fix: Specify a stable comparison: e.g., compare `courseRevisionId` (preferred if it changes when course data changes), or normalize/sort `tees` by `teeColor` and normalize `yardagePerTee` keys before compare, or do a targeted compare of fields that matter for UX (par/si/yardages). If you keep stringify, explicitly require server to return deterministic ordering for tees and deterministic key construction for yardagePerTee.

5. [low] `__source` field mixed into domain data risks accidental persistence/propagation
   - File: _bmad-output/implementation-artifacts/tournament/T5-4-offline-course-scorecard-shell-cache.md:124-156
   - Confidence: medium
   - Why it matters: The spec now returns `RoundDetail & { __source: 'network' | 'cache' }` from the query (lines 124-147) and uses it for UI (line 155-156). This resolves the offline chip ambiguity, but it does “pollute” the query data type with transport metadata. While your described write-path writes `fresh` (without `__source`) to cache (line 128-131), future refactors might accidentally pass query data into cache writes and persist `__source`, or leak it into components expecting the pure API shape.
   - Suggested fix: Consider returning `{ data: RoundDetail, source: 'network'|'cache' }` (or `meta`) from the wrapper function/hook, or keep `__source` but explicitly document/ensure cache writes always persist the unadorned payload and add a test asserting cached objects do not include `__source`.

## Strengths

- The event-scoped URL and `requireSession → requireEventParticipant` chain described in Risk Acceptance §3 is the right direction for tenant/event isolation (lines 46-55).
- The cache-fallthrough logic now avoids the brittle message-substring heuristic and aligns with a typed `ApiError` vs non-HTTP network failure approach (lines 131-142).
- `retry: false` on the queries directly addresses the offline UX issue of burning retries before falling back to cache (line 153).
- The spec includes a concrete test floor (+16) and enumerates backend + cache-lib + integration tests, which helps keep behavior from regressing (lines 160-244).

## Warnings

None.
