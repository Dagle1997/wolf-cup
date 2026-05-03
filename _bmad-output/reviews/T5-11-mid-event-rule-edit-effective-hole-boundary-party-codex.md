# Codex Review

- Generated: 2026-05-03T12:35:55.310Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/T5-11-mid-event-rule-edit-effective-hole-boundary-party-review.md, _bmad-output/implementation-artifacts/tournament/T5-11-mid-event-rule-edit-effective-hole-boundary.md, apps/tournament-api/src/routes/event-rule-edits.ts, apps/tournament-api/src/routes/event-rule-edits.integration.test.ts

## Summary

The party-mode review is mostly aligned with the provided route + integration tests for the core semantics (auth-first/no-existence-leak, loose tenant-scoped rule_set existence check, boundary + freeze-window logic including hole=19 anchor-skip, revision insert + audit payload, and post-commit breadcrumb logging). However, there are a few concrete accuracy gaps in the review vs the spec/implementation, plus at least one spec requirement that is not implemented (activity payload missing `configDiffSummary`) and at least one test-coverage overstatement (boundary-not-found not actually tested). The review also contains several claims that are not verifiable from the provided files (git status, suite counts, sprint-status changes).

Overall risk: medium

## Findings

1. [medium] Spec AC-3(e) activity payload requires configDiffSummary, but implementation omits it (party review claims no spec deviations)
   - File: apps/tournament-api/src/routes/event-rule-edits.ts:337-348
   - Confidence: high
   - Why it matters: The spec explicitly describes emitting activity with payload including `configDiffSummary` (for eventual participant-visible diff/banner use). The implementation emits activity but does not include `configDiffSummary` at all. This is a direct spec-vs-implementation mismatch, and the party review’s “No deviations from spec” conclusion is therefore inaccurate.
   - Suggested fix: Either (1) add `configDiffSummary` to the emitted activity payload (even if null/empty in v1), or (2) update the spec to state it’s optional/omitted in v1. If adding it, decide on a minimal stable shape (e.g., string summary or structured diff) and add/adjust a test to pin it.

2. [medium] Party review over-attributes test (d) as covering effective_from_round_not_found; no such test exists
   - File: _bmad-output/reviews/T5-11-mid-event-rule-edit-effective-hole-boundary-party-review.md:14-16
   - Confidence: high
   - Why it matters: Mary’s AC-2/boundary-validation bullet states boundary validation enforces both `effective_from_round_not_found` and `round_not_in_event` and cites “test (d)”. In the integration suite, (d) only covers `round_not_in_event` (cross-event boundary). There is no test for `effective_from_round_not_found` (missing/deleted anchor round). This is a concrete mismatch between claimed and actual coverage.
   - Suggested fix: Adjust the party review to state (d) covers only `round_not_in_event`, and add a new integration test asserting 422 `effective_from_round_not_found` when `effectiveFromRoundId` is a UUID not present in `event_rounds` for the tenant.

3. [low] Spec’s test-plan says happy-path (a) asserts activity emitted, but the integration test does not assert activity emission
   - File: apps/tournament-api/src/routes/event-rule-edits.integration.test.ts:339-407
   - Confidence: high
   - Why it matters: The spec’s AC-8(a) includes “activity emitted (NO-OP but called)”. The current happy-path test asserts revision insert + audit row, but does not spy on `emitActivity` or otherwise assert that activity is emitted. This is not a runtime bug, but it is a spec/test-plan completeness gap (and the party review’s framing implies broader coverage than exists).
   - Suggested fix: Add a spy/mock for `emitActivity` (or for whatever persistence it writes to, if it’s later non-NOOP) and assert it was called with `type: 'rule_set.revised'` and the expected scope/payload fields. Alternatively, explicitly downgrade the spec’s test requirement if you’re intentionally not testing this yet.

4. [low] Party review states route file is ~320 LOC; provided implementation is ~418 lines
   - File: _bmad-output/reviews/T5-11-mid-event-rule-edit-effective-hole-boundary-party-review.md:69-75
   - Confidence: high
   - Why it matters: Amelia’s code-quality note claims “Route file is 320 LOC”. The provided `event-rule-edits.ts` is 418 lines long. This isn’t functional, but it is a factual inaccuracy in a review document whose purpose is accuracy/completeness auditing.
   - Suggested fix: Update the party review to reflect the actual file length (or rephrase to a non-numeric claim like “~400 LOC including header comment”).

5. [low] Party review includes multiple non-verifiable claims (git status, suite counts, sprint-status changes) not supported by provided sources
   - File: _bmad-output/reviews/T5-11-mid-event-rule-edit-effective-hole-boundary-party-review.md:28-75
   - Confidence: high
   - Why it matters: Statements like “Verified via git status …”, “tournament-api 622 → 633”, “pnpm -r typecheck/lint ✅”, and “sprint-status.yaml flipped …” are not corroborated by the provided code/spec/test files. In an evidence-first audit, these read as fabricated or at least ungrounded.
   - Suggested fix: Either remove these claims, or attach supporting artifacts (CI logs, command output snippets, or the referenced files/diffs) and cite them explicitly. If keeping them, qualify as “reported by implementer” rather than “verified”.

## Strengths

- Core endpoint semantics described in the party review match the provided implementation: auth-first inside the transaction, 403 on nonexistent event (no-existence-leak), 404 on missing tenant-scoped rule_set, correct hole=19 anchor-skip windowing, and 422 with `frozenRoundIds` using `event_rounds.id` values.
- Integration tests do cover the key behavioral scenarios claimed for (a), (b), (c), (c2), (d), (e), (f), (g), (h), (i), (j), including rollback checks in (c) and breadcrumb logging in (i).
- Impl-codex dispositions mentioned (Set dedupe for frozen ids; tenant scoping on MAX/prior-config reads) are reflected in the current implementation (`Set` at lines 227–246; tenant filters in MAX/prior-config queries at lines 263–289).

## Warnings

None.
