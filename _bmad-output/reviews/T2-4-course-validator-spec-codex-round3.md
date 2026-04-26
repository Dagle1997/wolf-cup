# Codex Review

- Generated: 2026-04-26T18:36:01.308Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T2-4-course-validator.md, _bmad-output/reviews/T2-4-course-validator-spec-codex-round2.md

## Summary

Round-2 closures are only partially complete. The structural/cardinality intent is much clearer now (notably rule 11’s “first mismatching hole” locator and the explicit totals prerequisite skip), but several Acceptance Criteria examples still conflict with the pinned §6 templates and deterministic ordering rules. Also, rule 4’s “one error per offending tee” remains ambiguous when multiple fields on the same tee are invalid—this affects both tests and implementation behavior. Verdict: NEEDS-CHANGES.

Overall risk: medium

## Findings

1. [medium] AC examples still contradict §6 pinned templates (missing `extra []` slot; non-lex key ordering)
   - File: _bmad-output/implementation-artifacts/tournament/T2-4-course-validator.md:124-236
   - Confidence: high
   - Why it matters: You require exact-string assertions and call §6 “canonical.” However, AC examples still demonstrate a different message format/ordering, which will force implementers/tests to “choose one” and creates churn.

Concrete mismatches:
- §6 set-mismatch template says rules 7/9 should always include missing/duplicate/extra slots (lines 124-127), but AC #5’s example omits the `extra [...]` slot (lines 217-220) and AC #7 similarly omits it (lines 225-227).
- §6 requires lexicographic ascending ordering for string lists (lines 120-123) and gives a rule-11 example with `[Blue, Gold, Red]` (line 133), but AC #9 uses `[Blue, Red, Gold]` (lines 233-236), violating the ordering contract.
   - Suggested fix: Make AC examples match §6 exactly:
- Update AC #5 and #7 examples to include `extra []` when empty.
- Update AC #9 to use lex-ascending key lists (e.g., `[Blue, Gold, Red]`).
Alternatively, if ACs are the canonical source, adjust §6 and its tests accordingly—but pick one canonical format and keep it consistent everywhere.

2. [medium] §6 labels rule 11 as using the 3-slot set-mismatch template, but then defines a different 2-slot format for rule 11
   - File: _bmad-output/implementation-artifacts/tournament/T2-4-course-validator.md:124-134
   - Confidence: high
   - Why it matters: §6 says the “Set-mismatch error template (rules 7, 9, 11)” is the 3-slot missing/duplicate/extra format (lines 124-127), but the very next rule-11 example uses a different “don’t match” message and only missing/extra (line 133) with a note that duplicates can’t exist. This is an internal contradiction in the canonical template section and will leak into tests (which you intend to pin to exact strings).
   - Suggested fix: Adjust §6 to remove rule 11 from the 3-slot set-mismatch template label (make it “rules 7, 9”), and introduce a clearly separate, explicitly-named “key-set mismatch template (rule 11)” with its exact string format.

3. [medium] Rule 4 cardinality still ambiguous when multiple fields on the same tee are invalid (one per tee vs one per invalid field)
   - File: _bmad-output/implementation-artifacts/tournament/T2-4-course-validator.md:75-156
   - Confidence: high
   - Why it matters: Rule 4 validates multiple properties per tee (`color` non-empty, `rating` positive number, `slope` integer in 55..155) (line 75). The cardinality policy says **ONE error per offending tee** (line 103), but it’s unclear what happens if a single tee has multiple invalid fields (e.g., empty color AND negative rating AND slope out of range). The only pinned rule-4 template is slope-specific (lines 151-152), leaving rating/color violations without pinned messages and leaving “one per tee” open to interpretation.

This ambiguity impacts:
- test design (do you assert 1 error or up to 3 for the same tee?)
- UI behavior (how many rows/messages the organizer sees)
- implementation complexity (aggregate vs emit multiple).
   - Suggested fix: Explicitly define rule 4 behavior:
- Either: “emit at most one rule-4 error per tee; if multiple fields invalid, prefer slope > rating > color (or similar) and pin the chosen message,”
- Or: “emit one error per invalid field per tee,” and update the cardinality policy row to match.
Also pin templates for rating and color failures if they can produce errors.

## Strengths

- Round-2 MED #2 (rule 11 cardinality) is substantially addressed: the error-cardinality table now explicitly states rule 11 is at most one error per call and uses the first mismatching hole as a locator (lines 105-106), aligning the aggregation decision with the UI/UX rationale.
- Round-2 LOW #4 (AC #3 wording vs prerequisite skip) appears resolved: AC #3 now explicitly documents the exception that rules 13–17 skip when rules 5 or 7 fail and requires a dedicated test to prove totals errors are not emitted in that case (lines 205-208).
- Round-2 MED #3 (rule 4 cardinality contradicts policy) is improved: rule 4 is now clearly placed in the “one error per offending tee” bucket (line 103) and §6 text matches that intent for the slope example (lines 151-152).

## Warnings

None.
