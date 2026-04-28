# Codex Review

- Generated: 2026-04-27T21:17:56.619Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T4-2-pairings-ui-persistence.md, apps/tournament-api/src/db/schema/events.ts, apps/tournament-api/src/db/schema/groups.ts, apps/tournament-api/src/routes/admin-events.ts, apps/tournament-api/src/engine/pairings/suggest.ts

## Summary

Spec is generally detailed and test-oriented, but there are a few internal contradictions/ambiguities that would likely cause incorrect implementations in a trip-critical flow—especially around (a) how T4-2 behaves when T4-1 is absent, (b) the exact 422 conflicts payload shape, and (c) what “locked-row preservation” actually guarantees server-side vs client responsibility. Schema constraints are mostly reasonable, but the spec currently relies on application-layer validation for a couple cases that would otherwise surface as 500s (duplicate IDs within a pairing; slot range).

Overall risk: high

## Findings

1. [high] T4-2 ‘works without T4-1’ is not enforceable via a compile-time import check; importing T4-1 would fail builds when absent
   - File: _bmad-output/implementation-artifacts/tournament/T4-2-pairings-ui-persistence.md:13-85
   - Confidence: high
   - Why it matters: The story requires T4-2 to function fully even if T4-1 didn’t ship. But the spec’s proposed mechanism—“compile-time check via the imported function” (lines 82-85)—doesn’t allow a build to succeed when T4-1 code is not present. In practice, if you import from a non-existent module, the app won’t compile, so the ‘hide/disable Regenerate’ behavior can’t even be reached.
   - Suggested fix: Make the boundary runtime-based instead of compile-time: e.g., always ship the suggest route but have it return 501/404 when engine unavailable, or use a dynamic import guarded by try/catch (or feature flag) so the web build succeeds without T4-1. Update AC #6 to specify the exact runtime signal (HTTP status/code) that drives button hidden/disabled state.

2. [high] 422 conflicts payload shape is inconsistent across the spec (player_id vs playerId; round implicit vs eventRoundId mention)
   - File: _bmad-output/implementation-artifacts/tournament/T4-2-pairings-ui-persistence.md:51-303
   - Confidence: high
   - Why it matters: Risk §3 defines `conflicts: [{ player_id, foursomes: [...] }]` (line 51), AC #3 defines `conflicts: [{ playerId, foursomes: [...] }]` (line 182), and Dev Notes say conflicts includes `eventRoundId` (line 302) while Risk §3 says round is implicit and omitted (line 51). These mismatches make the ACs not fully unambiguous/testable and invite client/server contract drift—especially for the UI’s “round N” error message, which needs a stable way to map conflicts to a specific round.
   - Suggested fix: Pick one canonical JSON shape and repeat it everywhere. If the UI needs round context, explicitly include either `eventRoundId` or `roundNumber` in each conflict entry. Also standardize casing (`playerId` is consistent with other TS/JSON in the ACs).

3. [high] Locked-row preservation is described as a guarantee, but the upsert design provides no server-side preservation unless the client replays locked rows exactly
   - File: _bmad-output/implementation-artifacts/tournament/T4-2-pairings-ui-persistence.md:62-70
   - Confidence: high
   - Why it matters: Risk §5 describes DELETE-then-INSERT across the event (lines 64-68). Immediately after, it states “Locked-row preservation” but then clarifies the client is responsible for preserving slot order across re-saves (line 69). This is easy to misread/implement incorrectly, and it’s a trip-critical footgun: a client bug or stale state could unintentionally overwrite locked pairings because the server is not preserving anything—it is deleting everything.
   - Suggested fix: Make the AC explicit about the actual guarantee. Options: (1) server-enforced preservation: on POST, for any pairing marked `locked=true`, ignore request members and reuse existing persisted members/slot order; or (2) keep client-responsible semantics but change wording from “preservation” to “client must replay locked rows verbatim; server does not protect against overwrites” and add a backend test ensuring server rejects changes to locked pairings (409/422) if you want safety.

4. [medium] Spec says “adds two routes” but actually requires three (GET, POST, POST /suggest), risking incomplete implementation/review
   - File: _bmad-output/implementation-artifacts/tournament/T4-2-pairings-ui-persistence.md:53-88
   - Confidence: high
   - Why it matters: Risk §4 says “adds two routes” and lists GET and POST (lines 53-59), but later requires a third route `/pairings/suggest` (lines 82-88, AC #4). This kind of inconsistency often causes missed routing/mounting, missed auth/bodyLimit configuration, or missing tests.
   - Suggested fix: Update Risk §4 heading and bullets to explicitly list all three routes, including `/pairings/suggest`, and clarify whether `/suggest` shares the same bodyLimit/error shape expectations.

5. [medium] Missing validation will likely surface as 500s: duplicate player IDs within a single pairing and slot_number bounds are not specified as rejected
   - File: _bmad-output/implementation-artifacts/tournament/T4-2-pairings-ui-persistence.md:166-186
   - Confidence: medium
   - Why it matters: The schema (as described) uses PK `(pairing_id, player_id)` and UNIQUE `(pairing_id, slot_number)` (lines 46-48). If the request includes the same `playerId` twice in `memberPlayerIds` for one pairing, the insert will violate the PK and likely return a generic 500 unless explicitly caught/validated. Also, without a CHECK constraint or request validation, `slot_number` could be 0/negative or >4 if malformed; same for `foursomeNumber` ranges. For an admin tool this might be rare, but it’s exactly the kind of edge that breaks “trip-critical” reliability under retries or buggy UI state merges.
   - Suggested fix: In POST validation, assert `memberPlayerIds` has no duplicates within each pairing, and that derived `slot_number` is 1..4 and `foursomeNumber` is positive (and optionally <= `foursomesPerRound` if known). Consider adding SQL CHECK constraints for `slot_number >= 1` and `foursome_number >= 1` to fail fast with clearer errors.

6. [medium] POST /pairings/suggest contract depends on persisted pairings for lockedRounds replay, but behavior when nothing is persisted is unspecified
   - File: _bmad-output/implementation-artifacts/tournament/T4-2-pairings-ui-persistence.md:87-103
   - Confidence: medium
   - Why it matters: Risk §7 says the server “replaces the engine output’s locked rows with the current persisted pairings” (lines 99-103). But in the common case “user hasn’t saved yet” (or is working from an empty grid), there may be no persisted pairings to replay. The spec doesn’t state whether the server should (a) treat lockedRounds as no-ops without persisted data, (b) error, or (c) require a prior save. This affects both UX and testability.
   - Suggested fix: Define the rule: either require save-before-regenerate (and return 400 with a clear code if lockedRounds requested but no persisted baseline), or allow replay from client-provided current grid (include current grid in suggest request), or define that missing persisted pairings means “leave engine output as-is for those rounds.” Add a backend test for the chosen behavior.

## Strengths

- ACs are mostly concrete and include explicit status codes/codes for error precedence (404/400/422/401/403) and bodyLimit behavior.
- Schema design includes the key uniqueness constraints needed for deterministic ordering (`UNIQUE(event_round_id,foursome_number)` and `UNIQUE(pairing_id,slot_number)`) and uses CASCADE/RESTRICT appropriately in principle.
- Test plan is sized appropriately (12+ backend, 4+ frontend) and names the highest-risk cases (cross-tenant 404, 422 duplicates, upsert replace, lockedRounds handling).

## Warnings

None.
