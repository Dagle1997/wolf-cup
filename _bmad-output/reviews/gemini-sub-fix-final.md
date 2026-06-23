# Gemini Review

- Generated: 2026-06-23T02:12:44.683Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\Wolf-cup
- Reviewed files: apps/api/src/lib/sub-status.ts, apps/api/src/routes/admin/rounds.ts, apps/api/src/routes/admin/roster.ts, apps/api/src/routes/admin/attendance.ts, apps/api/src/routes/rounds.ts, apps/api/src/routes/standings.ts

## Summary

The migration to use the roster badge (`players.status`) as the single source of truth for sub status correctly patches the primary round creation paths. However, the standings leak remains exploitable because the manual per-round toggle bypasses this source of truth, allowing an admin to unknowingly promote a sub to a full member for the entire season. Additionally, legacy `isActive` request mappings and preseason roster updates present significant data corruption and data loss risks.

Overall risk: high

## Findings

1. [high] Manual per-round sub toggle bypasses badge-wins rule, preserving the standings leak
   - File: apps/api/src/routes/admin/roster.ts:467-477
   - Confidence: high
   - Why it matters: The `PATCH /rounds/:roundId/players/:playerId/sub` endpoint explicitly sets `is_sub` to `0` based entirely on the request body, bypassing `isSubFromStatus()`. Because `standings.ts` promotes a player to a full member if *any* of their official rounds has `is_sub=0`, an admin temporarily toggling a sub to "not a sub" for a single round will permanently leak them into the full member season standings.
   - Suggested fix: Enforce the badge status in this endpoint (e.g., `const forcedSub = isSubFromStatus(player.status) || isSub;`) or block the action (`422 Unprocessable Entity`) if attempting to un-sub a rostered sub. If single-round promotions are intended without affecting the season, `standings.ts` must be updated to check `players.status` instead of `round_players.is_sub`.

2. [high] Legacy isActive mapping silently clobbers Sub status
   - File: apps/api/src/routes/admin/roster.ts:173-177
   - Confidence: high
   - Why it matters: When updating a player, if the client omits `status` but sends `isActive: 1` (common in legacy UI forms), the endpoint explicitly overrides the player's status to `'active'`. Because subs also have `isActive = 1` in the database, a benign update (like changing a sub's GHIN number) will silently overwrite their badge and promote them to a full active member.
   - Suggested fix: Fetch `existing.status` before applying updates. Only map `isActive: 1` to `status = 'active'` if the existing status is currently `'inactive'`. Better yet, drop the legacy `isActive` mapping entirely if `status` is now the definitive source of truth.

3. [medium] Roster sub-bench sync logic uses UTC dates and breaks preseason administration
   - File: apps/api/src/routes/admin/roster.ts:200-206
   - Confidence: high
   - Why it matters: The `lte(seasons.startDate, today)` filter successfully guards against future seasons stealing syncs, but it completely breaks off-season/preseason setup. Roster changes made before a new season's `startDate` will erroneously write to the *previous* finalized season's bench, hiding new subs from the upcoming season's attendance UI. Furthermore, `toISOString()` returns UTC time, causing the season boundary to flip prematurely in US time zones.
   - Suggested fix: To support preseason setup, consider syncing the bench to all non-finalized seasons (or the most recently created season `orderBy(desc(id))`). Alternatively, eliminate the `subBench` table entirely and construct attendance UI strictly using `players.status === 'sub'`.

4. [medium] Add Sub attendance endpoint can silently demote active full members
   - File: apps/api/src/routes/admin/attendance.ts:393-396
   - Confidence: high
   - Why it matters: If an admin uses `POST /seasons/:seasonId/subs` and inputs the GHIN number of a player who is already an active full member, the endpoint unconditionally overwrites their status to `'sub'`. This silently demotes the full member and alters their standings classification.
   - Suggested fix: Check if the existing player found by GHIN is already `status === 'active'`. If so, either return a `409 Conflict` to alert the admin, or add them to the week's attendance without mutating their global roster status.

## Strengths

- Centralizes sub-status derivation successfully via `isSubFromStatus` for the main round creation workflows.
- Standings calculation dynamically maps players based on transactional DB state rather than brittle hardcoded lookups.
- Good transaction hygiene across group modifications and round finalization logic.
- Casual round segregation robustly isolates public/guest 'is_sub=0' records from affecting official standings calculations.

## Warnings

- Truncated file content for review: apps/api/src/routes/admin/rounds.ts
- Truncated file content for review: apps/api/src/routes/rounds.ts
