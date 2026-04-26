# Codex Review

- Generated: 2026-04-26T18:33:59.563Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T2-4-course-validator.md, _bmad-output/reviews/T2-4-course-validator-spec-codex.md

## Summary

Most round-1 fixes are present and materially reduce ambiguity (explicit prerequisites for totals rules; explicit per-rule error cardinality; pinned deterministic ordering + templates; totals responsibilities split into compute vs compare vs printed-consistency). However, a few remaining internal contradictions/underspecifications still risk implementation/test churn—primarily around error-message pinning (examples/ACs not matching §6 templates) and how “at most one error” rules behave when multiple items can fail (notably rule 11).

Overall risk: medium

## Findings

1. [medium] Error-message formats are still internally inconsistent: §6 pins templates/order, but earlier examples + AC examples don’t match (extra-slot, ordering, and alternate SI wording)
   - File: _bmad-output/implementation-artifacts/tournament/T2-4-course-validator.md:63-231
   - Confidence: high
   - Why it matters: You explicitly require exact-string assertions, so any mismatch between pinned templates and AC/examples will cause either (a) failing tests, or (b) devs “choosing one,” silently diverging from the spec. Concrete mismatches in the current text:
- Line 63 gives an SI error example "Stroke index 7 appears twice (holes 4 and 11)", but §6 pins the set-mismatch template "Stroke indexes do not form 1..18: missing [...], duplicate [...], extra [...]" (lines 118–127).
- §6 requires always including missing/duplicate/extra slots for rules 7/9 (lines 118–126), but AC #5 and AC #7 examples omit the `extra [...]` slot (lines 211–222).
- AC #9 yardage-keys example shows non-lex ordering ([Blue, Red, Gold]) and differs from §6’s lexicographic ordering requirement and example (lines 114–117, 127–128, 227–230).
   - Suggested fix: Make AC examples match §6 exactly (include `extra []` when empty; use lexicographic ordering; remove/replace the legacy SI example on line 63). If you want the “appears twice (holes …)” style, update §6 templates to match instead—pick one format and use it everywhere.

2. [medium] Rule 11 cardinality/aggregation is underspecified vs the “AT MOST ONE error per call” policy
   - File: _bmad-output/implementation-artifacts/tournament/T2-4-course-validator.md:84-101
   - Confidence: high
   - Why it matters: Rule 11 is defined as “For every hole, yardage keys set equals tee colors” (lines 84–87), which can naturally fail on multiple holes. But the error-cardinality policy says rule 11 produces AT MOST ONE error per call (line 99). The pinned message examples in §6 and AC #9 are single-hole shaped ("Hole 4 yardage keys …") rather than an aggregated multi-hole report, so it’s unclear what to do when holes 4 and 7 both mismatch. This is the kind of ambiguity that will leak into test expectations and UI behavior.
   - Suggested fix: Explicitly define rule 11’s aggregation strategy consistent with “≤1 error per call”, e.g.:
- either: "report the first offending hole only" (and define “first” deterministically—after sorting by hole number),
- or: "aggregate all offending holes into one message" (and pin the exact format, including deterministic ordering of hole numbers and per-hole key lists).
Then align §6 + AC #9 examples with that choice.

3. [medium] Rule 4’s error cardinality contradicts the error-cardinality policy
   - File: _bmad-output/implementation-artifacts/tournament/T2-4-course-validator.md:141-146
   - Confidence: high
   - Why it matters: The error-cardinality policy states rule 4 is “AT MOST ONE error” (line 99). But §6’s rule 4 bullet says it “aggregates — single error per call” and then immediately allows “the dev may emit one-per-tee if simpler” (line 145). That directly reintroduces the round-1 ambiguity you intended to remove and can change required test expectations.
   - Suggested fix: Delete the “may emit one-per-tee” allowance (or, if you actually want one-per-tee, update the error-cardinality policy and AC/test-count assumptions accordingly). If keeping single-error, also pin whether it reports the first violation only or aggregates all offending tees (and how).

4. [low] AC #3 “runs all 17 rules” wording is slightly at odds with the new explicit skip prerequisite for rules 13–17
   - File: _bmad-output/implementation-artifacts/tournament/T2-4-course-validator.md:199-237
   - Confidence: high
   - Why it matters: You now correctly specify that rules 13–17 are skipped entirely if rule 5 or 7 fails (lines 89–90, 235–238). But AC #3 still says the validator “runs all 17 rules” (line 201). While arguably reconcilable (“evaluates each rule subject to prerequisites”), this is a spec-level statement that can confuse implementers and reviewers.
   - Suggested fix: Tweak AC #3 to: “runs all applicable rules (subject to explicit prerequisites like §4D’s skip for 13–17) and accumulates errors; does not short-circuit within independent rules.”

## Strengths

- Round-1 HIGH #1 appears genuinely resolved: §4D and AC #11 explicitly define prerequisites and skipping behavior for rules 13–17 (lines 89–90, 235–238), preventing meaningless totals errors on malformed holes arrays.
- Round-1 HIGH #2 appears resolved in principle: an explicit per-rule error-cardinality policy is now stated (lines 98–101), and totals rules are described as “single error” where applicable (lines 91–96).
- Round-1 MED #4 appears resolved: totals logic is cleanly layered into compute (rule 13), three printed-vs-computed comparisons (14–16), and separate printed-internal-consistency (17) (lines 90–97).
- Deterministic ordering + stable templates are substantially improved in §6 (lines 110–140), which is essential given exact-string test pinning.

## Warnings

None.
