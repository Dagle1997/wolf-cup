# T6-4: Score-Commit Hook — Hole-Complete Press Evaluation + Activity Emission [new]

## Status

Done

## Story

As a developer,
I want the T5-6 score-commit handler extended to invoke the press engines (T6-2 team, T6-3 individual-bet) **only when the current hole becomes complete** (all 4 foursome members have committed a score for that hole), within the same transaction, with idempotent dedupe so score corrections don't re-fire already-logged presses, AND I want a `team_press_log` schema to persist team-press fires,
So that auto-press triggers fire at the correct moment — never partial-hole — and T8 engagement surfaces get clean, single-shot events (FR-D5, FR-C3).

T6-4 is the FOURTH story in epic T6. It's the FIRST story to MODIFY `apps/tournament-api/src/routes/scores.ts` (T5-6's domain) since T5-6 shipped — the changes are additive to the existing transaction. T6-4 also adds the `team_press_log` table (referenced but not created by T6-2).

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. Path footprint — ALLOWED only, ZERO SHARED, ZERO FORBIDDEN expected

```
apps/tournament-api/src/db/schema/press.ts                                     [NEW]
apps/tournament-api/src/db/schema/index.ts                                     [MOD: 1 re-export added]
apps/tournament-api/src/db/migrations/0006_team_press_log.sql                  [NEW: drizzle-kit generated]
apps/tournament-api/src/db/migrations/meta/0006_snapshot.json                  [NEW: drizzle-kit generated]
apps/tournament-api/src/db/migrations/meta/_journal.json                       [MOD: 0006 entry appended]
apps/tournament-api/src/services/press-orchestrator.ts                         [NEW]
apps/tournament-api/src/services/press-orchestrator.test.ts                    [NEW]
apps/tournament-api/src/services/index.ts                                      [MOD: re-export runPressOrchestrator]
apps/tournament-api/src/routes/scores.ts                                       [MOD: insert step 5b + outer try/catch for BusinessRuleError(press_engine_error) → 422]
apps/tournament-api/src/routes/scores.integration.test.ts                      [MOD: 5 new test cases per AC-7]
```

10 files total — 4 NEW + 6 additive MOD. All paths under `apps/tournament-api/**`. Zero SHARED, zero FORBIDDEN.

The `scores.ts` modification is **mostly additive**: new step 5b (`runPressOrchestrator`) is inserted between step 5 (audit + activity) and step 6 (state transition). The ONE non-additive change is wrapping the existing `db.transaction` in an outer try/catch to map `BusinessRuleError('press_engine_error')` → 422 (per Section 6). Existing T5-6/T5-8 transaction body is UNCHANGED.

### 2. Architectural decision — extract orchestrator to `services/`

The press-evaluation logic is non-trivial:
- Detect hole-complete (all 4 foursome members have a row for hole N).
- Build `perHoleResults` from the round's committed scores via `compute2v2BestBall`.
- Load existing team-press log + individual-bet press log.
- Invoke `evaluatePresses` (T6-2) for team presses + `computeIndividualBet` (T6-3) for each applicable individual bet.
- Persist newlyFired rows with UNIQUE-violation catch.
- Emit activity for each fired press.

Putting this directly in `scores.ts` would balloon the route handler. v1 ships the orchestrator as `services/press-orchestrator.ts` with a single entry point `runPressOrchestrator(tx, ...)` invoked from inside the score-commit transaction. Tests run against the orchestrator directly via in-memory libsql; the route's integration tests verify end-to-end wiring.

This is consistent with T5-8's `services/round-state.ts` pattern (mutating service helpers are allowed when the mutation IS the domain semantic — the FSM transition or, here, the press fire log persistence).

### 3. Hole-complete detection — load-bearing rule (codex Critical #1 fix)

Per epic AC line 1847: "all 4 foursome members must have a committed row for hole N".

The check inside the orchestrator (correctly scoped to the ROUND'S event_round_id, not just any matching foursome_number):

```sql
-- Step (a): identify the 4 expected members of THIS round's foursome.
SELECT pairing_members.player_id
FROM pairing_members
INNER JOIN pairings ON pairings.id = pairing_members.pairing_id
INNER JOIN rounds ON rounds.event_round_id = pairings.event_round_id
WHERE rounds.id = :roundId
  AND pairings.foursome_number = :foursomeNumber
  AND pairings.tenant_id = :tenantId
  AND pairing_members.tenant_id = :tenantId
  AND rounds.tenant_id = :tenantId

-- Step (b): count distinct hole_scores rows for those 4 players for hole N.
SELECT count(*) AS scored_count
FROM hole_scores
WHERE round_id = :roundId
  AND hole_number = :holeNumber
  AND player_id IN (:expectedMembers)
  AND tenant_id = :tenantId
```

**Guard rails (codex High #2 fix):** if `expectedMembers.length !== 4`, the orchestrator emits a structured warning log and SKIPS press evaluation entirely. The compute2v2BestBall + evaluatePresses engines are 2v2-only (4 players, 2 teams of 2); a 3-player or 5-player foursome would either break the engine OR produce nonsense team assignments. v1 explicitly rejects non-4 foursomes from press evaluation (warning, not error — score commit still succeeds; the user just doesn't get a press log fired).

If `expectedMembers.length === 4` AND `scored_count < 4`: hole NOT complete; SKIP press evaluation; return early.
If `expectedMembers.length === 4` AND `scored_count === 4`: hole complete; PROCEED.

**Foursome derivation:** the orchestrator's caller (`scores.ts`) passes `foursomeNumber` derived from the SCORED PLAYER's pairing membership for this round. Edge case: a player not in any pairing for this round (shouldn't happen given T4-2 constraints) → orchestrator skips with warning log.

### 4. Activity event types — locked v1 contract (codex Med #3 fix)

T6-4 emits ONE activity per press fire: `'press.auto_fired'` (manual presses are out of scope per Section 7; manual fires are deferred to Followup T6-4d when T6-7's manual-press UI ships).

**Activity payload shape (locked):**
```ts
{
  type: 'press.auto_fired',
  actorPlayerId: scorerPlayerId,  // who committed the score that triggered the fire
  scope: { roundId, eventId },     // both populated for v1 events
  payload: {
    roundId: string,
    holeNumber: number,            // the hole-complete hole that triggered the fire
    team: 'teamA' | 'teamB',       // press's team (the down team that's pressing)
    startHole: number,             // press takes effect from this hole forward
    multiplier: number,            // integer; from press config at fire-time
    trigger: string,               // e.g., '2-down'
  }
}
```

**Payload field semantics:**
- `holeNumber` is the hole whose completion CAUSED the eval (i.e., the just-committed hole).
- `startHole` is where the press takes effect (typically `holeNumber + 1`).
- These can differ — separating them lets T8 banners show both "fired at hole 4 → effect from hole 5".

**No new AUDIT_EVENT_TYPES constants this story** — `team_press_log` is the canonical audit record; duplicating to audit_log is redundant. Followup T6-4c tracks adding audit redundancy if observability needs surface.

**v1 path footprint locked: 10 files (4 NEW + 6 additive MOD).** No audit-log.ts MOD.

### 5. UNIQUE-violation handling — log + skip, do NOT abort tx

Per epic AC line 1858: "On UNIQUE violation, catch + log + skip — do NOT abort the transaction (a duplicate fire is a 'should have been deduped upstream' warning, not an error)."

The orchestrator's INSERT into `team_press_log` / `individual_bet_presses` may UNIQUE-violate if:
- A racing concurrent score commit fires the same press first, AND
- The orchestrator's engine-side dedupe didn't see that fire (because both readers ran against the same snapshot).

This is a SQLite WAL snapshot-isolation residual — same class as T5-7/T5-8/T5-9. v1 acceptance: catch, log warning with correlation ids, continue. Followup T6-4b tracks if observed at scale.

### 6. Engine error handling — fail loud (rollback) — codex Med #4 fix

Per epic AC line 1870-1871: "When any press-engine call throws... the transaction rolls back; the score commit ALSO fails (422 press_eval_failed); scorer retries."

**Implementation requirement (codex Med #4):** scores.ts does NOT currently have a typed-error catch for `BusinessRuleError` (T5-9's score-corrections.ts has the pattern, but T5-6's scores.ts does not). T6-4 ADDS the catch:

```ts
// scores.ts route's tx wrapper (NEW outer try/catch around the existing tx)
try {
  return await db.transaction(async (tx) => {
    // existing T5-6 + T5-8 + T6-4 step 5b logic
  });
} catch (err) {
  if (err instanceof BusinessRuleError && err.code === 'press_engine_error') {
    return c.json(
      { error: 'unprocessable', code: 'press_engine_error', requestId },
      422,
    );
  }
  throw err;  // let other errors propagate to hono's default handler (500)
}
```

The orchestrator wraps internal engine calls in try/catch and rethrows as `BusinessRuleError('press_engine_error', message, 422)`. The scores.ts catch is targeted to JUST this code; other errors continue to propagate as 500.

**This is the ONLY non-additive change to scores.ts** — wrapping the existing `await db.transaction` in a try/catch. Risk-acceptable: the existing transaction body is unchanged.

### 7. Scope limit — TEAM presses only this story; individual bets STUB

The epic AC mentions BOTH team presses AND individual-bet presses. Implementing both fully in a single story doubles the integration-test surface and the orchestrator complexity. v1 architectural decision (load-bearing for the gate):

- **(A) Ship BOTH team + individual-bet press orchestration in T6-4.** Aligns with epic AC. Larger story; ~25 integration tests; more interaction points.
- **(B) Ship TEAM PRESSES ONLY in T6-4; defer individual-bet press orchestration to T6-4a.** Smaller, more focused story. T6-3's engine + persistence schema already exist; the orchestration layer is what's missing for individual bets. Followup is well-defined.

**v1 ships (B)** — team-press orchestration this story; individual-bet press wiring as Followup T6-4a (still in epic T6 scope, just split). Rationale: the scoring round is in progress (Pinehurst trip); individual bets are not yet exercised in the trip; team presses are the higher-leverage v1.5 feature (more universal). Splitting reduces blast radius.

### 8. Orchestrator boundary contract

```ts
type RunPressOrchestratorInput = {
  roundId: string;
  holeNumber: number;
  scorerPlayerId: string;       // who committed the score
  scoredPlayerId: string;       // whose score was just committed
  foursomeNumber: number;       // foursome the scoredPlayerId belongs to
  ruleSetConfig: { /* press config + 2v2 config; fetched by orchestrator */ };
};

async function runPressOrchestrator(
  tx: Tx,
  input: RunPressOrchestratorInput,
  tenantId: string,
): Promise<void>;  // throws BusinessRuleError on engine error
```

Returns void (side-effects: inserts into team_press_log + emits activity). The orchestrator OWNS the hole-complete detection internally — the route caller doesn't pre-check.

### 9. team_press_log schema

```sql
CREATE TABLE team_press_log (
  id              TEXT PRIMARY KEY,
  round_id        TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  team            TEXT NOT NULL CHECK (team IN ('teamA','teamB')),
  start_hole      INTEGER NOT NULL CHECK (start_hole BETWEEN 1 AND 18),
  trigger_type    TEXT NOT NULL CHECK (trigger_type IN ('manual','auto')),
  trigger         TEXT,                 -- e.g., '2-down' for auto; nullable for manual
  multiplier      INTEGER NOT NULL CHECK (multiplier >= 1),
  fired_at        INTEGER NOT NULL,     -- epoch ms
  fired_by_player_id TEXT REFERENCES players(id) ON DELETE RESTRICT,  -- nullable; null for auto
  tenant_id       TEXT NOT NULL DEFAULT 'guyan',
  context_id      TEXT NOT NULL,
  UNIQUE (round_id, team, start_hole, trigger_type)
);
```

Notes:
- Column name `start_hole` aligns with T6-2's `Press.startHole` (engine domain). Different from T6-3's `fired_at_hole` — the two domains diverge intentionally.
- `multiplier` INTEGER (matches T6-3 + integer-cents discipline; epic AC's REAL is overridden).
- `fired_by_player_id` is nullable for auto-presses (no user filed it). Manual presses populate with the filer's playerId.
- `trigger` is nullable for manual (no auto-trigger label).

### 10. Pure function guarantees (orchestrator)

The orchestrator has SIDE EFFECTS (DB writes + activity emit), so it's NOT pure. But:
- All writes go through `tx`; rollback unwinds them on error.
- No clock reads (uses `Date.now()` for `fired_at` ONLY at the boundary — acceptable side effect).
- Determinism: given identical input + identical tx state, side effects are identical.
- No env access, no I/O, no external API calls.

### 11. Test coverage scope

- **Orchestrator unit tests** (services/press-orchestrator.test.ts): in-memory libsql; verify hole-complete detection, engine invocation, persistence, idempotent dedupe.
- **Route integration tests** (scores.integration.test.ts MOD): 5 new cases per AC-7 — hole-not-complete (no press), hole-complete-no-trigger, hole-complete-with-trigger, idempotent replay, score correction post-hole-complete.

## Acceptance Criteria

(Derived from epics-phase1.md T6.4 lines 1834–1881.)

**AC-1 — `team_press_log` schema + migration generated.**
**Given** `apps/tournament-api/src/db/schema/press.ts`
**When** inspected
**Then** the file defines `teamPressLog` per Section 9. Migration `0006_team_press_log.sql` generated via `pnpm db:generate`. Schema barrel index re-exports `teamPressLog` + `TeamPressLog` type.

**AC-2 — Orchestrator entry point + signature.**
**Given** `apps/tournament-api/src/services/press-orchestrator.ts`
**When** inspected
**Then** it exports `runPressOrchestrator(tx, input, tenantId): Promise<void>` per Section 8. Imports: `compute2v2BestBall` (T6-1), `evaluatePresses` (T6-2), the engine type surfaces, schema tables. Re-exports from `services/index.ts`.

**AC-3 — Hole-complete detection.**
**Given** a score commit on (roundId, playerId, holeNumber)
**When** the orchestrator runs the hole-complete query
**Then** it counts distinct `player_id` rows in `hole_scores` for the (roundId, holeNumber) cell, joined to the pairing this player belongs to. If count < `pairing_members` count for the foursome → SKIP press eval (early return). Else → PROCEED.

**AC-4 — Press evaluation + persistence on hole-complete.**
**Given** the hole-complete condition is met AND the round's rule-set has `autoPressTriggerAtNDown` set
**When** the orchestrator runs press evaluation
**Then** it:
  (a) Reads round → eventRound → ruleSetRevision → press config (2v2 + auto-press).
  (b) Reads ALL committed hole_scores through the current hole for ALL 4 foursome members.
  (c) Reads existing `team_press_log` rows for this round.
  (d) Builds `compute2v2BestBall` input + invokes → `perHoleResults`.
  (e) Builds `evaluatePresses` input + invokes → `{ activePresses, newlyFired }`.
  (f) For each press in `newlyFired`: INSERT into `team_press_log`. UNIQUE catch → log warning + continue.
  (g) For each successfully-inserted press: `emitActivity(tx, { type: 'press.auto_fired' | 'press.manual_fired', actorPlayerId: scorerPlayerId, scope: { roundId, eventId }, payload: { roundId, holeNumber, team, startHole, multiplier, trigger } })`.

**AC-5 — Idempotent replay (T5-9 score-correction or commit-replay).**
**Given** a press has already been logged in `team_press_log`
**When** the orchestrator re-runs (e.g., on score correction or commit replay)
**Then** the engine's log-dedupe sees the existing press → `newlyFired` is empty → no INSERT → no activity emit.

**AC-6 — Engine error → rollback + 422.**
**Given** any engine call throws
**When** the orchestrator catches the throw
**Then** it rethrows `BusinessRuleError('press_engine_error', message, 422)`. The scores.ts route's existing tx-error path maps this to a 422 response and rolls back the score commit.

**AC-7 — Integration test extensions (5 new cases).**
**Given** `apps/tournament-api/src/routes/scores.integration.test.ts`
**When** extended
**Then** the following new cases pass:
  (a) **Hole not complete:** commit 3 of 4 scores for hole N → only `score.committed` activity (verify via spy); no `team_press_log` rows; no `press.*` activity.
  (b) **Hole complete, no trigger:** commit 4th score for hole N where match is close (no team is N-down) → `score.committed` activity; ZERO `team_press_log` rows; ZERO `press.*` activity.
  (c) **Hole complete, trigger fires:** commit 4th score for hole 4 where teamA is now 2-down → `score.committed` + exactly ONE `team_press_log` row (`team='teamA', start_hole=5, trigger_type='auto'`) + exactly ONE `press.auto_fired` activity.
  (d) **Idempotency on replay:** invoke score commit twice for same cell (same clientEventId) — replay path returns deduped — no duplicate press rows.
  (e) **Score correction after hole-complete:** initial commit triggers press; T5-9 correction on same hole that does NOT change the hole's net winner → re-eval produces no new press.

**AC-8 — `team_press_log.multiplier` is INTEGER (not REAL).**
**Given** the schema
**When** inspected
**Then** `multiplier` is `INTEGER NOT NULL CHECK(multiplier >= 1)`. Epic AC's REAL is overridden for integer-cents discipline consistency with T6-3.

**AC-9 — Individual-bet press wiring is OUT OF SCOPE.**
**Given** Section 7 v1 scope decision (Option B)
**When** T6-4 ships
**Then** individual-bet press orchestration is NOT wired. Followup T6-4a tracks. The score commit for a foursome with cross-foursome individual bets does NOT trigger any individual-bet press writes this story.

## Tasks / Subtasks

- [ ] **Task 1: Create `apps/tournament-api/src/db/schema/press.ts`.** `teamPressLog` table per Section 9 + ecosystemColumns + UNIQUE constraint.

- [ ] **Task 2: Re-export from `apps/tournament-api/src/db/schema/index.ts`.** Additive `teamPressLog` + `TeamPressLog`.

- [ ] **Task 3: Generate migration.** `pnpm --filter @tournament/api db:generate`. Rename to `0006_team_press_log.sql`. Update `meta/_journal.json` tag.

- [ ] **Task 4: Create `apps/tournament-api/src/services/press-orchestrator.ts`.** Pure orchestration logic:
  1. Hole-complete detection.
  2. Read round → eventRound → ruleSetRevision → config.
  3. Read hole_scores + foursome membership.
  4. Invoke compute2v2BestBall + evaluatePresses.
  5. INSERT newlyFired into team_press_log; UNIQUE catch → log warning.
  6. emitActivity per fired press.
  Engine error → throw BusinessRuleError('press_engine_error', ..., 422).

- [ ] **Task 5: Re-export from `services/index.ts`.** `runPressOrchestrator`.

- [ ] **Task 6: Wire orchestrator into `apps/tournament-api/src/routes/scores.ts`.** Insert step 5b BEFORE step 6 state transition; AFTER step 5 audit+activity. Pass scorerPlayerId, scoredPlayerId, derived foursomeNumber.

- [ ] **Task 7: Create `apps/tournament-api/src/services/press-orchestrator.test.ts`.** Unit tests covering hole-complete detection + engine invocation + persistence + UNIQUE catch.

- [ ] **Task 8: Extend `apps/tournament-api/src/routes/scores.integration.test.ts`.** 5 new test cases per AC-7.

- [ ] **Task 9: Regression test pass.** All workspace tests/typecheck/lint clean. Migration applies cleanly via existing test setup.

## Dev Notes

### Project Structure Notes

- **Orchestrator in `services/`**: matches T5-8's `services/round-state.ts` precedent. Mutating side-effect-bearing service module is acceptable when the mutation IS the domain semantic.
- **scores.ts MOD is additive**: existing transaction structure preserved; only step 5b is inserted. Risks regression of T5-6/T5-8/T5-9 logic if any state mutations bleed (none expected; orchestrator is gated on hole-complete).
- **No engine→services imports inside engine**: orchestrator imports engine functions; engine doesn't import orchestrator. Layering preserved.
- **Activity emission inside tx**: per existing T5-6 / T5-9 pattern. T8 will replace activity body; signature stable.

### Money discipline

- multiplier INTEGER everywhere (engine + DB).
- No money-cent values produced by THIS story (T6-4 is press LEDGER persistence; money composition lives in T6-5).

### References

- Epic spec: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` lines 1834–1881 (T6.4)
- T5-6 score-commit handler (modified): `apps/tournament-api/src/routes/scores.ts:287-547`
- T6-1 compute2v2BestBall (consumed): `apps/tournament-api/src/engine/formats/best-ball-2v2.ts`
- T6-2 evaluatePresses (consumed): `apps/tournament-api/src/engine/rules/press.ts`
- T5-9 score-correction precedent: `apps/tournament-api/src/routes/score-corrections.ts`

### Risks / Followups

- **Followup T6-4a: Individual-bet press orchestration.** v1 ships team-only (Section 7 Option B). T6-4a wires `computeIndividualBet` triggered presses into `individual_bet_presses` on score commit. Same orchestrator pattern.
- **Followup T6-4b: SQLite snapshot-isolation residual on press fires.** UNIQUE-violation log+continue handles the race; if observed at scale, escalate to BEGIN IMMEDIATE.
- **Followup T6-4c: PRESS audit_log redundancy.** v1 treats team_press_log as the canonical record. If forensic observability needs surface, add audit rows alongside press log writes.
- **Followup T6-4d: Manual-press route.** v1 ships AUTO press orchestration only. Manual-press filing UI (T6-7) requires a route that injects manualPresses into the next score commit's evaluatePresses call.
- **Risk: scores.ts complexity creep.** T6-4 inserts a new step into an already-busy transaction. Future T6 stories may add MORE steps. Followup T6-4e tracks extracting score-commit into a dedicated service if complexity exceeds threshold.

## Files this story will edit

- apps/tournament-api/src/db/schema/press.ts
- apps/tournament-api/src/db/schema/index.ts
- apps/tournament-api/src/db/migrations/0006_team_press_log.sql
- apps/tournament-api/src/db/migrations/meta/0006_snapshot.json
- apps/tournament-api/src/db/migrations/meta/_journal.json
- apps/tournament-api/src/services/press-orchestrator.ts
- apps/tournament-api/src/services/press-orchestrator.test.ts
- apps/tournament-api/src/services/index.ts
- apps/tournament-api/src/routes/scores.ts
- apps/tournament-api/src/routes/scores.integration.test.ts

10 files. Additional files MAY be added during implementation only under `apps/tournament-api/**` and MUST be appended to this list before commit.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (acting as tournament-director).

### Debug Log References

- Spec codex: 1 round (1C+1H+2M+1L all applied) + 1 rerun (2H both review-context drift, non-actionable).
- Impl codex: 2H+4M; H+2M applied (extendedCode UNIQUE coverage, rule-set determinism, tenant filters, hole order); 2M deferred (test rigor gaps documented).
- Impl codex rerun: 1H+2M; all applied (numeric extendedCode UNIQUE variant, distinctness Set defense-in-depth, team assignment comment alignment + Followup T6-4g).

### Completion Notes List

- 10 ALLOWED files (4 NEW + 6 additive MOD). Zero SHARED, zero FORBIDDEN.
- 13 new tests (8 orchestrator unit + 5 integration). tournament-api 717 → 730 (+13). Engine 472 + wolf-cup api 516 unaffected.
- Migration 0006_team_press_log generated cleanly via drizzle-kit.
- pnpm -r typecheck + lint clean.
- scores.ts modification minimal: 1 step 5b insertion + outer try/catch (existing T5-6/T5-8 tx body unchanged).
- Architectural decisions ratified at gate: orchestrator extracted to services/, TEAM PRESSES ONLY (T6-4a deferred), NO audit_log redundancy, INTEGER multiplier.
- Followup T6-4g added for slot-based team assignment when T6-7 manual-press UI lands.

### File List

- apps/tournament-api/src/db/schema/press.ts (NEW)
- apps/tournament-api/src/db/schema/index.ts (MOD: re-export teamPressLog)
- apps/tournament-api/src/db/migrations/0006_team_press_log.sql (NEW: drizzle-kit generated)
- apps/tournament-api/src/db/migrations/meta/0006_snapshot.json (NEW: drizzle-kit generated)
- apps/tournament-api/src/db/migrations/meta/_journal.json (MOD: 0006 entry appended; tag renamed)
- apps/tournament-api/src/services/press-orchestrator.ts (NEW)
- apps/tournament-api/src/services/press-orchestrator.test.ts (NEW)
- apps/tournament-api/src/services/index.ts (MOD: re-export runPressOrchestrator)
- apps/tournament-api/src/routes/scores.ts (MOD: insert step 5b + outer try/catch for press_engine_error → 422)
- apps/tournament-api/src/routes/scores.integration.test.ts (MOD: 5 T6-4 integration tests + beforeEach extension)
