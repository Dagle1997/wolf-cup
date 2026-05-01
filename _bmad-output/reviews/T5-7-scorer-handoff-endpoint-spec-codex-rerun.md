# Codex Review

- Generated: 2026-05-01T12:46:33.731Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-7-scorer-handoff-endpoint.md

## Summary

The revised spec cleanly addresses the prior TOCTOU/atomicity concerns around scorer authorization: the authoritative `fromPlayerId` capture now happens inside the transaction (AC-3(i)) and the scorer-path UPDATE is properly narrowed with `AND scorer_player_id = :fromPlayerId` (AC-5(a)), making stale-scorer writes affect 0 rows and fail. AC-4’s join chain is now explicitly keyed via `rounds.event_round_id → pairings.event_round_id → pairings.foursome_number`, and Section 3’s “fast 403 is not load-bearing” note is consistent with AC-3/AC-5.

The main remaining correctness gap is that the round state gate is performed outside the transaction (AC-2), leaving a race where a concurrent finalization/cancellation could occur after the precheck but before the transfer UPDATE commits.

Overall risk: medium

## Findings

1. [medium] Round state gate is outside the transaction (possible race: transfer can commit after round becomes finalized/cancelled)
   - File: _bmad-output/implementation-artifacts/tournament/T5-7-scorer-handoff-endpoint.md:100-165
   - Confidence: high
   - Why it matters: AC-2 performs the `round_states.state` check before opening `db.transaction(...)` (AC-3/AC-5). If another request/process changes the round state to `finalized` or `cancelled` after AC-2 but before (or during) the handoff transaction, this endpoint can still update `scorer_assignments` and emit audit/activity, violating the stated contract that finalized/cancelled rounds reject handoff.

This is the same class of TOCTOU issue you fixed for scorer authorization, but applied to the state machine gate.
   - Suggested fix: Move the round state read (and the finalized/cancelled/missing checks) into the same `db.transaction` as the scorer SELECT + UPDATE, or add a write-time guard by incorporating the state into the UPDATE predicate (e.g., UPDATE ... WHERE ... AND EXISTS(SELECT 1 FROM round_states WHERE round_id=:roundId AND tenant_id=:tenant AND state IN ('not_started','in_progress','complete_editable'))). Add an integration test that simulates a state change between precheck and write (if hard concurrently, do it by splitting into two transactions and ensuring the handler re-reads state in-tx).

2. [low] `assignedAt: now` is underspecified (DB time vs app time) and can cause response/audit drift
   - File: _bmad-output/implementation-artifacts/tournament/T5-7-scorer-handoff-endpoint.md:136-165
   - Confidence: medium
   - Why it matters: AC-5 sets `assigned_at = now()` in SQL but also returns and audits `assignedAt: now` (AC-5(c), AC-5 commit response). If implementation uses application time for the payload/response while the DB uses its own `now()`, you can get small but test-visible mismatches (especially if tests assert exact equality), and audit/response may not reflect the actual persisted `assigned_at`.
   - Suggested fix: Specify that `assignedAt` in the response/audit is sourced from the database write (e.g., `UPDATE ... RETURNING assigned_at` or a subsequent SELECT of `assigned_at` within the same transaction), and use that returned value for both audit payload and response.

3. [low] AC-9 UI banner filters on specific 403 codes that are not evidenced in this spec (risk of contract drift with existing middleware)
   - File: _bmad-output/implementation-artifacts/tournament/T5-7-scorer-handoff-endpoint.md:182-185
   - Confidence: low
   - Why it matters: AC-9 triggers the banner only when `lastError.body.code` is `'player_not_in_your_foursome'` or `'not_scorer_for_this_foursome'`. This spec references `require-scorer-for-round` as the source of stale-queue 403s, but the actual set of codes returned by that middleware is not shown here. If the middleware uses different codes (or changes), the banner won’t render even though `currentScorerName` exists, weakening the “load-bearing” stale-queue UX.
   - Suggested fix: Either (1) base the banner primarily on presence of `currentScorerName` + 403 status and treat codes as advisory, or (2) explicitly enumerate (with citation) the exact codes produced by `require-scorer-for-round` for the stale-scorer case and add a test that locks that code in.

## Strengths

- TOCTOU window for scorer authorization is materially narrowed: in-tx scorer SELECT captures `fromPlayerId` and scorer-path UPDATE narrows on `scorer_player_id = :fromPlayerId` (AC-3/AC-5).
- Organizer override semantics are explicitly separated from scorer semantics (AC-5(b)), avoiding accidental lockout while still preventing stale-scorer writes.
- AC-4’s membership validation now uses an explicit and correct join chain keyed off `rounds.event_round_id` and `pairings.foursome_number`, with tenant filters on both tables.
- Section 3’s note about pre-transaction “fast 403” being non-load-bearing is consistent with AC-3/AC-5 sequencing.
- AC-10’s 14-case test list covers the major documented error paths, including per-event-organizer vs global-organizer and scorer scoping to a specific foursome.

## Warnings

None.
