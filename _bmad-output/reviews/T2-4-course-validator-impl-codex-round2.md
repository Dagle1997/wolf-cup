# Codex Review

- Generated: 2026-04-26T18:58:55.753Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/validators/course.ts, apps/tournament-api/src/engine/validators/course.test.ts, _bmad-output/reviews/T2-4-course-validator-impl-codex.md

## Summary

Round-1 fixes appear correctly applied in validator logic (rule 4 finiteness check; rule 11 no longer silently skips missing yardages). The new seeded-course happy-path test does exercise real course data, but it introduces two correctness/coverage concerns: (1) the specific round-1 MED fix (missing/null yardages) is not actually covered by a unit test, and (2) the seed-fixture loader filters yardage keys, which can mask real mismatches between the reference JSON and the validator’s “exact key match” contract.

Re-review focus answers:
1) Seed JSON loaded at module-load: this satisfies AC #14’s *spirit* (real data), but it does deviate from strict “no disk load / literals only” wording (if that wording is enforced). It also makes tests dependent on repo file layout.
2) Rule 11 fix mental walkthrough: yes. If hole 3 has `yardages: null/undefined`, `hasObjectYardages` becomes false, `yardageKeys=[]`, `missing` becomes all declared tee colors, and rule 11 emits the mismatch error for that hole (and stops at first mismatch).
3) Vitest pool workers: reading a JSON file at module-load is generally safe for isolation (each worker has its own module graph; no mutation here). The main risk is brittleness: missing file / different working tree / running tests from built output where the relative path no longer points to `reference/…`.

Verdict: NEEDS-CHANGES (add missing-yardages test coverage; reconsider/guard the seed-yardage filtering so the “real-data” test can’t accidentally hide real mismatches).

Overall risk: medium

## Findings

1. [medium] Round-1 MED fix (rule 11 missing/null yardages) is not covered by a unit test
   - File: apps/tournament-api/src/engine/validators/course.test.ts:263-320
   - Confidence: high
   - Why it matters: The code change in rule 11 is intended to prevent a silent pass when `hole.yardages` is null/undefined/non-object. Current tests cover (a) missing a tee key inside an object and (b) extra keys, but do not cover the actual bug class (yardages missing entirely). Without a regression test, the exact bug that motivated the patch could reappear unnoticed.
   - Suggested fix: Add a rule-11 test like: build a course with two tees, set `holes[2]!.yardages = undefined as any` (or `null as any`), then assert `validateCourse` is invalid and includes `Hole 3 yardage keys [] don't match declared tee colors [...] : missing [...]` (exact expected string).

2. [medium] Happy-path seed fixtures filter yardage keys, potentially masking real mismatches between reference data and validator contract
   - File: apps/tournament-api/src/engine/validators/course.test.ts:47-57
   - Confidence: high
   - Why it matters: The stated goal is to validate the validator against real seeded course data. However, the loader transforms the fixture by dropping any yardage keys not in the declared tees. If the reference JSON (or parser output) ever includes extra/mismatched keys, this test will still pass—reducing its ability to catch real-world regressions in rule 11 (exact set match). This is especially relevant because rule 11 is explicitly strict about exact equality of key sets.
   - Suggested fix: Prefer loading the seed JSON “as-is” and let the validator enforce the contract. If you must transform, add an assertion that no keys were dropped (e.g., compare original key sets vs filtered key sets and fail the test if any were removed), or explicitly document/encode the expected normalization step with its own tests (so drift is detectable).

3. [low] Module-load `readFileSync` introduces environment/layout brittleness (even if worker-isolated)
   - File: apps/tournament-api/src/engine/validators/course.test.ts:28-73
   - Confidence: medium
   - Why it matters: Each Vitest worker will synchronously read and parse the JSON at import time. This is usually fine for isolation, but it makes the unit tests depend on the presence of `reference/pinehurst-may-2026-courses.json` at a specific relative path. Running tests from transpiled output or in environments that don’t include `reference/` can fail before any tests execute (harder diagnosis).
   - Suggested fix: If strict “literals only” is not required, consider importing JSON via tooling-supported JSON import (so paths are managed), or read in a `beforeAll` with a clearer failure message. If strict wording is required, inline the 5 course literals (or generate a TS fixture file checked into the repo).

## Strengths

- Rule 11 change in `validateCourse` now treats missing/non-object yardages as `[]` keys, so missing tee-yardage keys are surfaced instead of silently skipped (apps/tournament-api/src/engine/validators/course.ts:173-191).
- Rule 4 rating validation correctly rejects non-finite values via `Number.isFinite` (apps/tournament-api/src/engine/validators/course.ts:75-77).
- Totals prerequisite gating remains correct (rules 13–17 only run when both rule 5 and rule 7 pass), avoiding meaningless totals errors on malformed holes (apps/tournament-api/src/engine/validators/course.ts:219-258) and is covered by tests.
- Seeded-course happy-path now iterates all 5 real course names and validates full ParsedCourse fixtures (apps/tournament-api/src/engine/validators/course.test.ts:459-471).

## Warnings

None.
