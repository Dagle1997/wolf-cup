# T5-7: Scorer Handoff Endpoint [new]

## Status

Ready for Dev

## Story

As an organizer or the current scorer of a foursome,
I want `POST /api/rounds/:roundId/scorer-assignments/transfer` that atomically reassigns a foursome's scorer from one player to another (FR-B7, FR-H2),
So that Jeff can hand off to Ben at the turn without dropping the queue or leaving both devices uncertain who's the scorer.

T5-7 closes the dead-phone-recovery + at-the-turn-handoff gap surfaced in the codex review of the original epic. It builds directly on T5-6's `require-scorer-for-round` middleware (which gives stale-queue 403s the metadata they need) and T5-3's offline queue (which already accepts `'scorer_handoff'` as a v1 mutation kind, see `apps/tournament-web/src/lib/offline-queue.ts:23–40`).

T5-7 is the next story in the T5 backlog after T5-5 ✓: T5-7 → T5-8 → T5-9 → T5-10 → T5-11.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. Path footprint — ALLOWED only, ZERO SHARED, ZERO FORBIDDEN expected

```
apps/tournament-api/src/routes/scorer-assignments.ts                          [NEW]
apps/tournament-api/src/routes/scorer-assignments.integration.test.ts         [NEW]
apps/tournament-api/src/app.ts                                                [MOD: mount the new router]
apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx                [MOD: render handoff UI when isScorer; show "X is now scoring" read-only state when stale 403 received]
apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx           [MOD: add tests for handoff button + stale-queue 403 banner]
apps/tournament-web/src/routeTree.gen.ts                                      [MOD: auto-regenerated only if a new route file is added — NOT expected for this story]
```

If implementation surfaces additional ALLOWED files (e.g., a small UI helper component split out for testability), they MUST be appended to "Files this story will edit" before commit. Any path outside `apps/tournament-*/**` requires re-running the spec gate.

### 2. Dependencies + forward references

- **T4-2 (`pairing_members`)** — read to verify `toPlayerId` is a member of the foursome being transferred.
- **T5-1 (`scorer_assignments`)** — write target. Composite PK `(round_id, foursome_number)`. Atomic UPDATE replaces the existing row's `scorer_player_id`, `assigned_at`, `assigned_by_player_id`.
- **T5-3 (offline queue)** — `'scorer_handoff'` is already an accepted MutationKind in `apps/tournament-web/src/lib/offline-queue.ts:23`. The web UI's handoff action enqueues a mutation via `enqueueMutation({ kind: 'scorer_handoff', ... })`; the queue's kind-agnostic drain dispatcher (line 10 of offline-queue.ts) handles the POST through `entry.url` and `entry.body`. Online: `queue.drain()` is invoked immediately after enqueue for fast-path UX. Offline: the queue retains the entry; the auto-drain on the `online` window event handles eventual sync. Terminal-error codes for the `'scorer_handoff'` kind (8 codes — see AC-8) are registered alongside `'hole_score'` so transient-vs-terminal classification is correct on the drain pass.
- **T5-6 (`require-scorer-for-round` middleware)** — already returns `currentScorerName` in the 403 payload (see `apps/tournament-api/src/middleware/require-scorer-for-round.ts:206–235`). The post-handoff stale-queue scenario reuses this exact 403 path.
- **T5-8 (round lifecycle state machine, NOT yet shipped)** — handoff is only meaningful while the round is `not_started`, `in_progress`, or `complete_editable`. Transfers on `finalized` / `cancelled` rounds are rejected (422 `round_finalized` / `round_cancelled`). T5.8's state-machine SERVICE (`services/round-state.ts`) does not yet exist; this story uses **direct read of `round_states.state`** with the same strings T5-8 will eventually use, mirroring T5-6's approach. T5-8 will replace the inline state read with a service call when it lands.
- **T8 (activity spine)** — `emitActivity({ type: 'scorer.transferred' })` is a NO-OP in v1 per `apps/tournament-api/src/lib/activity.ts:26–31`. T8 will replace the body; this story's call signature is forward-compatible.

### 3. Auth model (THE central design choice)

The handler MUST allow either:
- **The current scorer of `(roundId, foursomeNumber)`** — `scorer_assignments.scorer_player_id == session.userId`. (Common path: scorer at the turn handing off voluntarily.)
- **The Event's organizer** — `events.organizer_player_id == session.userId`, where the event id is resolved from `rounds.event_id`. (Recovery path: scorer's phone is dead and Jeff steps in to reassign.)

**Three observations that drove the implementation:**

(a) The **per-event** organizer check (`events.organizer_player_id`) is NOT the same as `players.is_organizer`. The latter is a global flag from T1-6a; the former is the event-creator binding. T5.7 wants the per-event check — Jeff is the organizer of THIS event, not a global admin. `requireOrganizer` middleware at `apps/tournament-api/src/middleware/require-organizer.ts:28` is therefore NOT reusable; the handler does an inline event-organizer check.

(b) Since either of two distinct identities authorize the same endpoint, this is a **handler-internal authorization** (not a middleware). Mounting `requireScorerForRound` would 403 the organizer-recovery path; chaining `requireOrganizer` (global) would 403 the scorer-handoff path. The handler does the authoritative lookups inside the transaction and 403s only when neither matches.

(c) **Atomicity discipline (TOCTOU-safe).** The auth-check queries (current scorer + event organizer) are read-only and small. To avoid a TOCTOU race where scorer A is authorized by a pre-read but loses the role to B before A's UPDATE lands, the **authoritative scorer-row SELECT runs INSIDE the transaction**, immediately before the UPDATE, and the same SELECT both captures `fromPlayerId` for audit/response AND drives the auth re-check. A cheap pre-transaction "fast 403" is permitted as an optimization for the obvious-denial case, but it is NOT load-bearing — the in-transaction re-check is what gates the write. See AC-3 + AC-5 for the exact sequence.

### 4. State-machine integration (forward-compat with T5-8)

Allowed source states for handoff:
- `not_started` — handoff valid (rare but possible: organizer pre-assigns then swaps before tee-off).
- `in_progress` — handoff valid (the dominant case).
- `complete_editable` — handoff valid (editing scores during the post-round window).

Rejected source states:
- `finalized` — 422 `{ code: 'round_finalized' }`. Score corrections post-finalize go through T5-9, not handoff.
- `cancelled` — 422 `{ code: 'round_cancelled' }`. Cancelled rounds don't have an active scorer.
- `round_states` row absent — 422 `{ code: 'round_state_missing' }`. Mirror T5-6's posture (`apps/tournament-api/src/routes/scores.ts:120–125`).

State is read directly from `round_states.state` (PK on `round_id`, single-row-per-round invariant — same as T5-5's leaderboard relies on, see `apps/tournament-api/src/db/schema/scoring.ts:198`). When T5-8 ships, the inline read is replaced with a `transitionState(tx, ...)` call; the gate values are identical so v1 → T5-8 is a refactor not a behavior change.

### 5. Stale-queue scenario (load-bearing AC)

When the prior scorer's device has queued offline mutations BEFORE the handoff committed, those mutations drain after re-connection. Each one hits `require-scorer-for-round`. Because the scorer changed server-side, the middleware returns 403 with `currentScorerName` populated (T5-6 §6 of the middleware). The web client's `useOfflineQueue` hook moves the entry to the `errored` quarantine bucket per `apps/tournament-web/src/lib/offline-queue.ts:13` (see `mutation-queue-errored` store). The UI displays:

> "Ben is now scoring for foursome 1 — these queued scores were held; ask Ben to re-enter or request an admin correction (T5.9)."

The 403-error-handling path lives entirely in the web client; the API contribution from this story is just the existing 403 payload shape (no new fields). T5-9 (score correction) is the recovery surface for actually persisting the held scores; this story writes the documented "ask the scorer to re-enter" path into the UI copy.

### 6. Tenant + context_id discipline

- All queries include `tenant_id = TENANT_ID` on every joined table (architecture D1-3 + T5-5 precedent).
- `audit_log` rows write `context_id = 'audit:round'` per `apps/tournament-api/src/lib/audit-log.ts:64`.
- `events.organizer_player_id` is read via the rounds → events FK chain; tenant filter on both tables.

### 7. URL shape (per architecture §"Action routes")

Per `_bmad-output/planning-artifacts/tournament/architecture.md:505`: action routes are `POST` with verb in path. The endpoint is mounted at `/api/rounds/:roundId/scorer-assignments/transfer`. We create a new dedicated router file (`scorer-assignments.ts`) rather than co-locating in `scores.ts` because:
- `scores.ts` is the score-cell-mutation router (POST holes + GET round-detail).
- Scorer assignments are a separate resource; mounting them in their own file keeps `scores.ts` focused and matches the file-per-resource convention (`courses.ts`, `events-leaderboard.ts`, etc.).

The router mounts at `/api/rounds` so the full path is `/api/rounds/:roundId/scorer-assignments/transfer` — consistent with the existing `/api/rounds/:roundId/...` namespace.

## Acceptance Criteria

(Derived from epics-phase1.md T5.7 lines 1467–1502. Notable v1 deviations from the epic AC are flagged inline.)

**AC-1 — Endpoint shape + body validation.**
**Given** `POST /api/rounds/:roundId/scorer-assignments/transfer` with body `{ foursomeNumber: integer >= 1, toPlayerId: UUID }`
**When** invoked
**Then** the body is parsed via Zod (`scorerTransferBodySchema`); `:roundId` is validated as a UUID; on shape failure return 400 `{ error: 'bad_request' | 'validation_error', code: 'invalid_round_id' | 'invalid_body', issues?: ZodIssue[], requestId }`. Mounted on `/api/rounds` via a new router `scorerAssignmentsRouter` exported from `apps/tournament-api/src/routes/scorer-assignments.ts`.

**AC-2 — Round existence + state gate.**
**Given** a request with valid body shape
**When** the handler runs
**Then** the rounds row is fetched (tenant-scoped); 404 `{ code: 'round_not_found' }` if absent. Then `round_states.state` is fetched (tenant-scoped); 422 `{ code: 'round_state_missing' }` if absent (defense; round_states should always exist post-T5-1). If state is `finalized` → 422 `{ code: 'round_finalized' }`; if `cancelled` → 422 `{ code: 'round_cancelled' }`. States `not_started`, `in_progress`, `complete_editable` proceed.

**AC-3 — Authorization (per-event organizer OR current scorer; TOCTOU-safe).**
**Given** the round + state checks have passed
**When** the handler determines authorization
**Then** the handler enters `db.transaction(async (tx) => { ... })` and performs the authoritative auth check INSIDE the transaction:
  (i) SELECT the current scorer row: `SELECT scorer_player_id FROM scorer_assignments WHERE round_id = :roundId AND foursome_number = body.foursomeNumber AND tenant_id = :tenant LIMIT 1`. If 0 rows → 422 `{ code: 'foursome_has_no_scorer' }` (rolling back the empty transaction). The returned `scorer_player_id` is captured as `fromPlayerId` for the audit + response payload.
  (ii) SELECT the event organizer: `SELECT organizer_player_id FROM events INNER JOIN rounds ON rounds.event_id = events.id WHERE rounds.id = :roundId AND rounds.tenant_id = :tenant AND events.tenant_id = :tenant LIMIT 1`. (The rounds row was already fetched in AC-2 for the state check; the organizer lookup is the only new query.)
  (iii) Authorization succeeds if `session.userId === fromPlayerId` (the CURRENT scorer at this instant) OR `session.userId === events.organizer_player_id`. On mismatch: roll back with 403 `{ error: 'forbidden', code: 'not_authorized_for_handoff', requestId }`.

**Why the in-transaction re-check matters.** A pre-transaction read could authorize player A as scorer, but if player B handed off scorer-role to themselves between the pre-read and A's UPDATE, A would still be able to write — undermining the very correctness this endpoint is supposed to provide. The in-tx SELECT-then-UPDATE sequence prevents this: even with concurrent transactions, the SELECT inside our transaction observes a consistent snapshot of `scorer_assignments`, and the UPDATE in AC-5 narrows the WHERE clause for the scorer-path so a stale scorer's UPDATE affects 0 rows.

A pre-transaction "fast 403" lookup may be added as a perf optimization for the obvious-deny case (caller is neither scorer-of-anything nor event-organizer), but it is NOT load-bearing — the in-tx re-check is the security gate.

**AC-4 — Foursome-membership validation.**
**Given** authorization succeeded
**When** the handler validates `body.toPlayerId`
**Then** within the same transaction it confirms `body.toPlayerId` is a member of the target foursome by joining `pairing_members → pairings` keyed on the round's `event_round_id`:

```
SELECT 1
FROM pairing_members
INNER JOIN pairings ON pairing_members.pairing_id = pairings.id
WHERE pairings.event_round_id = :roundEventRoundId
  AND pairings.foursome_number = :bodyFoursomeNumber
  AND pairing_members.player_id = :bodyToPlayerId
  AND pairings.tenant_id = :tenant
  AND pairing_members.tenant_id = :tenant
LIMIT 1
```

`:roundEventRoundId` is `rounds.event_round_id` from the round row already fetched in AC-2 (rounds → event_rounds → pairings is the canonical foursome chain per `apps/tournament-api/src/db/schema/pairings.ts:47`). If 0 rows: 422 `{ error: 'invalid_assignee', code: 'assignee_not_in_foursome', requestId }` (rolling back).

**AC-5 — Atomic transfer + audit + activity.**
**Given** AC-3 and AC-4 succeeded inside the transaction
**When** the handler proceeds to the write step (still inside the same `db.transaction`)
**Then**:
  (a) **Scorer-path update (TOCTOU-narrowed):** if authorization was via scorer-match (`session.userId === fromPlayerId`), the UPDATE narrows on the prior scorer to ensure no concurrent transfer raced ahead of us:
  ```
  UPDATE scorer_assignments
     SET scorer_player_id = :toPlayerId,
         assigned_at = now(),
         assigned_by_player_id = session.userId
   WHERE round_id = :roundId
     AND foursome_number = body.foursomeNumber
     AND scorer_player_id = :fromPlayerId      -- TOCTOU guard
     AND tenant_id = :tenant
  ```
  If 0 rows updated: roll back with 403 `{ code: 'not_authorized_for_handoff' }` — the prior scorer changed under us between the SELECT and UPDATE; the caller is no longer authorized at write-time.
  (b) **Organizer-path update:** if authorization was via organizer-match, the UPDATE drops the `scorer_player_id` predicate (organizer can override regardless of who the current scorer is):
  ```
  UPDATE scorer_assignments
     SET scorer_player_id = :toPlayerId,
         assigned_at = now(),
         assigned_by_player_id = session.userId
   WHERE round_id = :roundId
     AND foursome_number = body.foursomeNumber
     AND tenant_id = :tenant
  ```
  If 0 rows updated: roll back with 422 `{ code: 'foursome_has_no_scorer' }` (defense; AC-3 already returned 422 for the missing-row case, so this is unreachable in practice but kept for defense-in-depth).
  (c) `writeAudit(tx, { eventType: AUDIT_EVENT_TYPES.SCORER_TRANSFERRED, entityType: AUDIT_ENTITY_TYPES.ROUND, entityId: roundId, actorPlayerId: session.userId, payload: { foursomeNumber, fromPlayerId, toPlayerId, assignedAt: now } })`. The constant `AUDIT_EVENT_TYPES.SCORER_TRANSFERRED = 'scorer.transferred'` already exists at `apps/tournament-api/src/lib/audit-log.ts:27` (added in T5-1's audit log infrastructure) — no new constants need to be defined.
  (d) `emitActivity(tx, { type: 'scorer.transferred', actorPlayerId: session.userId, scope: { roundId }, payload: { foursomeNumber, fromPlayerId, toPlayerId } })`. Activity is a v1 NO-OP (`apps/tournament-api/src/lib/activity.ts:26–31`); the call signature is forward-compatible with T8.
On commit: 200 `{ ok: true, foursomeNumber, fromPlayerId, toPlayerId, assignedAt: now, requestId }`.

**AC-6 — Cross-device propagation (≤15s).**
**Given** two devices polling `GET /api/rounds/:roundId` (T5-2 score-entry-context endpoint)
**When** the transfer commits
**Then** within one poll cycle (≤15s — score-entry-context staleTime + the in-flight refresh) the prior scorer's `myFoursome.scorerPlayerId` flips to the new player and `isScorer` flips to `false`; the new scorer sees `isScorer: true`. **The propagation guarantee is purely poll-based** — no SSE, no sockets, no WebSocket in v1. The cross-device behavior is verified at the API level (the `GET /api/rounds/:roundId` endpoint reflects the new scorer immediately post-transfer); the web-client UI reactivity to the changed payload is exercised in the score-entry test file modifications.

**AC-7 — Stale-queue 403 metadata (no new contract).**
**Given** the prior scorer queued offline `'hole_score'` mutations before the handoff
**When** those drain after the handoff
**Then** `require-scorer-for-round` (T5-6) returns 403 with `currentScorerName` populated for the new scorer (existing behavior, not a new field). No API change in this story; the test asserts the existing field is correctly populated post-handoff.

**AC-8 — Web UI: scorer can initiate handoff (offline-queue path).**
**Given** the score-entry page at `/rounds/:roundId/score-entry`
**When** the user is the current scorer for their foursome (`isScorer: true` from T5-2 endpoint)
**Then** a "Hand off scorer" affordance is visible; tapping it opens a foursome-member picker (the other 3 members of the foursome, by name); selecting a member calls `enqueueMutation({ kind: 'scorer_handoff', url: '/api/rounds/:roundId/scorer-assignments/transfer', body: { foursomeNumber, toPlayerId }, clientEventId, roundId })`. The mutation flows through the existing T5-3 offline queue (kind-agnostic dispatcher). The component then triggers `queue.drain()` for an immediate flush.

**Online behavior:** drain succeeds → handler invalidates `['round-detail', roundId]` → next refetch (within 15s poll, often immediately) shows the user as no-longer-scorer → page transitions to the read-only state ("X is now scoring"). On 4xx (terminal codes registered for the `scorer_handoff` kind: `invalid_round_id`, `invalid_body`, `not_authorized_for_handoff`, `assignee_not_in_foursome`, `foursome_has_no_scorer`, `round_state_missing`, `round_finalized`, `round_cancelled`), the queue's drain logic removes the entry without retry; the inline error renders.

**Offline behavior:** when `navigator.onLine === false`, the picker shows a "Queued — will sync when you're back online" indicator and skips the immediate `queue.drain()` call. The queue's auto-drain on the `online` window event handles the eventual POST when connectivity returns. The picker stays open with the offline indicator; the user can tap Cancel to dismiss.

**Terminal-error codes for `'scorer_handoff'` kind** are registered at parent component mount (alongside the `'hole_score'` registration) so the queue's drain classifier treats them as non-retriable.

**AC-9 — Web UI: stale-queue banner.**
**Given** the offline queue contains an `errored` entry whose `lastError.body.code` is `'player_not_in_your_foursome'` or `'not_scorer_for_this_foursome'` AND `lastError.body.currentScorerName` is non-null
**When** the score-entry page renders **in the read-only branch** (`myFoursome.isScorer === false`)
**Then** a banner appears: *"{currentScorerName} is now scoring — N queued scores were held; ask {currentScorerName} to re-enter or request an admin correction (T5.9)."* (`N` = count of matching errored entries; copy uses singular/plural appropriately.)

**Banner-only-in-read-only-branch constraint.** The banner is NOT rendered when the caller IS the active scorer for the foursome — errored entries scoped to this round in that case are necessarily historical (e.g., user was demoted then re-promoted), so the framing would be misleading. This narrows the false-positive surface.

**Banner affordances:**
- **Dismiss button** — sessionStorage-keyed by `roundId` (`tournament:stale-queue-banner-dismissed:{roundId}`). Once dismissed, banner stays hidden for the session; reappears on a fresh page load until the matching errored entries are cleared (cleared = either re-entered through normal scoring by the new scorer, or admin-corrected via T5-9).
- **"View errored entries" toggle** — expandable list surfacing the held mutation bodies (URL + JSON-stringified body) so the new scorer or the organizer can see exactly which scores need re-entry. Errored entries are NOT auto-replayed; T5-9 is the formal recovery surface.

**AC-10 — Integration test coverage.**
**Given** `apps/tournament-api/src/routes/scorer-assignments.integration.test.ts`
**When** run
**Then** at minimum these tests pass:
  (a) 200 happy path — scorer transfers to a foursome member; audit row + scorer_assignments row both reflect the new scorer.
  (b) 200 organizer-recovery path — event organizer (different player from the prior scorer) transfers; same outcome.
  (c) 403 not_authorized_for_handoff — non-scorer non-organizer player attempts transfer.
  (d) 422 assignee_not_in_foursome — `toPlayerId` is not a `pairing_members` row of `(rounds.event_round_id, body.foursomeNumber)`.
  (e) 422 round_finalized — round is finalized.
  (f) 422 round_cancelled — round is cancelled.
  (g) 400 invalid_round_id — malformed UUID in path.
  (h) 400 invalid_body — body missing `foursomeNumber` or `toPlayerId`.
  (i) Post-handoff stale-queue scenario — POST a score via T5-6's endpoint AS the prior scorer after the handoff; assert 403 `currentScorerName` payload reflects the new scorer's name.
  (j) Audit-row assertion — after happy path, exactly one new `audit_log` row with `eventType='scorer.transferred'` and the expected payload JSON.
  (k) 422 round_state_missing — the rounds row exists but `round_states` has no row for it (defense path; T5-1 invariant should make this unreachable in production but the test guards against silent regression).
  (l) 422 foursome_has_no_scorer — pre-existing `scorer_assignments` row absent for `(roundId, foursomeNumber)`. Verifies the in-transaction SELECT (AC-3 step (i)) returns 0 rows and the handler rolls back with the documented code (NOT a 200 + new-row INSERT).
  (m) 403 global-organizer-but-not-event-organizer — a player with `players.is_organizer = true` but who is NOT `events.organizer_player_id` for THIS event AND is NOT the current scorer attempts transfer; must receive 403 `not_authorized_for_handoff`. This locks in the per-event-organizer rule and prevents accidental regression to a global-isOrganizer check.
  (n) 403 scorer-of-different-foursome — caller is the scorer of foursome 2 of the same round; attempts transfer of foursome 1; must receive 403 `not_authorized_for_handoff`. Confirms scorer authorization is scoped to the SPECIFIC `(roundId, foursomeNumber)` and not to "any foursome of this round".

## Tasks / Subtasks

- [ ] **Task 1: Create `scorer-assignments.ts` router with the handler.**
  - File: `apps/tournament-api/src/routes/scorer-assignments.ts`.
  - Export `scorerAssignmentsRouter = new Hono()`.
  - Route: `scorerAssignmentsRouter.post('/:roundId/scorer-assignments/transfer', requireSession, handler)`.
  - Define `scorerTransferBodySchema = z.object({ foursomeNumber: z.number().int().positive(), toPlayerId: z.string().uuid() })`.
  - Implementation sequence (per AC-1 through AC-5):
    1. Path/body validation (400 on shape failure).
    2. Round existence + tenant scope (404).
    3. `round_states.state` read; reject `finalized`/`cancelled`/`missing` per AC-2 (422).
    4. Open `db.transaction(async (tx) => { ... })`.
    5. **In-tx**: SELECT current scorer for `(roundId, foursomeNumber)` → captures `fromPlayerId`; 422 `foursome_has_no_scorer` if 0 rows.
    6. **In-tx**: SELECT `events.organizer_player_id` via the rounds → events join.
    7. **In-tx**: re-check authorization (`session.userId === fromPlayerId` OR `session.userId === events.organizer_player_id`); 403 if neither.
    8. **In-tx**: Foursome-membership SELECT for `body.toPlayerId` on `pairings.event_round_id = rounds.event_round_id`; 422 if not a member.
    9. **In-tx**: UPDATE `scorer_assignments`. **Scorer-path includes `AND scorer_player_id = :fromPlayerId` to prevent TOCTOU**; organizer-path drops that predicate. 0 rows updated on scorer-path → 403 `not_authorized_for_handoff` (rolling back).
    10. **In-tx**: `writeAudit` + `emitActivity`.
    11. Return 200 `{ ok, foursomeNumber, fromPlayerId, toPlayerId, assignedAt, requestId }`.
  - Inline `const TENANT_ID = 'guyan';` at top per the existing pattern (T5-6, T5-5 precedent).
  - Use existing `AUDIT_EVENT_TYPES.SCORER_TRANSFERRED` constant (already at `lib/audit-log.ts:27`); use `writeAudit` + `emitActivity` per their existing signatures.

- [ ] **Task 2: Wire the router into `app.ts`.**
  - Modify `apps/tournament-api/src/app.ts` to import and mount `scorerAssignmentsRouter` on `/api/rounds`.
  - Add a one-line block comment documenting the effective URL.

- [ ] **Task 3: Write `scorer-assignments.integration.test.ts`.**
  - File: `apps/tournament-api/src/routes/scorer-assignments.integration.test.ts`.
  - Pattern after `apps/tournament-api/src/routes/scores.integration.test.ts` for the in-memory libsql + migrate setup.
  - Implement all 14 test cases from AC-10 (a)–(n), including the 4 added in iteration-2 spec revision: (k) 422 round_state_missing, (l) 422 foursome_has_no_scorer, (m) 403 global-organizer-but-not-event-organizer, (n) 403 scorer-of-different-foursome.
  - Reuse the `seedRound` helper pattern; extend it to seed `scorer_assignments` for the foursome AND optionally seed multiple foursomes (needed for case (n)).
  - Optional: a TOCTOU regression test where two concurrent scorer-path UPDATEs both target the same scorer assignment — only one should succeed, the other should land on the 0-rows-updated path. Implementation can use sequential transactions to simulate the race; document as "future regression-only" if non-trivial in libsql.

- [ ] **Task 4: Update score-entry web page with handoff UI.**
  - File: `apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx`.
  - Add a "Hand off scorer" button visible only when `myFoursome.isScorer === true` AND state is `not_started` / `in_progress` / `complete_editable`.
  - Add a foursome-member picker (the other 3 members) that POSTs the transfer.
  - On 200 success, invalidate the round-detail query so the page re-reads + transitions to the read-only state.
  - On 4xx error, render inline error text with code mapping.

- [ ] **Task 5: Update score-entry web page with stale-queue banner.**
  - Same file as Task 4.
  - Read the offline queue's errored bucket (`getTerminalErrors` or equivalent existing API in `apps/tournament-web/src/lib/offline-queue.ts`).
  - When at least one errored entry has `lastError.body.code` in `['player_not_in_your_foursome', 'not_scorer_for_this_foursome']` AND `currentScorerName` is non-null, render the banner with the message in AC-9.
  - Banner is dismissible (sessionStorage) but reappears on page reload until errored entries are cleared.

- [ ] **Task 6: Add web-side tests.**
  - File: `apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx` (existing — extend, don't create new).
  - Test: handoff button visible only when isScorer.
  - Test: tapping handoff + selecting member → fetch invoked with correct body.
  - Test: 200 response → page transitions to read-only state.
  - Test: stale-queue banner renders when errored entries match the criteria.
  - Test: banner does NOT render when no errored entries exist.

- [ ] **Task 7: Run regression test pass.** All existing tournament-api + tournament-web suites must remain green; engine + Wolf Cup api unaffected. Typecheck + lint clean.

## Dev Notes

### Project Structure Notes

- **Router file naming.** New router lives at `apps/tournament-api/src/routes/scorer-assignments.ts`. Mount path = `/api/rounds`. Effective URL = `/api/rounds/:roundId/scorer-assignments/transfer`. Filename matches the resource (`scorer_assignments` table → `scorer-assignments.ts`), per the file-per-resource convention.
- **Tenant scoping.** Inline `const TENANT_ID = 'guyan';` at the top of the new file per the established pattern (`require-scorer-for-round.ts:32`, `events-leaderboard.ts:28`, `leaderboard.ts` historical).
- **Auth model is INLINE, not middleware.** Per Section 3 above: this endpoint accepts EITHER current scorer OR per-event organizer. Neither existing middleware (`requireScorerForRound` chains 403 the organizer; `requireOrganizer` is global) fits. Handler-internal authorization is the right call.
- **State gate is INLINE pre-T5-8.** Reads `round_states.state` directly. When T5-8 ships, the read is replaced with a `transitionState`-style service call; the comparison strings (`finalized`, `cancelled`) are stable so the swap is mechanical.
- **Web client offline queue already accepts `'scorer_handoff'`.** No queue-shape change needed in this story. The handoff POST IS subject to the offline queue's online/offline routing — if the device is offline when the user taps "Hand off", the mutation enqueues for later drain (and may 403 if someone else handed off in the interim, falling into the same errored-queue UX as scoring).

### References

- Epic spec: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` lines 1467–1502 (T5.7)
- PRD: `_bmad-output/planning-artifacts/tournament/prd.md` line 320 (FR-B7), line 330 (FR-H2), line 727 (T5.7 epic-line summary)
- Architecture: `_bmad-output/planning-artifacts/tournament/architecture.md` line 505 (action route convention), line 662 (audit log format), line 104 (audit logging discipline), line 1113 (FD-13 four guardrails)
- T5-1 schema: `apps/tournament-api/src/db/schema/scoring.ts` (`scorer_assignments` composite PK on `(round_id, foursome_number)` at lines 222–246)
- T5-1 schema: `apps/tournament-api/src/db/schema/scoring.ts:198` — `round_states.round_id` PRIMARY KEY (single-row-per-round invariant T5-7 relies on for the state read).
- T5-6 reference (most recent T5 with comparable scope + middleware patterns): `apps/tournament-api/src/middleware/require-scorer-for-round.ts:142–235` (scorer lookup + 403 payload shape that the post-handoff stale-queue scenario reuses).
- T5-3 offline-queue: `apps/tournament-web/src/lib/offline-queue.ts:23–40` — `'scorer_handoff'` is in the v1 MutationKind enum.
- Audit/activity helpers: `apps/tournament-api/src/lib/audit-log.ts` (writeAudit), `apps/tournament-api/src/lib/activity.ts` (emitActivity, T8 will replace body).
- Events schema: `apps/tournament-api/src/db/schema/events.ts:46–48` — `organizer_player_id` references `players.id` with RESTRICT.

### Risks / Followups

- **Risk: organizer-recovery path could be abused** (organizer reassigns scorer mid-hole to "fix" a score they didn't like). Mitigated by audit row (every transfer leaves an actor + prior + new trail). Acceptable for v1's small trusted league.
- **Risk: state-gate race window** (AC-2 reads `round_states.state` BEFORE the transaction; AC-5 commits inside the transaction). If the round transitions to `finalized` or `cancelled` between AC-2 and AC-5's UPDATE, the handoff still commits. v1 acceptance: the window is sub-millisecond and finalize/cancel are organizer-only actions; an organizer racing themselves is not a real scenario. **~~Followup T5-7f~~ — PARTIALLY CLOSED by T5-8 (2026-05-01).** The state read moved inside the transaction (via `getRoundState(tx, ...)`) AND a state-gating EXISTS predicate was added to the scorer_assignments UPDATE. This closes the case where /finalize commits BEFORE the handoff transaction begins. The within-snapshot residual race (where /finalize commits AFTER the handoff transaction's first read but BEFORE its UPDATE) requires `BEGIN IMMEDIATE` to fully close; drizzle-orm doesn't cleanly expose this. **Followup T5-8b** owns the full closure as a v1.5 enhancement.
- **Followup T5-7i: clientEventId fallback should be UUIDv4-shaped (post-impl-codex-rerun-2 Low).** When `crypto.randomUUID` is unavailable (very old runtimes), `HandoffControl.handleTransfer` uses `evt-${Date.now()}-${Math.random().toString(36).slice(2)}` which is unique-enough but does not match the UUID v4 format the spec calls for. In practice modern browsers all support `crypto.randomUUID` so the fallback is dead code in production; switching to a polyfilled UUIDv4 (e.g. via the `uuid` package) is a v1.5 cleanup.
- **Followup T5-7j: Surface terminal drain failures back to HandoffControl (post-impl-codex-rerun-2 Low).** When a scorer-handoff mutation drains and hits a terminal 4xx code (e.g., 422 round_finalized landed between enqueue and drain), the queue purges silently and the picker just closes without an explanatory message. v1.5 enhancement: subscribe to a queue event (e.g., extend the existing `tournament-offline-queue-failsafe-purged` CustomEvent to also fire on terminal-code purges, OR add a new `tournament-offline-queue-terminal-purged` event) and surface the error inline in the picker.
- **Note (post-impl-codex-rerun-2 Medium #3 design choice):** the StaleQueueBanner copy uses ONLY the most-recent matching errored entry's `currentScorerName` to keep the banner narrative honest ("{newest scorer} is now scoring; N held"). Older errored entries from prior handoffs (different `currentScorerName`) are EXCLUDED from the count but ARE visible via the View-errored expansion, which renders ALL matching entries regardless of name. This is a deliberate tradeoff: the banner copy stays accurate; the audit trail (held mutations) stays complete. If there is ever a case where multiple distinct currentScorerName values matter to the user simultaneously, a v1.5 enhancement could group entries by name in the View-errored panel.
- **Followup T5-7h: Organizer-recovery UI affordance (party-review surfaced).** v1 ships with API support for the organizer-recovery path (event organizer can transfer scorer for any foursome they're not in), but the score-entry web UI only shows the handoff button when `isScorer === true`. An organizer recovering a dead phone today must use a CLI / curl. v1.5 enhancement: when the score-entry page renders for a player who is the EVENT organizer AND is viewing a foursome's read-only state for a foursome they're NOT a member of, surface a "Reassign scorer (recovery)" button that POSTs the same endpoint with a member-picker for that other foursome's members. The API supports this today; only the UI affordance is missing. Acceptable v1 gap per the trip's small operator (Jeff has admin/CLI access).
- **~~Followup T5-7g~~ — CLOSED by T5-8 (2026-05-01).** The TOCTOU contention regression test was originally deferred because libsql in-memory made cross-transaction concurrency hard to simulate. T5-8 ships a "finalize-before-handoff" integration test that exercises the case where /finalize commits BEFORE the handoff transaction begins; combined with the state-gated EXISTS predicate added to the scorer_assignments UPDATE, this closes the realistic regression surface. The within-snapshot residual race (described in T5-8 Section 7) is a documented v1 limitation tracked by T5-8b.
- **Lows surfaced in spec-review-rerun (non-blocking, recorded for transparency):**
  - `assignedAt: now` in AC-5 / response payload — underspecified whether DB-time or app-time. Implementation MUST use a single source of truth: prefer `Date.now()` in app-layer + write the same value to both the UPDATE's `assigned_at` column and the response payload + audit JSON. No SQL `now()` (would diverge across DB clock skew if the host's clock drifts).
  - AC-9 UI banner filters on `'player_not_in_your_foursome'` and `'not_scorer_for_this_foursome'` 403 codes — these are the codes T5-6's middleware actually emits (verified at `apps/tournament-api/src/middleware/require-scorer-for-round.ts:222–224`). If T5-6 ever renames those codes, AC-9 must be updated in lockstep. No drift today.
- **Risk: rapid back-and-forth handoff confuses the offline queue.** Mitigated by the errored-quarantine path — entries that 403 stay in the errored bucket; user must explicitly resolve. No silent data loss.
- **Followup T5-7b: Magic-link "request handoff" flow.** v1 requires the organizer to be present at the device. Future enhancement: scorer-A taps "Request handoff" → sends a magic link to scorer-B → scorer-B accepts on their device → atomic transfer. Out of scope for v1.
- **Followup T5-7c: Auto-handoff on stale heartbeat.** If the current scorer's device hasn't pinged the round-detail endpoint in N minutes (configurable, e.g., 15 min), surface a UI prompt to other foursome members offering to take over. Requires heartbeat tracking. Out of scope for v1.
- **~~Followup T5-7d~~ — CLOSED by T5-8 (2026-05-01).** The inline `round_states.state` read at scorer-assignments.ts:137-166 was replaced with an in-tx `getRoundState(tx, roundId, TENANT_ID)` call from `services/round-state.ts`. Same gate logic; same 422 codes; existing T5-7 tests pass unchanged.
- **Followup T5-7e: Bulk reassignment.** Organizer might want to reassign multiple foursomes at once (e.g., dead carry-cart). v1 requires N separate POSTs. v1.5 could add a `/scorer-assignments/bulk-transfer` action.
- **Followup (UI polish).** Confirmation modal "Are you sure you want to hand off scoring to {name}?" before POSTing. v1 is a single tap → picker → tap. Polish in v1.5 if real users mistap.

## Files this story will edit

- apps/tournament-api/src/routes/scorer-assignments.ts
- apps/tournament-api/src/routes/scorer-assignments.integration.test.ts
- apps/tournament-api/src/app.ts
- apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx
- apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx
- apps/tournament-web/src/lib/offline-queue.ts (added during impl: new exported `peekErroredEntries(roundId?)` helper for the stale-queue banner; ALLOWED path; appended per the spec's amendment rule)

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
