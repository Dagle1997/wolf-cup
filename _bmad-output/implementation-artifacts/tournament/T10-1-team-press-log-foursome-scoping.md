# T10-1: team_press_log Foursome Scoping (v1.5)

## Status

done

## Story

As Josh (organizer) and as the v1.5 codebase trying to re-enable presses for trip 2, I want `team_press_log` to be foursome-scoped — schema, UNIQUE constraint, both INSERT sites, the orchestrator's `existingPressLog` dedupe filter, the DELETE-undo lookup, and the raw-state export projection — so that a foursome-2 auto-press at `(teamA, hole 5, 2-down)` no longer collides with foursome-1's identical-shape press in the same round AND so that scorer A in foursome 1 cannot accidentally undo scorer B's manual press in foursome 2 once `TOURNAMENT_PRESSES_DISABLED` is flipped back to `false` in production.

The bug surfaced in the 2026-05-07 T1-T8 exit-review (`_bmad-output/reviews/T1-T8-final-exit-review-codex.md`, Pass 2 adversarial codex audit). It does not appear in CI because every existing integration test uses one foursome per round. Currently masked in production by the env-flag kill switch shipped in commit `52567df`.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. Path footprint — ALLOWED only, ZERO SHARED, ZERO FORBIDDEN expected

Every file in `## Files this story will edit` classifies into the tournament-director's ALLOWED bucket (`apps/tournament-api/**` and `_bmad-output/implementation-artifacts/tournament/**`, the latter covering the sprint-status flip). No root config, no `apps/api`/`apps/web`/`packages/engine` touches. No dependency changes (no `package.json`, no `pnpm-lock.yaml`).

### 2. Schema migration: ADD column + DROP/CREATE uniqueIndex

Migration `0012_team_press_log_foursome_scoping.sql` performs three statements:

1. `ALTER TABLE team_press_log ADD COLUMN foursome_number INTEGER NOT NULL DEFAULT 1;`
2. `DROP INDEX IF EXISTS uniq_team_press_log_dedupe;`
3. `CREATE UNIQUE INDEX uniq_team_press_log_dedupe ON team_press_log (round_id, foursome_number, team, start_hole, trigger_type);`

Each statement is separated by `--> statement-breakpoint` per the libsql multi-statement migration rule (drizzle-libsql will silently run only the first statement otherwise — confirmed lesson from 2026-05-01 mid-deploy bug at commit `4968bc0`). The `DEFAULT 1` makes the ADD safe against pre-existing rows: every Wolf-Cup-shape round (single foursome by definition) backfills to foursome 1, and any tournament-side rows that exist pre-migration (none are expected, since the kill switch was flipped immediately after `52567df`) also default to 1. The `DROP INDEX IF EXISTS` guard tolerates environments with drift (manually-altered DB, partially-applied prior migration, or a rename in a future migration we haven't anticipated) — without it, a missing index name would hard-fail the deploy.

The `NOT NULL` posture is intentional. Allowing nullable would require defensive handling at every INSERT call site and would silently degrade the new dedupe semantics; the column SHOULD be a hard part of every row's identity.

A new `meta/0012_snapshot.json` will be drizzle-generated; `meta/_journal.json` will gain a new entry. Both are committed.

### 3. Schema TypeScript: column + uniqueIndex rewrite

`apps/tournament-api/src/db/schema/press.ts` adds the column with the default explicitly encoded (so `drizzle-kit generate` round-trips cleanly and AC-2 stays satisfiable):

```ts
foursomeNumber: integer('foursome_number').notNull().default(1),
```

The `.default(1)` is retained long-term, not just as a one-time backfill aid — it keeps the TS schema source-of-truth aligned with the migration's `DEFAULT 1`, prevents `drizzle generate` from emitting a "drop default" noise diff in a future migration, and matches AC-1.

and rewrites the `fireDedupeUniq` definition to include it:

```ts
fireDedupeUniq: uniqueIndex(
  'uniq_team_press_log_dedupe',
).on(t.roundId, t.foursomeNumber, t.team, t.startHole, t.triggerType),
```

The existing CHECKs (`team_press_log_team`, `_trigger_type`, `_start_hole`, `_multiplier_positive`) are unchanged. The `TeamPressLog` inferred type picks up `foursomeNumber: number` automatically.

### 4. press-orchestrator INSERT + existingPressLog filter

`services/press-orchestrator.ts` already computes `foursomeNumber` for the scored player at step (1) (line 228 area: `myFoursomeRows[0]!.foursomeNumber`). Two further wiring changes:

- Step (12) — `existingPressLog` query — add `eq(teamPressLog.foursomeNumber, foursomeNumber)` to the WHERE clause. Without this, foursome 2's `evaluatePresses` call sees foursome 1's prior fires in its `existingPressLog` array and dedupes against them, suppressing foursome 2's auto-press emission.
- Step (14) — INSERT — include `foursomeNumber` in the `tx.insert(teamPressLog).values({...})` payload.

The kill-switch step (0) `pressesDisabled()` early-return and its doc comment about "v1.5 will add `foursome_number`" are updated: the comment's "until v1.5" prose becomes a "kill switch retained as emergency override" framing, and the body retains the early-return for operational safety. The env flag itself stays in `lib/env.ts` — this story does NOT delete the kill switch; it makes the kill switch's reason-for-existence go away. Operationally, the flag is flipped to `false` (or removed) on the VPS at deploy time; the code path stays so future incidents can re-engage it.

### 5. routes/presses.ts POST — derive foursomeNumber + INSERT

`computeMaxCompleteHole` at line 108 already computes `foursomeNumber` (line 126: `const foursomeNumber = assignmentRows[0]!.foursomeNumber;`) and discards it. Refactor `computeMaxCompleteHole` to return `{ maxComplete: number, foursomeNumber: number }` (NOT nullable) instead of a bare number. The POST handler at line 265 (`const maxComplete = await computeMaxCompleteHole(...)`) updates to destructure both; passes `foursomeNumber` to the INSERT at line 289–301.

**Why non-nullable:** the POST handler short-circuits at line 246–249 with `not_scorer_for_round` (403) BEFORE calling `computeMaxCompleteHole`, via the `isScorerForRound` check. That check passes only if a `scorerAssignments` row exists for this caller-round pair. `computeMaxCompleteHole` then re-queries `scorerAssignments` for the same caller-round and derives `foursomeNumber` from the assignment row. By construction, the assignment row exists when `computeMaxCompleteHole` runs — so the foursomeNumber is always derivable. The refactored function MUST throw a `BusinessRuleError('scorer_assignment_missing', ..., 422)` if the assignment row is absent at this point (defense-in-depth against a hypothetical race where `isScorerForRound` saw it but `computeMaxCompleteHole` does not — e.g., concurrent scorer-handoff deleting the assignment between the two queries). Returning `null` and letting the INSERT then hit the NOT NULL constraint is forbidden — it would translate a logic invariant into a DB-level error.

The INSERT-side UNIQUE-violation error mapping at line 302–311 (currently `press_already_filed_this_hole`) stays correct: with the new UNIQUE including `foursome_number`, the collision message "manual press already filed for {team} on hole {hole}" is still accurate from the caller's foursome-local point of view — they cannot, by construction, see a sibling-foursome's press at the same hole/team. No copy change needed.

### 6. routes/presses.ts DELETE — foursome ownership check (security-relevant)

The existing DELETE handler at line 354 looks up the press row by `(pressId, roundId, tenantId)` only (line 384–398). Once the kill switch is off, a scorer in foursome 1 with knowledge of (or a guess at) a press UUID from foursome 2 could DELETE foursome 2's manual press. The risk is low (UUIDs are unguessable and the v1 UI doesn't expose other foursomes' press IDs) but non-zero, and it's free to close while we're here.

Add the caller's `foursomeNumber` (already derived at line 420 from `scorerAssignments`) to the press-row lookup WHERE clause:

```ts
.where(
  and(
    eq(teamPressLog.id, pressId),
    eq(teamPressLog.roundId, roundId),
    eq(teamPressLog.foursomeNumber, foursomeNumber),
    eq(teamPressLog.tenantId, TENANT_ID),
  ),
)
```

This requires sequencing the foursome lookup BEFORE the press-row lookup (currently the press-row lookup runs first at line 384, then the assignment lookup at line 409). Move the assignment block ahead. If the caller has no scorer assignment for the round, the lookup short-circuits with `not_scorer_for_round` (already enforced upstream by `isScorerForRound` at line 378–381, so this is a defense-in-depth rearrangement, not a new failure mode).

### 7. services/export.ts — projection includes foursomeNumber

`services/export.ts:752-764` builds the `teamPressLog` array in the raw-state JSON export. Add `foursomeNumber: tp.foursomeNumber` to the projection so the v1.5 dump shape doesn't silently drop the new column.

**Export coverage is mandatory, not optional.** The export integration test (`routes/export.integration.test.ts`) MUST be extended this story so AC-6 is verified end-to-end. If the existing fixture does not already create a `team_press_log` row, the test setup is extended to insert one with `foursome_number = 2` (non-default value, to prove the projection propagates the stored value rather than defaulting). The assertion locates the row deterministically — by a known `(startHole, team, triggerType)` triple, or by inserting with a known `contextId` — using `body.teamPressLog.find(...)` rather than indexing by position, so the test is robust to fixture-order changes or additional rows. The assertion checks `foursomeNumber === 2` on the found row. This closes the codex-flagged risk of shipping an untested export shape change.

### 8. Multi-foursome regression tests — the gap CI never had

Two regression tests are mandatory. Both demonstrate the bug as it would manifest before the fix and verify it's gone after:

- `services/press-orchestrator.test.ts` — new test: two foursomes in the same round, both teamA goes 2-down at the same hole-N, both complete that hole. Assert both foursomes' `existingPressLog` queries return foursome-scoped results (foursome 1's call returns 0 sibling-foursome rows, foursome 2's call returns 0 sibling-foursome rows), and `evaluatePresses` therefore fires a separate `team_press_log` row for each foursome (assertion: COUNT(*) WHERE round = R = 2 with `foursome_number IN (1, 2)`).
- `routes/presses.integration.test.ts` — new test: two scorers, two foursomes, each files a manual press on the same hole/team via POST. Assert HTTP 200 for both; assert two rows in `team_press_log` with distinct `foursome_number` values; assert UNIQUE is not violated. Then a third test: scorer-1 (foursome 1) attempts DELETE against scorer-2 (foursome 2)'s `pressId` — assert `404 press_not_found` (the foursome-scoped WHERE filters it out).

These tests are the load-bearing regression evidence. CI being green pre-fix DOES NOT prove correctness here — it proves only that single-foursome scenarios still work.

### 9. Operational tail (OUT OF SCOPE for this commit, IN SCOPE for the story DoD)

After the commit lands and Josh pushes + deploys via `./deploy.sh`, the VPS `/opt/wolf-cup/.env` must have `TOURNAMENT_PRESSES_DISABLED=false` (or the line removed entirely; default-false is the `pressesDisabled()` semantics). This is documented in the story's followups section and explicitly NOT part of the commit. The story is "code-complete + tests-green"; the env flip + redeploy is a manual operator action.

### 10. What is NOT in this story

- The 4 other findings from the same exit review (TOCTOU on score-commit auth, manual-press foursome-selection nondeterminism, undo-press `expectedMembers` empty-edge-case, rule-set multiplier missing ORDER BY, `contextId` format inconsistency) are NOT addressed here. They are separate T10-N stories or remain as documented followups. Mixing them in would blow up the path footprint and dilute the codex review focus.
- No change to `services/money.ts`. The money matrix does not yet read `team_press_log` (line 11 of money.ts marks press-multiplier application as deferred Followup T6-5f). When T6-5f eventually ships, IT must filter by `foursome_number`; this story's schema change is the prerequisite, but T6-5f's reader is separately tracked.
- No change to `lib/env.ts` (the `pressesDisabled()` helper stays exactly as written; the env flag is retained as an operational override).

## Acceptance Criteria

**AC-1: Schema migration applies cleanly to a fresh DB and to an existing DB with pre-existing rows.**

**Given** a fresh database initialized from migrations 0000..0012
**When** the resulting `team_press_log` schema is inspected via `PRAGMA table_info('team_press_log')`
**Then** the column list includes `foursome_number INTEGER NOT NULL DEFAULT 1`
**And** the UNIQUE index `uniq_team_press_log_dedupe` lists columns in order `(round_id, foursome_number, team, start_hole, trigger_type)`

**Given** a database with pre-existing `team_press_log` rows from migrations 0000..0011 (synthetic for the test)
**When** migration 0012 runs
**Then** all pre-existing rows backfill to `foursome_number = 1` (the DEFAULT)
**And** no UNIQUE-violation error fires on the index rebuild (because pre-existing rows are foursome-1-only by construction)

**AC-2: Schema TypeScript shape matches the migration.**

**Given** `apps/tournament-api/src/db/schema/press.ts`
**When** TypeScript is compiled
**Then** the `teamPressLog.foursomeNumber` column exists with `notNull()`
**And** `fireDedupeUniq` includes `t.foursomeNumber` between `t.roundId` and `t.team`

**AC-3: press-orchestrator INSERTs and queries are foursome-scoped.**

**Given** the orchestrator processes a hole-complete event for foursome-N
**When** it loads `existingPressLog`
**Then** the SELECT WHERE clause filters by `teamPressLog.foursomeNumber = N` (in addition to `roundId` and `tenantId`)

**Given** the orchestrator fires a new press
**When** it INSERTs into `team_press_log`
**Then** the row includes `foursomeNumber = N` (the foursome of the scored player)

**AC-4: Manual press POST INSERT is foursome-scoped.**

**Given** a scorer in foursome-N files a manual press via `POST /:roundId/presses`
**When** the row lands in `team_press_log`
**Then** the row's `foursome_number = N`
**And** another scorer in foursome-M (M≠N) filing a manual press at the same hole/team for the same round succeeds with HTTP 200 (no UNIQUE collision)

**AC-5: Manual press DELETE is foursome-scoped.**

**Given** a manual press exists with `foursomeNumber = M`
**When** a scorer assigned to foursome-N (N≠M) attempts `DELETE /:roundId/presses/:pressId`
**Then** the response is `404 press_not_found`
**And** the press row is unchanged in `team_press_log`

**Given** the same press row
**When** the scorer assigned to foursome-M attempts `DELETE /:roundId/presses/:pressId`
**Then** the response is `200 ok` (subject to existing undo-window rules at line 440+)
**And** the press row is deleted

**AC-6: The raw-state export includes the new column.**

**Given** an event with at least one `team_press_log` row
**When** the organizer-only `/export` endpoint returns the JSON dump
**Then** every `teamPressLog[]` element includes a `foursomeNumber` field with the row's stored value

**AC-7: Multi-foursome auto-press regression test.**

**Given** a round with two foursomes (foursome 1: A, B, C, D; foursome 2: E, F, G, H), each running `compute2v2BestBall` such that teamA in each foursome is 2-down at hole 5 with all 4 players scored
**When** the orchestrator runs hole-complete for each foursome
**Then** two distinct rows exist in `team_press_log` for this round
**And** the rows have `foursome_number` values `1` and `2` respectively
**And** both rows share `(team='teamA', start_hole=5, trigger_type='auto')`
**And** the UNIQUE index is not violated

**AC-8: Pre-fix-failing assertion is now passing.**

The same multi-foursome scenario test, run against the pre-fix schema (without `foursome_number`), would fail at the second INSERT with `SQLITE_CONSTRAINT_UNIQUE`. The post-fix test verifies the contract is now distinguished.

**AC-9: No regression in single-foursome tests + named new tests pass.**

**Given** the existing single-foursome `press-orchestrator.test.ts` and `presses.integration.test.ts` suites
**When** the full regression set runs (`pnpm --filter @tournament/api test`)
**Then** every previously-passing test still passes
**And** the three new tests added by this story all pass:
  - `press-orchestrator.test.ts` — multi-foursome auto-press regression (AC-7)
  - `presses.integration.test.ts` — multi-foursome manual-press both-succeed (AC-4)
  - `presses.integration.test.ts` — cross-foursome DELETE returns 404 (AC-5)
**And** the export integration test asserts `foursomeNumber` on a non-default-foursome press row (AC-6)

**AC-10: Lint + typecheck remain clean.**

**Given** the implementation
**When** `pnpm -r typecheck` and `pnpm -r lint` run
**Then** both exit 0 with no new warnings or errors

## Tasks / Subtasks

1. **Schema and migration** (foundation)
   1.1. Add `foursomeNumber` column to `apps/tournament-api/src/db/schema/press.ts` (`integer('foursome_number').notNull()`).
   1.2. Rewrite `fireDedupeUniq` to include `t.foursomeNumber` between `t.roundId` and `t.team`.
   1.3. Run `pnpm --filter @tournament/api drizzle:generate` (or equivalent) to produce migration `0012_team_press_log_foursome_scoping.sql` and `meta/0012_snapshot.json`; update `meta/_journal.json`.
   1.4. Verify the generated SQL has `--> statement-breakpoint` between all three statements (ADD COLUMN, DROP INDEX, CREATE UNIQUE INDEX). If drizzle's generator combines them without breakpoints, hand-edit to insert breakpoints (libsql multi-statement gotcha, 2026-05-01 lesson).
   1.5. Verify the ADD COLUMN clause uses `DEFAULT 1` for the backfill.
   1.6. Verify (and hand-edit if necessary) that the DROP statement uses `IF EXISTS` for robustness against drift / partial state.

2. **press-orchestrator wiring**
   2.1. In `apps/tournament-api/src/services/press-orchestrator.ts`, locate step (12) — `existingPressLog` SELECT (around line 478–487). Add `eq(teamPressLog.foursomeNumber, foursomeNumber)` to the WHERE.
   2.2. In step (14) — INSERT (around line 525–537) — add `foursomeNumber` to the `.values({...})` payload.
   2.3. Update the doc comment at step (0) to reflect that the kill switch is now an operational override, not a schema-coverage placeholder.

3. **routes/presses.ts POST**
   3.1. Refactor `computeMaxCompleteHole` to return `{ maxComplete: number, foursomeNumber: number }` (NOT nullable; throw `BusinessRuleError('scorer_assignment_missing', ..., 422)` if the scorer-assignment lookup returns zero rows — see Risk Acceptance §5 for the defense-in-depth rationale).
   3.2. Update the POST handler's destructuring of `computeMaxCompleteHole` (around line 265).
   3.3. Add `foursomeNumber` to the manual-press INSERT (around line 289–301).

4. **routes/presses.ts DELETE**
   4.1. Reorder: move the `scorerAssignments` foursome-lookup block (currently line 409–423) BEFORE the `team_press_log` press-row lookup block (currently line 384–398).
   4.2. Add `eq(teamPressLog.foursomeNumber, foursomeNumber)` to the press-row lookup WHERE.

5. **services/export.ts + export integration test**
   5.1. Add `foursomeNumber: tp.foursomeNumber` to the `teamPressLog[]` projection at line 752–764.
   5.2. Extend `routes/export.integration.test.ts` so the fixture creates at least one `team_press_log` row with `foursome_number = 2` (non-default). The assertion locates the row deterministically (via `body.teamPressLog.find(p => p.startHole === N && p.team === 'teamA' && p.triggerType === 'manual')` or by known `contextId`/`id`), then asserts `foundRow.foursomeNumber === 2`. No positional indexing. Mandatory — closes AC-6's coverage gap.

6. **Tests — new (multi-foursome regression, the load-bearing assertions)**
   6.1. In `services/press-orchestrator.test.ts`, add a test that builds two foursomes (8 players, 2 pairings) in one round, scores both foursomes through hole 5 with teamA 2-down in each, invokes `runPressOrchestrator` for each foursome, and asserts two distinct `team_press_log` rows with different `foursome_number` values.
   6.2. In `routes/presses.integration.test.ts`, add a test that two scorers (one per foursome) file a manual press for the same hole/team via POST and both succeed.
   6.3. In the same file, add a test that scorer-foursome-1 attempts `DELETE` on a press created by scorer-foursome-2 and receives `404 press_not_found`.

7. **Tests — confirm no regression**
   7.1. Run `pnpm --filter @tournament/api test` and confirm AC-9's named tests all pass (multi-foursome auto-press regression, multi-foursome manual-press both-succeed, cross-foursome DELETE 404, export foursomeNumber assertion) AND every previously-passing single-foursome test still passes. Do not gate on raw pass-count deltas — name-based verification only.
   7.2. Run `pnpm --filter @tournament/web test`, `pnpm --filter @wolf-cup/engine test`, `pnpm --filter @wolf-cup/api test`, `pnpm -r typecheck`, `pnpm -r lint`.

## Dev Notes

### Architectural alignment

This story corrects a foursome-blind v1 UNIQUE constraint in `team_press_log`. The fix is mechanical (add a dimension to the dedupe key + thread it through all readers/writers). The architectural decision — that presses are per-foursome, not per-round — was implicit in the engine design (`compute2v2BestBall` operates on a single foursome's 4 players; multiple foursomes have independent press states) but was never reflected in the v1 schema because v1 integration tests didn't exercise multi-foursome rounds.

The fix preserves T6-4's existing posture:
- UNIQUE-violation catch + log + continue at the orchestrator stays (the WAL-snapshot residual race is real and unchanged).
- The engine `evaluatePresses` is unchanged — it sees the same shape of `existingPressLog`, just correctly filtered upstream.
- The kill-switch env flag stays — it's an operational tool for any future "press logic surprises us in prod" incident.

### Key references

- Exit-review report: `_bmad-output/reviews/T1-T8-final-exit-review-codex.md` (committed in `52567df`).
- Kill-switch commit: `52567df` (env flag + 4 tests).
- Originating story: `T6-4-score-commit-hook-hole-complete-press-evaluation.md` (the v1 schema with the foursome-blind UNIQUE).
- libsql multi-statement gotcha: 2026-05-01 mid-deploy bug, fixed in skins migration `0028`.

### Risk acceptance

- **Schema migration backfill safety.** DEFAULT 1 on the new NOT NULL column is correct because pre-existing rows are foursome-1-only by construction (Wolf Cup rounds are single-foursome; tournament rows pre-`52567df` are also single-foursome since CI only exercised single-foursome scenarios). Future-proofing: if the v1.5 codebase has tournament rows created post-`52567df`, those rows were created with the kill switch on — so there should be ZERO such rows. The DEFAULT-1 backfill is a no-op in any realistic v1.5-deploy database.
- **No data migration logic needed.** This is a schema-only migration. No `UPDATE` clause is required because the DEFAULT handles the backfill at column-add time.
- **Drizzle generator may not insert breakpoints.** Subtask 1.4 explicitly checks for this. Hand-edit is acceptable; subsequent migrations should follow the same review.

### Followups

- **Operational: flip `TOURNAMENT_PRESSES_DISABLED=false` on the VPS.** After the commit lands and Josh pushes + deploys, the VPS `/opt/wolf-cup/.env` line must be flipped (or removed). The default-false semantics of `pressesDisabled()` means deleting the line works equivalently. This is operator action, NOT part of the commit.
- **T6-5f (deferred): press multipliers in `services/money.ts`.** When the money matrix begins reading `team_press_log` to apply multipliers, IT must filter by `foursome_number` too. This story is the prerequisite (the column now exists); T6-5f remains separately tracked.
- **Followup HIGH (separate story): TOCTOU on score-commit auth.** `requireScorerForRound` middleware validates outside the score-commit transaction; a concurrent `scorer-handoff` could let a deposed scorer commit. Race window is single-request scope. Fix: re-validate inside the score-commit tx. Out of scope here.
- **Followup MED: undo-press `expectedMembers` empty-edge-case** in `presses.ts:405-436`. Out of scope here.
- **Followup MED: rule-set multiplier lookup lacks `ORDER BY revision`** in `presses.ts:173-200`. Concurrent rule edits could pick the wrong revision. Out of scope here.
- **Followup LOW: `team_press_log.contextId` format inconsistency** between auto-press (`event:X`) and manual press. Cosmetic; out of scope.
- **Party-clarification resolutions (2026-05-20):**
  - Q1 (export test row tuple collision risk) → **APPLIED**: shifted fixture row from `(startHole=7, team=teamA)` to `(startHole=18, team=teamB)` to reduce collision surface under the new foursome-scoped UNIQUE.
  - Q2 (pre-existing tournament-api flaky tests) → **OPENED T10-2** backlog story to triage `activity.eslint-rule.test.ts` timeout + `finalize-before-handoff` 500.
  - Q3 (single-foursome AUTO-press foursomeNumber=1 assertion) → **APPLIED**: added `expect(teamAPress!.foursomeNumber).toBe(1)` to the existing `'hole complete + 2-down trigger'` test for symmetry with the multi-foursome regression.

## Files this story will edit

- apps/tournament-api/src/db/schema/press.ts
- apps/tournament-api/src/db/migrations/0012_team_press_log_foursome_scoping.sql
- apps/tournament-api/src/db/migrations/meta/0012_snapshot.json
- apps/tournament-api/src/db/migrations/meta/_journal.json
- apps/tournament-api/src/services/press-orchestrator.ts
- apps/tournament-api/src/services/press-orchestrator.test.ts
- apps/tournament-api/src/routes/presses.ts
- apps/tournament-api/src/routes/presses.integration.test.ts
- apps/tournament-api/src/services/export.ts
- apps/tournament-api/src/routes/export.integration.test.ts
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

11 files. Additional files MAY be added during implementation only under `apps/tournament-api/**` and MUST be appended to this list before commit.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (acting as tournament-director).

### Debug Log References

(to be populated during dev-story + codex passes)

### Completion Notes List

(to be populated during dev-story)

### File List

(to be populated during dev-story)
