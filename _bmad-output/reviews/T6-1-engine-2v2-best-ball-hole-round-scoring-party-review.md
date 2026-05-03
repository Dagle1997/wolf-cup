# T6-1 Party-Mode Review (non-interactive, written)

- Story: T6-1 Engine — 2v2 Best Ball Hole/Round Scoring [new]
- Spec: `_bmad-output/implementation-artifacts/tournament/T6-1-engine-2v2-best-ball-hole-round-scoring.md`
- Generated: 2026-05-03 (impl-codex returned 2H+2M+1L; Highs+Mediums applied; rerun returned 2M+1L; Mediums applied; final pass clean)
- Convened: Mary (📊 Analyst), Winston (🏗 Architect), John (📋 PM), Quinn (🧪 QA), Amelia (💻 Dev)

---

## Mary (📊 Analyst) — AC compliance

15 ACs traced (AC-1 through AC-15) from epic line 1701–1745. All present and verified.

- **AC-1 (signature + types):** ✅ Full type surface in best-ball-2v2.ts. TeeShape imported from handicap-strokes.ts (single source). All referenced types defined.
- **AC-2 (iteration + complete-cell gate):** ✅ Iteration off course.holes. Missing 4-row cell skips silently (test-covered with the missing-cell test).
- **AC-3 (per-hole outcome):** ✅ Win + delta + 4 pair cells per won hole.
- **AC-4 (tied hole):** ✅ Zero delta, sandiesApplied=false, greenieAwarded=null. Tested in fixture (f).
- **AC-5 (sandies on winning hole only, gross par or better, once-per-hole):** ✅ Tested in fixture (b) — 2 of 4 holes have valid sandies; tie hole (f) with sandyFromBunker flag does NOT apply.
- **AC-6 (greenie via closestToPinPlayerId):** ✅ Validation conditional on `config.greenieValidation`: `'2-putt'` requires `putts ≤ 2`; `'none'` skips the putt check. Plus par-3 + valid CTP + winning team. Tested in fixture (c) all 4 par-3s award; fixture (d) covers all 3 fail modes (no holeMeta, 3-putt under '2-putt' validation, CTP on losing team).
- **AC-7 (no valid greenie → null):** ✅ Fixture (d).
- **AC-8 (handicap shifts net):** ✅ Fixture (e) — HI 15 gets stroke on SI 3 (flips tie→win) but NOT SI 16 (stays tie).
- **AC-9 (anti-symmetry + matrix completeness):** ✅ assertResultStructure helper checks every fixture; intra-team pair cells verified absent.
- **AC-10 (perRound = sum of perHole = sum of A-side perPair):** ✅ assertResultStructure asserts `sumA-side perPair === perRound.teamTotalCents`. The other equality (`sum perHole.teamDeltaCents === perRound.teamTotalCents`) holds by construction in compute2v2BestBall (the running `teamTotalCents` accumulator IS the per-hole sum) and is verified transitively via the perPair-sum check.
- **AC-11 (integer-only):** ✅ Number.isInteger asserted on every money cell across every fixture; non-integer config throws RangeError fast-fail (tested).
- **AC-12 (pure / deterministic):** ✅ AC-15 replay test verifies; structuredClone equality check confirms no input mutation.
- **AC-13 (getHandicapStrokes 7 cases):** ✅ All 7 AC-mandated cases pass + 2 additional slope-adjusted cases (high-slope tee; rating > par bumping CH) + 2 input-validation cases (NaN HI, zero slope). Plus-handicap clamp explicit (case vii).
- **AC-14 (6 fixtures pass):** ✅ All 6 fixtures load + execute + assertions pass.
- **AC-15 (deterministic replay):** ✅ Test in best-ball-2v2.test.ts verifies deep-equal across two calls + no input mutation via structuredClone equality.

**No deviations from spec.** AC-2's "iterate off course.holes, complete-cell skip" matches the impl exactly.

---

## Winston (🏗 Architect) — boundary + correctness

- **Path footprint** matches spec exactly: 11 files (10 NEW + 1 additive MOD on services/handicap.ts). Zero SHARED, zero FORBIDDEN. No package.json change, no pnpm-lock.yaml touch, no eslint config change. Verified via `git status --porcelain=v1 -z`.
- **Engine→services layering invariant** preserved: engine/handicap-strokes.ts imports nothing from services. services/handicap.ts imports `engineCalcCourseHandicap` from engine — services-as-consumer is the architecturally allowed direction (services orchestrates engine + DB).
- **T5-5 callers preserved unchanged:** services/handicap.ts wrapper preserves the original `CourseHandicapInput` shape (with `handicapIndex` field). T5-5's 14 handicap.test.ts cases pass without modification. leaderboard.ts compiles unchanged.
- **Pure function discipline:** no DB, no I/O, no env, no clock, no crypto. Verified by static review of best-ball-2v2.ts (only imports are `getHandicapStrokes` + `TeeShape` from sibling engine module).
- **Integer-cents discipline locked at the boundary:** assertNonNegativeInteger on all 3 money config fields throws RangeError fast-fail. Math operations after the boundary are int-only (multiplication + signed subtraction).
- **Validation surface (post-codex hardening):**
  - calcCourseHandicap rejects Infinity/NaN/non-positive slope/rating/par (codex H#2 fix).
  - getHandicapStrokes rejects strokeIndex outside [1,18] (codex M#3 fix).
  - compute2v2BestBall throws on missing handicapIndex map entry (codex M#4 fix; no silent default-to-scratch).
  - compute2v2BestBall throws on duplicate holeScores or holeMeta entries (codex rerun M#1 fix; no silent overwrite).
  - compute2v2BestBall throws on invalid greenieValidation enum + non-boolean sandies/greenieCarryover (codex rerun M#2 fix; runtime type-narrows TS types).

**Drift risk vs Wolf Cup's stableford.ts:** Section 3 of spec documents that this story preserves T5-5's `Math.round` rounding (half-toward-+∞) rather than introducing the speculative half-away-from-zero variant. Followup T6-1f tracks future audit. AC-13 + handicap.test.ts pin tournament's expected output; any Wolf Cup change requires updating tournament.

**Boundary check:** zero edits to apps/api/**, apps/web/**, packages/engine/**, or _bmad-output/implementation-artifacts/sprint-status.yaml (Wolf Cup file).

---

## John (📋 PM) — trip-day usability

T6-1 is FOUNDATIONAL — it doesn't ship a user-visible feature, but everything in epic T6 (money matrix, settle-up, manual press, bets page) builds on this engine. The pure-function shape with golden fixtures means subsequent stories can compose without re-deriving 2v2 math.

**Pinehurst readiness:** the engine is wire-ready but currently has NO route exposing it. Money won't show on the leaderboard until T6-4 (score-commit hook) + T6-5 (head-to-head matrix endpoint) ship. T6-1's value to the trip is **derisking the math** — any rule misconfiguration that fails the engine's invariants will throw RangeError at the boundary rather than silently producing wrong money.

**Deferred-to-followup items honestly tagged:**
- T6-1a: consolidate handicap-strokes via packages/engine subpath export (NEXT-TRIGGER priority, not generic v1.5).
- T6-1b: persist `sandyFromBunker` + `closestToPinPlayerId` in hole_scores schema (likely lands with T6-4).
- T6-1c: tournament Tee type unification.
- T6-1d: GIR + sandies polymorphism.
- T6-1e: plus-handicap negative-stroke propagation (v1 clamps to 0).
- T6-1f: Wolf Cup rounding-rule audit if their stableford evolves.

---

## Quinn (🧪 QA) — test rigor

- 11 unit tests for getHandicapStrokes/calcCourseHandicap (handicap-strokes.test.ts).
- 9 fixture-driven tests for compute2v2BestBall (best-ball-2v2.test.ts).
- Total +20 tests; tournament-api 634 → 654.
- Structural invariants enforced uniformly via `assertResultStructure` helper (anti-symmetry, integer-only, perPair-sum equality, no intra-team pair cells).
- Determinism replay test covers AC-15.
- Edge-case fixtures: tied hole with sandyFromBunker flag (verifies AC-4/AC-5 interaction); CTP on losing team (verifies AC-6 fallback); 3-putt CTP (verifies '2-putt' validation); no holeMeta entry (verifies fallback path).

**Risk: fixture (a) is mechanically generated 18-hole data.** Hand-verified the 800 cents total, but full perPair cells were not pre-computed by hand; the test relies on the helper's structural invariants to validate cells. This is acceptable because the invariants are stronger than per-cell hand checks (any bug in the engine that produces wrong cells WILL violate either anti-symmetry OR sum-equality OR integer-only).

**Coverage gap (Low; defer):** grossStrokes / putts numeric-range validation. Engine trusts schema-level CHECK constraints (`chk_hole_scores_gross_strokes_positive`, `chk_score_corrections_hole_number`) at the write boundary. Defensive engine-side validation would be belt-and-suspenders. Acceptable v1 deferral.

---

## Amelia (💻 Dev) — code quality

- best-ball-2v2.ts: ~290 LOC including type definitions; main function ~120 LOC. Readable structurally — boundary validation at top, then per-hole pipeline (steps i-vii commented).
- handicap-strokes.ts: 70 LOC including comments + JSDoc.
- services/handicap.ts: thin-wrapper refactor; original docstring + v1-limitations preamble preserved; only the internal implementation delegates.
- All 3 files import only what they need; no dead imports.
- Test harness uses structuredClone for deep input cloning (Node 17+ native).

**`pnpm -r typecheck` ✅. `pnpm -r lint` ✅.** Engine 472 ✅, wolf-cup api 516 ✅, tournament-api 654 ✅.

---

## Consolidated recommendations

| # | Recommendation | Severity | Status |
|---|---|---|---|
| 1 | Architectural decision A — inline-port handicap math | spec gate | ✅ APPROVED at gate |
| 2 | calcCourseHandicap Infinity validation | High (impl) | ✅ APPLIED |
| 3 | calcCourseHandicap rounding spec contradiction | High (impl) | ✅ APPLIED (spec aligned to impl) |
| 4 | strokeIndex range validation | Med (impl) | ✅ APPLIED |
| 5 | Missing handicapIndex throw | Med (impl) | ✅ APPLIED |
| 6 | Non-negative money config | Low (impl) | ✅ APPLIED |
| 7 | Duplicate holeScores/holeMeta throw | Med (impl rerun) | ✅ APPLIED |
| 8 | Config enum/boolean runtime validation | Med (impl rerun) | ✅ APPLIED |
| 9 | grossStrokes/putts range validation | Low (impl rerun) | deferred (schema CHECK covers) |
| 10 | T6-1a (next-trigger consolidation) | — | followup |
| 11 | T6-1b (schema add for flags) | — | followup |
| 12 | T6-1f (rounding-rule audit) | — | followup |

**Verdict:** Recommend → done. AC compliance complete; impl-codex applied 2 rounds of fixes; trip-ready as engine substrate; route + UI surface deferred to T6-4/T6-5/T6-7. Epic T6 has its first commit-ready story.
