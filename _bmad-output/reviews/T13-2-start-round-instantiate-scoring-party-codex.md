# Codex Review

- Generated: 2026-05-22T22:25:33.794Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/T13-2-start-round-instantiate-scoring-party-review.md

## Summary

The party review is internally coherent and stays within the described scope (start-round + tournament-web route), but it makes several strong, implementation-specific and coverage-specific assertions without any citations or verifiable anchors in the provided artifact. As written, it reads more certain than the evidence in this file supports, and it could be interpreted as implying changes outside the tournament allowlist unless clarified.

Overall risk: medium

## Findings

1. [medium] Overconfident/uncited claims about implementation details (FSM semantics, idempotency strategy, migration safety)
   - File: _bmad-output/reviews/T13-2-start-round-instantiate-scoring-party-review.md:5-15
   - Confidence: high
   - Why it matters: This review asserts specific technical truths (e.g., `INITIAL_ROUND_STATE='not_started'`, `openedAt` being set by an FSM on first-score, “insert-then-recover outside the aborted tx”, and that migration 0013 is “safe because no event_round-linked rounds can exist pre-T13-2”) but provides no references (code pointers, migration snippet, test names) in the document itself. If any of these are even slightly off, the review materially misleads readers about correctness and risk.
   - Suggested fix: Temper absolute statements (“proven”, “safe because…”, “mirroring pattern…”) or add concrete anchors: endpoint handler file path, migration filename + index definition, FSM constant location/value, and the exact test(s) that cover the UNIQUE-recovery path and the openedAt behavior.

2. [medium] Test coverage is stated as exhaustive without traceability; may overstate what is actually asserted
   - File: _bmad-output/reviews/T13-2-start-round-instantiate-scoring-party-review.md:19-27
   - Confidence: high
   - Why it matters: The QA/Dev sections claim “Validation is fully exercised”, “AC-3 every validation has a test”, “double-start test exercises the real UNIQUE-recover branch”, and that the lifecycle E2E proves “leaderboard reflects the score”. Without citing test filenames/cases or what assertions are made, this can overstate coverage (e.g., a test might call the endpoint but not assert DB side effects such as scorer_assignments presence/uniqueness). Overstatement here can mask real gaps.
   - Suggested fix: Add references to the specific test files/cases (names/paths) and summarize the key assertions (e.g., asserts scorer_assignments count per foursome; asserts round_states row created with expected initial value; asserts leaderboard computation changed due to posted score). If some validations are only indirectly covered, soften language accordingly.

3. [low] Allowlist-boundary ambiguity: status line mentions engine and wolf-cup-api without explicitly stating they were not modified
   - File: _bmad-output/reviews/T13-2-start-round-instantiate-scoring-party-review.md:6
   - Confidence: medium
   - Why it matters: The review notes “engine … ✓, wolf-cup-api … ✓” in the same breath as the implementation summary. Given the stated constraint that the tournament work must not edit `packages/engine` (and other disallowed areas), this could be misread as implying changes occurred there rather than simply CI/test runs. That’s an avoidable drift/communication risk.
   - Suggested fix: Add a one-liner clarifying scope boundaries explicitly in the review (e.g., “No code changes in packages/engine, apps/web, apps/api, or wolf-cup-api; those suites were run for safety”).

## Strengths

- Scope is consistently framed as “start-round only” with scoring transitions pre-existing, which reduces accidental drift claims.
- Calls out two specific residual risks (web route organizer-gating UX and partial defensive validation) instead of claiming perfection.
- Explicitly mentions atomic creation across three tables and idempotency/race-safety as primary correctness concerns, which are the right areas to focus on for this change.

## Warnings

None.
