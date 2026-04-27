# T3-3: Group CRUD UI

## Status

Done

## Story

As an organizer (Josh),
I want to manage a Group's roster (add/remove players via GHIN search OR manual entry; view members) and edit its name + money_visibility_mode (v1 locked to `open`; others stubbed),
So that I can shape the 8-player Pinehurst Crew from within the app — binding GHIN numbers when available (handicap fetched/refreshed by a future T3-10 action; v1 stores the binding only) and capturing manual handicaps for non-GHIN players.

T3-3 is the second user-facing T3 story. It consumes T3-1 schema (groups + group_members + players) AND T3-4's GHIN client (search + lookup endpoints) to ship the full epic AC. Adds 4 new backend endpoints + 1 new SPA route.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. SHARED-gate footprint announced up-front (retro AI-2)

**Zero SHARED files expected.** Same posture as T2-5 + T3-2:

- **Form state:** React `useState` (NOT `react-hook-form`). The page has 3 small forms (group header / add-player / per-row remove); hand-rolled state is fine.
- **Validation:** hand-rolled Zod safeParse on submit; no @hookform/resolvers/zod.
- **Backend:** existing `@libsql/client` + `drizzle-orm`. The GHIN client is the existing `ghinClient` singleton from T3-4; no new lib code.
- **Tests:** existing `vitest` + `@testing-library/react`. No new test infra.

If during impl the dev agent identifies a true blocker that requires a SHARED edit, it pauses for user approval at that moment. **Likely candidates: NONE expected.**

**No `docker-compose.yml` changes. No `Dockerfile` changes. No env vars. No new CI checks. No DB migrations** (T3-1 schema covers everything T3-3 needs).

### 2. Endpoint design (4 new endpoints)

All four defined on a new `adminGroupsRouter` (Hono instance) which is mounted at `/api/admin` in `app.ts` (matching the existing `adminCoursesRouter` + `adminEventsRouter` pattern). The router itself defines paths PREFIXED with `/groups`:

1. **`GET /groups/:groupId`** — fetch group + members.
   - Auth: requireSession → requireOrganizer.
   - Response: `{ id, name, eventId, moneyVisibilityMode, members: [{ playerId, name, ghin, manualHandicapIndex, preferredTeeColor }] }`. Members ordered by `players.name ASC` for stable display.
   - 404 `group_not_found` if the group doesn't exist.

2. **`PATCH /groups/:groupId`** — update group header.
   - Auth: requireSession → requireOrganizer.
   - Body Zod: `{ name?: string.trim().min(1), moneyVisibilityMode?: 'open' | 'participant' | 'self_only' }`. At least one field required (Zod refine).
   - **v1 limitation:** the schema accepts all 3 visibility-mode values (`participant` and `self_only` exist for v1.5 readiness per T3-1's CHECK constraint), but the handler explicitly rejects `participant` and `self_only` with 400 `mode_not_v1` until those modes are wired. The UI displays them as disabled with a "v1.5" tooltip, BUT defense-in-depth at the API layer guards against an organizer forcing through via direct API call.
   - 404 `group_not_found`. 400 `invalid_body` on Zod miss. 400 `mode_not_v1` on rejected visibility modes.

3. **`POST /groups/:groupId/members`** — add a player to the group. Two body shapes via `mode` discriminator:
   - **`{ mode: 'ghin', ghin: number, firstName: string, lastName: string }`** — GHIN-based add. firstName/lastName come from the GHIN search result UI the organizer clicked on (T3-4's GhinSearchResult already contains them). Handler does NOT call ghinClient at add time — purely a DB op: SELECT-then-race-safe-INSERT player by ghin (mirror auth.ts:384-464 pattern), then INSERT group_member.
   - **`{ mode: 'manual', name: string, manualHandicapIndex?: number }`** — manual add. ALWAYS INSERT new player (no name-based reuse). Then INSERT group_member.
   - Auth: requireSession → requireOrganizer → bodyLimit(4 KB).
   - Pre-flight `SELECT id FROM groups WHERE id = :groupId` → 404 `group_not_found` if missing (turns FK violation into clean 404).
   - 409 `player_already_in_group` if the composite-PK UNIQUE on group_members fires.
   - **`manualHandicapIndex` is NULL for GHIN-bound adds.** The column is the override for non-GHIN players. Storing a GHIN snapshot there would conflate semantics. v1 tradeoff: T3-3's member table shows "—" for GHIN-bound handicap; T3-10 refresh-from-GHIN action handles live display.
   - Response: 201 `{ player: { id, name, ghin, manualHandicapIndex, preferredTeeColor }, groupMember: { groupId, playerId } }`.

4. **`DELETE /groups/:groupId/members/:playerId`** — remove a player from the group.
   - Auth: requireSession → requireOrganizer.
   - Handler: `DELETE FROM group_members WHERE group_id = ? AND player_id = ?`. Returns 204 on success; 404 `member_not_found` if the row didn't exist.
   - **The players row is NOT deleted** — they may exist in other groups or future events. Per T3-1 schema, `group_members.player_id` is FK ON DELETE RESTRICT precisely to prevent organizer-action cascading into player deletion.

### 3. Players reuse semantics

- **GHIN-based add:** `SELECT id FROM players WHERE ghin = ?`. If exists, reuse. Else INSERT new player. Then INSERT group_member. The `players.ghin` partial unique index (T3-1) makes this safe.
  - Edge case: a player exists in players table with no GHIN, gets re-added via GHIN flow with the SAME name. Two rows created (one without GHIN from a prior manual add; one with GHIN from this add). They're DIFFERENT player_id values. Acceptable for v1; the organizer can manually delete the no-GHIN duplicate. Future polish: GHIN-merge action.
- **Manual add:** ALWAYS INSERT new player. No reuse. Avoids fragile name-based matching ("Josh Stoll" vs "Joshua Stoll"). If a name collision is real, the organizer notices in the member list and removes the dupe.
- **`group_members` UNIQUE:** the composite PK `(group_id, player_id)` (T3-1) prevents adding the same player_id to the same group twice. Catch via 409 `player_already_in_group`.

### 4. Auth + middleware

- **PATCH + POST endpoints** (have request bodies): `requireSession → requireOrganizer → bodyLimit({ maxSize: 4 KB }) → handler`.
- **GET + DELETE endpoints** (no request bodies): `requireSession → requireOrganizer → handler` (NO bodyLimit; nothing to limit).
- `bodyLimit` returns `{ error: 'bad_request', code: 'body_too_large', requestId }` on overrun (matches T2-5 + T3-2 JSON-endpoint shape).
- Frontend route's `beforeLoad`: same 5-step auth-status loader as T2-3b/T2-5/T3-2. Anonymous → `window.location.assign('/api/auth/google')`; non-organizer → ForbiddenMessage; organizer → render the page.

### 5. UI scope: minimal but functional, NOT a redesign

Single page at `/admin/groups/:groupId/edit`. Goals:

- **Group header section.** Editable name (text input + Save button). Money-visibility-mode selector (radio with 3 options; only `open` is v1-saveable; the other two are disabled with `title="v1.5 — coming soon"` tooltip).
- **Members table.** One row per group_member. Columns: Name, GHIN (or "—"), Handicap (manual value if present, "—" otherwise — including for GHIN-bound players whose handicap is fetched live by T3-10's future refresh action; v1 explicitly does NOT live-lookup at render time), Remove button. Sorted by name ASC.
- **Add Player section.** Tab toggle between "GHIN Search" and "Manual Entry":
  - **GHIN Search tab:** name input + Search button → calls `GET /api/players/search?name=<lastname>` → list of results → "Add" button per result → calls `POST /api/admin/groups/:groupId/members` with `{ mode: 'ghin', ghin, firstName, lastName }`. Shows "GHIN unavailable — use Manual Entry" if 503.
  - **Manual Entry tab:** name input + optional handicap input + "Add" button → calls `POST /api/admin/groups/:groupId/members` with `{ mode: 'manual', name, manualHandicapIndex }`.

- **State machine:** TanStack Query for fetching group + invalidating on mutations. `useMutation` for PATCH/POST/DELETE. Optimistic updates not used (server roundtrip is fast; correctness > perceived perf).

NOT in T3-3:
- Group create / delete (events wizard creates the default group; future story for organizer-driven group creation).
- Cross-group player move (remove + add in two clicks works for v1).
- Player edit (rename, change GHIN, etc.) — future polish.
- preferred_tee_color column collection — future polish (T3-1 schema allows it; UI doesn't surface yet).
- Bulk player import (CSV, etc.) — future.
- Pagination (Pinehurst crew is 8 players; v1 fits on one screen).

### 6. Test coverage targets (mandatory)

**≥12 backend route tests** (`apps/tournament-api/src/routes/admin-groups.test.ts`, NEW; matches AC #17):

- GET happy path: organizer fetches group → 200 with members array sorted by name.
- GET 404: unknown groupId → 404 `group_not_found`.
- GET auth: anonymous → 401; non-organizer → 403.
- PATCH name change: 200 + verify DB updated.
- PATCH visibility 'open' → 200; 'participant' → 400 `mode_not_v1`; 'self_only' → 400 `mode_not_v1`.
- POST add by GHIN (new player): 201, verify players + group_members rows.
- POST add by GHIN (existing player with same GHIN): 201, REUSES player_id; one new group_members row, no new players row.
- POST add manual: 201, verify NEW players row.
- POST add duplicate (same player already in group): 409 `player_already_in_group`.
- (Removed: T3-3's add-by-GHIN body shape A does NOT call ghinClient at add time, so 503 ghin_unavailable cannot fire from this endpoint. /api/players/search is the only T3-3 path that touches the GHIN client; that test lives in T3-4's suite.)
- DELETE member: 204; verify group_members row gone, players row INTACT.
- DELETE non-existent member: 404 `member_not_found`.

**≥4 frontend component tests** (`apps/tournament-web/src/routes/admin.groups.$groupId.edit.test.tsx`, NEW):

- Idle render: shows group name, member list, add-player tabs.
- GHIN search flow: enter name + Search → mock /api/players/search returns results → click "Add" → mock POST /:groupId/members 201 → member appears in list.
- Manual entry flow: switch to Manual tab → enter name + handicap → click Add → mock POST 201 → member appears in list.
- Remove member: click Remove → mock DELETE 204 → member disappears from list.

### 7. Path footprint summary

ALLOWED edits expected:
- `apps/tournament-api/src/routes/admin-groups.ts` — NEW
- `apps/tournament-api/src/routes/admin-groups.test.ts` — NEW (≥12 tests per AC #17)
- `apps/tournament-api/src/app.ts` — MODIFIED (register adminGroupsRouter)
- `apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx` — NEW
- `apps/tournament-web/src/routes/admin.groups.$groupId.edit.test.tsx` — NEW (4+ tests)
- `apps/tournament-web/src/routeTree.gen.ts` — auto-regen
- Story file + codex review files in `_bmad-output/`

NO SHARED edits expected. NO FORBIDDEN edits.

## Acceptance Criteria

1. **Given** `apps/tournament-api/src/routes/admin-groups.ts` (NEW)
   **When** inspected
   **Then** it exports `adminGroupsRouter` (Hono instance) with 4 routes (paths prefixed with `/groups` so they resolve to `/api/admin/groups/...` once mounted under `/api/admin` in app.ts — matches the existing adminCoursesRouter + adminEventsRouter pattern):
   - `GET /groups/:groupId` — middleware: requireSession → requireOrganizer → handler. NO bodyLimit (GET has no body).
   - `PATCH /groups/:groupId` — middleware: requireSession → requireOrganizer → bodyLimit(4 KB) → handler.
   - `POST /groups/:groupId/members` — middleware: requireSession → requireOrganizer → bodyLimit(4 KB) → handler.
   - `DELETE /groups/:groupId/members/:playerId` — middleware: requireSession → requireOrganizer → handler. NO bodyLimit (DELETE in this design is path-param-only with no body).
   bodyLimit `onError` returns 400 `{ error: 'bad_request', code: 'body_too_large', requestId }` (matches T2-5 + T3-2 JSON-endpoint shape).

2. **Given** `GET /api/admin/groups/:groupId`
   **When** invoked with a valid groupId
   **Then** returns 200 `{ id, name, eventId, moneyVisibilityMode, members: [...] }`. The members array is sorted by `players.name ASC`. Each member has `{ playerId, name, ghin, manualHandicapIndex, preferredTeeColor }` (camelCase Drizzle property names in the JSON response). Returns 404 `{ error: 'not_found', code: 'group_not_found', requestId }` if the group doesn't exist.

3. **Given** `PATCH /api/admin/groups/:groupId`
   **When** invoked with body `{ name?: string, moneyVisibilityMode?: 'open' | 'participant' | 'self_only' }`
   **Then**:
   - Body Zod-parsed via `PatchGroupRequestSchema`. At least one of `name` / `moneyVisibilityMode` MUST be present (Zod `.refine` checks the union).
   - `name` if present: trimmed, min 1 char.
   - `moneyVisibilityMode` if present and value is `participant` or `self_only` → 400 `{ error: 'bad_request', code: 'mode_not_v1', requestId }` (defense-in-depth; UI also disables these).
   - On success: UPDATE the row, return 200 `{ id, name, eventId, moneyVisibilityMode }`.
   - 404 `group_not_found` if no row updated.

4. **Given** `POST /api/admin/groups/:groupId/members` with body `{ mode: 'ghin', ghin: number, firstName: string, lastName: string }`
   **Then**:
   - **Pre-flight group existence check:** `SELECT id FROM groups WHERE id = :groupId`. If 0 rows → 404 `{ error: 'not_found', code: 'group_not_found', requestId }`. Without this, an unknown groupId would fire the FK violation deep inside the transaction → 500 instead of clean 404.
   - Body Zod-parsed. `ghin` is positive integer; firstName/lastName trimmed min 1.
   - **SELECT-then-INSERT player with race-safe retry** (mirrors `lookupOrBindOAuthIdentity` pattern in `auth.ts:384-464` from T1-6b):
     1. `SELECT id FROM players WHERE ghin = ?`. If exists → reuse `player_id`.
     2. Else: open `db.transaction(...)`. Inside the tx: re-`SELECT id FROM players WHERE ghin = ?` (catches a concurrent insert that happened between steps 1 and 2). If found → reuse. Else: INSERT new players row with `id = randomUUID()`, `name = "${firstName} ${lastName}"`, `ghin`, `isOrganizer = false`, `createdAt = now`, `tenantId = 'guyan'`, `contextId = 'league:guyan-wolf-cup-friday'` (matches existing T1-6a posture).
     3. If the INSERT raises UNIQUE on `players.ghin` partial index (concurrent write between the inner SELECT and INSERT — astronomically rare): catch the UNIQUE error, re-SELECT to find the now-existing row, reuse that `player_id`. If retry-SELECT also returns 0 rows → 500 `add_failed` with structured log (pathological; should never fire).
   - INSERT group_member row. Catch UNIQUE on `(group_id, player_id)` composite PK → 409 `{ error: 'conflict', code: 'player_already_in_group', requestId }`.
   - On success: 201 `{ player: { id, name, ghin, manualHandicapIndex: null, preferredTeeColor: null }, groupMember: { groupId, playerId } }`.

5. **Given** `POST /api/admin/groups/:groupId/members` with body `{ mode: 'manual', name: string, manualHandicapIndex?: number }`
   **Then**:
   - **Pre-flight group existence check** (same as AC #4): 404 `group_not_found` if `:groupId` doesn't exist.
   - Body Zod-parsed. `name` trimmed min 1; `manualHandicapIndex` optional, finite, between -10 and 54 (USGA range).
   - ALWAYS INSERT new players row with `id = randomUUID()`, `name`, `ghin = null`, `manualHandicapIndex` (or null), `isOrganizer = false`, `createdAt = now`, `tenantId = 'guyan'`, `contextId = 'league:guyan-wolf-cup-friday'`. NO name-based reuse.
   - INSERT group_member row. Catch UNIQUE → 409 (defensive; manual entry shouldn't hit this since each insert is a new player_id, but keep the catch for robustness).
   - **Body-shape discrimination strictness (Zod):** the request schema MUST enforce "exactly one shape" — either `{ ghin, firstName, lastName }` OR `{ name, manualHandicapIndex? }`, never both, never neither. Use `z.discriminatedUnion` keyed on the presence of `ghin` (with explicit `ghinShape: z.object({ ghin, firstName, lastName, type: z.literal('ghin') })` + `manualShape: z.object({ name, manualHandicapIndex?, type: z.literal('manual') })`) OR a manual `superRefine` that rejects bodies containing both `ghin` and `name`. The cleanest pattern is to require an explicit `mode: 'ghin' | 'manual'` discriminator field in the body — AC #4 + #5 both expect a `mode` field. Update request shapes:
     - Body-shape A: `{ mode: 'ghin', ghin, firstName, lastName }`.
     - Body-shape B: `{ mode: 'manual', name, manualHandicapIndex? }`.
     The frontend supplies `mode` based on which tab the organizer used.
   - On success: 201 `{ player: {...}, groupMember: {...} }`.

6. **Given** `DELETE /api/admin/groups/:groupId/members/:playerId`
   **When** invoked
   **Then**:
   - DELETE the `group_members` row WHERE `group_id = :groupId AND player_id = :playerId`.
   - If 0 rows affected: 404 `{ error: 'not_found', code: 'member_not_found', requestId }`.
   - If 1 row affected: 204 No Content (no body).
   - The `players` row is NOT deleted (T3-1's FK posture: group_members → players is RESTRICT, but DELETE FROM group_members doesn't propagate; only DELETE FROM players would trigger RESTRICT).

7. **Given** any UNIQUE conflict raised inside the POST add-member handler
   **When** caught
   **Then** the handler distinguishes UNIQUE-on-`group_members` (composite PK) → 409 `player_already_in_group` from UNIQUE-on-`players.ghin` (partial unique) → handled by the SELECT-first reuse logic so this UNIQUE shouldn't fire. Any unexpected UNIQUE → 500 `{ error: 'internal', code: 'add_failed', requestId }` with structured log.

8. **Given** `apps/tournament-api/src/app.ts` (modified)
   **When** inspected
   **Then** `app.route('/api/admin', adminGroupsRouter)` is added alongside the existing `adminCoursesRouter` + `adminEventsRouter` mounts (3rd mount under `/api/admin`). The router's internal paths (`/groups/:groupId`, etc.) resolve to `/api/admin/groups/:groupId` etc. — matching the existing pattern. (Per T3-2 architectural note: promote umbrella `adminRouter` at ~5 mounts; we're at 3, so hold.)

9. **Given** `apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx` (NEW)
   **When** inspected
   **Then** it exports BOTH `Route` (TanStack file-route registration at `/admin/groups/$groupId/edit`) AND `EditGroupPage` (named React component for direct test render). The route's `beforeLoad` reuses the T2-3b 5-step auth-status loader; anonymous → `/api/auth/google`; non-organizer → ForbiddenMessage; organizer → render the page.

10. **Given** the page (idle state)
    **When** rendered
    **Then** it displays:
    - Heading "Edit Group: {group.name}"
    - Group header form: name input (controlled, defaults from query data) + Save button. Money-visibility radio with 3 options (`open` enabled by default; `participant` + `self_only` disabled with title="v1.5 — coming soon").
    - Members table sorted by name. Columns: Name, GHIN (or "—"), Handicap (`manualHandicapIndex` if non-null else "—" — v1 does NOT live-fetch GHIN handicaps at render time; deferred to T3-10), Remove button.
    - Add Player section: tab toggle [GHIN Search | Manual Entry]. GHIN Search tab: name input (last name) + Search button → results list with Add button per result. Manual Entry tab: name + handicap inputs + Add button.

11. **Given** the user clicks Save on the group header
    **When** PATCH posts
    **Then** handle 200 → invalidate group query → updated state visible. 400 mode_not_v1 → render inline error "v1.5 modes not yet enabled" (defensive; UI shouldn't allow this). 400 invalid_body → render generic error.

12. **Given** the user types a last name in GHIN Search and clicks Search
    **When** GET /api/players/search?name=<lastname>
    **Then**:
    - 200 → render list of results, each with "Add" button.
    - 503 ghin_unavailable → render "GHIN search unavailable — use Manual Entry" (preserve any current GHIN search input).
    - 400 invalid_query → render "Please enter a name" (won't happen via UI which trims + validates but defense-in-depth).
    - 401 → redirect-to-OAuth (shouldn't fire since beforeLoad already authed; defensive).

13. **Given** the user clicks Add on a GHIN search result
    **When** POST /api/admin/groups/:groupId/members with body `{ mode: 'ghin', ghin, firstName, lastName }`
    **Then**:
    - 201 → invalidate group query → member appears in list (sorted).
    - 409 player_already_in_group → render "{name} is already in this group".
    - 503 ghin_unavailable → would only fire if the SELECT-first-then-INSERT path had a side path; v1 doesn't call ghinClient at add time → not expected.
    - Other 400 → render generic error.

14. **Given** the user enters a name in Manual Entry and clicks Add
    **When** POST /api/admin/groups/:groupId/members with body `{ mode: 'manual', name, manualHandicapIndex? }`
    **Then**: 201 → invalidate query → new member appears. 400 → inline error. 5xx → generic error.

15. **Given** the user clicks Remove on a member row
    **When** DELETE /:groupId/members/:playerId
    **Then**: 204 → invalidate query → member disappears. 404 member_not_found → invalidate query (refetch shows current state; shouldn't fire under normal use). Confirmation dialog NOT required for v1 (the action is reversible — re-add via GHIN or manual).

16. **Given** AbortController-on-unmount pattern (mirror T2-5 + T3-2)
    **When** the user navigates away mid-mutation
    **Then** in-flight fetches abort. TanStack Query mutations are managed via `useMutation` which has its own abort handling.

17. **Given** `apps/tournament-api/src/routes/admin-groups.test.ts` (NEW)
    **When** the suite runs
    **Then** at least 12 new tests exist. Each test seeds an organizer + session via the existing T1-6a pattern AND seeds an event + group + (where needed) some players + group_members. Real T3-1 schema migrated; tests assert against actual rows. `vi.mock('../lib/ghin-client.js', ...)` is NOT needed because the v1 add-by-GHIN path doesn't call the GHIN client (per body-shape A).

18. **Given** `apps/tournament-web/src/routes/admin.groups.$groupId.edit.test.tsx` (NEW)
    **When** the suite runs
    **Then** at least 4 component tests exist (per Risk Acceptance §7). `vi.stubGlobal('fetch', vi.fn())` per-test pattern; render `EditGroupPage` directly bypassing TanStack Router; mock `/api/admin/groups/:groupId` (returns initial group state), `/api/players/search` (GHIN proxy), `/api/admin/groups/:groupId/members` (POST), `/api/admin/groups/:groupId/members/:playerId` (DELETE).

19. **Given** `pnpm -F @tournament/api typecheck` + `pnpm -F @tournament/api lint` + `pnpm -F @tournament/web typecheck` + `pnpm -F @tournament/web lint`
    **When** run post-T3-3
    **Then** all four exit 0. No new `any`. No new `// eslint-disable`.

20. **Given** `pnpm -F @tournament/api test` + `pnpm -F @tournament/web test`
    **When** run post-T3-3
    **Then** tournament-api ≥ baseline + 12 (per AC #17). tournament-web ≥ baseline + 4 (per AC #18). Baselines at story start: 291 (post-T3-4) + 16 (post-T3-2).

21. **Given** Wolf Cup workspaces
    **When** `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` run post-T3-3
    **Then** both continue to pass with zero net-negative test count change.

22. **Given** the deployed app at `https://tournament.dagle.cloud/admin/groups/<groupId>/edit`
    **When** Josh manually exercises the flow (post-deploy + post-VPS-GHIN-env-set)
    **Then**:
    - Page renders for organizer with the seeded group's data.
    - Add Player via GHIN: search "Stoll" → click result → member appears in list.
    - Add Player manually: enter name → click Add → member appears.
    - Remove a member: click Remove → row disappears.
    - Edit group name → Save → name updates.
    - Try to select `participant` visibility → button is disabled (UI level); `curl -X PATCH .../api/admin/groups/<id> -d '{"moneyVisibilityMode":"participant"}'` → 400 mode_not_v1 (API level defense-in-depth).
    Manual smoke results documented in completion notes.

23. **Given** there are no SHARED-file edits
    **When** the dev agent classifies its planned edits at impl time
    **Then** every touched path falls under ALLOWED. NOT touched: `pnpm-lock.yaml`, root `package.json`, any workspace `package.json`, `docker-compose.yml`, `Dockerfile*`, root tsconfig*, `.github`, `.gitignore`, root eslint.

## Tasks / Subtasks

- [ ] Task 1: Capture baselines. (AC #20)
  - [ ] Subtask 1.1: tournament-api baseline = 291 (post-T3-4).
  - [ ] Subtask 1.2: tournament-web baseline = 16 (post-T3-2).

- [ ] Task 2: Backend — create `admin-groups.ts` route. (AC #1-#7)
  - [ ] Subtask 2.1: Define `PatchGroupRequestSchema` Zod.
  - [ ] Subtask 2.2: Define `AddMemberRequestSchema` Zod (discriminated union: ghin-shape OR manual-shape).
  - [ ] Subtask 2.3: GET /:groupId handler — fetch group + members via JOIN, return shape per AC #2.
  - [ ] Subtask 2.4: PATCH /:groupId handler — Zod parse, mode_not_v1 guard, UPDATE.
  - [ ] Subtask 2.5: POST /:groupId/members handler — discriminate body shape; GHIN-path SELECT-or-INSERT player + INSERT group_member; manual-path INSERT player + INSERT group_member. Catch composite-PK UNIQUE → 409.
  - [ ] Subtask 2.6: DELETE /:groupId/members/:playerId handler — DELETE; 404 if 0 rows.

- [ ] Task 3: Register `adminGroupsRouter` in `app.ts`. (AC #8)

- [ ] Task 4: Backend — write 12+ route tests. (AC #17)

- [ ] Task 5: Frontend — create `admin.groups.$groupId.edit.tsx`. (AC #9-#16)
  - [ ] Subtask 5.1: Dual-export Route + EditGroupPage.
  - [ ] Subtask 5.2: beforeLoad reuses auth-status loader.
  - [ ] Subtask 5.3: useQuery for group fetch.
  - [ ] Subtask 5.4: useMutation for PATCH/POST/DELETE.
  - [ ] Subtask 5.5: GHIN search tab — useQuery (gated to "search clicked"), display results.
  - [ ] Subtask 5.6: Manual entry tab — useState form.
  - [ ] Subtask 5.7: Member row — Remove button → DELETE mutation → invalidate.

- [ ] Task 6: Frontend — write 4+ component tests. (AC #18)

- [ ] Task 7: Run regressions. (AC #19, #20, #21)

- [ ] Task 8: Manual post-deploy smoke per AC #22. Document in completion notes.

## Dev Notes

- **Why discriminated-union body for POST /:groupId/members:** keeps the GHIN path and manual path in ONE endpoint. Two separate endpoints (`/members/by-ghin` vs `/members/manual`) would be cleaner per-route but creates URL proliferation. The Zod refine (`hasGhin XOR hasName-only`) makes the discriminator unambiguous.

- **Why no GHIN handicap snapshot in players.manualHandicapIndex on add-by-GHIN:** the field is named `manualHandicapIndex` for a reason — it's the override for non-GHIN players. Storing the GHIN handicap there confuses the meaning (is it manual or GHIN-derived?). T3-3 leaves it null on add-by-GHIN. **v1 UI consequence:** the member table's Handicap column shows "—" for GHIN-bound players (no live-fetch at render). T3-10 (refresh-from-GHIN profile action) is the future home for live-display logic — likely via a dedicated `cachedHandicapFromGhin` column + freshness timestamp; out of T3-3 scope.

- **Why no name-based reuse in manual-add path:** name matching is fragile ("Josh" vs "Joshua"). Force the organizer to handle dupes by visual inspection. Pinehurst crew is 8 players — visual inspection is feasible.

- **Why no Confirm Remove dialog:** the action is reversible (re-add via GHIN search or manual). Saves a click for the v1 organizer who's iterating on the roster.

- **Why GET /:groupId returns members sorted by name:** stable display order. Without explicit ORDER BY, SQLite returns rows in insertion order which depends on add sequence (confusing for the organizer who sees "Bob" added after "Aaron" landing AT THE BOTTOM).

- **Why `mode_not_v1` instead of just `invalid_body`:** specific error code lets the UI render a more informative message ("v1.5 not enabled yet") without parsing Zod issues. Future when v1.5 lands, the API removes the `mode_not_v1` guard and the UI removes the disabled attribute on the radio buttons.

- **Why bodyLimit 4 KB:** PATCH/POST bodies are small (≤200 bytes typical). 4 KB is generous overhead. T2-5 used 64 KB for course saves; T3-2 used 16 KB for event creation; T3-3's bodies are smaller, so 4 KB.

- **Why TanStack Query + useMutation, not hand-rolled fetch:** the page has 4 distinct mutations + 1 query. TanStack Query's invalidateQueries pattern is idiomatic and avoids manual state-sync. Differs from T2-5 + T3-2 which used hand-rolled fetch + AbortController for fewer mutations. The added complexity of useMutation is worth it for 4 mutations with cache-invalidation semantics.

- **Wolf Cup isolation (FD-1 / FD-2):** T3-3 writes only to `apps/tournament-api/src/routes/admin-groups.{ts,test.ts}` (NEW), `apps/tournament-api/src/app.ts` (MODIFIED), and `apps/tournament-web/src/routes/admin.groups.$groupId.edit.{tsx,test.tsx}` (NEW). Zero edits to `apps/api/**`, `apps/web/**`, `packages/engine/**`, or any root file.

- **Retro AI-1 applied:** spec codex caps at 4 rounds OR zero-High-zero-Med, whichever first. Same for impl codex.
- **Retro AI-2 applied:** zero SHARED files pre-announced in §1.
- **Retro AI-3 applied:** the request schemas (PatchGroupRequestSchema + AddMemberRequestSchema) ARE the contract. Tests assert exact JSON response shapes.

### Project Structure Notes

Shape after T3-3:

```
apps/tournament-api/
  src/
    app.ts                                                # MODIFIED: +adminGroupsRouter mount
    routes/
      admin-groups.ts                                     # NEW: 4 endpoints
      admin-groups.test.ts                                # NEW: 12+ tests

apps/tournament-web/
  src/
    routes/
      admin.groups.$groupId.edit.tsx                      # NEW: edit page
      admin.groups.$groupId.edit.test.tsx                 # NEW: 4+ tests
    routeTree.gen.ts                                      # MODIFIED: auto-regen
```

**Explicitly NOT in T3-3 (reserved for future stories):**
- Group create / delete (events wizard creates default; future story for organizer-driven create).
- Cross-group player move (re-add flow).
- Player edit (rename, change GHIN).
- preferred_tee_color collection.
- Bulk import.
- v1.5 visibility modes ('participant' / 'self_only' enabled).

### References

- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` Story T3.3 (line 890-912).
- Predecessor stories: T1-6a (auth), T3-1 (groups + group_members + players schema), T3-2 (event wizard creates default Group), T3-4 (GHIN client + /api/players/search).
- T2-3b auth-status loader: `apps/tournament-web/src/routes/admin.courses.upload.tsx:50-78`.
- T3-2 form pattern: `apps/tournament-web/src/routes/admin.events.new.tsx`.
- Players partial unique on ghin: `apps/tournament-api/src/db/schema/players.ts:51-55`.
- Group_members composite PK: `apps/tournament-api/src/db/schema/groups.ts:46-50`.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Tournament Director skill, single-cycle invocation 2026-04-27).

### Debug Log References

- Spec codex: 4 rounds (hit AI-1 cap; noisiest spec to date). R1: 4H+3M load-bearing (GHIN-call contradiction, handicap-live-vs-dash, mount path, bodyLimit scope, concurrency race, missing group-existence pre-flight, Zod discriminator strictness). R2: 3H+1M residuals. R3: 2H+1M+1L. R4 (cap): 2M+1L (mode discriminator wording, smoke-step method, footprint count — fixed in-place after cap).
- Mid-impl: composite-PK violation on group_members fired SQLITE_CONSTRAINT_PRIMARYKEY (1555) NOT SQLITE_CONSTRAINT_UNIQUE (2067). Test failure surfaced this; renamed isUniqueConstraintError → isUniqueOrPkConstraintError + extended to catch both sentinels.
- Mid-impl: working tree had unrelated Wolf Cup pairing-history follow-up work (Josh's parallel work). Director STOPPED twice on detection; Josh committed Wolf Cup separately as `201b00d` + `2b3f3e6` before T3-3 commit.
- Impl codex: 2 rounds. R1: 0H+3M+1L (group_members.contextId bug — used groupId instead of eventId; React setState during render; missing AbortController; missing bodyLimit test) — all FIXED. R2: 0H+0M+3L (PATCH return-type cast imprecision; hardcoded tenant/context strings; no dedicated contextId-stamping regression test) — terminal clean per AI-1.
- Party-mode: single non-interactive written review. All 5 agents converged on "ship". Zero open questions. 12 non-blocking flags all defer/polish/v1-single-tenant.
- Party-codex: 0H+0M+2L (review-text wording inaccuracies only).

### Completion Notes List

**Test deltas:**
- tournament-api: 291 → 308 (+17 new tests; 41% over AC #17 +12 minimum)
- tournament-web: 16 → 21 (+5 new tests; 25% over AC #18 +4 minimum)
- Wolf Cup engine: 472 (unchanged ✓ AC #21)
- Wolf Cup api: 507 (unchanged or +N from separate Wolf Cup commits; either way no NET-NEGATIVE change ✓ AC #21)

**All checks green:** typecheck (api + web), lint (api + web), build (api + web; PWA precache 16 → 17 entries with admin.groups.$groupId.edit bundled).

**SHARED-gate footprint:** ZERO. Risk Acceptance §1 prediction held.

**Path footprint (all ALLOWED, 6 files):**
- `apps/tournament-api/src/routes/admin-groups.ts` (NEW, ~470 lines — 4 endpoints + race-safe player resolver + Zod discriminated-union schema)
- `apps/tournament-api/src/routes/admin-groups.test.ts` (NEW, 18 tests)
- `apps/tournament-api/src/app.ts` (modified — 4 lines: import + mount adminGroupsRouter)
- `apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx` (NEW, ~470 lines — TanStack Query useMutation + AbortController + tabbed add UI)
- `apps/tournament-web/src/routes/admin.groups.$groupId.edit.test.tsx` (NEW, 5 component tests)
- `apps/tournament-web/src/routeTree.gen.ts` (auto-regen)

**Deviations from spec / epic (all approved):**
- AC #4/#5 mode discriminator pattern: explicit `mode: 'ghin' | 'manual'` field in body via Zod's discriminatedUnion. Cleaner than hasGhin-XOR-hasName refine.
- AC #7 isUniqueOrPkConstraintError catches BOTH UNIQUE (2067) AND PRIMARYKEY (1555) sentinels — discovered via test failure.
- AC #16 AbortController via inFlightControllers ref + useEffect cleanup — manual pattern because TanStack Query v5's useMutation doesn't auto-abort mutationFn on unmount.
- group_members.contextId stamping inherits parent event's eventId (not groupId) — was a real correctness bug caught at impl-codex R1 + fixed.
- Member handicap column shows "—" for GHIN-bound players (no live-fetch at render); deferred to T3-10.
- "Player name" label in manual-entry tab (disambiguates from group "Name" input).

**Manual post-deploy smoke (AC #22):** PENDING.
- Required after deploy + after Josh sets `GHIN_USERNAME` + `GHIN_PASSWORD` in `/opt/wolf-cup/.env`.
- Path: navigate to `tournament.dagle.cloud/admin/groups/<seeded-group-id>/edit` → exercise GHIN search, manual entry, remove, edit name, attempt v1.5 visibility (should be UI-disabled).
- Verify member handicap column shows "—" for GHIN-bound (v1 limitation surfaces correctly).

**Followups for future stories:**
- T3-5 (rule-set editor) will be 4th `/api/admin` mount → consider promoting umbrella adminRouter at that time (per Winston's note).
- T3-6 (invite-claim) must handle "claim a player who's already in the group via T3-3 manual add" gracefully (200 success, not 409).
- T3-10 (refresh-from-GHIN profile action) closes the v1 handicap-display gap on GHIN-bound members.
- Promote `apps/tournament-api/src/lib/libsql-errors.ts` when 4th UNIQUE-detection consumer arrives (currently 3: auth.ts, admin-courses.ts, admin-groups.ts).
- Future polish: success toast on Save name; auto-clear GHIN search results after Add; "Reset" button on manual-entry tab; unmount-mid-fetch unit test; PATCH return type cast precision.
- Hardcoded `TENANT_ID` + `PLAYER_CONTEXT_ID` strings inherit v1 single-tenant posture; multi-tenant story would derive from session/event context.

### File List

- `apps/tournament-api/src/routes/admin-groups.ts` — new
- `apps/tournament-api/src/routes/admin-groups.test.ts` — new
- `apps/tournament-api/src/app.ts` — modified
- `apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx` — new
- `apps/tournament-web/src/routes/admin.groups.$groupId.edit.test.tsx` — new
- `apps/tournament-web/src/routeTree.gen.ts` — auto-regenerated
