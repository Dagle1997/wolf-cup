# T3-10: Optional GHIN Enrichment Profile Action

## Status

Ready for Dev

## Story

As a player,
I want a "Link your GHIN" button in my profile that I can use any time post-SSO,
So that I can opt into cross-event stats without having GHIN block my ability to play (FR-E11 revised 2026-04-18).

T3-10 ships a `/profile` page (NEW, authed) that lets a player link or unlink their GHIN number, plus two new backend endpoints (POST link, PATCH unlink) that adapt the existing T3-4 GHIN client. **Linking is OPTIONAL — at no point does GHIN being NULL or lookup failing block the player from using the app.**

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. SHARED-gate footprint announced up-front (retro AI-2)

**Zero SHARED files expected.** No new deps, no env vars, no DB migrations (T3-1 schema already has `players.ghin` + partial UNIQUE index).

### 2. Existing schema already supports the link/unlink contract

T3-1 added `players.ghin TEXT` (nullable) + `uniq_players_ghin WHERE ghin IS NOT NULL` partial unique index. T3-10 mutates this column directly — no migration needed.

### 2.1. bodyLimit on POST + PATCH endpoints

POST `/me/ghin/link` and the two PATCH endpoints all have `bodyLimit({ maxSize: 4 * 1024 })` middleware (4 KB). Mirror of T3-3 admin-groups + T3-9 admin-event-rounds bodyLimit pattern. Body exceeding the cap → `400 body_too_large`. Without this explicit middleware, the `400 body_too_large` AC branch isn't testable — body limits are not auto-applied by Hono.

### 2.2. GET /status additive-field safety verified

T3-10 extends GET `/api/auth/status`'s success response with `ghin` + `manualHandicapIndex`. This is additive (no field removed, no field renamed). **Verified safe**: existing consumers (the SPA loader pattern in T2-3b/T2-5/T3-2/T3-3/T3-5/T3-7/T3-9 routes) use a manual `validateAuthStatus` function that explicitly extracts `id` + `isOrganizer` and ignores unknown keys — NOT a `Zod.strict()` validator. Codex round-1 raised this as a theoretical risk for any future strict-validating consumer; verified non-issue for v1, but if a future story introduces a strict validator, that story owner must update its schema. Pin in completion notes.

### 3. UNIQUE collision semantics on link

If a player tries to link a GHIN that's already bound to a different `players.id`, the partial UNIQUE constraint fires. T3-10's POST handler catches the libsql UNIQUE sentinel + returns `409 ghin_already_linked`. Mirror of T3-3 admin-groups + T1-6b auth.ts UNIQUE-retry pattern, but T3-10 does NOT retry — the user explicitly entered a GHIN; collision is a user-class error (not a race), so 409 surfaces it.

### 4. Reuse T3-4 GHIN client; do NOT duplicate

T3-10 backend imports `ghinClient` from `lib/ghin-client.ts` and calls `searchByName(lastName, firstName)` (returns multi-result array) + `getHandicap(ghinNumber)` (validates a specific number). When credentials are unset, both endpoints return `503 ghin_unavailable`, matching T3-4's posture. **No new GHIN client code; pure adapter on top of T3-4.**

### 5. Disambiguation flow (multi-match)

When the player searches by name + state and the GHIN client returns multiple results, the backend returns `200 { result: 'multi-match', matches: GhinSearchResult[], requestId }` (NOT an error). The frontend dispatches on the `result` discriminator (per AC #2 contract): renders a picker, player taps the right candidate, frontend re-submits with `mode: 'pick'` and the chosen `ghinNumber` → backend's `pick` handler validates via `getHandicap` and returns `200 { result: 'linked', ghinNumber, handicapIndex, requestId }`. Single match → backend auto-links + returns `result: 'linked'`. Zero matches → `404 ghin_not_found`. Lookup failure (network/auth) → `503 ghin_unavailable`.

### 6. Unlink does NOT delete the player or any rounds

PATCH `/api/players/me/ghin` sets `players.ghin = NULL`. The player's history (rounds, opt-ins, sessions, etc.) is intact. Re-linking via the form repeats the lookup. No cascade.

### 7. `manual_handicap_index` is unrelated to GHIN state

The schema column `players.manual_handicap_index` is a SEPARATE override field (T3-1). The /profile page surfaces it as a separate input that can be set independently of GHIN linkage. AC #5 in the epic source says this explicitly: "handicap index may be entered manually via `players.manual_handicap_index` (separate form field on profile, NOT linked to GHIN state)." T3-10 wires the input + a save endpoint — see AC #4 below.

### 8. Path footprint summary

ALLOWED edits expected:
- `apps/tournament-api/src/routes/players.ts` — MODIFIED (add 3 new routes: POST `/me/ghin/link`, PATCH `/me/ghin`, PATCH `/me/manual-handicap`)
- `apps/tournament-api/src/routes/players.test.ts` — MODIFIED (add tests for the 3 new routes)
- `apps/tournament-api/src/routes/auth.ts` — MODIFIED (extend GET `/status` response with `ghin` + `manualHandicapIndex`)
- `apps/tournament-api/src/routes/auth.test.ts` — MODIFIED (1 new test pinning the additive shape)
- `apps/tournament-web/src/routes/profile.tsx` — NEW
- `apps/tournament-web/src/routes/profile.test.tsx` — NEW
- `apps/tournament-web/src/routeTree.gen.ts` — auto-regen
- Story file + codex review files in `_bmad-output/`

NO SHARED edits expected. NO FORBIDDEN edits.

## Acceptance Criteria

1. **Given** `apps/tournament-api/src/routes/players.ts` (modified)
   **When** inspected post-T3-10
   **Then** the existing T3-4 routes (`GET /search`, `GET /lookup`) are UNCHANGED. Three NEW routes are added, all gated by `requireSession` (any authenticated player; not organizer-only):
   - `POST /api/players/me/ghin/link` — body shape per AC #2 below
   - `PATCH /api/players/me/ghin` — empty body, sets `players.ghin = NULL`
   - `PATCH /api/players/me/manual-handicap` — body `{ manualHandicapIndex: number | null }`

   Tenant-scoped pre-flight (per the post-T3-7/T3-9 hardening pattern for new code): every SELECT/UPDATE on `players` filters on `tenant_id = TENANT_ID`.

2. **Given** `POST /api/players/me/ghin/link`
   **When** invoked by an authenticated player
   **Then** body schema (Zod, discriminatedUnion):
   ```ts
   | { mode: 'direct',  ghinNumber: number }                // user typed a specific GHIN; lookup + bind
   | { mode: 'search',  lastName: string, firstName?: string, state?: string }   // search by name + auto-bind on single match
   | { mode: 'pick',    ghinNumber: number }                // user already saw a multi-match disambiguation list and picked one
   ```

   **Response shape uses an explicit `result` discriminator** (round-1 codex catch — divergent success shapes were ambiguous without one):
   ```ts
   | { result: 'linked',      ghinNumber: number, handicapIndex: number | null, requestId: string }
   | { result: 'multi-match', matches: GhinSearchResult[],                       requestId: string }
   ```
   The frontend dispatches on `result`: `'linked'` → render the linked-state UI; `'multi-match'` → render the picker.

   - **`direct` and `pick` modes**: invoke `ghinClient.getHandicap(ghinNumber)`. On 404 (GHIN doesn't exist) → `404 ghin_not_found`. On other lookup failure → `503 ghin_unavailable`. On success: UPDATE `players` SET `ghin = String(ghinNumber)` WHERE `id = session.playerId AND tenant_id = TENANT_ID`. On UNIQUE collision (the GHIN is already bound to a different player) → `409 ghin_already_linked`. Return `200 { result: 'linked', ghinNumber, handicapIndex, requestId }`.
   - **`search` mode**: invoke `ghinClient.searchByName(lastName, firstName)`. State param is accepted but currently ignored (T3-4 known limitation). Branches:
     - 0 matches → `404 ghin_not_found`.
     - 1 match → AUTO-LINK: UPDATE `players.ghin = String(matches[0].ghinNumber)`. Return `200 { result: 'linked', ghinNumber, handicapIndex, requestId }`.
     - 2+ matches → `200 { result: 'multi-match', matches: GhinSearchResult[], requestId }`. NO update yet; frontend renders picker; player re-submits with `mode: 'pick'`.
     - Lookup failure → `503 ghin_unavailable`.
   - All modes: 401 (anonymous via requireSession). Body parse / Zod failure → `400 invalid_body`. Body exceeding the 4 KB `bodyLimit` cap → `400 body_too_large` (mirror T3-3 / T3-9 pattern).

3. **Given** `PATCH /api/players/me/ghin`
   **When** invoked by an authenticated player
   **Then** UPDATE `players` SET `ghin = NULL` WHERE `id = session.playerId AND tenant_id = TENANT_ID`. Always idempotent (re-unlinking a NULL row succeeds). Return `200 { ghinNumber: null } + requestId`.

4. **Given** `PATCH /api/players/me/manual-handicap`
   **When** invoked by an authenticated player
   **Then**:
   - Body schema (Zod): `{ manualHandicapIndex: z.number().min(-10).max(54).nullable() }`. Bounds match the World Handicap System (WHS, USGA-spec since 2020): maximum 54.0, minimum -10.0 (per USGA Rules of Handicapping, Rule 5.2c plus-handicap range). Players with HI < -10.0 are vanishingly rare and already require manual federation paperwork; the bound prevents accidental data corruption (e.g., user types `100` instead of `10.0`).
   - UPDATE `players` SET `manual_handicap_index = :value` WHERE `id = session.playerId AND tenant_id = TENANT_ID`.
   - Return `200 { manualHandicapIndex } + requestId`. Independent of GHIN state.

5. **Given** `apps/tournament-web/src/routes/profile.tsx` (NEW)
   **When** inspected
   **Then**:
   - Exports `Route` (TanStack file route at `/profile`) and `ProfilePage`.
   - `beforeLoad` runs the 5-step auth-status loader (T2-3b pattern); anonymous → `window.location.assign('/api/auth/google')`. **NOT organizer-gated** (any authenticated player).
   - The page fetches `/api/auth/status` (already in cache from beforeLoad) AND a new GET endpoint to surface the player's current `ghin` + `manual_handicap_index` state. **For T3-10, this profile-state GET reuses the existing `/api/auth/status` shape extended with `ghin` + `manualHandicapIndex` — see AC #6.**

6. **Given** `GET /api/auth/status`
   **When** the response is inspected post-T3-10
   **Then** the response shape is EXTENDED (additive, NOT a breaking change):
   ```ts
   { player: null }
   | { player: { id: string, isOrganizer: boolean, ghin: string | null, manualHandicapIndex: number | null } }
   ```
   - The two new fields are populated by reading the `players` row at status-check time. Existing T2-3b consumers (loaders for admin pages) already read `id` + `isOrganizer` only; the additive fields are forward-compat.
   - Tenant-scope the SELECT: `WHERE id = sessionPlayerId AND tenant_id = TENANT_ID`.

7. **Given** the rendered `ProfilePage`
   **When** the player views it
   **Then**:
   - **GHIN state — `ghin IS NULL`**: heading "GHIN not linked" + "Link your GHIN" button → click reveals a form with two tabs:
     - Tab 1 "By GHIN number" — single input `ghinNumber` + Submit → POSTs `mode: 'direct'`.
     - Tab 2 "By name" — inputs `lastName` (required), `firstName` (optional), `state` (optional, default WV) + Submit → POSTs `mode: 'search'`.
   - **GHIN state — `ghin` populated**: heading "GHIN linked: <number>" + "Unlink" button → click opens confirmation dialog → confirm fires PATCH `/api/players/me/ghin`.
   - **Multi-match disambiguation**: when search returns 2+ results, render a picker list (each row: firstName + lastName + club + state) → click submits POST `mode: 'pick'` with that ghinNumber.
   - **404 / 503 / 409 errors**: each returns a friendly inline message; form preserved for retry.
   - **Manual handicap index**: separate form input ("Manual handicap index (optional)") with a number input + Save button → PATCH `/api/players/me/manual-handicap`. Visible regardless of GHIN state. Per AC #4 above.

8. **Given** AbortController-on-unmount pattern in `ProfilePage`
   **When** the user navigates away mid-mutation
   **Then** in-flight requests abort. Mirror T3-3/T3-5/T3-6/T3-7/T3-9 pattern (inFlightControllers ref + useEffect cleanup).

9. **Given** `apps/tournament-api/src/routes/players.test.ts` (modified)
   **When** `pnpm -F @tournament/api test` runs
   **Then** at least 12 tests cover:
   - POST /me/ghin/link `mode: 'direct'` happy: GHIN exists → players.ghin set, 200.
   - POST /me/ghin/link `mode: 'direct'` 404: GHIN not found.
   - POST /me/ghin/link `mode: 'direct'` 503: GHIN client unset.
   - POST /me/ghin/link `mode: 'direct'` 409: GHIN already bound to a different player.
   - POST /me/ghin/link `mode: 'search'` single match: AUTO-LINK + 200.
   - POST /me/ghin/link `mode: 'search'` multi-match: 200 { matches: [...] }; players.ghin UNCHANGED.
   - POST /me/ghin/link `mode: 'search'` zero matches: 404.
   - POST /me/ghin/link `mode: 'pick'` happy.
   - POST /me/ghin/link 401 anonymous.
   - POST /me/ghin/link 400 invalid_body (missing required fields).
   - PATCH /me/ghin happy: NULL → 200, players.ghin = NULL.
   - PATCH /me/ghin idempotent: already NULL → 200.
   - PATCH /me/ghin 401 anonymous.
   - PATCH /me/manual-handicap happy: 12.5 → 200, players.manual_handicap_index = 12.5.
   - PATCH /me/manual-handicap NULL: 200, manual_handicap_index = NULL.
   - PATCH /me/manual-handicap 400 invalid_body: out-of-bounds (e.g., 100).
   - PATCH /me/manual-handicap 401 anonymous.
   - GET /api/auth/status: returns the new `ghin` + `manualHandicapIndex` fields when authenticated.

10. **Given** `apps/tournament-web/src/routes/profile.test.tsx` (NEW)
    **When** `pnpm -F @tournament/web test` runs
    **Then** at least 5 tests cover:
    - Idle render with `ghin = null`: "Link your GHIN" button visible; manual-handicap input visible.
    - Idle render with `ghin` populated: "GHIN linked: <number>" + "Unlink" button visible.
    - Click "Link your GHIN" → form appears with two tabs (by-number, by-name).
    - Direct-mode submit → POST → success → page re-renders with linked state.
    - Search returns multi-match → disambiguation list renders → click candidate → POST `mode: 'pick'` → linked state.
    - Manual-handicap save → PATCH → success.
    - Unlink confirm flow.

11. **Given** `pnpm -F @tournament/api test`
    **When** run post-T3-10
    **Then** total tests ≥ baseline + 14. Baseline at story start: 392 (post-T3-9). The +14 covers AC #9 (18 minimum scenarios; some collapse together).

12. **Given** `pnpm -F @tournament/web test`
    **When** run post-T3-10
    **Then** total tests ≥ baseline + 5. Baseline at story start: 43 (post-T3-9).

13. **Given** Wolf Cup workspaces
    **When** `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` run post-T3-10
    **Then** both continue to pass with zero net-negative test count change.

14. **Given** typecheck + lint + build for both tournament workspaces
    **When** run post-T3-10
    **Then** all exit 0. No new `any`. No new `// eslint-disable`.

15. **Given** the deployed app post-T3-10
    **When** Josh manually exercises the flow
    **Then**:
    - Visit `/profile`. Verify "GHIN not linked" + "Link your GHIN" button.
    - Click button; tap "By name" tab; enter "Stoll" + "Josh"; submit. Verify either auto-link (single match) or disambiguation picker (multi-match).
    - On linked state, verify "GHIN linked: <number>" + "Unlink" button.
    - Set manual handicap index to e.g. 12.5; verify Save success.
    - Click "Unlink"; confirm; verify return to "GHIN not linked" state.

16. **Given** the FR-E11 non-blocking invariant
    **When** the T3-10 diff is reviewed at impl time
    **Then** **NO new code path** anywhere in the touched files (players.ts, auth.ts, profile.tsx) introduces a `players.ghin === null` or `manualHandicapIndex === null` guard that returns 4xx, 5xx, or redirects the user away from any surface. Linking is OPT-IN; failures (404 / 503 / 409) on the link endpoint MUST NOT mutate the player's existing state. The /profile page renders successfully with `ghin = null`. (This is a documentation invariant codified by inspection at impl time; impl-codex review will check for accidental gates.)

17. **Given** there are no SHARED-file edits
    **When** the dev agent classifies its planned edits at impl time
    **Then** every touched path falls under ALLOWED. Specifically NOT touched: `pnpm-lock.yaml`, `package.json`, `docker-compose.yml`, root files, schema files, migrations.

## Tasks / Subtasks

- [ ] Task 1: Capture baselines (392 / 43).

- [ ] Task 2: Backend — extend `players.ts` with the 3 new routes. (AC #1-#4)

- [ ] Task 3: Backend — extend `auth.ts` GET /status to include `ghin` + `manualHandicapIndex`. (AC #6)

- [ ] Task 4: Backend — extend `players.test.ts` + `auth.test.ts` with new tests. (AC #9)

- [ ] Task 5: Frontend — create `profile.tsx`. (AC #5, #7, #8)

- [ ] Task 6: Frontend — create `profile.test.tsx` with at least 5 tests. (AC #10)

- [ ] Task 7: Run regressions (typecheck, lint, build, all 4 test suites).

- [ ] Task 8: Manual post-deploy smoke per AC #15. Document in completion notes.

## Dev Notes

- **Why extend GET /status rather than add a separate `GET /api/players/me`?** GET /status is already polled by the SPA loader on every navigation (rolling session refresh). Reusing it for profile state avoids a second round-trip. The additive fields are forward-compat (existing consumers ignore unknown keys).

- **Why no UNIQUE retry on `mode: 'direct'` collisions?** A retry-loop assumes a race — but GHIN already-bound is almost certainly a user-class error: the player typed a number that belongs to someone else, or a club re-issued a number. 409 surfaces it loudly so the user can pick a different number; retry would just hide the conflict.

- **Why search-mode auto-link on single match?** UX shortcut. If only one Wendy Smith in WV exists in the GHIN database, no point making her tap a confirm button. If 2+ Wendy Smiths exist, the picker disambiguates.

- **Why a `mode: 'pick'` after disambiguation?** Two-stage flow: search returns matches; player chooses; client re-submits with `mode: 'pick'` carrying the chosen ghinNumber. The handler treats `pick` like `direct` — looks up the chosen number to confirm validity (in case the search results were stale or tampered) and binds. Defense-in-depth.

- **Why `players.ghin` stored as TEXT (not INTEGER)?** T3-1 schema decision. GHIN numbers are typically 7-10 digits but the Wolf Cup port stored them as strings to allow leading zeros + future format changes (e.g., GHIN 2.0 alphanumeric IDs). T3-10 follows the existing posture: `String(ghinNumber)` at write, `parseInt(ghin, 10)` at use sites that need numeric.

- **Why FR-E11 explicit "non-blocking" assertion?** Pre-2026-04-18 v1 plan made GHIN required; the revision made it OPTIONAL because Josh saw the "must enter GHIN to play" friction kill new-player onboarding. T3-10 ships the OPT-IN flow without any "GHIN required" gates. AC #16 codifies the invariant.

- **Tenant scoping (NEW code only).** Per T3-9's posture: every SELECT/UPDATE this story writes against `players` filters on `tenant_id = TENANT_ID`. Pre-T3-7 routes (T3-2/T3-3/T3-5) are NOT tenant-scoped — separate retrofit followup, NOT T3-10 scope.

- **Wolf Cup isolation (FD-1 / FD-2):** T3-10 writes only to `apps/tournament-api/src/routes/{players,auth}.{ts,test.ts}` + `apps/tournament-web/src/routes/profile.{tsx,test.tsx}`. Zero edits to `apps/api/**`, `apps/web/**`, `packages/engine/**`.

- **Retro AI-1 applied:** spec codex caps at 4 rounds OR zero-H-zero-M.
- **Retro AI-2 applied:** zero SHARED files pre-announced.

### Project Structure Notes

Shape after T3-10:

```
apps/tournament-api/
  src/
    routes/
      players.ts                                  # MODIFIED: +3 routes (link, unlink, manual-handicap)
      players.test.ts                             # MODIFIED: +new tests
      auth.ts                                     # MODIFIED: GET /status returns extended player shape
      auth.test.ts                                # MODIFIED: +1 test for new shape

apps/tournament-web/
  src/
    routes/
      profile.tsx                                 # NEW: GHIN link/unlink page + manual-handicap input
      profile.test.tsx                            # NEW
    routeTree.gen.ts                              # MODIFIED: auto-regen
```

**Explicitly NOT in T3-10 (reserved for future):**
- Linking the /profile page from a header/nav bar (no nav UI exists in v1).
- Refresh-from-GHIN action (re-fetching handicap index after initial link). The "current handicap" is read by future scoring stories (T5/T6) when needed; T3-10 just stores the binding.
- Cross-event aggregated stats based on ghin (FR-E11 hint; future story).
- Apple Sign-In equivalent flow.

### References

- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` Story T3.10 (line 1064-1090).
- Predecessor stories: T3-1 (players.ghin column + partial UNIQUE); T3-4 (GhinDirectClient + /search + /lookup endpoints); T2-3b (GET /api/auth/status shape); T1-6a (require-session middleware + sessions table).
- Pattern reference: T3-4 players.ts (GHIN client null-check + 503 posture); T3-3 admin-groups.ts (UNIQUE collision → 409 pattern).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
