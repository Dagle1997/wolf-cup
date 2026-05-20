# Codex Review

- Generated: 2026-05-20T19:08:05.492Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T10-1-team-press-log-foursome-scoping.md

## Summary

Spec is largely concrete and aligns with the stated goal (thread `foursome_number` through schema, dedupe/INSERTs, DELETE security, export projection, and add multi-foursome tests). Main issues are (a) an AC/test mismatch around export coverage, (b) an ambiguous/nullability contract for `computeMaxCompleteHole` → POST INSERT, (c) a migration robustness gap (DROP INDEX without IF EXISTS / name verification), and (d) one inaccurate path-footprint claim (though paths listed are still within the stated allowlist).

Overall risk: medium

## Findings

1. [high] AC-6 requires export to include `foursomeNumber`, but the spec makes the export test update optional (risk of shipping untested export shape change)
   - File: _bmad-output/implementation-artifacts/tournament/T10-1-team-press-log-foursome-scoping.md:85-88
   - Confidence: high
   - Why it matters: AC-6 (lines 158-163) makes `foursomeNumber` in the raw-state export a required contract. But the Dev Notes say to add an assertion only “IF the fixture creates a press row; if not, no test edit needed” (lines 85-88). That creates a clear path to meeting implementation tasks while failing the acceptance criterion (export change can regress silently).
   - Suggested fix: Make the export assertion non-optional: ensure the export integration fixture creates at least one `team_press_log` row (manual or auto) and assert the JSON includes `foursomeNumber` for that row. Alternatively, add a dedicated export test setup step that inserts a `team_press_log` row with `foursome_number=2` to prove non-default propagation.

2. [medium] Ambiguous contract for `computeMaxCompleteHole` returning `foursomeNumber: number | null` while POST INSERT requires a non-null `foursome_number`
   - File: _bmad-output/implementation-artifacts/tournament/T10-1-team-press-log-foursome-scoping.md:60-65
   - Confidence: high
   - Why it matters: The story wants `team_press_log.foursome_number` to be NOT NULL (lines 23-29, 122-128). However, it proposes refactoring `computeMaxCompleteHole` to return `{ maxComplete: number, foursomeNumber: number | null }` (line 62 / task 3.1 at lines 204-208). That allows an implementation where POST proceeds with `null` or `undefined`, causing runtime failures (DB constraint) or ad-hoc fallback to 1 that could reintroduce cross-foursome collisions/security issues.
   - Suggested fix: Tighten the spec: if POST is guarded by `isScorerForRound`, require `computeMaxCompleteHole` to return a *non-null* `foursomeNumber: number` (and explicitly throw/return a 4xx if no assignment row exists). If there are legitimate cases where it can be missing, define the HTTP error code and message and add a test for that path.

3. [medium] Migration robustness: `DROP INDEX uniq_team_press_log_dedupe;` assumes index name exists everywhere and can hard-fail on drift/partial state
   - File: _bmad-output/implementation-artifacts/tournament/T10-1-team-press-log-foursome-scoping.md:21-28
   - Confidence: medium
   - Why it matters: The migration plan hard-codes `DROP INDEX uniq_team_press_log_dedupe;` (line 24). If any environment has drift (e.g., index renamed in an earlier migration, manually altered DB, or a prior botched migration), this statement will fail and block deploy. The spec correctly calls out libsql multi-statement hazards (lines 21-27), but does not add defensive SQL for the drop itself.
   - Suggested fix: Prefer `DROP INDEX IF EXISTS uniq_team_press_log_dedupe;` (and ensure the *create* uses the canonical name). Also consider explicitly verifying the prior index name in the story tasks (e.g., by pointing dev to confirm in 0006 or current schema output) to remove ambiguity.

4. [low] Path-footprint claim is internally inconsistent (mentions only apps/tournament-api/** + sprint-status, but file list includes multiple _bmad-output paths)
   - File: _bmad-output/implementation-artifacts/tournament/T10-1-team-press-log-foursome-scoping.md:15-18
   - Confidence: high
   - Why it matters: Risk Acceptance §1 states: “Every file … classifies into … ALLOWED bucket (`apps/tournament-api/**` and the tournament sprint-status)” (lines 15-18). But the ‘Files this story will edit’ list includes several `_bmad-output/**` paths (lines 258-270). `_bmad-output/**` is allowed per the tournament-director allowlist in the review request, so this isn’t a policy violation—but the mismatch can confuse reviewers and future audits.
   - Suggested fix: Update the sentence to explicitly include `_bmad-output/**` as an allowed bucket referenced by this story (implementation artifact + sprint-status).

5. [low] AC-9 pass-count requirement is brittle/non-deterministic as an acceptance gate
   - File: _bmad-output/implementation-artifacts/tournament/T10-1-team-press-log-foursome-scoping.md:177-183
   - Confidence: high
   - Why it matters: AC-9 requires total passing count to be “≥ (previous passing count + 3)” (lines 177-183). Test counts are prone to change for unrelated reasons (skipped tests, added tests in parallel work, CI sharding), which can fail the story even when the substantive behavior is correct.
   - Suggested fix: Replace with a deterministic criterion: “existing tests pass + the 3 new tests pass,” optionally naming the exact new test cases.

## Strengths

- Spec explicitly addresses the libsql/drizzle multi-statement migration breakpoint gotcha and calls out the exact three statements and their required ordering (lines 21-27, 195-197).
- Security implication is directly captured in the story statement and AC-5, and the proposed fix (foursome-scoped WHERE) is precise (lines 66-84, 146-157).
- Tests are called out as load-bearing and specifically target the previously untested multi-foursome dimension (lines 89-96, 164-176).
- Clear path allowlist awareness: all listed code paths are under `apps/tournament-api/**` or `_bmad-output/**`, with no mention of forbidden `apps/api/**`, `apps/web/**`, or `packages/engine/**` edits (lines 258-270).

## Warnings

None.
