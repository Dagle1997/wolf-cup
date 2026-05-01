# Codex Review

- Generated: 2026-05-01T12:41:40.339Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-7-scorer-handoff-endpoint.md

## Summary

Spec is mostly implementable and stays within the allowed tournament app footprint, but it has a key TOCTOU/atomicity gap around authorization + capturing `fromPlayerId` that could allow an ex-scorer to transfer again after being replaced (or produce incorrect audit payload). A few spots are ambiguous enough to cause dev guesswork (pairings join keys, conflicting guidance on pre-tx vs in-tx reads), and the integration test list is missing several important cases that follow directly from the ACs (round_state_missing, foursome_has_no_scorer, etc.).

Overall risk: medium

## Findings

1. [high] Authorization TOCTOU risk: pre-transaction scorer check + unconditional UPDATE can allow stale scorer to transfer after losing scorer role
   - File: _bmad-output/implementation-artifacts/tournament/T5-7-scorer-handoff-endpoint.md:51-125
   - Confidence: high
   - Why it matters: The spec insists auth lookups run before entering the transaction (lines 53, 111–112), but the write in AC-5 updates solely by `(round_id, foursome_number, tenant_id)` (line 122) without constraining the current scorer. If scorer A is authorized by the pre-read, but scorer changes to B before A’s UPDATE runs, A can still successfully transfer (because the UPDATE doesn’t verify A is still scorer). This is exactly the stale/hand-off concurrency surface the endpoint is meant to harden, and it also undermines audit correctness (the actor may no longer be permitted at the moment of mutation).
   - Suggested fix: Make the authorization + mutation atomic. Options:
- Do a `SELECT scorer_player_id ...` inside the transaction (ideally locking semantics if available) and re-check: allow if session is organizer OR session matches the *current* scorer at time of mutation.
- Or branch the UPDATE:
  - scorer-path: `... WHERE ... AND scorer_player_id = session.userId` (0 rows => 403 stale/not-authorized)
  - organizer-path: `... WHERE ...` (organizer can override)
In both cases, capture the pre-update scorer (`fromPlayerId`) inside the same transaction for audit and response.

2. [high] `fromPlayerId`/`oldScorer` required by AC-5/response is not actually derivable from the specified UPDATE; needs an explicit in-tx read
   - File: _bmad-output/implementation-artifacts/tournament/T5-7-scorer-handoff-endpoint.md:118-125
   - Confidence: high
   - Why it matters: AC-5 and the 200 response require `fromPlayerId: oldScorer` (lines 123–125), but the write step is described only as an UPDATE (line 122). Without a prior SELECT (or an UPDATE…RETURNING that includes old values, which is not generally available), the handler cannot reliably know the previous scorer. Guessing via a pre-transaction read reintroduces race conditions and can log/return the wrong `fromPlayerId` under concurrent handoffs.
   - Suggested fix: Specify (and implement) a transaction sequence:
1) `SELECT scorer_player_id FROM scorer_assignments WHERE ...` (0 rows => 422 foursome_has_no_scorer)
2) re-check auth if caller is not organizer
3) UPDATE to new scorer
4) write audit/activity using the selected `fromPlayerId`.
If you want to keep “pre-transaction reads” for the fast 403 path, still re-read inside the transaction for correctness.

3. [medium] Contradiction: auth lookups described as both “inside its own transaction” and “before entering the transaction”
   - File: _bmad-output/implementation-artifacts/tournament/T5-7-scorer-handoff-endpoint.md:51-54
   - Confidence: high
   - Why it matters: Line 51 says “The handler does both lookups inside its own transaction”, while lines 53 and AC-3 (111–112) require both lookups to run before `db.transaction`. This is a dev-facing ambiguity and matters for correctness because the chosen approach affects race handling and the ability to produce a correct `fromPlayerId`.
   - Suggested fix: Pick one approach and document it consistently. Given AC-5’s need for `fromPlayerId` and the TOCTOU risk, the safest spec is: do any cheap preliminary checks you want, but perform an authoritative `SELECT current assignment + auth decision` inside the transaction immediately before the UPDATE.

4. [medium] AC-4 membership validation join keys are underspecified (“eventRoundId” is undefined)
   - File: _bmad-output/implementation-artifacts/tournament/T5-7-scorer-handoff-endpoint.md:113-117
   - Confidence: high
   - Why it matters: AC-4 says to join `pairing_members → pairings` to confirm membership of `(eventRoundId, foursomeNumber)` (line 116), but “eventRoundId” isn’t defined elsewhere in the spec (the route uses `:roundId`). Depending on the schema, `pairings` could be keyed by `(event_id, round_id)` or only `event_id`, etc. This is likely to cause dev guesswork and mismatched validation (e.g., checking membership in the event but not the specific round/foursome).
   - Suggested fix: Define precisely how to identify the foursome for membership validation (exact columns):
- If pairings are per-round: `pairings.round_id = :roundId AND pairings.foursome_number = body.foursomeNumber`
- If pairings are per-event: `pairings.event_id = rounds.event_id AND pairings.foursome_number = body.foursomeNumber`
…and then `pairing_members.pairing_id = pairings.id AND pairing_members.player_id = body.toPlayerId` (plus tenant filters). Use consistent terminology (`roundId` vs `eventRoundId`).

5. [medium] Integration test list omits several AC-defined error paths and important auth invariants
   - File: _bmad-output/implementation-artifacts/tournament/T5-7-scorer-handoff-endpoint.md:147-161
   - Confidence: high
   - Why it matters: AC-10’s 10 tests miss scenarios that are explicitly part of the ACs or core security model:
- AC-2 includes `422 round_state_missing` (line 65) but no test.
- AC-5 includes `422 foursome_has_no_scorer` when UPDATE affects 0 rows (line 122) but no test.
- Per-event organizer vs global organizer is central (lines 45–50), but there’s no test proving a `players.is_organizer` user who is not `events.organizer_player_id` is rejected.
- No test that a scorer for *another* foursome cannot transfer this foursome (ensures scorer authorization is scoped to `(roundId,foursomeNumber)`).
These gaps risk shipping an endpoint that passes the test suite but violates acceptance criteria or the intended auth model.
   - Suggested fix: Extend AC-10 with at least:
- (k) 422 round_state_missing
- (l) 422 foursome_has_no_scorer (no scorer_assignments row)
- (m) 403 global-organizer-but-not-event-organizer
- (n) 403 scorer-of-different-foursome
Optionally add a concurrency/TOCTOU regression test once implementation chooses a strategy.

6. [low] Potentially missing “Files this story will edit” entries if new audit/event constants are required
   - File: _bmad-output/implementation-artifacts/tournament/T5-7-scorer-handoff-endpoint.md:118-246
   - Confidence: medium
   - Why it matters: AC-5 references `AUDIT_EVENT_TYPES.SCORER_TRANSFERRED` (line 123) and an activity type `'scorer.transferred'` (line 124). If those constants/enums don’t already exist, implementation may need to edit shared constants files (e.g., `apps/tournament-api/src/lib/audit-log.ts` or a constants module), which are not currently listed under “Files this story will edit” (lines 238–245). That would break the spec gate’s “append before commit” rule and could create churn during implementation.
   - Suggested fix: Pre-verify whether the audit event type constant already exists. If it doesn’t, update the spec now to include the exact file(s) that will be edited to add it (still under `apps/tournament-api/**`), or specify that the route will emit an existing eventType string already supported by `writeAudit`.

## Strengths

- All referenced implementation paths stay within `apps/tournament-*/**` (and the spec itself under `_bmad-output/**`); no Wolf Cup/engine boundary violations are implied by the file list (lines 238–245).
- Clear statement of the per-event organizer rule (events.organizer_player_id) and explicit rejection of global organizer middleware reuse (lines 45–50), which prevents a common auth mistake.
- Atomicity intent is correct: transfer + audit + activity in a single transaction (lines 118–125), and the stale-offline-queue recovery path correctly leverages existing 403 metadata rather than inventing a new contract (lines 69–76, 132–136).
- “Files this story will edit” section is repo-relative, one path per line, and constrained to ALLOWED directories (lines 238–246).

## Warnings

None.
