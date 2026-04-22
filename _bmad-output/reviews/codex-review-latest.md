# Codex Review

- Generated: 2026-04-22T15:42:23.511Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/api/src/routes/pairings.ts, apps/api/src/routes/pairings.test.ts, apps/web/src/routes/pairings.$roundId.tsx, _bmad-output/implementation-artifacts/tech-spec-ctp-per-par3-prompt.md

## Summary

PART 1: API + web implementation largely meets acceptance criteria (null-safe parse, preserved 404, conditional render). Main gap is deterministic selection when multiple side games match, plus a couple of edge cases not covered by tests.

PART 2: Spec is directionally complete but has several “will break before first shipped CTP round” design holes: resolving winners by server `updated_at` is vulnerable to offline/backfill reordering, admin override/clobber semantics don’t map cleanly from the legacy single-winner endpoint to per-hole winners, and inserting multiple `side_game_results` rows per round risks breaking existing downstream code that assumes 0/1 result per side game per round unless fully audited/updated.

Overall risk: high

## Findings

1. [high] [PART 2] “Current winner” resolution by MAX(server updated_at) is not robust with offline queue/backfill; can produce incorrect current winners
   - File: _bmad-output/implementation-artifacts/tech-spec-ctp-per-par3-prompt.md:106-110
   - Confidence: high
   - Why it matters: The spec defines current winner as `MAX(updated_at)` across groups (lines 106-108) and reiterates this in GET semantics (lines 210-211). With offline queueing, `updated_at` will reflect *sync time*, not “when the group actually played/entered the hole”. A group that played earlier but syncs later (or a device that was offline) can incorrectly become the “current winner”, overriding a later group’s legitimate update. This is especially likely under the spec’s own offline requirements (lines 124-125, 281-282) and the tight first-week pressure mentioned in Risks (lines 358-360).
   - Suggested fix: Define and store an ordering key that represents the intended real-world precedence. Options:
- Store `client_recorded_at` (ms since epoch) from the device and use that for ordering, with server-side validation/sanity bounds.
- Better: derive an “effective time” from the score submission event for that hole (e.g., `hole_completed_at` captured server-side when the 4th score is recorded) and require the CTP entry to include/attach to that completion.
- Or: add a monotonic `version`/`sequence` per (round,hole) generated server-side (e.g., via transaction that increments) and return it to clients.
Also specify how to handle offline late-arriving entries (ignore if older than current winner? allow overwrite but mark as stale?).

2. [high] [PART 2] Admin override (“clobber per-par-3 entries”) is underspecified and mismatched to legacy single-winner endpoint; high risk of wrong display/finalization
   - File: _bmad-output/implementation-artifacts/tech-spec-ctp-per-par3-prompt.md:67-112
   - Confidence: high
   - Why it matters: The spec says to keep the existing `POST /rounds/:roundId/side-game-results` for CTP and that admin-entered entries “clobber group entries for display” (lines 67-68, 111-112). But CTP is changing from one winner to up to four winners (one per par 3) (lines 62-63, 279-280). Without a precise rule, it’s unclear:
- Does admin override apply per-hole or whole-round?
- How does the legacy endpoint represent multiple holes (multiple rows with `notes="Hole N"`? a special payload?)
- Does override suppress prompts/writes, or just change what leaderboard/finalize reads?
This ambiguity can easily ship a CTP week where the leaderboard shows inconsistent data or finalize writes the wrong summary rows.
   - Suggested fix: Specify clobber semantics concretely:
- Define the canonical “authoritative source of truth” for display and finalization (e.g., if any admin CTP results exist for round, ignore `side_game_ctp_entries` entirely).
- Define the shape of admin override for multi-hole: either (a) admin creates 0–4 `side_game_results` rows with `notes` = `Hole N` (and the UI reads those), or (b) create a dedicated admin endpoint for per-hole overrides.
- State whether group POSTs are still accepted when admin override is present and whether they affect anything.
Add acceptance criteria + tests for override precedence to prevent regressions.

3. [high] [PART 2] Writing multiple CTP rows into side_game_results per round can break existing consumers that assume 0/1 row per (round, sideGame) unless fully audited
   - File: _bmad-output/implementation-artifacts/tech-spec-ctp-per-par3-prompt.md:62-121
   - Confidence: medium
   - Why it matters: The spec explicitly changes `side_game_results` cardinality for CTP: “one row per par 3 winner” (lines 62-63, 112-120, 279-280). Many systems commonly assume a single winner per side game per round (rendering, history, stats aggregation, uniqueness constraints, etc.). The spec only calls out updating `computeAllAwards` for Side Game Champion dedupe (lines 89-90, 120-121, 311-312), but other endpoints/pages (history, leaderboard finalized banner, admin views) may double-count or display duplicate winners unless they’re updated intentionally. This is a classic “silent data shape change” risk that can break the first shipped CTP round.
   - Suggested fix: Before implementation, enumerate and update every consumer of `side_game_results` with explicit intended behavior for multi-row CTP:
- Finalized banner rendering: group rows by notes/hole.
- Any “winner per round per side game” assumptions: either special-case CTP or adjust queries.
- Add regression tests around endpoints that read side_game_results (history, stats, leaderboard finalized state) to ensure they don’t double-count or crash.
If this audit is too big for Apr 24, consider an alternative: keep a single round-level CTP “winner” row for legacy paths, and store per-hole winners only in the new table + new CTP UI, then derive Par 3 Champion stats from the new table (or from dedicated CTP summary table) instead of changing side_game_results semantics.

4. [medium] [PART 1] “If multiple match, return the first” is currently non-deterministic because side games query has no ORDER BY
   - File: apps/api/src/routes/pairings.ts:52-71
   - Confidence: high
   - Why it matters: Acceptance criteria says if multiple `side_games` rows match, return the first. The implementation loads all matching season side games (line 52-60) and uses `.find(...)` (line 61-68) without any ordering clause. SQLite/Drizzle result ordering without `ORDER BY` is not guaranteed; which row is “first” can vary (especially after deletes/vacuum/migrations), producing confusing/unstable side game display.
   - Suggested fix: Make “first” deterministic. For example:
- Add `.orderBy(sideGames.createdAt)` or `.orderBy(sideGames.id)` to the query, then `.find`.
- Or push filtering into SQL and `.limit(1)` (still needs a deterministic ORDER BY).
Also add a test with two matching side games to lock the chosen precedence.

5. [medium] [PART 1] scheduledRoundIds matching may fail if the JSON contains string IDs (e.g., ["12"]) rather than numbers
   - File: apps/api/src/routes/pairings.ts:61-67
   - Confidence: medium
   - Why it matters: The code parses JSON and then checks `ids.includes(round.id)` (line 64). If historical data (or admin tooling) ever wrote IDs as strings, this will silently return `sideGame: null` even when the round is scheduled. The acceptance criteria is “JSON array contains round.id” (value-level match), but real-world JSON often drifts into strings.
   - Suggested fix: Normalize parsed values to numbers before checking, e.g. `const ids = parsed.map(Number).filter(Number.isFinite)` when `Array.isArray(parsed)`. Add a test case with `scheduledRoundIds: JSON.stringify([String(roundId)])`.

6. [medium] [PART 2] Unique index for side_game_ctp_entries ignores tenant/context; can collide across tenants if those columns are truly meaningful
   - File: _bmad-output/implementation-artifacts/tech-spec-ctp-per-par3-prompt.md:132-152
   - Confidence: medium
   - Why it matters: Schema includes `context_id` and `tenant_id` (lines 141-142) but the unique index is only `(round_id, group_id, hole_number)` (lines 147-149). If the database is intended to be multi-tenant/multi-context (the spec references an “ecosystem-identity foundation”), uniqueness and query patterns should include tenant/context to prevent cross-tenant collisions and to keep indexes selective.
   - Suggested fix: If multi-tenant is real: include `(tenant_id, context_id, round_id, group_id, hole_number)` in the unique index (and adjust FKs/queries accordingly), plus add secondary indexes that match your read patterns. If it’s not real (single-tenant DB), remove tenant/context columns from this table to avoid a false sense of isolation.

7. [medium] [PART 2] Prompt trigger hard-codes “all 4 players” which can fail for non-4-sized groups (subs/absences)
   - File: _bmad-output/implementation-artifacts/tech-spec-ctp-per-par3-prompt.md:59-110
   - Confidence: medium
   - Why it matters: The spec repeatedly asserts the prompt fires when “all 4 players” have a score (lines 59-60, 109-110) and shows sample code `scoresForHole.length === 4` (lines 243-253). If a group has 3 players (no-show) or 5 (unlikely but possible), the prompt may never fire or may fire too early. That becomes a functional failure on CTP weeks.
   - Suggested fix: Define the trigger as “all players in the group roster for that round/group have a score for that hole” (i.e., compare against group size from roundPlayers/group membership), not a constant 4. Add acceptance/test coverage for a 3-player group scenario if the product allows it.

8. [low] [PART 1] Tests don’t cover the “multiple matching side games” rule and therefore won’t catch nondeterministic selection regressions
   - File: apps/api/src/routes/pairings.test.ts:95-167
   - Confidence: high
   - Why it matters: Your test suite covers: no side games, included, not included, malformed JSON, null JSON, and unknown round. It does not cover acceptance criterion #2’s “If multiple match, return the first.” Without a test, future data/order changes could flip which side game is displayed with no signal.
   - Suggested fix: Add a test inserting two side games that both include `roundId` (with different createdAt/id), then assert the expected one is returned based on the chosen deterministic ordering.

9. [low] [PART 1] Public pairings endpoint now exposes sideGame.calculationType; confirm this is acceptable and stable for clients
   - File: apps/api/src/routes/pairings.ts:52-101
   - Confidence: medium
   - Why it matters: The endpoint is explicitly public. Returning `calculationType` likely isn’t sensitive, but it is a new public contract surface. If you later add internal-only calculation types, clients (or curious users) could infer more than intended. Also, the web UI currently doesn’t use `calculationType`, so this is primarily an API contract change.
   - Suggested fix: If acceptable, keep as-is. If not, either omit it from the public response, or constrain it to a known safe enum and document it. Consider adding an API test assertion that only `{name, format, calculationType}` is returned (no scheduledRoundIds, seasonId, etc.) to prevent accidental data expansion.

## Strengths

- PART 1: scheduledRoundIds parsing is defensively wrapped in try/catch and defaults null/invalid/malformed to non-match (apps/api/src/routes/pairings.ts:61-68), meeting the “never 500” requirement for malformed JSON.
- PART 1: Unknown-round 404 behavior is preserved and explicitly tested (apps/api/src/routes/pairings.ts:28-30; apps/api/src/routes/pairings.test.ts:162-165).
- PART 1: Web render is null-safe (`{sideGame && (...)}`) and silent when null (apps/web/src/routes/pairings.$roundId.tsx:156-162).
- PART 1: API response limits exposure to name/format/calculationType and does not leak scheduledRoundIds (apps/api/src/routes/pairings.ts:52-58, 69-71).
- PART 2: Spec explicitly distinguishes “no one” (row with NULL winner) from “not answered” (row absent), which is a strong modeling choice for UI correctness (tech spec lines 108-109, 155-156).

## Warnings

None.
