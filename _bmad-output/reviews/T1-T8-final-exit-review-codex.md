# Codex Review

- Generated: 2026-05-07T13:48:39.243Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/scores.ts, apps/tournament-api/src/services/press-orchestrator.ts, apps/tournament-api/src/routes/presses.ts, apps/tournament-api/src/services/money.ts, apps/tournament-api/src/routes/round-lifecycle.ts, apps/tournament-api/src/routes/score-corrections.ts, apps/tournament-api/src/services/awards.ts, apps/tournament-api/src/lib/activity.ts, apps/tournament-api/src/services/activity-feed.ts, apps/tournament-api/src/middleware/require-event-participant.ts, apps/tournament-api/src/middleware/require-scorer-for-round.ts, apps/tournament-api/src/routes/scorer-assignments.ts

## Summary

Found multiple concrete, cross-cutting production risks concentrated in the press pipeline and the score-commit auth boundary. The most serious issue is that team_press_log appears round-scoped (no foursome/pairing discriminator), but press evaluation is foursome-specific—this can cause cross-foursome press contamination, wrong money/press activity, and UNIQUE collisions. Also found a real TOCTOU gap where scorer authorization is checked only in middleware (outside the score commit transaction), so scorer handoff can race score writes.

Overall risk: high

## Findings

1. [critical] team_press_log is not scoped to a foursome/pairing, but press evaluation is; presses can bleed across foursomes and/or collide
   - File: apps/tournament-api/src/services/press-orchestrator.ts:453-463
   - Confidence: high
   - Why it matters: The orchestrator computes perHoleResults for ONE foursome (derived from scoredPlayerId), but it loads existingPressLog with only (roundId, tenantId) filtering. If a round contains multiple foursomes (which the rest of the codebase implies via pairings.foursomeNumber), presses from other foursomes will be included and influence evaluatePresses incorrectly. Separately, teamPressLog inserts (roundId, team, startHole, triggerType, ...) with no foursome key, so presses from different foursomes that happen to share team/startHole/triggerType can UNIQUE-collide, causing missing press rows and inconsistent activity/money behavior.
   - Suggested fix: Add a pairing/foursome discriminator to team_press_log (e.g., pairingId or foursomeNumber) and include it in: (a) the UNIQUE constraint(s), (b) all reads (existingPressLog), (c) all writes (both orchestrator and manual press routes), and (d) activity payloads if needed. If the intended invariant is actually “one foursome per round”, enforce it at the schema level and remove all multi-foursome code paths—right now the code mixes both models.

2. [critical] Manual press routes also write round-scoped presses; same cross-foursome bleed/collision risk as auto-press
   - File: apps/tournament-api/src/routes/presses.ts:260-301
   - Confidence: high
   - Why it matters: POST /:roundId/presses inserts into teamPressLog with only roundId + team + startHole + triggerType (no foursome/pairing key). In a multi-foursome round, a manual press from foursome A becomes visible to press orchestration for foursome B (because orchestrator reads all teamPressLog rows for the round). Also, different foursomes can collide on the UNIQUE constraint described in comments (round_id, team, fired_at_hole/startHole, trigger_type), blocking legitimate presses.
   - Suggested fix: Same fix as above: scope team_press_log by foursome/pairing and require/derive the correct scope for manual presses (likely from the scorer’s assigned foursome, but persisted explicitly).

3. [high] Score commit authorization is TOCTOU-racy vs scorer transfer: scorer check is outside the transaction and not revalidated
   - File: apps/tournament-api/src/routes/scores.ts:262-307
   - Confidence: high
   - Why it matters: The route relies on requireScorerForRound middleware for single-writer enforcement, but the actual hole_scores insert happens later inside a transaction without re-checking the scorer assignment. If scorer-assignments transfer occurs between middleware execution and the transaction’s insert, the old scorer can still write scores after handoff (violating the single-writer guarantee). This is a real production race when a handoff happens during live scoring.
   - Suggested fix: Re-check scorer assignment inside the db.transaction immediately before inserting into hole_scores (same roundId/body.playerId/holeNumber scope). Treat mismatch as 403. Optionally include the expected scorerPlayerId in the insert via a conditional predicate (or move the scorer gate fully into the transaction, leaving middleware only for parse/shape validation).

4. [high] Manual press/undo foursome selection is nondeterministic if a caller is scorer for multiple foursomes
   - File: apps/tournament-api/src/routes/presses.ts:107-125
   - Confidence: high
   - Why it matters: computeMaxCompleteHole() selects scorerAssignments for (roundId, scorerPlayerId) with .limit(1) and no ordering. If a player is assigned as scorer for more than one foursome in a round (possible via organizer override or misconfiguration), the chosen foursome is arbitrary. That means fromHole can be computed from the wrong foursome, and the press row can be filed/undone against the wrong group of players (and—given current round-scoped press logging—can affect other foursomes too).
   - Suggested fix: Either enforce a schema invariant that a scorer can only be assigned to one foursome per round OR require the client to specify foursomeNumber on manual press/undo and validate it. At minimum, add deterministic ordering + explicit check for multiple assignments and fail 422 with a clear code like multiple_scorer_assignments.

5. [medium] Undo press eligibility query can misbehave or throw if expectedMembers is empty/non-4
   - File: apps/tournament-api/src/routes/presses.ts:405-436
   - Confidence: medium
   - Why it matters: DELETE /presses builds expectedMembers from pairingMembers, but does not guard expectedMembers.length === 4 (unlike computeMaxCompleteHole). If expectedMembers is empty (data integrity gap) this will call inArray(..., []) which can generate invalid SQL or a runtime error depending on Drizzle/libsql behavior. That would surface as 500 on an undo request.
   - Suggested fix: Add a 4-player guard rail consistent with the orchestrator: if expectedMembers.length !== 4, return 422 with a setup/integrity error code and do not attempt the inArray query.

6. [medium] Rule-set multiplier selection in presses.ts is nondeterministic (no ordering) and may pick the wrong revision
   - File: apps/tournament-api/src/routes/presses.ts:173-200
   - Confidence: high
   - Why it matters: fetchPressMultiplier() selects ruleSets and ruleSetRevisions with .limit(1) but no orderBy. If multiple rule_sets or multiple revisions exist, this can return an arbitrary multiplier (and diverge from press-orchestrator.ts which explicitly orders by createdAt/id and revisionNumber). That leads to incorrect multiplier persistence for manual presses, and contract drift between auto vs manual press behaviors.
   - Suggested fix: Mirror press-orchestrator’s deterministic ordering: order rule_sets by created_at desc, id desc; order revisions by revision_number desc. Consider extracting a shared “fetchActiveRuleSetConfig” helper used by both paths.

7. [medium] team_press_log contextId is inconsistent between auto-press and manual press writes
   - File: apps/tournament-api/src/services/press-orchestrator.ts:494-513
   - Confidence: medium
   - Why it matters: Auto-press writes team_press_log.contextId as `event:${eventId}` or `round:${roundId}`, while manual presses write contextId from rounds.contextId (apps/tournament-api/src/routes/presses.ts:278-290). If any downstream code expects contextId to be consistent for filtering, analytics, or multi-tenant partitioning, this will create hard-to-debug “missing rows” depending on which path created the press.
   - Suggested fix: Use the same contextId source in both paths (preferably rounds.contextId, since it already exists and is used by other writes like hole_scores). Fetch it in orchestrator the same way manual press does, then persist it consistently.

## Strengths

- Score commit is largely transactionally composed: hole_scores insert, audit log, activity emit, press orchestration, awards evaluation, and state transitions all happen under one db.transaction, which makes replay/idempotency reasoning much cleaner.
- Clear and defensive UNIQUE handling in score commit (apps/tournament-api/src/routes/scores.ts:358-427) that distinguishes idempotent clientEventId replays vs true cell conflicts.
- Activity feed decoding is robust to corrupt/unknown activity rows and advances cursors based on physical rows to avoid re-fetch loops (apps/tournament-api/src/services/activity-feed.ts:128-212).
- Round lifecycle endpoints consistently put authorization checks before state/existence reads inside transactions to reduce existence leaks and TOCTOU exposure (apps/tournament-api/src/routes/round-lifecycle.ts:99-117, 295-312).

## Warnings

- Truncated file content for review: apps/tournament-api/src/routes/scores.ts
