# Codex Review

- Generated: 2026-04-22T19:12:08.465Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/api/src/index.ts, apps/api/src/routes/rounds.ts

## Summary

A) Round-2 findings appear closed: (1) quit endpoint now verifies groups.id + groups.roundId match the requested roundId before deletion, preventing cross-round group deletion; (2) scheduledRoundIds parsing in both getRoundDetail and the score-submit putts-week detection is now defensive (Array guard + Number normalization + finite filter).

B) The new group-scope check is correct for preventing the original cross-round issue, but because it happens outside the transaction it can race with concurrent deletes and allow a “phantom success” (200) if the group is deleted after the pre-check and before the transaction runs.

C) Within the provided (non-truncated) portion of this file, the scheduledRoundIds.includes(roundId) call sites have been updated; no other occurrences are visible in the provided content.

D) Deploy readiness: PASS (no new High found). Consider the minor race/idempotency improvement below as a follow-up hardening.

Overall risk: low

## Findings

1. [low] Non-atomic pre-transaction group existence check can race, returning 200 even if the group is deleted between the check and the transaction
   - File: apps/api/src/routes/rounds.ts:413-489
   - Confidence: high
   - Why it matters: You correctly prevent cross-round deletion by checking (groups.id, groups.roundId) before deleting. However, because the check is performed on the global db handle before starting the transaction (lines 419–431), another request could delete the group after this check but before the transaction begins (line 434). In that case, the transaction’s deletes become no-ops and the endpoint still returns success (line 494). This is mostly an idempotency/consistency issue rather than a data-integrity/security problem, but it can confuse clients and makes behavior depend on timing.
   - Suggested fix: Move the ownership check into the transaction using the transaction handle (tx) and/or scope the actual group delete to both ids: `await tx.delete(groups).where(and(eq(groups.id, groupId), eq(groups.roundId, roundId)))` and verify affected-row count (if supported) to return 404 when nothing was deleted. This preserves your cross-round protection and eliminates the race window.

## Strengths

- Round-2 High is addressed: group deletion is now scoped to roundId via an explicit lookup (apps/api/src/routes/rounds.ts:413–431), preventing cross-round group deletion.
- Round-2 Med is addressed: scheduledRoundIds parsing is now defensive and normalized in both getRoundDetail and putts-week detection (apps/api/src/routes/rounds.ts:258–279 and 990–1005).
- Cleanup now deletes side-game CTP entries and hole completions prior to deleting groups/rounds, consistent with the stated FK constraints (apps/api/src/index.ts:95–113).
- Deterministic side game selection is improved by ordering sideGames by id before selecting the first match (apps/api/src/routes/rounds.ts:262–279).

## Warnings

- Truncated file content for review: apps/api/src/routes/rounds.ts
