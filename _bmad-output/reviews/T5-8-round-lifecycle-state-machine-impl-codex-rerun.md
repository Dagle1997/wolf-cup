# Codex Review

- Generated: 2026-05-01T16:18:24.002Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/round-lifecycle.ts, apps/tournament-api/src/routes/round-lifecycle.integration.test.ts, apps/tournament-api/src/routes/scores.ts, apps/tournament-api/src/routes/scorer-assignments.ts, _bmad-output/implementation-artifacts/tournament/T5-8-round-lifecycle-state-machine.md

## Summary

Re-review confirms the prior High fix is effectively in place for the four lifecycle handlers: the idempotent 200 branches for /complete, /finalize, and /cancel are now behind the in-tx auth checks. /finalize also now sources finalizedAt from round_states.entered_at after transitionState writes it (with a small leftover fallback path). No obvious regressions from the auth-reordering refactor, but there’s still one meaningful test gap around finalizedAt stability, and a small auth-vs-branching residual for the “round_state_missing” case.

Overall risk: medium

## Findings

1. [medium] Idempotent /finalize test does not assert finalizedAt stability across calls (regression could slip)
   - File: apps/tournament-api/src/routes/round-lifecycle.integration.test.ts:344-360
   - Confidence: high
   - Why it matters: The stated Medium #2 fix is specifically about using round_states.entered_at as the single source of truth so first-finalize and idempotent-finalize responses agree. The idempotent /finalize test currently asserts idempotent=true and “no new audit rows”, but it never checks that the second response’s finalizedAt equals the first response’s finalizedAt. A future regression (e.g., accidentally reintroducing Date.now()) would pass tests.
   - Suggested fix: In (h2), parse the first response body, store firstFinalizedAt, and assert the second response includes finalizedAt === firstFinalizedAt (and is a number).

2. [low] Lifecycle routes still branch on round_state_missing before auth (minor enumeration/state-probing residual)
   - File: apps/tournament-api/src/routes/round-lifecycle.ts:98-115
   - Confidence: medium
   - Why it matters: You’ve correctly moved the *idempotent 200* branches behind auth, preventing the prior auth-bypass. However, all four lifecycle handlers still call getRoundState and return/throw 422 round_state_missing before checking authorization (e.g., /complete at lines 100–115, similarly /complete-rollback and /finalize and /cancel). For an authenticated but unauthorized caller, this allows distinguishing “has round_states row” vs “doesn’t” (422 vs 403), which is a small but real information leak and doesn’t fully match the stated goal “authorization BEFORE state-driven branching.”
   - Suggested fix: If you want strict “no state/existence signal before auth,” reorder to perform the auth check first (using queries that safely return false on missing rounds) and only then call getRoundState / return state-specific 422s. If you intentionally prefer 422 round_state_missing regardless of auth, update the security rationale/docs accordingly.

3. [low] /finalize still has a Date.now() fallback for finalizedAt, which can undermine the “single source of truth” contract in edge cases
   - File: apps/tournament-api/src/routes/round-lifecycle.ts:314-377
   - Confidence: medium
   - Why it matters: Both the idempotent and post-transition finalizedAt paths use `rows[0]?.enteredAt ?? Date.now()` (lines 314–330 and 366–377). In normal operation, enteredAt should always exist when state is finalized, so this likely won’t execute; but if it ever does (schema/seed bug, unexpected nulls), you’d reintroduce non-deterministic timestamps and potentially violate idempotency expectations.
   - Suggested fix: Prefer treating a missing enteredAt as an internal invariant violation: return 500, or throw a BusinessRuleError with a clear code, or at least return null/omit finalizedAt rather than synthesizing Date.now(). Also consider adding `WHERE state='finalized'` to the re-read query for defense-in-depth.

## Strengths

- Auth gating is now correctly positioned before idempotent 200 branches on /complete (lines 106–127), /finalize (lines 304–330), and /cancel (lines 456–475), matching the prior High finding’s intent; the new (d2)/(h3)/(n2) tests cover this.
- /finalize now re-reads round_states.entered_at after transitionState (lines 358–377), making the response timestamp align with the persisted state transition timestamp source.
- scores.ts correctly delegates state transitions to transitionState and preserves the “rollback score insert if round becomes finalized/cancelled mid-flight” behavior for the not_started→in_progress case (scores.ts lines 461–491).
- scorer-assignments handoff now reads state inside the transaction and adds an UPDATE-level state predicate plus post-UPDATE state re-read to improve error accuracy (scorer-assignments.ts lines 145–364), and the finalize-before-handoff integration test exercises the intended partial-closure behavior.

## Warnings

None.
