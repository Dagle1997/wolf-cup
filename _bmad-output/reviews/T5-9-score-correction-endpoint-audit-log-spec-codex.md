# Codex Review

- Generated: 2026-05-01T23:56:13.898Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-9-score-correction-endpoint-audit-log.md

## Summary

Spec is largely complete and internally consistent with the stated epic constraints (narrowed gross+putts only; auth model; explicit state allow/deny list; append-only score_corrections; no EXISTS predicate on UPDATE; T6 deferred with breadcrumb). The main gaps are a few ambiguities that could cause implementers to accidentally violate the “auth-first/no existence leak” requirement (especially on GET), plus underspecified error response shapes and an unclear “breadcrumb log” timing relative to transaction commit.

Overall risk: medium

## Findings

1. [high] Auth-first / no-existence-leak requirement is not fully specified for GET and is ambiguous for non-existent rounds during auth
   - File: _bmad-output/implementation-artifacts/tournament/T5-9-score-correction-endpoint-audit-log.md:60-162
   - Confidence: high
   - Why it matters: The story explicitly calls out an auth-leak regression (auth must run before any state read or existence check) to prevent leaking whether a round/player exists to unauthorized callers (lines 60-61, 85-90, and test (p) lines 141-143). However:
- AC-6/Task GET flow (lines 113-116, 159-162) does not explicitly require the same non-leak behavior (e.g., for a non-authorized caller hitting a non-existent roundId). Implementations often do “SELECT corrections WHERE round_id=...” then decide auth based on whether any rows exist, which leaks existence/history.
- Even for POST, the auth check itself (organizer-of-event-containing-round OR scorer assignment for that round) typically requires joining from the round to event_round/pairings. If the roundId doesn’t exist, the auth query returns zero rows—implementation must still return 403 for unauthorized callers to satisfy (p). The spec implies this but doesn’t state the required behavior when the round doesn’t exist during the auth step.
This ambiguity is a common source of security regressions because a well-intentioned existence check can slip earlier than auth, or auth can implicitly become an existence check.
   - Suggested fix: Tighten the contract for BOTH endpoints:
- Explicitly state: “If roundId does not exist, and caller is not an organizer/scorer for that (non-existent) round, still return 403 (do not return 404/422 before auth).”
- Add a GET analogue to test (p): non-authorized caller + non-existent roundId must get 403 (not 404/200/empty list).
- In Task 1, spell out that GET must perform auth check in-tx before selecting corrections (and must not branch on corrections existence).

2. [medium] Per-event organizer helper signature/naming is inconsistent and may cause an implementation bug
   - File: _bmad-output/implementation-artifacts/tournament/T5-9-score-correction-endpoint-audit-log.md:41-43
   - Confidence: medium
   - Why it matters: Line 42 says: “Reuses T5-8's `isEventOrganizer(tx, roundId, playerId, tenantId)` helper.” But the story’s intended check is `events.organizer_player_id == session.userId` (line 42) which suggests the helper should receive the *caller/actor* id, not `playerId` from the URL. The parameter name `playerId` here is ambiguous (could be callerId or target playerId). If an implementer passes the URL `:playerId` by mistake, organizers would be incorrectly denied/allowed depending on who is being corrected, which would be a serious auth flaw.
   - Suggested fix: In the spec, rename the helper usage to `isEventOrganizer(tx, roundId, callerId, tenantId)` (or explicitly: “pass session.userId”). Also in Task 1, specify which id is passed for organizer checks to eliminate the chance of swapping target vs actor ids.

3. [medium] Breadcrumb log timing relative to transaction commit is underspecified (risk of false-positive logs on rollback)
   - File: _bmad-output/implementation-artifacts/tournament/T5-9-score-correction-endpoint-audit-log.md:103-107
   - Confidence: high
   - Why it matters: AC-4 requires an info-level breadcrumb when correcting a finalized round (lines 103-107), but it doesn’t say whether this log happens inside the transaction or only after a successful commit. If logged inside the transaction and the transaction later fails/rolls back (e.g., audit insert fails, constraint violation), you’ll emit a misleading “pending T6” breadcrumb for a correction that never persisted. This is especially likely if the log includes `correctionId` (line 106) but the correction insert happens in the same transaction.
   - Suggested fix: Specify: “Emit breadcrumb only after the transaction resolves successfully (post-commit), and include the committed correctionId.” If you must log inside tx, explicitly gate it after all writes and ensure failures don’t log (e.g., log after `await tx.commit()` / outside `db.transaction`).

4. [low] Error response bodies for invalid path params and non-200 statuses are not fully specified/consistent
   - File: _bmad-output/implementation-artifacts/tournament/T5-9-score-correction-endpoint-audit-log.md:80-116
   - Confidence: high
   - Why it matters: AC-1 specifies the detailed body for Zod failures (line 83) and some error codes for 400/403/404/422, but for several cases it only names status + code (e.g., “400 invalid_round_id” line 83; “403 not_authorized_for_correction” line 89; “422 round_state_missing” line 90) without specifying the JSON shape (whether it includes `{ error, code, requestId }` consistently). This can lead to inconsistent handler responses and brittle tests, especially since tests are enumerated but not described with exact response bodies for each code.
   - Suggested fix: Add a short “Error response contract” section (or per-AC notes) stating the canonical shape for all non-200 responses (e.g., `{ error: string, code: string, requestId }` plus optional `issues`). Then list codes for each status so tests can be deterministic.

## Strengths

- Clear path footprint allowlist and explicit ‘Files this story will edit’ list (lines 19-25, 204-209), aligned with the request’s ALLOWED-only constraint.
- Auth model rationale is explicit and matches the intended narrowing (target-foursome scorer for POST; any-round scorer for GET; organizer override) (lines 39-48, 113-116).
- State gating is explicitly enumerated and the spec calls out the critical ordering (auth before state) and the deliberate omission of a state-gating EXISTS predicate to allow finalized corrections (lines 49-61, 68-71, 184-186).
- Append-only semantics for score_corrections plus separate audit_log entry are well described and testable (lines 62-67, 118-122).
- AC-8 test matrix is concrete and includes an explicit auth-leak regression case (p) (lines 123-143).

## Warnings

None.
