# Codex Review

- Generated: 2026-05-22T22:19:20.648Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/admin-event-rounds.ts, apps/tournament-api/src/db/schema/scoring.ts, apps/tournament-api/src/db/migrations/0013_loose_maginty.sql, apps/tournament-api/src/routes/onboarding-lifecycle.e2e.test.ts, apps/tournament-web/src/routes/admin.events.$eventId.start-round.tsx, apps/tournament-web/src/routes/admin.events.$eventId.start-round.test.tsx, apps/tournament-web/src/routes/admin.events.$eventId.index.tsx, _bmad-output/implementation-artifacts/tournament/T13-2-start-round-instantiate-scoring.md

## Summary

The new POST /api/admin/event-rounds/:eventRoundId/start endpoint largely matches the stated ACs: strict Zod body parsing, tenant-scoped event_round lookup (404), pairings all-locked gate (422), per-foursome scorer mapping validation (400s), and atomic creation of rounds + round_states + scorer_assignments in a single transaction. Idempotency is implemented via insert-then-recover backed by a partial UNIQUE index on rounds.event_round_id, with recovery performed outside the aborted transaction. Web wiring and the lifecycle E2E test close the previously-missing “can’t start scoring” gap.

Main remaining concerns are (a) a couple AC-specified validation cases not covered by tests (strict/invalid body, no-pairings), (b) hardcoding the initial round state string instead of sourcing it from the FSM/service (risk of drift), and (c) slightly brittle UNIQUE-error detection + a minor tenant-scoping omission in the recovery check.

Overall risk: medium

## Findings

1. [medium] AC-3 validation test coverage is incomplete (strict body + no-pairings not exercised)
   - File: apps/tournament-api/src/routes/onboarding-lifecycle.e2e.test.ts:333-459
   - Confidence: high
   - Why it matters: The story/ACs call out strict body shape validation (unknown keys rejected) and the “no pairings” case returning 422 pairings_not_ready. The added E2E tests cover several validation codes (403/404/422-unlocked/400 invalid_scorer/duplicate/unknown/missing), but do not include a case proving strict Zod behavior (e.g., extra keys in the body) or that an event_round with zero pairings returns pairings_not_ready. These gaps make regressions in request validation easier to miss, especially since the endpoint’s behavior depends on Zod `.strict()` and `.min(1)` semantics.
   - Suggested fix: Add explicit tests:
- POST start-round with `{ scorers: [...], extra: 1 }` and expect 400 invalid_body (and optionally check issues path).
- POST start-round with `{ scorers: [] }` and expect 400 invalid_body.
- Create an event_round but do not POST pairings; call start-round and expect 422 pairings_not_ready.

2. [medium] Initial round state is hardcoded ('not_started') instead of being sourced from the FSM/service
   - File: apps/tournament-api/src/routes/admin-event-rounds.ts:597-621
   - Confidence: medium
   - Why it matters: The endpoint inserts `round_states.state = 'not_started'` (lines 613-620). Even though this likely works today (and the E2E proves scoring is reachable), it creates a drift risk: if the round state machine’s allowed entry state changes (or if a different “start” semantic is introduced), this endpoint can silently become incompatible. The AC explicitly called out verifying against round-state.ts/FSM entry state; hardcoding makes that coupling implicit and easier to break.
   - Suggested fix: Import and use a single source of truth for the entry state (e.g., an exported `ROUND_ENTRY_STATE` or `getInitialRoundState()` from the round-state service), or at least centralize the string constant in the service layer and reference it here. Consider adding a small test assertion that the created state equals the FSM entry state constant if one exists.

3. [medium] UNIQUE/PK constraint detection for idempotency may be brittle across libsql error shapes
   - File: apps/tournament-api/src/routes/admin-event-rounds.ts:471-495
   - Confidence: medium
   - Why it matters: Idempotent recovery depends on `isUniqueOrPkConstraintError` recognizing the UNIQUE violation reliably (lines 471-495). The helper checks a few string fields and `rawCode` values 2067/1555, but libsql/drivers can surface constraint info under different properties (e.g., generic `SQLITE_CONSTRAINT` plus a numeric extended code, or different nesting). If the detector misses the UNIQUE violation in some runtime environments, a legitimate retry/concurrent-start can return 500 start_failed instead of recovering the existing roundId (violating AC-4 in practice).
   - Suggested fix: Prefer reusing a proven, shared constraint-detector helper (export the existing one if available), or broaden detection to handle common libsql/sqlite error shapes (e.g., `code === 'SQLITE_CONSTRAINT'` + extended code numeric 2067, or checking `message` for `uniq_rounds_event_round_id`). Consider logging the full error shape on constraint failures in non-prod/test to validate detection.

4. [low] Recovery branch checks round_states existence without tenant filter (minor defense-in-depth gap)
   - File: apps/tournament-api/src/routes/admin-event-rounds.ts:645-649
   - Confidence: high
   - Why it matters: In the UNIQUE-recover path, the code verifies a round_state row exists via `where(eq(roundStates.roundId, existing[0].id))` (lines 645-649) without also filtering `roundStates.tenantId = TENANT_ID`. Because `existing` is already tenant-scoped and roundId is a PK, this is unlikely to cause incorrect behavior, but it’s inconsistent with the rest of the file’s tenant scoping and weakens the stated defense-in-depth posture.
   - Suggested fix: Add tenant scoping to the roundStates lookup: `where(and(eq(roundStates.roundId, existing[0].id), eq(roundStates.tenantId, TENANT_ID)))` (and optionally contextId if that is a hard invariant).

5. [low] Web route beforeLoad does not enforce organizer role; may show generic error state for non-organizers
   - File: apps/tournament-web/src/routes/admin.events.$eventId.start-round.tsx:178-189
   - Confidence: high
   - Why it matters: The Start Round page uses `beforeLoad: requireAuthOrRedirect()` (lines 178-183) but does not guard `player.isOrganizer`. Server-side endpoints should still block (403), but the UI will render and then fail the pairings fetch with a generic error card, which is a UX and minor information-disclosure risk (existence of the route). The admin landing page does enforce organizer access, but direct navigation/bookmarks bypass that client-side check.
   - Suggested fix: Add an organizer check in `beforeLoad` or in `RouteComponent` similar to the admin landing route: if `!player?.isOrganizer`, render a Forbidden state or redirect back.

## Strengths

- Endpoint validates request body with strict Zod schema (apps/tournament-api/src/routes/admin-event-rounds.ts:456-469, 521-527).
- Event-round lookup is tenant-scoped and sources eventId/holesToPlay from DB rather than trusting the client (admin-event-rounds.ts:530-541).
- Correct pairings readiness gate: requires pairings exist and all are locked before allowing start (admin-event-rounds.ts:543-550).
- Scorer mapping validation covers duplicate/unknown/missing scorer entries and enforces per-foursome membership-or-organizer constraint (admin-event-rounds.ts:572-595).
- Atomic creation in a single transaction of rounds + round_states + scorer_assignments (admin-event-rounds.ts:600-632).
- Idempotency/race-safety is backed by a partial UNIQUE index on rounds.event_round_id (schema: apps/tournament-api/src/db/schema/scoring.ts:86-91; migration: apps/tournament-api/src/db/migrations/0013_loose_maginty.sql:1) and uses recovery outside the aborted transaction (admin-event-rounds.ts:633-655).
- E2E lifecycle test now proves the real HTTP flow can reach scoring and that leaderboard reflects posted scores, closing the previously-masked gap (onboarding-lifecycle.e2e.test.ts:333-368).
- Web UI provides per-foursome scorer pickers defaulting to organizer and posts the mapping, with render/interaction tests (apps/tournament-web/src/routes/admin.events.$eventId.start-round.tsx; .test.tsx).

## Warnings

None.
