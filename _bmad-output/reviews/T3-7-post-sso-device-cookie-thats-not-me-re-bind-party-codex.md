# Codex Review

- Generated: 2026-04-27T18:24:49.770Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/T3-7-post-sso-device-cookie-thats-not-me-re-bind-party-review.md, apps/tournament-api/src/routes/auth.ts, apps/tournament-api/src/routes/auth.test.ts, apps/tournament-api/src/routes/invites.ts, apps/tournament-web/src/routes/me.tsx, apps/tournament-web/src/routes/me.test.tsx, apps/tournament-web/src/routes/auth.conflict.tsx, apps/tournament-web/src/routes/auth.conflict.test.tsx

## Summary

1) “NOT blockers” that look like blockers: none of the five read as a v1 ship-stopper given the current contract. The only thing that edges toward ‘real risk’ is *not* in the five notes: `invites.ts` still mutates `device_bindings` rows by id without tenant scoping and without guarding `session_id IS NULL`, which can produce inconsistent `device_bindings.player_id` ↔ `device_bindings.session_id` state after post-SSO consolidation.

2) Party recs accepted but not implemented (drift): the party’s stated “tenant scoping on every device_bindings operation” is not true in `POST /api/invites/:token/claim` (existing row SELECT/UPDATE are unscoped). Cookie-utils refactor and conflict-UX polish were explicitly deferred.

3) Path-allowlist boundary: no obvious route/path escape in the provided code; the more meaningful boundary is *data scoping* (tenant scoping) in `invites.ts` as noted.

4) Test-count / AC drift:
- Backend: party says +17; file adds 12 callback tests and **5** `/that-is-not-me` tests (#13, #14, #15, #16b, #16) = 17 total. The party text says “+4 /that-is-not-me” in one place; that’s a minor count mismatch.
- Frontend: `me.test.tsx` has 5 tests; `auth.conflict.test.tsx` has 1 = 6, matching party.

5) Does “SHIP” match disciplinary findings? Mostly yes. The only muted concern is the over-strong tenant-scoping claim versus `invites.ts` reality; I’d still call it SHIP with a targeted follow-up, but it’s the one concrete correctness/security drift from the synthesis narrative.

Overall risk: medium

## Findings

1. [medium] Invites claim UPDATE/SELECT on device_bindings is not tenant-scoped and can mutate already-consolidated bindings (session_id non-null), creating inconsistent player_id↔session_id state
   - File: apps/tournament-api/src/routes/invites.ts:317-336
   - Confidence: high
   - Why it matters: T3-7 adds strong tenant scoping + `session_id IS NULL` defensiveness for rebind/consolidation and deletion, but `POST /:token/claim` still does `select().from(deviceBindings).where(eq(deviceBindings.id, cookieValue))` and then `update(deviceBindings).set({ playerId, deviceInfo }).where(eq(deviceBindings.id, cookieValue))` with no `tenant_id` predicate and no `session_id IS NULL` guard. If a device_binding has already been consolidated by T3-7 (session_id set), a subsequent anonymous claim can change `player_id` while leaving `session_id` pointing at a session for a different player. That can corrupt the intended state machine and undermines the party/synthesis claim that device_bindings operations are tenant-scoped defense-in-depth.
   - Suggested fix: In the claim handler, scope the existing-row SELECT/UPDATE by tenant (`eq(deviceBindings.tenantId, TENANT_ID)`) and refuse to UPDATE in-place once consolidated (e.g., require `isNull(deviceBindings.sessionId)` for the UPDATE; otherwise fall through to INSERT a new row). Add a regression test covering ‘claim after consolidation does not mutate consolidated row’ and (if you care about future multi-tenant) ‘cross-tenant cookie id cannot update foreign row’.

## Strengths

- OAuth callback now reads device cookie once and gates consolidation via `consolidatableDeviceBindingId` (prevents stale-cookie consolidation).
- Device-binding consolidation UPDATE uses a defensive multi-predicate WHERE including `isNull(session_id)` and tenant scoping.
- `POST /that-is-not-me` is tenant-scoped for device_bindings deletion and clears both session + device cookies with append semantics.
- Tests cover malformed cookie and cross-tenant cookie behavior for the sensitive paths in auth router.

## Warnings

- Truncated file content for review: apps/tournament-api/src/routes/auth.ts
- Truncated file content for review: apps/tournament-api/src/routes/auth.test.ts
- Git diff was truncated for the review request.
