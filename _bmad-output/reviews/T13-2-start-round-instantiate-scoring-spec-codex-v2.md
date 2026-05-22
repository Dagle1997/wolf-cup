# Codex Review

- Generated: 2026-05-22T21:45:34.092Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T13-2-start-round-instantiate-scoring.md

## Summary

The spec addresses the previously called-out correctness risks on paper: race-safe idempotency is now anchored by a DB-enforced (partial) UNIQUE index + insert-then-recover (lines 39-43, 83-88); restart behavior is defined as “return existing 200” with a defensive 409 for impossible partial state (line 42); initial round_state is explicitly required to match the state machine rather than a hardcoded guess (lines 51-53); validation is substantially tightened and event_id is sourced from event_rounds, not the request (lines 44-50). 

Main remaining risk is deploy/migration safety around introducing a UNIQUE index into an existing environment, plus a subtle transactional-recovery gotcha with “catch UNIQUE then SELECT” if the code attempts to recover inside an aborted transaction handle. No new obvious High is introduced by the approaches themselves, but the migration could become a new High if existing data violates the new uniqueness assumption.

Overall risk: medium

## Findings

1. [high] New partial UNIQUE index migration can fail on existing duplicate data (deploy-blocking)
   - File: _bmad-output/implementation-artifacts/tournament/T13-2-start-round-instantiate-scoring.md:39-43
   - Confidence: medium
   - Why it matters: Adding a UNIQUE index on rounds.event_round_id (even partial WHERE NOT NULL) will fail if any existing rows already share the same non-NULL event_round_id. A failed migration blocks deployment and can leave environments wedged until manual cleanup. The spec asserts “no rounds existed in prod” historically, but that doesn’t guarantee staging/dev/test/seeded DBs (or future prod hotfixes) don’t already contain duplicates.
   - Suggested fix: In the migration, either (a) preflight-detect duplicates with a query and fail with a very explicit error message and remediation steps, or (b) dedupe deterministically (choose winner row, delete/merge losers) if that’s acceptable. Also ensure the migration is written in a way compatible with your migration runner (e.g., Postgres CREATE INDEX CONCURRENTLY cannot run inside a transaction).

2. [medium] Insert-then-recover on UNIQUE violation must not attempt recovery within an aborted transaction
   - File: _bmad-output/implementation-artifacts/tournament/T13-2-start-round-instantiate-scoring.md:39-43
   - Confidence: high
   - Why it matters: In many DB libraries/transaction helpers, once an INSERT triggers a unique-violation error, the current transaction is marked failed/aborted and cannot run further queries until rolled back. If the handler catches the unique error and then tries to SELECT the winner’s round using the same transaction context/connection, it may throw a secondary error or incorrectly surface a 500—undermining the race-safe idempotency goal.
   - Suggested fix: Structure recovery so the SELECT happens outside the failed transaction scope (e.g., catch error → rollback/exit tx → re-SELECT in a new transaction or non-tx query). Also match specifically on Postgres error code 23505 and (ideally) constraint/index name so other uniqueness errors aren’t misclassified.

3. [medium] “Defer to round-state.ts legal entry state” needs a concrete contract to avoid drift/regressions
   - File: _bmad-output/implementation-artifacts/tournament/T13-2-start-round-instantiate-scoring.md:51-53
   - Confidence: medium
   - Why it matters: The spec correctly avoids hardcoding a possibly-illegal initial state, but as written it relies on a developer manually “confirming” what the state machine allows. If round-state.ts changes later (or has context-dependent entry rules), this endpoint can silently become invalid or start creating a state that breaks downstream assumptions (e.g., score entry allowed states).
   - Suggested fix: Have round-state.ts export an explicit constant/function for the creation entry state (e.g., getInitialRoundState()), and add a test that asserts start-round creates that state and that score entry is permitted immediately after creation (AC-2). This turns the ‘confirm’ step into an enforceable contract.

4. [low] Defensive 409 round_state_corrupt is good, but leaves no remediation path
   - File: _bmad-output/implementation-artifacts/tournament/T13-2-start-round-instantiate-scoring.md:42
   - Confidence: medium
   - Why it matters: If partial/corrupt state ever occurs (manual DB edit, prior bug, failed migration), returning 409 without a repair mechanism can leave organizers unable to start the round without operator intervention.
   - Suggested fix: At minimum, log with enough identifiers (tenant/eventRoundId/roundId) and document an operator runbook. Optionally consider an admin-only repair endpoint/script to rehydrate missing round_states/scorer_assignments if that’s acceptable.

## Strengths

- Idempotency is now correctly anchored in a DB constraint (partial UNIQUE WHERE NOT NULL) rather than purely application logic (lines 39-43, 83-88).
- Event identity is sourced from event_rounds.event_id rather than trusting request input, aligning with chk_rounds_event_pairing and preventing event mismatch (lines 46, 65).
- Atomic transaction semantics and explicit restart behavior are specified, including a defensive corrupt-state response instead of a silent partial recreate (lines 40-43).
- Validation ACs cover the main failure modes (pairings locked, full coverage, unknown/duplicate foursomes, scorer membership constraints, strict body) with explicit status codes and required tests (lines 44-50, 73-82).

## Warnings

None.
