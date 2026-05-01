# T5-8: Round Lifecycle State Machine [new]

## Status

Ready for Dev

## Story

As a developer (and indirectly, the trip organizer + scorers),
I want a gated state machine for `round_states.state` with transitions `not_started → in_progress → complete_editable → finalized`, plus a terminal `cancelled` branch (FR-B9, NFR-R3),
So that every downstream recompute (money, leaderboard, activity) knows what state to trust, and `finalized` is immutable via normal write paths.

T5-8 closes the lifecycle gap that T5-6 (score commit) and T5-7 (scorer handoff) both currently work around with inline state reads. It promotes the FSM into a shared service (`services/round-state.ts`), introduces the explicit POST endpoints for human-driven transitions (`/complete`, `/finalize`, `/cancel`), and migrates T5-6 + T5-7 onto the service — closing T5-7d (state-machine integration) and T5-7f (state-gate race window) followups in the same commit.

T5-8 is the next story in epic T5 after T5-7 ✓: T5-8 → T5-9 → T5-10 → T5-11.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. Path footprint — ALLOWED only, ZERO SHARED, ZERO FORBIDDEN expected

```
apps/tournament-api/src/services/round-state.ts                              [NEW]
apps/tournament-api/src/services/round-state.test.ts                         [NEW]
apps/tournament-api/src/services/index.ts                                    [MOD: re-export]
apps/tournament-api/src/routes/round-lifecycle.ts                            [NEW]
apps/tournament-api/src/routes/round-lifecycle.integration.test.ts           [NEW]
apps/tournament-api/src/app.ts                                               [MOD: mount router]
apps/tournament-api/src/routes/scores.ts                                     [MOD: use transitionState; remove inline state-flip logic]
apps/tournament-api/src/routes/scorer-assignments.ts                         [MOD: move state-gate read into tx via getRoundState (closes T5-7d + T5-7f)]
```

If implementation surfaces additional ALLOWED files (e.g., a small helper extracted for testability), they MUST be appended to "Files this story will edit" before commit. Any path outside `apps/tournament-*/**` requires re-running the spec gate.

### 2. Dependencies + forward references

- **T5-1 (`round_states` schema)** — write target. PK on `round_id` (single-row-per-round invariant; same one T5-5 leaderboard relies on per `apps/tournament-api/src/db/schema/scoring.ts:198`). The CHECK constraint at scoring.ts:209-212 enforces `state IN ('not_started','in_progress','complete_editable','finalized','cancelled')`.
- **T5-1 audit-log (`audit_log`)** — uses the existing `AUDIT_EVENT_TYPES.ROUND_STATE_CHANGED = 'round.state_changed'` (lib/audit-log.ts:26) and `AUDIT_EVENT_TYPES.ROUND_FINALIZED = 'round.finalized'` (lib/audit-log.ts:28). Both already defined; **no new constants needed**.
- **T5-6 (score commit)** — currently has inline state-transition logic at `apps/tournament-api/src/routes/scores.ts:455-540` (the not_started→in_progress and in_progress→complete_editable transitions, both race-safe via conditional UPDATE). T5-8 promotes this logic into the service and updates scores.ts to call it.
- **T5-7 (scorer handoff)** — currently reads `round_states.state` BEFORE the transaction (the AC-2 state gate). T5-7 followups d + f track this. T5-8 closes both: replaces the pre-tx read with an in-tx `getRoundState(tx, ...)` call, narrowing the race window to nothing.
- **T5-9 (score correction, NOT yet shipped)** — will need to read state to allow corrections in `complete_editable`/`finalized` and reject in `not_started`/`cancelled`. T5-9 will use `getRoundState` from this story.
- **`computeExpectedCells` helper** — currently a private function in `apps/tournament-api/src/routes/scores.ts:576-594`. The comment at scores.ts:573-574 explicitly anticipates this: "T5-8 may promote this to `apps/tournament-api/src/services/round-state.ts` when the FSM is extracted." T5-8 does that promotion.
- **T6 money/leaderboard recompute (NOT yet shipped)** — the epic AC for `/finalize` says "money/leaderboard recomputation (T6 services reading via tx)". T5-8 ships the finalize transaction skeleton WITHOUT the recompute hook (T6 hasn't shipped, no services to call). The skeleton's transaction-block + transition + audit + activity all land in v1; T6 will append its recompute call inside the same tx when it lands. Followup T5-8a tracks.
- **T5-5 leaderboard** — does NOT need a finalize hook. Per architecture D1-1 (no cache v1), leaderboard recomputes on read. Finalize doesn't trigger any leaderboard service in v1.

### 3. Service layer convention (T5-5 precedent)

Per the services-layer-pattern established by T5-5 (`apps/tournament-api/src/services/index.ts:3-12`):
- **Read-only services only.** `getRoundState` is a pure read.
- **`transitionState` is the EXCEPTION**: it writes `round_states` + audit. The convention's "read-only" rule applies only to data-shape query services (leaderboard, money matrix, etc.). Mutating-but-domain-encapsulated functions like `transitionState` are allowed; the line is "no orphan side-effects without a domain reason". The barrel comment at `services/index.ts:3-12` should be updated to acknowledge this single mutating exception.

### 4. Auth model (per-event organizer, NOT global is_organizer)

T5-7 established the per-event-organizer pattern (events.organizer_player_id, NOT players.is_organizer). T5-8 reuses it across all three POST endpoints:

- **POST `/complete`**: organizer-OR-scorer auth — either the event's organizer OR a scorer of any foursome in the round can mark complete. (Epic AC: "by the organizer or the scorer of any foursome in the round".)
- **POST `/finalize`**: per-event organizer ONLY. Finalization locks the round; this is an organizer-only action.
- **POST `/cancel`**: per-event organizer ONLY. Same reasoning.

Auth checks happen INSIDE the transaction (TOCTOU pattern from T5-7) so a concurrent transfer cannot stale the decision. Helper `isEventOrganizer(tx, roundId, playerId, tenantId)` lives in `services/round-state.ts` and is reused by /finalize, /cancel, and (when integrated) T5-7's scorer-assignments.

### 5. State-machine transition matrix

| From | To | Driver |
|------|------|---|
| `not_started` | `in_progress` | First score commit (T5-6 auto-transition) |
| `in_progress` | `complete_editable` | Last-cell score commit (T5-6 auto) OR explicit POST `/complete` |
| `complete_editable` | `in_progress` | Explicit POST `/complete-rollback` (organizer or scorer; allowed pre-finalize only) |
| `complete_editable` | `finalized` | Explicit POST `/finalize` (organizer only) |
| `not_started` | `cancelled` | Explicit POST `/cancel` (organizer only) |
| `in_progress` | `cancelled` | Explicit POST `/cancel` (organizer only) |
| `complete_editable` | `cancelled` | Explicit POST `/cancel` (organizer only) |
| Any other transition | — | Throws `BusinessRuleError` → 422 |

**`finalized` is terminal under normal write paths.** The only re-entry is via T5-9 score-correction (which audit-trails the change but does NOT transition state).

**`cancelled` is terminal.** No transitions out of cancelled in v1. (Re-opening a cancelled round is a v1.5+ admin operation.)

**`complete_editable → in_progress` rollback** — the epic AC mentions this. v1 ships it as POST `/api/rounds/:roundId/complete-rollback` to give organizers a safety hatch when auto-complete fired prematurely. Implementation is symmetric with /complete: writeAudit, transition, no missing-cell check (going BACK to in_progress doesn't require all cells).

### 6. Integration points to T5-6 + T5-7 (refactor scope)

**T5-6 scores.ts refactor (lines 455-540):**
- Replace the inline `not_started → in_progress` UPDATE-with-state-predicate with `transitionState(tx, roundId, 'in_progress', session.userId, tenantId)`.
- Replace the inline `in_progress → complete_editable` auto-transition similarly.
- Keep the side effect of setting `rounds.opened_at` + `rounds.opened_by_player_id` inside `transitionState` (the function knows that target=`in_progress` from `not_started` triggers this side effect).
- The race-safe conditional UPDATE pattern moves into the service. Same correctness; same tests must pass.

**T5-7 scorer-assignments.ts refactor:**
- Currently reads `round_states.state` BEFORE entering the transaction at lines 132-156 (per the spec's Section 4 and AC-2).
- After T5-8: delete the pre-tx read; call `const state = await getRoundState(tx, roundId, TENANT_ID)` as the FIRST in-tx step inside `db.transaction(async (tx) => {...})`. Reject finalized/cancelled/missing inline.
- This closes both T5-7d (state-machine integration) AND T5-7f (state-gate race window).

### 7. T5-7f race window — partial closure under SQLite snapshot isolation (acknowledged residual)

**HONEST DISCLAIMER (codex spec-codex-rerun caught this).** SQLite's WAL snapshot isolation means a transaction that BEGINs before a concurrent /finalize commits will see the pre-finalize state on its in-tx reads — and the EXISTS subquery within an UPDATE evaluates against THAT snapshot, not the latest committed state. So the EXISTS-gated UPDATE pattern alone does NOT fully close the race.

**Fully closing the race requires `BEGIN IMMEDIATE`** (which acquires the write lock at transaction begin, forcing serial execution between concurrent writers). drizzle-orm's libsql `db.transaction(callback)` uses default `BEGIN` (deferred) and does not cleanly expose an `IMMEDIATE` mode in current versions. Workarounds (raw SQL, version pins, library forks) are non-trivial.

**v1 decision (subject to spec-gate approval):** ACCEPT the residual race as a documented limitation. The state-gated EXISTS-narrowed UPDATE we DO ship still meaningfully tightens the failure mode:

- ✅ If /finalize commits BEFORE the handoff transaction begins → handoff's first read sees `finalized`, returns 422.
- ✅ If two handoff transactions race against the same scorer → the existing TOCTOU `scorer_player_id = :fromPlayerId` narrowing makes one win and the other 422.
- ⚠️ If /finalize and /handoff begin within the same snapshot window (sub-millisecond) → the handoff can theoretically still commit on a now-finalized round.

**Why v1 acceptance is reasonable:** /finalize is a deliberate organizer action that takes seconds (UI confirmation flow). /handoff is a deliberate scorer action. The chance of both committing within the same SQLite snapshot window for a 16-player league trip is vanishingly small. The audit trail (every transition writes audit rows) provides post-hoc reconciliation if it ever happens.

**Followup T5-8b: True race-window closure via BEGIN IMMEDIATE.** Investigate drizzle-orm's libsql transaction-mode support (or a raw-SQL workaround) and re-amend T5-7's handoff transaction + this story's transitionState + T5-6's score-commit INSERT to use IMMEDIATE locking. Also covers the score-commit residual flagged by impl-codex Medium #4: T5-6's hole_score INSERT does NOT have a state-gating EXISTS predicate (drizzle's INSERT API doesn't accept a WHERE clause), so the same within-snapshot residual race that affects T5-7's UPDATE also affects T5-6's INSERT. The state read at T5-6 scores.ts:332-348 closes the case where /finalize commits BEFORE the score-commit transaction begins; the within-snapshot case requires BEGIN IMMEDIATE. v1.5 enhancement.

### 7b. State-gated-write requirement (writers other than transitionState)

Before T5-8: state read at request time → caller authorized → transaction begins → UPDATE. The window between "state read" and "UPDATE commit" is open; a concurrent /finalize or /cancel could land between them, and the handoff would still commit on a now-finalized round.

**Naive in-tx-read alone is INSUFFICIENT** (codex spec-review caught this Critical). Under SQLite snapshot isolation, a transaction that began BEFORE a concurrent /finalize commits will keep seeing the pre-finalize state on its in-tx read AND its scorer_assignments UPDATE — the handoff's writes don't conflict with the finalize's writes (different tables), so SQLite happily commits both, leaving a "scorer transferred on a now-finalized round" anomaly.

**The complete fix has two parts:**

(a) **Read state inside the transaction** (replaces the pre-tx read; closes T5-7d's "use the service" intent).

(b) **State-gate the WRITE itself.** The scorer_assignments UPDATE in T5-7 MUST be amended to include an `EXISTS` predicate that re-checks `round_states.state` at write-time, e.g.:

```sql
UPDATE scorer_assignments
SET scorer_player_id = :toPlayerId,
    assigned_at = :now,
    assigned_by_player_id = :actor
WHERE round_id = :roundId
  AND foursome_number = :foursomeNumber
  AND scorer_player_id = :fromPlayerId          -- existing TOCTOU narrowing
  AND tenant_id = :tenant
  AND EXISTS (
    SELECT 1 FROM round_states
    WHERE round_states.round_id = scorer_assignments.round_id
      AND round_states.tenant_id = :tenant
      AND round_states.state NOT IN ('finalized', 'cancelled')
  )
```

If a concurrent /finalize commits between the in-tx read and the in-tx UPDATE, the EXISTS subquery sees the new state and the UPDATE returns 0 rows → the handoff transaction returns 422 `round_finalized`. Race closed.

This is the SAME state-gated-write pattern T5-6 already uses for its score-cell UPDATE (the score POST narrows on `round_states.state IN (writable)` via a join). T5-8 generalizes the pattern + applies it to T5-7's scorer-assignments path.

**For transitionState itself:** the conditional UPDATE narrows on `state = :current`, which IS race-safe (state is the same column being written). No additional EXISTS predicate needed inside transitionState; the existing pattern is correct.

### 7b. State-gated-write requirement (writers other than transitionState)

Any future writer that needs the "round must be in writable states" gate (e.g., T5-9 score correction will eventually need similar) MUST follow the same pattern: include an `EXISTS (SELECT 1 FROM round_states WHERE ... AND state NOT IN ('finalized','cancelled'))` predicate (or a more restrictive set) in the UPDATE/INSERT WHERE. Documenting this convention up-front prevents future race-window regressions.

### 8. T6 money recompute on finalize — out of scope, stub-only

The epic AC for /finalize says step (b) is "money/leaderboard recomputation (T6 services reading via tx)". T6 hasn't shipped in v1. T5-8's /finalize handler:
- Re-verifies all cells scored (defense — state could've rolled back; epic AC step (a)).
- Calls `transitionState(tx, roundId, 'finalized', actorPlayerId, tenantId)`.
- Audit row (handled by transitionState).
- Activity row (handled by transitionState).
- Returns 200.
- **NO money recompute call** — the function call site does not yet exist. Followup **T5-8a** documents this: when T6-9 (or whichever T6 story owns the recompute dispatcher) ships, append the dispatcher invocation inside the finalize transaction after the transitionState call.

This is consistent with FD-7 v1 / v1.5 layering: don't call services that don't exist yet.

### 9. Tenant scoping discipline

Every query in `services/round-state.ts` and `routes/round-lifecycle.ts` includes `tenant_id = TENANT_ID` on every joined table. Inline `const TENANT_ID = 'guyan'` per the established pattern (T5-5, T5-6, T5-7).

## Acceptance Criteria

(Derived from epics-phase1.md T5.8 lines 1504-1550. Notable v1 deviations from the epic AC are flagged inline.)

**AC-1 — Service signature: `transitionState`.**
**Given** `apps/tournament-api/src/services/round-state.ts`
**When** inspected
**Then** it exports:

```ts
export type RoundState =
  | 'not_started'
  | 'in_progress'
  | 'complete_editable'
  | 'finalized'
  | 'cancelled';

/**
 * Domain error class. Constructor is positional: (code, message, status?).
 * `status` defaults to 422 (the dominant case for state-machine
 * violations). Routes catch BusinessRuleError and map to
 * `c.json({ error: 'unprocessable', code: err.code, requestId }, err.status)`.
 */
export class BusinessRuleError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status?: number);
}

export async function transitionState(
  tx: Tx,
  roundId: string,
  to: RoundState,
  actorPlayerId: string,
  tenantId: string,
): Promise<{ from: RoundState; to: RoundState }>;

export async function getRoundState(
  tx: Tx | Db,
  roundId: string,
  tenantId: string,
): Promise<RoundState | null>;

export async function isEventOrganizer(
  tx: Tx | Db,
  roundId: string,
  playerId: string,
  tenantId: string,
): Promise<boolean>;

export async function computeExpectedCells(
  tx: Tx | Db,
  round: { eventRoundId: string | null; holesToPlay: number },
  tenantId: string,
): Promise<number>;

export async function computeMissingCells(
  tx: Tx | Db,
  roundId: string,
  round: { eventRoundId: string | null; holesToPlay: number },
  tenantId: string,
): Promise<{
  expectedCount: number;
  actualCount: number;
  missingCells: Array<{ playerId: string; holeNumber: number }>;
}>;
```

`Tx` and `Db` are the standard drizzle transaction / db types (matched to `lib/audit-log.ts` typing). The `BusinessRuleError` constructor is positional throughout the codebase; throw sites use `throw new BusinessRuleError('illegal_state_transition', 'cannot transition not_started → finalized', 422)`. Each error code MUST appear with a stable, human-readable message so route-level tests can assert response shape.

**`computeMissingCells` algorithm.** Builds the expected (playerId, holeNumber) set from `pairing_members ⨯ [1..holesToPlay]` (cross-product of distinct foursome members and hole numbers in scope), then subtracts the set of (player_id, hole_number) keys present in `hole_scores` for the round. Returns the missing pairs sorted ascending by `(playerId, holeNumber)` for deterministic output. Tenant-scoped on every joined table.

`computeExpectedCells` (existing helper, promoted from scores.ts) is retained for back-compat with T5-6's count-only logic. `computeMissingCells` is the new helper used by `/complete` + `/finalize` defensive re-verify.

**AC-2 — Transition matrix enforced; illegal transitions throw.**
**Given** `transitionState(tx, roundId, to, actorPlayerId, tenantId)`
**When** the current state and target combination are NOT in the legal matrix (Section 5 above)
**Then** the function throws `new BusinessRuleError('illegal_state_transition', 'cannot transition {from} → {to}', 422)`. Legal transitions execute the conditional UPDATE; on 0 rows updated (concurrent transition won), the function re-reads state and either: (i) target state matches the new current → return successfully (idempotent on the desired terminal state), OR (ii) target state does NOT match → throw `new BusinessRuleError('illegal_state_transition', 'concurrent transition raced to {newCurrent}', 422)`. The race-safe conditional UPDATE pattern from T5-6 is preserved; tests cover the concurrent-write case.

**AC-3 — Side effects on transition (audit + opened_at).**
**Given** a successful transition via `transitionState`
**When** the transition commits
**Then**:
  (a) `audit_log` row written with `eventType = 'round.state_changed'`, `entityType = 'round'`, `entityId = roundId`, `actorPlayerId`, `payloadJson = { from, to }`.
  (b) For `not_started → in_progress` ONLY: also `UPDATE rounds SET opened_at = now(), opened_by_player_id = :actor WHERE id = :roundId AND tenant_id = :tenant` IF `opened_at IS NULL` (the conditional avoids overwriting on idempotent re-call).
  (c) `round_states.entered_at` and `round_states.entered_by_player_id` are updated alongside the state change.

**AC-4 — POST `/api/rounds/:roundId/complete`.**
**Given** the route mounted at `/api/rounds`
**When** invoked by either the per-event organizer (`events.organizer_player_id`) OR a scorer of ANY foursome in the round (`scorer_assignments.scorer_player_id` for any foursome of `:roundId`)
**Then** the handler runs in `db.transaction(async (tx) => {...})`:
  (i) `getRoundState(tx, roundId, tenantId)` → if null, 422 `round_state_missing`. If `cancelled`, 422 `round_cancelled`. If `finalized`, 422 `round_finalized`. If already `complete_editable`, 200 idempotent. If `not_started`, 422 `round_not_in_progress`.
  (ii) Authorization re-check inside tx (per-event organizer OR scorer-of-any-foursome). 403 `not_authorized_for_complete` on mismatch.
  (iii) Round row read (defense — for `eventRoundId` + `holesToPlay`).
  (iv) Missing-cell enumeration via `computeMissingCells(tx, roundId, round, tenantId)`. If `result.missingCells.length > 0`: 422 `round_incomplete` with body `{ missingCells: result.missingCells, requestId }` — the array enumerates which (playerId, holeNumber) pairs are blank, sorted by playerId then holeNumber for deterministic ordering.
  (v) `transitionState(tx, roundId, 'complete_editable', session.userId, tenantId)`.
  (vi) `emitActivity(tx, { type: 'round.completed', actorPlayerId, scope: { roundId } })`.
  Returns 200 `{ ok: true, state: 'complete_editable', requestId }`.
On non-participant (caller is neither organizer nor scorer of any foursome): 403 `not_authorized_for_complete`.

**AC-5 — POST `/api/rounds/:roundId/complete-rollback`.**
**Given** the route mounted at `/api/rounds`
**When** invoked by per-event organizer OR scorer-of-any-foursome
**Then** the handler runs in `db.transaction`:
  (i) `getRoundState(tx, roundId, tenantId)` → if not `complete_editable`, 422 `not_in_complete_editable`.
  (ii) Authorization re-check. 403 on mismatch.
  (iii) `transitionState(tx, roundId, 'in_progress', session.userId, tenantId)`.
  (iv) `emitActivity(tx, { type: 'round.complete_rolled_back', ... })`.
  Returns 200 `{ ok: true, state: 'in_progress', requestId }`.

**AC-6 — POST `/api/rounds/:roundId/finalize`.**
**Given** the route mounted at `/api/rounds`
**When** invoked by per-event organizer ONLY (NOT scorer)
**Then** the handler runs in `db.transaction`:
  (i) `getRoundState(tx, roundId, tenantId)` → if not `complete_editable`, 422 `not_in_complete_editable`. If already `finalized` → **idempotent path:** read existing `entered_at` from `round_states`, return 200 `{ ok: true, state: 'finalized', finalizedAt: <existing>, idempotent: true, requestId }`. **NO new audit row, NO new activity emit on the idempotent path** (would otherwise double-count in reporting).
  (ii) Authorization re-check via `isEventOrganizer(tx, roundId, session.userId, tenantId)`. 403 `not_authorized_for_finalize` on mismatch.
  (iii) **Read the round row** (eventRoundId + holesToPlay) — same tenant-scoped SELECT FROM rounds WHERE id=:roundId pattern T5-7 uses; 422 `round_not_found` if absent (defense; T5-1 invariant should make this unreachable post AC-2).
  (iv) Defensive missing-cell re-verify via `computeMissingCells(tx, roundId, round, tenantId)`. If `missingCells.length > 0`, 422 `round_incomplete` (same shape as AC-4(iv)).
  (v') `transitionState(tx, roundId, 'finalized', session.userId, tenantId)` — writes the generic `round.state_changed` audit row.
  (v) Handler ALSO writes an ADDITIONAL audit row using `eventType: 'round.finalized'` (constant at `audit-log.ts:28`) — finalization is significant enough to warrant its own audit class for downstream filtering. Defense in depth: `state_changed` covers the FSM trail uniformly; `round.finalized` is the dedicated semantic event for T9 reporting + post-finalize drilldowns.
  (vi) `emitActivity(tx, { type: 'round.finalized', ... })`.
  (vii) **NO money recompute call** in v1. Followup T5-8a appends T6's dispatcher when it ships.
  Returns 200 `{ ok: true, state: 'finalized', finalizedAt: <new entered_at>, idempotent: false, requestId }`.

**AC-7 — POST `/api/rounds/:roundId/cancel`.**
**Given** the route mounted at `/api/rounds`
**When** invoked by per-event organizer ONLY
**Then** the handler runs in `db.transaction`:
  (i) `getRoundState(tx, roundId, tenantId)` → if `finalized`, 422 `cannot_cancel_finalized`. If already `cancelled` → idempotent: return 200 `{ ok: true, state: 'cancelled', idempotent: true, requestId }` with NO new audit/activity row.
  (ii) Authorization re-check via `isEventOrganizer`. 403 `not_authorized_for_cancel`.
  (iii) `transitionState(tx, roundId, 'cancelled', session.userId, tenantId)`.
  (iv) `emitActivity(tx, { type: 'round.cancelled', ... })`.
  Returns 200 `{ ok: true, state: 'cancelled', idempotent: false, requestId }`.

**AC-8 — Score POST against finalized round → 422 (T5-6 integration).**
**Given** a round in `finalized` state
**When** the scorer POSTs a score mutation via T5-6 endpoint
**Then** 422 `{ error: 'unprocessable', code: 'round_state_locks_writes', currentState: 'finalized', requestId }`. v1 deviation from epic AC (`'round_finalized'` rephrased): the existing T5-6 emits `round_not_writable` for `complete_editable` and `not_started`-via-different-path; we add the `finalized` branch with the more specific code. **Only writable path to a finalized round is T5-9 score-correction (NOT yet shipped).**

**AC-9 — T5-6 refactor: replace inline state-transitions with service calls.**
**Given** `apps/tournament-api/src/routes/scores.ts:455-540`
**When** refactored
**Then** the inline `not_started → in_progress` UPDATE block AND the inline `in_progress → complete_editable` UPDATE block are both replaced by calls to `transitionState(tx, roundId, target, session.userId, TENANT_ID)`. The race-safe conditional UPDATE behavior is preserved (now inside the service). The `rounds.opened_at` side effect is preserved (now inside the service). All existing T5-6 integration tests must still pass without modification.

**AC-10 — T5-7 refactor: move state-gate read inside tx + state-gate the WRITE.**
**Given** `apps/tournament-api/src/routes/scorer-assignments.ts`
**When** refactored
**Then**:
  (a) The pre-transaction `round_states` SELECT (currently lines 132-156 of scorer-assignments.ts in the T5-7 ship) is REMOVED. As the FIRST in-tx step inside `db.transaction`, the handler calls `const state = await getRoundState(tx, roundId, TENANT_ID)` and applies the same gate logic (reject `finalized`, `cancelled`, missing) by throwing `new BusinessRuleError('round_finalized', ...)` etc.
  (b) **The scorer_assignments UPDATE is amended to add a state-gating EXISTS predicate** (per Section 7 above) so the WRITE itself re-checks state at write-time. SQLite snapshot isolation alone is insufficient to close the race; the EXISTS subquery forces the write to fail (0 rows) if a concurrent /finalize or /cancel committed between this transaction's BEGIN and its UPDATE. The 0-rows path then returns the appropriate 422 (the handler distinguishes scorer-mismatch 0-rows from state-gated 0-rows by re-reading state in the tx after the UPDATE; see implementation guidance in Task 8).
  (c) All existing T5-7 integration tests must still pass without modification (the public contract — 422 codes for finalized/cancelled, etc. — is unchanged from T5-7's user-facing perspective).
  (d) **NEW integration test added**: a "finalize-before-handoff" test exercising the partial-close case — first call /finalize (or directly call `transitionState` to flip state to `finalized`), THEN open a NEW handoff transaction and assert it returns 422 `round_finalized` (state-gated EXISTS now sees finalized). Note: this test exercises the case where finalize COMMITTED before the handoff transaction begins — which is the case our state-gated UPDATE actually does close. Per Section 7's honest disclaimer, the harder case (finalize commits during the handoff's open snapshot window) is a documented v1 residual and is NOT tested here; followup T5-8b tracks the BEGIN IMMEDIATE fix that would close that case.
  (e) T5-7f's race window PARTIALLY closes (the finalize-committed-before-handoff-begins case is now state-gated; the within-snapshot case requires followup T5-8b's BEGIN IMMEDIATE work). T5-7d's followup is satisfied (uses the service). T5-7g is satisfied for the partial case via the new integration test; the residual within-snapshot test is owned by T5-8b. T5-7d + T5-7g closed; T5-7f kept OPEN with note "partial closure landed in T5-8; full closure in T5-8b". Mark accordingly in T5-7's spec.

**AC-11 — Service-level test coverage (`round-state.test.ts`).**
**Given** `apps/tournament-api/src/services/round-state.test.ts`
**When** tests run
**Then** at minimum these unit/integration tests pass:
  (a) Each legal transition succeeds + writes correct audit payload.
  (b) Each illegal transition throws `BusinessRuleError('illegal_state_transition')`.
  (c) Concurrent same-target transitions: only ONE writes audit; second call is idempotent.
  (d) `not_started → in_progress` sets `rounds.opened_at` AND `rounds.opened_by_player_id`; subsequent transitions don't overwrite `opened_at`.
  (e) `getRoundState` returns null for missing round; correct state for existing.
  (f) `isEventOrganizer` true for matching player; false for non-organizer; tenant-scoped.
  (g) `computeExpectedCells`: 4-player foursome × 18-hole round = 72 expected; 9-hole round = 36 expected; null `eventRoundId` → 0.

**AC-12 — Route-level test coverage (`round-lifecycle.integration.test.ts`).**
**Given** `apps/tournament-api/src/routes/round-lifecycle.integration.test.ts`
**When** tests run
**Then** at minimum these tests pass:
  (a) `/complete` happy path — all 72 cells scored → 200, state=complete_editable.
  (b) `/complete` missing cells — 1 cell blank → 422 `round_incomplete` with `missingCells.length === 1` populated.
  (c) `/complete` from `not_started` → 422 `round_not_in_progress`.
  (d) `/complete` from `complete_editable` → 200 idempotent.
  (e) `/complete` non-organizer-non-scorer → 403 `not_authorized_for_complete`.
  (f) `/complete-rollback` from `complete_editable` → 200, state=in_progress.
  (g) `/complete-rollback` from `in_progress` → 422 `not_in_complete_editable`.
  (h) `/finalize` happy path — round in complete_editable → 200, state=finalized, idempotent=false; EXACTLY 2 audit rows written (state_changed + round.finalized) and 1 activity row.
  (h2) `/finalize` idempotent — second POST on already-finalized round → 200, idempotent=true; audit row count UNCHANGED from after (h) (no double-logging); activity row count UNCHANGED. Same finalizedAt timestamp returned.
  (i) `/finalize` from `in_progress` → 422 `not_in_complete_editable`.
  (j) `/finalize` by scorer (not organizer) → 403 `not_authorized_for_finalize`.
  (k) `/finalize` defensive missing-cell — round was complete_editable but a cell got deleted via direct DB write between AC and finalize call → 422 `round_incomplete`.
  (l) `/cancel` from each non-finalized state → 200, state=cancelled.
  (m) `/cancel` from `finalized` → 422 `cannot_cancel_finalized`.
  (n) `/cancel` by scorer (not organizer) → 403.
  (o) Score POST against `finalized` round → 422 `round_state_locks_writes` (T5-6 endpoint, now post-T5-8 finalized-state branch).

**AC-13 — Audit + activity emission contract.**
**Given** any successful state transition (via service or any of the routes)
**When** committed
**Then** audit_log has at LEAST one row with `eventType = 'round.state_changed'`. For finalize specifically, ALSO a row with `eventType = 'round.finalized'`. Activity rows emit per their respective handlers (currently all NO-OPs in v1 per `lib/activity.ts:26-31`; T8 will replace bodies).

## Tasks / Subtasks

- [ ] **Task 1: Create `services/round-state.ts`.**
  - File: `apps/tournament-api/src/services/round-state.ts`.
  - Define `RoundState` type, `BusinessRuleError` class (positional constructor `(code, message, status?)` with status defaulting to 422), `LEGAL_TRANSITIONS` const Map.
  - Implement `transitionState(tx, roundId, to, actorPlayerId, tenantId)`:
    1. SELECT current state (with tenant filter).
    2. If 0 rows → throw `new BusinessRuleError('round_state_missing', 'no round_states row for round {roundId}', 422)`.
    3. If current === to → return `{ from: current, to }` idempotently (no UPDATE, no audit).
    4. If (current, to) NOT in `LEGAL_TRANSITIONS` → throw `new BusinessRuleError('illegal_state_transition', 'cannot transition {current} → {to}', 422)`.
    5. Conditional UPDATE: `WHERE round_id = :roundId AND state = :current AND tenant_id = :tenantId` SET state = to, entered_at = now(), entered_by_player_id = actor.
    6. If 0 rows updated (race) → re-read; if new state === to, return idempotent (no audit); else throw `new BusinessRuleError('illegal_state_transition', 'concurrent transition raced to {newCurrent}', 422)`.
    7. Side effect for `not_started → in_progress`: UPDATE rounds.opened_at, opened_by_player_id (only if opened_at IS NULL).
    8. writeAudit with eventType `AUDIT_EVENT_TYPES.ROUND_STATE_CHANGED`, payload `{ from, to }`.
    9. Return `{ from, to }`.
  - Implement `getRoundState(tx | db, roundId, tenantId)`: simple SELECT (tenant-scoped); returns null if missing.
  - Implement `isEventOrganizer(tx | db, roundId, playerId, tenantId)`: JOIN `rounds → events` on `events.id = rounds.event_id`; WHERE `rounds.id = :roundId AND events.organizer_player_id = :playerId AND rounds.tenant_id = :tenantId AND events.tenant_id = :tenantId`. Return `true` if 1 row, `false` if 0.
  - Promote `computeExpectedCells` from scores.ts (with the explicit `tenantId` arg).
  - Implement `computeMissingCells(tx, roundId, round, tenantId)`:
    1. Build expected set: SELECT distinct `pairing_members.player_id` joined to `pairings` on `pairing_members.pairing_id = pairings.id` WHERE `pairings.event_round_id = :round.eventRoundId AND tenant filters`. Cross with `[1..round.holesToPlay]` to get expected pairs.
    2. Build actual set: SELECT `player_id, hole_number` FROM `hole_scores` WHERE `round_id = :roundId AND hole_number <= :holesToPlay AND tenant_id = :tenantId`.
    3. Set difference (expected − actual). Sort by `(player_id, hole_number)` ascending.
    4. Return `{ expectedCount, actualCount, missingCells }`.
    Edge case: `round.eventRoundId === null` → return `{ expectedCount: 0, actualCount: 0, missingCells: [] }`.
  - Inline `const TENANT_ID = 'guyan'` is NOT needed in this file — every function takes tenantId as a parameter. Callers from routes pass their inline TENANT_ID.

- [ ] **Task 2: Write `services/round-state.test.ts`.**
  - File: `apps/tournament-api/src/services/round-state.test.ts`.
  - Mirror T5-5's in-memory libsql + migrate setup.
  - 7 tests per AC-11.
  - Use a per-test `seedRound` helper that supports state injection (similar to T5-7's seed pattern).

- [ ] **Task 3: Update barrel `services/index.ts`.**
  - Re-export `transitionState`, `getRoundState`, `isEventOrganizer`, `computeExpectedCells`, `RoundState`, `BusinessRuleError`.
  - Update the barrel header comment to acknowledge the single mutating exception (`transitionState`) and document that domain-encapsulated mutating service functions are allowed.

- [ ] **Task 4: Create `routes/round-lifecycle.ts`.**
  - File: `apps/tournament-api/src/routes/round-lifecycle.ts`.
  - Export `roundLifecycleRouter = new Hono()`.
  - 4 POST routes: `/:roundId/complete`, `/:roundId/complete-rollback`, `/:roundId/finalize`, `/:roundId/cancel`.
  - Auth chain: `requireSession` only (per-event auth happens inside handler).
  - Each handler: open `db.transaction`, getRoundState, auth re-check, transition-specific validations (missing cells for /complete + /finalize), call `transitionState`, emit activity, return 200.
  - Map `BusinessRuleError` → 422 `{ error: 'unprocessable', code: err.code, requestId }`.
  - Inline `const TENANT_ID = 'guyan'`.

- [ ] **Task 5: Wire router into `app.ts`.**
  - Modify `apps/tournament-api/src/app.ts` — import + mount `roundLifecycleRouter` on `/api/rounds`.
  - Add block-comment documenting the 4 effective URLs.

- [ ] **Task 6: Write `routes/round-lifecycle.integration.test.ts`.**
  - File: `apps/tournament-api/src/routes/round-lifecycle.integration.test.ts`.
  - Pattern after T5-7's integration test (auth mock, in-memory libsql).
  - 15 tests per AC-12 (a)–(o).
  - Reuse the `seedRound` helper pattern; extend with full-foursome + all-cells-scored seeding for /complete + /finalize tests.

- [ ] **Task 7: Refactor T5-6 `routes/scores.ts` to use `transitionState`.**
  - Replace lines ~455-540 (the two inline state-transition blocks) with calls to `transitionState`.
  - Preserve the race-safe behavior + the rounds.opened_at side effect (now inside the service).
  - All existing T5-6 integration tests (552 total in tournament-api as of 2026-05-01) must still pass without modification.

- [ ] **Task 8: Refactor T5-7 `routes/scorer-assignments.ts` to use `getRoundState` in-tx + state-gate the UPDATE.**
  - Remove the pre-transaction `round_states` SELECT (currently outside `db.transaction`).
  - Replace with `const state = await getRoundState(tx, roundId, TENANT_ID)` as the first step inside the transaction.
  - Apply the same gate logic (reject finalized/cancelled/missing) inline.
  - **Add EXISTS predicate to the scorer_assignments UPDATE** so the WRITE re-checks state at commit-time:
    ```sql
    UPDATE scorer_assignments
    SET ...
    WHERE round_id = :roundId
      AND foursome_number = :fn
      AND scorer_player_id = :fromPlayerId  -- existing TOCTOU narrowing
      AND tenant_id = :tenant
      AND EXISTS (
        SELECT 1 FROM round_states
        WHERE round_states.round_id = scorer_assignments.round_id
          AND round_states.tenant_id = :tenant
          AND round_states.state NOT IN ('finalized', 'cancelled')
      )
    ```
    On 0 rows updated, re-read state inside the tx. If state ∈ {finalized, cancelled} → 422 with the corresponding code (`round_finalized` / `round_cancelled`). Else → 403 `not_authorized_for_handoff` (the existing TOCTOU-narrowing scorer-mismatch path).
  - **Add the new "concurrent finalize during handoff" integration test** (per AC-10(d)) to `scorer-assignments.integration.test.ts`. Uses a second libsql connection on the same `:memory:?cache=shared` URL to commit a finalize while the handoff transaction is mid-flight. Asserts the handoff returns 422 `round_finalized`.
  - All other existing T5-7 integration tests (15 in scorer-assignments.integration.test.ts) must still pass without modification.
  - Mark T5-7d, T5-7f, AND T5-7g as CLOSED in T5-7's spec followup section (in this story's commit, since they're closed by this story).

- [ ] **Task 9: Run regression test pass.** All existing tournament-api + tournament-web suites must remain green; engine + Wolf Cup api unaffected. New `round-state.test.ts` + `round-lifecycle.integration.test.ts` add ~22 new tests (7 + 15). Typecheck + lint clean.

## Dev Notes

### Project Structure Notes

- **Service layer convention amendment.** T5-5 established `services/` as read-only-only. T5-8 introduces the first mutating-but-domain-encapsulated function (`transitionState`). Update the barrel comment to acknowledge this: domain-side-effect-isolating functions are allowed; orphan side-effects without a domain reason are NOT.
- **`computeExpectedCells` promotion.** The function moves from `routes/scores.ts:576-594` to `services/round-state.ts`. The signature gains a `tenantId` arg for tenant scoping discipline (the existing implementation already filters on TENANT_ID; the arg makes it explicit).
- **Auth chain on the new routes.** Just `requireSession` at the route level — per-event organizer + scorer-of-any-foursome auth is handler-internal (T5-7 pattern). Neither `requireOrganizer` (global) nor `requireScorerForRound` (single-foursome) fits the multi-foursome scope of `/complete`.
- **`AUDIT_EVENT_TYPES.ROUND_STATE_CHANGED` + `ROUND_FINALIZED` already exist** in `apps/tournament-api/src/lib/audit-log.ts:26,28`. T5-8 uses them; no new constants needed.
- **Activity types** are passed as plain strings to `emitActivity` (the function is a v1 NO-OP per `lib/activity.ts:26-31`). T8 will populate the activity-event registry; T5-8's call sites are forward-compatible.

### References

- Epic spec: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` lines 1504–1550 (T5.8)
- PRD: `_bmad-output/planning-artifacts/tournament/prd.md` (FR-B9, NFR-R3)
- T5-1 schema (`round_states` PK + CHECK): `apps/tournament-api/src/db/schema/scoring.ts:198,209-212`
- T5-1 audit-log helper: `apps/tournament-api/src/lib/audit-log.ts:26,28,51` (existing constants + writeAudit)
- T5-1 activity helper: `apps/tournament-api/src/lib/activity.ts:26-31` (v1 NO-OP)
- T5-5 service-layer pattern + barrel: `apps/tournament-api/src/services/index.ts:3-12`
- T5-6 inline state-transition logic (to be promoted): `apps/tournament-api/src/routes/scores.ts:455-540` and `computeExpectedCells` at lines 576-594.
- T5-7 inline state-gate read (to be migrated): `apps/tournament-api/src/routes/scorer-assignments.ts:132-156`
- T5-7 followup notes (will be closed by this story): `_bmad-output/implementation-artifacts/tournament/T5-7-scorer-handoff-endpoint.md` Risks/Followups T5-7d + T5-7f

### Risks / Followups

- **Risk: refactoring T5-6 + T5-7 inline-to-service could regress existing tests.** Mitigation: existing tests must pass unchanged (AC-9 + AC-10 both stipulate this). If a test fails, the refactor is wrong, not the test — fix the refactor.
- **Followup T5-8a: T6 money recompute on finalize.** When T6's recompute dispatcher ships (likely T6-9 hand-calc-money-fixture or T6-13 sub-game-framework-dispatcher), append the dispatcher invocation inside `/finalize`'s transaction after the transitionState call. This is a one-line addition to the existing handler; no schema or signature change.
- **Followup T5-8b: Re-open cancelled rounds.** v1 has no path out of `cancelled`. v1.5+ admin operation: organizer can re-open a cancelled round (e.g., the cancel was a misclick). Requires explicit AC, audit, and probably a confirmation modal.
- **Followup T5-8c: Score-correction state gate (T5-9 dependency).** When T5-9 ships, it will read state via `getRoundState` from this story. Allowed states for score-correction: `complete_editable`, `finalized`. Rejected: `not_started`, `cancelled`, `in_progress` (corrections during in_progress are normal score-edits via T5-6). T5-9's spec will own the AC; this story just provides the read primitive.
- **Followup T5-8d: Idempotency window for double-finalize.** AC-6 says `/finalize` is idempotent on the already-finalized state (200 + the existing finalizedAt). Double-finalize is a UI-double-tap concern; the idempotent return prevents user-visible errors. v1.5 enhancement: include a `wasIdempotent: boolean` field in the response so the UI can suppress the success toast on the second call.
- **Followup T5-8e: Activity event registry.** T8 will populate `lib/activity.ts` with a typed event registry. T5-8's emit call-sites use plain strings; when T8 ships, it'll add type-safety without breaking the call sites.

## Files this story will edit

- apps/tournament-api/src/services/round-state.ts
- apps/tournament-api/src/services/round-state.test.ts
- apps/tournament-api/src/services/index.ts
- apps/tournament-api/src/routes/round-lifecycle.ts
- apps/tournament-api/src/routes/round-lifecycle.integration.test.ts
- apps/tournament-api/src/app.ts
- apps/tournament-api/src/routes/scores.ts
- apps/tournament-api/src/routes/scorer-assignments.ts
- _bmad-output/implementation-artifacts/tournament/T5-7-scorer-handoff-endpoint.md

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
