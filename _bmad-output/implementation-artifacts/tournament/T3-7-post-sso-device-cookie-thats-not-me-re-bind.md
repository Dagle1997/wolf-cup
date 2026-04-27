# T3-7: Post-SSO Device Cookie + "That's Not Me" Re-bind

## Status

Ready for Dev

## Story

As a player completing SSO on a device,
I want my session bound to my player_id (with my prior invite-claim consolidated under my Google account), with a "that's not me" escape hatch,
So that the device is correctly identified for scoring/mutating flows (T5/T7), and I can recover if the app mistakenly identified me as someone else.

T3-7 extends T1-6b's OAuth callback with a device-binding-aware rebind path: when an invite-claimed (anonymous) device completes SSO, the existing device_binding's player_id is BOUND to the Google `sub` via a new `oauth_identities` row, and the device_binding's `session_id` flips from NULL → the new session's id. T3-7 also ships a "that's not me" endpoint + minimal UI page for users who land on the wrong player.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. SHARED-gate footprint announced up-front (retro AI-2)

**Zero SHARED files expected.** Same posture:
- Form state via React `useState`.
- No new deps.
- Tests via existing vitest.

**No `docker-compose.yml` changes. No env vars. No DB migrations** (T1-6a + T3-1 already shipped the relevant schema).

### 2. Architectural deviation from epic AC re: `players.google_sub`

**Critical:** the epic AC for T3-7 (line 1004) says "looks up `players.google_sub = :sub`" and "retroactively sets that player's `google_sub`". **This contradicts T1-6a's Fork 2b architecture** — `players.google_sub` does NOT exist as a column; provider-specific identity bindings live in `oauth_identities` (per `apps/tournament-api/src/db/schema/players.ts:7-15` comment). T3-1 explicitly skipped adding `google_sub` to `players` per the same Fork 2b decision.

**T3-7 follows the codebase architecture, NOT the epic's stale wording:**
- Lookup is `oauth_identities` WHERE `provider='google' AND provider_sub=:sub` (already what T1-6b's `lookupOrBindOAuthIdentity` does).
- Retroactive rebind = INSERT a new `oauth_identities` row binding the existing `device_binding.player_id` ↔ Google sub (NOT modifying any column on the players table).

This deviation is documented + intentional. Pin in completion notes.

### 3. OAuth callback rewrite scope

T1-6b's `apps/tournament-api/src/routes/auth.ts` has `lookupOrBindOAuthIdentity` (lines 384-464) — race-safe SELECT-or-INSERT for binding Google sub → player_id. T3-7 EXTENDS this function (NOT replaces it) with a new branch:

**Existing behavior** (preserved):
1. Outer SELECT `oauth_identities` WHERE `(tenant_id, provider, provider_sub)` → if found, return `player_id`.
2. Else: open `db.transaction`. Inner SELECT (race-safe) — if found, return.
3. Else: INSERT new `players` row + INSERT new `oauth_identities` row → return new `player_id`. Catch UNIQUE → retry SELECT.

**T3-7 changes the function signature and inserts a NEW step 2.5.**

**Signature change:** `lookupOrBindOAuthIdentity(sub: string, deviceBindingCookieValue: string | null): Promise<{ playerId: string; rebindOccurred: boolean; consolidatableDeviceBindingId: string | null }>`. The caller (OAuth callback handler) extracts the cookie value from the request and passes it in. The function returns enough context for the caller to know whether the post-session consolidation step (AC #2) should fire.

**Cookie-value shape guard.** Before passing `deviceBindingCookieValue` into the function (or as the first thing inside the function — implementer's choice; spec is contract-only), validate the value is a UUID-shaped string: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`. Anything else is treated as `null` (no cookie). Mirrors the T1-6a `require-session.ts:40` pattern of cheap shape-checking before DB hits. SQLite's TEXT-id semantics don't actually 500 on a malformed value (just returns 0 rows), but the guard keeps bot/garbage traffic from generating noisy SELECT log lines and codifies the "safe no-op" intent.

**`device_bindings` operations are tenant-scoped.** All SELECT / UPDATE / DELETE statements on `device_bindings` (in step 2.5, post-session consolidation, AND `/that-is-not-me`) MUST include `tenant_id = TENANT_ID` (the same `'guyan'` constant T3-6 uses; reuse the existing module-level export from invites.ts or duplicate locally per the project's "no refactor beyond the task" rule). Single-tenant v1 has no actual cross-tenant traffic, but the spec is defensive: a future second tenant on the same domain (e.g., `guyan-staff` for league-of-employees) would otherwise let a leaked/guessed UUID mutate or delete another tenant's bindings.

**Step 2.5 inserts** between the inner SELECT (no match) and the INSERT-new-player path. Already inside the `db.transaction`:

2.5a. If `deviceBindingCookieValue` is non-null:
   - SELECT `device_bindings` WHERE `id = :cookieValue`.
   - If 0 rows OR `session_id IS NOT NULL` (already consolidated): set `consolidatableDeviceBindingId = null`; fall through to step 3 (existing INSERT-new-player).
   - Else (1 row + `session_id IS NULL` — the rebind candidate):
     - SELECT `oauth_identities` WHERE `player_id = device_binding.player_id AND provider = 'google'`. **Scoped to provider='google' only** — v1 does NOT forbid multi-provider identities per player. A player who later adds Apple SSO (future T3.x) shouldn't be locked out of Google rebind, and vice versa.
     - **Case A — device-bound player has NO Google oauth identity yet:** INSERT new `oauth_identities` row binding `(tenant_id, provider='google', provider_sub=:sub, player_id=device_binding.player_id)`.
       - **UNIQUE-collision retry** (race-safe): if INSERT throws UNIQUE on `(tenant_id, provider, provider_sub)` (a concurrent SSO-completes raced and inserted ahead of us), retry-SELECT `oauth_identities` WHERE `(tenant_id, provider, provider_sub)`. If the retry finds a row with `player_id !== device_binding.player_id` → **throw `OAuthRebindConflictError`** (treat the race-winner as case C). If retry finds a row with `player_id === device_binding.player_id` → idempotent no-op; treat as case B.
       - On clean INSERT: return `{ playerId: device_binding.player_id, rebindOccurred: true, consolidatableDeviceBindingId: device_binding.id }`.
     - **Case B — device-bound player already has an oauth identity matching `(provider='google', provider_sub=:sub)`:** No-op (already bound). Return `{ playerId: device_binding.player_id, rebindOccurred: false, consolidatableDeviceBindingId: device_binding.id }` (caller still consolidates session_id since this row's session_id is still NULL).
     - **Case C — device-bound player already has a Google oauth identity with a DIFFERENT `provider_sub`:** Throw `OAuthRebindConflictError`. Prevents accidental rebind across two different Google accounts on the same player; explicit re-binding is admin-only via future `player_identity_merges`.

2.5b. Else (no cookie value OR fall-through from 2.5a): existing INSERT-new-player path. Return `{ playerId: newPlayerId, rebindOccurred: false, consolidatableDeviceBindingId: null }`.

### 4. Session creation + device_binding consolidation

After `lookupOrBindOAuthIdentity` returns `{ playerId, rebindOccurred, consolidatableDeviceBindingId }`, the existing `auth.ts` callback creates a session via `createSession(playerId, ...)`. T3-7 adds an extra step AFTER session creation:

- **The callback does NOT re-read `tournament_device_id` cookie at this point.** The cookie was already extracted ONCE at the top of the callback and passed into `lookupOrBindOAuthIdentity`. Re-reading would risk drift from the rebind decision (the High #1 regression class).
- If `consolidatableDeviceBindingId !== null`:
  - UPDATE `device_bindings` WHERE `id = consolidatableDeviceBindingId AND session_id IS NULL AND player_id = newSession.playerId`: set `session_id = newSession.sessionId`. The triple-WHERE makes the UPDATE a no-op under any race (another callback already consolidated, or the row was rebind-stolen between SELECT and UPDATE) rather than overwriting another player's binding.
  - Log `event: 'device_binding_consolidated'` with playerId + deviceBindingId + sessionId + `affectedRows` (0 or 1) so a no-op race is observable in logs.
- Else (`consolidatableDeviceBindingId === null`): no consolidation step (no device claim to consolidate; either no cookie, no matching row, the row was already consolidated at the time of the lookup, or this is a returning-user/new-player path).

The session cookie is set via the existing `setCookieHeader` from `createSession`. **The device cookie is left unchanged** on the rebind/consolidation path (it's already valid; the device_binding row is updated in place). The device cookie is only ever cleared by `/api/auth/that-is-not-me` (§5).

### 5. "That's not me" endpoint + UI

**Endpoint: `POST /api/auth/that-is-not-me`**
- Auth: `requireSession` (need a session to invalidate).
- Handler:
  1. Get current `session.sessionId` and `session.playerId` from the validated session (already exposed by `require-session.ts`).
  2. DELETE the `sessions` row WHERE `session_id = currentSessionId`.
  3. Read the `tournament_device_id` cookie. If present AND a `device_bindings` row exists with `id = cookieValue`:
     - DELETE that row (regardless of `session_id` state — wipe ALL trace of this device from invite-bindings).
  4. Emit `Set-Cookie` headers to clear BOTH the session cookie AND the device cookie (Max-Age=0).
  5. Return 204 No Content. The client handles the redirect.

**Frontend page: `/me` (authenticated)**
- TanStack file route at `apps/tournament-web/src/routes/me.tsx`.
- Auth gate: same 5-step auth-status loader; anonymous → `/api/auth/google`; non-organizer is FINE (this page is for ALL authed players, not organizer-only).
- Renders: "Signed in as {name}" (from `/api/auth/status` response).
- "That's not me" button → POST `/api/auth/that-is-not-me` → on 204, `window.location.assign('/invite/...')` if a recent invite token is in localStorage OR `window.location.assign('/api/auth/google')` for fresh sign-in.
- For v1, the simpler redirect: just `window.location.assign('/')` (home, which will trigger fresh auth check).

### 6. Conflict handling redirect target

When `lookupOrBindOAuthIdentity` throws `OAuthRebindConflictError` (case C above), the OAuth callback handler:
- Clears the OAuth flow intermediate cookies (state + verifier).
- Redirects to a NEW SPA route: `/auth/conflict` with a query param like `?reason=device_binding_conflict`.

The `/auth/conflict` page is a NEW PUBLIC route (no auth gate; the user just failed sign-in). It renders an explanation:
> "This device was previously claimed by a different sign-in. Tap 'That's not me' on the wrong account first, OR ask Josh to merge identities."

The "tap that's not me" instruction is informational — the page doesn't actually have a button (because the user isn't signed in to invoke /that-is-not-me; they'd need to sign in as the OTHER account first, which is impossible because the OAuth flow rejected them). For v1, the page is purely informational + advises contacting the organizer.

**Future polish:** auto-clear the device cookie on /auth/conflict mount + offer "try again" button. Out of T3-7 scope.

### 7. Auth + middleware

- OAuth callback (`GET /api/auth/google/callback`): existing route, EXTENDED handler. No new auth wrapping.
- POST /api/auth/that-is-not-me: `requireSession` only.
- Frontend `/me`: 5-step auth-status loader (organizer NOT required; any authenticated player).
- Frontend `/auth/conflict`: NO `beforeLoad` (PUBLIC; the user failed sign-in).

### 8. Test coverage targets (mandatory)

**≥10 backend tests** (extend `apps/tournament-api/src/routes/auth.test.ts`):

OAuth callback rebind path:
- T3-7 happy: device_binding (session_id=NULL) for player A + Google sub matches NO existing oauth → INSERT oauth_identity binding A ↔ sub; UPDATE device_binding.session_id. Verify both rows.
- T3-7 idempotent: device_binding for player A + oauth_identity already exists for A ↔ same sub → no-op INSERT (would hit UNIQUE; handler treats as already-bound).
- T3-7 conflict: device_binding for player A + oauth_identity for A ↔ DIFFERENT sub → redirect to `/auth/conflict?reason=device_binding_conflict`. NO session created. NO device_binding modified.
- T3-7 no-device-cookie: existing T1-6b path — INSERT new player + binding (no rebind branch fires).
- T3-7 device cookie present BUT row already has session_id (already consolidated): treats as no-cookie. Falls through to existing T1-6b path. **Verify**: NO unrelated device_binding row gets its session_id mutated.
- T3-7 device cookie present BUT cookie value doesn't match any row: same as no-cookie.
- **T3-7 stale device cookie + sub already bound to a DIFFERENT player (High #1 regression test):** outer SELECT in `lookupOrBindOAuthIdentity` finds `oauth_identities` matching `(provider='google', provider_sub=:sub)` → resolves player B (returning user). The device cookie points to a `device_binding` row for player A (session_id=NULL). `consolidatableDeviceBindingId` MUST be `null` (we resolved on the outer SELECT, never entered step 2.5). Verify: session created for player B; device_binding row for A is UNTOUCHED (`session_id` still NULL, `player_id` still A). This guarantees a stale invite-claim on the device can't leak into the returning user's session.
- **T3-7 returning user, no device cookie at all:** outer SELECT finds player B's existing identity → return early. No rebind branch. No consolidation UPDATE.
- **T3-7 consolidation UPDATE no-op under race (Low #4 from spec round 2):** simulate a race by manually UPDATEing `device_bindings.session_id` to a non-null value AFTER `lookupOrBindOAuthIdentity` returns `consolidatableDeviceBindingId !== null` but BEFORE the callback's UPDATE step fires. Verify: the triple-WHERE UPDATE affects 0 rows (does NOT overwrite the racer's session_id). The request still succeeds (session created normally). Log line `device_binding_consolidated` includes `affectedRows: 0` so the no-op is observable. The tactic: spy on `db.update` to mutate row state right before the .where() resolves, OR insert a row with session_id already set and pass its id as the rebind candidate via a doctored return. Whichever is cleaner under vitest's fake-timer/spy stack.
- **T3-7 multi-provider — non-Google identity does NOT block Google rebind (Low #3 from spec round 2):** device-bound player A already has `oauth_identities` row with `provider='apple'`. Google SSO completes for A's invite. Verify Case A fires: INSERT new `(provider='google', provider_sub=:sub, player_id=A)` row succeeds. NO conflict. session_id consolidation UPDATE fires.
- **T3-7 malformed device cookie — safe no-op (High #1 from spec round 4):** request arrives with `tournament_device_id=not-a-uuid`. Verify the rebind branch skips entirely (treats as null), the callback succeeds along the existing T1-6b path, no 500 thrown, no SELECT log noise on `device_bindings`. (Pair with `/that-is-not-me` smoke that also accepts a malformed cookie without 500.)
- **T3-7 cross-tenant device cookie — safe no-op (High #2 from spec round 4):** seed a `device_bindings` row with `tenant_id = 'other-tenant'`. Set the cookie to that row's id. Verify the rebind branch's tenant-scoped SELECT returns 0 rows; falls through to existing T1-6b path; no INSERT or UPDATE on the foreign-tenant row. (Pair with `/that-is-not-me` cross-tenant test that asserts the foreign row is NOT deleted.)

POST /that-is-not-me:
- happy path: organizer (or any authed player) calls → 204; sessions row deleted; device_bindings row for the cookie's device deleted; both cookies cleared (Max-Age=0).
- anonymous → 401 session_missing.
- no device cookie present: still works (deletes session + clears session cookie; nothing to delete on device side).
- device cookie present but bogus (no matching row): no-op on device side; session deleted.

**≥4 frontend component tests** (`apps/tournament-web/src/routes/me.test.tsx` NEW + `auth.conflict.test.tsx` NEW):

- /me idle: renders "Signed in as {name}" + "That's not me" button.
- /me click "That's not me": fires POST + redirects (mock window.location).
- /auth/conflict: renders the friendly error message.
- /me 401 redirect: anonymous → window.location.assign('/api/auth/google'). (Could be implicit via the auth-status loader.)

### 9. Path footprint summary

ALLOWED edits expected:
- `apps/tournament-api/src/routes/auth.ts` — MODIFIED (extend `lookupOrBindOAuthIdentity` with device-binding branch + add device_binding session_id update + add /that-is-not-me handler + emit `OAuthRebindConflictError`).
- `apps/tournament-api/src/routes/auth.test.ts` — MODIFIED (add the new tests above).
- `apps/tournament-api/src/routes/invites.ts` — MODIFIED (add NEW `deviceCookieClearHeader` exported helper next to existing `deviceCookieHeader`; do NOT modify `deviceCookieHeader`'s existing call shape).
- `apps/tournament-web/src/routes/me.tsx` — NEW
- `apps/tournament-web/src/routes/me.test.tsx` — NEW
- `apps/tournament-web/src/routes/auth.conflict.tsx` — NEW (PUBLIC route)
- `apps/tournament-web/src/routes/auth.conflict.test.tsx` — NEW
- `apps/tournament-web/src/routeTree.gen.ts` — auto-regen
- Story file + codex review files in `_bmad-output/`

NO SHARED edits expected. NO FORBIDDEN edits.

## Acceptance Criteria

1. **Given** `apps/tournament-api/src/routes/auth.ts` (modified)
   **When** the existing `lookupOrBindOAuthIdentity` function is inspected
   **Then** its signature is `lookupOrBindOAuthIdentity(sub: string, deviceBindingCookieValue: string | null): Promise<{ playerId: string; rebindOccurred: boolean; consolidatableDeviceBindingId: string | null }>` — caller (the OAuth callback handler) extracts the cookie value once and passes it in. The cookie is NEVER re-read inside the consolidation step in the callback (see AC #2).

   **The execution order is fixed and load-bearing:**
   1. **Outer SELECT (unchanged from T1-6b):** `oauth_identities` WHERE `(tenant_id, provider='google', provider_sub=:sub)`. If found → return `{ playerId: row.player_id, rebindOccurred: false, consolidatableDeviceBindingId: null }`. **`consolidatableDeviceBindingId` MUST be null on this branch** — this is the returning-user case; even if the device cookie points at some unrelated device_binding row, that row MUST NOT be consolidated under the returning user's session. (High #1 regression guard.)
   2. **Open `db.transaction`. Inner SELECT (race-safe, unchanged):** same WHERE. If found → return as outer SELECT did.
   3. **NEW step 2.5 — rebind branch:** if `deviceBindingCookieValue` is non-null AND UUID-shaped (per the shape-guard in §3 of Risk Acceptance):
      - SELECT `device_bindings` WHERE `id = :cookieValue AND tenant_id = TENANT_ID`. (Tenant scoping is required on every `device_bindings` operation in T3-7; see §3.)
      - If 0 rows OR `session_id IS NOT NULL`: fall through to step 4. (`consolidatableDeviceBindingId` will be `null` from the eventual return.)
      - Else (1 row + session_id IS NULL):
        - SELECT `oauth_identities` WHERE `player_id = device_binding.player_id AND provider = 'google'` — provider-scoped per the v1 policy that other providers (Apple etc) on the same player do NOT block Google rebind.
        - **Case A** (0 rows): INSERT `oauth_identities` `(tenant_id, provider='google', provider_sub=:sub, player_id=device_binding.player_id, context_id, created_at)`.
          - **UNIQUE-collision retry:** if INSERT throws UNIQUE on `(tenant_id, provider, provider_sub)`, retry-SELECT `oauth_identities` WHERE that key. If retry-row's `player_id !== device_binding.player_id` → throw `OAuthRebindConflictError` (race-winner is a different player; treat as Case C). If retry-row's `player_id === device_binding.player_id` → idempotent (treat as Case B).
          - On clean INSERT: return `{ playerId: device_binding.player_id, rebindOccurred: true, consolidatableDeviceBindingId: device_binding.id }`.
        - **Case B** (1 row matching `(provider='google', provider_sub=:sub)`): no-op. Return `{ playerId: device_binding.player_id, rebindOccurred: false, consolidatableDeviceBindingId: device_binding.id }`. Caller still consolidates session_id (the row's session_id is still NULL).
        - **Case C** (1 row matching `provider='google'` but with a DIFFERENT `provider_sub`): throw `OAuthRebindConflictError`. Two different Google accounts can't both bind to one player; this is an identity-merge scenario, admin-only.
   4. **Step 4 (unchanged from T1-6b):** INSERT new `players` row + INSERT new `oauth_identities` row. Catch UNIQUE → retry SELECT and return. Return `{ playerId: newPlayerId, rebindOccurred: false, consolidatableDeviceBindingId: null }`.

   The whole sequence (steps 2 through 4) runs inside a single `db.transaction`, mirroring T1-6b's existing race-safe pattern.

2. **Given** the OAuth callback handler (`GET /api/auth/google/callback`)
   **When** `lookupOrBindOAuthIdentity` returns successfully with `consolidatableDeviceBindingId !== null`
   **Then** AFTER session creation, the handler:
   - UPDATE `device_bindings` SET `session_id = newSession.sessionId` WHERE `id = consolidatableDeviceBindingId AND session_id IS NULL AND player_id = resolvedPlayerId AND tenant_id = TENANT_ID`. (The quadruple-WHERE guard is defense-in-depth: even if a concurrent request raced ahead and set session_id, rebound the row, or somehow targeted a foreign tenant's binding, the UPDATE becomes a no-op rather than overwriting another player's/tenant's session.)
   - Emit structured log `event: 'device_binding_consolidated'` with playerId + deviceBindingId + sessionId + `affectedRows` (0 or 1).

   **When** `consolidatableDeviceBindingId === null` (no rebind candidate — either no cookie, cookie didn't match, the row was already consolidated, or the device-binding's player is unrelated to the SSO sub)
   **Then** NO consolidation UPDATE fires. The post-callback flow proceeds with session creation only. **Critically, the handler does NOT independently re-read the device cookie to gate consolidation** — that check lives entirely inside `lookupOrBindOAuthIdentity` so the rebind decision and the consolidation decision use the same atomic SELECT result. (Prevents High #1: stale device cookies on a NEW-player SSO path can no longer leak into another player's session.)

3. **Given** `lookupOrBindOAuthIdentity` throws `OAuthRebindConflictError`
   **When** caught by the OAuth callback handler
   **Then**:
   - Clear OAuth flow intermediate cookies (state + verifier) — same hygiene as other failure paths.
   - Redirect 302 to `${PUBLIC_APP_URL}/auth/conflict?reason=device_binding_conflict`. NO session is created. NO device_binding is modified.

4. **Given** `POST /api/auth/that-is-not-me`
   **When** invoked by an authenticated user
   **Then**:
   - Get the current `sessionId` from `c.get('session').sessionId` — confirmed populated by `apps/tournament-api/src/middleware/require-session.ts:52` (`c.set('session', { sessionId, playerId })` after validation). The handler MUST use this single source — do NOT re-parse the cookie or re-validate. The middleware contract is the authoritative gate.
   - DELETE FROM `sessions` WHERE `session_id = currentSessionId`.
   - Read `tournament_device_id` cookie. If present AND UUID-shaped (same regex as Risk Acceptance §3), DELETE FROM `device_bindings` WHERE `id = cookieValue AND tenant_id = TENANT_ID` (regardless of `session_id` state). Tenant scoping is mandatory; see §3.

   - **Cookie-clearing implementation note.** The current `deviceCookieHeader` in `apps/tournament-api/src/routes/invites.ts:70-82` is `function deviceCookieHeader(value: string)` with `Max-Age` hardcoded to `DEVICE_COOKIE_MAX_AGE_S` (90 days). T3-7 introduces a **new helper `deviceCookieClearHeader()`** colocated with the existing helper (in invites.ts so the attributes stay paired with the setter). Signature: `function deviceCookieClearHeader(): string`. Body: emits `tournament_device_id=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` plus `Secure` conditionally appended in production — exact attribute parity with `deviceCookieHeader` for browser-respected clear. Export both helpers from invites.ts. **Do NOT modify `deviceCookieHeader`'s existing signature** — T3-6's tests pin its current call shape and behavior; T3-7's clear path is a sibling helper, not a refactor.

   - Emit two `Set-Cookie` clear headers using **append semantics**:
     - `c.header('Set-Cookie', sessionCookieHeader(null), { append: true })` — uses the existing T1-6a `sessionCookieHeader(null)` builder which already emits Max-Age=0 with all other attributes mirrored.
     - `c.header('Set-Cookie', deviceCookieClearHeader(), { append: true })` — uses the NEW helper above.
   - Both headers MUST land on the response — Hono's default `c.header` SETS (overwrites prior values), so without `{ append: true }` the second call clobbers the first and only one cookie clears.
   - Both clear headers MUST mirror the original cookie's attributes (HttpOnly + SameSite=Lax + Path=/ + conditional Secure in production for the device cookie; Domain + SameSite + Path + conditional Secure for the session cookie per session.ts:177-197). Browsers ignore Set-Cookie for "clear" intent if the attributes (especially Path / Domain) don't match the original — wrong attrs = ghost cookie that survives.
   - Return 204 No Content (no body).
   - Anonymous caller → 401 session_missing (via requireSession middleware).

5. **Given** `apps/tournament-web/src/routes/me.tsx` (NEW)
   **When** inspected
   **Then** it exports `Route` (TanStack file-route at `/me`) and `MePage`. The `beforeLoad` reuses the 5-step auth-status loader (T2-3b pattern); anonymous → `window.location.assign('/api/auth/google')`. Organizer NOT required; any authenticated player can view.

6. **Given** the `/me` page rendered for an authed user
   **When** rendered
   **Then**:
   - Heading "Your account" + paragraph "Signed in as {name}." (name from the auth-status loader's player object).
   - "That's not me" button. On click → POST `/api/auth/that-is-not-me` → on 204, `window.location.assign('/')` (home; subsequent loads will see no session and re-trigger auth as needed).
   - Button disabled while mutation in-flight. Error path: render "Couldn't sign out — please try again."

7. **Given** `apps/tournament-web/src/routes/auth.conflict.tsx` (NEW)
   **When** inspected
   **Then** it exports `Route` (TanStack file-route at `/auth/conflict`) and `ConflictPage`. **No `beforeLoad`** — PUBLIC (the user failed sign-in). Renders an informational message: "This device was previously claimed by a different sign-in. Tap 'That's not me' on the wrong account first, OR ask Josh to merge identities."

8. **Given** AbortController-on-unmount pattern in `/me`
   **When** the user navigates away mid-mutation
   **Then** the in-flight POST aborts. Mirror T3-3 / T3-5 / T3-6 pattern (inFlightControllers ref + useEffect cleanup).

9. **Given** existing T1-6b auth.test.ts behavior
   **When** the suite runs post-T3-7
   **Then** all existing T1-6b tests continue to pass (unchanged behavior). New tests are ADDITIVE — extending the file, not rewriting it.

10. **Given** `pnpm -F @tournament/api test`
    **When** run post-T3-7
    **Then** total tests ≥ baseline + 16. Baseline at story start: 340 (post-T3-6). The +16 covers the §8 test plan (12 OAuth callback rebind variations + 4 that-is-not-me).

11. **Given** `pnpm -F @tournament/web test`
    **When** run post-T3-7
    **Then** total tests ≥ baseline + 4. Baseline at story start: 30 (post-T3-6).

12. **Given** Wolf Cup workspaces
    **When** `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` run post-T3-7
    **Then** both continue to pass with zero net-negative test count change.

13. **Given** typecheck + lint + build for both tournament workspaces
    **When** run post-T3-7
    **Then** all exit 0. No new `any`. No new `// eslint-disable`.

14. **Given** the deployed app post-T3-7
    **When** Josh manually exercises the flow
    **Then**:
    - **Path A (rebind happy):** anonymously visit `/invite/<token>`, tap a player name (creates device_binding with session_id=NULL). Then visit `/api/auth/google`, complete SSO. Verify: `device_binding` row's `session_id` is now non-null; `oauth_identities` has a row binding the player ↔ Google sub.
    - **Path B (rebind conflict):** anonymously claim a player via invite. SSO. Verify success. Sign out. Anonymously claim a DIFFERENT player on the same device (cookie still set; UPDATE branch fires). SSO with the SAME Google account. Verify redirect to `/auth/conflict` (the device-bound player has a different oauth than the new sub).
    - **Path C (that's not me):** sign in. Visit `/me`. Click "That's not me". Verify: redirected to `/`; reloading shows anonymous state; cookies cleared in DevTools.

15. **Given** there are no SHARED-file edits
    **When** the dev agent classifies its planned edits at impl time
    **Then** every touched path falls under ALLOWED. Specifically NOT touched: `pnpm-lock.yaml`, `package.json`, `docker-compose.yml`, root files.

## Tasks / Subtasks

- [ ] Task 1: Capture baselines.

- [ ] Task 2: Backend — extend `auth.ts`. (AC #1-#4)
  - [ ] Subtask 2.1: Define `OAuthRebindConflictError` typed error class.
  - [ ] Subtask 2.2: Extend `lookupOrBindOAuthIdentity` with the device-binding branch.
  - [ ] Subtask 2.3: After session creation in the callback, add the `device_binding.session_id` UPDATE.
  - [ ] Subtask 2.4: Catch `OAuthRebindConflictError` in the callback → redirect to /auth/conflict.
  - [ ] Subtask 2.5: Add POST /api/auth/that-is-not-me handler.

- [ ] Task 3: Backend — extend `auth.test.ts` with 10+ new tests.

- [ ] Task 4: Frontend — create `me.tsx` + `me.test.tsx`. Mirror T3-3/T3-5/T3-6 patterns (auth-status loader, useMutation, AbortController).

- [ ] Task 5: Frontend — create `auth.conflict.tsx` + test. PUBLIC route.

- [ ] Task 6: Run regressions (typecheck, lint, build, all 4 test suites).

- [ ] Task 7: Manual post-deploy smoke per AC #14. Document in completion notes.

## Dev Notes

- **Why deviation from epic re: `players.google_sub`:** the codebase's Fork 2b architecture (T1-6a + T3-1 acknowledged this) keeps provider-specific identifiers in `oauth_identities`. The epic AC predates this decision. T3-7 follows the architecture, not the stale epic wording. Documented in spec + completion notes.

- **Why typed error class for the rebind conflict:** `OAuthRebindConflictError` lets the handler distinguish "sub already bound to a different player" from generic exceptions. A simple `throw new Error('CONFLICT')` would work but loses semantic clarity for future readers.

- **Why `/auth/conflict` is a SPA route + redirect (not 409 JSON):** OAuth callback is a redirect-based flow ending in a `Set-Cookie` + `302`. Returning JSON would break the user's browser. The /auth/conflict route is the "you failed sign-in" landing page.

- **Why `/me` not a button on every authed page:** v1 has very few authed UI surfaces (admin pages mostly). Future T7 player pages will add the button to common surfaces. T3-7 ships the action endpoint + a single demo/escape-hatch page.

- **Why session cookie cleared with same attributes as set:** T1-6a's `sessionCookieHeader(null)` builder handles this — emitting Max-Age=0 with all other attributes matching. T3-7 leverages it via `c.header('Set-Cookie', sessionCookieHeader(null))`.

- **Why device cookie clearing also goes through a builder:** consistency. `deviceCookieHeader('', maxAge=0)` would clear it. Or build inline: `tournament_device_id=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` (+ Secure in prod).

- **Wolf Cup isolation (FD-1 / FD-2):** T3-7 writes only to `apps/tournament-api/src/routes/auth.{ts,test.ts}` (modified) + `apps/tournament-web/src/routes/{me, auth.conflict}.{tsx,test.tsx}` (new). Zero edits to `apps/api/**`, `apps/web/**`, `packages/engine/**`.

- **Retro AI-1 applied:** spec codex caps at 4 rounds OR zero-H-zero-M.
- **Retro AI-2 applied:** zero SHARED files pre-announced.

### Project Structure Notes

Shape after T3-7:

```
apps/tournament-api/
  src/
    routes/
      auth.ts                                   # MODIFIED: lookupOrBindOAuthIdentity + callback + /that-is-not-me
      auth.test.ts                              # MODIFIED: +14 tests
      invites.ts                                # MODIFIED: +deviceCookieClearHeader sibling helper

apps/tournament-web/
  src/
    routes/
      me.tsx                                    # NEW: signed-in identity page
      me.test.tsx                               # NEW
      auth.conflict.tsx                         # NEW: PUBLIC error page
      auth.conflict.test.tsx                    # NEW
    routeTree.gen.ts                            # MODIFIED: auto-regen
```

**Explicitly NOT in T3-7 (reserved for future):**
- "That's not me" button on every authenticated page (T7 player pages).
- Admin "merge player identities" action (T5+ via `player_identity_merges` table).
- Auto-clear device cookie on /auth/conflict mount + "try again" UX.
- Session listing / device management UI.

### References

- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` Story T3.7 (line 994-1016).
- Predecessor stories: T1-6a (auth schema + sessions), T1-6b (OAuth callback + lookupOrBindOAuthIdentity), T3-1 (device_bindings schema with NULLABLE session_id), T3-6 (invite-claim creates device_bindings rows).
- T1-6b auth.ts:384-464 — existing `lookupOrBindOAuthIdentity` race-safe pattern that T3-7 extends.
- T3-1 schema: `apps/tournament-api/src/db/schema/device_bindings.ts` (sessionId NULLABLE FK ON DELETE SET NULL is the load-bearing column for T3-7).
- T1-6a: `apps/tournament-api/src/lib/session.ts:177-197` (sessionCookieHeader builder; clear-cookie via `null` value).
- T3-6: `apps/tournament-api/src/routes/invites.ts` (deviceCookieHeader + extractCookie patterns to mirror).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
