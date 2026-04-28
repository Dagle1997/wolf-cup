# Codex Review

- Generated: 2026-04-28T17:40:53.262Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/scores.ts, apps/tournament-api/src/routes/scores.read.test.ts, apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx, apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx, apps/tournament-web/PORTS.md

## Summary

Backend adds GET /api/rounds/:roundId score-entry context with tenant-scoped lookup and good negative-path handling. Frontend adds a new score-entry route with offline-queue integration, skip-hole persistence, and an explicit iOS keyboard focus-before-async pattern. The overall shape looks coherent and tests cover many key behaviors, but there are a couple of concrete backend efficiency issues and a few correctness/robustness gaps in the UI save flow and error-uniformity claims.

Overall risk: medium

## Findings

1. [medium] GET /:roundId loads ALL hole_scores for the round, then filters in memory (unnecessary load; easier to fix in SQL)
   - File: apps/tournament-api/src/routes/scores.ts:202-222
   - Confidence: high
   - Why it matters: The DB query in step (6) only filters by roundId+tenantId, so it retrieves every hole score for the entire round (potentially many foursomes), then filters in JS by memberPlayerIds. Even though the response is filtered, this increases query cost and response latency and expands the data handled in-process (DoS surface / perf regression as the number of players or holes grows).
   - Suggested fix: Add a SQL predicate restricting to the foursome’s player IDs (e.g., drizzle `inArray(holeScores.playerId, memberPlayerIds)`), and optionally constrain `holeScores.holeNumber <= round.holesToPlay` to avoid returning out-of-range rows. This also lets you drop the JS `.filter(...)` step.

2. [medium] ScoreEntryForm can enqueue a partially-complete hole if enqueueMutation fails mid-loop (no rollback / user feedback)
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:390-425
   - Confidence: medium
   - Why it matters: handleSave awaits enqueueMutation sequentially for each member (lines 401-420). If a later enqueue throws (IndexedDB quota, serialization error, etc.), earlier players’ entries may already be queued while later ones are not, leaving the hole half-entered. The UI also doesn’t surface an error or attempt to restore consistency.
   - Suggested fix: Consider making enqueue all-or-nothing: (a) generate all entries first, (b) enqueue in a batch API if available, or (c) wrap in try/catch and on failure either remove already-enqueued entries (if supported) or show a clear error state prompting retry. At minimum, catch and present a failure message and avoid calling drain on failure.

3. [low] “Byte-identical 404” uniformity is not actually asserted, and requestId makes true byte-identity impossible across requests
   - File: apps/tournament-api/src/routes/scores.read.test.ts:312-416
   - Confidence: high
   - Why it matters: The implementation always includes a per-request `requestId` in error bodies (apps/tournament-api/src/routes/scores.ts:71-97, 146-149). That means two 404 responses from different requests cannot be byte-identical JSON. The tests also don’t compare bodies between non-participant vs foreign-tenant cases; they only check code/error (scores.read.test.ts:312-319, 404-416). If the spec/AC truly requires byte-identity, current behavior cannot satisfy it.
   - Suggested fix: Clarify the requirement: if uniformity means same `{error, code}` (excluding requestId), update the story/test wording and add an assertion comparing the stable fields. If byte-identity is required, you’d need a deterministic requestId (generally undesirable) or to omit requestId from these 404s.

4. [low] Auto-advance timer is only cleared on valid changes/empty; invalid attempts won’t cancel an existing pending timer
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:328-356
   - Confidence: medium
   - Why it matters: When raw is '1'/'2', a timer is set (343-350). The timer is cleared on empty (331-334) and on valid input (340-342), but if the user subsequently produces an invalid raw value (e.g., tries to type '21' after '2', which fails SCORE_RE), the handler returns early (337-339) without clearing the prior timer. This can cause a delayed focus-advance even though the user is actively trying to correct/continue input.
   - Suggested fix: Call clearPendingAdvanceTimer(idx) before the SCORE_RE rejection (or clear on any change event), so any continued typing cancels the pending auto-advance, not just valid continuations.

5. [low] Comment/behavior mismatch: blur handler says it “advances” pending ‘1’/‘2’, but it actually cancels the timer and does not advance
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:370-383
   - Confidence: high
   - Why it matters: The code comment (372) states blur accepts and advances, but the implementation explicitly avoids advancing on blur (377-380). This is a maintenance correctness risk: future changes may rely on the comment and regress intended behavior, or reviewers may think a requirement is met when it is not.
   - Suggested fix: Update the comment to match the behavior (cancel pending auto-advance on blur), or adjust the behavior if advancing-on-blur is the intended requirement.

## Strengths

- Backend GET handler consistently applies tenant predicates on round, round_state, pairing_members/pairings, players, and scorer_assignments lookups (apps/tournament-api/src/routes/scores.ts:83-197).
- Backend negative-paths (400 invalid_round_id, 404 round_not_found uniform, 422 round_state_missing) are implemented and exercised by tests.
- Frontend’s iOS keyboard fix is implemented as an immediate `focus()` call before the first `await` in the click handler (apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:390-420), and there is a test asserting focus-before-enqueue ordering.
- Timers are cleaned up on unmount and when currentHole changes (apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:301-318), reducing leak risk.
- Skip-hole persistence and server-filled clearing includes a value-equality guard to avoid effect loops (apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:245-260).

## Warnings

None.
