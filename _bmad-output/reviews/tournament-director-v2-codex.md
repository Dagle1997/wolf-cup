# Codex Review

- Generated: 2026-04-20T13:19:41.809Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: .claude/commands/tournament-director.md, _bmad/bmm/workflows/4-implementation/dev-story/workflow-tournament.yaml, _bmad/bmm/workflows/4-implementation/code-review/workflow-tournament.yaml

## Summary

Most prior findings appear materially addressed in the rewrite: (a) the ALLOWED/SHARED/FORBIDDEN classifier is explicit and enforced with a pre-commit path check, (b) dev-story/code-review tournament forks exist and are explicitly referenced with a hard “don’t fall back” guard, (c) the 5-point AND gate for “mechanically fixable” High findings is substantially tighter and includes a quote-the-text + quote-the-diff requirement, (d) a loop pause protocol is documented, (e) `review` status is retained with an added party+codex stage, (f) codex freshness and no-drift rules are explicit.

New issues introduced are mostly around (1) whether the minimal `dev-story` fork truly redirects *all* workflow I/O away from Wolf Cup paths, (2) commit staging still missing robust handling for deletions/renames/untracked artifacts, and (3) loop-pausing depends on an unverifiable “no new user message” condition without a persisted gate marker. Party-mode automation is also still underspecified for interactive back-and-forth.

Residual risk remains primarily in the workflow fork sufficiency and the lack of a persisted “pending gate” signal for `/loop` idling.


Overall risk: medium

## Findings

1. [high] `dev-story` tournament workflow override is likely insufficient; only `sprint_status` is redirected, but other workflow outputs may still target Wolf Cup locations
   - File: _bmad/bmm/workflows/4-implementation/dev-story/workflow-tournament.yaml:17-25
   - Confidence: medium
   - Why it matters: This fork claims it’s the “ONLY divergence” and that the story file is “auto-discovered … (from tournament folder)” while `story_file` is empty (line 17) and only `sprint_status` is overridden (line 23). With no evidence from `instructions.xml` that (a) story discovery is constrained to the tournament directory, and (b) all write targets are parameterized solely via `sprint_status`/`implementation_artifacts`, the workflow may still read/write Wolf Cup story files or artifacts. The director will probably catch this later via allowlist checks, but by then the workflow may already have mutated out-of-scope files, forcing reverts and creating a boundary-escape loophole via automation.
   - Suggested fix: In the tournament fork, override every path-valued variable that `instructions.xml` uses for reads/writes, not just `sprint_status`. Concretely: inspect `_bmad/bmm/workflows/4-implementation/dev-story/instructions.xml` for any variables like `story_file`, `story_dir`, `implementation_artifacts`, `output_dir`, etc. Then set them explicitly to tournament-scoped paths (e.g., tournament story dir and tournament implementation artifacts dir). Remove/avoid comments that assert auto-discovery unless the XML actually enforces it. Add a guard step (in the director or workflow) that fails fast if any modified path is outside `_bmad-output/implementation-artifacts/tournament/**` or `apps/tournament-*` immediately after the workflow run (not just pre-commit).

2. [high] Commit staging procedure cannot correctly stage deletions/renames; `git add <path>` alone will miss removals and can leave the tree dirty
   - File: .claude/commands/tournament-director.md:188-206
   - Confidence: high
   - Why it matters: Step 10 instructs enumerating `git status --porcelain` and staging via `git add <path1> <path2> …` (lines 188–205). For deleted files (status `D`) you typically need `git rm <path>` or `git add -u -- <path>`; `git add <deleted-path>` can fail or not stage the deletion. Renames (`R`) similarly require staging the index changes appropriately. This creates a concrete risk of (a) committing an incomplete change set, (b) failing the “git diff must be empty” check (line 204), or (c) repeatedly cycling without a documented way to stage removals while still forbidding `git add -A`/`.`.
   - Suggested fix: Extend Step 10 with explicit handling for `git status --porcelain` codes:
- For `D` paths: use `git rm -- <path>` (or `git add -u -- <path>` if you prefer).
- For renames `R old -> new`: stage both via `git add -- <new>` and `git rm -- <old>` (or `git add -A -- <old> <new>` but you currently forbid `-A`; better: `git add -u -- <old>` + `git add -- <new>`).
- After staging, require `git status --porcelain` to be empty (not just `git diff`), so untracked files can’t slip through.
Add these as MUST rules adjacent to lines 195–206.

3. [medium] Loop pause protocol depends on an unpersisted “no new user message” condition; `/loop` can still spin or idle incorrectly without a gate marker
   - File: .claude/commands/tournament-director.md:284-293
   - Confidence: high
   - Why it matters: The loop pause protocol says to detect on next `/loop` invocation whether “there is no new user message resolving the gate” (line 290–292). There is no persisted, machine-checkable state indicating (a) a gate is pending, (b) which question is pending, and (c) whether it was resolved. Relying on conversational context is fragile under automation (e.g., if the loop tool re-invokes without clear message boundaries). This can reintroduce the original “spin on gates” failure mode or cause the director to remain idle after the user actually answered.
   - Suggested fix: Persist gate state in the filesystem. Minimal change: write a tournament-scoped marker file such as `_bmad-output/implementation-artifacts/tournament/.director-pending-gate.json` containing `{story_key, gate_type, question, created_at}` when STOPping, and delete it only when the user explicitly resolves it. Then, under `/loop`, check for this marker first and idle deterministically. Alternatively, add a `pending_gate:` field to the tournament `sprint-status.yaml` with the same data.

4. [medium] Party-mode automation is underspecified for interactive back-and-forth; director may proceed to Step 9 without user-resolved questions
   - File: .claude/commands/tournament-director.md:166-186
   - Confidence: medium
   - Why it matters: Step 8 unconditionally invokes `bmad-party-mode` and proceeds to Step 9 based on whether it “surfaces required changes” (lines 170–177). Party-mode is commonly interactive; if the party output contains questions or requests for clarification, the director has no explicit STOP gate here (unlike spec gate in Step 4) and could incorrectly continue, treating unresolved questions as recommendations. This is especially risky because Step 8 flips status to `review` before party-mode (line 168), so the story can be left in `review` with ambiguous next action and `/loop` behavior dependent on the non-persisted gate detection.
   - Suggested fix: Add an explicit “Party gate” rule in Step 8:
- Require party-mode to produce a single, non-interactive written review to `_bmad-output/reviews/{story-key}-party-review.md`.
- If the party output contains any direct questions or requests for user input, STOP immediately with one explicit question to the user, and do not proceed to Step 9 until answered.
- Optionally, move the status flip to `review` *after* party-mode completes successfully, or define that `review` may legitimately mean “awaiting party/user feedback” and add a clear recovery instruction.

5. [medium] Lockfile/dependency required-inclusion rule is too narrow; dependency changes in tournament workspace `package.json` files may not force `pnpm-lock.yaml` inclusion
   - File: .claude/commands/tournament-director.md:197-201
   - Confidence: high
   - Why it matters: Required-inclusion currently says “If `package.json` changed → `pnpm-lock.yaml` MUST be in the commit” (line 198), but the SHARED list only names the *root* `package.json` explicitly (line 41), while ALLOWED includes `apps/tournament-api/**` and `apps/tournament-web/**` (lines 30–31). A typical tournament story will add deps by editing `apps/tournament-*/package.json` (ALLOWED). That can change `pnpm-lock.yaml` (SHARED) as a necessary companion, but the rule’s wording and SHARED gating don’t explicitly connect “workspace package.json dep changes” to “must include lockfile and therefore must request SHARED approval.” Result: you can commit updated `apps/tournament-*/package.json` without the lockfile, leaving installs/tests inconsistent.
   - Suggested fix: Make the rule explicit:
- If *any* `**/package.json` changes in dependency sections (dependencies/devDependencies/peerDependencies/optionalDependencies) OR if `pnpm-lock.yaml` changed, then `pnpm-lock.yaml` MUST be included; since it’s SHARED, STOP and request approval to include it.
- Add a check: `git diff --name-only --cached | find package.json` and if any match outside root, still enforce the lockfile rule.
Clarify that root `package.json` is SHARED, but app-level `package.json` is ALLOWED; the lockfile remains SHARED and must be approved when needed.

6. [low] Verification step references `git diff --name-only HEAD` “for the staged set”; command does not match intent and may confuse enforcement
   - File: .claude/commands/tournament-director.md:62-69
   - Confidence: high
   - Why it matters: The “Verification step (MANDATORY before every commit)” says to run `git status --porcelain` and then `git diff --name-only HEAD` “for the staged set” (lines 62–65). `git diff --name-only HEAD` shows both staged and unstaged tracked changes vs `HEAD`, not specifically the staged set; the staged-only list is `git diff --cached --name-only`. The later Step 10 checks are stronger, but this mismatch can cause inconsistent path classification earlier and make the protocol easier to misapply.
   - Suggested fix: Change line 64–65 to require both:
- `git diff --cached --name-only` (staged)
- `git diff --name-only` (unstaged)
Then apply the same classification rules to the union. Also consider requiring `git status --porcelain` to be empty after staging as the final pre-commit condition.

## Strengths

- Path boundary is materially clearer: explicit ALLOWED/SHARED/FORBIDDEN buckets with an enforcement step before commit (tournament-director.md lines 24–70).
- The “mechanically fixable High” gate is significantly tightened with a true AND-list and a quote-the-codex + quote-the-diff requirement (lines 250–268), reducing the prior ‘gameable’ loophole.
- Codex output freshness is explicitly checked and uses per-story/per-phase output paths (lines 108–115, 160–165, 184–186), addressing the stale-output failure mode.
- Explicit hard guards prevent falling back to Wolf Cup workflows in create-story and dev-story steps (lines 90–99, 126–134).
- No-drift rule between impl codex and party is clear and enforceable in principle (lines 164–165).

## Warnings

None.
