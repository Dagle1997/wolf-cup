# Codex Review

- Generated: 2026-06-29T13:50:21.757Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/scores.ts, apps/tournament-api/src/routes/admin-event-rounds.ts, apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx, apps/tournament-web/src/routes/admin.events.$eventId.start-round.tsx

## Summary

Changes match the stated goals: the score POST path no longer rejects missing putts (so gross always persists), and the web Save gate now enforces putts more strictly (0–15) for putting-game participants. The start-round claim-modifier guard appears intact and consistent with pairing.id as the foursome refId.

One concrete issue remains in the Start Round UI: prompt state isn’t cleared between attempts, so an earlier `no_game_config` prompt can mask the newer `no_claim_modifiers` prompt (and can keep the UI stuck in the wrong confirmation surface) until the organizer manually cancels it.

Overall risk: medium

## Findings

1. [medium] Start-round UI can get stuck showing the wrong preflight prompt (stale noGamePrompt masks noClaimModifiersPrompt)
   - File: apps/tournament-web/src/routes/admin.events.$eventId.start-round.tsx:112-171
   - Confidence: high
   - Why it matters: `start()` does not clear `noGamePrompt` / `noModifiersPrompt` at the beginning of a new attempt, and the render chooses `noGamePrompt` first. If an organizer previously hit `422 no_game_config` and then later hits `422 no_claim_modifiers`, the code sets `noModifiersPrompt` but leaves `noGamePrompt` in place, so the UI keeps rendering the no-game prompt instead of the no-modifiers prompt. This can hide the intended warning and/or block access to the normal “Start round” confirmation until the organizer manually cancels the stale prompt. In a money-critical flow (pinning rules at start), hiding the correct preflight warning increases the chance of starting under unintended conditions.
   - Suggested fix: In `start()`, clear both prompts before issuing the request (e.g. `setNoGamePrompt(null); setNoModifiersPrompt(null);`). Also, when handling one 422 code, explicitly clear the other prompt to avoid masking (e.g. in the `no_game_config` branch set `setNoModifiersPrompt(null)` and vice versa).

2. [low] Web putts gate validates a string regex; ensure request payload still sends numeric putts to match API Zod schema
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:1382-1392
   - Confidence: medium
   - Why it matters: The Save gate now checks putts via regex on `currentPutts[...]`, implying the source value may be stringly. The API schema requires `putts` to be a number (`z.number().int().min(0).max(15).nullable().optional()` in `scores.ts`). If the enqueue/POST layer passes the raw string instead of converting to a number, the server will 400 `invalid_body` and the queue treats `invalid_body` as terminal for `hole_score`, causing score loss. The diff doesn’t show the enqueue code path, so this is a targeted risk to verify.
   - Suggested fix: Verify the mutation body builder converts putts with `Number(...)`/`parseInt` before enqueueing/POSTing (and uses `null`/`undefined` appropriately). Add/adjust a test that posts a score with putts and asserts the server accepts it and persists the numeric value.

## Strengths

- Server-side score write path no longer rejects a valid gross due to missing putts (removes the prior queued-write terminal-drop risk).
- UI Save gate now enforces putts as a bounded numeric (0–15) rather than merely non-empty, and provides a clearer save hint when gross is complete but putts are missing.
- `noClaimModifiersForAnyFoursome` is fail-open on config anomalies, reducing the chance of blocking starts for unrelated config corruption, while still catching the “bonuses disabled everywhere” case.

## Warnings

- Truncated file content for review: apps/tournament-api/src/routes/scores.ts
- Truncated file content for review: apps/tournament-api/src/routes/admin-event-rounds.ts
- Truncated file content for review: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx
