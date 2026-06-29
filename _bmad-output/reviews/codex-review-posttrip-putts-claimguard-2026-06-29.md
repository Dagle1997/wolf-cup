# Codex Review

- Generated: 2026-06-29T13:25:08.803Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/scores.ts, apps/tournament-api/src/routes/admin-event-rounds.ts, apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx, apps/tournament-web/src/routes/admin.events.$eventId.start-round.tsx

## Summary

Two fixes land the intended behavior (server-side putts enforcement + start-round preflight prompt), but there are a couple of real-money failure modes to harden: (a) start-round may falsely BLOCK if the per-foursome config lookup key doesn’t exactly match how foursome overrides are stored/resolved elsewhere; (b) marking `putts_required` as a terminal offline-queue error can convert previously-queued (old-client) scores into silent data loss when the server begins rejecting them.

Overall risk: high

## Findings

1. [critical] Start-round may falsely BLOCK due to possible mismatch between “pairingId” vs “foursome override” identifier
   - File: apps/tournament-api/src/routes/admin-event-rounds.ts:635-691
   - Confidence: medium
   - Why it matters: `noClaimModifiersForAnyFoursome(eventId, pairingIds)` fetches foursome-level overrides via `gameConfig.level='foursome'` and `gameConfig.refId IN pairingIds` (pairings table PKs) and then resolves configs. If foursome overrides in `game_config` are actually keyed by something else (commonly foursomeNumber, or a composite like eventRoundId:foursomeNumber), this helper will fail to see real per-foursome modifier rules.

In that scenario, the loop resolves *event-level only* for every pairing, sees no enabled modifiers, returns `true`, and the start endpoint returns 422 `no_claim_modifiers` — incorrectly blocking a live round start (high operational risk). This is *not* covered by your “fail open on missing/corrupt config” posture because the config still resolves `ok`; it’s a lookup-key mismatch, not an unresolvable config.
   - Suggested fix: Verify (in code + a test) what `game_config.ref_id` stores for level='foursome'. If it’s not `pairings.id`, change the helper to query by the correct key.

Add an integration test around the start endpoint:
- Create event-level config with modifiers OFF.
- Create 2 pairings.
- Create a foursome override enabling e.g. sandie for pairing #1 using the real storage key.
- Assert start does **not** return `no_claim_modifiers`.

Also consider renaming the param from `pairingIds` to the exact semantic key (e.g. `foursomeConfigRefIds`) to prevent future regressions.

2. [high] Offline queue: treating `putts_required` as terminal risks dropping previously-queued gross scores after server rollout
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:421-434
   - Confidence: medium
   - Why it matters: You register `putts_required` as a terminal error for `hole_score`. Once the API enforces putts for putting_contest participants (scores.ts returns 422), any queued mutations created by:
- older installed PWAs (or any client path that enqueued without `putts`),
- or any transient UI bug where `putts` wasn’t included,
will now be rejected.

If the offline-queue implementation purges terminal entries (or auto-clears them from the retry set without a prominent recovery UI), this is real data loss: the gross score never reaches the server, and the scorer may not notice until much later.

This risk is amplified by the file’s own header comment indicating putts input had previously been removed (suggesting there likely are deployed clients/flows that can enqueue without putts).
   - Suggested fix: Confirm offline-queue behavior for terminal errors:
- If terminal => delete, change strategy: keep the entry in an “errored needs user action” state and surface a blocking banner/modal explaining exactly which player/hole needs putts, with a one-tap deep link to that hole.
- Alternatively, do not mark `putts_required` as terminal for a transition period; instead mark it as non-terminal but stop retry loops by switching to an explicit “paused until edited” state.

Add an end-to-end test (or at least a unit test for offline-queue) asserting that a terminal `putts_required` does not silently discard the payload without user visibility.

3. [medium] Client save gating checks putts non-empty but not numeric/range; can still enqueue invalid bodies that become terminal (`invalid_body`)
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:1382-1392
   - Confidence: medium
   - Why it matters: `puttsComplete` only requires `currentPutts[playerId]` be non-null and non-empty for putting-game players. If `currentPutts` can contain non-numeric strings (paste, autofill, locale input), the Save gate will allow enqueue; the API will reject via Zod (`invalid_body`), and you already treat `invalid_body` as terminal for `hole_score`. That’s another potential silent loss scenario under offline use.
   - Suggested fix: Validate putts client-side similarly to gross strokes (regex + bounds): e.g. `/^([0-9]|1[0-5])$/` and/or parseInt with explicit range checks. Consider normalizing empty string => null and numeric strings => number before enqueue so the JSON payload matches the API schema.

4. [low] Score-entry route header comment appears inconsistent with reintroduced putts requirement (maintenance hazard)
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:12-15
   - Confidence: high
   - Why it matters: The file header states the putts input was removed and the UI doesn’t capture new putts. This is now in tension with the new “putts required when putting game active” behavior and can mislead future changes/reviews (especially in a money app where requirements shift quickly). Misleading comments are a common source of regressions.
   - Suggested fix: Update the header comment to reflect the current behavior: putts input is conditionally present/required for `putting_contest` participants and enforced server-side.

## Strengths

- Server-side enforcement of putts-required is correctly inside the score-write transaction and treats `putts=0` as valid (scores.ts:546-581).
- Start-round guard is explicitly confirmable (not a hard block) and designed to fail-open on config corruption/unresolvable resolution (admin-event-rounds.ts:631-633).
- The organizer UI handles the new 422 `no_claim_modifiers` with a clear confirmation path that sends `confirmNoModifiers:true` (admin.events.$eventId.start-round.tsx:151-158, 303-312).

## Warnings

- Truncated file content for review: apps/tournament-api/src/routes/scores.ts
- Truncated file content for review: apps/tournament-api/src/routes/admin-event-rounds.ts
- Truncated file content for review: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx
