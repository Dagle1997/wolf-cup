# T13-2: Start Round — Instantiate Scoring (the missing create-round path)

## Status

ready-for-dev

## Story

As an organizer who has built an event (roster + locked pairings), I want to **start a round** — designating who scores each foursome — so that scoring actually becomes possible, closing the confirmed gap where the tournament app has no way to create a scoring round at all.

## Audit (grounded, observed — not assumed)

**CONFIRMED 2026-05-22 by exhaustive `.insert(` enumeration of non-test source (40 calls):** the tournament app NEVER inserts into **`rounds`**, **`round_states`**, or **`scorer_assignments`**. Every reference to those tables is a `SELECT`/`UPDATE`. The integration tests pass only because they seed those rows via direct DB inserts — masking that no endpoint creates them.

Consequences (all verified in code):
- Score entry `POST /api/rounds/:roundId/holes/:holeNumber/scores` (`scores.ts`) requires all three to pre-exist: `SELECT rounds` → 404 `round_not_found`; `SELECT round_states` → 422 `round_state_missing`; scorer check (`require-scorer-for-round.ts`) → 422 `foursome_has_no_scorer`.
- `scorer-assignments.ts` has ONLY `POST /:roundId/scorer-assignments/transfer` — hands off an *existing* assignment; there is no "assign initial scorer".
- `round-lifecycle.ts` has ONLY `complete`, `complete-rollback`, `finalize`, `cancel` — all on an *existing* round.
- **Net: there is no way to start scoring a round in the deployed app.** This is why "no rounds existed in prod" (2026-05-21).

**Wolf Cup parity (port source, read-only):** `apps/api/src/routes/admin/rounds.ts` DOES create rounds — `POST /rounds` (status `'scheduled'`) and `POST /rounds/from-attendance` (round + foursomes + players in one shot); a cron flips `scheduled → active`; `finalize` requires `active`. Wolf Cup has **no** `round_states` or `scorer_assignments` (just `rounds.status`, and anyone can score). Tournament ADDED the `round_states` state machine (T5-8) and per-foursome single-writer `scorer_assignments` (T5-6/7) but never built the create step Wolf Cup has.

**Schemas this story writes (verified `scoring.ts`):**
- `rounds`: `{ id, event_id (FK), event_round_id (FK), holes_to_play (9|18), opened_at, opened_by_player_id (FK), created_at, +tenant/context }`. **CHECK `chk_rounds_event_pairing`: `event_id IS NULL` ⇔ `event_round_id IS NULL`** — both must be set together.
- `round_states`: `{ round_id (PK/FK), state ∈ {not_started,in_progress,complete_editable,finalized,cancelled}, entered_at, entered_by_player_id (FK), +tenant/context }`.
- `scorer_assignments`: composite PK `(round_id, foursome_number)`, `{ scorer_player_id (FK), assigned_at, assigned_by_player_id (FK NOT NULL), +tenant/context }`.

**Foursomes source:** `pairings` (per `event_round`, has `foursome_number`, `locked`) + `pairing_members` (`player_id`, `slot_number`), created via the existing pairings endpoint (`admin-events.ts` `POST .../pairings`).

**Product decisions (Josh, 2026-05-22):**
- **Explicit organizer "Start round" action** (not a cron / not auto-start).
- **Organizer DESIGNATES a scorer per foursome at start** (request supplies `{foursomeNumber → scorerPlayerId}`), because a scorer must be able to log in and most rostered players are accountless — so the organizer chooses logged-in-capable scorers (or themselves).

## Risk Acceptance

### 1. Path footprint — ALLOWED only, ZERO SHARED, ZERO FORBIDDEN
New endpoint + tests under `apps/tournament-api/**`; "Start round" UI + tests under `apps/tournament-web/**`; **one new tournament migration** under `apps/tournament-api/drizzle/**` adding the partial UNIQUE on `rounds.event_round_id` (the three scoring tables already exist; this is the only schema change); tournament `sprint-status.yaml`. No Wolf Cup edits (Wolf Cup is read-only parity reference), no deps. (Correction of an earlier draft that said "no schema migration" — there is exactly one, scoped to tournament, ALLOWED.)

### 2. The endpoint creates all three rows in ONE transaction; idempotency is RACE-SAFE via a DB constraint
A single transaction inserts the `rounds` row, the `round_states` row, and N `scorer_assignments` rows — all-or-nothing, so a committed `rounds` row ALWAYS implies its `round_states` row + a complete set of `scorer_assignments` exist (no partial state is reachable).
**Race-safe single-round-per-event_round:** add a **`UNIQUE` index on `rounds.event_round_id`** via a new tournament migration (`apps/tournament-api/drizzle/**`). The handler does an existence check first (return the existing `roundId` with `200` if found), but the UNIQUE is the real guard: two concurrent start calls cannot both insert — the loser catches the UNIQUE violation and re-SELECTs the winner's round (the same race-safe insert-then-recover pattern used by `resolveOrInsertGhinPlayer` in `admin-groups.ts`). NOTE: `rounds.event_round_id` is nullable in the schema (legacy Wolf-Cup-shaped rounds), so the migration uses a **partial** UNIQUE index `WHERE event_round_id IS NOT NULL`.
**Re-start (idempotent):** because creation is atomic, a found `rounds` row is complete → return its `roundId` (200). Defensive: if a `rounds` row exists but (impossibly) its `round_states` is missing, return a clear `409 round_state_corrupt` (logged) — never silently re-create or 500. Remediation for that should-never-happen case: organizer `cancel` + restart, or an admin DB fix; it is not a normal path.
**Migration safety (addresses codex High — airtight here):** duplicate non-null `event_round_id` rounds are **logically impossible in every environment** at the time this migration runs, because T13-2 introduces the FIRST AND ONLY code path that ever creates a `rounds` row with an `event_round_id` — before this story ships, nothing inserts such rows (the whole bug). The migration runs at container start, BEFORE the new endpoint is reachable, against data that provably has no `event_round`-linked rounds (prod verified at 0 rounds; tests use fresh in-memory DBs). So the partial UNIQUE cannot fail on existing data anywhere. As cheap belt-and-suspenders the dev MAY add a duplicate pre-check that STOPs loudly, but it guards an unreachable state. (If duplicate `event_round_id` rounds ever DID exist, that would itself be data corruption a loud migration failure should surface, not hide.) **Transaction-recovery gotcha (codex Med):** the catch-UNIQUE-then-SELECT recovery must run on a VALID (non-aborted) connection per libsql semantics — mirror the exact handling proven in `resolveOrInsertGhinPlayer` (`admin-groups.ts`), do not re-query inside an aborted transaction handle.

### 3. Validation (defense-in-depth, all 400/403/404/422 — never 500 on bad input)
- Requesting player must be the event's organizer (T13-1 Option B: `events.organizer_player_id`, tenant-scoped) — OR `requireOrganizer` (global) as the interim guard until the multi-org auth pass lands. (Spec records this; dev picks the available guard, preferring event-scoped.)
- `event_round` exists AND is in-tenant → else 404. **`event_id` is sourced from the `event_round` row (`event_rounds.event_id`), NEVER from the request body** (the body carries only the scorer mapping). This also satisfies the `chk_rounds_event_pairing` CHECK (both set together).
- Pairings for the event_round must exist AND **every pairing must be `locked`** (foursomes final before play, matching Wolf Cup's lock-before-play) → else `422 pairings_not_ready`. This is a HARD requirement, not a recommendation.
- The supplied scorer mapping must cover EVERY locked foursome exactly once: a foursome with no entry → `400 missing_scorer_for_foursome`; a `foursomeNumber` in the body that has no pairing for this event_round → `400 unknown_foursome`; a duplicate `foursomeNumber` in the body → `400 duplicate_foursome`. Body shape is strict (Zod `.strict()`-equivalent; reject unknown keys).
- Each designated `scorerPlayerId` must be a `pairing_members` row of THAT foursome's pairing (tenant- + event_round-scoped) OR the event organizer → else `400 invalid_scorer`.

### 4. Initial round_state defers to the state machine's defined entry state
"Start round" = begin scoring. The initial `round_states.state` MUST be whatever `round-state.ts` defines as the legal creation/entry state — **dev confirms against `round-state.ts` before implementing.** Expected `in_progress` (a writable state per `scores.ts` `{not_started,in_progress,complete_editable}`, with `/complete` transitioning `in_progress → complete_editable`); but if the state machine requires creation at `not_started` (also writable, so still immediately scorable), create `not_started` and document the reason. Do NOT hardcode a state the machine would reject — this is the one genuine correctness risk in the story. **Concrete contract (codex Med):** the behavioral acceptance is AC-2 — after start, a hole-score POST must succeed — which holds for ANY writable entry state, so AC-2 (not a literal state string) is the binding test; the dev records the confirmed literal state in the Dev Notes.

### 5. What is NOT in this story
- No cron / auto-start (Josh chose explicit action).
- No change to the scorer `/transfer`, score-entry, or lifecycle endpoints (they already consume the rows this story creates).
- No multi-organizer auth migration (separate design pass) — interim guard is acceptable.
- Editing a round's pairings after start, or re-opening finalized rounds — out of scope.

## Acceptance Criteria

**AC-1: Start-round endpoint creates the three row types atomically.**
**Given** an organizer, an `event_round` with locked pairings for foursomes 1..N, and a request body designating a valid scorer per foursome
**When** they POST the start-round endpoint
**Then** in one transaction it creates: exactly one `rounds` row (`event_id` sourced from `event_rounds.event_id` + `event_round_id` both set per the CHECK, `holes_to_play` copied from the event_round, `opened_by_player_id` = organizer); one `round_states` row (`state` = the state machine's legal entry state per Risk §4, `entered_by_player_id` = organizer); and N `scorer_assignments` rows (one per locked foursome, `scorer_player_id` = the designated player, `assigned_by_player_id` = organizer).
**And** returns `201` with the new `roundId`.

**AC-2: Scoring is reachable after start (the whole point).**
**Given** a round started via AC-1
**When** the designated scorer of a foursome POSTs a hole score for a player in that foursome
**Then** it succeeds (2xx) — proving `rounds` + `round_states` (writable) + `scorer_assignments` are all satisfied. (This is the gap closing: previously impossible.)

**AC-3: Validation — clean errors, never 500.** Each case has a test:
- Non-organizer → 403.
- Unknown/foreign-tenant `event_round` → 404.
- No pairings, or ANY unlocked pairing for the event_round → `422 pairings_not_ready`.
- A locked foursome with no entry in the body → `400 missing_scorer_for_foursome`.
- A body `foursomeNumber` with no pairing for this event_round → `400 unknown_foursome`.
- A duplicate `foursomeNumber` in the body → `400 duplicate_foursome`.
- A designated `scorerPlayerId` not a `pairing_members` row of that foursome (tenant + event_round scoped) and not the organizer → `400 invalid_scorer`.
- Strict body shape (unknown keys rejected).

**AC-4: Idempotent re-start, race-safe.**
**Given** a round already started for an `event_round`
**When** start-round is called again
**Then** it returns the existing `roundId` (200) and does NOT create a second `rounds` row or duplicate `scorer_assignments`.
**And** the **partial UNIQUE index on `rounds.event_round_id` (WHERE NOT NULL)** guarantees this under concurrency: two simultaneous starts cannot both insert — the loser catches the UNIQUE violation and recovers the winner's `roundId` (insert-then-recover, as in `resolveOrInsertGhinPlayer`). **Test coverage (codex Med):** a test asserts exactly one `rounds` row after a sequential duplicate start (exercises the existence-check path) AND a unit test directly exercises the catch-UNIQUE-then-recover branch (e.g., pre-insert a conflicting round, then call start → expect the existing `roundId`, one row) so the recovery code is actually covered, not just the happy existence-check. True wall-clock concurrency isn't unit-testable; the UNIQUE + covered recovery branch is the structural guarantee.

**AC-5: Web "Start round" UI.**
On the admin round/event page, an organizer sees a "Start round" control for an event_round with locked pairings: a per-foursome scorer picker (options = that foursome's members + the organizer), then a Start button that POSTs the mapping and, on success, links to score-entry. Covered by a render/interaction test (the network call is mocked).

**AC-6: Full-lifecycle E2E passes end-to-end.**
Extend `onboarding-lifecycle.e2e.test.ts` (or add a sibling) to drive: create event → add roster → save **locked pairings** → **start round** → score a hole → `GET leaderboard` reflects the score. This proves scoring is reachable through the real HTTP flow (previously dead-ended at "no round").

**AC-7: No regression.**
tournament-api + tournament-web suites (plus new tests), `pnpm -r typecheck`, `pnpm -r lint` pass; engine + wolf-cup-api unchanged.

**AC-8: Sprint-status flip atomic with the commit** (`T13-2…` → done); `epic-T13` stays `in-progress`.

## Tasks / Subtasks
1. Baseline test counts.
2. Confirm in `round-state.ts` the valid initial state (expect `in_progress`); confirm pairings schema fields (`foursome_number`, `locked`) + `pairing_members`; decide the endpoint mount (proposed `POST /api/admin/event-rounds/:eventRoundId/start` on the existing admin-event-rounds router) and the available organizer guard (event-scoped preferred).
3. API: implement the start-round handler (validation per AC-3, idempotency per AC-4, atomic 3-table create per AC-1). Zod body schema `{ scorers: [{ foursomeNumber, scorerPlayerId }] }`.
4. API tests: AC-1 creates rows; AC-2 a score POST then succeeds (chain through the real score path); AC-3 each validation; AC-4 idempotency.
5. Web: "Start round" UI + per-foursome scorer picker + render test (AC-5).
6. E2E: extend the lifecycle test through start → score → leaderboard (AC-6).
7. Run suites + typecheck + lint (AC-7).

## Dev Notes

### Architectural alignment
Mirrors Wolf Cup's deliberate admin round-creation (`admin/rounds.ts` `POST /rounds`), adapted to tournament's richer model: because foursomes already exist as `pairings`, start-round instantiates the scoring `round` + the tournament-specific `round_states` + `scorer_assignments` from those pairings, rather than building groups/players (Wolf Cup's `from-attendance` does the latter). The scorer-per-foursome designation is the organizer's explicit choice (Josh) — necessary because single-writer scoring needs a login-capable scorer and rosters are largely accountless.

### Key references
- `apps/tournament-api/src/db/schema/scoring.ts` — `rounds` (67), `round_states` (195), `scorer_assignments` (222) + the `chk_rounds_event_pairing` CHECK.
- `apps/tournament-api/src/routes/scores.ts` — the consumer that 404/422s today; AC-2 proves it now succeeds.
- `apps/tournament-api/src/routes/scorer-assignments.ts` — `/transfer` (existing handoff; pattern for assignment rows).
- `apps/tournament-api/src/services/round-state.ts` — state machine (confirm initial state).
- `apps/api/src/routes/admin/rounds.ts` (Wolf Cup, READ-ONLY) — `POST /rounds` + `/rounds/from-attendance` parity reference.
- `apps/tournament-api/src/routes/onboarding-lifecycle.e2e.test.ts` — extend for AC-6.

### Risks / Followups
- **Round-state initial value** must match the state machine (Risk §4) — the one real correctness risk.
- **Single round per event_round** — enforce via existence check in the tx (AC-4); consider a UNIQUE on `rounds.event_round_id` as a hardening followup if absent.
- **Auth interim** — event-scoped organizer guard preferred; global `requireOrganizer` acceptable until the multi-org pass.
- **9-hole rounds** — `holes_to_play` copied from the event_round; score/complete already handle 9 vs 18.

## Files this story will edit
- apps/tournament-api/src/routes/admin-event-rounds.ts
- apps/tournament-api/src/routes/admin-event-rounds.test.ts
- apps/tournament-api/src/db/schema/scoring.ts  (add partial UNIQUE on rounds.event_round_id)
- apps/tournament-api/drizzle/  (new migration for the partial UNIQUE index)
- apps/tournament-api/src/routes/onboarding-lifecycle.e2e.test.ts
- apps/tournament-web/src/routes/admin.events.$eventId.index.tsx
- apps/tournament-web/src/routes/admin.events.$eventId.index.test.tsx
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

(All under `apps/tournament-api/**`, `apps/tournament-web/**`, or tournament artifacts — ALLOWED. Zero SHARED, zero FORBIDDEN. The exact API file/mount + web file may shift slightly during dev — e.g. a new `start-round.ts` router file or a different admin web route — but stays within `apps/tournament-api/src/**` / `apps/tournament-web/src/**`; the final set is recorded in the File List before commit.)

## Dev Agent Record
### Agent Model Used
claude-opus-4-7[1m] (acting as tournament-director).
### Debug Log References
- Tests: tournament-api 970→**981** (e2e file now 13: full lifecycle + 8 validation/idempotency cases); tournament-web 331→**334** (3 start-round render tests); engine **472** / wolf-cup-api **517** unchanged; typecheck 0; lint clean.
- Allowlist verified via `git status` — zero edits under `apps/api`/`apps/web`/`packages/engine`.
- Initial state: confirmed against `round-state.ts` LEGAL_TRANSITIONS — `not_started` is the source-only entry state (nothing transitions into it) and is in the scorable set; exported as `INITIAL_ROUND_STATE`.
- Idempotency UNIQUE-detection: empirically confirmed correct — the double-start test hits the recover branch and returns 200 `alreadyStarted` (would 500 if detection failed).
- Codex: spec 3 rounds (all Highs resolved; residual migration-safety High dispositioned as logically moot — no event_round-linked rounds can exist pre-T13-2); impl v1 (0 High, 3 Med + 2 Low) → v2 (fixed: FSM-sourced initial state, +2 validation tests, tenant-scoped recovery check) → openedAt-NULL + redundant-middleware fixes (Med + Low from v2's re-review), all verified green; party SHIP-READY; party-codex 0 High (2 Med + 1 Low were prose-only on the review doc — no code/allowlist issue; review wording tightened).
### Completion Notes List
- **The gap is closed:** `POST /api/admin/event-rounds/:eventRoundId/start` creates the scoring `rounds` row (`event_id` from the event_round, `holes_to_play` copied; `opened_at`/`opened_by` left NULL for the FSM to set on first score), the `round_states` row at `INITIAL_ROUND_STATE` ('not_started'), and one `scorer_assignments` row per locked foursome from the organizer-designated `{foursomeNumber→scorerPlayerId}` mapping — in one transaction. Scoring is now reachable end-to-end (proven by the lifecycle E2E: build → pairings → start → score → leaderboard).
- **Idempotent + race-safe:** partial UNIQUE `uniq_rounds_event_round_id` (migration 0013) + insert-then-recover (no pre-check; recovery outside the aborted tx). Re-start returns 200 `alreadyStarted` with the existing roundId; defensive 409 `round_state_corrupt` for the unreachable partial-state case.
- **Validation:** 403 non-organizer (router-level `requireOrganizer`), 404 unknown event_round, 422 pairings_not_ready (no/unlocked pairings), 400 invalid_body/duplicate_foursome/unknown_foursome/missing_scorer_for_foursome/invalid_scorer (scorer must be a foursome member or the organizer).
- **Web:** dedicated read-only start-round route (per-foursome scorer pickers, default organizer) linked from the admin landing; navigates to score-entry on success. Server-side `requireOrganizer` is the authority (route `beforeLoad` is auth-only, consistent with other admin web routes).
- **Auth scope:** uses the global `requireOrganizer` (router-level) for now — becomes event-scoped in the multi-organizer pass.
### File List
- apps/tournament-api/src/routes/admin-event-rounds.ts (new start-round endpoint)
- apps/tournament-api/src/db/schema/scoring.ts (partial UNIQUE on rounds.event_round_id)
- apps/tournament-api/src/db/migrations/0013_loose_maginty.sql + meta/0013_snapshot.json + meta/_journal.json (generated migration)
- apps/tournament-api/src/services/round-state.ts (exported INITIAL_ROUND_STATE)
- apps/tournament-api/src/routes/onboarding-lifecycle.e2e.test.ts (lifecycle + validation + idempotency)
- apps/tournament-web/src/routes/admin.events.$eventId.start-round.tsx (new route) + .test.tsx (3 tests)
- apps/tournament-web/src/routes/admin.events.$eventId.index.tsx (Start round link)
- apps/tournament-web/src/routeTree.gen.ts (auto-generated route registration)
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml (T13-2 → done; epic-T13 stays in-progress)
- _bmad-output/reviews/T13-2-start-round-instantiate-scoring-{spec-codex,spec-codex-v2,spec-codex-v3,impl-codex,impl-codex-v2,party-review,party-codex}.md
