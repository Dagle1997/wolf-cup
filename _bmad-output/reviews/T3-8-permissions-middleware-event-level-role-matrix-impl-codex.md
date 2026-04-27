# Codex Review

- Generated: 2026-04-27T18:59:40.822Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/middleware/require-event-participant.ts, apps/tournament-api/src/middleware/require-event-participant.test.ts, apps/tournament-api/src/middleware/require-invite-token.ts, apps/tournament-api/src/middleware/require-invite-token.test.ts, apps/tournament-api/src/types/hono.d.ts, _bmad-output/implementation-artifacts/tournament/T3-8-permissions-middleware-event-level-role-matrix.md

## Summary

Implementation largely matches ACs for both middleware behaviors and test coverage (7 participant tests incl. 2 cross-tenant; 6 invite tests incl. cross-tenant). The main spec drift is the Hono context type augmentation: `invite` is declared required in `hono.d.ts` but AC #3 requires it to be optional, and the comment also claims it is optional. This is a correctness/safety issue because it makes `c.get('invite')` look always-present to TypeScript even when middleware is not mounted.

Overall risk: medium

## Findings

1. [medium] Spec drift / unsound typing: `ContextVariableMap.invite` is required but must be optional
   - File: apps/tournament-api/src/types/hono.d.ts:20-38
   - Confidence: high
   - Why it matters: AC #3 requires `invite?: { eventId; inviteId }` (optional). The current declaration is `invite: { ... }` (required). This makes TypeScript treat `c.get('invite')` as always available, which can mask missing-middleware wiring at compile time and lead to runtime `undefined` usage in handlers. It also contradicts the file comment that says “Optional shape — only set on routes gated by that middleware.”
   - Suggested fix: Change to `invite?: { eventId: string; inviteId: string }` (note the `?`). If you want stronger typing on routes that mount `requireInviteToken`, consider narrowing via helper types or asserting presence after middleware, rather than making the global context variable required.

## Strengths

- `requireEventParticipant` enforces both tenant filters as required (`groups.tenantId` AND `groupMembers.tenantId`) and uses JOIN + LIMIT 1 per AC #1 (apps/tournament-api/src/middleware/require-event-participant.ts:71-83).
- `requireInviteToken` implements the pre-DB token shape guard with base64url charset and len bounds [16,128], matching AC #2 and T3-2 token shape (apps/tournament-api/src/middleware/require-invite-token.ts:38-74).
- Missing `:eventId` and missing `:token` correctly return 500 misuse codes (not 401) (require-event-participant.ts:55-66; require-invite-token.ts:49-61).
- Test suites meet minimum counts and include cross-tenant regression pins for both middlewares.

## Warnings

None.
