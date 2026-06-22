# Gemini Review

- Generated: 2026-06-22T00:30:17.289Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md

## Summary

The spec thoughtfully reuses the robust two-unique deduplication pattern from `hole_scores` and correctly isolates the capture phase from the execution phase (resolvers). However, relying on hard deletes for removal breaks offline queue idempotency, as deleting the row removes the dedupe key, allowing stale retries to silently resurrect removed claims. There is also a logical paradox requiring tests for resolvers that are explicitly out of scope.

Overall risk: high

## Findings

1. [critical] Stale offline retries will resurrect deleted claims
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:40-41
   - Confidence: high
   - Why it matters: The spec dictates `delete-to-remove` for claim removal. If a row is physically deleted, its `client_event_id` deduplication key is also lost. Under at-least-once offline delivery, a delayed network retry of the original `ADD` mutation will arrive, bypass the dedupe check (since the row is gone), and successfully re-insert the claim, violating idempotency.
   - Suggested fix: Use a soft-delete approach (e.g., a `deleted_at` timestamp or `is_active` boolean) on the `hole_claims` table. This keeps the row and its `client_event_id` intact so the database's UNIQUE constraints can successfully catch and ignore stale insert retries.

2. [medium] Testing edge generation for out-of-scope resolvers
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:43-44
   - Confidence: high
   - Why it matters: AC14 and Task 5 require asserting that unknown modifiers fail closed and disabled ones produce 0 edges. However, the 'Out of scope' section (Line 77) explicitly states that the resolvers (which contain the edge generation logic) are not built until Stories 2.2-2.4. You cannot write integration tests for 0-edge behavior when the code responsible for generating edges does not exist.
   - Suggested fix: Move AC14 and its corresponding tests to Story 2.2 (where the first resolver ships), or clarify that Story 2.1 will introduce a purely stubbed resolver strictly to test the engine's failure-handling plumbing.

3. [medium] Missing test file for `compute-foursome` mapping logic
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:100
   - Confidence: high
   - Why it matters: Task 5 dictates modifying `compute-foursome.ts` to map claims into the engine's `holeState`. Modifying core engine data-mapping without updating its tests introduces regression risk, yet `compute-foursome.test.ts` is omitted from the file list.
   - Suggested fix: Add `apps/tournament-api/src/engine/games/compute-foursome.test.ts` to the 'Files this story will edit' list to ensure the new `holeState.claims` population logic is verified.

4. [low] Ambiguous offline-queue mutation contract for deletion
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:29-30
   - Confidence: medium
   - Why it matters: AC6 specifies adding a single `claim` MutationKind, but AC11 allows adding, editing, and removing claims. It's unclear if removal is handled by a `claim` payload with a null value/flag, or if a separate `remove_claim` MutationKind is needed. This ambiguity can lead to disjointed API/web implementations.
   - Suggested fix: Explicitly define the payload shape for the `claim` MutationKind to support deletion (e.g., passing `{ action: 'remove' }` or `value: null`), or register a dedicated `remove_claim` MutationKind.

## Strengths

- Excellent reuse of the proven two-unique ON CONFLICT pattern from `hole_scores` to enforce single-writer constraints.
- Appropriate architectural layering by keeping the database read localized to the service layer, maintaining pure engine resolvers.
- Proactive inclusion of the `finalized` boundary checks and `client_event_id` idempotency as explicit test criteria.

## Warnings

None.
