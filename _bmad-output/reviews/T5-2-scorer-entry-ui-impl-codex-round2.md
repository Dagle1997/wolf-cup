# Codex Review

- Generated: 2026-04-28T17:43:54.080Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/scores.ts, apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx

## Summary

Round-1 fixes are partially resolved. The API-side SQL filtering is genuinely pushed into the WHERE clause. The UI-side timer cancellation on invalid keystrokes looks correctly fixed. However, the new Promise.allSettled save flow has two concrete correctness gaps: (1) it doesn’t actually guarantee all enqueues are attempted if a synchronous throw occurs while building the promises, and (2) the stated “dedupe via clientEventId on retry” is not true because new clientEventIds are generated on each retry, which can create duplicate queued writes and/or 409 conflicts later.

Overall risk: high

## Findings

1. [high] Promise.allSettled does not protect against synchronous throws during enqueue construction (can still partially enqueue and abort early)
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:409-433
   - Confidence: high
   - Why it matters: The comment claims building all enqueues up front + Promise.allSettled avoids partial state if enqueueMutation throws. But if anything inside `members.map(...)` throws synchronously (notably `crypto.randomUUID()` at line 418, or any synchronous validation in `enqueueMutation`), the exception will escape the map before `enqueues` is fully built and before `Promise.allSettled` runs. Result: some earlier members may already have been enqueued, later members not enqueued at all, and the function exits via exception (no `saveError` shown, user may click again and create duplicates). This reintroduces the partial-failure scenario you were trying to harden.
   - Suggested fix: Wrap each enqueue creation in a try/catch and convert sync throws into rejected promises so `allSettled` can observe them, e.g. `const enqueues = members.map(m => { try { ...; return Promise.resolve(enqueueMutation(...)); } catch (e) { return Promise.reject(e); } });` Also consider guarding `crypto.randomUUID` availability up front and failing cleanly before any enqueues.

2. [high] Retry dedupe claim is incorrect: new clientEventId is generated each Save attempt, so retries can enqueue duplicates and later conflict
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:413-441
   - Confidence: high
   - Why it matters: On a partial failure, you tell the user to tap Save again and assert “successful entries dedupe on retry via clientEventId” (lines 438-440). But line 418 generates a fresh `clientEventId = crypto.randomUUID()` on every Save click. That means a retry will enqueue *new* mutations for members that already successfully enqueued on the first attempt. Those duplicate queue items will not dedupe server-side (dedupe requires same clientEventId), and are likely to hit the cell-level UNIQUE constraint and return 409 `hole_already_scored` later. This undermines the intended retry semantics and can leave the UI in a confusing state (some queued items permanently failing).
   - Suggested fix: Persist per-(roundId,currentHole,memberId) clientEventIds across retries until the hole successfully advances (e.g., store in state/ref keyed by playerId + holeNumber). On retry, reuse the same clientEventId for already-attempted members, or skip enqueuing members that already enqueued successfully (track per-member enqueue success).

3. [medium] UI assumes exactly 4 members (banner text), but save logic uses `members.length`; inconsistency if data is not exactly foursome-sized
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:390-515
   - Confidence: medium
   - Why it matters: The validation banner says “All 4 scores required to advance” (line 510), but validity and enqueue counts are based on `members.length` (lines 390-392, 413-437). If the API ever returns a different number of members (data error, future format, etc.), the UI message becomes wrong and could mislead during troubleshooting. This also hints there is no defensive assertion that the API delivered exactly four members for a foursome.
   - Suggested fix: Either enforce/validate `members.length === 4` (and render a setup error if not), or change the banner text to use `members.length` dynamically.

4. [low] Backend GET returns `holesToPlay` without validating it matches the frontend’s assumed union (9|18)
   - File: apps/tournament-api/src/routes/scores.ts:83-90
   - Confidence: medium
   - Why it matters: Frontend types `holesToPlay: 9 | 18` (web file line 60), but backend returns `rounds.holesToPlay` as-is (API file lines 84-89, 225-240). If the DB ever contains an unexpected value (migration bug, manual edit), the UI logic that iterates 1..holesToPlay and renders strings may still work, but type assumptions/tests may become misleading and edge cases (e.g., max hole validation elsewhere) could diverge.
   - Suggested fix: Optionally validate/normalize holesToPlay in the API response (e.g., assert 9 or 18 and 422 if not) or loosen the frontend type to `number` if other values are acceptable.

## Strengths

- API-side resolution of the “load all hole_scores then filter in memory” issue is real: `inArray(holeScores.playerId, memberPlayerIds)` is pushed into the SQL WHERE (apps/tournament-api/src/routes/scores.ts:202-223).
- The invalid-keystroke path now clears the pending auto-advance timer before returning (web:340-343), addressing the stale-timer behavior from round 1.
- The iOS keyboard synchronous-focus requirement is still satisfied: `focus()` is executed before the first `await` in handleSave (web:402-408 vs await at 432).

## Warnings

None.
