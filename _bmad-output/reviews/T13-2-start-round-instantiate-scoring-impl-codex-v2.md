# Codex Review

- Generated: 2026-05-22T22:22:44.572Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/admin-event-rounds.ts, apps/tournament-api/src/services/round-state.ts, apps/tournament-api/src/routes/onboarding-lifecycle.e2e.test.ts

## Summary

Re-review confirms the prior Med/Low findings called out in the request are addressed: the initial round state is now sourced from exported INITIAL_ROUND_STATE; new e2e validations cover invalid_body (400) and pairings_not_ready when no pairings exist (422); and the idempotency recovery round_states existence check is now tenant-scoped. No new HIGH-severity issues are evident from the provided diff. One new medium-risk correctness/semantic inconsistency was introduced around rounds.openedAt semantics vs the round-state FSM’s documented behavior, plus a couple low-risk robustness items.

Overall risk: medium

## Findings

1. [medium] Potential semantic inconsistency: start-round sets rounds.openedAt immediately, but FSM transitionState documents openedAt as set on not_started→in_progress (first score)
   - File: apps/tournament-api/src/routes/admin-event-rounds.ts:598-633
   - Confidence: high
   - Why it matters: start-round creates a rounds row with openedAt/openedByPlayerId set (lines 603-613). Separately, round-state.ts documents that transitionState has a side-effect: not_started→in_progress updates rounds.opened_at/opened_by_player_id only if opened_at IS NULL (round-state.ts lines ~407-420). With the new behavior, openedAt will never be NULL, so the first-score transition cannot record the true first-score opener/time even if that is the intended meaning. This can cause confusing/incorrect timestamps/actors downstream if other logic assumes openedAt reflects when scoring actually began.
   - Suggested fix: Decide and codify the meaning of openedAt: (A) if openedAt should mean “round instantiated/started”, update the FSM comment/logic to match (and consider removing the openedAt update on not_started→in_progress); (B) if openedAt should mean “scoring began/first score”, write openedAt as NULL in start-round and let transitionState populate it on first score.

2. [low] Auth middleware applied twice for /event-rounds/* routes (redundant requireSession/requireOrganizer)
   - File: apps/tournament-api/src/routes/admin-event-rounds.ts:90-673
   - Confidence: high
   - Why it matters: The router already applies requireSession/requireOrganizer to all /event-rounds/* via .use() (lines 90-91). The new start route also lists requireSession and requireOrganizer again (lines 498-502). If these middlewares ever gain non-idempotent behavior (or body consumption, DB mutations, metrics side effects), running them twice could produce subtle issues; at minimum it’s extra work per request.
   - Suggested fix: Remove the per-route requireSession/requireOrganizer for /event-rounds/:eventRoundId/start (keep the .use() guards), or remove the .use() guards and consistently apply per-route—but don’t do both.

3. [low] Idempotency recovery validates round_states existence but not scorer_assignments; could return 200 for a non-scorable round if data is partially corrupt
   - File: apps/tournament-api/src/routes/admin-event-rounds.ts:638-660
   - Confidence: medium
   - Why it matters: In the UNIQUE-recover branch, the handler checks that a round_states row exists (lines 646-658) but does not verify scorer_assignments exist for the recovered round. While the transaction should normally guarantee all rows exist, if the DB ever contains partial/corrupt data (manual intervention, prior bug, failed migration), this endpoint could report alreadyStarted success while scoring still fails due to missing scorer assignments.
   - Suggested fix: In the recovery branch, also verify scorer_assignments exist (and ideally match expected foursome count) before returning 200; otherwise return a 409 similar to round_state_corrupt.

## Strengths

- Prior Med#2 resolved cleanly: INITIAL_ROUND_STATE is exported from the FSM module and consumed by the creator (admin-event-rounds.ts lines 67, 614-621; round-state.ts lines 85-94).
- Prior Med#1 resolved: new e2e coverage includes strict invalid_body (400) and pairings_not_ready when no pairings exist (422) (onboarding-lifecycle.e2e.test.ts lines ~460-484).
- Prior Low#4 resolved: recovery branch round_states existence check is tenant-scoped (admin-event-rounds.ts lines 649-654).
- The new start-round path is transactionally constructed (rounds + round_states + scorer_assignments) and has meaningful validation coverage including idempotency behavior via UNIQUE recovery.

## Warnings

None.
