# Codex Review

- Generated: 2026-04-27T19:33:35.947Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/admin-event-rounds.ts, apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.tsx, apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.test.tsx

## Summary

Round-1 tenant scoping fix on GET roster JOIN holds (players.tenantId is now filtered). Round-1 Save-button idle disabling generally holds for the common case (server has non-empty skins config), but the new isDirty “server has skins row, draft is empty” edge-case creates a semantic mismatch with the save payload logic and can re-enable Save on initial render for an “empty-but-present” server row.

Overall risk: medium

## Findings

1. [medium] Frontend cannot persist an "empty skins entry" despite comment; combined with isDirty edge-case it can enable Save on idle and clear server config
   - File: apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.tsx:167-227
   - Confidence: high
   - Why it matters: Two pieces conflict:
- isDirty intentionally treats (server has a skins row) + (draft is empty) as dirty because a save would clear the existing config (lines 183-193).
- But the mutation *skips emitting* the skins entry when draft is empty (lines 218-227), meaning any save with an empty draft will POST `{ subGames: [] }` and the backend will DELETE existing rows (DELETE-then-INSERT), clearing even an existing "empty" skins row.
This creates an odd UX/state model: if the server stores a skins row with buy-in=0 and no participants, the UI prepopulates to empty (buyInDollars '' + empty set), yet `isDirty` returns true (lines 187-193), enabling Save on first render. Clicking Save would clear the row (a destructive change) even though the user made no edits. It also contradicts the comment claiming "Empty entry is allowed ... commit skins as enabled with no participants yet" (lines 215-217), which is currently not possible with the skip-emit logic.
   - Suggested fix: Pick one consistent semantic:
1) If an empty skins row is a meaningful persisted state (“enabled but empty”), then always emit it (send `{type:'skins', buyInPerParticipant:0, participantPlayerIds:[]}`) when skins is enabled, and adjust isDirty to treat server-empty == draft-empty as not dirty.
2) If an empty row should be treated as equivalent to “disabled/not configured”, then remove/adjust the isDirty edge-case (lines 183-193) and fix the misleading comment (lines 215-217). Also consider adding an explicit UI affordance for "clear/disable skins" instead of using empty payload as an implicit clear.

2. [low] Test coverage doesn’t pin the new isDirty edge-case (server has skins row but empty)
   - File: apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.test.tsx:203-267
   - Confidence: high
   - Why it matters: You added a test for idle render with a non-empty server skins config (buy-in 500 + 2 participants), which validates the common path. But the newly-added isDirty edge-case is exactly about a server skins row existing while the draft is “empty”. That scenario isn’t covered, and it’s where the current implementation can enable Save on initial render and clear config on save (see finding above).
   - Suggested fix: Add a test where GET returns `subGames: [{type:'skins', buyInPerParticipant:0, participantPlayerIds:[]}]` and assert the intended behavior (likely Save disabled on idle; and/or that saving does not clear unless user explicitly clears).

## Strengths

- API GET roster JOIN is now tenant-scoped on both groupMembers.tenantId and players.tenantId (admin-event-rounds.ts:130-135), closing the stated gap.
- Save button now correctly gates on `saveMutation.isPending || !isDirty` and the new test pins the expected behavior for the common prepopulated non-empty config case (sub-games.test.tsx:203-236).

## Warnings

None.
