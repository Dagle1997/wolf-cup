# Codex Review

- Generated: 2026-04-22T18:16:48.900Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/api/src/routes/history.ts, apps/api/src/routes/history.test.ts

## Summary

PASS — ready to commit and proceed to step 9.

A) Round-3 items:
1) (Med) “Unknown name locked across rounds” is addressed for the new CTP-derived credits path: when a `winCountMap` entry already exists, you now upgrade `existing.playerName` from `'Unknown'` to a non-`'Unknown'` name if later-processed CTP data has better info (apps/api/src/routes/history.ts:205-212). This closes the specific regression described.
2) (Low) The previously-vacuous unfinalized-round test is now concrete: it asserts `side_game_champion` exists and verifies year 2061 does not appear in any recipient’s `years` (apps/api/src/routes/history.test.ts:283-291). That closes the issue.

B) New issues from the winCountMap “upgrade” logic:
- No concrete new bugs evident in the diff. The upgrade is intentionally narrow (only upgrades `'Unknown'` → real name), and because CTP rows prefer `players.name` via `livePlayerName ?? winnerName`, the displayed name will generally stabilize to the current canonical player name (apps/api/src/routes/history.ts:178-180, 209-211).
- If a player’s display name changes mid-season, this implementation will *not* attempt to reconcile non-`Unknown` variants (it will typically show the current `players.name` if the player record exists). Given your stated intent (“stabilization is the point”), this behavior is consistent/acceptable.

C) Overall:
- The added tests cover the key acceptance criteria: per-round unique-winner crediting, finalized-round gating, and ignoring/missing per-entry `finalizedAt` (apps/api/src/routes/history.test.ts:173-349).
- No additional blocking issues found in the provided changes.

Overall risk: low

## Findings

No concrete findings were identified from the supplied evidence.

## Strengths

- CTP crediting is correctly gated on `rounds.status = 'finalized'`, matching the stated authoritative finalization source and supporting legacy rows with null `finalizedAt` (apps/api/src/routes/history.ts:143-147, 165).
- Per-round uniqueness is implemented explicitly (Map of playerId→name per round) and aligns with AC #14 (apps/api/src/routes/history.ts:188-213).
- Tests now assert meaningful behavior rather than implicitly passing when the award isn’t present (apps/api/src/routes/history.test.ts:283-291).

## Warnings

None.
