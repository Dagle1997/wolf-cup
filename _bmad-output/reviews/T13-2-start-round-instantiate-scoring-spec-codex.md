# Codex Review

- Generated: 2026-05-22T21:42:56.133Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T13-2-start-round-instantiate-scoring.md

## Summary

Spec closes a real gap (no create path for rounds/round_states/scorer_assignments) and defines a transactional, idempotent organizer-only “start round” flow. Main correctness/security risks left ambiguous are (1) race-safe single-round-per-event_round enforcement without a DB uniqueness constraint, (2) what to do if an existing round is found but related rows are missing/partial, and (3) whether creating the initial round_state directly as `in_progress` is valid per the existing state machine and any invariants assumed elsewhere. Validation rules are mostly solid but a few edge cases (extra/duplicate scorer mappings, foreign players, unlocked pairings definition) should be explicitly covered in ACs/tests to avoid regressions or 500s.

Overall risk: medium

## Findings

1. [high] Idempotency is not race-safe without a DB uniqueness constraint on rounds.event_round_id (risk of duplicate rounds under concurrent start calls)
   - File: _bmad-output/implementation-artifacts/tournament/T13-2-start-round-instantiate-scoring.md:39-41
   - Confidence: high
   - Why it matters: The spec relies on “existence check inside the tx” to prevent multiple rounds per event_round. If there is no UNIQUE constraint on `rounds.event_round_id`, two concurrent requests can both observe “no round yet” and insert, producing duplicates (and potentially conflicting scorer_assignments/round_states). This breaks AC-4 and can make scoring/leaderboards ambiguous.
   - Suggested fix: Prefer a DB-level uniqueness guarantee (unique index/constraint scoped by tenant if applicable) and use `INSERT ... ON CONFLICT DO NOTHING/UPDATE RETURNING`. If schema migration is truly out-of-scope, use a robust locking strategy in the transaction (e.g., `SELECT ... FOR UPDATE` on the event_round row, or an advisory lock keyed by event_round_id) and add a concurrency test that fires two start requests in parallel.

2. [high] Idempotent re-start behavior is underspecified if a round exists but round_states/scorer_assignments are missing or incomplete
   - File: _bmad-output/implementation-artifacts/tournament/T13-2-start-round-instantiate-scoring.md:77-81
   - Confidence: high
   - Why it matters: AC-4 says “return existing roundId” if a `rounds` row already exists. But production may already contain partially-created data (especially if this is the first create path). Returning an existing roundId while `round_states` or some `scorer_assignments` are missing will leave scoring still failing (422 round_state_missing / foursome_has_no_scorer), undermining AC-2 and making retries ineffective.
   - Suggested fix: Define explicit behavior for “existing round but missing related rows”: either (a) treat as repairable and upsert the missing `round_states` and scorer_assignments within the same transaction (preferred), or (b) return a clear 409/422 with an actionable code so operators can fix data. Add tests for this partial-state scenario.

3. [medium] Initial round_state = in_progress may violate the existing round-state state machine or invariants assumed elsewhere
   - File: _bmad-output/implementation-artifacts/tournament/T13-2-start-round-instantiate-scoring.md:48-50
   - Confidence: medium
   - Why it matters: The spec proposes creating `round_states.state='in_progress'` at creation time, but also flags that `round-state.ts` must be checked. If the state machine assumes creation begins at `not_started` and transitions forward, inserting `in_progress` directly could cause later lifecycle actions (complete/finalize/cancel) or audits to fail or behave inconsistently. This is a correctness risk that can be hard to detect until later endpoints are exercised.
   - Suggested fix: Before implementation, confirm allowed initial state(s) and transition guards in `apps/tournament-api/src/services/round-state.ts`. If the machine expects `not_started` first, start there and have the start endpoint also perform a transition to `in_progress` via the same service used elsewhere (ensuring consistent audit/entered_at semantics). Add a lifecycle test that completes the round after starting to ensure transitions work from the chosen initial state.

4. [medium] Validation edge cases missing: extra/duplicate foursome mappings, unknown foursome numbers, and non-deterministic body shape
   - File: _bmad-output/implementation-artifacts/tournament/T13-2-start-round-instantiate-scoring.md:45-76
   - Confidence: high
   - Why it matters: AC-3 covers missing scorer for a foursome and invalid scorer membership, but does not explicitly cover: (1) duplicate entries for the same foursomeNumber, (2) scorer mappings for a foursomeNumber that does not exist in locked pairings, and (3) ensuring the mapping covers exactly the set of pairings. These cases can lead to unexpected DB constraint errors (PK conflict on (round_id,foursome_number)) or silently ignored/ambiguous assignments, which risks 500s or inconsistent scoring access.
   - Suggested fix: Tighten request schema semantics: enforce uniqueness of `foursomeNumber`, reject unknown foursomes, and require exact coverage of the set of locked pairings. Add explicit 400 error codes for these cases and tests to ensure they never fall through to DB errors.

5. [medium] Authorization/member validation must be tenant- and event-scoped for both event_round and scorerPlayerId
   - File: _bmad-output/implementation-artifacts/tournament/T13-2-start-round-instantiate-scoring.md:42-47
   - Confidence: medium
   - Why it matters: The spec correctly calls out 403 for non-organizer and 404 for unknown/foreign-tenant event_round. But it also requires verifying `scorerPlayerId` is either in that pairing or the organizer. If scorerPlayerId isn’t additionally constrained to the same tenant/event roster, a malicious organizer (or a compromised organizer token) could assign an arbitrary playerId from another tenant (or non-rostered player) and potentially grant scoring capabilities to an unintended identity, depending on how auth/player IDs are managed.
   - Suggested fix: When validating `scorerPlayerId`, ensure it’s (a) in the same tenant/context, and (b) either the event organizer or a pairing_member for that event_round/foursome. Consider rejecting scorer IDs not present in event roster even if tenant matches. Add a test for foreign-tenant scorerPlayerId returning 400 invalid_scorer (or 404) without leaking existence.

6. [medium] Locked pairings requirement is recommended but not fully nailed down; ambiguity can cause inconsistent “pairings_not_ready” behavior
   - File: _bmad-output/implementation-artifacts/tournament/T13-2-start-round-instantiate-scoring.md:45-46
   - Confidence: high
   - Why it matters: The spec says “recommend requiring locked pairings” and AC-3 allows “No pairings (or, if required, unlocked pairings) → 422 pairings_not_ready”. If the implementation chooses not to require `locked`, rounds could be started against mutable pairings, which undermines single-writer assignment semantics (scorer chosen for a foursome that later changes). If it does require `locked`, the API/UI/E2E must consistently set and verify that flag or tests will be flaky.
   - Suggested fix: Make `locked` a hard requirement (or explicitly not) and define precisely what “ready” means: pairings exist for all expected foursomes and each pairing has the required members, and `locked=true` for all of them. Add explicit tests for unlocked pairings returning 422 pairings_not_ready.

7. [low] CHECK constraint chk_rounds_event_pairing implies event_id and event_round_id must be set together; ensure event_id is sourced from event_round, not from request
   - File: _bmad-output/implementation-artifacts/tournament/T13-2-start-round-instantiate-scoring.md:23-25
   - Confidence: medium
   - Why it matters: Spec notes `chk_rounds_event_pairing` requires both IDs set together. If handler takes event_id from client input (even indirectly via route params) rather than reading the event_round row, it risks CHECK violations or, worse, inconsistent cross-linking if the DB permits both but they don’t match the same event. This is both correctness and authorization-sensitive (event mismatch could bypass organizer scoping if not carefully joined).
   - Suggested fix: Fetch event_round by id (tenant-scoped) and read `event_id` + `holes_to_play` from that row. Do not accept event_id from the request body. Optionally assert event_round.event_id matches the event being administered if the route includes eventId.

## Strengths

- Clearly grounded audit of the current gap with concrete failure modes (round_not_found / round_state_missing / foursome_has_no_scorer) (lines 13–19).
- Atomic, single-transaction requirement is explicit and test-driven (AC-1) (lines 59–63).
- Validation and authorization expectations are enumerated with specific status codes and error codes (AC-3) (lines 70–76).
- Explicit callout of the main state-machine risk and requirement to confirm against round-state.ts (lines 48–50).
- End-to-end lifecycle test requirement (AC-6) directly guards against reintroducing the original dead-end (lines 85–87).

## Warnings

None.
