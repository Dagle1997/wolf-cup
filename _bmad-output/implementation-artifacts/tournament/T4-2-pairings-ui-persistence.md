# T4-2: Pairings UI + Persistence (trip-critical)

## Status

Ready for Dev

## Story

As an organizer,
I want a pairings grid UI with hand-assign / pin / lock / save / refresh / export AND a `pairings` + `pairing_members` schema with slot-order preservation,
So that I can produce 4 rounds × 2 foursomes for Pinehurst entirely by hand if needed, and T5 scoring can look up each round's foursomes deterministically.

T4-2 is **trip-critical**. Per the epic, this story must function fully whether or not T4-1 (suggest engine) shipped. **T4-1 IS already shipped** (commit `dff1cec`, 2026-04-27), so T4-2 hard-imports `suggestPairings` from the engine and the Regenerate button is unconditionally available. The trip-critical guarantee remains: if T4-1 had NOT shipped, T4-2's hand-assign / pin / lock / save / refresh flows would still function end-to-end — only the Regenerate-unpinned button would be omitted (no compile-time import). T4-2 does NOT introduce runtime feature-flagging on T4-1's presence (the engine module exists or the build fails).

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. SHARED-gate footprint announced up-front (retro AI-2)

**Zero SHARED files expected.** No new deps. No env vars. No `pnpm-lock.yaml` changes. The migration file lives under ALLOWED `apps/tournament-api/src/db/migrations/`.

### 2. NEW migration `0003_pairings.sql`

T4-2 ships a new schema migration adding `pairings` + `pairing_members` tables. Migration applies cleanly on top of T3-1's existing schema — additive only, no ALTERs of existing tables. Generated via `pnpm -F @tournament/api db:generate` against the updated `src/db/schema/index.ts`. The migration file MUST be committed alongside the schema change.

### 3. Schema details

```ts
// pairings: one row per (event_round_id, foursome_number)
{
  id: TEXT PRIMARY KEY,
  event_round_id: TEXT NOT NULL REFERENCES event_rounds(id) ON DELETE CASCADE,
  foursome_number: INTEGER NOT NULL,           // 1-indexed
  locked: INTEGER NOT NULL DEFAULT 0,          // 0/1 boolean
  created_at: INTEGER NOT NULL,
  tenant_id: TEXT NOT NULL DEFAULT 'guyan',
  context_id: TEXT NOT NULL,                   // = `event:{events.id}`
  UNIQUE (event_round_id, foursome_number)
}

// pairing_members: one row per (pairing_id, player_id)
{
  pairing_id: TEXT NOT NULL REFERENCES pairings(id) ON DELETE CASCADE,
  player_id: TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  slot_number: INTEGER NOT NULL,               // 1-indexed; preserves cell order
  tenant_id, context_id (inherited from parent pairing)
  PRIMARY KEY (pairing_id, player_id),
  UNIQUE (pairing_id, slot_number)
}
```

**Cross-pairing player-uniqueness per round** (constraint not enforceable at SQL level): one player MUST NOT appear in more than one pairing for the same `event_round_id`. T4-2's POST handler enforces this at the application layer — pre-flight scan over the request body detects collisions; on violation returns:

```json
{
  "error": "duplicate_player",
  "code": "player_in_multiple_pairings_per_round",
  "requestId": "...",
  "conflicts": [
    { "playerId": "p0", "eventRoundId": "<uuid>", "foursomeNumbers": [1, 2] }
  ]
}
```

**Canonical field names**: `playerId` (camelCase, NOT `player_id`), `eventRoundId` (NOT just `round`), `foursomeNumbers` (array of 1-indexed integers; ASC). Status code `422` (Unprocessable Entity — request was syntactically valid but violates a logical constraint). Multiple conflicting players → multiple entries in `conflicts`.

### 4. Three backend endpoints under existing `/api/admin/events` router

T4-2 adds **three routes** to the existing `adminEventsRouter` (T3-2's router) since they're event-scoped — NOT a new router, keeping T4-2 inside the established `/api/admin` umbrella threshold (still 5 mounts post-T3-9). Routes:

- `GET  /api/admin/events/:eventId/pairings` — fetch all pairings + members for the event, grouped by event_round
- `POST /api/admin/events/:eventId/pairings` — upsert (DELETE-then-INSERT in a single `db.transaction`); slot_number preserves cell order from request
- `POST /api/admin/events/:eventId/pairings/suggest` — wire-up to T4-1's `suggestPairings` engine; returns engine grid + warnings

All three gated by `requireSession → requireOrganizer`. POST endpoints have `bodyLimit({ maxSize: 16 KB })` (larger than T3-9 because the body carries N rounds × M foursomes × foursomeSize player slots).

### 5. Upsert (DELETE-then-INSERT) semantics

Same pattern as T3-9. Inside a single `db.transaction`:
1. SELECT existing `pairings` rows for the event (across all event_rounds).
2. DELETE all `pairings` WHERE `event_round_id IN (event's rounds) AND tenant_id = TENANT_ID`. Cascade deletes `pairing_members`.
3. INSERT new `pairings` + `pairing_members` rows from request body.

**Locked-row preservation — explicit responsibility split:**

The DELETE-then-INSERT upsert has NO server-side "preserve locked rows" logic. Server treats `locked: true` as a stored flag on the new pairings row — it does NOT compare against existing rows or refuse to overwrite a locked pairing. **The CLIENT is responsible** for replaying locked rows verbatim in every save: if round 2 was previously locked with `members: [p1, p3, p5, p7]`, the next save MUST include round 2's pairings with the same `memberPlayerIds` AND `locked: true`. Server enforces nothing here.

Why? Server-side preservation would require: (a) extra round-trip to read existing rows; (b) a complex merge between request-body new state and persisted-state-where-locked; (c) unclear semantics if request body lacks a previously-locked round at all (delete it? error?). Pushing the responsibility to the client keeps the upsert pure DELETE-then-INSERT and matches the React form model: the form state IS the source of truth at save time. The Regenerate-unpinned flow (POST /pairings/suggest) is the only place locked-row preservation matters at the server, and that's handled separately in §7.

### 6. Frontend route — organizer-gated

`apps/tournament-web/src/routes/admin.events.$eventId.pairings.tsx` (NEW). 5-step auth-status loader; non-organizer → ForbiddenMessage. Renders a grid of N rows (event_rounds) × M columns (foursomes per round; derived from a small organizer-input `foursomesPerRound` value, default 2 for Pinehurst) × 4 cells (player slots).

**Hand-assign workflow (works WITHOUT T4-1):**
- Each cell is a `<select>` dropdown listing all event participants (group_members across all groups under the event). Empty cells render an "(empty)" placeholder option.
- Pin: click a "📌" toggle on each cell. Pinned cells get a visual marker. Pin state lives in component state only; NOT persisted in T4-2 (per epic — T4-1 consumes pins, T4-2 just tracks the toggle for the regenerate flow).
- Lock per-row: click "🔒 Lock round" button on each row → all cells in that row visually grey out + the row's pairings save with `locked: true`. Subsequent regenerate operations skip locked rows (T4-1 input).
- Save: POST to `/api/admin/events/:eventId/pairings` with the full grid. Success → toast + refetch.
- Refresh: GET `/api/admin/events/:eventId/pairings` → re-render the grid from server state.

**Regenerate-unpinned workflow (T4-1 IS shipped — button always visible):**
- "🔀 Regenerate unpinned" button. T4-1 is committed (`dff1cec`); the button is unconditionally visible. The "trip-critical without T4-1" guarantee in the Story preface means: if T4-1 had NOT shipped, T4-2 would simply omit the import + the button, and all other flows would still work. There is NO runtime feature flag — the button's existence is determined at build time.
- Click: collect current pins + locked-round indices; POST to `/api/admin/events/:eventId/pairings/suggest` (NEW route added in T4-2 alongside the GET/POST). Server calls `suggestPairings(...)` and returns the new grid + warnings. Client merges into form state, replacing only unpinned/unlocked cells.
- Any engine warnings surface as a banner above the grid.

### 7. NEW `POST /api/admin/events/:eventId/pairings/suggest` route

This is the wire-up point for T4-1's engine. Body shape:
```ts
{
  numRounds: number,                // server fetches from event_rounds.count(); client may pass for echo
  foursomesPerRound: number,        // organizer-configured at the UI; v1 typically 2
  pins: Array<{ round, foursome, playerId }>,
  lockedRounds: number[],           // 1-indexed round numbers (matches event_rounds.round_number)
}
```

**`lockedRounds` semantics (precise mapping):**
- Each integer in `lockedRounds` is a 1-indexed `event_rounds.round_number` value (the same field shown in the UI as "Round N"). NOT an array index, NOT an `event_round_id`.
- Mapping is unambiguous because T3-1 schema declares `uniqueIndex('uniq_event_rounds_event_round_number').on(t.eventId, t.roundNumber)` — `(event_id, round_number)` is unique per tenant. (Verified by inspection of `apps/tournament-api/src/db/schema/events.ts:74-77`.)
- Server resolves each locked round number to its `event_round_id` via `SELECT id FROM event_rounds WHERE event_id = :eventId AND round_number = :n AND tenant_id = TENANT_ID`. Unknown round numbers → warning string `"locked round {N} does not exist for this event"` + ignore.
- Engine output's `grid.rounds[i].round` is also 1-indexed (matches `i+1`), so server matches engine round → DB round by direct equality on the 1-indexed integer.

Server:
1. Fetches event's roster (group_members across all groups under the event).
2. Calls `suggestPairings({ roster, numRounds, foursomeSize: 4, constraint: 'everyone-once', pins })`.
3. Honors `lockedRounds` post-suggest: for each `roundIdx` in `lockedRounds`, fetch the currently-persisted pairings for that event_round and SUBSTITUTE them into the engine output's matching round slot. This prevents the engine's churn from disturbing already-locked rows.
4. **Edge case: lockedRounds references a round with NO persisted pairings yet** (organizer locked a row in the UI before ever saving it). The server emits an additional warning string `"locked round {N} has no persisted pairings — engine output kept as-is"` AND keeps the engine output for that round (better UX than failing the request; the warning surfaces the inconsistency). Mirror of T4-1's "warnings include actionable misconfigurations" pattern.
5. Returns `{ grid, warnings, requestId }` — same shape as T4-1's output plus requestId.

This route is gated by `requireSession → requireOrganizer`.

### 8. Application-level player uniqueness check on POST

The cross-pairing uniqueness constraint isn't enforceable at the SQL CONSTRAINT level (no straightforward way to express "across pairings sharing an event_round_id"). Pre-flight at handler time:
- Build a map `playerId → foursomeNumbers[]` per event_round.
- Any playerId with >1 foursomeNumber → 422.

### 9. Path footprint summary

ALLOWED edits expected:
- `apps/tournament-api/src/db/schema/pairings.ts` — NEW (schema)
- `apps/tournament-api/src/db/schema/index.ts` — MODIFIED (re-export)
- `apps/tournament-api/src/db/migrations/0003_*.sql` — NEW (auto-generated by `db:generate`)
- `apps/tournament-api/src/db/migrations/meta/_journal.json` — MODIFIED (auto-updated)
- `apps/tournament-api/src/db/migrations/meta/0003_snapshot.json` — NEW (auto-generated)
- `apps/tournament-api/src/routes/admin-events.ts` — MODIFIED (3 new routes: GET pairings, POST pairings, POST pairings/suggest)
- `apps/tournament-api/src/routes/admin-events.test.ts` — MODIFIED (add tests for the 3 new routes)
- `apps/tournament-web/src/routes/admin.events.$eventId.pairings.tsx` — NEW
- `apps/tournament-web/src/routes/admin.events.$eventId.pairings.test.tsx` — NEW
- `apps/tournament-web/src/routeTree.gen.ts` — auto-regen
- Story file + codex review files in `_bmad-output/`

NO SHARED edits expected (lockfile only required if package.json deps change; T4-2 adds none).

## Acceptance Criteria

1. **Given** `apps/tournament-api/src/db/schema/pairings.ts` (NEW)
   **When** inspected
   **Then** it defines:
   - `pairings` table per Risk §3 (id PK, event_round_id FK CASCADE → event_rounds.id, foursome_number INT, locked BOOLEAN DEFAULT false, created_at INT, tenant_id, context_id, UNIQUE(event_round_id, foursome_number))
   - `pairing_members` table per Risk §3 (pairing_id FK CASCADE → pairings.id, player_id FK RESTRICT → players.id, slot_number INT, tenant_id, context_id, composite PK (pairing_id, player_id), UNIQUE(pairing_id, slot_number))
   - Both exported via `db/schema/index.ts`.
   - The migration file `0003_*.sql` (auto-generated via `pnpm -F @tournament/api db:generate`) applies cleanly on top of T3-1's schema.

2. **Given** `GET /api/admin/events/:eventId/pairings`
   **When** invoked by an organizer
   **Then** returns:
   ```ts
   {
     event: { id, name },
     rounds: Array<{
       eventRoundId: string,
       roundNumber: number,
       roundDate: number,
       pairings: Array<{
         id: string,
         foursomeNumber: number,
         locked: boolean,
         members: Array<{ playerId: string, name: string, slotNumber: number }>  // ASC by slotNumber
       }>
     }>,
     roster: Array<{ playerId: string, name: string }>,  // dedupe across groups; ASC by name
     requestId: string
   }
   ```
   404 if `eventId` doesn't exist (or is in foreign tenant). 401 anonymous; 403 non-organizer.

3. **Given** `POST /api/admin/events/:eventId/pairings`
   **When** invoked by an organizer with a valid body
   **Then**:
   - Body schema (Zod):
     ```ts
     {
       rounds: Array<{
         eventRoundId: string,
         pairings: Array<{
           foursomeNumber: number,                   // 1-indexed
           locked: boolean,
           memberPlayerIds: string[]                 // length 1..foursomeSize; index = slot_number - 1
         }>
       }>
     }
     ```
   **Error code precedence (deterministic, first match wins; ordered by Hono middleware chain + handler execution sequence):**

   The Hono middleware chain is `requireSession → requireOrganizer → bodyLimit → handler`, mirroring T3-3/T3-9 patterns. Auth middleware fires FIRST. **DoS posture acknowledgment**: an oversized anonymous body still consumes the bytes up to whatever Hono's input parser tolerates before requireSession checks the cookie — in practice Hono streams reads on demand, so the bodyLimit check still fires before full-body load on unauthorized requests. The project's established pattern across T3-3/T3-9/T4-2 is consistent: auth gates first (401/403), then body size (400 body_too_large), then schema (400 invalid_body). If a future hardening story adds an upstream rate limiter or eager-body-rejection layer, T4-2 inherits it without code change. Within the authed flow:

   - **401 `session_missing` / `session_invalid`** — requireSession upstream.
   - **403 `not_organizer`** — requireOrganizer upstream.
   - Then handler-level (in this exact order):
     1. **`body_too_large` (400)** — bodyLimit middleware fires BEFORE the handler reads JSON. Bodies > 16 KB short-circuit here, before Zod even sees them.
     2. **`invalid_body` (400)** — Zod fails (missing fields, wrong types, foursomeNumber < 1, slot/array length mismatch).
     3. **`event_not_found` (404)** — `:eventId` missing or foreign-tenant.
     4. **`unknown_event_round` (400)** — any `eventRoundId` in body is not an event_round under this event.
     5. **`duplicate_player_in_foursome` (400)** — any single `memberPlayerIds` array contains a duplicate playerId. Response: `{ ..., conflicts: [{ eventRoundId, foursomeNumber, playerId }] }`.
     6. **`unknown_player` (400)** — any `memberPlayerIds` entry is not in any group_member under this event (tenant-scoped pre-flight).
     7. **`player_in_multiple_pairings_per_round` (422)** — any player appears in >1 foursome within the same `eventRoundId`. Response shape per Risk §3 canonical: `conflicts: [{ playerId, eventRoundId, foursomeNumbers: [a, b, ...] }]`.

   **Mount order in `admin-events.ts`** (mirror of T3-3 admin-groups + T3-9 admin-event-rounds): `routePath, requireSession, requireOrganizer, bodyLimit({...}), async handler(c) {...}`. T4-2 follows the same convention.

   Zod-level constraints in `invalid_body`: `memberPlayerIds.length >= 1 && memberPlayerIds.length <= 4` (foursomeSize cap; v1 hardcoded to 4 since the schema doesn't store foursomeSize per pairing — slot_number > 4 would violate the practical UI assumption); `foursomeNumber >= 1`; rounds array non-empty.
   - **Upsert (DELETE-then-INSERT inside a transaction)** per Risk §5.
   - Response: `200 { pairingCount, memberCount, requestId }`.
   - 401 anonymous; 403 non-organizer.

4. **Given** `POST /api/admin/events/:eventId/pairings/suggest`
   **When** invoked by an organizer with a valid body
   **Then**:
   - Body shape per Risk §7. Body validated via Zod.
   - 404 if event not found / foreign-tenant.
   - 400 `invalid_body` for Zod failure.
   - Calls `suggestPairings({ roster, numRounds, foursomeSize: 4, constraint: 'everyone-once', pins })`.
   - Honors `lockedRounds` post-suggest: replaces engine output's locked rows with current persisted pairings.
   - Response: `200 { grid, warnings, requestId }` — `grid` matches T4-1's `PairingsGrid` shape.
   - 401 anonymous; 403 non-organizer.

5. **Given** `apps/tournament-web/src/routes/admin.events.$eventId.pairings.tsx` (NEW)
   **When** inspected
   **Then**:
   - Exports `Route` (TanStack file route at `/admin/events/$eventId/pairings`) and `PairingsPage`.
   - 5-step auth-status loader (T2-3b pattern); anonymous → `window.location.assign('/api/auth/google')`. ForbiddenMessage for non-organizer.
   - Page fetches GET endpoint via TanStack Query; saves via useMutation → POST.
   - AbortController-on-unmount via `inFlightControllers` ref + `useEffect` cleanup (mirror T3-3/T3-5/T3-6/T3-7/T3-9 pattern).

6. **Given** the rendered `PairingsPage`
   **When** the organizer views it
   **Then** the grid shows:
   - **N rows** = `event.rounds.length`. Each row labeled "Round N — DATE".
   - **M columns** per row = `foursomesPerRound` (default 2, organizer-configurable in v1 via a small input above the grid).
   - **4 cells** per pairing (foursomeSize). Each cell is a `<select>` populated with the event's roster.
   - **Pin toggle** per cell (visual; client-side state only).
   - **Lock-round button** per row. When clicked, the row's cells visually grey out + the row's pairings save with `locked: true`.
   - **Save button** (top of page). Disabled when no changes from server state.
   - **Refresh button** (top of page). Re-fetches GET endpoint.
   - **Regenerate-unpinned button** (top of page; **HIDE if T4-1 not imported / available**). On click, POSTs `pairings/suggest` with current pins + locked-row indices; on response, replaces unlocked/unpinned cells with engine output.

7. **Given** the cross-pairing uniqueness check (AC #3 422 case)
   **When** triggered (organizer assigns the same player to two foursomes in one round + Save)
   **Then** the page renders a friendly inline error: "Player {name} is in multiple foursomes in round {N}. Pick a different player."

8. **Given** `apps/tournament-api/src/routes/admin-events.test.ts` (modified)
   **When** `pnpm -F @tournament/api test` runs
   **Then** at least 14 NEW tests cover:
   - GET happy: returns event + rounds + pairings + members in slot_number order + roster.
   - GET 404: unknown eventId.
   - GET cross-tenant: foreign-tenant event → 404.
   - GET 401 anonymous; 403 non-organizer.
   - POST happy (1 round, 2 foursomes, 4 members each, no lock): 1 + 2 + 8 rows. 200.
   - POST upsert REPLACES (re-save with different members): old rows deleted, new inserted; final count matches new body.
   - POST 422 player_in_multiple_pairings_per_round: same player in 2 foursomes of round 1 → 422 with canonical conflicts payload (`playerId`, `eventRoundId`, `foursomeNumbers`).
   - POST 400 duplicate_player_in_foursome: one foursome's `memberPlayerIds` lists same playerId twice → 400 with `conflicts: [{ eventRoundId, foursomeNumber, playerId }]`.
   - POST 400 unknown_event_round: eventRoundId not under this event.
   - POST 400 unknown_player: memberPlayerIds includes a non-member.
   - POST 400 invalid_body: missing required field.
   - POST 400 invalid_body: memberPlayerIds.length > 4 (foursomeSize cap).
   - POST 404 event_not_found.
   - POST cross-tenant: event in foreign tenant → 404.
   - POST locked round preserves locked=true after upsert.
   - POST 403 non-organizer.
   - POST/suggest happy: returns grid + warnings (mocked T4-1 call OR real call with 8-player Pinehurst case).
   - POST/suggest honors lockedRounds: locked rounds in engine output replaced with current persisted pairings.
   - POST/suggest lockedRounds with NO persisted pairings: engine output kept as-is + warning string `"locked round {N} has no persisted pairings — engine output kept as-is"`.

9. **Given** `apps/tournament-web/src/routes/admin.events.$eventId.pairings.test.tsx` (NEW)
   **When** `pnpm -F @tournament/web test` runs
   **Then** at least 4 tests cover:
   - Idle render with empty pairings: grid renders N rows × M cols × 4 cells; all cells show "(empty)".
   - Idle render with persisted pairings: cells prepopulate with member names.
   - Save: assigns players to all cells, click Save → POST → success toast.
   - 422 conflict: page renders friendly error "Player X is in multiple foursomes in round N."

10. **Given** `pnpm -F @tournament/api test`
    **When** run post-T4-2
    **Then** total tests ≥ baseline + 14. Baseline at story start: 421 (post-T4-1).

11. **Given** `pnpm -F @tournament/web test`
    **When** run post-T4-2
    **Then** total tests ≥ baseline + 4. Baseline at story start: 50 (post-T3-10).

12. **Given** Wolf Cup workspaces
    **When** `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` run post-T4-2
    **Then** both continue to pass with zero net-negative test count change.

13. **Given** typecheck + lint + build for both tournament workspaces
    **When** run post-T4-2
    **Then** all exit 0. No new `any`. No new `// eslint-disable`.

14. **Given** the deployed app post-T4-2
    **When** Josh manually exercises the flow
    **Then**:
    - Visit `/admin/events/<eventId>/pairings` for an existing event.
    - Hand-assign 4 players to round 1 foursome 1; click Save; verify success toast.
    - Refresh page; verify the grid prepopulates from saved state.
    - Lock round 1; verify grey-out; click "Regenerate unpinned"; verify locked row UNCHANGED, other rows regenerate (if T4-1 is wired).
    - Try to assign the same player to two foursomes in one round + Save; verify friendly inline error.
    - PDF schedule export (T4-3) NOT in T4-2 scope.

15. **Given** there are no SHARED-file edits
    **When** the dev agent classifies its planned edits at impl time
    **Then** every touched path falls under ALLOWED. Specifically NOT touched: `pnpm-lock.yaml`, `package.json`, root files, `docker-compose.yml`.

## Tasks / Subtasks

- [ ] Task 1: Capture baselines (421 / 50).

- [ ] Task 2: Schema — create `db/schema/pairings.ts`; re-export from `db/schema/index.ts`; run `pnpm -F @tournament/api db:generate` to produce `0003_*.sql`. (AC #1)

- [ ] Task 3: Backend — extend `routes/admin-events.ts` with GET/POST pairings + POST pairings/suggest. (AC #2-#4)

- [ ] Task 4: Backend — extend `routes/admin-events.test.ts` with 12+ new tests. (AC #8)

- [ ] Task 5: Frontend — create `routes/admin.events.$eventId.pairings.tsx`. (AC #5-#7)

- [ ] Task 6: Frontend — create `routes/admin.events.$eventId.pairings.test.tsx` with 4+ tests. (AC #9)

- [ ] Task 7: Run regressions (typecheck, lint, build, all 4 test suites).

- [ ] Task 8: Manual post-deploy smoke per AC #14.

## Dev Notes

- **Why no `round` field in 422 conflict response** when the AC #3 uses it? The endpoint POST is event-scoped; the conflict can only occur within an `eventRoundId` of the body. The conflicts payload includes `eventRoundId` (which the client maps back to round number via the GET response). Simplifies the contract.

- **Why upsert (DELETE-then-INSERT)?** Same reasoning as T3-9. Composite PK on `(pairing_id, player_id)` makes per-row diffs delicate; idempotent under retry.

- **Why `lockedRounds` post-suggest replacement on the SUGGEST endpoint rather than passing lockedRounds INTO T4-1?** T4-1's `pins` parameter forces specific players to specific foursomes; locking ENTIRE rows isn't quite the same shape (a locked row may have 4-8 players you want preserved AS-IS without expressing each as a pin). Server-side post-process is cleaner.

- **Why the foursomesPerRound input on the UI?** Pinehurst is 8 players × 2 foursomes per round. But the schema doesn't constrain to 2 — future events might have 12 players × 3 foursomes. Letting the organizer set it once at the top of the grid keeps the UI flexible.

- **Why no per-pairing pin in the schema?** Per the epic AC + Risk §6 + Dev Notes: pins are CLIENT-SIDE state only (used by Regenerate). Locks ARE persisted (`pairings.locked` column). Pins exist briefly during a regenerate workflow; locks survive across sessions.

- **Tenant scoping** — every SELECT/UPDATE/DELETE against `pairings`, `pairing_members`, `event_rounds`, `events`, `groups`, `group_members`, `players` filters on `tenant_id = TENANT_ID`. Post-T3-7/T3-9 hardening for new code.

- **Wolf Cup isolation:** T4-2 writes only to `apps/tournament-api/**` + `apps/tournament-web/**`.

- **Retro AI-1 applied:** spec codex caps at 4 rounds OR zero-H-zero-M.
- **Retro AI-2 applied:** zero SHARED files pre-announced.

### Project Structure Notes

Shape after T4-2:

```
apps/tournament-api/
  src/
    db/
      schema/
        pairings.ts                              # NEW
        index.ts                                 # MODIFIED: +re-exports
      migrations/
        0003_*.sql                               # NEW: auto-generated
        meta/0003_snapshot.json                  # NEW: auto-generated
        meta/_journal.json                       # MODIFIED: auto-updated
    routes/
      admin-events.ts                            # MODIFIED: +3 routes
      admin-events.test.ts                       # MODIFIED: +12 tests

apps/tournament-web/
  src/
    routes/
      admin.events.$eventId.pairings.tsx         # NEW
      admin.events.$eventId.pairings.test.tsx    # NEW
    routeTree.gen.ts                             # MODIFIED: auto-regen
```

**Explicitly NOT in T4-2 (reserved for future):**
- T4-3 PDF schedule export.
- Pin persistence (pins stay client-side per Risk §6).
- Auto-rotation of pairing slots within a round (UI only does manual reorder if implemented; otherwise slot_number = array index).
- Drag-drop UX (v1 uses `<select>` dropdowns; drag-drop is a v1.5+ polish).

### References

- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` Story T4.2 (line 1146-1184).
- Predecessor stories: T3-1 (events/event_rounds/groups/group_members schema); T4-1 (suggestPairings engine).
- Pattern reference: T3-9 admin-event-rounds.ts (transactional upsert + 6-step error precedence).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
