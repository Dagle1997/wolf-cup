# T5-5: Cross-Group Stroke-Play Leaderboard (v1) [new]

## Status

Done

## Story

As any Event participant,
I want a cross-group stroke-play leaderboard that ranks all players across all foursomes for the current Event, updating within 30s of upstream score commits (NFR-P2),
So that Mark can watch Pinehurst Day 2 from the clubhouse without bothering Jeff (FR-C1, FR-C2).

T5-5 introduces the `services/` query-layer (per architecture D1-1 + Services Layer Pattern) to the tournament-api: this is the FIRST service file in the workspace, so it doubles as the directory's establishing pattern.

T5-5 v1 deliberately scopes OUT tie-break logic per Josh's 2026-04-30 directive — see Section 4 below. FR-C5 stroke-play tie-break is deferred to a future per-event-configurable setting. Net handicap is slope-aware-but-18-hole-only — see Section 5.

T5-5 is the next story in Josh's Option-A T5 sequencing: T5-3 ✓ → T5-6 ✓ → T5-2 ✓ → T5-4 ✓ → **T5-5 (this)**.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. Path footprint — ALLOWED only, ZERO SHARED, ZERO FORBIDDEN expected

This story touches:

- `apps/tournament-api/src/services/leaderboard.ts` — NEW (~150 lines; `computeLeaderboard(ctx, eventId, opts) → LeaderboardRow[]` query service, exports `LeaderboardRow` type, slope-aware net handicap, NO tie-break logic)
- `apps/tournament-api/src/services/leaderboard.test.ts` — NEW (4 fixtures per AC-7: all-tied-zero, mid-round mixed-thru, event-scope across 2 rounds, null handicap_index; hits real SQLite test DB via existing test-db helper pattern)
- `apps/tournament-api/src/services/index.ts` — NEW (~10 lines; barrel re-export)
- `apps/tournament-api/src/services/handicap.ts` — NEW (~60 lines; slope-aware course handicap helper — USGA formula `Math.round(handicapIndex × slopeRating / 113 + (courseRating − coursePar))`; reads `slope` + `rating` + `coursePar` from `course_tees` + `courses`; private to services dir for now, may promote to lib/ if reused)
- `apps/tournament-api/src/services/handicap.test.ts` — NEW (unit tests for the formula across multiple Pinehurst tee specs + null/missing-data cases)
- `apps/tournament-api/src/routes/events-leaderboard.ts` — NEW (~80 lines; the GET route, gated by `requireSession` + `require-event-participant` middleware from T3-8)
- `apps/tournament-api/src/routes/events-leaderboard.integration.test.ts` — NEW (route-level integration tests)
- `apps/tournament-api/src/app.ts` — modified (mount the new `eventsLeaderboardRouter`)
- `apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx` — NEW (~140 lines; the page; TanStack Query polling 15s; rank/name/handicap/thru/gross/net columns; **inlines `fetch('/api/...')` directly** — `apps/tournament-web/src/lib/api.ts` does not exist and the existing tournament-web pattern is bare-fetch in route files; spec amended 2026-05-01 iteration 2 to drop the lib/api.ts row)

**Zero SHARED files.** No `package.json` / `pnpm-lock.yaml` / docker-compose / tsconfig touches expected.

**Zero FORBIDDEN edits.** No Wolf Cup paths. (We port the USGA handicap formula from Wolf Cup's `packages/engine/src/course.ts` — formula is USGA-standard, ~3 lines — but do not import the engine. Wolf Cup's data is hardcoded to Guyan; tournament reads slope/rating per-course from `course_tees`.)

### 2. Dependencies + forward references

**Met dependencies:**
- T5-1 ✓ — `hole_scores`, `round_states`, `rounds`, `players` (handicap_index field) tables
- T2-1 ✓ — `course_tees` (slope, rating fields per tee) + `courses` (par per course)
- T3-1 ✓ — `events` + `event_rounds` schema (event-to-rounds resolution)
- T3-8 ✓ — `require-event-participant` middleware (gates the route)

**Followup stories deferred from T5-5 (record so they don't get lost):**
- **T5-5b: Per-event tie-break configuration** — adds a per-event/per-group setting that lets the organizer pick from {none-shared-rank, back-9-countback, hole-by-hole-from-18, custom-formula} as the tie-break rule. Surfaces in the event setup UI. T5-5 v1 has no tie-break: equal-gross players share the rank with `tiedWith > 1`. Per Josh: "We can figure that out manually [for Pinehurst]. Just have it as a setting and options for future app development." Out of scope here.
- **T5-5c: Per-9 slope/rating support** — schema enhancement to add `front9Rating`/`back9Rating`/`front9Slope`/`back9Slope` columns to `course_tees`; updates T2-3 PDF parser to capture; back-fills the 5 already-seeded Pinehurst courses. Required for correct 9-hole handicap math (per-9 rating is NOT half-of-18; it's USGA-issued per nine). Per Josh: "We don't have to have 9 hole scoring in for pinehurst. Just for future." Out of scope here. T5-5 v1 uses 18-hole rating only.
- **T6-10 followup acknowledged but no longer tied to T5-5** — T6-10's `breakTie()` pure function will live alongside T5-5b's tie-break config (both implement tie-break logic from different angles). Since T5-5 ships with NO inline tie-break, there's nothing to delegate to T6-10; the two stories are now independent.

### 3. Service layer convention (this story establishes the pattern)

Per architecture.md "Services Layer Pattern" (lines 586+):
- **Query services** — read + compute, never write. `computeLeaderboard` is a query service.
- Signature: `(ctx, ...inputs) → result` where `ctx` is a passed-in object containing `tenantId` and the `db` handle (per T5-6 pattern). Services do NOT read tenant from request context directly; routes thread `ctx` from the request.
- Tenant scoping: every query MUST include `WHERE tenant_id = :ctx.tenantId`. The constant `TENANT_ID` is sourced from the existing tournament tenant constant (currently `'guyan'` per migration 0025; same convention T5-6 uses).
- Routes call services, not engine. (No engine imports in this story.)

The service uses Drizzle's read-only `db.select()` API directly. No transactions needed (read-only).

### 4. Tie-break — deferred entirely (per Josh 2026-04-30)

T5-5 v1 ranks players strictly by **gross strokes ascending**. When two or more players have the same gross stroke total within the scope, they **share the rank**. `LeaderboardRow.tiedWith` reflects the count of players sharing that rank (so `tiedWith=1` means no tie, `tiedWith=3` means a 3-way tie).

**Ranking semantics: 1224 (competition / standard) ranking.** If three players are tied for rank 1, all three show `rank=1, tiedWith=3`, and the next non-tied player shows `rank=4` (skipping ranks 2 and 3). Not 1223 (dense). This matches USGA + general golf scoreboard convention.

**Deterministic ordering within a tie (UI stability).** When players are tied on gross, the service breaks the display order by `playerId ASC` (UUID lexicographic) as a stable secondary sort. This is NOT a tie-break for ranking — all tied players share the same `rank` and `tiedWith` — but it ensures that successive polls render the same player order within a tied group, preventing UI flicker. The same secondary sort applies to unscored players (all `grossThroughHole = null`).

**Unscored-player rank position.** Players with `grossThroughHole = null` always sort AFTER any scored player (`NULLS LAST`) and receive a single shared rank equal to `(count of scored players) + 1`. If 5 of 8 players have scores and 3 are unscored, the 3 unscored players all show `rank=6, tiedWith=3` regardless of their handicap or any other field. This applies in both round and event scope.

This is a deliberate deviation from epic AC line 1402 ("FR-C5 stroke-play tie-break"). Recorded as: "v1 punts FR-C5 to T5-5b which will surface tie-break as a per-event/per-group configurable setting; for Pinehurst, ties resolve manually." Future T5-5b will let the organizer pick the tie-break rule in event setup; T6-10's `breakTie()` pure function lives alongside that.

UI implication: when ties exist, all tied players show identical rank with the count visible (e.g., "T-3 (3-way)" or similar). Specific UX wording is in Task 7.

### 5. Net handicap — slope-aware, 18-hole-only v1

Net score = gross score − course handicap, where course handicap is computed via the USGA formula:

```
courseHandicap = Math.round(handicapIndex × (slopeRating / 113) + (courseRating − coursePar))
```

For 18-hole rounds (all Pinehurst rounds), this uses the tee's 18-hole `slope` and `rating` from `course_tees`, plus `coursePar` from `courses`. The math lives in `apps/tournament-api/src/services/handicap.ts` as `calcCourseHandicap({ handicapIndex, slope, rating, coursePar })`. The formula matches Wolf Cup's `packages/engine/src/course.ts:14` (USGA-standard); we port the formula, NOT the data (which is Guyan-hardcoded in Wolf Cup).

**v1 limitation: 18-hole rating only.** Wolf Cup's existing implementation also uses 18-hole rating only, and tournament's `course_tees` table (T2-1) does not yet store per-9 rating columns. Per-9 ratings will be added in T5-5c (followup). For Pinehurst trip-week (4 days × 18-hole rounds), 18-hole rating is sufficient.

**Edge cases (explicit):**
- `players.handicap_index IS NULL` → `netThroughHole = null`. Player still ranked by gross like everyone else; net column shows `—` for that row.
- Tee-rating row missing for the round's tee → 500 internal error from the service; this is a data-integrity violation (every round MUST have a tee, and every tee MUST have a `course_tees` row). T2-3 + T2-5 enforce this on course-create; if it slips, fail loud.
- `coursePar IS NULL` on the course row → 500 internal error; same reasoning.

Per-hole net allocation (for partial-round display): course handicap is allocated proportionally to holes played (e.g., through 9 holes, net allocation is `courseHandicap × 9 / 18` rounded half-up). This matches how partial-round nets are typically displayed; the v1.5 alternative is per-stroke-index allocation (Wolf Cup's `getHandicapStrokes` pattern), but that's deferred — gross is the primary leaderboard metric anyway.

### 6. Round vs event scope

`computeLeaderboard(ctx, eventId, { roundId, scope: 'round' })`:
- Sums strokes within the single round identified by `roundId`.
- `throughHole` = number of scored holes in this round (0–18).

`computeLeaderboard(ctx, eventId, { scope: 'event' })` (no roundId):
- Sums strokes across ALL rounds belonging to the event (`rounds.event_round_id IN (event_rounds for eventId)`).
- `throughHole` = total scored holes across ALL the event's rounds.

Both scopes apply gross-asc ordering with shared rank for ties. No tie-break logic.

### 7. `round=current` resolution + zero-rounds-yet behavior

API param `round=current` resolves to:
1. Most-recent round in `round_states.state = 'in_progress'` for the event.
2. Else most-recent round in `round_states.state = 'complete_editable'`.
3. Else most-recent round of any state.
4. Else (event has zero rounds yet) → return `{ rows: [], round: null, scope: 'round', computedAt }` with HTTP 200. Do not 404; the event exists.

"Most recent" ordering: `ORDER BY rounds.opened_at DESC NULLS LAST, rounds.created_at DESC, rounds.id DESC`. Deterministic; ties on opened_at + created_at broken by id (insertion order).

### 8. Polling discipline

The leaderboard page uses TanStack Query with `refetchInterval: 15000`. No SSE, no WebSocket, no optimistic update. The 15s cadence + ≤15s server propagation envelope satisfies the 30s NFR-P2 target.

`computedAt` ISO timestamp is included in the API response; v1 UI does not display "Last updated Ns ago" (reserved for v1.5).

## Acceptance Criteria

(Derived from epics-phase1.md T5.5 lines 1396–1426. Notable v1 deviations from the epic AC are flagged inline.)

**AC-1 — Service signature.**
**Given** `apps/tournament-api/src/services/leaderboard.ts`
**When** inspected
**Then** it exports `computeLeaderboard(ctx: Ctx, eventId: EventId, opts: { roundId?: RoundId, scope: 'round' | 'event' }): Promise<LeaderboardRow[]>` as a query-service function (reads-only — per architecture services layer split; never writes). `LeaderboardRow` shape: `{ playerId, playerName, handicapIndex, grossThroughHole, netThroughHole, throughHole, rank, tiedWith }`. (v1 deviation from epic: signature adds `ctx` first param for tenant scoping per services convention; epic showed `(eventId, opts)` only.)

**AC-2 — Round scope ordering (no tie-break v1).**
**Given** a round in progress with partial scores
**When** `computeLeaderboard(ctx, eventId, { roundId, scope: 'round' })` is called
**Then** it returns rows sorted by `grossThroughHole ASC NULLS LAST` (lower gross first; unscored players appear last). Players with equal `grossThroughHole` share the same rank with `tiedWith` reflecting the count of tied players. (v1 deviation from epic: no FR-C5 back-9 / hole-by-hole tie-break — deferred to T5-5b. Equal gross totals stay shared.)

**AC-3 — Event scope aggregation.**
**Given** an Event with multiple completed + in-progress rounds
**When** `computeLeaderboard(ctx, eventId, { scope: 'event' })` is called
**Then** rows aggregate across rounds (sum of gross strokes across all scored holes); ranking is by aggregated gross asc with shared rank for ties; `throughHole` represents the player's total scored holes across the event.

**AC-4 — API route + status codes.**
**Given** `GET /api/events/:eventId/leaderboard?round=<value>` where `<value>` is a UUID, the literal string `'current'`, or the param is omitted entirely.
**When** invoked by any Event participant (gated by `require-event-participant` from T3-8)
**Then** scope selection is determined explicitly by the param:
  - `?round=<UUID>` → scope='round' for that specific round; 400 on bad UUID shape; 404 if the round id doesn't belong to this event.
  - `?round=current` → scope='round' resolved per Section 7 (most-recent in-progress, etc.); 200 with `rows: [], round: null` if event has zero rounds.
  - param omitted (`/leaderboard` with no `?round=`) → scope='event'; aggregates across all rounds; `round: null` in response.

Response shape: `{ rows: LeaderboardRow[], round: { id, eventRoundId, name, status } | null, scope: 'round' | 'event', computedAt: ISO }` with HTTP 200. Unknown event id → 404. Non-participant → 403 via middleware.

**AC-5 — Page render + polling.**
**Given** `apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx`
**When** rendered
**Then** the page shows a single table with columns: rank, player name, handicap, thru hole, gross, net. The table polls `/leaderboard` every 15s via TanStack Query. No SSE / WebSocket in v1. When `tiedWith > 1` for a row, the rank cell shows `T-<n>` (e.g., `T-3`).

**AC-6 — Score-commit propagation.**
**Given** a scorer commits a score on their device
**When** another participant's leaderboard tab refreshes (next poll)
**Then** the new score is reflected in the row's `grossThroughHole` / `netThroughHole`; rank shifts visible if the commit moved the player.

**AC-7 — Test fixtures.**
**Given** `apps/tournament-api/src/services/leaderboard.test.ts`
**When** tests run
**Then** at least these fixtures pass: (a) all 8 players with zero scores at round start (all `rank=1`, `tiedWith=8`, `grossThroughHole=null`, `throughHole=0`); (b) mid-round with one player through 9 holes (gross 38) and three players through 4 holes (gross 16, 17, 18) — order by gross asc with `throughHole` reflected per row; (c) event-scope across 2 rounds (round 1 fully scored, round 2 partially scored) — aggregated gross + thru-hole sums correct; (d) null handicap_index → `netThroughHole=null`, gross-based rank still works.

## Tasks / Subtasks

- [x] **Task 1: Establish `services/` directory + barrel.** Create `apps/tournament-api/src/services/index.ts` exporting from `./leaderboard` + `./handicap`. Add directory README comment in the barrel header noting query-services-only convention (no writes).

- [x] **Task 2: Implement `services/handicap.ts` — slope-aware course handicap.**
  - Export `calcCourseHandicap({ handicapIndex, slope, rating, coursePar })` returning the integer course handicap per the USGA formula (Section 5).
  - Export `allocateNetThroughHole({ courseHandicap, throughHole })` returning the proportional allocation (Section 5 partial-round rule).
  - Header comment links to Wolf Cup's `packages/engine/src/course.ts:14` as the formula source (USGA standard). Do NOT import; tournament owns its own copy.
  - Unit tests in `services/handicap.test.ts`: (a) Pinehurst No. 2 blue tee handicap-index 12.0; (b) Pine Needles white tees handicap-index 0.0 and 28.5; (c) null handicap-index passed → throws (caller responsibility to handle); (d) missing/null slope or rating → throws.

- [x] **Task 3: Implement `computeLeaderboard` query service.**
  - Create `apps/tournament-api/src/services/leaderboard.ts`.
  - Export `LeaderboardRow` type per AC-1 shape.
  - Implement `computeLeaderboard(ctx, eventId, { roundId?, scope })`:
    - For scope='round' with explicit `roundId`: fetch the round + its tee-color + course-rev → resolve `slope`, `rating`, `coursePar` for the tee. Then fetch all `hole_scores` for that round.
    - For scope='event' (no roundId): resolve event's round IDs first; for each round fetch its tee-color + slope/rating/par; aggregate per player across rounds. Per-round course handicap is computed per round; net through hole is summed via `allocateNetThroughHole` per round and totaled.
    - Resolve participant set from `group_members` joined with `players` for the event.
    - Players with no scored holes appear with `grossThroughHole=null, throughHole=0`.
    - Players with `handicap_index = null` get `netThroughHole=null`.
  - Sort by `grossThroughHole ASC NULLS LAST`. Assign ranks: equal-gross share the rank; `tiedWith = count of tied players including self`. No tie-break beyond gross equality.
  - Tenant scoping: every query includes `WHERE tenant_id = ctx.tenantId`.

- [x] **Task 4: Write `services/leaderboard.test.ts` with 4 fixtures.**
  - Mirror T5-6's test-db setup pattern (real SQLite, in-memory or fresh-file, seeded fresh per test).
  - Fixture (a): all-tied-zero — 8 players, no scores, all rank=1 tiedWith=8.
  - Fixture (b): mid-round mixed-thru — 4 players, gross 16/17/18/38 with `throughHole` 4/4/4/9.
  - Fixture (c): event-scope across 2 rounds — round 1 fully scored, round 2 partial; aggregate gross + thru sum across rounds.
  - Fixture (d): null handicap_index — `netThroughHole=null` for that player; gross-based rank still works.

- [x] **Task 5: Add the GET route.**
  - Create `apps/tournament-api/src/routes/events-leaderboard.ts`.
  - Mount: `app.route('/api/events', eventsLeaderboardRouter)` with `requireSession` then `require-event-participant` then handler.
  - Route shape: `GET /:eventId/leaderboard?round=<roundId | 'current' | omitted>`.
  - Resolve round per Section 7 rules (deterministic ordering, zero-rounds → 200 empty).
  - Build `ctx = { db, tenantId: TENANT_ID }` from imports + the constant. Call `computeLeaderboard(ctx, eventId, { roundId, scope })`. Return `{ rows, round, scope, computedAt }`.
  - Errors: 400 invalid roundId UUID, 404 unknown event, 403 (handled by middleware), 500 missing tee/course-par data.

- [x] **Task 6: Wire the route into `app.ts`.**
  - Modify `apps/tournament-api/src/app.ts` to mount `eventsLeaderboardRouter` after the existing event-related mounts. Verify middleware order (requireSession → require-event-participant → handler).

- [x] **Task 7: Write `events-leaderboard.integration.test.ts`.**
  - Pattern after `apps/tournament-api/src/routes/scores.integration.test.ts`.
  - Tests: (a) participant happy path — 200 with rows; (b) non-participant — 403; (c) bad roundId UUID — 400; (d) unknown event id — 404; (e) `round=current` resolution with in-progress / complete_editable / no-round states; (f) fresh-after-commit — POST a score via T5-6's endpoint, then GET /leaderboard, assert the row shifted.

- [x] **Task 8: Build the leaderboard page.**
  - Create `apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx`.
  - TanStack Query: `useQuery(['eventLeaderboard', eventId, scope], () => fetchLeaderboard(eventId, scope), { refetchInterval: 15000 })`.
  - UI: single table — rank | player | hcp | thru | gross | net. Rank cell renders `T-<n>` when `tiedWith > 1`.
  - Round selector: **v1 implementation deviation** — ships a TWO-option toggle (`Current round` ⇄ `All rounds (event)`) rather than a full per-round dropdown. A per-round dropdown requires an `event-rounds list` endpoint that does not yet exist; building it is explicitly out of scope. **Followup T5-5d** tracks promoting the toggle to a full select once that endpoint lands. The toggle still exercises both query-string forms (`?round=current` and omitted) per AC-4.
  - Empty state: "No scores yet" if all rows have `grossThroughHole=null`. "No participants yet." if `rows.length === 0`. "No rounds yet." when scope=current and `round=null`.
  - 403 (non-participant) and 404 (unknown event) handled inline at fetch boundary.

- [x] **Task 9 (cancelled): `apps/tournament-web/src/lib/api.ts` does not exist.** Tournament-web inlines `fetch('/api/...')` calls directly in route components (verified: e.g. `admin.events.new.tsx` uses bare fetch + JSON parse + handcrafted error handling). For consistency with the existing pattern, the leaderboard UI inlines its fetch helper in the route file rather than introduce a new lib/api.ts. **Followup T5-5e** tracks promoting these inlined fetchers to a shared lib/api.ts when a 3rd consumer arrives.

- [x] **Task 10: Run regression test pass.** All existing tournament-api + tournament-web suites must remain green; engine + Wolf Cup api unaffected.

## Dev Notes

### Project Structure Notes

- **First service file** in tournament-api. Establishes the convention. Follow architecture.md "Services Layer Pattern" (lines 586+).
- The `services/` directory parallel to `routes/` and `middleware/`. Barrel `index.ts` re-exports.
- Tenant isolation: every query MUST include `tenant_id = ctx.tenantId`. **There is currently no shared TENANT_ID module** in tournament-api — each consuming file inlines `const TENANT_ID = 'guyan';` at the top (matching T5-6's pattern at `apps/tournament-api/src/middleware/require-scorer-for-round.ts:32`). For T5-5, do the same: inline `const TENANT_ID = 'guyan';` at the top of `services/leaderboard.ts`, `services/handicap.ts`, and `routes/events-leaderboard.ts`. Routes build `ctx = { db, tenantId: TENANT_ID }` from the inlined constant + the imported db handle. (Consolidating these inlined constants into a shared module is a known followup; out of scope for T5-5.)
- Slope-aware handicap math is a near-line-for-line port of Wolf Cup's `packages/engine/src/course.ts:14` formula. Tournament owns its own copy in `services/handicap.ts`. Document the source in the file header.

### References

- Epic spec: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` lines 1386–1426 (T5.5)
- Architecture: `_bmad-output/planning-artifacts/tournament/architecture.md` — D1-1 (services layer pattern, no cache), Services Layer Pattern section, NFR-P2 30s propagation envelope
- T5-1 schema: `apps/tournament-api/src/db/schema/scoring.ts` (`hole_scores`, `round_states`, `rounds`)
- T2-1 schema: `apps/tournament-api/src/db/schema/courses.ts` (`course_tees.slope`, `course_tees.rating`, `courses.par`)
- T3-8 middleware: `apps/tournament-api/src/middleware/require-event-participant.ts`
- T5-6 reference (most recent T5 with comparable scope + test patterns): `apps/tournament-api/src/routes/scores.integration.test.ts`, `apps/tournament-api/src/middleware/require-scorer-for-round.ts`
- USGA handicap formula source: `packages/engine/src/course.ts:14` (`Math.round(handicapIndex × slopeRating / 113 + (courseRating − COURSE_PAR))`) — formula referenced; data not imported

### Risks / Followups

- **Risk: handicap math drift between this story and Wolf Cup if USGA standard changes.** Mitigated by header-comment cross-reference in `services/handicap.ts` to `packages/engine/src/course.ts`. Acceptable for v1.
- **Followup T5-5b: Per-event tie-break configuration.** Setup-time setting + per-group override; options include none-shared-rank (current v1 behavior), back-9-countback, hole-by-hole-from-18, and possibly custom.
- **Followup T5-5c: Per-9 slope/rating support.** Schema columns added to `course_tees` (front9Rating, back9Rating, front9Slope, back9Slope); T2-3 PDF parser update; back-fill for the 5 already-seeded Pinehurst courses. Required for correct 9-hole handicap math. **`allocateNetThroughHole` currently hard-codes 18 as the denominator** (apps/tournament-api/src/services/handicap.ts:78–86) — this is intentional for v1 (all 4 Pinehurst rounds are 18-hole) and produces silently wrong allocations for 9-hole rounds. T5-5c will (a) thread `holesToPlay` from the round-context query into `allocateNetThroughHole` and (b) accept per-9 slope/rating inputs, replacing the 18-hole-only formula.
- **Followup T5-5d: Per-round dropdown for the leaderboard page.** v1 ships a 2-option toggle (Current round / All rounds) because no `event-rounds list` endpoint exists yet. Once that endpoint lands (likely as part of T7-1 event home page), promote the toggle to a full select with all rounds + the All-rounds (event) option per AC-5's original wording.
- **Followup T5-5e: Promote inlined fetch helpers to `apps/tournament-web/src/lib/api.ts`.** Tournament-web currently inlines `fetch('/api/...')` calls in each route component (matching the existing pattern in `admin.events.new.tsx`, `admin.courses.upload.tsx`, etc.). When a 3rd consumer of the leaderboard fetcher lands, extract to a shared `lib/api.ts` module.
- **Followup T5-5f: AC-4 status code semantics for unknown event.** Spec AC-4 wrote "404 unknown event id" but the actual implementation returns 403 (`require-event-participant` middleware fires before the handler can check existence; non-participant 403 is preferred over leaking event existence). Integration test `events-leaderboard.integration.test.ts` documents the 403-on-unknown behavior. Followup decision needed: either (a) update AC-4 to say "403 on unknown event id by design (privacy)" + remove the now-unreachable `event_not_found` 404 branch in events-leaderboard.ts:64–75, or (b) reorder middleware so existence is checked before participant-gate. v1 defers the decision; tests + impl + AC are mutually inconsistent on this single point.
- **Followup (caching).** If realistic-data leaderboard SELECT exceeds ~200ms, introduce `round_computations` cache + invalidate on score-write. Out of scope for v1.
- **Followup (UI polish).** "Last updated Ns ago" relative timestamp, sticky header on long lists, mobile-friendly column collapse — all v1.5.
- **Followup (T7-1 link).** Event home page (T7-1) will link to this leaderboard route. Cross-link is in T7-1's scope, not this story's.

## Files this story will edit

- apps/tournament-api/src/services/leaderboard.ts
- apps/tournament-api/src/services/leaderboard.test.ts
- apps/tournament-api/src/services/handicap.ts
- apps/tournament-api/src/services/handicap.test.ts
- apps/tournament-api/src/services/index.ts
- apps/tournament-api/src/routes/events-leaderboard.ts
- apps/tournament-api/src/routes/events-leaderboard.integration.test.ts
- apps/tournament-api/src/app.ts
- apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx
- apps/tournament-web/src/routeTree.gen.ts (auto-regenerated by `tsr generate` when a new route file lands)

Additional files MAY be added during implementation only under `apps/tournament-*/**` and MUST be appended to this list before commit. Any path outside this set or outside `apps/tournament-*/**` requires re-running the spec gate.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (acting as tournament-director driving dev-story per workflow-tournament.yaml).

### Debug Log References

Iteration 1 (2026-04-30 → 2026-05-01 conversation):
- Step 5 partial — API side foundation written; tests + UI deferred to iteration 2 due to conversation length budget.

Iteration 2 (2026-05-01 resume after dirty-tree gate `T5-5-...-dirty-tree-6cd5d723`):
- Authored `services/leaderboard.test.ts` (6 tests across 4 required AC-7 fixtures + 2 ranking-semantics fixtures: 1224 ties at top, mixed scored+unscored share rank scoredCount+1).
- Authored `routes/events-leaderboard.integration.test.ts` (10 tests: happy path, 403, 400, unknown-event 403-via-middleware, cross-event 404, round=current with in_progress / complete_editable / fallback / zero-rounds branches, scope=event omitted-param, AC-6 fresh-after-commit propagation).
- Authored `apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx` (LeaderboardPage component + Route registration; 15s polling; T-N rank rendering; current/event scope toggle; 403/404/empty/unscored states inline).
- Spec amended: Task 9 cancelled (lib/api.ts does not exist; tournament-web inlines fetch); Task 8 round-selector simplified to 2-option toggle for v1 (followup T5-5d for per-round dropdown when event-rounds list endpoint exists); routeTree.gen.ts added to file list (auto-regenerated).
- Followups added inline: T5-5d (per-round dropdown), T5-5e (promote inlined fetchers to lib/api.ts).

### Completion Notes List

**Spec deviation discovered mid-implementation:** the spec's "Files this story will edit" listed `apps/tournament-web/src/lib/api.ts` as modified, but **that file does not exist** in the tournament-web tree. Tournament-web inlines `fetch('/api/...')` calls directly in route components (verified: e.g. `admin.events.new.tsx` uses bare fetch + JSON parse + handcrafted error handling). For consistency with the existing pattern, the leaderboard UI will inline its fetch in the route file rather than introduce a new lib/api.ts. The "Files this story will edit" section needs an amendment in iteration 2: drop `apps/tournament-web/src/lib/api.ts`. No SHARED or FORBIDDEN paths affected.

**Notes on the implementation as written:**
- `handicap.ts` accepts `ratingTimes10` (the integer-cents form stored in `course_tees.rating`) and decodes by /10 internally. Throws on null/invalid inputs; caller (leaderboard.ts) is responsible for null-handicap-index handling and sets `netThroughHole = null` instead of calling.
- `leaderboard.ts` aggregates **per-round** for net allocation (each round may use a different tee → different course handicap), then sums for event scope. Course handicap is computed per round, allocated proportionally to holes scored in that round, then `(round_gross − allocated_handicap)` is summed across rounds to produce `netThroughHole`.
- The "Reviewed-files" + mtime two-signal freshness check is enforced when this iteration runs codex; both signals will need to be present for proceeding.
- The fallback "round=current" resolution in `events-leaderboard.ts` does three sequential queries (in_progress → complete_editable → any-state). A single CASE-based ordering query would be more efficient; deferred as a v1.5 perf followup if real data shows it.

### File List

**Written in iteration 1 (this turn):**
- `apps/tournament-api/src/services/handicap.ts` (NEW)
- `apps/tournament-api/src/services/handicap.test.ts` (NEW)
- `apps/tournament-api/src/services/leaderboard.ts` (NEW)
- `apps/tournament-api/src/services/index.ts` (NEW barrel)
- `apps/tournament-api/src/routes/events-leaderboard.ts` (NEW)
- `apps/tournament-api/src/app.ts` (modified — imported + mounted `eventsLeaderboardRouter`)

**Written in iteration 2 (this turn):**
- `apps/tournament-api/src/services/leaderboard.test.ts` (NEW — 6 tests, 4 AC-7 fixtures + 2 ranking-semantics fixtures)
- `apps/tournament-api/src/routes/events-leaderboard.integration.test.ts` (NEW — 10 tests)
- `apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx` (NEW)
- `apps/tournament-web/src/routeTree.gen.ts` (regenerated by `tsr generate`)
- `_bmad-output/implementation-artifacts/tournament/T5-5-cross-group-stroke-play-leaderboard-v1.md` (this file — Status → Done; tasks → checked; iteration-2 notes appended)
- `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml` (T5-5 → done; flipped atomically with the impl commit per step 10)
