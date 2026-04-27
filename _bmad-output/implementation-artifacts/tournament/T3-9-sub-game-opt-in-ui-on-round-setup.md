# T3-9: Sub-Game Opt-In UI on Round Setup

## Status

Ready for Dev

## Story

As an organizer,
I want a per-round per-player sub-game opt-in toggle (v1 exposes skins only; ctp/sandies/putting-contest are schema stubs per FD-10/FD-11),
So that subsets of players can join skins pots and future sub-games register through the same flow.

T3-9 ships an admin page at `/admin/event-rounds/:eventRoundId/sub-games` plus two new backend endpoints (`GET` for prepopulation + `POST` for upsert) via a NEW router (`adminEventRoundsRouter`) that mounts at `/api/admin` (5th umbrella consumer). The router defines its own subroutes `/event-rounds/:eventRoundId/sub-games`, so final URLs are `/api/admin/event-rounds/:eventRoundId/sub-games`. Wiring mirrors T3-3 admin-groups + T3-5 admin-rule-sets + T2-3 admin-courses pattern. The dispatcher + `sub_game_results` are NOT in T3-9 scope (T6.13 lands those at scoring-compute time); T3-9 only writes the opt-in setup state.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. SHARED-gate footprint announced up-front (retro AI-2)

**Zero SHARED files expected.** Same posture as T3-3 / T3-5 / T3-6 / T3-8:
- No new deps.
- No env vars.
- No DB migrations (T3-1 already shipped `sub_games` + `sub_game_participants`).
- Tests via existing vitest.

### 2. NEW `adminEventRoundsRouter` → 5th `/api/admin` umbrella consumer

T3-3 (groups), T3-5 (rule-sets), T2-3 (courses), T3-2 (events) all mount their routers under `/api/admin` in `app.ts` via `app.route('/api/admin', router)`. Adding `adminEventRoundsRouter` (which internally defines `/event-rounds/:eventRoundId/sub-games` subroutes) brings the count to **5**. Per Winston's T3-3/T3-5 review threshold ("promote umbrella adminRouter at ~5 mounts"), T3-9 is the threshold case. **Decision for T3-9: hold the existing pattern; promote umbrella in a future scope-disciplined refactor story.** Adding the 5th `app.route('/api/admin', adminEventRoundsRouter)` mount in T3-9 keeps the change diff narrow and avoids cross-cutting refactor work mixed into a feature story. Track umbrella promotion as an explicit follow-up.

### 3. Frontend route is ORGANIZER-gated, not just authed

Mirror T3-2 / T3-3 / T3-5 admin patterns: `beforeLoad` runs the auth-status loader; non-organizer renders a `ForbiddenMessage`. Standalone page; **NOT bolted into the T3-2 event-creation wizard** (that wizard is already 3 steps; sub-game opt-ins are a separate setup phase per round, not per event).

### 4. Upsert semantics (DELETE-then-INSERT pattern)

Re-saving the form replaces existing config for that event_round_id, not deltas. Inside a single `db.transaction`:
1. SELECT existing `sub_games` rows for the event_round_id (for log context).
2. DELETE all `sub_games` WHERE `event_round_id = :eventRoundId AND tenant_id = TENANT_ID` — `sub_game_participants` cascade-deletes via FK.
3. INSERT new `sub_games` rows + `sub_game_participants` rows from the request body.

This is simpler than per-row diffing AND idempotent under retry. The spec includes a test that verifies a re-save replaces (does not accumulate) prior opt-ins.

### 5. v1 enables `skins` only; the other 3 types REJECTED at backend in v1 (defense-in-depth)

The schema CHECK accepts `('skins','ctp','sandies','putting_contest')` for forward-compat. **But T3-9's backend rejects `ctp`/`sandies`/`putting_contest` in v1** with `400 sub_game_type_not_enabled` — defense-in-depth that prevents inert non-skins rows from existing in the first place. (If a hypothetical pre-rejection cURL request had created such a row, an organizer's next legitimate save would actually clear it via the upsert DELETE-then-INSERT step; but defense-in-depth guards the entry point so the inert state is unreachable in v1.) Mirror of the T3-3 admin-groups v1 guard pattern (which rejects `participant`/`self_only` money_visibility_mode at save time even though the schema CHECK allows them).

**v1.5 enabling path**: the rejection is gated by a `V1_ENABLED_SUB_GAME_TYPES = new Set(['skins'])` constant. Adding new types to the set + flipping the UI's disabled flag is the only future change required.

(Round-1 codex: rationalized from prior "schema-CHECK passes; harmless inert rows" wording for tighter v1 invariants.)

### 6. Buy-in is **integer cents** + non-negative

The schema column is `integer` with CHECK `>= 0`. Frontend renders as a "$X.XX" input (decimal dollars) and converts to cents on submit. Backend validates `Number.isInteger(buyInPerParticipant) && buyInPerParticipant >= 0`. v1 default = 0 (no pot). **NEVER store dollars or floating-point — Wolf Cup engine integer-cents discipline applies.**

### 7. Roster source for participant validation

The handler must validate that every `participantPlayerIds` entry is in the event's `group_members` (across all groups under the event). Otherwise an organizer could opt in a non-participant player_id (typo / cURL). Pre-flight SELECT on `group_members` JOIN `groups` WHERE `groups.event_id = :eventId AND tenant_id = TENANT_ID`; rejection → 400 `player_not_in_event` (mirror T3-6's invite-claim pre-flight).

### 8. Path footprint summary

ALLOWED edits expected:
- `apps/tournament-api/src/routes/admin-event-rounds.ts` — NEW (subgames router; v1 has 2 endpoints under it: GET + POST sub-games for an event_round_id)
- `apps/tournament-api/src/routes/admin-event-rounds.test.ts` — NEW
- `apps/tournament-api/src/app.ts` — MODIFIED (mount adminEventRoundsRouter at `/api/admin`; 5th umbrella consumer)
- `apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.tsx` — NEW
- `apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.test.tsx` — NEW
- `apps/tournament-web/src/routeTree.gen.ts` — auto-regen
- Story file + codex review files in `_bmad-output/`

NO SHARED edits expected. NO FORBIDDEN edits.

## Acceptance Criteria

1. **Given** `apps/tournament-api/src/routes/admin-event-rounds.ts` (NEW)
   **When** inspected
   **Then** it exports a Hono router named `adminEventRoundsRouter` with two routes:
   - `GET  /event-rounds/:eventRoundId/sub-games` — returns existing config + roster
   - `POST /event-rounds/:eventRoundId/sub-games` — upserts opt-in config

   Both gated by `requireSession → requireOrganizer`. POST has `bodyLimit(8 KB)`. Mounted in `app.ts` at `/api/admin`, so URLs land at `/api/admin/event-rounds/:eventRoundId/sub-games`.

2. **Given** `GET /api/admin/event-rounds/:eventRoundId/sub-games`
   **When** invoked by an organizer
   **Then** the response shape is:
   ```ts
   {
     eventRound: { id, eventId, roundNumber, roundDate },
     event: { id, name },
     roster: Array<{ playerId, name }>,        // dedupe across groups; ASC by name
     subGames: Array<{
       type: 'skins' | 'ctp' | 'sandies' | 'putting_contest',
       buyInPerParticipant: number,            // integer cents
       participantPlayerIds: string[]          // ASC order
     }>,
     requestId: string
   }
   ```
   - 404 if `eventRoundId` doesn't exist (or is in a foreign tenant).
   - `subGames` is empty array if no opt-in config has been saved for this round.
   - The `roster` is the union of players in all groups under `eventRound.eventId`, deduped (mirror T3-6's `roster` shape in `invites.ts:140-156`).

3. **Given** `POST /api/admin/event-rounds/:eventRoundId/sub-games`
   **When** invoked by an organizer with a valid body
   **Then**:
   - Body schema (Zod):
     ```ts
     {
       subGames: Array<{
         type: 'skins' | 'ctp' | 'sandies' | 'putting_contest',
         buyInPerParticipant: number,                 // non-negative integer cents
         participantPlayerIds: string[]               // can be empty (UX flow: organizer adds a type with no players yet, saves, returns later)
       }>   // can be empty (signals "clear all opt-ins")
     }
     ```
   - **Error code precedence (deterministic, codified per round-1 codex Med #4):** validation failures are checked in this exact order — first match wins, no falls-through-and-emits-best-error logic:
     1. **`invalid_body` (400)** — Zod parse fails (unknown type, non-integer buy-in, negative buy-in, missing fields, wrong types).
     2. **`event_round_not_found` (404)** — Zod passes; `:eventRoundId` doesn't exist OR is in a foreign tenant.
     3. **`sub_game_type_not_enabled` (400)** — Zod passes; any `subGames[].type` is in `('ctp','sandies','putting_contest')` (not yet enabled in v1; defense-in-depth per Risk Acceptance §5).
     4. **`duplicate_sub_game_type` (400)** — request contains two entries with the same `type`.
     5. **`duplicate_participant` (400)** — any `participantPlayerIds` array contains a duplicate playerId.
     6. **`player_not_in_event` (400)** — ANY `participantPlayerIds` entry is not in any `group_members` row under the event_round's `eventId` (tenant-scoped pre-flight).

   - **Upsert (DELETE-then-INSERT inside a transaction):**
     1. DELETE FROM `sub_games` WHERE `event_round_id = :eventRoundId AND tenant_id = TENANT_ID`. (`sub_game_participants` cascade-deletes via FK.)
     2. For each entry in the body's `subGames`: INSERT `sub_games` row (id = randomUUID(), eventRoundId, type, configJson='{}', buyInPerParticipant, createdAt = Date.now(), tenantId, contextId = `event:${event.id}`). Then for each playerId in `participantPlayerIds` (which may be empty): INSERT `sub_game_participants` row.
   - 200 `{ subGameCount, participantCount, requestId }` on success.
   - Anonymous → 401 (via requireSession). Non-organizer → 403 (via requireOrganizer).

4. **Given** `apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.tsx` (NEW)
   **When** inspected
   **Then** it exports `Route` (TanStack file route at `/admin/event-rounds/$eventRoundId/sub-games`) and `SubGamesPage`.
   - `beforeLoad` runs the 5-step auth-status loader (T2-3b pattern); anonymous → `window.location.assign('/api/auth/google')`.
   - `RouteComponent` renders `<ForbiddenMessage />` when `!player.isOrganizer`.
   - `SubGamesPage` fetches the GET endpoint via TanStack Query, renders the form prepopulated with existing config, save via `useMutation` → POST.
   - AbortController-on-unmount via `inFlightControllers` ref + `useEffect` cleanup (mirror T3-3/T3-5/T3-6/T3-7 pattern).

5. **Given** the rendered `SubGamesPage`
   **When** the organizer views it
   **Then**:
   - For each of the 4 sub-game types, a section with: type label, buy-in input ($X.XX dollars; converted to cents on submit), and a roster of toggleable player rows.
   - `skins` section is **enabled**. The 3 others (`ctp`, `sandies`, `putting_contest`) render with all controls **disabled** + a tooltip "Coming in v1.5" (or similar copy).
   - Form prepopulates from the GET response: existing buyIn + opted-in playerIds for `skins` (if present).
   - Save button is disabled when no skins-section change has been made (idle), but always enabled when at least one toggle differs from server state.
   - Success → inline "Saved" message + refetch GET query.
   - Error response → inline error message; form state preserved.

6. **Given** AbortController-on-unmount pattern in `SubGamesPage`
   **When** the user navigates away mid-save
   **Then** the in-flight POST aborts. Mirror T3-3 / T3-5 / T3-6 / T3-7 pattern (inFlightControllers ref + useEffect cleanup).

7. **Given** `apps/tournament-api/src/routes/admin-event-rounds.test.ts` (NEW)
   **When** `pnpm -F @tournament/api test` runs
   **Then** at least 12 tests cover:
   - GET happy path: returns event_round + event + roster + existing sub-games (with participants).
   - GET 404: unknown event_round_id.
   - GET cross-tenant: foreign-tenant event_round → 404.
   - GET requires session: anonymous → 401.
   - GET requires organizer: non-organizer → 403.
   - POST happy path (single skins entry, 2 participants): creates 1 sub_games row + 2 sub_game_participants rows; response 200.
   - POST upsert replaces (re-save with different participants): old rows DELETED, new rows INSERTED; final row count matches new body, NOT cumulative.
   - POST empty subGames array: clears all existing sub_games + cascade-clears participants.
   - POST empty participantPlayerIds within a skins entry: 1 sub_games row created, 0 sub_game_participants rows (the "added the type but haven't picked players yet" UX flow).
   - **POST resave-to-empty (round-2 codex Low #2)**: prior save had `skins` + 5 participants → resave with `subGames: [{type: 'skins', buyInPerParticipant: 0, participantPlayerIds: []}]` → final state: 1 sub_games row, 0 sub_game_participants rows. Verifies the upsert correctly DROPS old participants when re-saved with empty array.
   - **POST 400 sub_game_type_not_enabled**: request body includes a `ctp`/`sandies`/`putting_contest` entry → 400 (defense-in-depth per Risk §5).
   - POST 400 player_not_in_event: participantPlayerIds includes a player not in any group under the event.
   - POST 400 duplicate_sub_game_type: two skins entries.
   - POST 400 duplicate_participant: one entry has a duplicate playerId.
   - POST 400 invalid_body: negative buy-in, unknown type, non-integer buy-in.
   - POST 404 event_round_not_found: unknown eventRoundId.
   - POST cross-tenant: event_round in foreign tenant → 404.
   - POST requires organizer: non-organizer → 403.
   - **POST error precedence**: a request that violates BOTH `duplicate_sub_game_type` AND `player_not_in_event` MUST return `duplicate_sub_game_type` (per the AC #3 ordering: type check fires before participant check).

8. **Given** `apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.test.tsx` (NEW)
   **When** `pnpm -F @tournament/web test` runs
   **Then** at least 4 tests cover:
   - Idle render: skins section enabled with roster + buy-in input; v1.5 sections disabled with tooltips.
   - Toggle a player + change buy-in + save → POST body matches; success message renders.
   - 400 player_not_in_event response → friendly inline message; form state preserved.
   - The 3 disabled sub-game types render their toggles as `disabled` (assertion against the DOM attribute).

9. **Given** `pnpm -F @tournament/api test`
   **When** run post-T3-9
   **Then** total tests ≥ baseline + 16. Baseline at story start: 372 (post-T3-8). The +16 covers AC #7 (18 minimum scenarios, with margin for Zod-issue branches collapsing into single tests).

10. **Given** `pnpm -F @tournament/web test`
    **When** run post-T3-9
    **Then** total tests ≥ baseline + 4. Baseline at story start: 36 (post-T3-7).

11. **Given** Wolf Cup workspaces
    **When** `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` run post-T3-9
    **Then** both continue to pass with zero net-negative test count change.

12. **Given** typecheck + lint + build for both tournament workspaces
    **When** run post-T3-9
    **Then** all exit 0. No new `any`. No new `// eslint-disable`.

13. **Given** the deployed app post-T3-9
    **When** Josh manually exercises the flow
    **Then**:
    - Visit `/admin/event-rounds/<eventRoundId>/sub-games` for an existing event_round.
    - Toggle 4 of 8 players into skins; set $5.00 buy-in; save.
    - Verify success message; refresh page; verify form prepopulates with the saved config.
    - Toggle 2 different players; save; verify the previous opt-ins are replaced (NOT accumulated).

14. **Given** there are no SHARED-file edits
    **When** the dev agent classifies its planned edits at impl time
    **Then** every touched path falls under ALLOWED. Specifically NOT touched: `pnpm-lock.yaml`, `package.json`, `docker-compose.yml`, root files, schema files (T3-1 schema is sufficient), migrations.

## Tasks / Subtasks

- [ ] Task 1: Capture baselines (372 / 36).

- [ ] Task 2: Backend — create `admin-event-rounds.ts`. (AC #1, #2, #3)
  - [ ] Subtask 2.1: Define Zod schema (PostSubGamesRequestSchema).
  - [ ] Subtask 2.2: GET handler (event_round + event + roster + existing config).
  - [ ] Subtask 2.3: POST handler (validate, upsert in transaction).

- [ ] Task 3: Backend — mount in `app.ts`.

- [ ] Task 4: Backend — create `admin-event-rounds.test.ts` with at least 12 tests covering AC #7's 18 scenarios (some may collapse together). (AC #7)

- [ ] Task 5: Frontend — create `admin.event-rounds.$eventRoundId.sub-games.tsx`. (AC #4, #5, #6)

- [ ] Task 6: Frontend — create `admin.event-rounds.$eventRoundId.sub-games.test.tsx` with at least 4 tests. (AC #8)

- [ ] Task 7: Run regressions (typecheck, lint, build, all 4 test suites).

- [ ] Task 8: Manual post-deploy smoke per AC #13. Document in completion notes.

## Dev Notes

- **Why upsert (DELETE-then-INSERT) instead of per-row diff?** Simpler. T3-1 schema's composite PK on `(sub_game_id, player_id)` would force a delicate diff (insert new rows, delete missing rows, update mismatches). Upsert pattern eliminates the surface area; idempotent under retry.

- **Why a transaction wrapping DELETE + INSERTs?** If an INSERT fails partway through (UNIQUE collision, FK violation), the partial state would leave the round with NO sub-games AND NO consistent opt-in record. Transaction rollback restores the prior state. Mirror T3-2 + T3-5's transactional save patterns.

- **Why pre-flight `player_not_in_event` validation rather than relying on FK?** `sub_game_participants.player_id → players.id` is RESTRICT — opting in any valid `players.id` would NOT FK-fail. The "must be in this event's group_members" rule is application-level, not schema-level. Pre-flight SELECT enforces it loudly (400) rather than relying on T6.13 dispatcher to silently skip.

- **Why a separate page rather than bolting into the T3-2 wizard?** T3-2 wizard is 3 steps; sub-game opt-ins are PER-ROUND (T3-2 creates rounds at event-creation time but sub-game configs may need updating between event creation and round day). Separate page is the right scope.

- **Why all 4 sub-game types in the schema CHECK if v1 only enables `skins`?** T3-1 already shipped the CHECK for forward-compat with v1.5. T3-9 doesn't change schema. v1 backend REJECTS `ctp`/`sandies`/`putting_contest` with `400 sub_game_type_not_enabled` (Risk Acceptance §5; AC #3 step 3) — defense-in-depth that prevents the "stuck inert config" bug class flagged by spec round-1 codex. Enabling v1.5 = add types to `V1_ENABLED_SUB_GAME_TYPES`; no schema migration required.

- **Why integer cents (vs decimal dollars or string)?** Wolf Cup engine money discipline. T6 stories will read `buy_in_per_participant` and compute pot math; integer cents avoid floating-point drift. Frontend converts to cents on submit (`Math.round(parseFloat(input) * 100)`).

- **5th `/api/admin` mount.** Per Winston's review threshold note. T3-9 holds the existing pattern; umbrella adminRouter promotion is a future story.

- **Tenant scoping (NEW code only).** T3-9 establishes the post-T3-7/T3-8 hardening pattern for new code: every SELECT/UPDATE/DELETE this story writes against `sub_games`, `sub_game_participants`, `event_rounds`, `events`, `groups`, `group_members` MUST filter on `tenant_id = TENANT_ID`. Pre-T3-7 admin routes (T3-2 admin-events, T3-3 admin-groups, T3-5 admin-rule-sets) were written before this hardening landed and are NOT tenant-scoped on every query — that's a known retrofit followup (track separately, NOT T3-9 scope). T3-9 doesn't widen the gap; it sets the standard for new code.

- **Wolf Cup isolation (FD-1 / FD-2):** T3-9 writes only to `apps/tournament-api/src/{routes,app.ts}` + `apps/tournament-web/src/routes/`. Zero edits to `apps/api/**`, `apps/web/**`, `packages/engine/**`.

- **Retro AI-1 applied:** spec codex caps at 4 rounds OR zero-H-zero-M.
- **Retro AI-2 applied:** zero SHARED files pre-announced.

### Project Structure Notes

Shape after T3-9:

```
apps/tournament-api/
  src/
    routes/
      admin-event-rounds.ts                     # NEW: subgames router
      admin-event-rounds.test.ts                # NEW
    app.ts                                      # MODIFIED: 5th /api/admin mount

apps/tournament-web/
  src/
    routes/
      admin.event-rounds.$eventRoundId.sub-games.tsx        # NEW
      admin.event-rounds.$eventRoundId.sub-games.test.tsx   # NEW
    routeTree.gen.ts                            # MODIFIED: auto-regen
```

**Explicitly NOT in T3-9 (reserved for future):**
- T6.13 sub-game dispatcher + `sub_game_results` table compute logic.
- Enabling `ctp`, `sandies`, `putting_contest` (v1.5+).
- Admin UI for editing config of existing sub-games as deltas (we replace via upsert).
- Linking the page from the event-detail page (event-detail page itself doesn't exist yet).
- Umbrella adminRouter promotion (5th /api/admin mount).

### References

- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` Story T3.9 (line 1044-1062).
- Predecessor stories: T3-1 (sub_games + sub_game_participants schema); T3-2 (event_rounds creation); T3-3 (group_members source-of-truth for roster).
- Pattern reference: T3-3 admin-groups.ts (transaction + upsert + tenant scoping); T3-5 admin-rule-sets.ts (revisioned upsert via transaction); T3-6 invites.ts (roster dedupe).
- Consumer story (downstream): T6.13 (sub-game dispatcher + `sub_game_results`) reads opt-in setup written by T3-9 at compute time.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
