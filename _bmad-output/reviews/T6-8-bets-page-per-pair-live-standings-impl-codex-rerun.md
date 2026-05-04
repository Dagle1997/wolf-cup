# Codex Review

- Generated: 2026-05-04T21:00:49.080Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/bets.ts, apps/tournament-api/src/routes/bets.integration.test.ts

## Summary

Round-2 fixes address the previously called-out drift, silent skips, deterministic press ordering, and sign-flip testing. Remaining risks are mostly around read-path auto-press visibility/consistency, nondeterministic ordering of rounds in responses, and structural-data validation (holes list) causing bet omission/500s. The `void engineOut.triggeredPresses` is defensible only if you can guarantee the engine will not materially affect net calculations via newly-triggered presses on read paths—or you explicitly detect/log when it happens.

Overall risk: medium

## Findings

1. [high] Potential inconsistency: totals may include auto-press effects while `presses` response omits them (engineOut.triggeredPresses ignored)
   - File: apps/tournament-api/src/routes/bets.ts:585-664
   - Confidence: medium
   - Why it matters: You explicitly note the engine "may compute newly-firing presses on read paths" but then discard `engineOut.triggeredPresses` and build the response `presses` solely from persisted `individualBetPresses` rows (lines 638-664, with `void engineOut.triggeredPresses` at 650). If `computeIndividualBet` uses auto-press rules to affect `engineOut.netToPlayerACents`/`perRound.*.netToPlayerACents` even when those presses are not present in DB, the API can return money totals that reflect presses the client never sees in `presses`. That’s a correctness/UX breach and makes debugging persistence gaps much harder. It also directly relates to your question about a v1.5 “pending auto-presses” case: this implementation guarantees the read model can’t show them unless already persisted.
   - Suggested fix: Make the behavior explicit and self-checking:
- Option A (preferred if orchestrator is source of truth): assert `engineOut.triggeredPresses.length === 0` on read paths; if non-zero, log error with structured context (betId, eventRoundId, hole, viewer) and consider failing closed (500) or returning a `pressesPending` array.
- Option B: include `engineOut.triggeredPresses` in the response as separate entries (e.g., `pendingPresses`) without DB ids, so totals and UI can reconcile.
- Option C: change engine call/config so it does not compute new presses on read paths unless they’re already persisted (i.e., treat DB as authoritative for presses).

2. [medium] Response ordering for applicableRoundIds/perRoundStanding is nondeterministic (no ORDER BY when loading bet rounds)
   - File: apps/tournament-api/src/routes/bets.ts:400-537
   - Confidence: high
   - Why it matters: `applicableRoundRows` is loaded without an `ORDER BY` (lines 400-408). You then iterate in that natural DB order to build `applicableRoundsForEngine` and `applicableRoundIds` (lines 424-536). If DB row order changes (or differs between SQLite/libsql implementations), `applicableRoundIds` and `engineOut.perRound` order can vary between calls, creating unstable API output and potentially flaky clients/tests. You fixed press ordering explicitly; rounds likely deserve the same determinism.
   - Suggested fix: Add deterministic ordering at the source:
- Load `individualBetRounds` joined to `eventRounds` and order by `eventRounds.roundNumber` (and maybe `eventRounds.roundDate` as tie-break).
- Alternatively, sort `applicableRoundRows` after loading (but joining+ordering in SQL is better and reduces N+1 queries).

3. [medium] Course holes structural validation missing: empty/incomplete hole list still sent to engine
   - File: apps/tournament-api/src/routes/bets.ts:482-513
   - Confidence: high
   - Why it matters: You treat missing structural data as a reason to `continue` (missing eventRound/runtime/tee/courseRevision). But you don’t validate `holeR` at all (lines 482-495) before using it to build engine input (lines 497-512). If `course_holes` rows are missing or incomplete, the engine may throw, which in list mode silently drops the bet (warn only logs betId) and in detail mode returns 500 (`bet_compute_failed`). This is an avoidable source of user-visible “missing bets” or intermittent 500s when course setup is imperfect.
   - Suggested fix: Treat holes as structural requirements too:
- If `holeR.length === 0` (or `< holesToPlay` if that’s required), `continue` the round (so it doesn’t enter `applicableRoundIds`) and log a structured reason.
- Optionally validate hole numbers are 1..holesToPlay and unique.
- Consider adding a test that simulates missing courseHoles and asserts the bet is skipped (mine) / 500 (detail) with logs, depending on intended behavior.

4. [medium] GET /bets/mine compute path is highly N+1 and may become a latency/DoS vector for large events
   - File: apps/tournament-api/src/routes/bets.ts:400-721
   - Confidence: high
   - Why it matters: For each bet, you load bet_rounds, then per round you issue multiple queries (eventRound, runtime round, tee, course revision, holes, scores). Then you separately load presses and players. In `GET /bets/mine`, you first load *all* bets for the event and then filter in memory (lines 682-701), potentially amplifying work. On large events (many bets × many rounds), this can degrade performance sharply and may cause timeouts.
   - Suggested fix: Batch queries:
- In `/bets/mine`, query only bets where viewer is party in SQL (e.g., `where eventId AND (playerAId=viewer OR playerBId=viewer)`).
- In `computeBetStandingForViewer`, prefetch all needed `eventRounds`, `rounds`, `courseTees`, `courseRevisions`, `courseHoles`, `holeScores`, and `individualBetPresses` for the bet’s applicable rounds with `IN (...)` queries and build maps in memory.
- Consider caching course holes/tee by (courseRevisionId, teeColor) within the request loop.

## Strengths

- Fix for applicableRoundIds drift is now structurally enforced by only pushing IDs for rounds that fully compose engine input (bets.ts lines 411-537).
- Press ordering is now deterministic via `.orderBy(firedAtRoundId, firedAtHole)` (bets.ts lines 542-557).
- New integration tests cover holesPlayed/holesRemaining semantics and explicitly assert sign anti-symmetry across viewers for both total and per-round net (bets.integration.test.ts lines 582-670).
- GET /bets/:betId implements UUID-format validation without leaking existence and maintains uniform 403 behavior for not-found/wrong-event/not-party (bets.ts lines 754-803).

## Warnings

None.
