# T3-6: Invite-Link First-Arrival Flow (no SSO)

## Status

Done

## Story

As a player tapping an invite link for the first time,
I want to see "you're in" + a roster-picker without any sign-in,
So that first-arrival friction is zero on setup day (FR-E1 revised 2026-04-18).

T3-6 is the entry point for non-organizer players. T3-2's event wizard generated an `invites.token`; this story consumes it. **No SSO is triggered** — first-arrival is anonymous-friendly. SSO is deferred until the player makes a MUTATION (score entry T5, photo upload T7, admin action). Player identity comes from the name-tap action, not the invite token (per T3-1 schema, `invites` is event-scoped only — no `invited_player_id` column).

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. SHARED-gate footprint announced up-front (retro AI-2)

**Zero SHARED files expected.** Same posture as T2-5 / T3-2 / T3-3 / T3-5:
- Form state via React `useState`.
- Validation hand-rolled Zod safeParse on submit.
- Backend: existing `@libsql/client` + `drizzle-orm` + Hono. No new deps.
- Tests: existing `vitest` + `@testing-library/react`.

**No `docker-compose.yml` changes. No env vars. No DB migrations** (T3-1 already defined `invites` + `device_bindings`).

### 2. Endpoint scope (2 new endpoints; new `/api/invites` mount)

`adminInvitesRouter` is the WRONG name — these endpoints are NOT organizer-gated. The router is `inviteRouter`, mounted at `/api/invites`. Two endpoints:

1. **`GET /api/invites/:token`** — validate token + return event + roster.
   - **No auth gate.** Anonymous-friendly (the whole point of the story).
   - Validate token exists in `invites` table.
   - Validate `expires_at > now`.
   - Fetch event details (`name`, `start_date`, `end_date`, `timezone`).
   - Fetch all `group_members` rows under all groups belonging to the event; JOIN to `players` for `name`.
   - Return: `{ event: { id, name, startDate, endDate, timezone }, roster: [{ playerId, name }] }`. Roster sorted by `players.name ASC`.
   - Errors:
     - 404 `invite_not_found` if no row matches token.
     - 410 `invite_expired` if expires_at <= now (`410 Gone` is the right code for "this resource was valid but has aged out").
   - The token itself is the auth — anyone with it gets the roster.

2. **`POST /api/invites/:token/claim`** — claim a player_id on this device.
   - **No auth gate.** Anonymous-friendly.
   - Body Zod: `{ playerId: z.string().min(1) }`.
   - Validate token (same as GET).
   - Validate playerId is in the event's `group_members` (cross-table SELECT to confirm).
   - Check if a `device_bindings` row already exists for this device (via the transient device-id cookie):
     - Cookie present + row exists (AND row's context_id matches current event per AC #3): UPDATE `player_id` AND `device_info` to the new values (allow re-tap on wrong name; same device, different player). `created_at` is preserved. Return 200.
     - Cookie absent OR row doesn't exist (cookie value is bogus): INSERT new `device_bindings` with `id = randomUUID()`, `player_id`, `session_id = NULL`, `device_info` from User-Agent (UA-only, NO IP for v1; truncated to ≤256 chars per AC #3), `tenant_id = 'guyan'`, `context_id = 'event:{eventId}'`. Set the device-id cookie. Return 201.
   - Errors:
     - 404 `invite_not_found` (token doesn't match)
     - 410 `invite_expired`
     - 400 `player_not_in_event` if playerId isn't in the event's group_members
     - 400 `invalid_body` (Zod miss)

### 3. Device-id cookie (transient, anonymous-friendly)

The cookie's value IS the `device_bindings.id` (a UUID). On every subsequent request to invite-scoped routes (or to T3-7's post-SSO callback), the API extracts the cookie + SELECT device_bindings WHERE id = :cookieValue → resolves to a player_id without requiring a session.

**Cookie attributes:**
- Name: `tournament_device_id`
- Path: `/`
- HttpOnly (UA can't read it; only the server)
- SameSite=Lax (sent on top-level navigations; needed for read-only routes after the claim)
- Secure (HTTPS only) — **conditionally added when NODE_ENV === 'production'**, matching the existing T1-6a session.ts:193 + oauth-cookies.ts:84 pattern. Local dev (http://localhost) omits Secure so the cookie persists for testing. Production VPS is HTTPS-only via Traefik so Secure is always set there.
- Max-Age: 90 days. **The cookie is set on BOTH the INSERT branch AND the UPDATE branch of POST /:token/claim** (UPDATE branch refreshes Max-Age so an active player on this device extends the binding's life). The cookie is NOT refreshed on GET reads (would require setting Set-Cookie on every read; not load-bearing for v1).
- Domain: omit (host-only — scopes to `tournament.dagle.cloud` exactly, NOT `*.dagle.cloud`)

**Security framing — known v1 limitation:** the device-id cookie value IS the credential for an unclaimed device_binding. Sharing the cookie value = impersonation of that player_id (until SSO is performed via T3-7). Acceptable for v1 because:
- The blast radius is "view-only access to event data + the ability to re-tap a name on this device." No mutation surface (T5 score entry triggers SSO; T7 photo upload triggers SSO; admin actions require requireOrganizer).
- The Pinehurst Crew is 8 trusted players in a private league.
- Anyone with the invite token already has equivalent (or larger) blast radius — they could claim ANY player_id in the roster. T3-6 doesn't widen the threat model.

Future hardening (post-T3-6): per-device signed tokens with rotation; or migrate to signed cookies. Out of T3-6 scope.

### 4. Frontend route (PUBLIC; no auth gate)

`apps/tournament-web/src/routes/invite.$token.tsx` is the FIRST tournament-web route that does NOT have a `beforeLoad` auth-status check. Anonymous users see the page. The route consumes T3-6's two endpoints:

- `GET /api/invites/:token` → render event details + roster picker. On 410 expired → "this invite has expired; ask the organizer for a new one." On 404 invalid → "invite not found."
- Tap a name → `POST /api/invites/:token/claim` → on 200/201, render the success / "you're in" surface.

The success surface displays:
- "Welcome, {playerName}!" + event name + dates.
- "Your device is registered. You can now view the event schedule." (Schedule view is T7's territory; v1 success surface is text-only.)
- The "What's next" links — for T3-6 v1, only the (FUTURE) `/event/:id` schedule view is referenced. v1 ships a placeholder link that 404s until T7 lands. Document.

Auth-status loader pattern from T2-3b/T2-5/T3-2/T3-3/T3-5 is NOT reused here — the route loads anonymously.

### 5. Test coverage targets (mandatory)

**≥10 backend tests** (`apps/tournament-api/src/routes/invites.test.ts`, NEW):

- GET happy path: valid token → 200 with event + sorted roster.
- GET 404 invite_not_found: unknown token.
- GET 410 invite_expired: expires_at < now.
- POST claim happy path (no prior cookie): 201 + cookie set + device_bindings row inserted with session_id = NULL.
- POST claim happy path (prior cookie + existing row): 200 + UPDATE player_id of existing device_binding.
- POST claim happy path (cookie value is bogus / doesn't match any row): treats as no-cookie + INSERTs new row.
- POST claim 404 invite_not_found.
- POST claim 410 invite_expired.
- POST claim 400 player_not_in_event: playerId exists in players table but NOT in any group_member row of the event.
- POST claim 400 invalid_body: Zod miss.
- POST claim sets the cookie with the right attributes (HttpOnly, SameSite=Lax, Secure, Max-Age). **Test approach:** parse the Set-Cookie response header and check each attribute INDIVIDUALLY (e.g., `expect(setCookie).toContain('HttpOnly')`, `expect(setCookie).toMatch(/Max-Age=7776000/)`) — NOT exact-string match (brittle if attribute order or formatting drifts).
- POST claim cookie refresh on UPDATE branch: pre-existing cookie + same device → response also has Set-Cookie with refreshed Max-Age.
- POST claim does NOT update `device_bindings.created_at` on UPDATE: snapshot the row's `created_at` pre-call, re-claim with a different playerId, assert `created_at` unchanged post-call (only `player_id` + `device_info` updated).
- Roster dedupe across multiple groups: an event with 2 groups where one player is in BOTH groups → GET /:token returns the player ONCE (deduplicated by playerId).
- Body too large (8 KB cap on POST) → 400 body_too_large.

**≥4 frontend component tests** (`apps/tournament-web/src/routes/invite.$token.test.tsx`, NEW):

- Idle render (mock GET 200): event name + dates + roster list with tap buttons.
- 410 expired (mock GET 410): error message + "ask organizer for a new invite" text.
- 404 invalid (mock GET 404): "invite not found" error.
- Tap-name → claim flow (mock POST 201): success surface with player name + event name.

### 6. Path footprint summary

ALLOWED edits expected:
- `apps/tournament-api/src/routes/invites.ts` — NEW
- `apps/tournament-api/src/routes/invites.test.ts` — NEW
- `apps/tournament-api/src/app.ts` — MODIFIED (mount inviteRouter at /api/invites)
- `apps/tournament-web/src/routes/invite.$token.tsx` — NEW (PUBLIC route)
- `apps/tournament-web/src/routes/invite.$token.test.tsx` — NEW
- `apps/tournament-web/src/routeTree.gen.ts` — auto-regen
- Story file + codex review files in `_bmad-output/`

NO SHARED edits. NO FORBIDDEN edits.

## Acceptance Criteria

1. **Given** `apps/tournament-api/src/routes/invites.ts` (NEW)
   **When** inspected
   **Then** it exports `inviteRouter` (Hono instance) with 2 routes (paths prefixed `/:token` so they resolve to `/api/invites/:token` and `/api/invites/:token/claim` once mounted under `/api/invites` in app.ts):
   - `GET /:token` — middleware: NONE (no auth, no bodyLimit since GET has no body) → handler.
   - `POST /:token/claim` — middleware: bodyLimit(8 KB) → handler. **No `requireSession`, no `requireOrganizer`** — this is the anonymous claim flow.
   bodyLimit `onError` returns 400 `{ error: 'bad_request', code: 'body_too_large', requestId }` (matches existing pattern).

2. **Given** `GET /api/invites/:token`
   **When** invoked anonymously
   **Then**:
   - SELECT `invites` WHERE `token = :token`.
   - 0 rows → 404 `{ error: 'not_found', code: 'invite_not_found', requestId }`.
   - 1 row + `expires_at <= Date.now()` → 410 `{ error: 'gone', code: 'invite_expired', requestId }`.
   - 1 row + valid: SELECT the event by `event_id`, then JOIN `groups → group_members → players` to get the roster.
   - Response 200: `{ event: { id, name, startDate, endDate, timezone }, roster: [{ playerId, name }] }`. Roster sorted by `players.name ASC`. Roster is the union across all groups under the event (deduplicated by playerId).

3. **Given** `POST /api/invites/:token/claim` with body `{ playerId: string }`
   **When** invoked anonymously
   **Then**:
   - Body Zod-parsed; missing/empty `playerId` → 400 `invalid_body`.
   - Validate token (same as AC #2): 404 `invite_not_found` OR 410 `invite_expired` OR proceed.
   - Validate `playerId` is in the event's group_members (a SELECT joining group_members WHERE group_id IN (event's groups) AND player_id = :playerId; 0 rows → 400 `{ error: 'bad_request', code: 'player_not_in_event', requestId }`).
   - Compute `deviceInfo = (request User-Agent header || '').slice(0, 256)`. UA-only (no IP) for v1 — IP capture has privacy implications + behind-load-balancer X-Forwarded-For caveats; defer. Truncated to 256 chars in BOTH branches below.
   - Read the `tournament_device_id` cookie. If present AND a `device_bindings` row exists with `id = cookieValue` AND **the row's `context_id` equals `'event:{currentEventId}'`** (i.e., the binding belongs to THIS event):
     - UPDATE that row: `player_id = :playerId`, `device_info = deviceInfo`. **Do NOT update `created_at`** — that column is the original-bind audit timestamp (T3-1 schema; semantic = "when this device first bound a player"). Re-claim doesn't change the original bind time.
     - Refresh the cookie (set the same Max-Age=7776000 attributes — allows the cookie to live another 90 days).
     - Response 200: `{ player: { id, name }, event: { id, name }, deviceBindingId: <existing>, requestId }`.
   - Else (cookie absent OR cookie value doesn't match any row OR existing row's context_id is for a DIFFERENT event):
     - **Cross-event invite-claim semantics:** if the same device follows an invite for event B after previously binding under event A, T3-6 INSERTs a NEW device_bindings row scoped to event B (does NOT reuse event A's row). Each event-binding stays semantically tied to its own event's `context_id`. The cookie value gets overwritten with the NEW deviceBindingId — the old row is orphaned (still exists in DB; no reference). Future cleanup story can sweep orphaned bindings; v1 acceptable.
     - Generate `deviceBindingId = randomUUID()`.
     - INSERT new `device_bindings` row: `id = deviceBindingId`, `playerId`, `sessionId = null`, `deviceInfo`, `createdAt = now`, `tenantId = 'guyan'`, `contextId = 'event:{eventId}'`.
     - Set the `tournament_device_id` cookie (per AC #4 attributes).
     - Response 201: `{ player: { id, name }, event: { id, name }, deviceBindingId, requestId }`.

   **Same playerId across multiple devices is allowed.** Each device gets its own `device_bindings` row. T3-7's post-SSO rebind will handle consolidation when the player completes SSO on one of the devices. v1 acceptable; the player can self-tap on their phone + tablet + laptop without conflict.

4. **Given** the response Set-Cookie for `tournament_device_id`
   **When** inspected
   **Then** the cookie attributes are: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=7776000` (90 days), no `Domain` attribute (host-only; scopes to `tournament.dagle.cloud` exactly). The `Secure` attribute is conditionally appended when `NODE_ENV === 'production'` (matches T1-6a session.ts:193 + oauth-cookies.ts:84 pattern); test environment (NODE_ENV='test') OMITS Secure so the cookie persists in the in-memory test client. Value is the `deviceBindingId` (UUID).

5. **Given** `apps/tournament-api/src/app.ts`
   **When** inspected post-T3-6
   **Then** `app.route('/api/invites', inviteRouter)` is added alongside the existing routers. (NEW prefix; not under `/api/admin`. Winston's umbrella note doesn't apply here.)

6. **Given** `apps/tournament-web/src/routes/invite.$token.tsx` (NEW)
   **When** inspected
   **Then** it exports `Route` (TanStack file-route registration at `/invite/$token`) AND `InvitePage` (named React component for direct test render). **No `beforeLoad` auth check** — anonymous-friendly. The `Route` definition is intentionally minimal (no auth-status loader call).

7. **Given** `InvitePage` (idle state with valid token)
   **When** rendered
   **Then**:
   - Issues `GET /api/invites/:token` via `useQuery` (queryFn passed `signal`).
   - On 200: renders event header (name + start/end dates + timezone), an "Tap your name" prompt, and the roster as a list of name buttons sorted ASC.
   - On 410: renders "This invite has expired. Ask Josh for a new one." (or organizer name once the event row gives us that — for v1, hardcode the friendly text).
   - On 404: renders "Invite not found."
   - On other 5xx: renders generic "Try again."

8. **Given** the user taps a name button
   **When** the claim mutation fires
   **Then**:
   - POST to `/api/invites/:token/claim` with `{ playerId: <tapped> }`.
   - On 200/201: render success surface — "Welcome, {playerName}!", event name + dates, "Your device is registered. You can now view the event schedule." with a placeholder link to `/event/:id` (FUTURE T7 route; v1 ships a 404 OR the link disabled with a "schedule coming soon" tooltip).
   - On 400 player_not_in_event: render "That name isn't on this event's roster — please pick again." Stay on the picker.
   - On 410 / 404: render the corresponding error from AC #7.
   - On 5xx: render generic "Try again."

9. **Given** AbortController-on-unmount pattern (mirror T3-3 / T3-5 inFlightControllers ref + useEffect cleanup)
   **When** the user navigates away mid-claim
   **Then** in-flight fetch aborts; query auto-aborts via TanStack Query's signal.

10. **Given** the device-binding race
    **When** two browser tabs on the same device tap two different names concurrently
    **Then** the second POST UPDATES the same `device_bindings` row (same cookie value), overwriting the first claim. Race semantics: last-write-wins. v1 acceptable; documented. Future hardening (T3-7+): a confirmation step before overwriting.

11. **Given** `apps/tournament-api/src/routes/invites.test.ts` (NEW)
    **When** the suite runs post-T3-6
    **Then** at least 10 backend tests exist (per Risk Acceptance §5). Tests use existing T1-6a in-memory DB pattern; seed event + group + group_members + invite, then exercise each endpoint.

12. **Given** `apps/tournament-web/src/routes/invite.$token.test.tsx` (NEW)
    **When** the suite runs post-T3-6
    **Then** at least 4 component tests exist (per Risk Acceptance §5). `vi.stubGlobal('fetch', vi.fn())` per-test pattern; render `InvitePage` directly (passing `token` prop) bypassing TanStack Router; mock `/api/invites/:token` (GET) and `/api/invites/:token/claim` (POST).

13. **Given** `pnpm -F @tournament/api typecheck` + `lint` + `pnpm -F @tournament/web typecheck` + `lint`
    **When** run post-T3-6
    **Then** all four exit 0. No new `any`. No new `// eslint-disable`.

14. **Given** `pnpm -F @tournament/api test` + `pnpm -F @tournament/web test`
    **When** run post-T3-6
    **Then** tournament-api ≥ baseline + 10. tournament-web ≥ baseline + 4. Baselines at story start: 324 (post-T3-5) + 25 (post-T3-5).

15. **Given** Wolf Cup workspaces
    **When** `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` run post-T3-6
    **Then** both continue to pass with zero net-negative test count change.

16. **Given** the deployed app at `https://tournament.dagle.cloud/invite/<token>`
    **When** Josh manually exercises the flow (anonymous browser, post-deploy)
    **Then**:
    - Page renders with event header + roster picker.
    - Tap a name → success surface with player name + event name.
    - DevTools → Application → Cookies: confirm `tournament_device_id` cookie set with correct attributes.
    - Reload page anonymously → still treated as "not signed in" (the device cookie doesn't trigger a session; T3-7 future story).
    - Try expired token (DB-edit `expires_at` to past, then load) → "this invite has expired" message.
    - Try non-existent token → "invite not found."
    Manual smoke results documented in completion notes.

17. **Given** SSO touchpoints
    **When** the dev agent inspects T3-6's diff
    **Then** zero changes to `apps/tournament-api/src/routes/auth.ts` (T1-6b OAuth flow). T3-6 does NOT call `validateSession`, does NOT issue session cookies, does NOT redirect to `/api/auth/google`. Anonymous-only flow.

18. **Given** there are no SHARED-file edits
    **When** the dev agent classifies its planned edits at impl time
    **Then** every touched path falls under ALLOWED. NOT touched: `pnpm-lock.yaml`, root `package.json`, any workspace `package.json`, `docker-compose.yml`, `Dockerfile*`, root tsconfig*, `.github`, `.gitignore`, root eslint, T1-6b's `auth.ts`.

## Tasks / Subtasks

- [ ] Task 1: Capture baselines. (AC #14)
  - [ ] Subtask 1.1: tournament-api baseline = 324 (post-T3-5).
  - [ ] Subtask 1.2: tournament-web baseline = 25 (post-T3-5).

- [ ] Task 2: Backend — create `invites.ts` route. (AC #1-#5)
  - [ ] Subtask 2.1: Define `ClaimRequestSchema` Zod (just `playerId`).
  - [ ] Subtask 2.2: GET /:token handler — token validation + roster JOIN + 200/404/410.
  - [ ] Subtask 2.3: POST /:token/claim handler — token validation + playerId-in-event check + cookie-aware INSERT/UPDATE branches + Set-Cookie response header.
  - [ ] Subtask 2.4: Helper to extract the `tournament_device_id` cookie value (mirror require-session.ts pattern).
  - [ ] Subtask 2.5: Helper to format the Set-Cookie header (HttpOnly + SameSite=Lax + Secure + Max-Age=7776000 + Path=/).

- [ ] Task 3: Register `inviteRouter` in `app.ts`. (AC #5)

- [ ] Task 4: Backend — write 10+ route tests. (AC #11)

- [ ] Task 5: Frontend — create `invite.$token.tsx`. (AC #6-#10)
  - [ ] Subtask 5.1: Dual-export Route + InvitePage.
  - [ ] Subtask 5.2: NO beforeLoad auth check (anonymous-friendly).
  - [ ] Subtask 5.3: useQuery for `GET /api/invites/:token`.
  - [ ] Subtask 5.4: useMutation for `POST /:token/claim`; AbortController via inFlightControllers ref + useEffect cleanup (mirror T3-3 / T3-5 pattern).
  - [ ] Subtask 5.5: Error states for 404 / 410 / 5xx.
  - [ ] Subtask 5.6: Success surface with player name + event name + placeholder schedule link.

- [ ] Task 6: Frontend — write 4+ component tests. (AC #12)

- [ ] Task 7: Run regressions. (AC #13, #14, #15)

- [ ] Task 8: Manual post-deploy smoke per AC #16. Document in completion notes.

## Dev Notes

- **Why anonymous (no auth) for both endpoints:** the entire point of FR-E1 (revised 2026-04-18) is "first-arrival friction is zero." Adding any auth gate breaks the user value. The token IS the auth — anyone with it gets read access + the ability to claim a player_id on their device.

- **Why `device_bindings.session_id = NULL` on first claim:** load-bearing for T3-7's post-SSO rebind. T3-7 looks up unclaimed device_bindings for the current device when the player completes SSO; the `session_id IS NULL` filter identifies "this device has bound a player_id but never SSOed."

- **Why the device-id cookie value IS the `device_bindings.id` (UUID):** keeps the cookie short and verifiable in one DB lookup. No HMAC signing required because the blast radius is bounded (no mutation surface). Future hardening could move to signed tokens but the v1 threat model accepts the tradeoff.

- **Why HttpOnly on the device cookie:** the frontend doesn't need to read it (the API does the lookup on every request). HttpOnly mitigates XSS reading the value. Consistent with the session cookie's posture.

- **Why SameSite=Lax not Strict:** the invite link is opened from external sources (text message, GroupMe). Strict would cause the cookie to NOT be sent on the first invite-page load, breaking the "I tap the link from the message app and it just works" flow. Lax sends the cookie on top-level navigations + same-origin requests; sufficient for v1.

- **Why no UPDATE-merge confirmation on cookie+row exists:** v1 single-event setup-day flow assumes the player will tap their own name. Re-tapping (e.g., wrong name first time) silently overwrites. Future polish: confirmation dialog "you previously claimed X — switch to Y?"

- **Why no rate limit on POST /:token/claim:** v1 single-event closed roster means brute-force enumeration of playerIds is bounded (8 names). Future multi-tenant or larger rosters would warrant rate-limiting.

- **Why the schedule link goes nowhere v1:** T7 (event home + schedule view) hasn't shipped. Pinning a placeholder is acceptable for setup-day testing — the organizer + players can confirm "you're in" message renders without needing the destination route.

- **Wolf Cup isolation (FD-1 / FD-2):** T3-6 writes only to `apps/tournament-api/src/routes/invites.{ts,test.ts}` (NEW), `apps/tournament-api/src/app.ts` (MODIFIED), `apps/tournament-web/src/routes/invite.$token.{tsx,test.tsx}` (NEW). Zero edits to `apps/api/**`, `apps/web/**`, `packages/engine/**`, T1-6b's `auth.ts`.

- **Retro AI-1 applied:** spec codex caps at 4 rounds OR zero-High-zero-Med, whichever first. Same for impl codex.
- **Retro AI-2 applied:** zero SHARED files pre-announced in §1.
- **Retro AI-3 applied:** the request schemas + cookie attributes ARE the contract. Tests assert exact JSON shapes + Set-Cookie headers.

### Project Structure Notes

Shape after T3-6:

```
apps/tournament-api/
  src/
    app.ts                              # MODIFIED: +inviteRouter mount at /api/invites
    routes/
      invites.ts                        # NEW: 2 endpoints (anonymous)
      invites.test.ts                   # NEW: 10+ tests

apps/tournament-web/
  src/
    routes/
      invite.$token.tsx                 # NEW: PUBLIC route (no beforeLoad auth)
      invite.$token.test.tsx            # NEW: 4+ tests
    routeTree.gen.ts                    # MODIFIED: auto-regen
```

**Explicitly NOT in T3-6 (reserved for future):**
- T3-7 post-SSO rebind: claims the unclaimed device_bindings row when the player completes SSO; updates `session_id` from NULL to the new sessions row. Out of T3-6 scope.
- Per-player invite share-targeting (an `invited_player_id` column on invites): v1.5+ feature.
- Read-only event surfaces (T7 event home, schedule, course preview, leaderboard).
- "That's not me" rebind action (T3-7).
- Rate limiting on /claim.
- Confirmation dialog before UPDATE-overwrite.

### References

- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` Story T3.6 (line 966-993).
- Predecessor stories: T1-6a (auth schema with sessions), T3-1 (invites + device_bindings + groups + group_members + players + events schema), T3-2 (events + invites created via wizard), T3-3 (group_members populated via group CRUD).
- T3-1 schema: `apps/tournament-api/src/db/schema/events.ts` (invites table), `apps/tournament-api/src/db/schema/groups.ts`, `apps/tournament-api/src/db/schema/device_bindings.ts` (NULLABLE session_id is load-bearing).
- T1-6a auth pattern (cookie helpers): `apps/tournament-api/src/lib/session.ts` (SESSION_COOKIE_NAME constant + sessionCookieHeader builder); `apps/tournament-api/src/middleware/require-session.ts` (cookie extractor pattern).
- T3-7 (consumer of unclaimed device_bindings): epic line 994-1015.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Tournament Director skill, single-cycle invocation 2026-04-27).

### Debug Log References

- Spec codex: 4 rounds (hit AI-1 cap; load-bearing for cookie semantics + cross-event protection). R1 2H+3M+1L (rolling-cookie inconsistency, created_at update on re-claim, device_info UA+IP vs UA-only, roster dedupe untested, multi-device claim unspecified, Set-Cookie test brittle). R2 0H+2M+1L (device_info §2 still mismatched; cross-event UPDATE corruption; Secure in local dev). R3 0H+1M+1L (Secure conditional vs unconditional). R4 0H+0M+1L (terminal clean).
- Impl codex: 1 round. **R1: ZERO findings.** Cleanest impl-codex run to date — the thorough spec-first iteration paid off.
- Mid-impl: lint flagged `let roster` → `const roster` (1 line); typecheck flagged `err.code = body?.code` under exactOptionalPropertyTypes (forced explicit `if (code !== undefined) err.code = code` pattern).
- Party-mode: single non-interactive written review. All 5 agents converged on "ship". Zero open questions. 15 non-blocking flags all defer/polish/v1-acceptable.
- Party-codex: 0H + 0M + 1L (test-count wording inconsistency only).

### Completion Notes List

**Test deltas:**
- tournament-api: 324 → 340 (+16 tests; 60% over AC #11 ≥10 minimum)
- tournament-web: 25 → 30 (+5 tests; 25% over AC #12 ≥4 minimum)
- Wolf Cup engine: 472 (unchanged ✓ AC #15)
- Wolf Cup api: 507 (unchanged ✓ AC #15)

**All checks green:** typecheck (api + web), lint (api + web), build (api + web; PWA precache 19 → 20 entries with invite.$token bundled).

**SHARED-gate footprint:** ZERO. Eighth tournament story without SHARED stops (T3-4 was the only one).

**Path footprint (5 files + 1 modified + 1 auto-regen, all ALLOWED):**
- `apps/tournament-api/src/routes/invites.ts` (NEW, ~330 lines — 2 anonymous endpoints, deviceCookieHeader builder, extractCookie helper)
- `apps/tournament-api/src/routes/invites.test.ts` (NEW, 15 tests)
- `apps/tournament-api/src/app.ts` (modified — register inviteRouter at /api/invites; NEW prefix; NOT under /api/admin)
- `apps/tournament-web/src/routes/invite.$token.tsx` (NEW, ~190 lines — first PUBLIC route, no beforeLoad)
- `apps/tournament-web/src/routes/invite.$token.test.tsx` (NEW, 5 tests)
- `apps/tournament-web/src/routeTree.gen.ts` (auto-regen)

**Deviations from spec / epic (all approved):**
- Pulled NEW /api/invites mount (not /api/admin) — anonymous endpoints don't belong under the admin umbrella; Winston's umbrella threshold doesn't tip.
- Cross-event UPDATE protection (R2 codex catch): existing device_binding's context_id must match `event:{currentEventId}` to UPDATE; else INSERT new + orphan old.
- created_at preserved on UPDATE (audit timestamp); only player_id + device_info mutate.
- device_info = UA-only (no IP for v1); truncated to 256 chars; consistent in BOTH branches.
- Secure cookie attribute conditional on NODE_ENV='production' (matches session.ts:181-193 pattern).
- Same playerId on multiple devices: each gets own row (T3-7 future consolidates post-SSO).
- 410 Gone for expired tokens; 404 for non-existent.
- First PUBLIC tournament-web route (no beforeLoad).

**Manual post-deploy smoke (AC #16):** PENDING.
- Required after deploy. Path: open `tournament.dagle.cloud/invite/<seeded-invite-token>` from a phone browser (verifies SameSite=Lax cookie behavior on top-level nav from messaging apps).
- Verify: roster picker renders with all crew members; tap-name → success surface; cookie set with HttpOnly + SameSite=Lax + Secure (production) + Path=/ + Max-Age=7776000; expired token → "this invite has expired" message.
- "Schedule coming soon" link goes nowhere (T7 future).

**Followups for future stories:**
- T3-7 (post-SSO device rebind) consumes the unclaimed device_bindings rows (`session_id IS NULL`) created by T3-6; updates `session_id` after OAuth completes.
- T7 read-only event surfaces (schedule, leaderboard, course preview) authenticate via the device cookie when session is absent.
- 5th /api/admin mount avoided in T3-6; T3-7 / T3-8 will likely tip the umbrella threshold.
- Future polish: re-claim UX for returning device (GET /:token reads cookie + returns "welcome back" with rebind escape hatch).
- Future hardening: per-token rate limit on POST /claim; signed cookies; device-info IP capture (with X-Forwarded-For caveats).
- Future polish: parameterize the "Ask Josh" copy with the organizer name from the event row.
- T3-6 acknowledged limitation: cookie sharing = impersonation (closed-roster + no-mutation-surface bound the v1 blast radius).

### File List

- `apps/tournament-api/src/routes/invites.ts` — new
- `apps/tournament-api/src/routes/invites.test.ts` — new
- `apps/tournament-api/src/app.ts` — modified
- `apps/tournament-web/src/routes/invite.$token.tsx` — new
- `apps/tournament-web/src/routes/invite.$token.test.tsx` — new
- `apps/tournament-web/src/routeTree.gen.ts` — auto-regenerated
