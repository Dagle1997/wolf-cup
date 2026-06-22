# Codex Review

- Generated: 2026-06-22T00:29:43.026Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md

## Summary

Spec is close to the shipped Epic-1 patterns, but the concurrency/idempotency story is not yet internally consistent—especially around delete-to-remove under an at-least-once offline queue—and several behaviors (edit vs second-writer 409; inert-vs-fail-closed) are underspecified or not actually testable in 2.1 without additional clarified seams.

Overall risk: high

## Findings

1. [critical] Delete-to-remove is not safe under at-least-once offline delivery without an explicit ordering/tombstone/sequence guarantee (resurrection risk)
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:23-44
   - Confidence: high
   - Why it matters: The spec explicitly relies on at-least-once offline replay/idempotency via `client_event_id` (AC9) while also choosing hard delete for removals (AC11). With a hard delete, any later replay of an older “add” mutation (e.g., request committed but client never received the response; or multi-tab/device/out-of-order delivery) can re-insert the row because the dedupe uniqueness no longer exists after deletion. This is exactly the class of bug that can silently change settled state and is hard to detect later.
   - Suggested fix: Make removals idempotent and non-resurrectable by design. Options:
- Prefer a tombstone/soft-delete (`deleted_at` or `is_removed`) and keep the row, and ensure the write path never reactivates based on an older event.
- Or store a per-cell monotonic `mutation_seq`/`updated_at` with compare-and-swap semantics and reject/ignore stale events.
- Or store an append-only `hole_claim_mutations`/dedupe ledger keyed by `(round_id, player_id, hole_number, claim_type, client_event_id)` so duplicates remain deduped even if the current-state row is removed.
Also, explicitly state and test the offline queue contract you are relying on (strict FIFO, never sends mutation N+1 until N is acked) if you intend to use it as a correctness mechanism.

2. [high] The described “two-unique + INSERT ON CONFLICT” behavior is ambiguous/inconsistent for edits vs 409 conflicts
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:22-41
   - Confidence: high
   - Why it matters: AC3 claims three distinct outcomes: (1) same `client_event_id` retry dedupes (no-op), (2) scorer edits update the existing cell row, and (3) different `client_event_id` colliding on the cell unique aborts→409. But an “edit” (new `client_event_id` for the same cell) is indistinguishable at the DB-unique level from a “second writer” (also a new `client_event_id` for the same cell). Unless you add additional conditions (e.g., only allow update if `scorer_player_id` matches and/or within the same scorer session), you can’t get both “edit allowed” and “new client_event_id on same cell causes 409” purely from the two uniques.
Additionally, AC11 says “correct `claim_type`” can be edited in place, but `claim_type` is part of the cell identity (AC2), so changing it cannot be an in-place update without changing the primary identity; it’s effectively remove+add.
   - Suggested fix: Tighten the spec to a concrete, implementable DB contract:
- Define the request model explicitly (e.g., `operation: 'upsert' | 'delete'`, and for upsert what mutable columns exist besides keys).
- Specify the exact ON CONFLICT target(s) and conditions.
- If you want “single-writer” at DB-level, consider including `scorer_player_id` in the conflict update predicate (update only if existing `scorer_player_id` matches; otherwise raise 409) or encode writer identity in the cell unique.
- If edits are allowed, define precisely what constitutes a conflicting second writer (likely authorization-layer, not just ‘different client_event_id’).
- Align AC11 with the key design: changing `claim_type` should be explicitly defined as remove+add (not “edit in place”).

3. [medium] Offline-queue ‘claim’ kind: spec doesn’t define how delete/removal is represented, risking non-replayable removals or stuck queues
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:29-60
   - Confidence: medium
   - Why it matters: AC6/Task 4 covers adding a new `MutationKind` and dispatching to a URL/body, but AC11 requires delete-to-remove and reassign=remove+add. The spec doesn’t say whether removal is:
- a `claim` mutation with a delete flag/action,
- a separate mutation kind (e.g., `claim_remove`), or
- executed via a non-queued online-only path.
If removal isn’t representable as an offline-queued mutation, offline edits can reconcile incorrectly (e.g., adds replay but deletes don’t), or the queue can retry forever if server returns 409/4xx and the client doesn’t classify it correctly as terminal.
   - Suggested fix: Explicitly define the offline mutation payload schema for claims, including removal. For example:
- `kind:'claim'` with `{op:'upsert'|'delete', roundId, playerId, holeNumber, claimType, clientEventId}`.
Then specify terminal/retry behavior for expected failures (409 single-writer, 403/401 auth, 400 validation, 409 finalized) so the offline queue won’t spin indefinitely.

4. [medium] AC14 ‘inert vs fail-closed’ is not crisp/testable in Story 2.1 if claim resolvers are intentionally out of scope
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:43-60
   - Confidence: high
   - Why it matters: The story explicitly says claim resolvers (greenie/polie/sandie) ship in 2.2–2.4 and that claims are inert until then (lines 6–9, 36). But AC14 requires tests asserting: enabled:false → ZERO edges; unknown modifier type → unsettleable. Without the resolver(s), enabled:true vs enabled:false will both produce zero edges (nothing consumes claims), so the ‘inert’ portion is not actually distinguishable/testable within 2.1 unless there is an existing generic modifier pipeline that would otherwise create edges or throw errors independent of resolvers.
   - Suggested fix: Clarify where AC14 is enforced in 2.1:
- If there is a generic “modifier type registry” pipeline, state that claims are wired into it and unknown types trigger unsettleable there.
- Otherwise, move the enabled:false behavior test to the resolver stories (2.2–2.4) and keep only the unknown-type fail-closed test in 2.1 if it already exists at config resolution time.
Also define precisely what “surfaced” means (API error? activity? UI banner?) so it’s verifiable.

5. [medium] Security/data-integrity gap: spec doesn’t require validation that `player_id` belongs to the round/foursome, or tenant scoping at the DB query level
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:21-33
   - Confidence: medium
   - Why it matters: `requireScorerForRound` gates who can write for a round (AC7), but the spec does not state that the server must validate that the `player_id` being claimed is actually in that round’s foursome/pairing, nor that reads/writes are scoped to the tournament/tenant beyond `round_id`. A scorer for Round A could potentially write claims for arbitrary `player_id`s (or learn existence) if IDs are guessable or leaked. Even if the app UI won’t send such IDs, server-side validation is the money-adjacent backstop.
   - Suggested fix: Add explicit server-side validation requirements:
- Verify `player_id` is in the round’s participants/pairings for that foursome.
- Validate `hole_number` is within the round’s hole range (typically 1–18).
- Ensure all SELECT/INSERT/DELETE statements join through the round/tournament/org scope already derived from session to prevent cross-tenant access.
Optionally add FKs to `rounds`/`players` if consistent with existing schema patterns.

6. [low] Dedupe unique requires `client_event_id` to be NOT NULL; otherwise duplicates with NULL will bypass dedupe
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:21-24
   - Confidence: high
   - Why it matters: In Postgres, UNIQUE constraints treat NULLs as distinct, so if `client_event_id` is nullable (not specified in AC1/AC2), dedupe uniqueness won’t enforce idempotency for NULL events and could allow accidental duplicates or inconsistent behavior across clients.
   - Suggested fix: State explicitly in the schema requirements that `client_event_id` is `NOT NULL` (and ideally a UUID) and that the API rejects missing/empty values before hitting the DB.

## Strengths

- Explicitly scopes Story 2.1 to capture/storage + recompute-on-read fanout only, and calls out resolvers as out of scope (lines 6–9, 76–78).
- Reuses known Epic-1 seams (hole_scores pattern, requireScorerForRound gate, activity/audit union registration) which reduces integration risk (lines 65–71).
- Front-loads edge-case tests (dedupe/409/delete/finalized/fail-closed) based on Epic-1 retro lesson (lines 73–74, Task 7).
- Avoids DB CHECK-driven rebuilds per stated constraint and keeps changes additive/sibling to existing scoring tables (lines 19–25).

## Warnings

None.
