# Codex Review

- Generated: 2026-04-27T19:00:36.976Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/types/hono.d.ts, apps/tournament-api/src/middleware/require-event-participant.ts, apps/tournament-api/src/middleware/require-invite-token.ts, apps/tournament-api/src/middleware/require-invite-token.test.ts

## Summary

Round-1 fix (making `ContextVariableMap.invite` optional) is correctly applied and aligns with the stated AC/comment: `c.get('invite')` now types as `{eventId, inviteId} | undefined` on non-token-gated routes. No drift/regression introduced by this change in the provided diff.

Overall risk: low

## Findings

1. [medium] `session` and `player` are still typed as always-present, but comments indicate they’re only set by `require-session` on successful validation
   - File: apps/tournament-api/src/types/hono.d.ts:14-31
   - Confidence: high
   - Why it matters: This is the same unsoundness class that `invite` had pre-fix: handlers on routes that do not mount `requireSession` can still call `c.get('player')` / `c.get('session')` and TypeScript will treat them as non-optional, masking potential runtime `undefined` dereferences and making misuse harder to catch at compile time.
   - Suggested fix: If `requireSession` is not truly global, consider making `session?: ...` and `player?: ...` (and potentially `logger?`/`requestId?` if not global) or split route typing so only session-gated routes get non-optional `player/session` types.

## Strengths

- `invite?:` change matches the middleware reality described in `require-invite-token.ts` (sets invite only on valid token).
- Comment in `hono.d.ts` clearly documents why optional is intentional and prevents accidental dereference on non-gated routes.

## Warnings

None.
