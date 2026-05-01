# Codex Review

- Generated: 2026-05-01T01:12:21.422Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-5-cross-group-stroke-play-leaderboard-v1.md, _bmad-output/reviews/T5-5-cross-group-stroke-play-leaderboard-v1-spec-codex.md

## Summary

Most prior issues are resolved as directed: tie-break is cleanly deferred (no FR-C5 logic in v1), handicap math is slope/rating/par-aware via the USGA formula and explicitly a port (not an engine import), `round=current` ordering + zero-round behavior are now deterministic, and the edit-path footprint is constrained to `apps/tournament-*/**` with an append-only rule.

However, a few medium-risk spec ambiguities/inconsistencies remain that could cause implementation drift or flaky tests/UI (mainly around deterministic ordering among ties/unscored, rank semantics, scope selection via query params, and a contradictory statement about test fixture count).

Overall risk: medium

## Findings

1. [medium] Spec contradicts itself on leaderboard service test fixture count (2 vs 4)
   - File: _bmad-output/implementation-artifacts/tournament/T5-5-cross-group-stroke-play-leaderboard-v1.md:25-31
   - Confidence: high
   - Why it matters: The path-footprint section states `leaderboard.test.ts` will contain “2 fixtures” (all-tied-zero + mid-round mixed-thru), but AC-7 and Task 4 require 4 fixtures including event-scope aggregation and null handicap_index. This is a concrete inconsistency that can lead to under-testing (dev follows the earlier statement) or spec-gate friction (“implemented per footprint, but ACs fail”).
   - Suggested fix: Update the path-footprint bullet for `apps/tournament-api/src/services/leaderboard.test.ts` to explicitly say “4 fixtures” and list (a)-(d), aligning it with AC-7 (lines 152–156) and Task 4 (lines 179–185).

2. [medium] Leaderboard ordering is underspecified for tied gross scores, risking UI flicker and nondeterministic tests
   - File: _bmad-output/implementation-artifacts/tournament/T5-5-cross-group-stroke-play-leaderboard-v1.md:127-177
   - Confidence: high
   - Why it matters: Both AC-2 and Task 3 specify sorting by `grossThroughHole ASC NULLS LAST` only (lines 130 and 176). When multiple players have the same gross (including the common “all unscored” case), row order among ties is undefined, so repeated polling can return rows in different orders depending on query planner / join order / insertion order. This can cause leaderboard UI “jumping” and brittle assertions in integration tests that compare arrays.
   - Suggested fix: Specify a deterministic secondary/tertiary sort that does NOT act as a tie-break (rank still shared). Example: `ORDER BY grossThroughHole ASC NULLS LAST, playerName ASC, playerId ASC` (or stable `playerId` only). Mirror the same secondary sort in any in-memory rank assignment if sorting happens after aggregation.

3. [medium] Rank semantics are ambiguous (competition vs dense ranking) and unscored-player rank is not defined when some players have scores
   - File: _bmad-output/implementation-artifacts/tournament/T5-5-cross-group-stroke-play-leaderboard-v1.md:63-156
   - Confidence: high
   - Why it matters: The spec says tied players “share the rank” (lines 65–66, 130–131, 176) but never defines what the next rank should be after a tie (e.g., 1,1,3 “competition ranking” typical in golf vs 1,1,2 “dense ranking”). Also, players with no scored holes must appear with `grossThroughHole=null` (line 174) and are sorted last (line 130), but the rank value for those rows when others *do* have scores is unspecified (and AC-7 only covers the all-null case where rank=1 for everyone). These choices affect UI display (e.g., showing `T-3`) and test determinism.
   - Suggested fix: Add explicit rules:
- Choose ranking scheme (recommend golf-style competition ranking: next rank = previous rank + tiedWith).
- Define rank for `grossThroughHole=null` rows when some players have scores (e.g., all unscored share rank = lastScoredRank + lastScoredTiedWith, or set `rank=null` and adjust UI/typing accordingly). Add/extend a fixture that includes both scored and unscored players to lock behavior.

4. [medium] API scope selection is implicit/unclear: how clients request event-scope vs round-scope is not explicitly specified
   - File: _bmad-output/implementation-artifacts/tournament/T5-5-cross-group-stroke-play-leaderboard-v1.md:90-206
   - Confidence: high
   - Why it matters: The service supports `scope: 'round' | 'event'` (lines 92–100), but the route contract only documents `?round=<roundId | 'current' | omitted>` (lines 137–141, 189–191). The spec does not explicitly state that “omitted round param ⇒ scope='event'” (even though Task 8’s UI includes an ‘All rounds (event)’ option, line 205). Without an explicit mapping, different implementers may invent `round=event` or a separate `scope` query param, causing client/server mismatch.
   - Suggested fix: Make the route rule explicit in AC-4 and Task 5, e.g.:
- If `round` is omitted → `scope='event'`.
- If `round` is a UUID or `current` → `scope='round'` with resolved `roundId` (or `round:null` if zero rounds and `current`).
If you prefer an explicit param, document `?scope=event` and update `fetchEventLeaderboard` + UI accordingly.

5. [medium] TENANT_ID import location remains ambiguous despite ctx-threading requirement
   - File: _bmad-output/implementation-artifacts/tournament/T5-5-cross-group-stroke-play-leaderboard-v1.md:53-221
   - Confidence: high
   - Why it matters: The spec correctly moves tenant scoping into `ctx` and says `TENANT_ID` comes from an existing tournament tenant constant (lines 57–59), but then notes it lives at `apps/tournament-api/src/db/tenant.ts` “(or wherever the existing const is — check T5-6 imports...)” (lines 220–221). That ambiguity invites inconsistent imports/duplicate constants, which is exactly the kind of tenant-scoping footgun this spec is trying to avoid.
   - Suggested fix: Replace the placeholder with a concrete, single source of truth path (the exact file used by T5-6). If it truly varies, add a small Task 0: “Locate canonical TENANT_ID export used by T5-6 and import it; do not create new constants.”

## Strengths

- Tie-break is deferred cleanly and consistently (Section 4, AC-2), with no implementation tasks accidentally reintroducing FR-C5 logic; followup T5-5b is clearly recorded.
- Slope-aware USGA course handicap formula is explicitly specified and scoped to tournament DB data (`course_tees.slope`/`.rating`, `courses.par`) with an explicit ‘port, do not import engine’ instruction (Section 5, Task 2).
- Per-9 rating/slope is clearly deferred to T5-5c with the key warning (‘per-9 is NOT half-of-18’) recorded, reducing the chance a future dev invents incorrect math (lines 49–51, 81–82).
- `round=current` resolution is now deterministic (explicit ordering and zero-rounds behavior) and is testable as written (Section 7, AC-4).
- Edit-path footprint and additions policy are constrained to `apps/tournament-*/**` and the ‘must append before commit’ rule is explicitly stated in the file list section (lines 242–255).

## Warnings

None.
