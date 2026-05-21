# Codex Review

- Generated: 2026-05-21T18:29:16.368Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T10-3-handoff-flake-structural-diagnosis.md

## Summary

Re-review of T10-3 spec against the prior 6 findings:

- High #1 (STOP-exit vs done/retry-removal AC conflict): Resolved. The new “Completion states (mutually exclusive)” section cleanly splits State A (FIX LANDED → retry removed, AC-3/4/5 apply) vs State B (NEEDS-DECISION → STOP, NOT done, retry unchanged). (Lines 66-73, 93-116)

- High #2 (weak N≥20 verification): Partially resolved. The AC-3 verification ladder (Rung 1/2/3 with ≥200 iterations only as last resort + residual-risk statement) is a strong improvement, but the Tasks/Verify sections still instruct ≥20 loops, which conflicts with the ≥50 bounded-budget exit and the ≥200 rung-3 requirement. This inconsistency can reintroduce the “20 is enough” failure mode. (Lines 43-45, 101-102 vs 121-122 and 136-137)

- Med #3 (server-log capture untestable): Resolved. The spec now makes `body.code` the required discriminant and explicitly scopes logger spying as optional/non-gating. (Lines 81-83, 122)

- Med #4 (tie to specific sibling file unrealistic): Resolved. The spec explicitly relaxes to proving the contamination class; naming an exact sibling file is best-effort only. (Lines 50-51, 82-83, 125-126)

- Med #5 (fallback underspecified): Resolved. The minimal fallback hardening is concretely defined (unique per-file memdb URL + `afterAll` close via `apps/tournament-api/src/test-utils/test-db.ts`), and `vitest.config.ts` is explicitly disallowed as a speculative fallback. (Lines 52-53)

- Low #6 (files list too broad): Largely resolved. The helper path is narrowed to the exact filename `apps/tournament-api/src/test-utils/test-db.ts`, and AC-5 adds a file-list/diff scope guard. (Lines 110-116, 165-171)

New / remaining issues flagged below: one appears to violate your stated path allowlist; another is an internal spec inconsistency around iteration counts; and there’s a remaining “by construction” ambiguity if randomness is permitted for the per-file DB token.

Overall risk: high

## Findings

1. [high] Spec requires editing sprint-status.yaml, which may violate the stated path-allowlist constraint (“must not touch Wolf Cup sprint-status”)
   - File: _bmad-output/implementation-artifacts/tournament/T10-3-handoff-flake-structural-diagnosis.md:33-116
   - Confidence: high
   - Why it matters: Your review request explicitly asks to enforce that tournament work “must not touch … Wolf Cup sprint-status.” This spec hard-requires a sprint-status flip (AC-5) and lists `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml` as a definite edit. If that file is considered the forbidden “Wolf Cup sprint-status,” the story cannot be completed as written in State A without violating the constraint.
   - Suggested fix: Clarify which sprint-status file is forbidden. If `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml` is disallowed, remove it from the “Files this story will edit” list and delete/replace AC-5’s sprint-status requirement with an allowed completion marker. If it’s allowed, rename the constraint in the story/spec to avoid the “Wolf Cup sprint-status” ambiguity.

2. [medium] Iteration-count contradictions: bounded-budget exit is ≥50 and rung-3 is ≥200, but Tasks/Verify still prescribe ≥20 loops
   - File: _bmad-output/implementation-artifacts/tournament/T10-3-handoff-flake-structural-diagnosis.md:43-137
   - Confidence: high
   - Why it matters: This reintroduces the original verification weakness in operational form. A dev following Tasks 1.2 / Verify 4.1 could stop at 20 iterations and treat it as sufficient, despite AC-1(b) requiring ≥50 to justify a no-repro exit and AC-3 rung-3 requiring ≥200 (or State B). This is exactly the kind of mismatch that leads to flaky-test “fixes” that aren’t actually evidenced.
   - Suggested fix: Align the Tasks/Verify numbers with the ACs: change Task 1.2’s “≥20×” to “≥50×” (or explicitly label 20 as a quick smoke step, not the bounded-budget gate), and update Verify 4.1 to either (a) reference “follow AC-3 ladder” without a fixed N, or (b) specify ≥200 only when using rung-3.

3. [medium] “By construction” uniqueness is undermined by allowing a per-file random token; static proof requires deterministic derivation
   - File: _bmad-output/implementation-artifacts/tournament/T10-3-handoff-flake-structural-diagnosis.md:52-101
   - Confidence: high
   - Why it matters: The spec claims the hardening makes cross-file contamination “impossible by construction” and calls for a “static assertion proving the failing file’s DB URL is unique per file.” That only holds if the per-file token is deterministically unique (e.g., derived from the test file path). If randomness is allowed, uniqueness is probabilistic; a static assertion inside one file can’t actually prove no other file picked the same token.
   - Suggested fix: Make the uniqueness token deterministic (e.g., `memdb-${hash(__filename)}` or a hardcoded constant per file) and define the rung-1 assertion as checking the URL contains that deterministic token (not merely “not equal to file::memory:?cache=shared”). Remove or de-emphasize “per-file random token” if you want the “impossible by construction” claim to remain literally true.

4. [low] Residual ambiguity: when no repro occurs, the boundary between State A(b) vs State B depends on “defensible by-construction change” without a crisp decision rule
   - File: _bmad-output/implementation-artifacts/tournament/T10-3-handoff-flake-structural-diagnosis.md:70-73
   - Confidence: medium
   - Why it matters: You did resolve the major AC conflict, but there remains a small practical ambiguity: if ≥50 iterations don’t repro, State A(b) is “expected to be reachable,” yet State B is also allowed if the dev judges the construction not defensible or requires forbidden scope. Without an explicit tie-breaker, two devs could make different calls under the same evidence.
   - Suggested fix: Add an explicit rule such as: “Default to State A(b) by landing the per-file-URL + afterAll-close hardening unless doing so requires forbidden paths or changes semantics; only choose State B if hardening cannot be implemented within the allowed file set.”

## Strengths

- The mutually exclusive Completion States section resolves the prior ‘done vs STOP’ ambiguity and correctly scopes AC-3/4/5 to State A. (Lines 66-73)
- The handler-path split (event_not_resolvable vs transfer_failed) and requirement to distinguish via `body.code` is concrete and testable; logger spying is correctly optional. (Lines 22-30, 81-83, 122)
- The spec now explicitly targets proving the contamination *class* rather than naming one sibling file, which matches the nondeterminism of fork scheduling. (Lines 50-51, 82-83)
- The fallback hardening is specific, minimal, and scoped: unique per-file memdb URL + afterAll close via a single helper, with a clear ‘no runner-config change as speculative fallback’ rule. (Lines 52-53)

## Warnings

None.
