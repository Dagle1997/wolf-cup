# Codex Review

- Generated: 2026-04-27T18:35:17.899Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T3-8-permissions-middleware-event-level-role-matrix.md, apps/tournament-api/src/middleware/require-organizer.ts, apps/tournament-api/src/types/hono.d.ts, apps/tournament-api/src/db/schema/groups.ts

## Summary

Cannot verify the round-1 fixes in the actual middleware/query code because the new middleware + test files (`require-event-participant.ts`, `require-invite-token.ts`, and their tests) are not included in the provided materials. Within the provided spec + type augmentation file, there is drift: the invite variable augmentation is not present, and the invite-token missing-token status code is inconsistent across AC #2 vs AC #6.

Overall risk: medium

## Findings

1. [high] `hono.d.ts` does not include the new `invite` ContextVariableMap augmentation claimed by AC #3
   - File: apps/tournament-api/src/types/hono.d.ts:20-33
   - Confidence: high
   - Why it matters: AC #3 requires `invite?: { eventId: string; inviteId: string }` to exist on `ContextVariableMap`. As provided, `ContextVariableMap` only includes `requestId`, `logger`, `session`, and `player`. If middleware/tests rely on `c.set('invite', ...)` / `c.get('invite')`, typechecking will fail or developers will be forced into unsafe casts.
   - Suggested fix: Add `invite?: { eventId: string; inviteId: string }` to `ContextVariableMap` while preserving existing members.

2. [medium] Spec drift: missing-token behavior for `requireInviteToken` is inconsistent (500 in AC #2 vs 401 in AC #6 test expectations)
   - File: _bmad-output/implementation-artifacts/tournament/T3-8-permissions-middleware-event-level-role-matrix.md:90-129
   - Confidence: high
   - Why it matters: Round-1 fix #2 says missing/empty `:token` is a 500 `middleware_misuse_no_token` (developer error), but AC #6 still lists "401 invite_token_missing" for the "route mounted without `:token` param" case. This will cause implementation/tests to diverge and reintroduce the original taxonomy inconsistency.
   - Suggested fix: Update AC #6 bullets to match AC #2: missing/empty param should expect 500 `middleware_misuse_no_token` (and rename/remove `invite_token_missing` if it no longer exists).

## Strengths

- Risk Acceptance §5 mount examples now include `:token` (both `/api/spectator/:token` and `/api/events/:eventId/spectator/:token`), matching the stated middleware param source.
- AC #2’s 500-on-middleware-misuse rationale is consistent with the established `requireOrganizer` pattern returning 500 `middleware_misuse` when upstream middleware is missing (see `require-organizer.ts` lines 8-12, 32-38).
- Schema evidence supports the need for both tenant filters: both `groups` and `group_members` include `...ecosystemColumns()` (groups.ts lines 36-37 and 58-59), so `tenant_id` plausibly exists on both tables; filtering both is therefore not redundant in principle.

## Warnings

None.
