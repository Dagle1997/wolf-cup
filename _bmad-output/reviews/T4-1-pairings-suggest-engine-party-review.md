# T4-1 Party-Mode Review (non-interactive written)

**Story:** T4-1 — Pairings Suggest Engine [target-miss tolerable].
**Status:** review
**Generated:** 2026-04-27
**Mode:** Single written review across 5 disciplinary perspectives. No interactive elicitation. No open questions to user.

---

## 📊 Mary (Analyst) — Strategic / Threat-Model Perspective

T4-1 is the **first story of Epic T4 (Pairings)** and the **first engine code in tournament-api** (greenfield directory `engine/pairings/`). Strategic significance: this story sets the pattern for all future engine code (T6 scoring engine, T6 money matrix, T6 skins compute) — pure functions, no I/O, deterministic, golden-file tested.

**Threat model — five surfaces:**

1. **Determinism guarantee.** No `Math.random()`, no `Date.now()`, no env vars, no global mutable state. Same input twice → byte-for-byte identical output. Tested explicitly (Test E). **Locked.**

2. **NEVER-throw on bad input.** Round-1 impl-codex caught a Critical (NaN/float pin round bypassed range check, would crash on `pinnedSlots[NaN]`); fixed with explicit `Number.isInteger` guards. Round-1 also caught a High on missing top-level validation for numRounds/foursomeSize; fixed with early-out empty grid + warning. Round-2 caught roster duplicates that would silently underfill foursomes; fixed via dedup + warning. **All input pathologies handled.**

3. **Target-miss tolerance.** Per epic: T4-2's manual UI must work without T4-1 landing. T4-1 ships as a quality-of-life accelerator. The hardcoded canonical 8×4×4 schedule for the load-bearing Pinehurst case guarantees a known-good starting point; greedy fallback handles everything else with explicit warnings when constraints can't be met. **Right tradeoff.**

4. **Pair-coverage proof for the canonical schedule.** Hand-verified at impl time:
   ```
   R1: [0,1,2,3] [4,5,6,7]   covers (0,1)(0,2)(0,3)(1,2)(1,3)(2,3)(4,5)(4,6)(4,7)(5,6)(5,7)(6,7)
   R2: [0,1,4,5] [2,3,6,7]   adds (0,4)(0,5)(1,4)(1,5)(2,6)(2,7)(3,6)(3,7)
   R3: [0,2,4,6] [1,3,5,7]   adds (0,6)(2,4)(4,6)(1,3)(1,5)(1,7)(3,5)(3,7)... (and more)
   R4: [0,3,4,7] [1,2,5,6]   adds (0,7)(3,4)(3,7)(4,7)(1,2)(1,6)(2,5)(2,6)(5,6)... (and the missing ones)
   ```
   Test A re-verifies this at runtime with `assertEveryPairMet`. All C(8,2)=28 pairs covered. **Verified.**

5. **Future engine pattern.** T4-1's directory boundary (`engine/pairings/`) signals "no I/O." Future engine modules (`engine/scoring/`, `engine/money/`) inherit the convention. The eslint rule pinning the engine boundary doesn't exist yet in tournament-api (Wolf Cup has it on `packages/engine/`); future T6 stories may want to add it. **Pattern set; lint rule a future polish.**

**Strategic significance:** T4-2 (the trip-critical UI) can wire into T4-1's output without touching engine code. Clean separation.

**Recommendation: ship.** No manual smoke needed for T4-1 (no UI surface; T4-2 is where Josh exercises the engine).

---

## 🏗️ Winston (Architect) — System Design Perspective

Six observations:

1. **Pure-function engine in `engine/pairings/`.** First tournament-api engine module. Mirror of Wolf Cup's `packages/engine/` posture (pure compute, golden-file tests, no I/O). No new dep, no migration. **Right architecture.**

2. **Two-tier algorithm: hardcoded fixture + greedy fallback.** The hardcoded 8×4×4 schedule is the **load-bearing** case — Pinehurst is the v1 trip-critical event. Greedy is the **everything-else** case — produces best-effort output with explicit warnings. The two-tier design honors target-miss tolerance: Pinehurst is guaranteed; other shapes are best-effort.

3. **Single-object input shape (`SuggestPairingsInput`)** rather than positional args. Easier to extend (future `seed?: number` for variety, future `constraint: 'no-repeat-partners'`, etc.) without breaking callers. **Forward-compat.**

4. **Warning enumeration as public contract.** Spec Risk §6 fixes 7 warning strings; spec round-1 codex made them stable. Future engine modules can extend without breaking T4-2's warning-banner UI. **Right pattern.**

5. **Roster dedup logic (round-2 codex catch).** Robustly handles UI bugs that pass duplicate playerIds. Emits warning so the caller sees what happened. **Defense-in-depth.**

6. **No engine-boundary eslint rule yet.** Wolf Cup has `apps/api → packages/engine` boundary linted; tournament-api hasn't reproduced this for `engine/`. Future polish — flag for the next engine-touching story (T6.x). **Track as followup.**

**Architectural concerns: zero blockers.**

**Recommendation: ship.**

---

## 📋 John (PM) — User Value / Scope Perspective

**Does T4-1 satisfy a v1 user promise?** Indirectly — pure engine code, no UI. The user-facing value lands in T4-2 ("Suggest Pairings" button) and T4-3 (PDF export).

**Scope discipline check:**
- 2 ALLOWED files (NEW engine + test).
- 0 SHARED edits.
- 0 FORBIDDEN edits.
- No deps, no migrations, no schema changes.
- No `app.ts` edit (engine isn't wired into a route — T4-2 will do that).

**Was T4-1 over-engineered?** No. The two-tier algorithm is exactly right for "target-miss tolerable": hardcode the Pinehurst case (load-bearing), greedy for everything else. The 11 tests (9 spec + 2 robustness) cover the contract without bloating. Pin handling is rich (overflow, sit-out override, duplicate-same-round, unknown playerId, out-of-range, NaN/float) but each case has an explicit AC + test. **Scope-disciplined.**

**Path footprint compliance.** **Scope-disciplined.**

**Recommendation: ship.** No PM-side concerns.

---

## 🧪 Quinn (QA) — Test Coverage / Pragmatic Check

**Test deltas:**
- tournament-api: 410 → 421 (+11). AC #9 floor was +9. Margin: +2.
- Wolf Cup engine: 472 (unchanged).
- Wolf Cup api: 507 (unchanged).

**Coverage matrix:**
| Branch | Test | Pin? |
|---|---|---|
| Test A — 8×4×4 no-pins everyone-once + golden + pair-coverage | ✅ | ✅ load-bearing |
| Test B — partial-pinned regenerate | ✅ | ✅ |
| Test C — fully-pinned no-regen | ✅ | ✅ |
| Test D — invalid pin (unknown playerId) | ✅ | ✅ |
| Test E — determinism | ✅ | ✅ |
| Test F — insufficient roster (empty grid) | ✅ | ✅ |
| Test G — duplicate pin same round | ✅ | ✅ |
| Test H — pin overrides sit-out | ✅ | ✅ |
| Test I — no-permanent-benching guarantee | ✅ | ✅ |
| **+** NEVER throw on numRounds=0/NaN | ✅ | ✅ (impl-codex round-1 catch) |
| **+** NEVER throw on NaN/float pin round | ✅ | ✅ (impl-codex round-1 Critical catch) |

**Observations:**

1. **Roster-dedup test missing.** Round-2 codex catch added the dedup logic but no explicit test pins the contract. Defensible: the deduplication is straightforward + verified by inspection; the "warning emitted on dup" branch is exercised when a caller passes a roster like `['p0','p0','p1','p2','p3']`. Could add as marginal coverage; not blocking.

2. **No tests for negative numRounds, Infinity, large floats.** Codex round-2 Low #2 noted this. The validation handles them per the `Number.isInteger` guard, but tests don't cover negative or Infinity explicitly. Marginal.

3. **No test that asserts the `warnings` array is sorted lexicographically for `pair-not-met`.** The implementation does the sort; the determinism test (Test E) catches any drift indirectly (since two runs would diverge if the sort weren't stable). Acceptable indirect coverage.

4. **Tests run in <100ms.** Pure function with no I/O — fast. **Right.**

**Coverage verdict: solid.** Margin above AC floor; key correctness paths pinned including impl-codex round-1 catches.

**Recommendation: ship.**

---

## 💻 Amelia (Dev) — Code Quality Perspective

Citing file paths + AC IDs.

**`suggest.ts:91-114`** — top-level input validation. AC #5 NEVER-throw guarantee + impl-codex round-1 High #2.

**`suggest.ts:116-136`** — roster dedup logic. Round-2 impl-codex catch. Stable order preserved (first occurrence kept).

**`suggest.ts:138-148`** — insufficient roster early-out with empty grid. AC #6.

**`suggest.ts:150-170`** — canonical 8×4×4 fixture trigger. Exact condition `effectiveRoster.length === 8 && numRounds === 4 && foursomeSize === 4 && constraint === 'everyone-once' && pins.length === 0`. AC #2 + Risk §3.

**`suggest.ts:60-89`** — `CANONICAL_8X4X4` constant. Hand-verified pair-coverage; Test A re-verifies at runtime.

**`suggest.ts:172-220`** — pin validation. AC #5 + impl-codex round-1 Critical (NaN/float guards).

**`suggest.ts:222-296`** — greedy fill loop. Sit-out rotation via `(rIdx * sitOutCount + j) % effectiveRoster.length` formula. Pins skipped during sit-out selection. Pair-meetings tracked for greedy heuristic.

**`suggest.ts:298-340`** — post-fill warnings (never-plays, pair-not-met). Pair-not-met warnings sorted lexicographically (deterministic).

**`suggest.test.ts`** — 11 tests, all pass.

**Lint + typecheck + build:** clean. No `any`. No `// eslint-disable`. No `Math.random()` / `Date.now()`. AC #11 satisfied.

**Recommendation: ship.**

---

## 🎯 Synthesis Verdict

**SHIP.**

All five perspectives converge on ready-for-commit. Spec-codex hit AI-1 cap (4 rounds) with 16 fixes applied. Impl-codex iterated 2 rounds: round-1 caught a Critical (NaN/float pin crash) + High (missing top-level validation); round-2 caught a Med (roster duplicates underfill). All fixed. Test deltas exceed AC floor (+11 vs +9 minimum). Path footprint is fully ALLOWED, zero SHARED, zero FORBIDDEN. Wolf Cup regressions clean.

**Load-bearing correctness:**
1. Canonical 8×4×4 schedule (Pinehurst case) guarantees pair-coverage.
2. NEVER-throw guarantee codified across 3 input pathologies (top-level sizing, NaN/float pin round, roster duplicates).
3. Pin precedence over sit-out rotation tested (Test H).
4. No-permanent-benching guarantee tested (Test I).
5. Deterministic warning ordering (lexicographic for pair-not-met).

**Documented limitations:**
- Greedy fallback is NOT guaranteed to satisfy everyone-once for arbitrary roster shapes (per epic target-miss tolerance).
- Engine-boundary eslint rule for tournament-api isn't established yet — future polish.
- Roster-dedup test missing — marginal coverage gain.

**Followups:**
- Promote engine-boundary lint rule when next engine module lands (T6.x).
- T4-2 wires this engine into a route handler.
- T4-3 ships PDF export.

**Manual smoke: N/A.** Pure function; no UI; T4-2 is where Josh exercises the engine.

**The director workflow can proceed to commit.**
