# Codex Review

- Generated: 2026-05-01T16:11:50.844Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/round-state.ts, apps/tournament-api/src/services/round-state.test.ts, apps/tournament-api/src/services/index.ts, apps/tournament-api/src/routes/round-lifecycle.ts, apps/tournament-api/src/routes/round-lifecycle.integration.test.ts, apps/tournament-api/src/app.ts, apps/tournament-api/src/routes/scores.ts, apps/tournament-api/src/routes/scorer-assignments.ts, _bmad-output/implementation-artifacts/tournament/T5-7-scorer-handoff-endpoint.md, _bmad-output/implementation-artifacts/tournament/T5-8-round-lifecycle-state-machine.md

## Summary

The FSM extraction into `services/round-state.ts` is generally solid: the legal transition matrix is explicit, `transitionState` uses a conditional UPDATE with tenant scoping, preserves the `rounds.opened_at` side effect, and centralizes the state-change audit contract. The T5-7 scorer-handoff refactor meaningfully improves correctness by moving the state read into the tx and adding a state-gating EXISTS predicate on the UPDATE.

Main concern: the new round-lifecycle routes have authorization bypasses on idempotent paths (/complete when already complete_editable, /finalize when already finalized, /cancel when already cancelled). This violates the “organizer-only / organizer-or-scorer” contracts and enables unauthorized callers to receive 200s and learn state.

Secondary concern: `/finalize` returns a `finalizedAt` that can diverge from the persisted `round_states.entered_at`, and the idempotent path returns a different timestamp source than the initial transition path.

Test coverage is strong overall, but there are notable gaps around these idempotent/auth behaviors and the service’s “0 rows updated” race/idempotency branch.

Overall risk: high

## Findings

1. [high] Auth bypass on idempotent paths for /complete, /finalize, and /cancel
   - File: apps/tournament-api/src/routes/round-lifecycle.ts:98-446
   - Confidence: high
   - Why it matters: These endpoints are specified as organizer-only (/finalize, /cancel) or organizer-or-scorer (/complete). However, the handlers return 200 on certain idempotent states before performing the in-tx authorization re-check. Concretely:
- `/complete`: returns 200 idempotent when state is `complete_editable` before calling `isOrganizerOrAnyScorer` (lines 111–114 vs auth at 123–131).
- `/finalize`: returns 200 idempotent when state is `finalized` before verifying per-event organizer (lines 292–308 vs auth at 317–325).
- `/cancel`: returns 200 idempotent when state is `cancelled` before verifying per-event organizer (lines 434–436 vs auth at 438–445).

This violates the intended authorization model and leaks round existence/state to any authenticated user who can guess/obtain a roundId. It can also confuse clients (a non-organizer receiving 200 on /finalize looks like success).
   - Suggested fix: Always perform the appropriate authorization check before returning an idempotent success. Practical pattern:
1) Validate roundId.
2) In tx: resolve auth (organizer-only or organizer-or-scorer).
3) Then read state and return idempotent/transition accordingly.

If you want to avoid expensive missing-cell work on idempotent paths, you can still short-circuit *after* auth passes.

2. [medium] `/finalize` uses a `finalizedAt` timestamp that can diverge from persisted `round_states.entered_at` and from the idempotent response
   - File: apps/tournament-api/src/routes/round-lifecycle.ts:292-371
   - Confidence: high
   - Why it matters: On the transition path, the handler sets `finalizedAt = Date.now()` after calling `transitionState` (lines 351–358, 370). But `transitionState` independently sets `round_states.entered_at` to its own `Date.now()` (service file `round-state.ts` lines 338–345). On the idempotent path, `/finalize` returns `round_states.entered_at` (lines 294–307). These sources can differ by milliseconds, so:
- the first /finalize response `finalizedAt` may not equal the canonical DB timestamp,
- the second (idempotent) /finalize response can return a different `finalizedAt` than the first.

This undermines “idempotent semantics” and can make audit/reporting timelines inconsistent (state transition time vs dedicated finalize event time).
   - Suggested fix: Make `finalizedAt` derive from the canonical persisted value:
- Option A: change `transitionState` to return `{ from, to, enteredAt }`.
- Option B: after `transitionState`, SELECT `round_states.entered_at` within the same tx and use that value for (a) response, and (b) `ROUND_FINALIZED` audit payload.

Avoid multiple `Date.now()` calls for the same semantic timestamp.

3. [medium] Service and route tests miss key idempotency/race branches (0-row UPDATE path; cancel idempotent no-audit; unauthorized idempotent)
   - File: apps/tournament-api/src/services/round-state.test.ts:286-436
   - Confidence: high
   - Why it matters: `transitionState` has a critical correctness branch where the conditional UPDATE affects 0 rows (concurrent transition) and it re-reads to decide between idempotent success vs illegal transition (service `round-state.ts` lines 355–367). The provided service tests cover “already-target idempotent” (lines 359–370) but do not cover the 0-rows-updated path.

At the route level, there is strong coverage for happy paths and /finalize idempotency audit count (integration test lines 326–342), but there are no tests that:
- assert /cancel idempotent does not write new audit/activity,
- assert non-organizers cannot get 200 on an already-cancelled/finalized round (which would have caught the auth bypass above).
   - Suggested fix: Add targeted tests:
- Service: force the UPDATE to return 0 rows (e.g., by stubbing/mocking tx.update(...) or by using two connections and carefully ordering transactions) and assert the “idempotent due to concurrent same-target” behavior writes no audit.
- Routes: add cases where an unauthorized player calls /finalize on an already-finalized round and expects 403, and /cancel on already-cancelled expects 403; add /cancel idempotent audit/activity count assertions.

4. [medium] Score POST write is not state-gated at commit time; concurrent /finalize or /cancel can still allow a hole_score insert after the initial state read
   - File: apps/tournament-api/src/routes/scores.ts:315-419
   - Confidence: medium
   - Why it matters: The score POST handler checks writability by reading `round_states` (lines 315–348) and then performs the `hole_scores` insert (lines 350–419). There is no write-time predicate tying the insert to `round_states.state`, so under SQLite snapshot isolation a concurrent organizer /finalize or /cancel could commit after the score tx begins but before it commits, and the score insert can still commit even though the round is now finalized/cancelled.

This is especially relevant now that T5-8 introduces organizer-driven terminal transitions. It can violate the “finalized is immutable via normal write paths” intent, even if the ‘already finalized’ check returns 422 for new transactions.
   - Suggested fix: If you need stricter guarantees, consider one of:
- Use `BEGIN IMMEDIATE` for score POST transactions (same class of fix discussed in T5-8 docs).
- Add a DB-level enforcement (SQLite trigger) rejecting inserts into `hole_scores` when `round_states.state IN ('finalized','cancelled')`.
- Rework insert to be conditional (INSERT ... SELECT ... WHERE EXISTS(state is writable)) if feasible in drizzle for libsql.

At minimum, document this residual race similarly to the scorer-handoff snapshot disclaimer.

## Strengths

- `services/round-state.ts` cleanly centralizes the transition matrix, audit contract, and `rounds.opened_at` side effect, reducing duplicated state logic across routes.
- `transitionState` uses tenant-scoped conditional UPDATE narrowed on `state = current`, matching the intended race-safe pattern for state transitions themselves.
- T5-7 scorer-handoff improvements are concrete: in-tx state read via `getRoundState` and a state-gating EXISTS predicate on the UPDATE, plus a disambiguation re-read for the 0-row case.
- Integration tests include a realistic regression scenario (“finalize-before-handoff”) that exercises the new state-gated write predicate.

## Warnings

None.
