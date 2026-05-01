# Codex Review

- Generated: 2026-05-01T13:53:04.416Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-8-round-lifecycle-state-machine.md

## Summary

Spec is much clearer and more actionable than prior round (especially around idempotent finalize + missing-cells enumeration), but there are still a few correctness/implementability risks. Most notably, the proposed SQLite “in-tx read + EXISTS-gated UPDATE” race-window closure is not convincingly correct under snapshot semantics as written, and several acceptance-criteria call sites still omit the newly-added `tenantId` argument to `transitionState`.

Overall risk: high

## Findings

1. [high] Race-window fix claims the EXISTS predicate will see concurrent finalize after an in-transaction read; under SQLite snapshot semantics this is likely false/unstable
   - File: _bmad-output/implementation-artifacts/tournament/T5-8-round-lifecycle-state-machine.md:93-130
   - Confidence: medium
   - Why it matters: Section 7 correctly explains the core problem: a transaction can observe a pre-finalize snapshot and proceed even if finalize commits concurrently (lines 95–98). However, the proposed fix then claims that adding an `EXISTS (SELECT 1 FROM round_states ...)` predicate to the scorer_assignments UPDATE will “see the new state” if finalize commits between the in-tx read and the UPDATE (lines 103–123). In SQLite, all reads within a transaction are generally from the same snapshot (especially once the transaction has performed reads), so an `EXISTS` subquery in a later statement typically cannot “see” commits that happened after the snapshot was established. Additionally, AC-10 explicitly requires `getRoundState(...)` as the FIRST in-tx step (line 295), which (in many SQLite configurations) establishes the snapshot early—making the later EXISTS check even less likely to observe the concurrent finalize. If this is wrong, the spec’s stated closure of T5-7f could still allow the anomaly, and the regression test might be flaky or fail to reproduce what it claims.
   - Suggested fix: Tighten the spec to a mechanism that is actually guaranteed under SQLite/libsql:
- Option A: run scorer-handoff and finalize/cancel using a transaction mode that prevents the interleaving (e.g., `BEGIN IMMEDIATE`) so finalize cannot commit “during” handoff.
- Option B: make the handoff write *conflict* with finalize by writing the same `round_states` row (even a no-op `UPDATE round_states SET entered_at=entered_at WHERE ... AND state NOT IN (...)`) before/with the handoff write, so one must serialize on the same row.
- Option C: avoid establishing a stale snapshot before the gated write: perform the single gated UPDATE first (including the state predicate), and only then read additional state/authorization details on the 0-row path (potentially outside the tx), if that fits your auth/TOCTOU constraints.
Also clarify which SQLite journal/WAL mode your libsql test harness uses, because the behavior differs significantly.

2. [medium] `transitionState` signature includes `tenantId`, but multiple AC call sites still omit it (would mislead implementation and/or fail typecheck)
   - File: _bmad-output/implementation-artifacts/tournament/T5-8-round-lifecycle-state-machine.md:177-289
   - Confidence: high
   - Why it matters: AC-1 defines `transitionState(tx, roundId, to, actorPlayerId, tenantId)` (lines 177–183). But AC-4(v) calls `transitionState(tx, roundId, 'complete_editable', session.userId)` (line 243), AC-5(iii) similarly omits tenantId (line 254), and AC-9 reiterates the old 4-arg form for the T5-6 refactor (lines 286–289). This creates an internal spec inconsistency and is a common source of implementation drift (devs copy/paste from AC examples).
   - Suggested fix: Update all AC/examples to pass `tenantId` (or `TENANT_ID`) consistently:
- AC-4(v): `transitionState(tx, roundId, 'complete_editable', session.userId, TENANT_ID)`
- AC-5(iii): `transitionState(tx, roundId, 'in_progress', session.userId, TENANT_ID)`
- AC-9: explicitly show the 5-arg signature in the refactor guidance.
Also update the earlier “Integration points to T5-6” bullets (lines 82–86) if they’re meant to be copyable guidance.

3. [medium] Finalize AC uses `computeMissingCells(..., round, ...)` but does not specify reading the `round` row (eventRoundId/holesToPlay)
   - File: _bmad-output/implementation-artifacts/tournament/T5-8-round-lifecycle-state-machine.md:258-269
   - Confidence: high
   - Why it matters: `computeMissingCells` requires `round: { eventRoundId; holesToPlay }` (AC-1 lines 204–213; Task 1 lines 357–363). AC-4 explicitly includes a “Round row read” step before calling `computeMissingCells` (line 241–243). AC-6 does not include an analogous step, yet step (iii) calls `computeMissingCells(tx, roundId, round, tenantId)` (line 264–265). This leaves the finalize handler under-specified and risks inconsistent implementations (some may skip the defense entirely, or re-query inside the helper and diverge from the signature).
   - Suggested fix: Add an explicit finalize step mirroring AC-4(iii): read the `rounds` row inside the finalize tx to obtain `eventRoundId` + `holesToPlay`, then pass it into `computeMissingCells`.

4. [medium] AC-10(d) regression test describes INSERTing a finalized round_states row; that’s incompatible with the stated schema and doesn’t match real finalize behavior
   - File: _bmad-output/implementation-artifacts/tournament/T5-8-round-lifecycle-state-machine.md:298-420
   - Confidence: high
   - Why it matters: AC-10(d) says the test “INSERTs a round_states.state='finalized' row from a SECOND db handle” (line 298–299). But earlier the spec states `round_states` has a PK on `round_id` with a single-row-per-round invariant (lines 36–37). Inserting should violate the PK unless the seed omitted the row (which would contradict the invariant and other parts of the system). Also, using a raw INSERT doesn’t accurately simulate a real finalize path (which should be an UPDATE via `transitionState` and may include audit/activity). This makes the regression test description misleading and may cause the test to be implemented incorrectly or to pass for the wrong reasons.
   - Suggested fix: Adjust the test description to update the existing `round_states` row (either via `transitionState` on the second connection or a direct `UPDATE round_states SET state='finalized'... WHERE round_id=? AND tenant_id=?`). If the goal is to model the real system, prefer calling the actual `/finalize` handler (or the same service function) on the second connection.

5. [low] Finalize activity/audit responsibilities are slightly contradictory between Section 8 and ACs
   - File: _bmad-output/implementation-artifacts/tournament/T5-8-round-lifecycle-state-machine.md:132-268
   - Confidence: high
   - Why it matters: Section 8 says the finalize handler’s “Activity row (handled by transitionState)” (lines 136–139), but AC-6 assigns activity emission to the handler (line 267–268) and Task 1’s `transitionState` responsibilities list audit but not activity (lines 344–353). This is small, but it can cause mis-implementation (double activity emits or none).
   - Suggested fix: Pick one place for activity emission (ACs imply handlers) and make Section 8 consistent (e.g., change to “Activity row (emitted by handler)”).

## Strengths

- BusinessRuleError API is now explicitly positional and consistent in the spec (AC-1/AC-2), with a clear default-status rule.
- `computeMissingCells` is specified with a deterministic output order and includes both counts + explicit enumeration, which should make route errors testable and UX-friendly.
- Finalize idempotency is now unambiguous and test-assertable (AC-6 + AC-12(h2)), including the “no new audit/activity rows” requirement.
- Section 7b usefully documents the broader convention (“state-gate the write, not just a prior read”), which helps prevent future TOCTOU regressions.

## Warnings

None.
