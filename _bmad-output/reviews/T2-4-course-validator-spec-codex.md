# Codex Review

- Generated: 2026-04-26T18:30:27.631Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T2-4-course-validator.md

## Summary

The spec is close to implementable, but it contains a few concrete internal contradictions and several underspecified error-message / ordering details that will force round-trips during implementation—especially given the requirement to pin exact error strings and to “not short-circuit” while also relying on invariants (18 holes, bijective 1..18 numbering) for totals computation. These issues are fixable in-spec without expanding scope or touching forbidden paths.

Overall risk: medium

## Findings

1. [high] Contradiction: “no short-circuit” vs totals logic that assumes hole-number bijection + 18 holes
   - File: _bmad-output/implementation-artifacts/tournament/T2-4-course-validator.md:65-105
   - Confidence: high
   - Why it matters: The spec mandates collecting ALL errors and running “all 17 rules” without short-circuit (lines 65, 163-166), but also states sorting happens AFTER verifying hole numbers form a unique 1..18 set (line 104) and totals computation assumes holes are sorted and indexable into front/back 9 by position (lines 90-92). If rule #5 (holes length != 18) or rule #7 (hole numbers not a bijection) fails, rules #13–#16 as written can compute meaningless totals (or produce unstable results) and may even throw if an implementation indexes blindly. This is exactly the edge case you called out (duplicates like two “hole 4”), and the spec currently doesn’t resolve whether totals rules should run, skip, or compute in an alternative safe way.
   - Suggested fix: Make the dependency explicit: either (A) specify that rules #13–#16 are SKIPPED (produce no errors) unless rules #5 and #7 pass, while still honoring “no short-circuit” for other independent rules; or (B) redefine totals computation to be safe on invalid inputs (e.g., compute using `number` membership 1–9 and 10–18 and ignore duplicates/extras), and specify what happens when holes are missing/duplicated (likely still skip to avoid double-counting). Pin this behavior in AC #11 with an explicit example.

2. [high] Rule-to-error cardinality is internally inconsistent ("one error per rule" vs “one per offending hole”)
   - File: _bmad-output/implementation-artifacts/tournament/T2-4-course-validator.md:98-182
   - Confidence: high
   - Why it matters: Section §4 states “Each rule produces ZERO or ONE error string” (line 98). But AC #6 for rule 8 explicitly requires “ONE error per offending hole — multiple bad pars produce multiple error entries” (lines 179-182). This is a direct contradiction that will affect both implementation and the minimum test count expectations (“one per rule”). Similar ambiguity exists for yardage-key mismatch (rule 11) and yardage value validity (rule 12): are those one-per-hole, one-per-violation, or one aggregate error?
   - Suggested fix: Choose and document a consistent error aggregation policy per rule: e.g., rules 1–7,9–11,13–17 return at most one error each; rules 8 and 12 return one error per offending hole (and specify whether rule 11 is one-per-hole mismatch or a single aggregated mismatch). Update line 98 accordingly (e.g., “Most rules produce zero or one error; some produce one-per-hole”).

3. [medium] Error message formats are not fully pinned/deterministic (ordering, representation, and conflicting examples)
   - File: _bmad-output/implementation-artifacts/tournament/T2-4-course-validator.md:63-205
   - Confidence: high
   - Why it matters: The spec requires exact string assertions (lines 106-114), but several message formats are underspecified in ways that will cause test flakiness or implementation disagreement: (1) Rule 7/9 examples sometimes describe duplicates by value list (e.g., duplicate [4]) (lines 175-185) while earlier examples describe duplicates with hole locations (“Stroke index 7 appears twice (holes 4 and 11)”, line 63). (2) For set mismatch messages (holes/SI/yardage keys), ordering of lists is not specified (ascending? input order? lexicographic?), yet tests are expected to match exact strings. (3) Out-of-range/extras handling is required by the rule definition (lines 80-83) but not clearly included in the example format (lines 175-178, 183-186).
   - Suggested fix: In §6 (error message stability), explicitly define deterministic ordering for all bracketed lists (e.g., numeric ascending for hole/SI; lexicographic for tee colors/yardage keys) and explicitly include “extra/out-of-range” reporting in the message template (e.g., `missing [...], duplicate [...], extra [...]`). Also resolve the duplicate reporting format: either report duplicate values only, or report duplicate values plus which holes they appear on—then make examples and AC text match.

4. [medium] Totals rule definitions mix responsibilities and can double-report or under-specify which rule emits which error
   - File: _bmad-output/implementation-artifacts/tournament/T2-4-course-validator.md:89-97
   - Confidence: medium
   - Why it matters: In §4D, rule 15 includes both “computed course_total = sum of all 18 pars” and “out_total + in_total === course_total” (line 92), while rule 16 separately compares printed totals to computed (line 93). Then rule 17 separately checks printed internal consistency (line 96). This layering is plausible, but the spec also says “each rule produces zero or one error” (line 98), while AC #11 says “Three errors possible (one per total)” (lines 199-202). It’s unclear whether rule 15 is meant to produce an error at all (computed consistency failure is impossible if computed values are derived consistently unless the implementation computes them inconsistently), and how errors should be named if computed out+in!=course (which would only happen due to implementation bug).
   - Suggested fix: Clarify that rule 15 is an internal sanity check that should not produce an error (or remove it), OR define a specific error message if it does fail. More importantly, align numbering: either (A) treat rules 13/14/15 as computing values and rule 16 as emitting up to 3 printed-vs-computed errors, OR (B) make 13/14/15 each emit its own mismatch error (out/in/course) and reserve 16 for computed-consistency or remove 16. Pin exact messages for each totals mismatch case.

5. [low] Import path requirement may be over-constrained in the spec ("course-parser.js")
   - File: _bmad-output/implementation-artifacts/tournament/T2-4-course-validator.md:148-158
   - Confidence: medium
   - Why it matters: AC #1 hard-codes importing `ParsedCourse` from `'../../lib/course-parser.js'` (line 157). Whether the `.js` extension is correct depends on the tournament-api’s TS moduleResolution/ESM setup. If the repo convention is extensionless TS imports or a different relative path (e.g., `../../lib/course-parser`), this AC will force churn or cause typecheck/build failures. The spec elsewhere emphasizes “no round-trips,” so locking this down incorrectly is risky.
   - Suggested fix: Relax AC #1 to: “imports ParsedCourse from the existing course-parser module using the project’s standard import style,” or cite an existing file in `apps/tournament-api/src` that imports with `.js` to justify the requirement. If `.js` is required by the build, add a note that this matches current tournament-api ESM conventions.

6. [low] Happy-path test construction requirements are potentially ambiguous (seed-corrected totals) while forbidding reuse of seed logic
   - File: _bmad-output/implementation-artifacts/tournament/T2-4-course-validator.md:116-214
   - Confidence: medium
   - Why it matters: The spec requires 5 happy-path tests “constructed from the seed data” and discusses seed-correction behavior (lines 118-120, 211-214) while also requiring tests to be “JSON literals… NOT loaded from disk” (line 209) and stating T2-4 “does NOT alter seed.ts” (line 119). This can leave a dev unsure whether to (A) copy/paste the final corrected totals into literals, (B) recompute totals in-test, or (C) re-implement seed correction logic in-test to mirror seed.ts—each yields different maintenance overhead.
   - Suggested fix: Make the happy-path instruction explicit: recommend computing totals directly from the literal holes array inside the test helper (so the literals remain authoritative and self-consistent) OR explicitly state “copy the already-corrected totals values from seed output (not seed input).” Avoid requiring re-implementation of seed.ts logic in tests unless you intend to pin that behavior.

## Strengths

- Clear boundary/footprint constraints: validator-only, pure sync function, no route wiring (AC #19) and explicitly allowed path (`apps/tournament-api/src/engine/**`).
- Explicit contract for `ValidationResult` as a discriminated union and requirement that valid=true implies errors=[].
- Good alignment with observed production failure modes (par-sum mismatch, yardage-key mismatch, misattribution issues) and focuses on cross-field invariants beyond Zod shape validation.
- Test quantity expectations are concrete (≥25 net new) and include multi-error cases to enforce the non-short-circuit requirement.

## Warnings

None.
