# Codex Review

- Generated: 2026-04-26T17:54:00.786Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T2-3b-minimal-organizer-upload-ui.md, _bmad-output/reviews/T2-3b-minimal-organizer-upload-ui-spec-codex-round3.md

## Summary

1) Yes: updating AC #12 to “baseline + 3” closes the Round-3 MED (AC #5’s “rewrite + 3 net-new” now matches AC #12’s test-count delta). 2) However, there are still internal inconsistencies between ACs vs Tasks / Structure Notes around the same API test-count delta and which tests are actually added, which reintroduces ambiguity at the spec gate. Verdict: NEEDS-CHANGES.

Overall risk: medium

## Findings

1. [medium] AC #12 test-count delta fixed, but Tasks/Structure Notes still contradict the required +3 API tests and omit the invalid-session test
   - File: _bmad-output/implementation-artifacts/tournament/T2-3b-minimal-organizer-upload-ui.md:153-340
   - Confidence: high
   - Why it matters: Round-3’s issue was “baseline + N” ambiguity. AC #5 requires rewriting the existing status test and adding 3 new tests (anonymous rewritten + invalid-session + organizer + non-organizer), and AC #12 now correctly asserts “baseline + 3.” But other parts of the same spec still say “+2” or only mention adding two cases, which makes the execution plan and verification criteria inconsistent and risks failing the spec gate on process/traceability even if the code is correct.
   - Suggested fix: Make all references consistent with AC #5/AC #12:
- Update Task 3 to include the invalid-session test explicitly (add a Subtask for it).
- Update Task 10.5 to say “baseline + ≥3” (or exactly “baseline + 3” if you want strict gating).
- Update Project Structure Notes to say “auth.test.ts — MODIFIED: rewrite + add 3 tests” (not “add 2 tests”).
Concretely, edit:
- Task 3 list at lines 251–254 (currently omits invalid-session).
- Task 10.5 at line 280 (currently says baseline + ≥2).
- Structure notes at line 338 (currently says add 2 tests).

2. [low] AC #9 idle-state test guidance conflates how to query the file input vs the Submit button (could lead to brittle/incorrect tests)
   - File: _bmad-output/implementation-artifacts/tournament/T2-3b-minimal-organizer-upload-ui.md:199-204
   - Confidence: medium
   - Why it matters: AC #9 says the file input is “queryable via screen.getByRole('button', { name: /submit/i })” which actually targets the Submit button, not the `<input type="file">`. If implementers follow this literally, they may fail to assert the intended control exists or write a test that passes even if the file input is missing/mis-labeled.
   - Suggested fix: Clarify the test instruction to explicitly query the file input (e.g., `getByLabelText(/scorecard/i)` with an explicit `<label>`, or `getByTestId` if necessary) and separately assert the Submit button is present/disabled. Keep the AC intent (file input present; submit disabled until file chosen) but remove the misleading example.

## Strengths

- AC #12 is now aligned with AC #5: “baseline + 3” correctly reflects “rewrite existing anonymous test + 3 net-new tests (invalid session, organizer, non-organizer).” This closes the Round-3 MED cleanly (lines 153–160 vs 213–216).
- Auth-status loader contract remains explicit about fetch semantics and validation (network failures, !ok, JSON parse failures, shape validation), reducing the chance of redirect loops or runtime crashes (lines 57–63, 168–174).
- SHARED gate is consistently pre-announced and enforced via AC #16 + Tasks 4/5, keeping the director protocol intact (lines 17–18, 236–238, 255–258).

## Warnings

None.
