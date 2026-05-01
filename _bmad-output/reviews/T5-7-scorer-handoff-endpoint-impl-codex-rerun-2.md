# Codex Review

- Generated: 2026-05-01T13:32:12.704Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/scorer-assignments.ts, apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx, apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx, apps/tournament-web/src/lib/offline-queue.ts, _bmad-output/implementation-artifacts/tournament/T5-7-scorer-handoff-endpoint.md

## Summary

T5-7 web expansion generally matches the intended offline-queue flow: handoff uses enqueueMutation(kind/url/body/clientEventId/roundId), drains only when online, and the stale-queue banner is scoped by roundId with sessionStorage-backed dismissal + details toggle. However, there are a few concrete correctness/spec-alignment gaps: (1) terminal-code registration for scorer_handoff omits an actual API code (round_not_found), which can lead to pointless retries/purge behavior; (2) StaleQueueBanner’s dismissal state is not reactive to roundId changes (potential cross-round leak if the route param changes without a remount); (3) stale-queue filtering can mix different currentScorerName values while the banner copy uses only the newest name; and (4) clientEventId fallback is not UUIDv4 despite comments/spec emphasis. There’s also a likely UX/spec gap around surfacing terminal drain failures back into HandoffControl (it only shows errors if something throws).

Overall risk: medium

## Findings

1. [medium] scorer_handoff terminal error registry missing API’s 404 code (round_not_found)
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:342-364
   - Confidence: high
   - Why it matters: The API can return `{ code: 'round_not_found' }` with 404 for this endpoint (apps/tournament-api/src/routes/scorer-assignments.ts:116–121). The web registers 8 terminal codes for `scorer_handoff`, but does not include `round_not_found` (score-entry.tsx:354–363). If the queue’s drain logic treats “unregistered 4xx codes” as transient, a 404 could be retried until MAX_TRANSIENT_RETRIES and then purged—wasting time and potentially losing the queued handoff intent without a clear terminal classification path.
   - Suggested fix: Add `round_not_found` to the `registerTerminalErrors('scorer_handoff', ...)` list (and consider whether other non-retriable codes like `event_not_resolvable` should be handled as terminal too, depending on drain semantics). Add/extend a test to assert `round_not_found` is included.

2. [medium] StaleQueueBanner dismissal state can leak across rounds if roundId changes without remount
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:664-703
   - Confidence: medium
   - Why it matters: `dismissed` is initialized once from `sessionStorage.getItem(dismissKey)` using a useState initializer (score-entry.tsx:665–671). If the component instance remains mounted while navigating between rounds (param-only navigation), `dismissKey` changes but `dismissed` will not recompute—so a dismissal in round A can incorrectly hide the banner in round B for that session (or vice versa). The code currently relies on an implicit remount behavior that is not guaranteed.
   - Suggested fix: Make dismissal state respond to `roundId` changes (e.g., `useEffect(() => setDismissed(sessionStorage.getItem(newKey)==='1'), [roundId])`) or force a remount by keying the banner/component with `key={roundId}` from the parent.

3. [medium] StaleQueueBanner can aggregate mismatched scorer names; copy uses only the newest entry’s currentScorerName
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:674-736
   - Confidence: high
   - Why it matters: `matches` includes any errored entries for the round with mismatch codes and a string `currentScorerName` (score-entry.tsx:674–686). The banner message then uses `newest` entry’s `currentScorerName` (score-entry.tsx:691–694) but the details list renders all `matches`. If the scorer changed multiple times (or errors contain different names), the banner can say “Alice is now scoring…” while the expanded list includes entries whose `currentScorerName` is Bob—confusing and contrary to the stated goal of surfacing the held entries “with the new scorer’s name”. This also weakens the requested “filtered by code + currentScorerName” behavior (focus item #6).
   - Suggested fix: Filter to a single scorer identity before rendering: e.g., compute `newScorerName` first (from the newest mismatch), then filter `matches` to `entry.lastError.body.currentScorerName === newScorerName`. Alternatively pass the authoritative current scorer name from round detail into `StaleQueueBanner` and filter against that.

4. [low] HandoffControl clientEventId fallback is not UUID v4 (comment/spec says UUID v4)
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:518-535
   - Confidence: high
   - Why it matters: `HandoffControl` generates `clientEventId` via `crypto.randomUUID()` when available, but falls back to `evt-${Date.now()}-${Math.random()...}` (score-entry.tsx:524–527). That fallback is not UUIDv4 and has weaker uniqueness properties. Given the code/comment path (“UUID v4”) and the review focus item #2, this is a mismatch that could matter if any downstream logic assumes UUID format (now or later).
   - Suggested fix: Use a UUIDv4-compatible fallback (e.g., use `crypto.getRandomValues` to format RFC4122 v4 when `randomUUID` is missing) or pull in a tiny UUID library. If format truly doesn’t matter for `scorer_handoff`, update comments/spec/tests to reflect “unique string” rather than “UUID v4”.

5. [low] HandoffControl has no explicit path to surface terminal drain failures unless queueDrain throws
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:518-559
   - Confidence: medium
   - Why it matters: AC-8 prose indicates that on terminal 4xx the queue removes the entry and “the inline error renders”. In `HandoffControl`, `error` is only set in the `catch` block (score-entry.tsx:556–559). If `queueDrain()` reports failures via `queue.drainError` state (as `useOfflineQueue` commonly does) rather than throwing, the UI will close the picker and invalidate queries even though the handoff failed, without showing a helpful error/code. This is especially relevant for `not_authorized_for_handoff` and `assignee_not_in_foursome` outcomes.
   - Suggested fix: Plumb drain status/error into `HandoffControl`: pass `queue.drainError` (and possibly `isDraining`) as props and render a specific message when it’s set after drain; or have `queueDrain` throw/return a structured result for terminal failures that the component can display. Add a test that simulates a terminal drain failure and asserts the error is shown and the picker remains open.

## Strengths

- HandoffControl correctly routes the transfer through the offline queue with `kind: 'scorer_handoff'`, correct URL, and body matching the API schema (foursomeNumber/toPlayerId).
- Online vs offline behavior is explicitly separated: offline skips drain and keeps the picker open with a queued indicator; online drains then invalidates `['round-detail', roundId]` to accelerate the read-only transition.
- StaleQueueBanner is roundId-scoped at the data level (`peekErroredEntries(roundId)`) and the dismissal key includes roundId, reducing cross-round persistence risk in the common remount case.
- peekErroredEntries is a read-only helper and does not mutate the queue/errored stores, which limits risk of accidental data loss.
- Test suite expansion covers the key new UI behaviors (enqueue shape, drain called/skipped based on navigator.onLine, dismiss persistence, details toggle, and terminal-error registration).

## Warnings

None.
