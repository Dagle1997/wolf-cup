# T13-1: Organizer Locked Out of Their Own Event (login trap)

## Status

ready-for-dev

## Story

As the organizer of an event, I want to be able to view my event's pages after signing in (not be 403'd off my own event home), so I'm never dead-ended right after Google login — closing the confirmed prod trap where the only player (the organizer) lands on a "You aren't a participant in this event" wall with no in-app way out.

## Audit (grounded, observed — not assumed)

**Confirmed live on prod 2026-05-22** (read-only DB inspection of `/app/data/tournament.db` + code trace):

- Prod has exactly **1 player** (the organizer, `is_organizer=1`), **1 event** ("71 at Pinehurst", `organizer_player_id` = that player), **1 group**, and **`group_members` is EMPTY (0 rows)**.
- **The trap chain:**
  1. After Google login the user lands on `/` (`apps/tournament-web/src/routes/index.tsx`). For a user with exactly **1 event**, `index.tsx:68-73` auto-redirects to the **player** event-home `/events/:id`.
  2. The event-home fetches the event-detail endpoint, mounted with `requireEventParticipant` (`apps/tournament-api/src/routes/events.ts:117`).
  3. `requireEventParticipant` (`apps/tournament-api/src/middleware/require-event-participant.ts:71-87`) checks **only `group_members`** and does **NOT exempt the event organizer** → `403 { code: 'not_event_participant' }`.
  4. The web page renders the forbidden card: **"You aren't a participant in this event."** (`events.$eventId.index.tsx:183`).
  5. **Dead end:** the global-nav home link (`global-nav.tsx`) points to `/`, which re-runs the 1-event auto-redirect → back to the 403. Only `/me` escapes the loop, and `/me` has no admin link.
- **Existing precedent for the fix:** organizer-only routes already intentionally SKIP `requireEventParticipant` — `export.ts:6` ("requireEventParticipant is intentionally NOT in the chain — an organizer…") and `app.ts:213` ("requireSession + requireOrganizer (NO requireEventParticipant…)").
- **How admin authorization defines "organizer":** `requireOrganizer` (`require-organizer.ts:40`) gates on the **global `player.isOrganizer` flag**, not `events.organizer_player_id`. This story fixes the participant-view side using the **event-specific** `organizer_player_id` (Option B, per the multi-organizer vision), so the event's own organizer can both admin AND view it. Realigning the GLOBAL flag itself (so admin authority is also per-event) is the separate multi-org architecture pass — out of scope here.
- `requireEventParticipant` guards all participant-facing event routes: events detail, events-leaderboard, money, bets, schedule, gallery, activity, course-preview (grep-confirmed). Fixing the one middleware fixes the organizer's access to all of them.

## Risk Acceptance

### 1. Path footprint — ALLOWED only, ZERO SHARED, ZERO FORBIDDEN
`apps/tournament-api/**` (middleware + its test) and `apps/tournament-web/**` (event-home route + its test), plus tournament `sprint-status.yaml`. No Wolf Cup paths, no schema migration, no deps, no repo-root files.

### 2. Fix #2 (root) is at the middleware, exempting THIS EVENT'S organizer (event-specific — multi-org-correct)
Per the confirmed multi-organizer vision (any verified user organizes their own events), the exemption is scoped to **`events.organizer_player_id`** — "you may view events you organize" — NOT the global `player.isOrganizer` flag (which would let any organizer view anyone's event; codex flagged this over-broad, and it's wrong for multi-org). **Implementation (cheap-path order):** keep the existing `group_members` query FIRST — members pass exactly as today; ONLY if there is no membership row do we run the organizer lookup and call `next()` when it returns a row. **Exact predicate (all three conjuncts required):** `SELECT 1 FROM events WHERE events.id = :eventId AND events.organizer_player_id = :playerId AND events.tenant_id = :TENANT_ID LIMIT 1` — a single `WHERE` with the event id, the requesting player as organizer, AND the tenant, combined with `AND`. If ≥1 row → `next()`; else the existing `403 not_event_participant`. Do NOT split this into "fetch event, then compare in JS" without the tenant conjunct, and do NOT omit `tenant_id` (that's the no-existence-leak guard). This adds one indexed lookup only on the non-member path. A nonexistent OR foreign-tenant event yields no organizer match → the same `403 not_event_participant`, preserving the no-existence-leak invariant. `events.organizer_player_id` is `NOT NULL` (events.ts:46), so the comparison is well-defined.

### 3. Why event-specific, not the global `is_organizer` flag
The global flag + global `requireOrganizer` is the v1 single-organizer model; it does NOT fit the confirmed multi-organizer vision (Josh, 2026-05-22). `events.organizer_player_id` is the forward-compatible authorization unit, and is what this story uses. The broader migration — event-creation for any verified user, per-event roles replacing the global flag, and tenancy — is a SEPARATE design effort (the post-T13-1 multi-organizer architecture pass), NOT built here. This story fixes only the participant-view lockout, in a way that won't be thrown away by that design.

### 4. Fix #1/#3 (web) makes the page non-dead-end + gives organizers an entry point
On the player event-home, render a "Manage event" link to `/admin/events/$eventId`, shown when `session.player.isOrganizer === true`. **NOTE — deliberate interim:** the web session currently exposes only the GLOBAL `isOrganizer` flag, not "am I THIS event's organizer," so the link is gated on the global flag for now. That's acceptable because the link is a **convenience affordance, NOT an authorization boundary** — `/admin/*` and `/api/admin/*` remain guarded server-side (and become event-scoped in the multi-org pass), so a hand-crafted admin URL is still rejected server-side. In single-org testing the viewer is both the global organizer and the event organizer, so it shows correctly. Making this affordance event-specific (e.g. an `isEventOrganizer` flag on the event-detail response) is folded into the multi-organizer design work. The link removes the dead-end and gives a forward path to admin.

### 5. What is NOT in this story
- The empty `name` ("") on the organizer player row (bug #4) — separate story in the T13 audit.
- ANY prod data write (Josh: admin-URL-only, no prod mutation this session).
- The auto-redirect logic itself (`index.tsx`) is left as-is: once #2 lands, the 1-event redirect to the event-home is no longer a trap (the page loads), so changing the redirect destination is unnecessary scope.

## Acceptance Criteria

**AC-1: `requireEventParticipant` exempts THIS event's organizer (event-specific).**
**Given** an authenticated session whose `player.id === events.organizer_player_id` for the requested in-tenant `:eventId`
**Then** the middleware calls `next()` WITHOUT requiring a `group_members` row.
**And** a player who is NOT this event's organizer and NOT a member gets `403 not_event_participant` — **INCLUDING a player carrying the global `is_organizer` flag who does not organize THIS event** (proves the exemption is event-specific, not global).
**And** non-organizer member behavior is unchanged (member → next; non-member → 403).
**And** a nonexistent OR foreign-tenant `:eventId` produces no organizer match → `403 not_event_participant` (no-existence-leak preserved).

**AC-2: Middleware unit tests cover the event-specific paths.**
Tests in `require-event-participant.test.ts`: (a) this-event organizer, no membership → next/200 **[NEW]**; (b) a player who organizes a DIFFERENT event and/or carries the global `is_organizer` flag but does NOT organize THIS event, no membership → 403 **[NEW — the A-vs-B distinguishing test]**; (c) non-organizer member → next/200 (existing); (d) non-member non-organizer → 403 (existing); (e) this-event organizer but the `events` row is in a DIFFERENT tenant → 403 **[NEW — the org lookup MUST be tenant-scoped]**; (f) nonexistent event → 403 **[NEW]**.

**AC-3: Organizer can load the SPECIFIC trap endpoint without a group membership.**
The assertion targets the exact trap path: the **event-detail endpoint mounted at `events.ts:117` (`GET /api/events/:eventId`)** — what the player event-home fetches and what produced the prod 403. An integration-level test proves an organizer with NO `group_members` row now receives a 2xx from that endpoint (was 403). Extend the `events.*` integration test (or add the assertion there). This proves the chokepoint fix reaches the real route, not just the isolated middleware.

**AC-4: Event-home shows an organizer-only "Manage event" link.**
**Given** the player event-home (`events.$eventId.index.tsx`) rendered for a viewer with `player.isOrganizer === true`
**Then** a "Manage event" link/card to `/admin/events/$eventId` is present.
**And** for a non-organizer viewer, that link is absent. Covered by a render test in `events.$eventId.index.test.tsx`.

**AC-5: No regression.**
tournament-api + tournament-web test suites (plus the new tests), `pnpm -r typecheck`, `pnpm -r lint` all pass; engine + wolf-cup-api unchanged.

**AC-6: Sprint-status flip lands atomically with the commit** (`T13-1…` → `done`). `epic-T13` stays `in-progress` (more run-through stories to come).

## Tasks / Subtasks
1. Baseline test counts (tournament-api, tournament-web, engine, wolf-cup-api).
2. API: in `require-event-participant.ts`, keep the existing `group_members` query FIRST (member → next, unchanged). If NOT a member, run a tenant-scoped lookup on `events` for `:eventId` and call `next()` when `events.organizer_player_id === player.id`; otherwise the existing `403 not_event_participant`. Import the `events` schema.
3. API tests: add the event-specific cases to `require-event-participant.test.ts` (this-event organizer → next; global-`is_organizer`-but-not-this-event → 403; cross-tenant org row → 403; nonexistent → 403); add/extend an integration test proving THIS event's organizer with no `group_members` row gets 2xx on the events-detail route (AC-3).
4. Web: in `events.$eventId.index.tsx`, read `player.isOrganizer` (via `useAuthSession()`), render an organizer-only "Manage event" link to `/admin/events/$eventId`. Add the render test (AC-4).
5. Run tournament-api + tournament-web tests + `pnpm -r typecheck` + `pnpm -r lint` + engine/wolf-cup-api (AC-5).

## Dev Notes

### Architectural alignment
The fix lives at the single chokepoint (`requireEventParticipant`) so every participant-gated route inherits it. The exemption is keyed on `events.organizer_player_id` (event-specific) — the forward-compatible authorization unit for the confirmed multi-organizer model, deliberately NOT the global `is_organizer` flag. Membership is checked first (common path unchanged); the `events` lookup runs only for non-members. This is the coherent counterpart to the already-shipped pattern where organizer-only routes skip the participant check (export.ts/app.ts:213). The web link is the organizer→admin bridge the T11 nav work intended but didn't cover for this state.

### Key references
- `apps/tournament-api/src/middleware/require-event-participant.ts:71-87` — the check to amend (add the non-member organizer branch).
- `apps/tournament-api/src/db/schema/events.ts:46` — `organizer_player_id` (NOT NULL) — the event-specific authorization unit.
- `apps/tournament-api/src/middleware/require-organizer.ts:40` — the GLOBAL flag model (context: what we are deliberately NOT using here; targeted by the multi-org pass).
- `apps/tournament-api/src/routes/export.ts:6`, `app.ts:213` — organizer-skips-participant precedent.
- `apps/tournament-web/src/routes/index.tsx:68-73` — the 1-event auto-redirect (left as-is; context only).
- `apps/tournament-web/src/routes/admin.events.$eventId.index.tsx` — the admin landing the new link targets.

### Risks / Followups
- **Multi-organizer architecture pass** (decided 2026-05-22, post-T13-1): event-creation for any verified user, per-event roles replacing the global `is_organizer` flag, an event-scoped `requireOrganizer` variant, and a tenancy decision (`TENANT_ID='guyan'` is currently hardcoded). T13-1's event-specific exemption is built to fit that direction.
- **Web "Manage event" link** is gated on the global `isOrganizer` flag for now (Risk §4); making it event-specific (an `isEventOrganizer` flag on the event-detail response) folds into the multi-org pass.
- **Empty player `name`** (#4) — separate T13 story.
- **`index.tsx` redirect** could later prefer routing organizers straight to admin; not needed once #2 lands (Risk §5).

## Files this story will edit
- apps/tournament-api/src/middleware/require-event-participant.ts
- apps/tournament-api/src/middleware/require-event-participant.test.ts
- apps/tournament-web/src/routes/events.$eventId.index.tsx
- apps/tournament-web/src/routes/events.$eventId.index.test.tsx
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

(All under `apps/tournament-api/**`, `apps/tournament-web/**`, or the tournament implementation-artifacts folder — ALLOWED. Zero SHARED, zero FORBIDDEN. If AC-3's integration assertion lands in an existing route test file, that file is under `apps/tournament-api/src/routes/**` (ALLOWED) and will be appended here before commit.)

## Dev Agent Record
### Agent Model Used
claude-opus-4-7[1m] (acting as tournament-director).
### Debug Log References
- Tests (deltas vs start-of-story): tournament-api 965→**970** (+4 middleware cases, +1 events integration case); tournament-web 329→**331** (+2 admin-link render tests); engine **472** unchanged; wolf-cup-api **517** unchanged. `pnpm -r typecheck` + `pnpm -r lint` clean.
- **Allowlist verification:** `git status --porcelain` filtered for `apps/(api|web)/` and `packages/engine/` → **NONE**. Every edited path is `apps/tournament-api/**`, `apps/tournament-web/**`, or tournament artifacts.
- Codex: spec v1 = 1 High (global-flag over-broadening) + 2 Med + 1 Low → **High resolved by switching to Option B** (event-specific `organizer_player_id`) + Med/Low addressed; spec v2 = High RESOLVED, 1 Med (predicate clarity, addressed) + 1 Low (acknowledged). Impl v1 = 1 Med (a test couldn't catch a dropped `events.id` conjunct) + 1 Low → **test hardened** (different-event-organizer case); impl v2 = **PASS, 0 findings**. Party review = SHIP-READY. Party-codex = 2 High + 1 Med, **all false positives** from reviewing the prose file in isolation (it misread "tournament-web" as Wolf Cup's `apps/web` and called a backend-vs-frontend phrasing a contradiction) — refuted by the git-status allowlist proof above and the impl-codex allowlist confirmation; review wording tightened so it can't mislead a context-free reader.
### Completion Notes List
- **Fix = event-specific organizer exemption (Option B)** in `require-event-participant.ts`: on the non-member path, a tenant-scoped lookup `events WHERE id=:eventId AND organizer_player_id=:playerId AND tenant_id=TENANT_ID` → `next()` if matched, else the existing 403. Keyed on `organizer_player_id`, NOT the global `is_organizer` flag (proven event-specific by the integration test, which stamps `isOrganizer:false`).
- **Web component NOT modified:** the "Manage event" admin link already existed (gated on `isOrganizer`); the bug was the 403 short-circuiting the render before reaching it. The API fix makes the existing link reachable. Web changes are test-only (2 render tests + the render helper's `isOrganizer` pass-through + an `/admin/events/$eventId` stub route).
- **Decision recorded:** exemption scope is event-specific per the confirmed multi-organizer vision (Josh, 2026-05-22). The interim web link stays gated on the global flag (convenience, not authority; server enforces).
- **Out of scope / followups:** the multi-organizer architecture pass (event-creation for any verified user, per-event roles replacing the global flag, tenancy — `TENANT_ID='guyan'` hardcoded) is the NEXT planned design effort; the empty player `name` (#4) is a separate T13 story.
### File List
- apps/tournament-api/src/middleware/require-event-participant.ts (organizer exemption branch + doc comment)
- apps/tournament-api/src/middleware/require-event-participant.test.ts (4 new T13-1 cases incl. the different-event-organizer guard)
- apps/tournament-api/src/routes/events.integration.test.ts (AC-3: this-event organizer, no membership, isOrganizer:false → 200)
- apps/tournament-web/src/routes/events.$eventId.index.test.tsx (2 admin-link render tests; helper `isOrganizer` + `/admin/events/$eventId` stub)
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml (T13-1 → done at step 10; epic-T13 stays in-progress)
- _bmad-output/reviews/T13-1-organizer-event-lockout-fix-{spec-codex,spec-codex-v2,impl-codex,impl-codex-v2,party-review,party-codex}.md
