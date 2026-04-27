# Codex Review

- Generated: 2026-04-27T18:33:40.195Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T3-8-permissions-middleware-event-level-role-matrix.md, apps/tournament-api/src/middleware/require-organizer.ts, apps/tournament-api/src/middleware/require-session.ts, apps/tournament-api/src/db/schema/events.ts, apps/tournament-api/src/db/schema/groups.ts, apps/tournament-api/src/types/hono.d.ts

## Summary

Spec is mostly precise and testable, but there are two concrete internal inconsistencies that will cause incorrect consumer mounting / status-code behavior unless resolved: (1) the documented mount path for `requireInviteToken` does not include `:token` even though the middleware reads `c.req.param('token')`; (2) the spec alternates between treating missing token as 401 vs “misuse” 500. Types augmentation location is correct (`apps/tournament-api/src/types/hono.d.ts`), but the AC wording says “Variables” while the actual project uses `ContextVariableMap`—the AC should match reality to avoid wrong edits.

Overall risk: medium

## Findings

1. [high] `requireInviteToken` mount example cannot work (missing `:token` param)
   - File: _bmad-output/implementation-artifacts/tournament/T3-8-permissions-middleware-event-level-role-matrix.md:48-57
   - Confidence: high
   - Why it matters: AC #2 requires `requireInviteToken` to read `token = c.req.param('token')`, but the spec’s example mount is `app.route('/api/events/:eventId/spectator', requireInviteToken, spectatorRouter);` (no `:token`). Under that route shape, `c.req.param('token')` will always be missing, so the middleware will always return the missing-token error and the downstream spectator router is unreachable. This is a contract-level mismatch that will propagate to downstream T7-3 wiring.
   - Suggested fix: Update the spec’s expected mount shape to include a `:token` path param (e.g. `/api/events/:eventId/spectator/:token`), or change the middleware contract to read from a different source (query/cookie) if that’s the intended route shape. Ensure tests mount the stub app with the exact intended route pattern.

2. [high] Status-code taxonomy for missing token is internally inconsistent (401 vs 500)
   - File: _bmad-output/implementation-artifacts/tournament/T3-8-permissions-middleware-event-level-role-matrix.md:86-90
   - Confidence: high
   - Why it matters: AC #2 says missing/empty `token` → 401 `invite_token_missing` (line 86), but the Dev Notes claim “500 on no-eventId / no-token” as misuse (lines 163-164). This ambiguity directly impacts implementation and tests, and affects the ‘500-vs-401-vs-403’ taxonomy you’re trying to pin.
   - Suggested fix: Pick one: 
- If missing token is truly developer misuse (mounted on wrong route), make it 500 `middleware_misuse_no_token` (parallel to eventId). 
- If you want a public, unauthenticated guard that treats absence as user error, keep 401 and delete/adjust the Dev Notes rationale to exclude token.
Then align test cases + error codes accordingly.

3. [medium] AC references `Variables` augmentation, but codebase uses `ContextVariableMap` in `hono.d.ts`
   - File: _bmad-output/implementation-artifacts/tournament/T3-8-permissions-middleware-event-level-role-matrix.md:93-96
   - Confidence: high
   - Why it matters: The acceptance criteria says “Variables augmentation includes `invite?: …`”, but the existing file `apps/tournament-api/src/types/hono.d.ts` declares `interface ContextVariableMap` (lines 20-32). If an implementer follows the AC literally, they may add the wrong augmentation (or add a second one) and end up with types that don’t affect `c.get()/c.set()` as intended.
   - Suggested fix: Update AC #3 wording to explicitly reference `ContextVariableMap` (and show the exact shape to add). Verify with `pnpm -F @tournament/api typecheck` that `c.set('invite', ...)` and `c.get('invite')` type as expected.

4. [medium] Cross-tenant test case for participant check only describes `groups.tenant` mismatch, not `group_members.tenant` mismatch
   - File: _bmad-output/implementation-artifacts/tournament/T3-8-permissions-middleware-event-level-role-matrix.md:108-110
   - Confidence: medium
   - Why it matters: AC #1 mandates tenant scoping on both `groups` and `group_members` (line 78), but AC #5’s cross-tenant test description only asserts a mismatch on `groups.tenant_id` (line 109). If implementation accidentally omits the `group_members` tenant predicate, the described test might still pass depending on how fixtures are created (especially if group_members rows always share the group’s tenant in helpers).
   - Suggested fix: Add/adjust a test that creates a same-event `groups` row in the correct tenant but a `group_members` row in a different tenant for the same player+group, and assert it is rejected (403). This directly pins the “both tables tenant-scoped” requirement.

## Strengths

- 500-on-misuse pattern for `requireEventParticipant` is consistent with existing `requireOrganizer` behavior (`c.get('player')` undefined → 500) (apps/tournament-api/src/middleware/require-organizer.ts:8-12,32-38).
- Shape-guard pattern (`len 16–128` + `/^[A-Za-z0-9_-]+$/`) matches existing `requireSession` approach (apps/tournament-api/src/middleware/require-session.ts:36-43) and will accept `crypto.randomBytes(32).toString('base64url')` tokens (typically 43 chars, base64url charset).
- Path allowlist sanity: the `Variables` augmentation does in fact live at `apps/tournament-api/src/types/hono.d.ts` (provided file), matching the spec’s stated location; adding `invite` there is the right mechanism.
- Deferring consumer route wiring is defensible if exports are ensured and middleware behavior is pinned via stub-app integration tests; keeps this story’s scope tight.

## Warnings

None.
