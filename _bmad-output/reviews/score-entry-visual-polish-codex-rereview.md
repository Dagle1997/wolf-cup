# Codex Review

- Generated: 2026-06-23T19:14:22.832Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx

## Summary

The prior High-risk putts data-loss regression (re-saving a hole overwriting existing putts to null) is resolved in this diff: handleSave now preserves the existing server-provided `putts` value for each (player, hole) cell by reading it from `data.myFoursome.holeScores` instead of defaulting to null. No new High issues are introduced by the shown changes, but there remains a smaller integrity edge-case if the client’s `holeScores` snapshot is stale relative to the server (concurrent updates).

Overall risk: low

## Findings

1. [medium] Putts preservation still depends on the freshness of `data.myFoursome.holeScores` (concurrent-update edge case)
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:1381-1442
   - Confidence: medium
   - Why it matters: The new logic correctly prevents the *deterministic* deletion bug (writing `putts: null` on every save), but it does not strictly guarantee “never delete existing putting data” under concurrency. If another client/system updates putts on the server after this client’s last round-detail fetch, and this client re-saves the score before the next poll/refetch updates `data.myFoursome.holeScores`, this code will send the stale `putts` value (possibly null) and could overwrite the newer server value. This is a last-write-wins data integrity risk rather than the prior guaranteed data loss, but it’s still worth calling out.
   - Suggested fix: If the API supports it, omit `putts` from the mutation body entirely when the UI doesn’t edit putts (patch semantics), or add server-side merge rules: treat missing/undefined `putts` as “no change” and only overwrite when explicitly provided. If neither is possible, consider fetching latest holeScores (or using an etag/version) before saving in high-contention contexts.

## Strengths

- Fix directly addresses the previous High: save no longer unconditionally writes `putts: null`; it reuses the existing server value per cell via `holeScores.find(... )?.putts ?? null` (diff hunk around @@ -1392).
- Removal of `currentPutts` state and its reset reduces the risk of stale local putts state and eliminates now-dead input handling (diff hunks around @@ -1190 and @@ -1221).
- `handleSave` dependency list was updated to include `data.myFoursome.holeScores`, reducing stale-closure risk for the new preservation behavior (diff hunk around @@ -1447).
- UI-only card layout changes are structurally safe (stable `key={member.playerId}` preserved; score input ref assignment remains intact).

## Warnings

- Truncated file content for review: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx
