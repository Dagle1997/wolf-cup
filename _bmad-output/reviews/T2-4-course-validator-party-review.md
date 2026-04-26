# T2-4 Party-Mode Review (non-interactive written)

**Story:** T2-4 — course validator (pure synchronous function)
**Status:** review
**Generated:** 2026-04-26
**Mode:** Single written review across 5 disciplinary perspectives. No interactive elicitation. No open questions to user.

---

## 📊 Mary (Analyst) — Strategic / Threat-Model Perspective

T2-4 is the validator that closes the data-quality loop opened by T2-3 + T2-3a's smoke testing. The 3 specific issues observed in the May-2026 Pinehurst smoke run (Pinehurst No. 2 par-sum mismatch, Talamore CC yardage-key inconsistency, Tobacco Road `name="Player"`) all map to specific T2-4 rules: rules 14-16 catch the par-sum case, rule 11 catches the yardage-key case, rule 1 catches the empty/wrong name case (Tobacco Road's misattribution would still pass rule 1 since "Player" is non-empty — that one needs T2-5's human review, not T2-4's automated check).

**Threat model: zero attack surface.** T2-4 is a pure function with no I/O, no DB, no network, no env reads. The worst input it can receive is malformed object shape — which it handles gracefully via type guards. No DoS, no injection, no exfiltration. Could literally run client-side without security implications.

**Real-data validation:** the 5 happy-path tests use ACTUAL seed data from `reference/pinehurst-may-2026-courses.json` — Pine Needles' real par sequence (5,4,3,4,3,4,4,4,4,5,4,4,3,4,5,3,4,4 totaling 71), real SI assignments, real per-tee yardages across 5 tee configurations. The validator passes all 5, which empirically proves it doesn't false-positive on production data. The round-1 codex pushback that forced this real-data integration was the right call — generic-build tests would have shipped a validator that "looked right" without ever exercising real fixtures.

**Recommendation:** ship. Followup-story candidate: an "anomaly detector" that flags suspicious-but-not-invalid data (e.g., name="Player" passes rule 1 because it's non-empty, but should probably get a soft warning "this name looks like an architect's name, not a course"). That's a future ML-ish enhancement, not a v1 must-have.

---

## 🏗️ Winston (Architect) — System Design Perspective

The implementation is exemplary for a pure-logic story.

**Strong design choices:**
1. **Discriminated union as the contract** — `{ valid: true; errors: [] } | { valid: false; errors: [string, ...string[]] }`. TypeScript's narrowing makes consumer code provably correct: `if (result.valid) result.errors` is statically `[]`. Caller code can't accidentally treat valid-true as having errors.
2. **`checkBijection18` helper** is reusable, testable in isolation, and the 3-slot return format pins the §6 template at the helper level rather than leaking to every call site.
3. **`isPositiveInt` type guard** is a textbook narrowing helper. Trivially correct. Reusable from any future tournament-api validation work.
4. **Cross-rule prerequisite-skip** for rules 13-17 is implemented via two flag variables (`rule5Pass`, `rule7Pass`) checked at the gate. Clean — no nested if-else maze.
5. **Sort-by-number normalization** is local to the totals computation; doesn't mutate the input. Idiomatic functional pattern.

**Architectural concerns: zero. None.** The file is 240 lines including comments. Could it be split into rule-1.ts, rule-2.ts, ... 17 files? Sure. But that's premature decomposition. The single-file format keeps related rules visible together for cross-reference (e.g., the rule-13-17 prerequisite block is readable in one screen).

**One forward-looking note:** when T2-5 wires this into the admin save endpoint, the integration boundary is `if (validateCourse(course).valid) save()`. Simple. The discriminated-union shape lets T2-5 safely access `.errors` only when validation failed. T2-4 ships with a clean integration target.

**Recommendation:** ship.

---

## 📋 John (PM) — User Value / Scope Perspective

**Does this satisfy user-visible value?** Yes — but indirectly. T2-4 is invisible to organizers; they never see `validateCourse` output directly. T2-5 will surface the errors as user-facing UI messages when an organizer tries to save a course. T2-4 is the engine that powers that UI's "this row is wrong, fix it" feedback.

**Connection to product:** the 17 rules + their pinned error messages form a contract that T2-5's UI consumes. Each error string was deliberately engineered to be user-readable: `"Hole 4 par is 6; must be 3, 4, or 5"` not `"INVALID_PAR_AT_HOLE_4"`. That's product thinking baked into the validator, not punted to T2-5.

**Scope discipline: tight.** Pure function, zero SHARED, zero new deps, zero migrations. The story took 4 spec-codex rounds (mostly minor doc-quality fixes) + 2 impl-codex rounds + party + 1 commit. About as smooth as a story gets.

**One observation worth noting:** the spec was the longest part of the cycle. 17 rules × 2-3 spec-text iterations per rule = significant spec discussion. But the implementation went smoothly because the spec was thorough. **Cost upfront, savings downstream.**

**Concerns:**
1. Tests load fixtures from disk via `readFileSync`. Spec wording said "literals" — strict reading would have made me embed 5 × 18 = 90 holes of literal data. The compromise (load at module-load, document choice) is pragmatic but a deviation. **Acceptable** for v1; if the seed file ever moves, the tests break clearly with a path error rather than silently passing wrong data. Codex round-2 LOW flagged this as brittleness; we accepted the tradeoff.

**Recommendation:** ship.

---

## 🧪 Quinn (QA) — Test Coverage / Failure-Mode Perspective

**Coverage analysis (33 net new tests):**

| Section | Tests | Coverage |
|---|---|---|
| A: required-field sanity (rules 1-6) | 9 | Each of 6 rules has at least one rejection test; rule 4 has the dual-field-error case |
| B: hole-index invariants (rules 7-9) | 5 | Rule 7 has duplicate-and-extra cases; rule 8 has multi-hole-bad-pars (3 distinct errors); rule 9 has duplicate case |
| C: tee/yardage invariants (rules 10-12) | 6 | Includes rule 11 missing-yardages NEW test (round-2 fix coverage); rule 12 has both negative and non-integer cases |
| D+E: totals + prerequisites (rules 13-17) | 8 | Each totals rule + 2 prerequisite-skip tests + 1 sort-normalization test |
| Multi-error / no-short-circuit | 1 | Verifies 3 distinct errors come back when 3 distinct rules fail |
| Happy-path real-seed | 5 | All 5 Pinehurst courses validated via real seed JSON data |

**Failure modes well-covered:**
- ✅ Each rejection rule has at least one test
- ✅ No-short-circuit accumulation (the multi-error test catches if a future refactor adds early-return)
- ✅ Prerequisite-skip both ways (rule 5 fail; rule 7 fail) — tests assert NO totals errors emitted
- ✅ Sort-normalization (shuffled holes still produce correct totals)
- ✅ Real-data happy paths (5 courses)
- ✅ Round-2 rule-11 missing-yardages fix has dedicated coverage

**Failure modes NOT covered (acceptable Lows):**
- Rule 11 with EMPTY tees array — implementation guards with `course.tees.length > 0`, but no test exercises that branch. (Correctness is by inspection; if future refactor breaks the guard, the existing tests would still pass.)
- Rule 12 with NaN yardage — falls through `Number.isInteger(NaN)` returning false, so an error fires. Untested but correct.
- Pinehurst No. 2's par-sum divergence as it would appear PRE-seed-correction (i.e., totals=72, holes-sum=73). Test would fire rule 14/16 errors. Not exercised because the real seed JSON HAS the corrected data already.

**Recommendation:** ship. Three Lows above are followup-story polish — none warrant another impl iteration.

---

## 💻 Amelia (Dev) — Code Quality / Maintainability Perspective

Code reads cleanly. Five observations:

1. **Single discriminated cast at the return site** (`errors as [string, ...string[]]`) is justified by the runtime check `errors.length === 0` immediately above. TypeScript's narrowing doesn't carry the length-positive constraint to the literal-tuple type, so a cast is the canonical resolution. Comment line above could note "cast safe because length-check ensures non-empty" but it's standard enough that experienced readers will recognize the pattern.

2. **`for...of` with `break`** in rules 10 + 11 is intentional (one-error-per-call locator pattern). Readable. Alternative (`Array.prototype.find`) would work but is less obvious about the early-exit semantics.

3. **`Object.entries` iteration in rule 12** is order-stable in modern engines (insertion order for string keys). Tests that assert error messages depend on hole ordering — which is stable because rule 12 walks `course.holes` in array order, and within each hole iterates `Object.entries` in insertion order. If the test seed data ever introduces non-stable key orderings (different from how the parser emits), we'd see test flakiness. **Not a current bug; worth knowing.**

4. **`checkBijection18` helper** uses `Set<number>` for tracking. The implementation tolerates non-integer values by routing them to `extraSet` — a slightly unusual choice (could equally throw or use a separate "non-integer" slot in the error). Current behavior is documented inline and correct given the spec's "anything not in 1..18 is `extra`" framing.

5. **Loading seed JSON via `readFileSync` at module-load** is a test concern more than a code concern, but it's worth noting the path resolution logic uses `import.meta.url` + `dirname` + `resolve('../../../../../reference/...')`. That's 5 `..` segments — fragile if the directory layout changes. A future move of the reference file would silently break only this test (vitest would report file-not-found at module load). Mitigations: a path constant in a shared test-utils file when more tests need it.

**No `// eslint-disable`, no `as any`, no implicit any.** Type discipline intact throughout.

**Recommendation:** ship.

---

## Synthesis & Verdict

All 5 perspectives converge: **ship T2-4 as-is.**

**Cumulative non-blocking flags (none warrant re-iteration):**

| Source | Flag | Disposition |
|---|---|---|
| Analyst | "Anomaly detector" for soft-warnings (e.g., name="Player") | Future ML-ish story |
| Architect | None — story is architecturally clean | — |
| PM | Tests load seed JSON at module-load (deviates from "literals only" spec wording) | Acceptable per agreed compromise |
| QA | Rule 11 empty-tees branch untested (correct by inspection) | Followup polish |
| QA | NaN yardage handling untested (correct via Number.isInteger) | Followup polish |
| Dev | `Object.entries` order stability undocumented | Code comment in followup story |
| Dev | Module-load `readFileSync` path is fragile (5 `..` segments) | Refactor when 3rd test consumer arrives |

**No agent has open questions for the user. No proposed code changes warrant another impl iteration. Director may proceed to step 9 (codex-on-party-review).**
