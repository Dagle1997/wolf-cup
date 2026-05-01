# Codex Review

- Generated: 2026-05-01T13:35:06.345Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/T5-7-scorer-handoff-endpoint-party-review.md, _bmad-output/reviews/T5-7-scorer-handoff-endpoint-impl-codex-rerun-2.md, apps/tournament-api/src/routes/scorer-assignments.ts, apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx, _bmad-output/implementation-artifacts/tournament/T5-7-scorer-handoff-endpoint.md

## Summary

Web-side expansion largely matches the updated spec intent: scorer handoff is now routed through the offline queue (enqueueMutation + conditional drain), terminal error codes for scorer_handoff include round_not_found, and the stale-queue banner is dismissible (sessionStorage) with a details toggle and is mounted only in the read-only (!isScorer) branch.

Two concrete gaps remain in the provided code/spec alignment: (1) the StaleQueueBanner “View errored entries” panel does not actually show “ALL matching entries regardless of name” as both the spec followup note and the in-code comment claim; it only shows the filtered subset for the newest currentScorerName; and (2) HandoffControl still has no deterministic way to surface terminal (4xx) drain failures inline (it only shows errors if something throws), which conflicts with AC-8’s stated “inline error renders” behavior unless the queue implementation throws on terminal failures.

The iteration-3 Medium fixes claimed (round_not_found terminal registration; roundId-reactive dismissal; currentScorerName grouping for the banner count/copy) are present in the provided file, with the caveat about the details panel behavior noted above.

Overall risk: medium

## Findings

1. [medium] StaleQueueBanner details toggle contradicts spec/comment: it renders only newest-name subset, not “all matching entries”
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:701-765
   - Confidence: high
   - Why it matters: Both the spec followup note and the component comment state that the banner count/copy is filtered to the newest currentScorerName, while the “View errored entries” expansion shows ALL matching entries regardless of name. However, the implementation renders `matches.map(...)` in the details list (lines 756–765), where `matches` is filtered to `currentScorerName` only (lines 712–718). This is a spec/impl drift and a UX/debugging problem: older held mutations from earlier handoffs won’t be visible, contradicting the documented tradeoff and making “what needs re-entry” incomplete for organizer/scorer triage.
   - Suggested fix: Decide which behavior is intended and make code/spec consistent. If the intent is “details shows all”, render `allMatches` (or a grouped view) when `showDetails` is true, while keeping the banner copy/count on `matches`. If the intent is “details shows only newest-name subset”, update the spec note and the in-code comment (lines 701–707) to match reality.

2. [medium] AC-8 ‘inline error renders on terminal 4xx’ is not guaranteed: HandoffControl only displays errors on thrown exceptions
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:521-562
   - Confidence: medium
   - Why it matters: After enqueueing, online flow calls `await queueDrain()` then immediately invalidates and closes the picker (lines 550–558). The only displayed error path is the `catch` block, which labels errors as “Network error” (lines 559–562). If the offline-queue drain reports terminal HTTP failures by recording state (e.g., moving entry to errored/purging) without throwing, the UI will close and appear successful even when the handoff was rejected (e.g., 403 not_authorized_for_handoff, 422 round_finalized). This conflicts with AC-8’s specified behavior: “On 4xx … the inline error renders.”
   - Suggested fix: Plumb drain outcome back into HandoffControl. Options: (a) change `queueDrain` to return a structured result (success/failed + lastError) and keep picker open + show message on terminal failure, or (b) pass `queue.drainError`/events into HandoffControl and react after drain. Add a web test that simulates a terminal failure and asserts the picker remains open and an error is shown.

3. [low] HandoffControl clientEventId fallback is not UUIDv4-shaped
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:527-536
   - Confidence: high
   - Why it matters: When `crypto.randomUUID` is unavailable, the fallback `evt-${Date.now()}-${Math.random()...}` is not UUIDv4. If any downstream logic (now or later) assumes UUID format (or if tests/spec imply UUID), this can create avoidable inconsistency. The spec already documents this as a followup, but the code still embeds the mismatch.
   - Suggested fix: Use a UUIDv4-compatible fallback (e.g., RFC4122 v4 via `crypto.getRandomValues`) or relax comments/spec/tests to require only a unique string.

## Strengths

- AC-8 offline-queue path is implemented: handoff uses `enqueueMutation({ kind: 'scorer_handoff', url, body, clientEventId, roundId })` and drains only when online (apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:531–556).
- Iteration-3 terminal-code fix landed: `round_not_found` is included in `registerTerminalErrors('scorer_handoff', ...)` (score-entry.tsx:356–366).
- Iteration-3 dismissal fix landed: banner dismissal state is re-read on roundId/dismissKey change via `useEffect` (score-entry.tsx:675–683).
- Iteration-3 currentScorerName grouping for banner count/copy landed: banner count uses `matches` filtered to `currentScorerName` derived from the newest mismatch (score-entry.tsx:701–741), preventing name/count inconsistency in the banner message.
- Banner is gated to the read-only branch (`!isScorer`) as documented, reducing false positives when the user is currently the scorer (score-entry.tsx:422–437).

## Warnings

None.
