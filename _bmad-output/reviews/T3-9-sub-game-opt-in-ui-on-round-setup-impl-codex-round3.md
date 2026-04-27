# Codex Review

- Generated: 2026-04-27T19:36:37.644Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.tsx, apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.test.tsx

## Summary

Round-2 logic looks consistent with the requested scenario matrix: isDirty is now pure server-vs-draft content equality for skins, and the mutation will serialize a skins entry whenever draft has content OR the server originally had a skins row (including an empty one). One gap: the new test does not actually exercise the specific serverHadSkins-only branch that fixed the original footgun.

Overall risk: medium

## Findings

1. [medium] New “empty skins server-state” test does not validate the serverHadSkins-only preservation branch
   - File: apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.test.tsx:203-259
   - Confidence: high
   - Why it matters: The fix hinges on: when the server had a skins row AND the draft is empty, the POST must still include a skins entry (so a POST triggered for other reasons can’t delete the skins row via delete-then-insert semantics). The added test toggles Alice before saving (lines 241-246), which makes `draftHasContent` true; in that case the POST would include skins even if `serverHadSkins` logic were removed/regressed. So the test doesn’t protect the specific bug that was fixed.
   - Suggested fix: Add a test that hits `draftHasContent === false && serverHadSkins === true` while still allowing a save:
- Start with server skins NON-empty (participants and/or buy-in).
- User clears buy-in to '' and unchecks all participants.
- Save (isDirty should be true).
- Assert POST body still contains a `skins` entry with `buyInPerParticipant: 0` and `participantPlayerIds: []` (i.e., not omitted).

2. [low] serverHadSkins forces sending skins entry even when user clears all content; may prevent “deleting/disabling” skins config
   - File: apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.tsx:189-221
   - Confidence: medium
   - Why it matters: With `if (draftHasContent || serverHadSkins)` (line 215), once the server has ever had a skins row, the client will never send an empty `subGames: []` payload for skins—even if the user intentionally clears all participants and buy-in. If backend interprets “no skins row” as disabled, this UI can’t express that state anymore (it will preserve an empty row instead).
   - Suggested fix: If “disable/delete skins” is a supported state, add an explicit UI control (e.g., enable checkbox) and drive serialization from that, or change the gate to preserve-empty only when draft equals server-empty (to prevent accidental deletion) while still allowing intentional deletion via an explicit action.

## Strengths

- Scenario matrix checks out with current code: isDirty compares cents + participant set equality for skins only (apps/...sub-games.tsx:172-185), so all five listed cases behave as expected for enabling/disabling the Save button.
- serverHadSkins is derived from server data (apps/...sub-games.tsx:189) and used to ensure skins entry is included in POST even when draft is empty, addressing the earlier delete-then-insert omission risk (apps/...sub-games.tsx:207-221).
- AbortController cleanup on unmount and per-mutation tracking is sound (apps/...sub-games.tsx:121-128, 196-247).

## Warnings

None.
