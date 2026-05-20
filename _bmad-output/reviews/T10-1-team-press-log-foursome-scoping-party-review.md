# Party-Mode Review — T10-1 team_press_log foursome scoping

**Story:** `_bmad-output/implementation-artifacts/tournament/T10-1-team-press-log-foursome-scoping.md`
**Mode:** Non-interactive written review (per tournament-director step 8)
**Date:** 2026-05-20
**Reviewed scope:** 9 modified + 5 new files (production + tests + migration + sprint-status flip)

---

## 📊 Mary (Analyst) — Does this solve the stated problem completely?

The original problem from the 2026-05-07 exit review was that `team_press_log`'s UNIQUE was foursome-blind: a second foursome's auto-press at the same `(team, start_hole, trigger_type)` either UNIQUE-collided on INSERT or cross-suppressed via the engine's `existingPressLog` dedupe. Both paths are now closed. The fix threads `foursome_number` through (a) the column set, (b) the UNIQUE constraint, (c) the orchestrator's existingPressLog WHERE, (d) the orchestrator's INSERT, (e) the manual POST INSERT, and (f) — bonus catch from spec authoring — the DELETE-undo lookup. The bonus catch is real value: pre-fix, a scorer with another foursome's pressId could DELETE that sibling press. Now the DELETE returns 404 `press_not_found` (which is also the correct security posture — don't leak existence). The export projection update preserves the new column in raw-state dumps. Followups for the unrelated exit-review findings (TOCTOU on score-commit, undo-press edge case, rule-set revision ORDER BY, contextId format) are documented in the story and explicitly out-of-scope, which is correct scoping. **Verdict: solved.**

## 🏗️ Winston (Architect) — Is the migration + schema layering sound; any architectural debt added?

Migration 0012 follows the libsql multi-statement breakpoint discipline (drizzle generator put breakpoints in correctly; I'd still verify on first deploy because the 0028 skins lesson on the wolf-cup side was costly). The `DROP INDEX IF EXISTS` guard is defensive against drift — minimal cost, real upside. The `DEFAULT 1` backfill is correct given the trip-1 kill switch was flipped immediately on 2026-05-07 (so no production tournament rows exist with non-1 foursome semantics; Wolf Cup rounds are single-foursome by definition). The TS schema's `.default(1)` mirrors the migration, preventing future drizzle-generate noise diffs — good hygiene. The `computeMaxCompleteHole` refactor from `Promise<number>` to `Promise<{maxComplete, foursomeNumber}>` is a small but appropriate API shape change for an internal helper. The defense-in-depth `BusinessRuleError('scorer_assignment_missing', 422)` is correct: throwing a domain error beats letting a NOT NULL constraint violation surface as a generic 500. The kill switch retention is appropriate operational discipline — the switch is now an emergency override rather than a schema-coverage workaround. **One latent concern (not a blocker):** the orchestrator's UNIQUE-violation catch + log-and-continue path (T6-4 Section 5) is now strictly less likely to fire because the dedupe is correctly scoped, but the catch should stay — it remains the last-line defense against WAL-snapshot residual races. **Verdict: sound; no new debt.**

## 📋 John (PM) — Does the scope match the v1.5 followup intent or did we over/under-deliver?

Scope matches. The story closes ONE of the 5 exit-review findings (the only one currently masked in production by an env flag), bundling a second HIGH-severity item (manual press foursome-selection nondeterminism) as subsumed-by-design, plus a security gap (cross-foursome undo) found during spec authoring that's load-bearing for re-enabling the feature. Not over-delivered: the spec explicitly defers the other 4 exit-review items (TOCTOU on score-commit, undo-press `expectedMembers` edge case, rule-set multiplier ORDER BY, contextId format) to separate followups. Not under-delivered: every code path that reads or writes `team_press_log` was audited (orchestrator, manual POST/DELETE, export.ts projection; money.ts confirmed not yet reading presses per the comment at line 11). The "operational tail" (flip `TOURNAMENT_PRESSES_DISABLED=false` on VPS post-deploy) is correctly punted to a documented operator step rather than shoved into the commit. **One open question to the user (would normally ask interactively):** the export integration test inserts a `(foursomeNumber=2, startHole=7, team=teamA, triggerType=manual)` row; if a future story adds an export fixture row at the same tuple, the test would UNIQUE-collide. Acceptable risk or worth a more obscure tuple now? **Verdict: scoped correctly.**

## 🧪 Quinn (QA) — Load-bearing regression quality; missing coverage; flakiness?

The three new tests are load-bearing and demonstrate the bug pre-fix would fail:
- `press-orchestrator.test.ts > multi-foursome scoping` — asserts foursome 2 fires its own teamA press at startHole=3 (pre-fix would cross-suppress or UNIQUE-collide). Strong assertion: `firstFoursomes === [1, 2]`.
- `presses.integration.test.ts > two scorers in different foursomes file same team/hole press` — asserts both POSTs return 200 with distinct foursomeNumber values. Pre-fix would 422 on the second POST.
- `presses.integration.test.ts > cross-foursome DELETE returns 404` — asserts security. Pre-fix would return 200 and delete the sibling press.
- `export.integration.test.ts > T10-1: teamPressLog projection includes foursomeNumber` — deterministic 5-column find().

**Flakiness observed in this story's CI runs (not introduced by T10-1):** two pre-existing tournament-api tests flaked intermittently — `activity.eslint-rule.test.ts` (5s timeout on the lintText call) and `finalize-before-handoff` (expected 422 got 500). Both passed on rerun. These are pre-existing local-CI parallelism artifacts and should be tracked separately (followup candidate: investigate and either stabilize or add `retry: 1` for those two tests specifically).

**Missing coverage to consider:**
- No test verifies the AUTO-press path INSERT includes foursomeNumber on a SINGLE foursome (only the multi-foursome scenario indirectly proves it). The pre-existing `'hole complete + 2-down trigger'` test now exercises the INSERT with the new column populated, but doesn't assert on `foursomeNumber === 1`. Low-risk gap; could add one line.
- No test for the `BusinessRuleError('scorer_assignment_missing', 422)` defense-in-depth path. By construction this is unreachable absent a scorer-handoff TOCTOU race; arguably untestable without contrived plumbing. Acceptable to leave uncovered.

**Verdict: regression coverage is strong; recommend one assertion addition + tracking the pre-existing flakes as a separate followup.**

## 💻 Amelia (Dev) — Code-level concerns; idiomatic; readable?

`apps/tournament-api/src/db/schema/press.ts:36`: `.default(1)` correctly mirrors the migration's `DEFAULT 1`. Doc comment updated to explain the dimension. Idiomatic.

`apps/tournament-api/src/services/press-orchestrator.ts:200`: kill-switch doc comment rewritten — clear that the switch is now operational override, not schema workaround.

`apps/tournament-api/src/services/press-orchestrator.ts:493`: `existingPressLog` SELECT now filters by `foursomeNumber`. Single-line addition, in the right scope.

`apps/tournament-api/src/services/press-orchestrator.ts:537`: INSERT includes `foursomeNumber`. Field order preserved relative to surrounding payload.

`apps/tournament-api/src/routes/presses.ts:108-178`: `computeMaxCompleteHole` refactor is clean. Return-type widening (`number` → `{maxComplete, foursomeNumber}`) with explicit non-null contract. The defense-in-depth throw at line 144 cites the TOCTOU concern in its message — future readers will understand why it exists. Two existing call sites destructure both fields correctly.

`apps/tournament-api/src/routes/presses.ts:412-460`: DELETE handler reordered + foursome-scoped. The reorder is annotated with rationale. The 404 vs 403 choice (404 covers both "doesn't exist" and "exists in sibling foursome") is documented inline — correct security posture.

`apps/tournament-api/src/services/export.ts:758`: `foursomeNumber` added to projection. One line.

Tests are well-scoped, with self-contained `seedMultiFoursome()` helpers that don't perturb the existing single-foursome fixtures. The `buildApp` global `__testPlayer` mutation pattern is honestly a known hazard (we discovered it mid-story when the legit-owner re-undo failed); the workaround (re-call `buildApp` to reassign before each request from a different scorer) is correctly annotated in the test.

**One Low codex flagged twice that I left intact intentionally:** the post-T10-1 comments still contain the phrase "foursome-blind UNIQUE" — but as HISTORICAL context explaining the kill switch's original reason, not as a current claim. Removing those references would lose useful context. Codex is treating "purge stale references" too literally.

**Verdict: code is idiomatic, well-commented, citation-friendly.**

---

## Open questions for the user (would consolidate into party-clarification gate if interactive)

1. **Export test row tuple collision risk** (PM perspective): the inserted `(foursomeNumber=2, startHole=7, team=teamA, triggerType=manual, contextId=event:eventId)` is unique today but could collide with a future fixture row at the same hole/team in foursome 2 of the same event. Worth shifting to a more obscure tuple (e.g., startHole=18) now, or accept-and-defer?
2. **Pre-existing flaky tests** (QA perspective): `activity.eslint-rule.test.ts` and `finalize-before-handoff` flaked once each across 3-4 runs in this story's tail. Open a separate followup story to investigate, or live with it?
3. **Single-foursome AUTO-press INSERT assertion** (QA): worth adding one explicit assertion to an existing single-foursome test (`expect(presses[0].foursomeNumber).toBe(1)`) or rely on the multi-foursome test's coverage of the same code path?

These are LOW-priority; none of them block GO.

---

## Summary verdict

**GO** — code-complete, regression-covered, security gap closed, no SHARED/FORBIDDEN path touches, all suites green on rerun.

**Main risks:**
1. Two pre-existing tournament-api tests flake intermittently (NOT caused by T10-1; tracked as followup).
2. Operational tail: flipping `TOURNAMENT_PRESSES_DISABLED=false` on VPS is a separate deploy-time action the operator must remember.
3. Codex flagged 2 LOW historical-comment items I left intact; future maintainers may re-flag them.
4. Pinehurst event isn't using presses for trip 1, so this fix is forward-looking — no immediate user impact until trip 2 setup.
5. Drizzle's migration generator put the DROP-INDEX BEFORE ALTER-ADD-COLUMN (rather than the spec's ADD→DROP→CREATE order). Either order is correct because DROP doesn't reference the new column; flagged here only so the audit trail shows the deviation is benign.
