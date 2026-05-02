# T5-9: Score Correction Endpoint + Audit Log [port]

## Status

Ready for Dev

## Story

As a scorer (of the player's foursome) or per-event organizer,
I want `POST /api/rounds/:roundId/scores/:playerId/:holeNumber/correct` that writes a `score_corrections` row, updates `hole_scores`, writes an audit row, and (post-finalize) triggers downstream T6 recompute (FR-B6, FR-B8, NFR-R3),
So that Jeff can fix a miskeyed 4-that-should-have-been-5 on hole 11 of round 2 without voiding the whole round.

T5-9 sits on top of T5-1 (`score_corrections` table) + T5-8 (`getRoundState` FSM gate). It is a NARROWED port of Wolf Cup's `apps/api/src/routes/admin/score-corrections.ts` (commit `279a3538`): tournament v1 only corrects gross strokes + putts; the Wolf Cup precedent's wolf-decision / greenie / polie / sandie / handicap-index branches are out of scope (tournament has no wolf decisions, and bonuses + handicaps live in different epics).

T5-9 is the next story in epic T5 after T5-8 ✓: T5-9 → T5-10 → T5-11.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. Path footprint — ALLOWED only, ZERO SHARED, ZERO FORBIDDEN expected

```
apps/tournament-api/src/routes/score-corrections.ts                          [NEW]
apps/tournament-api/src/routes/score-corrections.integration.test.ts         [NEW]
apps/tournament-api/src/app.ts                                               [MOD: mount router]
```

If implementation surfaces additional ALLOWED files (a small helper extracted for testability), they MUST be appended to "Files this story will edit" before commit.

### 2. Dependencies + forward references

- **T5-1 `score_corrections` schema** — write target. Append-only by app-layer convention. PK on `id` (UUID); composite index on `(round_id, hole_number, created_at desc)`.
- **T5-1 `hole_scores` schema** — UPDATE target on the active correction.
- **T5-1 `audit_log`** — uses existing `AUDIT_EVENT_TYPES.SCORE_CORRECTED = 'score.corrected'` (audit-log.ts:25). No new constants.
- **T5-6 `require-scorer-for-round` middleware** — does NOT fit this endpoint's auth model directly. T5-6's middleware checks "session is scorer of the foursome containing body.playerId", which is the right semantic, but it parses a different body shape (`scorePostBodySchema`). T5-9 uses inline auth (handler-internal) following T5-7 + T5-8 pattern, NOT a wrapping middleware.
- **T5-8 `getRoundState` + `isEventOrganizer`** — used for the state gate + the organizer-recovery auth path. Reused as-is.
- **T6 money/leaderboard recompute (NOT shipped)** — epic AC says "if the round is `finalized`, also triggers T6 money/side-game recompute within the same tx". v1 ships the correction transaction skeleton WITHOUT the recompute hook (T6 services don't exist). Followup T5-9a tracks plugging T6 in when it ships. This mirrors T5-8's stance for /finalize (followup T5-8a).
- **T5-5 leaderboard** — already recomputes on read (architecture D1-1, no cache v1). No leaderboard hook needed in /correct.

### 3. Auth model (per-event organizer OR scorer-of-target-foursome)

The handler accepts either:
- **Per-event organizer** — `events.organizer_player_id == session.userId` for the event containing this round. Reuses T5-8's `isEventOrganizer(tx, roundId, callerId, tenantId)` helper. **CRITICAL:** the second positional arg passed at every call site MUST be `session.userId` (the CALLER's id), NOT the URL's `:playerId` (the target player). The signature uses the name `playerId` historically but its semantic is "the id we are checking organizer-ship for" — callers pass session.userId. Mistakenly passing the URL's `:playerId` would route organizer-correction-of-anyone-else through the wrong identity and either fail-closed (denying legitimate organizer corrections) or fail-open (allowing self-correction by anyone). Spec the call site as `isEventOrganizer(tx, roundId, session.userId, TENANT_ID)`.
- **Scorer of the foursome containing `:playerId`** — looks up which foursome the URL's `:playerId` is in (via `pairing_members → pairings` keyed on `event_round_id`), then checks if `session.userId` is the assigned scorer of THAT foursome (`scorer_assignments.scorer_player_id`).

Auth lookups happen INSIDE the transaction (T5-7/T5-8 pattern; TOCTOU-safe vis-à-vis concurrent /handoff or /finalize). 403 `not_authorized_for_correction` on mismatch.

**Why not the scorer of ANY foursome?** Jeff scoring foursome 1 has no business correcting foursome 2's scores; that's foursome 2's scorer's job. The narrowed scope reduces blast radius. The per-event organizer is the universal-recovery path (matching T5-7's two-identity pattern).

### 4. State-machine integration (T5-8 owns the FSM)

Allowed states for `/correct` per epic AC:
- `in_progress` — corrections during play (rare; usually scorer just types right number)
- `complete_editable` — the dominant case (fix typos in the post-round review window)
- `finalized` — corrections after lock (Wolf Cup precedent: re-runs Harvey on finalize-corrected scores; v1 tournament only writes the correction without recompute)

Rejected states:
- `not_started` — 422 `round_state_forbids_correction`
- `cancelled` — 422 `round_state_forbids_correction`

State read goes through `getRoundState(tx, roundId, tenantId)` from T5-8. Auth checks happen BEFORE state check (T5-8 party-codex precedent: state read before auth leaks existence to unauthorized callers).

### 5. Append-only score_corrections; UPDATE hole_scores

Per T5-1's "score_corrections is append-only by app-layer convention" rule: T5-9 INSERTS a new score_corrections row per correction; never UPDATES or DELETES existing rows. Even an undo is a new row (priorValueJson + newValueJson swapped).

Audit row is in addition to the score_corrections row — `audit_log` uses generic `'score.corrected'`; `score_corrections` is the dedicated, queryable history table.

### 6. UPDATE narrowed by tenant (no state-gating EXISTS)

The `hole_scores` UPDATE uses `WHERE round_id = :roundId AND player_id = :playerId AND hole_number = :holeNumber AND tenant_id = :tenant`. NO state-gating EXISTS predicate is added because T5-9 explicitly allows correction in `finalized` state — the very state T5-7 + T5-8 use the EXISTS predicate to block. Race-window concern is documented as residual (under T5-8b's BEGIN IMMEDIATE umbrella) — same v1 acceptance as T5-7/T5-8's residual.

### 7. Tenant scoping

Every query in `routes/score-corrections.ts` includes `tenant_id = TENANT_ID` on every joined table. Inline `const TENANT_ID = 'guyan'` per the established pattern.

## Acceptance Criteria

(Derived from epics-phase1.md T5.9 lines 1552-1588.)

**AC-1 — Endpoint shape + body validation.**
**Given** `POST /api/rounds/:roundId/scores/:playerId/:holeNumber/correct` with body `{ grossStrokes: integer 1-20, putts?: integer 0-15 | null, reason?: string }`
**When** invoked
**Then** body parsed via Zod `scoreCorrectionBodySchema`. `:roundId` and `:playerId` validated as UUIDs (400 `invalid_round_id` / `invalid_player_id`). `:holeNumber` validated as integer 1-18 (400 `invalid_hole_number`). On Zod failure: 400 `{ error: 'validation_error', code: 'invalid_body', issues, requestId }`.

**AC-2 — In-tx auth FIRST, then state gate (no existence leak).**
**Given** valid body
**When** the handler runs `db.transaction`
**Then**:
  (i) Authorization re-check INSIDE the tx: caller is per-event organizer (via `isEventOrganizer(tx, roundId, session.userId, TENANT_ID)`) OR scorer of the foursome containing `:playerId`. 403 `not_authorized_for_correction` on mismatch.

  **No-existence-leak invariant:** If `:roundId` (or `:playerId` foursome lookup) returns 0 rows, the auth predicate evaluates to FALSE for ALL non-omniscient callers, and the response is **403** (not 404 or 422). Auth runs BEFORE any state read OR row existence check. This means a non-authorized caller posting against a non-existent roundId/playerId/holeNumber gets the same 403 as if those records existed but they were not authorized — preserving information-disclosure resistance.

  (ii) State gate via `getRoundState(tx, roundId, TENANT_ID)`. 422 `round_state_missing` if null. 422 `round_state_forbids_correction` if state is `not_started` or `cancelled`. Allowed states: `in_progress`, `complete_editable`, `finalized`.

**AC-3 — Existence check + correction transaction.**
**Given** auth + state gate passed
**When** the handler proceeds
**Then**:
  (a) SELECT current `hole_scores` row for `(round_id = :roundId, player_id = :playerId, hole_number = :holeNumber, tenant_id = :tenant)`. If 0 rows: 404 `{ error: 'not_found', code: 'cannot_correct_unscored_hole', requestId }` — corrections require an existing cell to amend.
  (b) Capture `priorValue = { grossStrokes: existing, putts: existing }` for the audit trail.
  (b') **Compute `newPutts`** — distinguish three cases (added during impl-codex iteration to prevent data loss):
    - `body.putts === undefined` (omitted from request) → `newPutts = cell.putts` (PRESERVE existing).
    - `body.putts === null` → `newPutts = null` (explicitly clear).
    - `body.putts` is a number → `newPutts = body.putts` (set).
    Rationale: the dominant case is fixing a typo on `grossStrokes` only; silently zeroing out `putts` when omitted would be a data-loss surprise.
  (c) INSERT a `score_corrections` row with `id = randomUUID()`, `roundId`, `playerId`, `holeNumber`, `actorPlayerId = session.userId`, `priorValueJson = JSON.stringify(priorValue)`, `newValueJson = JSON.stringify({ grossStrokes: body.grossStrokes, putts: newPutts })`, `requestId` from middleware, `reason: body.reason ?? null`, `createdAt = now`, tenant + context. Append-only.
  (d) UPDATE `hole_scores` SET `grossStrokes = body.grossStrokes`, `putts = newPutts`, `updatedAt = now` WHERE `(round_id, player_id, hole_number, tenant_id)`.
  (e) `writeAudit(tx, { eventType: AUDIT_EVENT_TYPES.SCORE_CORRECTED, entityType: AUDIT_ENTITY_TYPES.HOLE_SCORE, entityId: <hole_scores.id>, actorPlayerId: session.userId, payload: { roundId, playerId, holeNumber, prior: priorValue, new: { grossStrokes, putts }, reason } })`.
  (f) `emitActivity(tx, { type: 'score.corrected', actorPlayerId: session.userId, scope: { roundId }, payload: { playerId, holeNumber, prior: priorValue, new: { grossStrokes, putts } } })`.

**AC-4 — T6 recompute hook (v1 stub; POST-COMMIT log only).**
**Given** the correction commits successfully on a round in state `finalized`
**When** v1 ships
**Then** the handler logs an info-level breadcrumb (`event: 'correction_post_finalize_pending_t6'`, includes roundId + correctionId) **AFTER the `db.transaction` callback resolves successfully** — i.e., the breadcrumb is emitted in the route handler's outer scope, after `await db.transaction(...)` returns and BEFORE `c.json(...)` responds. Logging INSIDE the transaction risks emitting a misleading "pending T6" log line for a correction that never persisted (audit insert fails / constraint violation rolls back the tx). **NO money/leaderboard recompute call is made in v1** — T6 services don't exist yet. Followup T5-9a tracks appending the dispatcher invocation when T6-9 (or whichever T6 story owns recompute) ships, replacing the breadcrumb with a real call. This mirrors T5-8's /finalize stub pattern.

**AC-5 — Response shape.**
**Given** the correction transaction commits
**When** the response renders
**Then** 200 `{ ok: true, correctionId, prior: { grossStrokes, putts }, new: { grossStrokes, putts }, requestId }`. Returns 200 (not 201) per T5-7/T5-8 pattern; `correctionId` is the new score_corrections row's id.

**AC-6 — GET /api/rounds/:roundId/score-corrections (no existence leak).**
**Given** `GET /api/rounds/:roundId/score-corrections`
**When** invoked by either the per-event organizer OR a scorer of any foursome of this round (same auth as POST except scorer-of-ANY-foursome rather than scorer-of-target-foursome)
**Then** returns 200 `{ items: ScoreCorrection[], requestId }` ordered by `createdAt DESC`. Each item is the raw row (no enrichment in v1). `requestId` is included for trace correlation with the request-id middleware (consistent with other tournament endpoints' success-response shape).

**No-existence-leak invariant for GET:** Auth check runs INSIDE `db.transaction` BEFORE any SELECT against `score_corrections`. The auth predicate (`isEventOrganizer(tx, roundId, session.userId, TENANT_ID) || isAnyRoundScorer(tx, roundId, session.userId, TENANT_ID)`) evaluates against the rounds + events + scorer_assignments tables; if `roundId` doesn't exist, the predicate returns FALSE and the handler returns 403 `not_authorized_for_correction_history`. **The handler MUST NOT short-circuit on "no corrections found" → 200 empty list before auth runs** — that pattern leaks round existence to unauthorized callers (empty list 200 vs 403 distinguishes "round exists but no corrections" from "round doesn't exist at all"). 403 wins for both unauthorized + nonexistent-round cases.

**v1 deviation from epic AC**: epic referred to "FR-D9 money-visibility posture" filtering — v1 has no money posture (T6 hasn't shipped); the response is unfiltered for organizers and scorers. v1.5 followup T5-9b adds FR-D9 filtering when money lands.

**AC-7 — Audit + activity contract.**
**Given** any successful correction
**When** committed
**Then** exactly one new `audit_log` row with `eventType = 'score.corrected'` AND exactly one new `score_corrections` row. `score_corrections` is the queryable history table; `audit_log` is the cross-domain trail.

**AC-8 — Test coverage.**
**Given** `apps/tournament-api/src/routes/score-corrections.integration.test.ts`
**When** run
**Then** at minimum these tests pass:
  (a) 200 happy path — scorer of target foursome corrects a gross 4 → 5 on a complete_editable round; score_corrections + audit_log + hole_scores all reflect.
  (b) 200 organizer-recovery path — per-event organizer corrects a player not in their own foursome.
  (c) 200 finalized round — correction allowed; transaction commits; breadcrumb log emitted (no T6 recompute v1).
  (d) 403 non-authorized — caller is neither organizer nor scorer of player's foursome.
  (e) 403 wrong-foursome scorer — caller is the scorer of foursome B, attempts to correct a score for player in foursome A.
  (f) 404 unscored cell — `cannot_correct_unscored_hole` when no hole_scores row exists for `(roundId, playerId, holeNumber)`.
  (g) 422 not_started state — `round_state_forbids_correction`.
  (h) 422 cancelled state — `round_state_forbids_correction`.
  (i) 200 in_progress state — correction allowed (epic AC explicitly allows).
  (j) 400 invalid_round_id (malformed UUID).
  (k) 400 invalid_player_id (malformed UUID).
  (l) 400 invalid_hole_number (path param out of 1-18).
  (m) 400 invalid_body (Zod validation failure on grossStrokes range / shape).
  (n) GET /score-corrections happy path — returns the correction list ordered desc.
  (o) GET /score-corrections 403 for non-authorized caller.
  (p) POST auth-leak regression — non-authorized caller on a NON-EXISTENT roundId/playerId/holeNumber gets 403 `not_authorized_for_correction`, NOT 404 (auth runs before existence check).
  (q) GET auth-leak regression — non-authorized caller on a NON-EXISTENT roundId gets 403 `not_authorized_for_correction_history`, NOT 200 empty list and NOT 404.

### Error response contract

ALL non-200 responses share the canonical shape `{ error: string, code: string, requestId: string }` with optional additional fields (`issues` for Zod validation errors; `currentState` for state-gate rejections; `prior` / `new` for correction success). Mapping:

| Status | error | code | Trigger |
|---|---|---|---|
| 400 | bad_request | invalid_round_id | Path roundId not UUID-shaped |
| 400 | bad_request | invalid_player_id | Path playerId not UUID-shaped |
| 400 | bad_request | invalid_hole_number | Path holeNumber outside 1-18 |
| 400 | bad_request | invalid_body / malformed_json | Body parse failure |
| 400 | validation_error | invalid_body | Zod schema rejection (with `issues`) |
| 403 | forbidden | not_authorized_for_correction | POST: caller not organizer + not target-foursome scorer (incl. nonexistent round) |
| 403 | forbidden | not_authorized_for_correction_history | GET: caller not organizer + not any-round-scorer |
| 404 | not_found | cannot_correct_unscored_hole | hole_scores row absent for `(roundId, playerId, holeNumber)` |
| 422 | unprocessable | round_state_missing | round_states row absent (defensive) |
| 422 | unprocessable | round_state_forbids_correction | state is not_started or cancelled |
| 500 | internal | correction_failed | Transaction threw unexpectedly |

## Tasks / Subtasks

- [ ] **Task 1: Create `routes/score-corrections.ts`.**
  - File: `apps/tournament-api/src/routes/score-corrections.ts`.
  - Provenance header: cite Wolf Cup's `apps/api/src/routes/admin/score-corrections.ts` @ commit `279a3538` with deltas: "tournament v1 narrows to gross + putts only (no wolf decisions, no greenies/polies/sandies, no handicapIndex correction); auth model is per-event organizer OR scorer-of-target-foursome (NOT global admin); state-machine integration via T5-8 getRoundState (allowed in in_progress, complete_editable, finalized; rejected in not_started, cancelled); T6 recompute deferred to followup T5-9a."
  - Export `scoreCorrectionsRouter = new Hono()`.
  - Define `scoreCorrectionBodySchema = z.object({ grossStrokes: z.number().int().min(1).max(20), putts: z.number().int().min(0).max(15).nullable().optional(), reason: z.string().max(500).optional() })`.
  - Implement helper `isOrganizerOrScorerOfPlayersFoursome(tx, roundId, playerId, callerId, tenantId)`: returns true if caller is the per-event organizer OR the scorer of the foursome containing `playerId`. Two queries; tenant-scoped on all joins.
  - Implement helper `isOrganizerOrAnyRoundScorer(tx, roundId, callerId, tenantId)` for the GET endpoint.
  - Implement POST `/:roundId/scores/:playerId/:holeNumber/correct`:
    1. Path validation: `:roundId` UUID (400 invalid_round_id); `:playerId` UUID (400 invalid_player_id); `:holeNumber` integer 1-18 (400 invalid_hole_number).
    2. Body parse + Zod (400 invalid_body).
    3. `db.transaction`: auth-first (403 not_authorized_for_correction) → state gate (422 round_state_missing / round_state_forbids_correction) → existence check (404 cannot_correct_unscored_hole) → INSERT score_corrections + UPDATE hole_scores → writeAudit + emitActivity.
    4. If state was `finalized`, log breadcrumb `correction_post_finalize_pending_t6` (no recompute call).
    5. Return 200 `{ ok, correctionId, prior, new, requestId }`.
  - Implement GET `/:roundId/score-corrections`:
    1. Path UUID validation.
    2. `db.transaction`: auth check (403 not_authorized_for_correction_history) → SELECT score_corrections WHERE round_id ORDER BY created_at DESC.
    3. Return 200 `{ items }`.
  - Inline `const TENANT_ID = 'guyan'`. Use existing `AUDIT_EVENT_TYPES.SCORE_CORRECTED` constant.

- [ ] **Task 2: Wire router into `app.ts`.**
  - Modify `apps/tournament-api/src/app.ts` — import + mount `scoreCorrectionsRouter` on `/api/rounds`.
  - Add block-comment documenting effective URLs.

- [ ] **Task 3: Write `routes/score-corrections.integration.test.ts`.**
  - File: `apps/tournament-api/src/routes/score-corrections.integration.test.ts`.
  - Pattern after T5-7 + T5-8 integration tests (in-memory libsql + migrate; require-session mock; seed helper with state injection).
  - Implement all 17 AC-8 test cases (a)–(q), including the GET auth-leak regression case (q).
  - Reuse the `seed` helper pattern with options for `state`, `withScore`, `twoFoursomes`.

- [ ] **Task 4: Regression test pass.** All existing tournament-api + tournament-web suites must remain green; engine + Wolf Cup api unaffected. Typecheck + lint clean.

## Dev Notes

### Project Structure Notes

- **Router file naming.** `score-corrections.ts` mounts on `/api/rounds`; effective URLs are `POST /api/rounds/:roundId/scores/:playerId/:holeNumber/correct` and `GET /api/rounds/:roundId/score-corrections`. The two URLs share a prefix but the resources are distinct (one cell vs the round's full history).
- **Inline `TENANT_ID`** per established pattern.
- **Auth is INLINE, not middleware.** Same reasoning as T5-7 + T5-8: the per-event-organizer-OR-foursome-scorer rule doesn't fit any existing middleware (`requireOrganizer` is global, `requireScorerForRound` is single-foursome with body-shape coupling).
- **State gate FIRST after auth, EXISTENCE LAST.** Auth-before-state, state-before-existence-check ordering matches T5-8's party-codex correction (don't leak round/player existence to unauthorized callers).
- **No state-gating EXISTS predicate on UPDATE.** Unlike T5-7/T5-8 where the EXISTS predicate blocks finalized rounds, T5-9 EXPLICITLY ALLOWS finalized — the EXISTS pattern would defeat the feature. Race residual is the same v1 acceptance as T5-7/T5-8.

### References

- Epic spec: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` lines 1552-1588 (T5.9)
- Wolf Cup precedent (READ-only, FORBIDDEN to write): `apps/api/src/routes/admin/score-corrections.ts` @ commit `279a3538`
- T5-1 `score_corrections` schema: `apps/tournament-api/src/db/schema/scoring.ts:155-187`
- T5-1 `audit_log.AUDIT_EVENT_TYPES.SCORE_CORRECTED`: `apps/tournament-api/src/lib/audit-log.ts:25`
- T5-8 service: `apps/tournament-api/src/services/round-state.ts` (`getRoundState`, `isEventOrganizer`, `BusinessRuleError`)
- T5-7 + T5-8 integration test seed pattern: `apps/tournament-api/src/routes/scorer-assignments.integration.test.ts` + `apps/tournament-api/src/routes/round-lifecycle.integration.test.ts`

### Risks / Followups

- **Risk: race window between state read and UPDATE/INSERT.** Same SQLite snapshot residual as T5-7/T5-8. Acceptable v1 (deliberate human action; sub-millisecond race window). Tracked under T5-8b's BEGIN IMMEDIATE umbrella.
- **Followup T5-9a: T6 money/side-game recompute on correction.** When T6's recompute dispatcher ships (likely T6-9 hand-calc-money-fixture or T6-13 sub-game-framework-dispatcher), append the dispatcher invocation inside the correction transaction after the audit row. The breadcrumb log emitted by AC-4's stub provides the v1 audit trail until then.
- **Followup T5-9b: FR-D9 visibility filtering on GET /score-corrections.** Epic AC mentions money-visibility-posture filtering. T6 ships money; v1 has no money posture to filter on. v1.5 enhancement.
- **Followup T5-9c: Score-correction UI.** No UI affordance in v1 — corrections are API-only. v1.5 admin page surfaces the GET history + a per-cell "amend" button.
- **Followup T5-9d: Bulk correction.** Organizer wants to fix 3 cells from the same scorer typo run. v1 requires N separate POSTs. v1.5 could add `/scores/bulk-correct` taking an array.

## Files this story will edit

- apps/tournament-api/src/routes/score-corrections.ts
- apps/tournament-api/src/routes/score-corrections.integration.test.ts
- apps/tournament-api/src/app.ts

Additional files MAY be added during implementation only under `apps/tournament-*/**` and MUST be appended to this list before commit. Any path outside this set or outside `apps/tournament-*/**` requires re-running the spec gate.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (acting as tournament-director driving dev-story per workflow-tournament.yaml).

### Debug Log References

(to be populated during implementation)

### Completion Notes List

(to be populated during implementation)

### File List

(to be populated during implementation)
