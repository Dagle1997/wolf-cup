# T3-8: Permissions Middleware — Event-Level Role Matrix

## Status

Ready for Dev

## Story

As a developer,
I want the permissions middleware covering event-level roles (participant, invite-token spectator) beyond T1-6's minimal (session, organizer) slice,
So that every event-scoped route enforces the correct access level.

T3-8 adds two new Hono middleware functions:
- `require-event-participant.ts` — 403 unless `session.player_id` is in any `group_members` row for some `groups.event_id = :eventId`. Missing-session or missing-`:eventId` route param → 500 `middleware_misuse*` (developer-error class).
- `require-invite-token.ts` — validates an invite token (URL param) against the `invites` table; on valid attaches `{ invite: { eventId, inviteId } }` to ctx; on invalid/expired returns 401, missing-`:token` route param → 500 `middleware_misuse_no_token`. Status-code taxonomy detailed in §5 + AC #2.

T3-8 ships the middleware INFRASTRUCTURE — files + tests + exports. Consumer routes (T4 pairings UI, T7 read-only event view) wire them up later. This is intentional per the epic's "exercisable in epic-T3 sequence" sequencing note.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. SHARED-gate footprint announced up-front (retro AI-2)

**Zero SHARED files expected.** No new deps. No env vars. No DB migrations. Tests via existing vitest. Pure additive middleware that mirrors T1-6a's `require-organizer.ts` pattern.

### 2. Scorer-specific middleware deferred (per epic note)

The epic's T3.8 note explicitly defers `require-scorer-for-round` to T5.6 (single-writer enforcement) where its `scorer_assignments` table dependency lands. T3-8 ships ONLY the role-matrix middleware exercisable now: participant + invite-token. Pin in completion notes.

### 3. No consumer routes wired yet — middleware is exported but unused

T3-8 ships:
- `apps/tournament-api/src/middleware/require-event-participant.ts` (NEW, exports `requireEventParticipant`)
- `apps/tournament-api/src/middleware/require-invite-token.ts` (NEW, exports `requireInviteToken`)

Neither is mounted on any route in `app.ts` at the end of T3-8. Consumer wire-up is the responsibility of:
- T4-3 pairings PDF export route (uses `requireEventParticipant`).
- T7-3 course preview route (uses `requireInviteToken` for spectator view).
- Any future event-scoped player-facing route.

This keeps T3-8 self-contained and reviewable; the middleware contract is pinned by integration tests against a stub Hono app rather than against production routes.

### 4. `eventId` source for `requireEventParticipant`

The middleware reads `eventId` from `c.req.param('eventId')`. This requires the consumer route to mount under a path parameterized with `:eventId` (e.g., `app.route('/api/events/:eventId/pairings', ...)`). If the parameter is missing — e.g., the middleware is mounted on a non-event-scoped route by mistake — the middleware returns 500 `middleware_misuse_no_event_id` (matches AC #1 wording exactly).

The middleware MUST be mounted AFTER `requireSession` so `c.get('player')` is populated. Misuse (no session middleware ahead, `c.get('player')` undefined) → 500 `middleware_misuse` (the existing `require-organizer.ts` code matches this string).

### 5. Token source for `requireInviteToken`

URL-only for v1: `c.req.param('token')`. Per the epic AC mention of "URL/cookie", a cookie path is reserved for future hardening but not implemented in T3-8. The consumer route MUST be parameterized with `:token` (mirror of T3-6's `/api/invites/:token` shape); missing/empty `:token` is treated as developer misuse (the consumer mounted the middleware on a path that can't supply a token) → 500 `middleware_misuse_no_token`. **Symmetric with `requireEventParticipant`'s 500 on missing `:eventId`** — both indicate route-mount errors, not user errors. (Round-1 codex: rationalized from prior 401 wording for taxonomy consistency.)

The middleware does NOT call `requireSession` upstream — invite tokens are an UNAUTHENTICATED gating primitive (the token IS the auth, per T3-6's FR-E1 contract). Expected mount pattern (route MUST include `:token` in the path):

```typescript
// Spectator routes mount at a token-parameterized prefix. The :token
// param is what the middleware reads.
app.route('/api/spectator/:token', requireInviteToken, spectatorRouter);
```

Or, when an event-scoped path is also useful:

```typescript
app.route('/api/events/:eventId/spectator/:token', requireInviteToken, spectatorRouter);
```

### 6. Path footprint summary

ALLOWED edits expected:
- `apps/tournament-api/src/middleware/require-event-participant.ts` — NEW
- `apps/tournament-api/src/middleware/require-event-participant.test.ts` — NEW
- `apps/tournament-api/src/middleware/require-invite-token.ts` — NEW
- `apps/tournament-api/src/middleware/require-invite-token.test.ts` — NEW
- `apps/tournament-api/src/types/hono.d.ts` — MODIFIED (extend Variables augmentation with `invite: { eventId: string; inviteId: string }`)
- Story file + codex review files in `_bmad-output/`

NO SHARED edits expected. NO FORBIDDEN edits.

## Acceptance Criteria

1. **Given** `apps/tournament-api/src/middleware/require-event-participant.ts` (NEW)
   **When** inspected
   **Then** it exports a Hono `MiddlewareHandler` named `requireEventParticipant` that:
   - Reads `c.get('requestId')` (with `randomUUID()` fallback when request-id middleware is missing — mirror of `require-organizer.ts:29`).
   - Reads `c.get('player')`. If undefined → 500 `middleware_misuse` (requireSession not ahead in chain).
   - Reads `eventId = c.req.param('eventId')`. If missing/empty → 500 `middleware_misuse_no_event_id` (route not parameterized correctly).
   - SELECTs from `group_members` JOIN `groups` WHERE `groups.event_id = eventId AND group_members.player_id = player.id AND groups.tenant_id = TENANT_ID AND group_members.tenant_id = TENANT_ID LIMIT 1`. Tenant-scoped per the post-T3-7 hardening pattern.
   - If 0 rows → 403 `not_event_participant`.
   - If ≥1 row → `await next()`.

2. **Given** `apps/tournament-api/src/middleware/require-invite-token.ts` (NEW)
   **When** inspected
   **Then** it exports a Hono `MiddlewareHandler` named `requireInviteToken` that:
   - Reads `c.get('requestId')` (with `randomUUID()` fallback).
   - Reads `token = c.req.param('token')`. If missing/empty → **500 `middleware_misuse_no_token`** (developer-error class; the consumer route lacks a `:token` path param and could never legitimately hit this branch). Symmetric with `requireEventParticipant`'s missing-`:eventId` handling.
   - Cheap shape guard before DB hit: token must be `>= 16 && <= 128` chars and match `/^[A-Za-z0-9_-]+$/` (matches T3-2's `crypto.randomBytes(32).toString('base64url')` output shape, same idiom as `require-session.ts:40`). On guard failure → 401 `invite_token_invalid` (user-error class — a malformed token in a valid-shape URL position can come from a hand-edited link).
   - SELECTs `invites` WHERE `token = :token AND tenant_id = TENANT_ID LIMIT 1`. Tenant-scoped.
   - If 0 rows → 401 `invite_not_found`.
   - If row's `expires_at <= Date.now()` → 401 `invite_expired`.
   - Else: set `c.set('invite', { eventId: row.eventId, inviteId: row.id })`. `await next()`.

3. **Given** `apps/tournament-api/src/types/hono.d.ts`
   **When** inspected post-T3-8
   **Then** the `ContextVariableMap` interface (the project's actual augmentation point — verified by inspection of the file: `declare module 'hono' { interface ContextVariableMap { ... } }`) includes a new optional `invite?: { eventId: string; inviteId: string }` member. Existing `session`, `player`, `requestId`, `logger` augmentations remain unchanged.

4. **Given** the existing T1-6a middleware (`requireSession`, `requireOrganizer`)
   **When** inspected post-T3-8
   **Then** their behavior + signatures are UNCHANGED. T3-8 adds new files only; it does not modify existing middleware.

5. **Given** `apps/tournament-api/src/middleware/require-event-participant.test.ts` (NEW)
   **When** `pnpm -F @tournament/api test` runs
   **Then** at least 7 tests cover:
   - Happy: session + player IS in group_members for event → `next()` called, response 200.
   - 403 not_event_participant: session + player NOT in any group_members for the event.
   - 403 not_event_participant: player IS in groups for a DIFFERENT event but not THIS one.
   - 500 middleware_misuse: session not ahead of middleware in chain (`c.get('player')` undefined).
   - 500 middleware_misuse_no_event_id: route mounted without `:eventId` param.
   - **Cross-tenant on `groups.tenant_id`**: groups row in foreign tenant containing the player → 403 (the `groups.tenant_id = TENANT_ID` filter excludes it).
   - **Cross-tenant on `group_members.tenant_id`**: groups in correct tenant, but the group_members row itself is in foreign tenant (defensive mismatch) → 403 (the `group_members.tenant_id = TENANT_ID` filter excludes it). Both tenant filters in the JOIN are load-bearing per the round-1 codex catch.

6. **Given** `apps/tournament-api/src/middleware/require-invite-token.test.ts` (NEW)
   **When** `pnpm -F @tournament/api test` runs
   **Then** at least 6 tests cover:
   - Happy: valid token + not expired → `next()` called, `c.get('invite')` is `{ eventId, inviteId }`, response 200.
   - **500 middleware_misuse_no_token**: route mounted without `:token` param (developer-error class; aligns with AC #2 + Risk Acceptance §5).
   - 401 invite_token_invalid: malformed token in the path slot (wrong charset / too short / too long).
   - 401 invite_not_found: well-shaped token but no matching row.
   - 401 invite_expired: matching row with `expires_at <= now`.
   - **Cross-tenant**: invite row in foreign tenant → 401 invite_not_found (the `tenant_id = TENANT_ID` filter excludes it).

7. **Given** `pnpm -F @tournament/api test`
   **When** run post-T3-8
   **Then** total tests ≥ baseline + 13. Baseline at story start: 358 (post-T3-7). The +13 covers AC #5 (7 minimum: happy + 2x403 + 2x500 + 2 cross-tenant variants) + AC #6 (6 minimum).

8. **Given** Wolf Cup workspaces
   **When** `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` run post-T3-8
   **Then** both continue to pass with zero net-negative test count change.

9. **Given** `pnpm -F @tournament/api typecheck` + `pnpm -F @tournament/api lint`
   **When** run post-T3-8
   **Then** both exit 0. No new `any`. No new `// eslint-disable`.

10. **Given** there are no SHARED-file edits
    **When** the dev agent classifies its planned edits at impl time
    **Then** every touched path falls under ALLOWED. Specifically NOT touched: `pnpm-lock.yaml`, `package.json`, `docker-compose.yml`, root files, `app.ts` (no consumer routes wired).

## Tasks / Subtasks

- [ ] Task 1: Capture baselines (358 / 36).

- [ ] Task 2: Backend — create `require-event-participant.ts`. (AC #1)

- [ ] Task 3: Backend — create `require-invite-token.ts`. (AC #2)

- [ ] Task 4: Types — extend `hono.d.ts` `ContextVariableMap` interface with `invite?` member. (AC #3)

- [ ] Task 5: Backend — create `require-event-participant.test.ts` with at least 7 tests (matches AC #5). (AC #5)

- [ ] Task 6: Backend — create `require-invite-token.test.ts` with at least 6 tests (matches AC #6). (AC #6)

- [ ] Task 7: Run regressions (typecheck, lint, all 4 test suites).

## Dev Notes

- **Why no consumer wire-up in T3-8?** The middleware is exported infrastructure; future stories (T4-3 pairings, T7-3 course preview) wire consumers. Bundling consumer routes into T3-8 would expand the diff into multiple unrelated route handlers + their own ACs. Better to ship the middleware in isolation, pin via integration tests against stub Hono apps, and let consumer stories adopt it cleanly.

- **Why tenant-scope in the SELECT?** Post-T3-7 hardening pattern. Single-tenant v1 has no actual cross-tenant traffic, but defensive scoping prevents a future second tenant on the same domain from getting cross-tenant participant gating bugs. Cross-tenant test pinned per AC #5/#6.

- **Why URL-param `eventId` rather than body or query string?** REST convention + Hono's `c.req.param('eventId')` is the idiomatic source for path params. Bodies and query strings would be middleware-incompatible (middleware runs before body parsing on POST routes).

- **Why URL-param `token` (not cookie) for invite middleware?** Mirrors T3-6's existing `/api/invites/:token` shape. Cookie-based invite tokens are a v1.5+ feature (the epic AC mentions "URL/cookie" but the cookie path is reserved). If a future T7-x story wires invite tokens via cookie for spectator view, the middleware can be extended via a fallback `extractCookie` call without breaking the URL-param path.

- **Why 500 on no-eventId / no-token rather than 400/401?** Both are misuse signals (developer-error class), not user-error class. A user can never legitimately hit a route mounted with `requireEventParticipant` on a non-`:eventId`-parameterized path. Loud 500 + descriptive code surfaces the misuse in logs immediately. Mirror of `require-organizer.ts`'s 500 `middleware_misuse` pattern.

- **Why fallback `randomUUID()` for requestId?** Mirror of `require-organizer.ts:29`. If the global request-id middleware is ALSO missing (double misuse), the error response still carries a correlation id and the misuse is still logged. Defensive, cheap.

- **Wolf Cup isolation (FD-1 / FD-2):** T3-8 writes only to `apps/tournament-api/src/middleware/` + `apps/tournament-api/src/types/hono.d.ts`. Zero edits to `apps/api/**`, `apps/web/**`, `packages/engine/**`.

- **Retro AI-1 applied:** spec codex caps at 4 rounds OR zero-H-zero-M.
- **Retro AI-2 applied:** zero SHARED files pre-announced.

### Project Structure Notes

Shape after T3-8:

```
apps/tournament-api/
  src/
    middleware/
      require-event-participant.ts                  # NEW
      require-event-participant.test.ts             # NEW
      require-invite-token.ts                       # NEW
      require-invite-token.test.ts                  # NEW
      require-organizer.ts                          # unchanged (T1-6a)
      require-session.ts                            # unchanged (T1-6a)
    types/
      hono.d.ts                                     # MODIFIED: +invite augmentation
```

**Explicitly NOT in T3-8 (reserved for future):**
- `require-scorer-for-round` middleware (T5-6 — depends on `scorer_assignments` table from T5-1).
- Consumer route wire-up (T4-3, T7-3, T7-x as applicable).
- Cookie-based invite-token source (v1.5+ hardening).
- Per-player invite tokens (v1.5+ — invites schema is event-scoped per T3-1).

### References

- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` Story T3.8 (line 1018-1042).
- Predecessor stories: T1-6a (require-session, require-organizer pattern at `apps/tournament-api/src/middleware/require-organizer.ts`); T3-1 (groups/group_members/invites schema); T3-6 (invites table consumed via /api/invites/:token).
- Consumer stories (downstream): T4-3 (pairings PDF export uses `requireEventParticipant`); T7-3 (course preview uses `requireInviteToken` for spectator view).
- Pattern reference: `apps/tournament-api/src/middleware/require-organizer.ts` (the canonical defensive-misuse-500 + ctx-aware-logging pattern T3-8 mirrors).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
