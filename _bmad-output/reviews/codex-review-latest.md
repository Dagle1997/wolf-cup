# Codex Review

- Generated: 2026-04-20T12:52:46.854Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: .claude/commands/tournament-director.md

## Summary

The command is directionally solid (explicit spec gate, explicit epic gate, codex gating, no-push/no-amend), but several instructions remain ambiguous enough that an eager agent could (a) drift into Wolf Cup/monorepo-shared files, (b) accidentally invoke the Wolf Cup workflows for implementation, (c) rationalize “mechanically fixable” High findings too broadly, and (d) create inconsistent status/commit/test outcomes under /loop or partial failures. Tightening a few MUST/STOP rules and adding explicit allowlists + verification steps would make it much harder to fail silently.

Overall risk: high

## Findings

1. [high] FD-1/FD-2 boundary rule is under-specified (no explicit allowlist/denylist; ‘internals’ is ambiguous; shared monorepo files not covered)
   - File: .claude/commands/tournament-director.md:10-15
   - Confidence: high
   - Why it matters: Line 12 forbids writing to `apps/api`, `apps/web`, and `packages/engine` “internals”, but does not define (1) what Tournament paths are, (2) what counts as `packages/engine` internals vs allowed surfaces, or (3) how to handle common cross-cutting files (root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.env*`, `.github/*`, etc.). A capable-but-eager agent can justify edits to shared files as “necessary for Tournament,” violating FD-1/FD-2 while still believing it complied.
   - Suggested fix: Add an explicit allowlist + explicit ‘shared file’ gate. Example edits:
- Replace line 12 with: “MUST ONLY modify files under: `apps/tournament/**`, `packages/tournament-*/**`, `_bmad-output/implementation-artifacts/tournament/**`, and `_bmad-output/planning-artifacts/tournament/**` (adjust to actual repo). Any change outside this allowlist (including root config files like `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig*.json`, `.github/**`, `eslint*`, `prettier*`) is a HARD STOP and requires explicit user approval listing the exact files.”
- Define “Wolf Cup boundary”: “Never modify `apps/api/**`, `apps/web/**`, `packages/engine/**` (including tests), except with explicit approval naming the files.”
- Add a verification step after implementation: “Run `git diff --name-only` and STOP if any changed file is outside allowlist; request approval or revert those changes.”

2. [high] Implementation workflow invocation is ambiguous and may fall back to Wolf Cup defaults
   - File: .claude/commands/tournament-director.md:63-66
   - Confidence: high
   - Why it matters: Step 2 is explicit about using `workflow-tournament.yaml` (lines 37–42). Step 5, however, says “Invoke the implementation workflow (equivalent of `bmm-dev-story`)” without specifying how to run it or how to ensure it uses a Tournament-safe config. An agent could run the default slash command / workflow that targets Wolf Cup paths, violating constraints silently.
   - Suggested fix: Mirror Step 2’s explicitness for implementation. For example:
- In Step 5, specify the exact task runner + config path, e.g. “Load `_bmad/core/tasks/workflow.xml` with `workflow-config` = `_bmad/bmm/workflows/4-implementation/dev-story/workflow-tournament.yaml` (or whatever tournament variant exists). If no tournament variant exists, STOP and ask the user to create a dedicated `/bmad-bmm-dev-story-tournament` command.”
- Add a hard guard: “If the workflow config is not explicitly the tournament variant, STOP; do not run any default bmm-dev-story workflow.”

3. [high] “High — mechanically fixable” bucket is still gameable; needs tighter, objective criteria to prevent rationalized judgment calls
   - File: .claude/commands/tournament-director.md:122-137
   - Confidence: high
   - Why it matters: The current definition (line 128) relies on the agent deciding the fix has “no judgment required.” A motivated agent can rationalize many High findings (security tradeoffs, authorization semantics, data model choices, cross-boundary edits, dependency additions) as “small code changes.” Conversely, it can also over-classify easy fixes as “requires user decision” and stall. This undermines your acceptance criterion to stop on High that need judgment.
   - Suggested fix: Make the classification test more objective and add explicit STOP conditions. Suggested edits to line 128:
- Define mechanically-fixable as: “codex provides a specific patch-level change AND it does not (a) change requirements/AC wording, (b) change public API/route contracts, (c) change authz/authn semantics, (d) introduce or remove dependencies, (e) require DB schema changes or migrations, (f) touch any file outside the Tournament allowlist, or (g) change error-handling/user-visible behavior beyond correctness.”
- Add: “If any of (a)-(g) applies, treat as ‘requires user decision’ and STOP.”
- Add a procedural requirement: “Quote the exact codex text and the exact diff you plan to apply before applying any High fix; if you cannot quote both, STOP.”

4. [high] /loop can spin wastefully on user gates (re-picking the same in-flight story) without an explicit ‘pause’ protocol
   - File: .claude/commands/tournament-director.md:25-32
   - Confidence: medium
   - Why it matters: Under `/loop`, Step 1 says to stop if there’s an in-flight story (line 29) and ask the user whether to resume/abandon. If the user doesn’t respond (or responses are delayed), the loop may re-invoke the director, hit the same condition, and burn turns indefinitely. The file says “Respect every gate” (line 156) but doesn’t specify how to avoid re-entry churn.
   - Suggested fix: Add an explicit loop-pause instruction when waiting on a user gate:
- After each STOP gate, add: “When stopped for a user decision, end the message with a single explicit question and take no further actions; on next invocation, do not re-ask if the question is unchanged—wait for the answer.”
- Track a simple ‘pending gate’ marker in the report (or a temp note file) so the agent can detect it is awaiting approval and should not restart or re-run steps.

5. [medium] Story status transitions deviate from documented workflow (skips `review`), risking process confusion and automation breakage
   - File: .claude/commands/tournament-director.md:103-106
   - Confidence: high
   - Why it matters: Your note says BMAD statuses are `backlog → ready-for-dev → in-progress → review → done`. The director goes `in-progress → done` (lines 103–106). If other tooling or humans rely on `review` as a signal (or metrics dashboards), this is a silent convention break.
   - Suggested fix: Either (A) conform, or (B) explicitly document the deviation and why it’s safe.
- Conform option: After Step 7 passes, set status to `review`; after commit + final report (or optional user confirmation), set to `done`.
- If you intentionally skip: add a MUST statement: “We intentionally skip `review` in this repo because codex-review replaces it; update any downstream automation accordingly.” (But that still leaves external expectations.)

6. [medium] Commit staging rule is incomplete; risk of missing required files (lockfile/migrations) or accidentally staging extras
   - File: .claude/commands/tournament-director.md:89-92
   - Confidence: high
   - Why it matters: “Do not use git add -A” (line 91) prevents overly broad staging, but there is no required staging procedure. Agents often miss new files (migrations, generated artifacts), forget to stage deletions/renames, or accidentally omit lockfile changes after dependency updates. That leads to broken builds or non-reproducible installs.
   - Suggested fix: Add a mandatory, explicit staging algorithm:
- “Run `git status --porcelain` and paste the file list. Stage by explicit path list: `git add <each file>`. If any file is untracked and part of the story, stage it; if any file is outside Tournament allowlist, STOP.”
- Add lockfile/migration rules: “If dependencies changed, `pnpm-lock.yaml` MUST be included (or STOP and revert dep change). If DB schema changed, migration files MUST be included.”
- Add pre-commit verification: “Before committing, require `git diff --cached` is non-empty and `git diff` is empty (clean working tree).”

7. [medium] Test baselines hard-coded to exact counts are brittle and can block legitimate changes or create false alarms
   - File: .claude/commands/tournament-director.md:67-75
   - Confidence: high
   - Why it matters: Requiring exact “must match prior baseline: 468/429” (lines 71–72) will fail when Wolf Cup tests legitimately change upstream (even without touching Wolf Cup code), when tests are added/removed, or when sharding changes output. It can also encourage “make the number match” behavior rather than “ensure no regressions.”
   - Suggested fix: Replace with non-regression requirements:
- “`pnpm --filter @wolf-cup/engine test` MUST pass (no failures). Report total count as informational only.”
- If you want a baseline: “If count decreases, STOP and investigate; if increases, note in report.”
- Prefer storing baselines in a file that can be updated deliberately (with user approval) rather than hard-coding in the prompt.

8. [medium] Codex-review execution freshness isn’t verified; output_path reuse can mask failures or stale reviews
   - File: .claude/commands/tournament-director.md:44-53
   - Confidence: high
   - Why it matters: Both reviews write to `_bmad-output/reviews/codex-review-latest.md` (lines 51–52 and 85). If the MCP call errors, times out, or returns partial output, the agent might read a previous successful review and continue. The failure modes say “Codex MCP unavailable → stop” (line 151), but there’s no explicit check that the latest output corresponds to the current invocation and target paths.
   - Suggested fix: Add explicit verification steps:
- Use unique output paths per run: `_bmad-output/reviews/{story-key}-spec-codex.md` and `{story-key}-impl-codex.md`.
- Require evidence: “After codex completes, quote the header/metadata and at least the first High/Medium finding counts from the newly written file; if the file timestamp or contents don’t match the requested paths, STOP.”
- Add a retry policy: “If codex times out, retry once; if still failing, STOP.”

9. [medium] Ordering constraints don’t fully prevent ‘drift after review’ (changes after impl codex but before commit)
   - File: .claude/commands/tournament-director.md:79-88
   - Confidence: medium
   - Why it matters: Step 7 reviews “all files changed” from `git diff --name-only HEAD` (line 84), then Step 8 commits. But if any code is changed after the codex review (even formatting, conflict resolution, small fixes), the commit may include unreviewed diffs. The anti-patterns mention re-reviewing codex fixes (line 140) but not general post-review changes.
   - Suggested fix: Add a MUST:
- “After impl codex-review passes, do not modify code. If any file changes after the review (check `git diff`), re-run impl codex-review before committing.”
- Also tighten the `paths` selection: prefer `git diff --name-only --relative` from the merge-base or from the moment you started the story; and ensure it includes untracked files via `git status --porcelain` union.

10. [low] Step 1’s definition of ‘current epic’ is ambiguous; could select the wrong story when multiple epics have mixed statuses
   - File: .claude/commands/tournament-director.md:27-31
   - Confidence: medium
   - Why it matters: Line 27 says “scan epics in order (T1 → T2 → …)” and pick next `backlog` story. Then line 29 refers to “the current epic” having in-flight stories, but “current epic” isn’t formally defined (first epic with any non-done? epic of the selected backlog story? epic currently being worked?). In ambiguous states, the director could stop unnecessarily or advance incorrectly.
   - Suggested fix: Define it explicitly, e.g.:
- “Define current epic as the earliest epic (lowest T#) that has any story not `done`. Do not start any story in later epics until the current epic is fully `done` and the user clears the epic gate.”
- Also consider: “If ANY story anywhere is `in-progress`/`ready-for-dev`/`review`, STOP” (global WIP limit) if that’s the intended policy.

## Strengths

- Explicit no-push, no-amend constraints are stated early and repeated (lines 13–15, 144–145).
- Spec-level codex review occurs before implementation and includes an explicit user approval gate (lines 44–62), meeting the story-level gating requirement.
- Epic-level gate is present and blocks auto-advancing across epics (line 30, reiterated at line 118).
- Failure-mode handling correctly forbids falling back to Wolf Cup workflow when the tournament YAML is missing (lines 148–151).
- Gating rule includes a forced re-review after auto-fixing High findings (line 128), reducing the chance of unreviewed fixes.

## Warnings

None.
