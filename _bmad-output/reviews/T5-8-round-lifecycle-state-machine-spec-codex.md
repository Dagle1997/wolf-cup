# Codex Review

- Generated: 2026-05-01T13:46:33.904Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-8-round-lifecycle-state-machine.md

## Summary

Spec is detailed and mostly internally consistent on file footprint, state transition matrix, tenant scoping intent, and test coverage. The biggest correctness gap is the claim that moving the round-state read inside a SQLite transaction “closes” the state-gate race for scorer handoff (and, by extension, other write paths). With SQLite snapshot semantics, a transaction that begins before a concurrent /finalize can still commit updates based on a stale state unless the write statement itself is state-gated or the transaction acquires a write lock up front. There are also a couple of concrete spec inconsistencies (BusinessRuleError constructor usage) and some ambiguous contracts (how to enumerate missingCells vs computeExpectedCells returning only a number; idempotent finalize vs dual-audit behavior).

Overall risk: high

## Findings

1. [critical] Race-window closure claim is incorrect: in-tx state read alone does not prevent writes after a concurrent finalize/cancel under SQLite snapshot semantics
   - File: _bmad-output/implementation-artifacts/tournament/T5-8-round-lifecycle-state-machine.md:93-98
   - Confidence: high
   - Why it matters: The spec asserts that moving `getRoundState` into the same transaction as the scorer_assignments UPDATE “narrows the race window to nothing” because both statements see a consistent snapshot. In SQLite, that consistency is exactly the problem: if the scorer-handoff transaction begins before a concurrent `/finalize` commits, it will keep seeing the pre-finalize state and can still successfully UPDATE `scorer_assignments` (a different table) and COMMIT after finalize. There is no automatic conflict because the finalized round_state row and scorer_assignments rows don’t overlap, so the handoff can incorrectly succeed on a now-finalized round—the exact bug T5-7f is trying to close. The same reasoning can apply to any other ‘check state then write other table’ flow.
   - Suggested fix: To truly close the race you need one of these patterns:
- **State-gated write**: make the scorer_assignments UPDATE conditional on the current round state (e.g., `UPDATE ... WHERE ... AND EXISTS (SELECT 1 FROM round_states WHERE round_id=? AND tenant_id=? AND state NOT IN ('finalized','cancelled'))`). This re-checks at write time.
- **Acquire a write lock early**: start the tx in a mode that blocks concurrent writers (e.g., `BEGIN IMMEDIATE`) or perform a no-op UPDATE on `round_states` early to force write-lock acquisition, then re-check state before updating scorer_assignments.
Update Section 7/AC-10 accordingly and add an integration test that reproduces the concurrent finalize/handoff ordering that currently would still pass under snapshot isolation.

2. [high] BusinessRuleError API is internally inconsistent (constructor signature vs documented throw sites)
   - File: _bmad-output/implementation-artifacts/tournament/T5-8-round-lifecycle-state-machine.md:132-176
   - Confidence: high
   - Why it matters: AC-1 defines `BusinessRuleError` as `constructor(code: string, message: string, status?: number)` (lines 132-136). But AC-2 describes throwing `BusinessRuleError({ code, status, message })` as if it takes an object (line 176). Task 1 also uses `BusinessRuleError('round_state_missing', 422)` without a message (lines 290-293). These inconsistencies will lead to implementation drift and brittle error mapping in routes (Task 4 line 320).
   - Suggested fix: Pick one canonical API and update all references:
- Either `new BusinessRuleError(code, message, status)` everywhere, or
- `new BusinessRuleError({ code, message, status })` and change the class definition accordingly.
Also specify required `message` content for each code so route-level tests can assert stable response shapes.

3. [medium] transitionState has no tenantId parameter but spec requires tenant scoping on all queries/updates
   - File: _bmad-output/implementation-artifacts/tournament/T5-8-round-lifecycle-state-machine.md:111-176
   - Confidence: high
   - Why it matters: Section 9 states every query in `services/round-state.ts` includes `tenant_id = TENANT_ID` (lines 111-114), but `transitionState`’s signature in AC-1 has no `tenantId` parameter (lines 143-149) while other functions do (lines 151-168). This forces `transitionState` to either hardcode TENANT_ID internally or rely on ambient global state, which is easy to misuse in tests or future multi-tenant work and makes the “every query is tenant-scoped” rule harder to enforce consistently.
   - Suggested fix: Either:
- Add `tenantId: string` to `transitionState` (preferred for consistency with `getRoundState/isEventOrganizer/computeExpectedCells`), or
- Explicitly document that `transitionState` uses an internal TENANT_ID constant and is not safe for other tenants, and ensure tests cover tenant isolation for transitions too.

4. [medium] Missing-cells response requires enumerating missing (playerId, holeNumber) pairs, but the spec’s promoted helper only returns a count
   - File: _bmad-output/implementation-artifacts/tournament/T5-8-round-lifecycle-state-machine.md:164-197
   - Confidence: high
   - Why it matters: AC-4(iv) requires returning `missingCells: [{ playerId, holeNumber }, ...]` (lines 193-194). However AC-1/Task 1 only promotes `computeExpectedCells(...) -> Promise<number>` (lines 164-168, 301), and AC-4 describes `missing = expected - actual hole_scores count` (line 193), which yields only a number—not the required enumeration. Without a clear algorithm/query, implementations may diverge or become very inefficient, and tests (AC-12b) won’t be well-defined beyond `length === 1` for trivial cases.
   - Suggested fix: Specify a concrete way to enumerate missing cells:
- Define an `expectedCells` generator (players in round × holesToPlay) and a query to fetch existing `hole_scores` keys, then compute the set difference.
- Or add a new helper like `computeMissingCells(tx, roundId, holesToPlay, tenantId) -> { missingCells: Array<{playerId, holeNumber}>; expectedCount; actualCount }`.
Also clarify ordering/stability (e.g., sort by playerId then holeNumber) so tests can assert deterministically.

5. [medium] Finalize idempotency vs dual-audit requirement is underspecified (risk of duplicate audit/activity rows on repeat POST)
   - File: _bmad-output/implementation-artifacts/tournament/T5-8-round-lifecycle-state-machine.md:209-283
   - Confidence: high
   - Why it matters: AC-6 says `/finalize` is idempotent when already finalized (line 213), while also requiring two audit rows on finalize (lines 217-218) and an activity emission (line 218). It’s unclear whether an idempotent call should emit zero new audit/activity rows (typical idempotency) or emit them again (can cause double-counting in reporting). AC-12(h) asserts ‘2 audit rows written’ but doesn’t specify whether that’s per first finalize only or per request.
   - Suggested fix: Make the contract explicit:
- On first transition to finalized: write `round.state_changed` + `round.finalized` + activity.
- On idempotent repeat (already finalized): return 200 with existing timestamps **and do not write** additional audit/activity rows.
Add a route-level test for double-finalize that asserts audit row count does not increase on the second call.

6. [low] TransitionStateOpts.suppressAudit is justified by a rollback-specific audit type, but no such audit event is specified
   - File: _bmad-output/implementation-artifacts/tournament/T5-8-round-lifecycle-state-machine.md:138-208
   - Confidence: high
   - Why it matters: AC-1 documents `suppressAudit` as “used by /complete-rollback when caller has a more specific audit type to write” (lines 138-141), but AC-5 defines only activity emission for rollback and still calls `transitionState(...)` (lines 205-207) with no additional audit type. This introduces extra API surface area without a defined behavior, increasing the chance of inconsistent auditing (AC-13) or unused code paths.
   - Suggested fix: Either:
- Remove `suppressAudit` from v1 if not needed, or
- Define and require a dedicated rollback audit event type (and add it to audit-log constants if allowed) and update AC-5/AC-13/tests accordingly.
If keeping `suppressAudit`, specify exactly when it must be set and what audit row replaces the suppressed one.

## Strengths

- Path footprint is explicitly enumerated and stays within the stated allowlist (`apps/tournament-api/**` plus `_bmad-output/**`), with a clear rule for adding files (lines 19-33, 378-390).
- Forward-reference handling for T6 recompute is explicitly stubbed with a follow-up (lines 99-109, 371-373), avoiding a hard dependency on non-existent services.
- Transition matrix is clearly listed and includes the requested `complete_editable → in_progress` rollback path (lines 61-79).
- Test plan is concrete and extensive (service-level 7 cases + route-level 15 cases), and it explicitly requires existing T5-6/T5-7 tests to remain unchanged to catch regressions (lines 237-246, 247-278).
- Auth scoping is well-defined (organizer-only vs organizer-or-scorer) and explicitly states TOCTOU checks happen inside the transaction (lines 51-60, 186-230).

## Warnings

None.
