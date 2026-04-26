# Codex Review

- Generated: 2026-04-26T18:55:00.736Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T2-4-course-validator.md, apps/tournament-api/src/engine/validators/course.ts, apps/tournament-api/src/engine/validators/course.test.ts, _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

## Summary

Core validator logic largely matches the spec: signature + discriminated union, accumulation behavior, rule cardinalities (notably rule 4), bijection templates, and totals prerequisite-skip + sort-normalization are implemented as described. Biggest gap is in tests: the “5 seeded Pinehurst courses” happy-path cases do not actually use seed-equivalent holes/yardages/par data, so they don’t validate the real-world invariants this story is meant to protect (and they don’t meet AC #14’s requirement).

Overall risk: high

## Findings

1. [high] AC #14 not met: “seeded Pinehurst courses” tests do not use seed-equivalent holes/yardages; they use a generic synthetic holes array
   - File: apps/tournament-api/src/engine/validators/course.test.ts:395-460
   - Confidence: high
   - Why it matters: The story explicitly requires 5 happy-path tests constructed from the seeded Pinehurst courses’ tees + holes data (as JSON literals) to ensure the validator accepts the canonical real course structures. Current tests only reuse tee colors/ratings/slopes and then call build18Holes(teeColors), which generates identical pars, SIs, and constant yardages (400) for every course. This can’t catch regressions or mismatches present in real seed data (e.g., yardage key mismatches, unusual par distributions, etc.), and it violates the acceptance criteria as written.
   - Suggested fix: Replace each happy-path test’s `holes: build18Holes(teeColors)` with a literal `holes: [...]` matching `reference/pinehurst-may-2026-courses.json` for that course (numbers 1..18, pars, si, and per-tee yardages). Keep the tests pure by embedding the arrays directly (no fs reads). You can still use `buildCourse({ tees, holes, name, club_name })` so totals are computed from the literal holes.

2. [medium] Rule 11/12 silently skip holes with missing/non-object `yardages`, potentially marking malformed inputs as valid
   - File: apps/tournament-api/src/engine/validators/course.ts:159-200
   - Confidence: high
   - Why it matters: Both rule 11 and rule 12 do `if (!hole.yardages || typeof hole.yardages !== 'object') continue;` (course.ts:170-171 and 191-192). If runtime inputs can be malformed (admin form submission path is explicitly cited as a motivation for defensive checks), a hole with `yardages: null` or `yardages: undefined` can evade all yardage-related errors and still pass validation if other fields look OK. This contradicts the story’s intent of rejecting malformed course data beyond Zod shape checks.
   - Suggested fix: For rule 11, treat missing/non-object yardages as having zero keys (i.e., `yardageKeys = []`) so the first such hole triggers the set-mismatch error with `missing` equal to all declared colors. For example:
- Replace the `continue` with `const yardageKeys = hole.yardages && typeof hole.yardages === 'object' ? Object.keys(hole.yardages) : [];`
For rule 12, you can keep skipping (no entries to validate), but add a separate error if you want explicit shape enforcement (if aligned with spec). Add a unit test: a course with `holes[0].yardages = null as any` should fail rule 11 with the expected template.

3. [low] Rule 4 allows non-finite tee ratings (e.g., Infinity) to pass as “positive number”
   - File: apps/tournament-api/src/engine/validators/course.ts:69-88
   - Confidence: high
   - Why it matters: Rule 4 checks rating with `typeof tee.rating !== 'number' || !(tee.rating > 0)` (course.ts:75-77). `Infinity > 0` is true, so Infinity passes. If OCR/admin input produces non-finite values, the validator should probably reject them as malformed; otherwise downstream computations/UI may misbehave.
   - Suggested fix: Tighten rating validation to require finiteness: `typeof tee.rating !== 'number' || !Number.isFinite(tee.rating) || tee.rating <= 0`. Add a small unit test for `rating: Number.POSITIVE_INFINITY` expecting the rating error.

4. [low] Rule 11 message may display duplicate declared tee colors and doesn’t trim; mismatch computation differs from the literal “set of tee colors” wording
   - File: apps/tournament-api/src/engine/validators/course.ts:165-186
   - Confidence: medium
   - Why it matters: Rule 11’s display uses `declaredColors` (course.ts:165-168, 181) which can include duplicates and untrimmed whitespace (filter is `c.length > 0`, not `c.trim().length > 0`). While rule 10 separately reports duplicates, rule 11 is still allowed to run (no short-circuit) and could produce confusing messages like `declared tee colors [Blue, Blue]`. Also, using untrimmed colors can create hard-to-debug “missing/extra” outputs if inputs contain whitespace.
   - Suggested fix: Normalize declared colors for rule 11 with `const declaredColors = course.tees.map(t => typeof t.color === 'string' ? t.color.trim() : '').filter(c => c.length > 0);` and for message display, use the unique set you already computed: `const declaredList = [...declaredSet].sort();` so the displayed list matches the set semantics.

## Strengths

- `validateCourse(course: ParsedCourse): ValidationResult` matches AC #1: named export, correct discriminated union type, pure sync (no async/I/O/logging).
- Rule 4 cardinality is correctly implemented: a tee with both bad rating and bad slope yields two distinct errors (course.ts:75-87) and is covered by a unit test (course.test.ts:116-123).
- Bijection error template for rules 7/9 matches the pinned 3-slot format and always includes missing/duplicate/extra with brackets (course.ts:263-301).
- Totals prerequisite-skip is correctly gated on BOTH rule 5 and rule 7 passing (course.ts:204), and tests explicitly cover skipping when rule 5 fails and when rule 7 fails (course.test.ts:323-356).
- Sort-by-hole-number normalization for totals is correctly non-mutating (`[...course.holes].sort(...)`) and tested with a shuffled holes array (course.ts:206-209; course.test.ts:358-366).
- Discriminated union return is sound at runtime: `errors.length === 0` returns the empty-tuple variant; otherwise returns non-empty errors array (course.ts:247-251).

## Warnings

None.
