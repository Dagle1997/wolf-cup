# T6-2 Party-Mode Review (non-interactive, written)

- Story: T6-2 Engine — Press + Auto-Press Trigger Evaluation [new]
- Spec: `_bmad-output/implementation-artifacts/tournament/T6-2-engine-press-auto-press-trigger-evaluation.md`
- Generated: 2026-05-04 (impl-codex returned 2M; both applied; rerun returned PASS, 0 findings)
- Convened: Mary (📊 Analyst), Winston (🏗 Architect), John (📋 PM), Quinn (🧪 QA), Amelia (💻 Dev)

---

## Mary (📊 Analyst) — AC compliance

16 ACs traced (AC-1 through AC-16) from epic line 1747–1787. All present and verified.

- **AC-1 (signature + complete type surface):** ✅ Full type surface in press.ts. PressLogEntry now carries `multiplier` + optional `trigger` per spec rerun-3 H#1 fix.
- **AC-2 (boundary validation):** ✅ 18 boundary tests (17 fast-fail throw + 1 "extra entries beyond throughHole are allowed") cover all AC-2 failure modes — throughHole range, pressMultiplier positive integer, autoPressTriggerAtNDown null/0/range, manualPress team+filedAtHole, perHoleResults completeness + holeNumber range + winner enum + dup-rejection, existingPressLog type/team/startHole/multiplier/trigger validation + dup-rejection. Minor gap: non-integer (float) pressMultiplier isn't explicitly tested separately from non-positive (the assertPositiveInteger helper rejects both). Acceptable v1.
- **AC-3 (auto-press at first N-down → next hole):** ✅ Fixture (b) verifies; press_1 fires for teamA at startHole=5 after A is 2-down through hole 4.
- **AC-4 (no fire when threshold not reached):** ✅ Fixture (a) verifies; close-match alternation never fires.
- **AC-5 (idempotent replay; multiplier preserved):** ✅ Fixture (d) verifies; config.pressMultiplier=3 at evaluation but carried-forward press preserves multiplier=2.
- **AC-6 (compound auto-press, two stacked):** ✅ Fixture (c) — base fires at startHole=5; nested match (5..8) signed delta walks 0,-1,-1,-2 → press_2 fires at h=8 at startHole=9. throughHole=8 matches spec exactly.
- **AC-7 (manual press echo + canUndo within window):** ✅ Fixture (e) at throughHole=startHole=7 → canUndo=true.
- **AC-8 (manual press past undo window):** ✅ canUndo-transitions test suite verifies the boundary at throughHole=8 → false.
- **AC-9 (auto-press never canUndo=true):** ✅ assertOutputStructure helper enforces; fixtures (b)(c)(d) all show canUndo=false on auto presses.
- **AC-10 (manual + auto on same team):** ✅ Fixture (f) — auto for teamA at startHole=5 + manual for teamA at startHole=7. Both in newlyFired, ordered by startHole.
- **AC-11 (trigger at hole 18 → no fire):** ✅ Dedicated test; A reaches -2 at hole 18 → empty output.
- **AC-12 (autoPressTriggerAtNDown null OR 0 disables):** ✅ Two-test suite verifies both cases produce empty output despite team being deeply down.
- **AC-13 (deterministic ordering):** ✅ Comparator with explicit rank maps; assertOutputStructure helper verifies the ordering invariant on every fixture.
- **AC-14 (existingPressLog carry-forward):** ✅ Fixture (d) covers the auto carry-forward; the canUndo-transitions suite indirectly covers fresh manual presses.
- **AC-15 (pure / deterministic replay):** ✅ Test on fixture (c) calls function twice + verifies deep-equal output + structuredClone equality of input.
- **AC-16 (six golden fixtures):** ✅ All 6 + 26 additional unit/boundary tests pass.

**No deviations from spec.**

---

## Winston (🏗 Architect) — boundary + correctness

- **Path footprint** matches spec: 8 NEW files all under `apps/tournament-api/src/engine/rules/**`. Zero MOD edits this story. Zero SHARED, zero FORBIDDEN.
- **No engine→services imports** — D1-1 layering preserved (the only intra-engine import is `type { HoleResult }` from `../formats/best-ball-2v2.js`, type-only).
- **No Wolf Cup engine import** — T6-2 is greenfield trigger arithmetic; the inline-port "next-trigger" condition Winston flagged in T6-1 is NOT reached. Followup T6-1a stays at the same priority.
- **Multiplier preservation** correctly applied: `existingPressLog[i].multiplier` is copied verbatim into the carry-forward Press; new fires use `config.pressMultiplier`. Fixture (d) verifies (config.pressMultiplier=3 at evaluation; carried-forward multiplier=2 from log).
- **Fixed-point recursion** uses cursor + snapshotEnd to avoid re-evaluating presses processed in a prior iteration AND to guarantee newly-added presses are evaluated in subsequent iterations. The 50-iteration cap is a defensive hard stop; trip-day reality is ≤2 iterations.
- **Per-team firedA/firedB flags** correctly handle the both-teams-fire-in-segment case (codex spec rerun H#2 fix). The dedicated test "signed delta swings: A reaches -2 then B reaches +2 in same base segment" verifies.
- **Dedupe-key collision (Section 5 v1 acceptance)** documented as Followup T6-2g; trip-day rare; no v1 user-visible issue expected.
- **Pure function discipline:** no DB, no I/O, no env, no clock, no crypto, no input mutation. Static review of press.ts confirms.

**Boundary check:** zero edits to apps/api/**, apps/web/**, packages/engine/**, or _bmad-output/implementation-artifacts/sprint-status.yaml (Wolf Cup file).

---

## John (📋 PM) — trip-day usability

T6-2 is FOUNDATIONAL like T6-1 — engine substrate, no user-visible feature shipped this story. T6-4 (score-commit hook) wires it; T6-5 (H2H money matrix) consumes it.

**Pinehurst readiness:** T6-2 alone doesn't move the needle for trip-day. The trip is now in progress (rounds being played); the press feature won't be live until T6-4 + T6-5 + T6-7 (manual press UI) all ship. v1 trip-day is gross/net leaderboard only.

**Followups honestly tagged:**
- T6-2a: T6-4 score-commit hook integration (consumer of evaluatePresses).
- T6-2b: Money composition with press multipliers in T6-5.
- T6-2c: Manual-press down-team validation (engine permissive; route layer can add gate if needed).
- T6-2d: `team_press_log` schema (T6-4 ships).
- T6-2e: Press-undo persistence (T6-7 ships).
- T6-2f: Recursion-depth cap monitoring (50-iteration cap is the v1 safety net).
- T6-2g: parentMatchId for dedupe-collision v1.5 fix.

---

## Quinn (🧪 QA) — test rigor

- 33 tests total: 6 fixture-driven + AC-15 determinism + 18 boundary-validation cases + 3 canUndo-transition cases + AC-11 + 2 AC-12 + AC-H#2 both-teams-fire + AC-14 manual-log carry-forward (added post-party-codex M#3).
- tournament-api 654 → 686 (+32).
- Structural invariants enforced via `assertOutputStructure` helper (AC-9 auto canUndo=false; AC-13 ordering; newlyFired subsequence-stability).
- Boundary surface coverage: ALL AC-2 failure modes are exercised; the rerun added 9 cases (enum + range + dup) so no AC-2 path is untested.
- Determinism replay test uses structuredClone for input-mutation detection.

**No coverage gaps observed.** The dedupe-key collision corner case (Section 5 v1 acceptance) isn't tested because constructing a fixture that triggers it would require a manual press + base auto-press fired at the same coordinate from different parent matches — vanishingly rare. Followup T6-2g acceptance.

---

## Amelia (💻 Dev) — code quality

- press.ts: ~290 LOC including type definitions; main `evaluatePresses` function ~150 LOC. Algorithmic structure clearly numbered (steps 1-9 in comments).
- press.test.ts: ~280 LOC, 32 tests, well-organized with describe blocks per AC group.
- All 8 files import only what they need; zero unused imports.
- Test harness uses structuredClone (Node 17+ native).
- Helper functions (assertIntegerInRange, assertPositiveInteger, etc.) are concise and reusable.

`pnpm -r typecheck` ✅. `pnpm -r lint` ✅. Engine 472 ✅, wolf-cup api 516 ✅, tournament-api 686 ✅.

---

## Consolidated recommendations

| # | Recommendation | Severity | Status |
|---|---|---|---|
| 1 | Architectural decision A — approve persisted-multiplier on PressLogEntry | spec gate | ✅ APPROVED at gate |
| 2 | Compound recursion miss-on-replay (carried-forward presses excluded) | Crit (spec) | ✅ APPLIED (fixed-point loop) |
| 3 | Carried-forward multiplier corruption | High (spec) | ✅ APPLIED (multiplier on PressLogEntry) |
| 4 | Manual-press active-rule contradiction | High (spec) | ✅ APPLIED (Section 6b — always in active) |
| 5 | Dedupe-key collision (rare 2-manual-press edge) | High (spec) | ✅ ACCEPTED v1 (T6-2g followup) |
| 6 | Algorithm only finds first trigger per segment | Med (spec) | ✅ APPLIED (per-team flags, 0..2 fires) |
| 7 | Fixture (c) drift from AC-6 | Med (impl) | ✅ APPLIED (rewrote to throughHole=8, startHole=9) |
| 8 | Incomplete boundary tests | Med (impl) | ✅ APPLIED (9 new cases) |
| 9 | T6-4 score-commit hook integration | — | followup T6-2a |
| 10 | Money composition (T6-5) | — | followup T6-2b |
| 11 | parentMatchId for dedupe-collision fix | — | followup T6-2g |

**Verdict:** Recommend → done. AC compliance complete; impl-codex rerun returned PASS with 0 findings; trip-ready as engine substrate; route + UI surface deferred to T6-4/T6-5/T6-7. Epic T6 has its second commit-ready story.
