# Gemini Review

- Generated: 2026-06-22T01:09:14.405Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md

## Summary

The core append-only and server-assigned ordering design has been successfully implemented in the main ACs and Design block. However, there are lingering references to `409` conflicts, `delete`, and `two-unique` constraints in the testing requirements and dev notes that will confuse an AI agent and likely cause it to reimplement the removed bugs.

Overall risk: high

## Findings

1. [high] Leftover requirements to test '409' and 'delete' contradict append-only design
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:74-88
   - Confidence: high
   - Why it matters: Task 7 requires testing 'cell-conflict 409' and 'delete-to-remove', and the Dev Notes (Retro lesson) require testing '409/delete'. In the new append-only model, there are no cell conflicts (no 409s are returned) and no hard deletes (removes are appended). If left in, the dev agent will likely re-introduce the old cell-table logic to satisfy these test requirements.
   - Suggested fix: Remove 'cell-conflict 409' and 'delete-to-remove' from Task 7, and '409/delete' from the Retro lesson Dev Notes.

2. [high] Testing standards demand 'two-unique ON CONFLICT' instead of single-unique
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:97
   - Confidence: high
   - Why it matters: The testing standards require 'The two-unique ON CONFLICT behavior'. This contradicts the critical fix applied to AC2/Task 1, which explicitly enforces ONE dedupe UNIQUE on `client_event_id`. Instructing the agent to test a dual-unique setup will force it to reinstate the buggy cell constraint.
   - Suggested fix: Change 'The two-unique ON CONFLICT behavior' to 'The single-unique (client_event_id) ON CONFLICT behavior' or remove the 'two-unique' reference entirely.

3. [medium] Residual references to the old 'hole_claims' table and filename
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:50-94
   - Confidence: high
   - Why it matters: AC10 mentions populating the state 'from hole_claims', and the Project Structure Notes list 'db/schema/hole-claims.ts'. While AC1 correctly states the table is `hole_claim_writes` and Task 1 lists the correct filename, these old references may cause the agent to query the wrong table or create mismatched files.
   - Suggested fix: Update `hole_claims` to `hole_claim_writes` in AC10, and change `db/schema/hole-claims.ts` to `db/schema/hole-claim-writes.ts` in the Project Structure Notes.

## Strengths

- The primary Design Decision block is excellent and completely captures the append-only log, single dedupe constraint, and server-side monotonic sequence ordering required to prevent deleted claims from resurrecting.
- ACs 1 through 4 have been successfully adapted to strictly detail the `hole_claim_writes` implementation and effectively ban mutable cell logic.
- Good use of idempotent queued mutations mapped to the same score offline-queue infrastructure.

## Warnings

None.
