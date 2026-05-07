# Codex Review

- Generated: 2026-05-07T02:55:29.381Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/T8-4-award-trigger-surfaces-first-birdie-first-eagle-party-review.md, apps/tournament-api/src/services/awards.ts, apps/tournament-web/src/components/award-celebration.tsx

## Summary

Party review largely matches the provided implementation: backend award emission is scoped to sub-par scores with idempotency checks, and the frontend celebration includes the auth-resolve catchup, eagle-priority selection, and 4s auto-dismiss. One concrete gap remains in the live-stream path: it does not enforce the same TTL/ordering semantics as the catchup scan, which can surface stale or mis-ordered celebrations under certain stream/reconnect/backfill behaviors.

Overall risk: medium

## Findings

1. [medium] Live stream celebration path can surface stale awards and distort “most recent” selection (uses Date.now and no TTL gate)
   - File: apps/tournament-web/src/components/award-celebration.tsx:72-92
   - Confidence: medium
   - Why it matters: The auth-resolve catchup path explicitly enforces the 4s TTL using `r.createdAt` (lines 45-70), but the live `useActivityStream` handler does not apply any TTL check and sets `arrivedAt: Date.now()` instead of using the row’s timestamp. If `useActivityStream` ever delivers older rows (reconnect/backfill, buffering, or implementation changes), users can see celebrations well after they occurred. Additionally, because eagle priority picks the max `arrivedAt` (lines 108-117), using client receipt time for stream events and server/row time for catchup events can mis-rank “most recent” across the two sources (exactly the class of issue this code is trying to make deterministic).
   - Suggested fix: In the stream handler, (1) apply the same staleness gate: `if (Date.now() - r.createdAt > ANIMATION_TTL_MS) continue;` and (2) set `arrivedAt` from `r.createdAt` (or rename semantics to `receivedAt` and use it consistently in both code paths). Consider adding/adjusting a test to ensure the stream path also ignores rows older than TTL.

2. [low] Hard-coded TENANT_ID can break idempotency and allow duplicate awards if tenant ever changes
   - File: apps/tournament-api/src/services/awards.ts:35-66
   - Confidence: high
   - Why it matters: Idempotency checks are scoped to `activity.tenantId === 'guyan'`. If the runtime tenant differs (now or in the future), the SELECT will not find prior `award.triggered` rows and the service will emit duplicates. Party review notes this as an accepted v1 posture, but it is still a correctness footgun if any multi-tenant wiring is introduced or if this code is reused outside that tenant.
   - Suggested fix: Thread tenantId from the caller/event context into `evaluateAwards`, or derive from a single authoritative tenant resolver used by `emitActivity` and the rest of the activity feed stack. If keeping the hard-code, ensure it is enforced globally (not just here) so mismatches can’t occur silently.

3. [low] SELECT-then-INSERT idempotency is race-prone; duplicates can cause double celebrations/feed entries
   - File: apps/tournament-api/src/services/awards.ts:55-92
   - Confidence: high
   - Why it matters: Under concurrent score commits, two transactions can both pass the SELECT and both emit the same award, producing duplicate `award.triggered` activity rows. Even if rare, the user-visible impact is potentially multiple toasts/celebrations and multiple feed entries for a “first of event” award. Party review says this is accepted risk for v1; still worth flagging as a reliability edge for trip-day concurrency.
   - Suggested fix: If/when you address this, enforce uniqueness at the DB level (unique index on tenantId+eventId+type+awardType) and/or use an atomic insert with conflict handling rather than SELECT-then-INSERT.

## Strengths

- Backend award detection is minimal and consistent with the “best-effort” posture (early sub-par precheck; emits typed `award.triggered` events).
- Frontend includes the load-bearing auth-resolve catchup scan with TTL gating and dedupe via `seenIdsRef`, which directly addresses the ‘missed celebration before auth resolves’ failure mode.
- Eagle priority logic avoids relying on insertion order and instead selects by timestamp, making the chosen celebration deterministic when multiple entries are pending.

## Warnings

None.
