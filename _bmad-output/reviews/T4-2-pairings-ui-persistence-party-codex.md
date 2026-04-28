# Codex Review

- Generated: 2026-04-28T11:30:57.687Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/T4-2-pairings-ui-persistence-party-review.md, apps/tournament-api/src/routes/admin-events.ts, apps/tournament-api/src/db/schema/pairings.ts, apps/tournament-web/src/routes/admin.events.$eventId.pairings.tsx

## Summary

Core pairings persistence + suggest wiring is mostly tenant-scoped and transactional, but there are two correctness risks that can cause silent/irreversible user-visible issues: (1) POST upsert deletes pairings for *all* event rounds even if the request only includes some rounds (data loss), and (2) POST /pairings/suggest ignores the provided foursomesPerRound parameter (likely breaking the UI’s contract/expectations). Error-precedence also no longer matches the documented 7-step list due to new “duplicate_*” errors inserted earlier.

Overall risk: high

## Findings

1. [high] POST /pairings upsert can wipe unsent rounds (partial payload → data loss)
   - File: apps/tournament-api/src/routes/admin-events.ts:568-763
   - Confidence: high
   - Why it matters: The handler builds validRoundIds from *all* event rounds (L569-579), then in the transaction deletes pairings for all those rounds (L725-735), and only re-inserts what’s present in body.rounds (L737-762). Since SavePairingsRequestSchema only requires rounds.min(1) (L295-304) and does not require “all event rounds”, any client bug, future client, or manual call that submits a subset will irreversibly delete existing pairings for the missing rounds. This is the party’s #3 “NOT blocker”, but in practice it’s a real blast-radius/data-loss hazard on a trip-critical surface.
   - Suggested fix: Either (A) enforce the spec server-side: require body.rounds’ eventRoundIds to exactly match the event’s rounds (same set), else 400; or (B) change delete scope to only delete for eventRoundIds present in the request body (and optionally reject unknown/missing). Add an explicit test that pins whichever contract you choose.

2. [high] POST /pairings/suggest ignores foursomesPerRound input (UI contract likely broken)
   - File: apps/tournament-api/src/routes/admin-events.ts:306-885
   - Confidence: high
   - Why it matters: SuggestRequestSchema requires foursomesPerRound (L306-319) and the frontend sends it (tournament-web L285-291), but the backend never uses it when calling suggestPairings (L878-884). If the engine output’s number of foursomes is not inherently derived to match the UI’s requested count, Regenerate will not actually honor the user’s “foursomes per round” setting, leading to empty columns or missing groups in the UI merge (frontend fills only f=0..foursomesPerRound-1; L326-337).
   - Suggested fix: If the engine supports a target foursomesPerRound / totalSlots / rosterSize constraint, pass it through; otherwise, drop the field from the request schema + frontend payload and remove the UI affordance (or explicitly validate and warn that it’s ignored). Add a test asserting regenerate output shape matches requested foursomesPerRound.

3. [medium] Documented “7-step error precedence” no longer matches implementation due to extra duplicate_* errors
   - File: apps/tournament-api/src/routes/admin-events.ts:466-592
   - Confidence: medium
   - Why it matters: The comment promises a 7-step precedence list (L466-478), but the implementation introduces step 4a duplicate_event_round / duplicate_foursome_number before unknown_event_round (L533-567). If AC #3 requires exact precedence, this is drift: an input that triggers both conditions could now return duplicate_* instead of unknown_event_round.
   - Suggested fix: Align the AC/spec: either update the precedence doc/AC expectation, or move duplicate checks into the declared step 4 bucket with an explicit ordering that matches the acceptance criteria (and test multi-error cases deterministically).

4. [medium] Lock semantics are per-round in UI but persisted per-pairing; empty rounds cannot persist a lock
   - File: apps/tournament-web/src/routes/admin.events.$eventId.pairings.tsx:127-181
   - Confidence: medium
   - Why it matters: UI treats lock as a round flag (GridRound.locked; L73-79, toggled L406-410) but only sends locked on pairings that have >=1 member (L171-179). If a user locks a round before assigning anyone (or clears all cells then saves), the server will persist no pairings rows for that round, so lock state can’t survive refresh. This can surprise users and undermines “locked rounds stay stable” as a workflow primitive.
   - Suggested fix: Persist lock at the round level (event_rounds.locked) or add a dedicated round_lock table/row; alternatively, force creation of placeholder pairing rows when a round is locked so the lock survives even if empty (but that changes DB semantics).

## Strengths

- Tenant scoping appears consistently applied on all shown SELECT/DELETEs in these new routes (e.g., events/eventRounds/groups/groupMembers/players/pairings/pairingMembers all filter tenantId where used).
- Upsert is correctly wrapped in a single transaction and uses DELETE-then-INSERT semantics (admin-events.ts L723-763); pairing_members cleanup relies on FK cascade (schema pairings.ts L73-76).
- Cross-pairing uniqueness per round is checked deterministically and returns a stable conflicts payload (admin-events.ts L670-716).

## Warnings

None.
