# Codex Review

- Generated: 2026-04-20T13:27:22.969Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: .claude/commands/tournament-director.md, _bmad/bmm/workflows/4-implementation/dev-story/workflow-tournament.yaml, _bmad/bmm/workflows/4-implementation/code-review/workflow-tournament.yaml

## Summary

## v2 finding closure status

1) **[High] Dev-story fork insufficient / could match Wolf Cup** → **PARTIALLY CLOSED**
- ✅ `dev-story/workflow-tournament.yaml` now overrides `implementation_artifacts` to the tournament subfolder (line 27) and the director passes an explicit story path (tournament-director.md line 148).
- ⚠️ Residual boundary risk: `project_context` is still a repo-wide glob (`**/project-context.md`) in the tournament dev-story fork (workflow-tournament.yaml line 29). If `instructions.xml` consumes `{project_context}`, it can still pull Wolf Cup context.
- ⚠️ Also, `code-review/workflow-tournament.yaml` still inherits `implementation_artifacts` from the shared config (line 13) and only overrides `sprint_status` (line 16). If that workflow’s `instructions.xml` has any “search implementation_artifacts” behavior similar to dev-story, it could still discover Wolf Cup stories.

2) **[High] Commit staging cannot stage deletions/renames** → **PARTIALLY CLOSED**
- ✅ The new status-code mapping covers M/A/D/R/C and adds a strong post-staging cleanliness requirement (tournament-director.md lines 219–240).
- ⚠️ Residual: no explicit handling for unmerged/conflict codes (`UU`, `AA`, `AU`, `UD`, `DU`) and porcelain parsing is not robust for paths with spaces / rename `old -> new` parsing.
- ⚠️ There is an internal contradiction around `??`: the table says `??` is staged (line 221), while another bullet says “untracked artifacts you did not author → do NOT stage” (line 225). Combined with “`git status --porcelain` must be empty” (line 239), the director is pushed toward staging or deleting untracked files.

3) **[Medium] Loop pause depended on unpersisted condition** → **NEEDS MORE WORK**
- ✅ Step 0 exists and points at the marker file (lines 85–90), and the protocol prohibits touching other artifacts when the marker exists (lines 336–337).
- ⚠️ The resolution algorithm depends on comparing `created_at` to “last user message timestamp” (lines 348–350). In this interface, the assistant typically cannot reliably read a user-message timestamp, making this check non-executable and risking either (a) never clearing gates or (b) clearing gates incorrectly.
- ⚠️ No corrupt/partial JSON recovery is specified.

4) **[Medium] Party-mode automation underspecified** → **PARTIALLY CLOSED**
- ✅ Step 8 explicitly demands a single non-interactive written review and gates if questions/disagreement appear (lines 187–193).
- ⚠️ The “contains questions/unresolved disagreement” classifier is still subjective. A stronger mechanical signal would reduce false negatives.

5) **[Medium] Lockfile required-inclusion too narrow** → **PARTIALLY CLOSED**
- ✅ Rule scope broadened to include multiple dependency sections (line 231).
- ⚠️ Detection method is unspecified (manual/heuristic). It still does not mention changes under `pnpm.overrides`, `resolutions`, `packageManager`, workspace protocol ranges, or other dependency-affecting fields.

6) **[Low] Verification step git command mismatch** → **PARTIALLY CLOSED / REGRESSED LOCALLY**
- ✅ The pre-commit “Verification step” section correctly describes the union approach and warns against `git diff --name-only HEAD` (lines 64–70).
- ⚠️ Step 7 reintroduces `git diff --name-only HEAD` for impl codex-review path enumeration (line 171), contradicting the earlier guidance.

## New issues introduced by v2 fixes (most important)
- The marker-file protocol introduces a **non-executable timestamp dependency** and lacks corrupt-file handling.
- The tournament scoping fix was applied to **dev-story**, but **code-review workflow** still inherits broad `implementation_artifacts`.
- The staging rules are more complex but still miss conflict statuses and robust parsing.


Overall risk: high

## Findings

1. [high] Gate marker resolution depends on “last user message timestamp” (likely unavailable), risking permanent idle or incorrect auto-resume
   - File: .claude/commands/tournament-director.md:344-351
   - Confidence: high
   - Why it matters: Step 0 is now the single critical control preventing /loop spinning. The procedure requires comparing marker `created_at` to the last user message timestamp (lines 348–350). In many chat/tooling environments the assistant cannot reliably access message timestamps, making the protocol non-deterministic. Failure modes: (1) gates never clear → director idles forever; (2) gates clear incorrectly if the assistant guesses timestamps; (3) inconsistent behavior across runs.
   - Suggested fix: Make gate resolution **content-based only**, not clock-based. Example edits:
- Remove the timestamp comparison requirement; instead: “If marker exists, only clear it when the latest user message contains an explicit resolution token (e.g., `approve`, `yes proceed`, `no`, `abandon`) or answers the stored question with an unambiguous directive.”
- Optionally add a `gate_id`/`nonce` stored in the JSON, and require the user to reply with `resolve gate <gate_id>: <answer>`.
- Keep `created_at` as informational only (for logging), not as a decision criterion.

2. [high] Tournament dev-story fork still uses repo-wide project_context glob; may ingest Wolf Cup context despite implementation_artifacts scoping
   - File: _bmad/bmm/workflows/4-implementation/dev-story/workflow-tournament.yaml:27-30
   - Confidence: medium
   - Why it matters: You fixed the story auto-discovery escape by scoping `implementation_artifacts` (line 27). But `project_context` remains `**/project-context.md` (line 29), which can match Wolf Cup’s project context. If `instructions.xml` uses `{project_context}` for guidance, the tournament agent can be steered by the wrong product/architecture, increasing the chance of boundary violations or incorrect implementation decisions even if edits are later gated by the director.
   - Suggested fix: Override `project_context` to a tournament-scoped path/pattern (e.g., `{project-root}/_bmad-output/planning-artifacts/tournament/project-context.md` or `{planning_artifacts}/tournament/project-context.md` if available). If the canonical tournament project context file doesn’t exist yet, create one under the tournament planning artifacts and point to it explicitly (and ensure it is in ALLOWED paths).

3. [high] code-review tournament workflow still inherits broad implementation_artifacts; potential reintroduction of cross-project story discovery
   - File: _bmad/bmm/workflows/4-implementation/code-review/workflow-tournament.yaml:12-17
   - Confidence: medium
   - Why it matters: `implementation_artifacts` is inherited from shared config (line 13) and only `sprint_status` is overridden to the tournament subpath (line 16). If code-review’s `instructions.xml` includes any behavior like dev-story’s “search {implementation_artifacts} for stories”, it can still scan the Wolf Cup artifact root and match a Wolf Cup story. This is the same class of escape that v2 finding 1 targeted, just in a different workflow.
   - Suggested fix: Apply the same pattern as the dev-story fork:
- Set `implementation_artifacts: "{project-root}/_bmad-output/implementation-artifacts/tournament"`
- Set `sprint_status: "{implementation_artifacts}/sprint-status.yaml"`
- Ensure any story/spec lookup in the code-review workflow is bounded to tournament artifacts.
If code-review truly needs access to global artifacts, document and tightly scope the exact globals it may read (not via a broad root).

4. [medium] Impl codex-review path enumeration contradicts the earlier “union of cached+unstaged+status” rule and reuses discouraged `git diff --name-only HEAD`
   - File: .claude/commands/tournament-director.md:169-172
   - Confidence: high
   - Why it matters: The doc explicitly says not to use `git diff --name-only HEAD` as a substitute for staged/unstaged separation (lines 64–70). Step 7 then instructs using `git diff --name-only HEAD` for the codex paths (line 171). This inconsistency can cause confusion and make it easier to miss edge cases (e.g., staged-only vs unstaged-only drift), undermining the “No-drift rule” (line 181).
   - Suggested fix: Change step 7 to match the union approach:
- Use `git diff --cached --name-only` + `git diff --name-only` + `git status --porcelain` and take the union for codex `paths`.
- Optionally require `git diff --name-only` to be empty before running impl codex-review to reduce drift (or explicitly state whether impl codex-review should include staged changes, unstaged changes, or both).

5. [medium] Staging-by-porcelain rules still miss merge-conflict/unmerged statuses and are brittle for rename parsing and spaces
   - File: .claude/commands/tournament-director.md:210-226
   - Confidence: medium
   - Why it matters: Step 10 assumes two-character status codes and simple `old -> new` parsing for renames (lines 212–224). `git status --porcelain` can emit unmerged/conflict codes (`UU`, `AA`, `AU`, `UD`, `DU`) and rename/copy lines whose path parsing becomes ambiguous with spaces unless using `-z`. Without explicit STOP rules for unmerged statuses, the director could attempt to stage/commit a conflicted index or mis-stage a rename.
   - Suggested fix: Add explicit handling:
- If status matches any unmerged code (`UU`, `AA`, `AU`, `UA`, `UD`, `DU`, etc.) → HARD STOP: resolve conflicts first; do not proceed to commit.
- Prefer `git status --porcelain=v1 -z` (or `--porcelain=v2 -z`) and document how to interpret NUL-delimited rename pairs to avoid space/arrow parsing issues.
- Clarify handling for submodules (`S` in porcelain v2) if present: STOP and ask user unless explicitly in scope.

6. [medium] Untracked-file policy is contradictory and can force staging or deletion of unrelated artifacts to satisfy “porcelain must be empty”
   - File: .claude/commands/tournament-director.md:221-240
   - Confidence: high
   - Why it matters: The table treats `??` as “modified or added” and stages it (line 221), but also says untracked artifacts you did not author should not be staged (line 225). The pre-commit rule then requires `git status --porcelain` to be empty (line 239), which effectively forces a choice between staging or removing/stashing all untracked files—including potentially unrelated or user-important local files. This increases data-loss risk and weakens the intended safety rule (“do not stage artifacts you did not author”).
   - Suggested fix: Resolve the policy explicitly:
- Exclude specific known-runtime/state files (e.g., `.director-pending-gate.json`) from staging and from the “porcelain must be empty” rule, OR require they be deleted before commit.
- Change the pre-commit rule to: “`git status --porcelain` must contain **no unclassified paths** and no unstaged tracked changes; untracked files may remain only if they are in an explicit ignore list (build outputs, editor swaps) and outside the commit scope.”
- Update the `??` bullet to: “Stage `??` only if (a) it is in ALLOWED and (b) it is part of the story deliverable; otherwise leave untracked and document, or stop and ask.”

7. [low] Marker file protocol lacks corrupt/partial JSON recovery and atomic write guidance
   - File: .claude/commands/tournament-director.md:322-337
   - Confidence: medium
   - Why it matters: The marker file is now a control-plane artifact. If it is partially written, truncated, or externally edited, step 0 could fail to parse it or could act on wrong fields (story_key/gate_type/question), causing unexpected idling or accidental continuation past a gate.
   - Suggested fix: Add a defensive clause in step 0:
- If marker exists but JSON cannot be parsed or required fields are missing → treat as pending gate; do not proceed; ask user whether to delete/reset the marker.
- Recommend atomic write: write to a temp file and rename (when implementing in real code), or at least “write full JSON in one operation; re-read to confirm.”

## Strengths

- Director now hard-guards against using non-tournament workflow variants (tournament-director.md lines 113–114, 150–151).
- Path allowlist and explicit FORBIDDEN Wolf Cup boundary remain clear and enforceable at decision points (lines 24–60).
- Gate marker file is placed under a tournament-scoped ALLOWED folder and the protocol correctly forbids touching other artifacts when a gate is pending (lines 324–337).
- Staging guidance meaningfully improves over the v2 issue by addressing deletions and renames explicitly and by adding a post-staging cleanliness check (lines 219–240).

## Warnings

None.
