# Codex Review

- Generated: 2026-04-28T11:26:49.873Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/db/schema/pairings.ts, apps/tournament-api/src/routes/admin-events.ts, apps/tournament-api/src/routes/admin-events.test.ts, apps/tournament-web/src/routes/admin.events.$eventId.pairings.tsx, apps/tournament-web/src/routes/admin.events.$eventId.pairings.test.tsx, _bmad-output/implementation-artifacts/tournament/T4-2-pairings-ui-persistence.md

## Summary

Core T4-2 backend routes + schema are present and mostly match the story: schema constraints, tenant filters on most queries, 7-step handler precedence ordering, transactional delete-then-insert upsert, and lockedRounds replacement by 1-indexed roundNumber.

Main issues are (a) one missing tenant filter on a JOIN in GET, (b) frontend Regenerate does not actually preserve per-cell pins (it replaces entire unlocked rounds), and (c) frontend can silently discard unsaved edits/pins when foursomesPerRound changes (and can miscompute isDirty vs persisted lock state). There are also a couple of missing validations on POST that can lead to accidental data loss (partial-round payload wipes other rounds) or 500s (duplicate rounds/foursome numbers).

Overall risk: medium

## Findings

1. [medium] Tenant-scoping gap: GET pairings members JOIN to players lacks players.tenantId filter
   - File: apps/tournament-api/src/routes/admin-events.ts:425-440
   - Confidence: high
   - Why it matters: AC/security contract says tenant scoping on every SELECT/UPDATE/DELETE. In GET /pairings, memberRows JOIN players but the WHERE only filters pairingMembers.tenantId; it does not constrain players.tenantId. If cross-tenant player rows could ever be referenced (via bad data, partial migration, or future code paths), this route could leak names across tenants and violates the explicit hardening rule even if today’s POST preflight usually prevents it.
   - Suggested fix: Add eq(players.tenantId, TENANT_ID) to the memberRows WHERE clause in GET /events/:eventId/pairings (similar to the roster query).

2. [medium] Frontend Regenerate does not honor per-cell pins; replaces whole unlocked rounds
   - File: apps/tournament-web/src/routes/admin.events.$eventId.pairings.tsx:256-343
   - Confidence: high
   - Why it matters: AC/spec describes “Regenerate unpinned” and explicitly: “replace unlocked/unpinned cells with engine output.” Current implementation collects per-cell pins, but converts them to engine-level pins ({round,foursome,playerId}) and then, on success, replaces the entire unlocked round’s slots from engine output (lines ~317-340), ignoring pinned cell positions (and even whether a pinned cell’s existing occupant should be preserved in that slot). Engine pins also cannot represent slot position, so pinned cells are not actually preserved as pinned.
   - Suggested fix: When merging resp.grid into state, preserve pinned cells (by cellKey) and only fill/update unpinned cells. If engine pins are only per-foursome, keep pinned players in their pinned slot explicitly during merge (or change pin model to per-foursome if that’s the intended UX). Add a component test proving pinned cells remain unchanged after regenerate.

3. [medium] Changing foursomesPerRound reinitializes grid from server and can drop unsaved edits + pins; pins can become misaligned
   - File: apps/tournament-web/src/routes/admin.events.$eventId.pairings.tsx:127-156
   - Confidence: high
   - Why it matters: The grid is rebuilt from server data whenever foursomesPerRound changes (effect deps include foursomesPerRound). This can silently wipe in-progress edits/locks (because it calls setGrid(next) from persisted state) and leaves pins state intact even though cell indices/shape changed, so pin keys may now point at the wrong cells. This is a data-loss UX risk for a trip-critical hand-edit screen.
   - Suggested fix: Decouple persisted data hydration from foursomesPerRound changes: when foursomesPerRound changes, expand/shrink existing grid in-place (preserve existing assignments/locks) and clear or remap pins accordingly. Add a test: assign a player, change foursomesPerRound, ensure assignment isn’t lost and pins don’t drift.

4. [medium] POST /pairings allows partial-round payloads; handler deletes all event rounds’ pairings anyway → accidental data loss if client sends subset
   - File: apps/tournament-api/src/routes/admin-events.ts:532-727
   - Confidence: high
   - Why it matters: Handler builds validRoundIds from ALL eventRounds for the event, then unconditionally deletes all pairings for those rounds (lines ~689-699), but it only re-inserts what’s in body.rounds. If a client bug (or future UI) submits only 1 round, it will erase pairings for other rounds. Story framing says this endpoint is “upsert all pairings for the event”; the schema currently doesn’t enforce that body covers all rounds.
   - Suggested fix: Validate that body.rounds contains every eventRoundId exactly once (or change delete scope to only the eventRoundIds present in the request). Add a test with 2 rounds: persist both, POST body for only round 1, assert round 2 pairings are preserved (or assert request is rejected with invalid_body).

5. [low] Missing validation: duplicate eventRoundId entries and/or duplicate foursomeNumber per round can cause 500 instead of clean 400
   - File: apps/tournament-api/src/routes/admin-events.ts:295-680
   - Confidence: high
   - Why it matters: SavePairingsRequestSchema doesn’t enforce unique eventRoundId within rounds, nor unique foursomeNumber within a round. Duplicates can lead to UNIQUE constraint failures on (event_round_id, foursome_number) and bubble as 500 upsert_failed, violating the intended “invalid_body” contract for structurally invalid requests.
   - Suggested fix: Add Zod refinements: (1) rounds’ eventRoundId unique, (2) per round, pairings’ foursomeNumber unique and within a reasonable range. Add tests asserting 400 invalid_body for these cases.

6. [low] Frontend isDirty lock comparison is per-foursome and can disagree with round-level lock derivation
   - File: apps/tournament-web/src/routes/admin.events.$eventId.pairings.tsx:347-376
   - Confidence: medium
   - Why it matters: Grid init sets round.locked based on `anyLocked = r.pairings.some(p => p.locked)` (round-level). isDirty then compares `draftLocked` to `persistedLocked = persisted?.locked ?? false` inside each foursome loop. If a round has at least one locked pairing but not all foursomeNumbers present/locked, isDirty may report dirty immediately on load (and/or behave inconsistently as foursomesPerRound changes).
   - Suggested fix: Compute persisted round lock consistently (e.g., `dataRound.pairings.some(p => p.locked)`) and compare once per round, not per-foursome. Add a test with partially-populated pairings and locked=true on one pairing to ensure initial isDirty is as intended.

## Strengths

- Backend POST /pairings error precedence matches the 7-step spec ordering within the handler (bodyLimit → Zod → event_not_found → unknown_event_round → duplicate-in-foursome → unknown_player → 422 cross-pairing uniqueness).
- Upsert delete scope is eventRoundId-scoped (IN event’s event_round ids) and tenant-scoped, avoiding cross-event collisions in the normal case.
- Cross-pairing uniqueness is correctly checked preflight against the request body (new state), not the DB.
- lockedRounds replacement in /pairings/suggest correctly treats lockedRounds as 1-indexed roundNumber and uses idx = roundNumber-1.
- Schema matches AC#1: CASCADE FK from pairings.event_round_id, RESTRICT from pairing_members.player_id, composite PK on (pairing_id, player_id), and UNIQUE(pairing_id, slot_number) plus UNIQUE(event_round_id, foursome_number).
- Good test coverage added for most handler outcomes (happy paths, 404/401/403, unknown_player, unknown_event_round, duplicate within foursome, 422 conflicts, and lockedRounds warning behavior).

## Warnings

- Truncated file content for review: apps/tournament-api/src/routes/admin-events.test.ts
- Git diff was truncated for the review request.
