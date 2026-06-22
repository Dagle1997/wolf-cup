# Codex Review

- Generated: 2026-06-22T01:03:13.368Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md

## Summary

The append-only `hole_claim_writes` + `client_event_id` dedupe does fix the specific “hard delete allows replay to resurrect” bug **for replays of the same event**. However, the spec still contains several contradictions/leftovers from the old cell-table design (tasks/dev-notes still describe cell uniques, 409 conflicts, and delete-to-remove), and the claim “resurrection is impossible” is only true if strict FIFO delivery + single-device assumptions hold—those guarantees are not fully specified/tested, and `created_at` alone is not a robust total ordering key.

Overall risk: high

## Findings

1. [critical] Spec still contains conflicting implementation instructions (cell-table semantics, hard delete, 409 conflicts) that contradict the append-only design
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:66-85
   - Confidence: high
   - Why it matters: Even though the DESIGN DECISION + AC1–AC3/AC11 describe an append-only writes-log, the Tasks and Dev Notes still instruct developers to implement the old model (cell unique, cell-upsert, delete-to-remove, and 409-on-conflict). This is likely to cause a wrong build (reintroducing the original CRITICAL class of bug) or a half-migrated hybrid that is hard to reason about/test.
   - Suggested fix: Rewrite Tasks 1/2/5/7 and Dev Notes to exclusively describe `hole_claim_writes` append-only behavior: (a) remove any “cellUniq” requirement; (b) remove “cell-upsert / cell-conflict→409”; (c) replace “delete-to-remove” with “append remove write”; (d) update any remaining references to `hole_claims` to `hole_claim_writes` + latest-write-per-cell derivation.

2. [high] “Resurrection is impossible” is not fully proven: out-of-order delivery or multi-device writes can still make an older set become the latest write
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:21-54
   - Confidence: high
   - Why it matters: The new model prevents resurrection from a replay of an already-inserted event (same `client_event_id`). But if events can reach the server out of order (or from multiple devices under the same scorer identity), an earlier-intent `set` that did NOT previously insert (so it is not deduped) can arrive after a later `remove` and become the latest by server `created_at`, effectively resurrecting the claim. The spec relies on “FIFO-per-device replay” and “single-writer” to make arrival order match intent, but those guarantees are not stated as hard requirements with enforcement/tests, and `created_at` does not provide a total order if timestamps collide.
   - Suggested fix: Make ordering guarantees explicit and enforceable: (1) require the offline queue to be strictly FIFO (no parallel flush) and add a test that later claim mutations are not dispatched until earlier ones are ACKed; and/or (2) add a client-side monotonic sequence (per device or per cell) and compute ‘latest’ by that sequence (server-enforced monotonicity), not by arrival time; and at minimum (3) define ‘latest’ ordering as `(created_at, id)` (or just `id` if it’s monotonic) to break ties deterministically. Also soften the spec language from “impossible” to “prevented under stated FIFO + single-device assumptions” unless you actually enforce those assumptions.

3. [high] AC10 still references the old `hole_claims` table instead of deriving from `hole_claim_writes`
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:48-51
   - Confidence: high
   - Why it matters: AC10 says `compute-foursome` populates `holeState.claims` “from the persisted `hole_claims`”. Under the new design there is no mutable `hole_claims` table; state must be derived as latest-write-per-cell from `hole_claim_writes`. Leaving this as-is invites an implementation that recreates a mutable table or derives incorrectly.
   - Suggested fix: Update AC10 to explicitly state: populate `holeState.claims` from `hole_claim_writes` by selecting the latest write per `(round_id, player_id, hole_number, claim_type)` (with a deterministic tiebreaker) and keeping only `op='set'`. Update Task 5 similarly (it currently says `hole_claims`).

4. [medium] AC4/AC9 still mention “cell unique” and imply second-device idempotency that the append-only model does not provide
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:38-47
   - Confidence: high
   - Why it matters: AC4 references “cell unique + client_event_id idempotency suffice”, and AC9 claims “a PWA retry or a second scorer device cannot double-insert.” In the append-only design you typically cannot have a cell-unique constraint (you need multiple writes per cell), and dedupe only works when the same `client_event_id` is reused—another device will generate a different event id and can append another write. That may be acceptable (since you derive only the latest), but the spec language is misleading and can lead to incorrect constraints/assumptions.
   - Suggested fix: Remove/adjust the “cell unique” language in AC4 and clarify AC9: idempotency is guaranteed for at-least-once replay of the *same* client event; cross-device duplicates are prevented only by the single-writer gate (and/or are resolved by latest-write semantics). If you truly need cross-device idempotency, you need a different key than `client_event_id` alone.

5. [medium] Global UNIQUE(client_event_id) may violate tenant isolation if collisions are possible; spec doesn’t state collision-resistant generation
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:21-37
   - Confidence: medium
   - Why it matters: You state all reads/writes are tenant-scoped, but the dedupe constraint is “global” on `client_event_id`. In a multi-tenant DB, a collision (accidental or adversarial if ids are guessable) could cause one tenant’s write to become a no-op because another tenant already used that id. Even if unlikely with UUIDv4/ULID, the spec does not require a collision-resistant format.
   - Suggested fix: Either: (a) require `client_event_id` to be a UUIDv4/ULID (documented + validated), making cross-tenant collision practically impossible; or (b) scope the unique constraint to tenant (e.g., `UNIQUE(tenant_id, client_event_id)`), which matches the tenant-scoping requirement more directly.

6. [low] Terminology drift: AC12 still says “delete” even though removes are append-only `remove` writes
   - File: _bmad-output/implementation-artifacts/tournament/2-1-inline-claim-capture-hole-claims.md:54-56
   - Confidence: high
   - Why it matters: Minor, but this is exactly the kind of wording that can cause someone to reintroduce hard deletes or assume delete semantics in tests.
   - Suggested fix: Change AC12 wording to “write/edit/remove” and avoid “delete” entirely for claims.

## Strengths

- The DESIGN DECISION block clearly identifies the original resurrection failure mode and states an append-only remedy with `INSERT … ON CONFLICT(client_event_id) DO NOTHING` (lines 17–27).
- AC2/AC3 explicitly require `client_event_id` NOT NULL, Zod validation (no DB CHECK), tenant-scoped reads/writes, and player_id membership validation (lines 35–37).
- AC11 correctly frames edit/remove/reassign as new writes (set/remove) rather than mutation/deletion, and explicitly states removal is queued offline (line 54).
- AC14 makes inert-vs-fail-closed behavior testable within Story 2.1 without waiting for resolver stories (line 57).

## Warnings

None.
