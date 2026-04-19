# Codex Findings - T8

## [High] Activity events do not consistently carry the event identity needed for insertion
T8.1 makes `activity.event_id` NOT NULL and has `emitActivity(tx, event)` insert `event_id`, but the story never actually makes `eventId` a required field on every `ActivityEvent` variant. The example `score.committed` payload omits it, and `install_prompt.shown` is currently emitted from `POST /api/players/me/install-prompt-shown`, which is player-scoped rather than event-scoped. As written, this is not implementable without hidden lookup rules. Recommended fix: define a common base shape for all activity events with `eventId` required, and either (a) move install-prompt stamping to an event-scoped route like `/api/events/:eventId/players/me/install-prompt-shown`, or (b) keep `install_prompt.shown` as audit-only and remove it from the activity spine.

## [High] The activity API cannot support both live polling and historical feed pagination, and it can drop burst events
T8.2 defines only `GET /api/events/:eventId/activity?since={iso}` with `created_at > since`, ordered DESC, max 100 rows. That works for live polling, but T8.3 also requires a `Load more` button for older history, which cannot be implemented from a newer-than cursor. There is also a storm-case bug: if more than 100 new activities arrive between polls, older fresh events are skipped forever once the client advances `since` to the newest page. Recommended fix: separate the API into `after`/`since` for live polling and `before` (or a stable cursor) for backfill/history, and add a test that simulates >100 fresh rows landing between polls.

## [High] `skins_pot_streak` is not derivable at score-commit time from the currently locked T6 shape
T8.4 says awards run inside the T5.6 score-commit transaction and detect `skins_pot_streak` from the latest skins sub-game result. But the committed T6 shape makes skins authoritative on finalize/manual compute via `sub_game_results`; there is no live per-hole skins result guaranteed to exist during score commit. That makes this award either stale or unavailable at the moment it is supposed to fire. The generic idempotency rule in the story also checks only `awardType`, which would incorrectly suppress later legitimate streak awards if v1 allows more than one streak in an event. Recommended fix: either defer `skins_pot_streak` out of v1, or add an explicit live interim skins recompute path on hole-complete and define an award-specific idempotency key such as `(eventId, awardType, roundId, playerId, streakStartHole)`.

## [Medium] Several activity payloads are too abstract for the consumers T8 already specifies
The story-level abstraction is fine for many event types, but T8.2 and T8.3 already rely on fields that are not actually committed anywhere in T8.1. Example: toast eligibility for `score.committed if birdie-or-better` is not derivable from the example payload unless the event carries `par`, `toPar`, or a precomputed `isBirdieOrBetter` flag. The feed also requires inline prior/new values for `score.corrected`, and meaningful route targets for `press.*`, `bet.flipped`, and `lead.changed`. Recommended fix: keep the discriminated union story-level, but add consumer-critical payload requirements for at least `score.committed`, `score.corrected`, `press.auto_fired`, `press.manual_fired`, `bet.flipped`, `lead.changed`, and `award.triggered`.

## [Medium] `bet.flipped` and `lead.changed` are enumerated and surfaced, but no story actually owns producing them
T8.1 includes both types in the rigid DB CHECK, and T8.2/T8.3 depend on them for toast/banner/feed UX. But none of the locked earlier stories define the state transition or emission point for either event. The review brief says they are "derived" inside the T6.4/T8.4 paths, but neither story currently contains an AC that computes or emits them. Recommended fix: add explicit producer ACs that define the transition semantics and payloads for both types, or remove them from the v1 enum and UI surfaces until an owner story lands.

## [Medium] `useActivityFeed` as a hook-local poller/emitter is prone to duplicate notifications
Toast, banner, and feed all consume `useActivityFeed(eventId)`. If the hook owns both polling and an EventTarget emitter, multiple mounted consumers can each poll and each emit the same fresh rows, creating duplicate toasts/banners or conflicting `since` windows. This is especially likely when the root layout mounts toast/banner globally and the event home mounts the feed. Recommended fix: make the polling/emitter a singleton at the root layout or a shared provider backed by one TanStack Query subscription, and have consumers read from that shared stream.

## Your flags
1. The 16-type enum is close, but it is only complete if you also add explicit producers for `bet.flipped` and `lead.changed`. `round.started` does not need to be a distinct type in v1; the first `score.committed` plus `roundId` and `holeNumber=1` is enough if you do not have a concrete consumer that needs a dedicated start event.

2. Do not inline all 16 full Zod schemas in the story. That is too much spec weight for too little value. But T8.1 should inline the common base fields and the consumer-critical fields for the few types that drive T8.2/T8.3/T8.4 behavior. Right now it is a little too abstract for `score.committed`, `score.corrected`, `press.*`, `bet.flipped`, `lead.changed`, and `award.triggered`.

3. The ESLint/no-direct-write rule should be part of T8.1, not deferred. The whole point of the story is centralizing activity writes behind `emitActivity`, and the enforcement mechanism is small and cheap.

4. `>=3 within 5 seconds` is a reasonable v1 storm-collapse threshold. I would keep the time window. A timeless "always collapse 3+" rule would hide normal activity bursts that happen over a longer period and feel too aggressive.

5. The overlap is correct for `press.*` and `bet.flipped`: toast for immediate awareness, banner for acknowledge-and-review. I would not force a strict partition. But keep `rule_set.revised` and `round.finalized` as banner-only unless you have a strong reason to toast them.

6. Awards should be best-effort, not fail-loud. Missing a celebratory animation is acceptable; rejecting a legitimate score because the award logic threw is not. That is a different risk class from press or money computation.

7. The activity-table lookup is fine at Pinehurst scale; you do not need a separate `awards_fired` table for performance. The real issue is correctness, not O(n): the lookup key must be award-specific. For first-birdie and first-eagle, a simple activity query is enough. For `skins_pot_streak`, you need a richer semantic key if the award remains in scope.

## Overall
Ship with fixes, not as-is. The epic structure is sound, but three must-fix gaps remain before commit: make `eventId` explicit across the activity spine (or remove the player-scoped install prompt from it), redesign the activity API so it can handle both live polling and historical backfill without dropping burst events, and either defer or re-architect `skins_pot_streak` so it is actually derivable during live scoring. After those are addressed, the rest of T8 looks like a good fit for the locked FD-5 in-app-only engagement model.
