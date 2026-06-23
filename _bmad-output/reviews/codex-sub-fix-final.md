# Codex Review

- Generated: 2026-06-23T02:10:28.304Z
- Model: gpt-5.5
- Reasoning effort: high
- Workspace root: D:\Wolf-cup
- Reviewed files: apps/api/src/lib/sub-status.ts, apps/api/src/routes/admin/rounds.ts, apps/api/src/routes/admin/roster.ts, apps/api/src/routes/admin/attendance.ts, apps/api/src/routes/rounds.ts, apps/api/src/routes/standings.ts

## Summary

The visible future-write changes move in the right direction, especially the badge-wins manual add logic. However, the standings leak is not fully closed by the provided code: existing bad official round_players rows remain decisive, and the admin per-round toggle can still create the same bad condition on official rounds. I also found a data-integrity risk in the add-sub flow now that it mutates players.status. Note: apps/api/src/routes/admin/rounds.ts and apps/api/src/routes/rounds.ts are truncated in the supplied content, so I could not evidence-review the unseen from-attendance, swap/replace, or public add implementations.

Overall risk: high

## Findings

1. [high] Existing leaked official rows are not repaired, so one old is_sub=0 keeps a sub in full standings
   - File: apps/api/src/routes/standings.ts:162-167
   - Confidence: high
   - Why it matters: The fix changes future write paths, but standings still classifies a player as a full member if any persisted official round_players row has isSub false. The reported bug already created exactly those bad rows for roster subs. Because line 166 uses any false row, one historical leaked official row will keep that player in fullMembers for the season even after all future rows are written correctly.
   - Suggested fix: Add an explicit data repair/migration for affected official round_players rows, and add a regression test that seeds a status='sub' player with an existing official is_sub=0 row and verifies they do not appear in fullMembers after the fix. If current players.status is not safe enough to backfill all history, repair by affected season/player list or another auditable historical source.

2. [medium] Per-round sub toggle can still promote a roster sub/inactive player into official full standings
   - File: apps/api/src/routes/admin/roster.ts:467-481
   - Confidence: high
   - Why it matters: This endpoint accepts the request body isSub and writes it directly to roundPlayers without checking the player's roster status or the round type. For an official round, setting isSub=false for a players.status='sub' or 'inactive' player creates the same condition standings uses to classify them as a full member. If this is truly an intentional admin escape hatch, it is an accepted invariant break; otherwise the badge-as-source-of-truth rule is still bypassable.
   - Suggested fix: For official rounds, either reject isSub=false unless players.status is 'active', or update the roster status to 'active' in the same transaction when an admin intentionally promotes someone. Alternatively restrict this override to casual/non-standings rounds and keep a separate audited override if needed.

3. [medium] Add-sub flow can leave players.status='sub' after later bench/attendance failures
   - File: apps/api/src/routes/admin/attendance.ts:390-420
   - Confidence: high
   - Why it matters: For an existing player, the endpoint updates players.status to 'sub' before the sub_bench and attendance writes, and the sequence is not wrapped in a transaction. If a later write fails, the request returns 500 but the player can remain stamped as a sub, which now affects future official round_players.is_sub because players.status is the source of truth. The endpoint also does not validate that seasonWeekId belongs to the URL season before writing sub_bench for one season and attendance for the supplied week.
   - Suggested fix: Validate the season and seasonWeekId relationship up front, then wrap player create/update, sub_bench upsert, and attendance upsert in a single transaction so failures roll back the roster badge change.

## Strengths

- The central isSubFromStatus helper makes the intended roster-badge rule explicit and defensively treats non-active/unknown statuses as subs.
- The visible manual add path correctly makes the roster badge win: a request body can mark an active player as a sub but cannot clear sub status for a non-active player.
- The roster PATCH badge-to-sub_bench sync runs inside the same transaction as the player status update.
- Using lte(startDate, today) with descending startDate in roster sync addresses the specific future-season-stealing-current-season case described in the request.

## Warnings

- Truncated file content for review: apps/api/src/routes/admin/rounds.ts
- Truncated file content for review: apps/api/src/routes/rounds.ts
