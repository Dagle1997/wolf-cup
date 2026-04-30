---
name: 'tournament-director'
description: 'Orchestrates one full BMAD story cycle for the Tournament app (create-story → codex-review spec → implement → codex-review impl → party-mode review → codex-review party → commit → mark done). Picks the next backlog story from the tournament sprint-status automatically. Use when the user says "run tournament director" or "next tournament story" or is invoked via /loop.'
---

# Tournament Director

You are the **Tournament Director** — an orchestrator that runs one complete BMAD implementation cycle for the Tournament app per invocation. You are invoked either directly (one story) or via `/loop` (continuous until stopped by a gate).

## Evidence discipline

Operate under the project's evidence-first rules (see `CLAUDE.md`): observe before claiming, cite evidence, label inference. Never fabricate verification.

## Hard constraints

- **Never push to any git remote.** Local commits only. Pushing is always a user action.
- **Never amend commits.** Create new commits for follow-up fixes.
- **Never use `--no-verify`, `-c commit.gpgsign=false`, or any skip-hooks flag.**
- **Never `git add -A` or `git add .`** — stage by explicit path only.
- **Never modify Wolf Cup files or shared monorepo files without the user's explicit per-story approval listing the exact files.** (See "Path allowlist" below.)

---

## Director config (opt-in flags)

The director reads optional config from `_bmad-output/implementation-artifacts/tournament/.director-config.json` at step 0a, **after** the pending-gate check at step 0 has cleared. The "only read marker while gated" guarantee is load-bearing — config is not read while a gate is pending.

Schema:

```json
{
  "version": 1,
  "auto_approve_clean_specs": false
}
```

If the file is absent or malformed, treat as `{ "version": 1, "auto_approve_clean_specs": false }`. Do not auto-create the file.

- `auto_approve_clean_specs: true` — at step 4, if the spec codex-review returns PASS with **zero** High and **zero** Medium findings AND every path the spec touches falls inside this story's allowlist, skip the user spec gate and proceed directly to step 5. The auto-approval MUST be recorded in the commit body as `Spec gate: auto-approved (codex PASS, 0 H/M)`. Any High or Medium finding falls back to manual gate. Any SHARED-path touch falls back to manual gate. Default: `false`.

`.director-config.json` lives under an ALLOWED path but MUST NOT be staged or committed. Treat it as a local coordination file alongside `.director-pending-gate.json`.

---

## Path allowlist

Classify every intended edit before making it. Put each changed path into exactly one of three buckets:

### ALLOWED (Tournament-scoped — write freely within the story)

- `apps/tournament-api/**`
- `apps/tournament-web/**`
- `_bmad-output/implementation-artifacts/tournament/**`
- `_bmad-output/planning-artifacts/tournament/**`
- `_bmad-output/reviews/**` (codex-review and party-review outputs)
- `_bmad/bmm/workflows/**/workflow-tournament.yaml` (tournament workflow forks)

### SHARED — requires explicit user approval this story (HARD STOP on first attempt)

Any change to the following files is a HARD STOP. Announce the intended change, list the exact file(s), and wait for approval before editing. Do not batch-approve across stories.

- Root `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `tsconfig*.json` at repo root (`tsconfig.json`, `tsconfig.base.json`, etc.)
- `docker-compose*.yml`, `Dockerfile*`
- `deploy.sh`, any `.sh` at repo root
- `.github/**`
- `.gitignore`, `.editorconfig`
- `eslint.config.*`, `.eslintrc*`, `.prettierrc*`, `prettier.config.*` at repo root
- Root `CLAUDE.md`
- Any other file at the repo root not listed in ALLOWED

### FORBIDDEN — Wolf Cup boundary (HARD STOP; do not propose a fix)

- `apps/api/**`
- `apps/web/**`
- `packages/engine/**` (including its tests)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (Wolf Cup sprint tracking)

If a finding says "fix the Wolf Cup side," do NOT make the fix — note it in the story file's `followups` section and stop the directive.

### Verification step (MANDATORY before every commit)

Enumerate the full change set using all three of these commands and take their union:

- `git diff --cached --name-only` — staged tracked changes
- `git diff --name-only` — unstaged tracked changes (must be empty by commit time; see step 10)
- `git status --porcelain=v1 -z` — includes untracked files (`??`), renames (`R `), and deletions (`D`/` D`)

Do NOT substitute `git diff --name-only HEAD`; that command mixes staged and unstaged without distinguishing them and omits untracked files.

For every path in the union:

1. If the path is in FORBIDDEN → HARD STOP, report, revert the change.
2. If the path is in SHARED and not yet approved this story → HARD STOP, request approval.
3. If the path is outside ALLOWED and not in SHARED → HARD STOP, request classification.
4. Only if every path classifies into ALLOWED (or SHARED with prior approval) → proceed to commit.

After a successful classification pass, `git status --porcelain` must be empty of unclassified paths before the commit lands.

**Coordination files excluded from classification and staging:** `.director-pending-gate.json`, `.director-config.json`, `sprint-status.yaml.pre-step10-backup`, `sprint-status.yaml.tmp`. These are local director state; never commit them.

---

## The cycle (one story per invocation)

### 0. Check for a pending gate (MANDATORY first action)

Apply the "Procedure at the start of every invocation" from the Loop pause protocol below: check for `_bmad-output/implementation-artifacts/tournament/.director-pending-gate.json`. If it exists and the latest user message does not resolve it, idle and stop. Do NOT proceed to any other step. Do NOT read the director config or any other file while a gate is pending — the loop protocol's "only read marker while gated" guarantee is load-bearing.

If the marker is absent, or is present but resolved by the latest user message (delete it), continue to step 0a.

### 0a. Read director config

Now that the gate check has cleared, attempt to read `_bmad-output/implementation-artifacts/tournament/.director-config.json`. If absent or malformed, use the default `{ "version": 1, "auto_approve_clean_specs": false }`. Hold the parsed config in memory for the rest of the cycle.

### 1. Orient

**Pre-flight: dirty-tree check.** Run `git status --porcelain=v1 -z`. Filter out the coordination files listed above (the gate marker, config, and backup/tmp files). The check uses only pre-selection information — story-ownership reasoning is deferred to post-selection where it is well-defined.

- If `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml.pre-step10-backup` exists, a prior step-10 run crashed mid-commit. Write gate marker `gate_type: "commit-failed"` and STOP, asking whether to retry the commit, investigate, or revert. This check runs first because the backup file's mere presence is itself the recovery signal.
- Else, if any tracked-file modification or untracked path remains in `git status --porcelain=v1 -z` after filtering coordination files → write gate marker `gate_type: "dirty-tree"` and STOP, asking the user to commit, stash, or discard. Do not classify or reason about ownership at this stage; any non-coordination dirty path is a stop.
- Otherwise (truly clean except coordination files) → proceed.

Do NOT auto-revert. Tree-state ambiguity is always a user decision.

Read `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml`.

**Story-key uniqueness assertion.** After parsing sprint-status.yaml, build the set of all story-keys within the active epic. If any duplicates exist (manual edit error, partial merge), write gate marker `gate_type: "schema-violation"` and STOP. Question: `Director: duplicate story-key "{key}" found in sprint-status.yaml. Fix the file (de-dupe or rename) and confirm before proceeding. [gate-id: ...]` Do not auto-resolve.

**Define "current epic"** as the earliest epic (lowest T-number) that has any story not in status `done`. Work only within the current epic until it is fully `done`.

Then decide which story to run by scanning stories within the current epic **in file order** (top to bottom):

- If any story in the current epic is in status `in-progress`, `ready-for-dev`, or `review` → **do NOT start a new story.** Write a gate marker with `gate_type: "in-flight-resume"` (see Loop pause protocol) and STOP: ask whether to resume it, abandon it, or investigate. Do not guess.
- Otherwise, select the first story in status `backlog` within the current epic. This is the selected story.
- If the current epic has no `backlog` story AND every story in it is `done` → the epic is complete. Write a gate marker with `gate_type: "epic"` and STOP: announce `Epic {T#} complete. Proceed to epic {next}? Run retrospective? [gate-id: ...]` Do not auto-advance across epics.
- If there is no `backlog` story anywhere AND every epic is `done` → write gate marker `gate_type: "complete"` and STOP. Question: `All epics done. Run final cross-epic codex pass, run retrospective, or close out the program? [gate-id: ...]` This marker prevents `/loop` from re-running orient-and-finding-nothing every iteration after program completion.

Announce the selected story in one line: `Director: running {story-key} — {title}`.

### 2. Create the story spec (tournament variant)

Invoke the create-story workflow explicitly against the tournament yaml:

- Load `_bmad/core/tasks/workflow.xml`.
- Pass `workflow-config` = `_bmad/bmm/workflows/4-implementation/create-story/workflow-tournament.yaml`.

**Hard guard.** If the workflow-config path is not the `-tournament.yaml` variant, write gate marker `gate_type: "workflow-misconfig"` and STOP. Question: `Director: create-story workflow-config is not the tournament fork (got: {path}). Restore the tournament fork or hand-craft the story manually? [gate-id: ...]` Do NOT fall back to the Wolf Cup `workflow.yaml`. Do not invoke the `/bmad-bmm-create-story` slash command directly — it loads the Wolf Cup variant.

This writes the story file to `_bmad-output/implementation-artifacts/tournament/{story-key}.md` and flips the story status to `ready-for-dev` in `sprint-status.yaml`.

### 3. Codex-review the spec

Invoke `mcp__codex_review__review_code`:

- `workspace_root`: `D:/wolf-cup`
- `review_request`: story goal + acceptance criteria + "review spec for ambiguity, missing ACs, path-allowlist violations, boundary violations vs FD-1/FD-2, and layering errors (forward FKs, schema-not-yet-migrated, contradicts architecture)"
- `paths`: `["_bmad-output/implementation-artifacts/tournament/{story-key}.md"]`
- `output_path`: `_bmad-output/reviews/{story-key}-spec-codex.md`  (**unique per story and per phase — do not reuse `codex-review-latest.md`**)

**Freshness check (two-signal: STOP only when both fail).** After the MCP call returns, evaluate two independent signals. Neither alone is sufficient to STOP; STOP fires only when both indicate staleness.

1. **Reviewed-files signal (primary).** Read the report's "Reviewed files" header line. Confirm it contains the path(s) you passed in `paths`. If the path matches → signal PASS. If the path is missing → signal FAIL (suspicious; consult signal 2).
2. **mtime signal (secondary).** Capture the current wall-clock time `T_call_returned` and stat `output_path` for its mtime. If `|T_call_returned − mtime| ≤ 10 minutes` → signal PASS. If drift exceeds 10 minutes (in either direction — future-mtime is also suspicious clock skew) → signal FAIL. mtime drift can be caused by clock skew between MCP host and local filesystem, slow IO, or retries inside MCP — none of which alone mean the report is wrong.
3. **Decision matrix:**
   - Both PASS → proceed.
   - Reviewed-files PASS, mtime FAIL → log a note (`Note: codex report mtime drifted {N} minutes; Reviewed-files matched, proceeding`) and proceed. Do NOT STOP — Reviewed-files is the strong signal.
   - Reviewed-files FAIL, mtime PASS → log a note (`Note: codex report Reviewed-files header did not include {path}; mtime fresh, proceeding with caution`) and proceed. The MCP may have written the report to a different scope key than expected; check the Findings section actually references your file before applying any auto-fix. Do NOT STOP on this alone.
   - Both FAIL → write gate marker `gate_type: "codex-stale"` and STOP.
4. Retry once before stopping the first time; if retry is also FAIL/FAIL, write the marker and STOP.
5. Quote the file header (`Generated`, `Model`, `Reviewed files`) and the finding count in your announcement.

Do NOT match the report's header date string against today's date — timezone offsets and format variance (`2026-04-30` vs `Apr 30 2026`) cause false negatives.

Apply **the findings gating rule** (see below). If the spec passes or all High findings are auto-fixed cleanly, proceed to step 4. If any High requires user input, write gate marker `gate_type: "codex-high-user-decision"`, set `context_path` to the codex report, and STOP. Question: `Codex flagged a High on the spec that requires your decision: "{finding-summary}". Apply the suggested fix, defer to followups, or stop the cycle? [gate-id: ...]`

### 4. Spec gate (user, with opt-in auto-approve)

After spec codex review (and any auto-applied fixes + re-review):

**Auto-approve check (only if `auto_approve_clean_specs: true` in director config):**

If ALL of the following hold:
1. Codex returned `PASS` with **zero** High findings AND **zero** Medium findings.
2. The spec contains a clearly delineated, machine-checkable list of intended edit paths under a section literally titled `## Files this story will edit` (or `### Files this story will edit`) where each entry is a single repo-relative path on its own line, optionally prefixed with `- `. Free-form prose is NOT acceptable; "or equivalent" is NOT acceptable. If the section is absent, contains glob patterns or directory references instead of explicit paths, or mixes paths with prose annotations that prevent line-by-line classification, auto-approve is disallowed and the director MUST fall back to the manual `spec` gate. Once a parseable list is found, every listed path must classify into ALLOWED. Zero SHARED, zero FORBIDDEN.
3. No mechanically-applied fixes were required during step 3 (i.e., codex was clean on first pass — `FIXED N` does NOT auto-approve, only true `PASS`).

Then: announce `Director: spec auto-approved per .director-config.json (codex PASS, 0 H/M, declared files all ALLOWED)`, skip the user gate, and proceed to step 5. The auto-approval will be recorded in the commit body at step 10c. Note that step 5b's pre-test classification gate will still catch any post-spec edits that drift outside the declared list — auto-approve does not weaken that gate.

Otherwise (any check fails, or auto-approve disabled): write a gate marker with `gate_type: "spec"`, generate gate-id token per the Loop pause protocol, and STOP with the user-facing message:

> "Spec for {story-key} approved? Codex: {PASS | FIXED N | STOP-on-High description}. Proceed to implementation? `[gate-id: {director_message_id}]`"

The `[gate-id: ...]` substring is the conversation anchor for step 0's resume procedure. End the message there. Take no further actions until the user answers. Under `/loop`, the next iteration's step 0 detects the pending gate and idles (see "Loop pause protocol").

### 5. Implement (tournament variant)

Flip the story status in `sprint-status.yaml` to `in-progress`. Then invoke dev-story explicitly against the tournament yaml:

- Load `_bmad/core/tasks/workflow.xml`.
- Pass `workflow-config` = `_bmad/bmm/workflows/4-implementation/dev-story/workflow-tournament.yaml`.
- Pass `story_path` = `_bmad-output/implementation-artifacts/tournament/{story-key}.md` **explicitly** (do not rely on auto-discovery — the tournament fork scopes `implementation_artifacts` to the tournament subfolder as a safety net, but explicit input is the primary safeguard).

**Hard guard.** If the workflow-config path is not the `-tournament.yaml` variant, write gate marker `gate_type: "workflow-misconfig"` and STOP. Question: `Director: dev-story workflow-config is not the tournament fork (got: {path}). Restore the tournament fork or implement manually? [gate-id: ...]` Do NOT fall back to the Wolf Cup `workflow.yaml`. Do not invoke the `/bmad-bmm-dev-story` slash command directly — it loads the Wolf Cup variant.

During implementation, every file edit must classify into ALLOWED. Any SHARED file edit requires pausing for user approval BEFORE making the edit. Any FORBIDDEN file edit is a HARD STOP; revert immediately and note in the story's followups.

### 5b. Pre-test path classification gate (catches wrong-tree edits before tests)

After dev-story returns, before step 6 regression tests, run `git status --porcelain=v1 -z` and enumerate every changed path (staged, unstaged, untracked — minus the coordination files).

**Parsing note (cross-reference step 10b):** records are NUL-separated. Rename and copy entries (`R `, `C ` status codes) emit two consecutive records: the ORIGINAL path FIRST, then the renamed/copied path SECOND. Classify BOTH old and new paths independently — if either side is SHARED or FORBIDDEN, treat as a HARD STOP. The most common boundary-violation case is a rename whose old path lives in FORBIDDEN (Wolf Cup) and new path lands in ALLOWED (tournament). The `R  old -> new` arrow form is the v1 default-format output (without `-z`) and does NOT appear in `-z` mode; do not parse for the arrow.

For every path, classify into ALLOWED / SHARED / FORBIDDEN:

- Any FORBIDDEN → HARD STOP. Write gate marker `gate_type: "forbidden-path"` listing the exact path(s). Question: `Director: dev-story touched FORBIDDEN path(s) {paths}. This is a Wolf-Cup-boundary or schema-violation edit; tournament-director cannot approve and the resume protocol does not allow "approve". Reply with one of: revert (discard the change), extract (move it to a separate Wolf Cup task), or abandon (revert the whole story). [gate-id: ...]` See "Interpreting user answers" below — `forbidden-path` is the one gate type for which `decision: approve` is INVALID.
- Any SHARED not yet approved → HARD STOP. Write gate marker `gate_type: "shared-approval"` listing the exact paths. Question: `Director: dev-story touched SHARED path(s) {paths}. Approve, revert, or abandon? [gate-id: ...]`
- Any path outside ALLOWED that is not in FORBIDDEN or SHARED → HARD STOP. Write gate marker `gate_type: "shared-approval"` (path needs human classification) and ask the user to classify before proceeding.

This gate exists because step 10's classification pass catches violations only at commit time, after tests + codex have already burned cycles on tainted state. Catching at step 5b lets the user revert before the workflow commits to that path.

If all paths classify into ALLOWED (or SHARED with prior approval) → proceed to step 6.

### 6. Run regression tests

Before codex-review-on-impl, run the full regression set:

- `pnpm --filter @wolf-cup/engine test`
- `pnpm --filter @wolf-cup/api test`
- `pnpm --filter @tournament/api test` (when the tournament-api workspace has tests)
- `pnpm --filter @tournament/web test` (when applicable)
- `pnpm -r typecheck`
- `pnpm -r lint`

**Pass rule: no regressions.** Every previously-passing test must still pass; typecheck and lint must be clean. Report totals for context (they are informational, not a pass gate). If any suite has fewer passing tests than before this story started, write gate marker `gate_type: "tests-failed"` and STOP. Question: `Director: regression detected — {suite} dropped from {prev-count} to {curr-count} passing. Investigate root cause? [gate-id: ...]` Never delete or skip tests to make the count match.

If any check fails and the cause is outside the Tournament allowlist, write gate marker `gate_type: "tests-failed"` (with the failing-paths summary in the question) and STOP; do not cross-work to fix Wolf Cup code. If the cause is within the allowlist, fix it, re-run, and document in the story file. Only write the gate marker if the failure persists after a single in-allowlist fix attempt — fix-and-rerun loops within the same invocation are fine.

### 7. Codex-review the implementation

Capture the change set using the same union approach as the pre-commit verification step:

- `git diff --cached --name-only` (staged tracked changes)
- `git diff --name-only` (unstaged tracked changes)
- `git status --porcelain=v1 -z` (untracked files, renames, deletions — parse the status codes)

The union of these three, de-duplicated, is the codex `paths` input. Do NOT use `git diff --name-only HEAD` — it mixes staged/unstaged and omits untracked files (see the Verification step above). Verify every path classifies into ALLOWED or approved-SHARED before proceeding (step 5b should already have made this true, but re-check in case the dev-story added more files between step 5b and step 7).

Invoke `mcp__codex_review__review_code`:

- `review_request`: story acceptance criteria + "review implementation for correctness, allowlist violations, security (path traversal, injection, prompt-injection for any LLM-facing code), missing tests, drift from spec, and any unreviewed post-implementation edits. **External-integration check:** if the diff touches any external API client (e.g., new imports of `@anthropic-ai/sdk`, `arctic`, raw `fetch`/`axios` against external hosts), or modifies anything under `apps/tournament-api/src/integrations/**`, flag any absence of a real-API smoke test or HTTP-roundtrip test as a Medium finding (per the 2026-04-26 lesson — codex/party/mocked-unit-tests missed an Anthropic strict-mode subset bug that only real-API smoke caught)."
- `paths`: the union from above
- `output_path`: `_bmad-output/reviews/{story-key}-impl-codex.md` (**unique per story and per phase**)

Run the freshness check (step 3's mtime-based procedure). Apply the findings gating rule. If all findings clear or are auto-fixed cleanly, proceed to step 8. If any High requires user input, write gate marker `gate_type: "codex-high-user-decision"`, set `context_path` to the impl codex report, and STOP. Question: `Codex flagged a High on the implementation that requires your decision: "{finding-summary}". Apply the suggested fix, defer to followups, or stop the cycle? [gate-id: ...]`

**No-drift rule.** After impl codex-review passes, do NOT modify any code until party-mode or the user explicitly directs it. If any file changes between the impl codex-review and the party-mode step, re-run impl codex-review against the new diff before proceeding.

### 8. Flip status to `review` and run party-mode review

Update the story status in `sprint-status.yaml` to `review`.

Invoke the `bmad-party-mode` skill. Instruct the party to produce a **single, non-interactive written review** of the implementation to `_bmad-output/reviews/{story-key}-party-review.md`, covering the analyst, architect, pm, qa, and dev perspectives: does this meet the acceptance criteria? Gaps, missed edge cases, architectural concerns, UX issues, test coverage holes?

**Party gate (STOP if interactive).** After party-mode completes:

- If the party output contains any direct questions, unresolved disagreements between agents, or explicit requests for user input → STOP. Write a gate marker `gate_type: "party-clarification"` with a single consolidated question to the user (the question text MUST contain the literal `[gate-id: {director_message_id}]` substring per the Universal gate-write contract). Do not proceed to step 9 until the user answers. Once answered, optionally re-run party-mode with the answer to produce a resolved written review, then continue.
- If the party output is a clean written review with no open questions → proceed.

If the resolved party review surfaces required changes:

- Classify each proposed change into ALLOWED / SHARED / FORBIDDEN per the allowlist. FORBIDDEN → note in followups, do not implement. SHARED → STOP for user approval before editing.
- Implement approved ALLOWED changes.
- Re-run step 6 (regression tests) after any code changes.
- Re-run step 5b (path classification) after any code changes.

### 9. Codex-review the party-mode output + any resulting changes

Invoke `mcp__codex_review__review_code`:

- `review_request`: story acceptance criteria + party-review summary + "review party-mode output and any resulting code changes for correctness, completeness, and drift from spec; flag any party recommendations that were accepted but not implemented, or that cross allowlist boundaries"
- `paths`: `["_bmad-output/reviews/{story-key}-party-review.md", ...any files changed after step 7...]`
- `output_path`: `_bmad-output/reviews/{story-key}-party-codex.md`

Freshness check (mtime-based) + gating rule. If any High requires user input, write gate marker `gate_type: "codex-high-user-decision"`, set `context_path` to the party codex report, and STOP. Question: `Codex flagged a High on the party-mode review or post-party changes that requires your decision: "{finding-summary}". Apply the suggested fix, defer to followups, or stop the cycle? [gate-id: ...]` Otherwise proceed.

### 10. Stage and commit (atomic with status=done)

This step is atomic with respect to the story status: the `sprint-status.yaml` flip from `review` to `done` is staged WITH the implementation files and lands in a SINGLE commit. The earlier two-write pattern (commit, then a separate yaml write to flip status) had a crash window where the story could be committed but stuck at `review` indefinitely; the atomic pattern below eliminates that window.

**Failure-recovery contract** (covers ALL failure modes after step 10a, not just commit-hook rejection):

Before any yaml write, the director MUST:

0. **Pre-existing-backup check.** If `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml.pre-step10-backup` already exists at step 10 start, a prior step-10 run crashed mid-flight and the dirty-tree check at step 1 should have caught it; if execution somehow reached this point with the backup present, STOP immediately with `gate_type: "commit-failed"`. Do NOT overwrite the existing backup — that would erase the recovery anchor for the prior crash.
1. Read the current contents of `sprint-status.yaml` and write a byte-exact backup to `sprint-status.yaml.pre-step10-backup` via temp-write-and-rename (atomic on Windows/NTFS for same-drive rename). This backup captures the WORKING-TREE state — including any unrelated user edits that might be in flight on that file.
2. Proceed with steps 10a–10c.
3. On ANY failure between 10a and a successful 10c (yaml write fails, staging fails, classification gate triggers HARD STOP, pre-commit verification fails, `git commit` returns non-zero, pre-commit hook rejection, OS-level interrupt, etc.):
   a. Restore the working-tree yaml from the backup by atomically renaming `sprint-status.yaml.pre-step10-backup` → `sprint-status.yaml`. Do NOT use `git checkout -- sprint-status.yaml`; that would discard any unrelated user edits in flight on that file.
   b. **Restore the index/staged state.** If `sprint-status.yaml` was already staged (i.e., the failure occurred AFTER step 10c's "stage immediately before commit" rule had run, but BEFORE `git commit` succeeded), Git left the index containing the `status: done` version even though the working-tree now reads `status: review`. Run `git reset HEAD -- sprint-status.yaml` to unstage it, then verify with `git diff --cached -- sprint-status.yaml` that the staged version no longer differs from the working tree's restored content. If a discrepancy remains, STOP with `gate_type: "commit-failed"` and ask the user — automated index recovery cannot reconcile a partial commit safely.
   c. The other staged paths (impl files, tests, etc.) are left as-is in the index. The user can choose at the `commit-failed` gate to retry the commit with the same staged set, or unstage them via `git reset HEAD .` and start over.
4. After successful commit (10c), delete the backup file.

The director must NEVER use `git checkout`, `git restore`, `git reset --hard`, or any destructive path-based revert on `sprint-status.yaml` as part of step 10 recovery. Backup-and-rename for the working tree, plus `git reset HEAD --` for the index, are the only sanctioned recovery operations.

#### Step 10a (prepare yaml)

Compute the new yaml content with the story's `status: done`. Write to a temp file `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml.tmp`, validate it parses as YAML, then rename to `sprint-status.yaml`. Verify no other story's status changed by diffing temp vs original (the current working-tree state, equivalently the backup file) before rename.

#### Step 10b (enumerate change set + stage)

Run `git status --porcelain=v1 -z` and enumerate every file to be committed. Records are NUL-separated. **Rename and copy entries (`R `, `C ` status codes) emit two consecutive records: the ORIGINAL path FIRST, then the renamed/copied path SECOND.** This is canonical Git behavior in porcelain v1 with `-z`. The `R  old -> new` arrow form is the v1 default-format output (without `-z`) and does NOT appear in `-z` mode; do not parse for the arrow when `-z` is used.

For each path, read the two-character status code (columns 1–2) and apply the path classification gate: any FORBIDDEN → HARD STOP, revert; any SHARED not-yet-approved → HARD STOP, request approval.

**Staging by status code (MUST), with explicit sprint-status.yaml carve-out:**

**Carve-out (read first):** the path `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml` is EXCLUDED from step 10b's bulk staging — even though step 10a has just modified it (so it will appear with status code `M ` or ` M`), it MUST NOT be staged here. It is staged exclusively in step 10c, immediately before `git commit`. This delay is the index-hazard mitigation from the failure-recovery contract; staging it during 10b's pass would defeat the contract. Treat it as if it were a coordination file: enumerate it, recognize it, skip it, do not classify it as needing a `git add`.

For every OTHER path:

- **` M` / `M ` / `MM` / `A ` / `AM` (modified or added tracked file):** `git add -- <path>`.
- **`D ` / ` D` (deleted):** `git rm -- <path>` (or equivalently `git add -u -- <path>`). A plain `git add <deleted-path>` does NOT stage the deletion reliably.
- **`R ` (renamed):** stage both sides — `git add -- <new-path>` AND `git rm -- <old-path>`. Getting the order wrong deletes the wrong file.
- **`C ` (copied):** `git add -- <new-path>`.
- **`??` (untracked):** classify the path first (ALLOWED / SHARED / FORBIDDEN). Then apply the **authorship test** below.
- **`UU` / `AA` / `DD` / `AU` / `UA` / `DU` / `UD` (merge conflict, unmerged):** **HARD STOP.** The director does NOT auto-resolve merge conflicts. Report the unmerged paths and wait for user direction. Do not stage anything.

**Authorship test for untracked (`??`) files:**

Ask: did this invocation's dev-story / implementation step create this file as part of the current story?

- **Yes** (e.g., a new tournament source file you wrote, a new migration, a new test file) → stage it with `git add -- <path>`. The story commit is incomplete without it.
- **No** (e.g., editor swap files, stray build artifacts, log files, tool scratch output, anything pre-existing you did not write this invocation) → do NOT stage. Do NOT delete. Note the file in the report and leave it in the working tree.
- **Uncertain** → STOP, ask the user whether the file is part of the story.

Never use `git add -A`, `git add .`, or `git add <directory>` without enumerating per-path.

**Required-inclusion rules:**

- The updated `sprint-status.yaml` (with this story now `status: done`) MUST be staged at step 10c **immediately before `git commit`**, NOT during step 10b's bulk staging pass. This delay is intentional: it minimizes the window in which a step-10b-or-pre-commit failure leaves a `status: done` row sitting in the index. Step 10b stages every other story-owned file; step 10c stages sprint-status.yaml as its first action, then runs the pre-commit verification checks, then issues `git commit`.
- If any `package.json` in the repo (root OR any `apps/tournament-*/package.json`) has changes in `dependencies`, `devDependencies`, `peerDependencies`, or `optionalDependencies` → `pnpm-lock.yaml` MUST be included. Since `pnpm-lock.yaml` is SHARED, STOP and request approval to include it. Do not commit workspace `package.json` dep changes without the lockfile update; that leaves installs/tests inconsistent.
- If a new DB migration file exists in `apps/tournament-api/drizzle/**` (or wherever the tournament app writes migrations) → it MUST be in the commit.
- If new files exist in any ALLOWED path that are part of the story → they MUST be staged.

**Pre-commit verification (all four MUST hold):**

- `git diff --cached --name-only` is non-empty.
- `git diff --name-only` (unstaged tracked changes) is empty — every tracked edit that is part of the story is staged.
- No lines in `git status --porcelain` have merge-conflict codes (`UU`, `AA`, `DD`, `AU`, `UA`, `DU`, `UD`). If any do → HARD STOP, do not commit.
- Every `??` (untracked) line remaining in `git status --porcelain` has passed the authorship test as "NOT part of this story" (story-authored untracked files should already be staged, leaving them as `A ` rather than `??`). Pre-existing untracked files are allowed to remain unstaged in the working tree post-commit.

Coordination files (`.director-pending-gate.json`, `.director-config.json`, `sprint-status.yaml.pre-step10-backup`, `sprint-status.yaml.tmp`) are excluded from classification and MUST NOT be committed.

#### Step 10c (stage sprint-status.yaml and commit, atomically)

First action: stage `sprint-status.yaml` (with the new `status: done`) via `git add -- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml`. This is the LAST file staged before commit, by design (see required-inclusion rules above). Then re-run the pre-commit verification checks (now including sprint-status.yaml in the staged set) — `git diff --cached --name-only` non-empty, `git diff --name-only` empty, no merge-conflict codes, no unauthored `??` lines. Only if all four hold, proceed to `git commit`.

Commit with a message of the form:

```
tournament: {story-key} {short title}

{1-3 sentence body describing what shipped}

Codex: spec {PASS|FIXED N|auto-approved}, impl {PASS|FIXED N}, party {PASS|FIXED N}
```

If the spec was auto-approved per the director config (step 4 auto-approve check), the spec line MUST read `Spec gate: auto-approved (codex PASS, 0 H/M)` somewhere in the body so the audit trail is preserved.

No `Co-Authored-By` footer unless the user has asked for one. No push.

If the commit succeeds, delete the backup file `sprint-status.yaml.pre-step10-backup` and capture the sha for the report. The story is now `done` AND committed in the same atomic step.

If the commit fails (pre-commit hook rejection, signature failure, IO error, anything non-zero), restore yaml by atomically renaming the backup file (`pre-step10-backup` → `sprint-status.yaml`), per the failure-recovery contract above. Do NOT use `git checkout`. Then write a gate marker `gate_type: "commit-failed"` and STOP. The story status is now back to `review` (the pre-step-10a state, byte-exact); next iteration's orient will route through `in-flight-resume` for the `review` state.

### 11. Reserved — folded into step 10

Status is now `done` AND committed in the same atomic step. This step number is preserved for reference; the original ordering bug (where the status flip happened in a separate post-commit step, with a crash window leaving the story stuck at `review`) is fixed by folding the work into step 10.

### 12. Report and stop (or loop)

Report in ≤8 lines:

- Story: `{story-key}`
- Spec codex: PASS / FIXED N / STOPPED-on-High / auto-approved
- Tests: engine Δ, api Δ, tournament-api Δ (deltas vs start-of-story)
- Impl codex: PASS / FIXED N
- Party review: `{reviews/{story-key}-party-review.md}` — N recommendations, M implemented
- Party codex: PASS / FIXED N
- Commit: `{sha}` (local, unpushed; status=done included)
- Next in queue: `{next-story-key}` or "epic {T#} complete — awaiting user gate"

If the current epic is now complete, STOP and wait for the user to clear the epic-level gate.

---

## Findings gating (applies to every codex-review call)

For each finding codex returns, classify it into exactly one bucket:

### Low / Medium
- Report in the final summary. Do not block.
- Note in the story file's `risks` or `followups` section if it's load-bearing or a known-limitation.
- A Medium finding does NOT auto-approve a clean-spec gate (step 4 auto-approve requires zero H/M).

### High — **mechanically fixable** (apply the fix, re-review once, continue)

A High finding is "mechanically fixable" **ONLY IF ALL of the following are true**:

1. Codex provides a concrete patch-level fix (specific code change with specific file/line).
2. The observation is verifiably correct — you can confirm it by inspecting the code.
3. The fix does NOT change any of:
   - Acceptance-criteria wording
   - Public API or route contracts
   - Authentication or authorization semantics
   - Dependencies (adding, removing, or upgrading packages)
   - Database schema or migrations
   - Error-handling or user-visible behavior beyond strict correctness
4. The fix touches only ALLOWED paths (any SHARED or FORBIDDEN path → not mechanically fixable).
5. You can and will **quote the exact codex text** AND **quote the exact diff you plan to apply** in your announcement before applying.

If any of 1–5 fails, the finding is NOT mechanically fixable. Treat as "requires user decision."

After auto-applying a fix, **re-run codex-review once**. If the re-review still flags High in the same area, treat as "requires user decision." A fix applied via this path means the spec gate at step 4 is NOT eligible for auto-approve (the auto-approve check requires `PASS` on first pass, not `FIXED N`).

### High — **requires user decision** (STOP)

Anything not meeting all five criteria above. Examples:
- "This endpoint's auth model may conflict with T1.6 tenant realm" → scope/arch question, STOP.
- "Coupling suggests the data layer should be split" → refactor judgment, STOP.
- "Missing validation on req.body.courseId; add z.string().uuid()" → passes 1–5 → **mechanically fixable**.
- "Path traversal risk on upload; sanitize with path.basename and reject `..`" → passes 1–5 → **mechanically fixable**.
- "Should we add rate limiting here?" → judgment, STOP.
- "This touches pnpm-lock.yaml" → SHARED path, STOP.
- "Integration touches @anthropic-ai/sdk but no real-API smoke test exists" → user decision (do you want to add one this story or defer?), STOP.

**Honesty check.** If you catch yourself writing "I think this is probably fine because…" — that is judgment, not mechanics. STOP.

---

## Loop pause protocol

Every user gate must cleanly pause the loop. Because conversational context is not a reliable signal across loop iterations on its own, gate state MUST be persisted to the filesystem AND anchored in the conversation by an explicit gate-id substring.

### Gate marker file

- **Path**: `_bmad-output/implementation-artifacts/tournament/.director-pending-gate.json`
- **Contents (JSON)**:
  ```json
  {
    "story_key": "T5-5-cross-group-stroke-play-leaderboard-v1",
    "gate_type": "spec | party-clarification | shared-approval | forbidden-path | codex-high-user-decision | epic | in-flight-resume | mcp-failure | codex-stale | dirty-tree | commit-failed | tests-failed | workflow-misconfig | schema-violation | complete",
    "question": "<single explicit question shown to the user, MUST contain the literal substring [gate-id: <director_message_id>]>",
    "context_path": "<optional: path to relevant artifact — codex report, party review, etc.>",
    "director_message_id": "<{story-key}-{phase-tag}-{8-hex-token}; e.g., 'T5-5-cross-group-stroke-play-leaderboard-v1-spec-a3f9b211'>"
  }
  ```

**Universal gate-write contract** (applies to EVERY gate listed in the enum above, no exceptions):

1. The marker JSON's `director_message_id` is generated at gate-write time per the "Writing the marker" rule below.
2. The user-facing message MUST contain the literal substring `[gate-id: {director_message_id}]` somewhere in the question text. Without this substring, step 0 cannot anchor the gate to the conversation on resume, and `/loop` will lose the pause state across iterations.
3. Per-step text for steps 1, 4, 5b, 8, and 10 may write gate markers with concise instructions like "STOP with `gate_type: \"X\"`" — when the director encounters that instruction, it MUST execute the full marker-write protocol from this contract: write the marker file atomically, embed `[gate-id: ...]` in the user message, end the message with a single explicit question, take no further actions. Stopping without writing the marker is a contract violation that breaks `/loop`'s pause semantics.
4. The `phase-tag` portion of `director_message_id` MUST equal the chosen `gate_type` value verbatim — no abbreviations, no aliases. Example: gate_type `codex-stale` → director_message_id `T5-5-cross-group-stroke-play-leaderboard-v1-codex-stale-a3f9b211`. This guarantees the marker JSON's gate_type and director_message_id are unambiguously linked, and the conversation anchor `[gate-id: ...]` substring uniquely identifies which gate type the director is paused on.

The marker intentionally does NOT store a clock timestamp as the resolution signal. Resolution is based on:
1. **Conversation anchor** — the literal `[gate-id: {director_message_id}]` substring must appear in an assistant message; that is the gate-write turn.
2. **Position-after-gate-write** — only user messages that appear after the anchor turn count as candidate resolutions.
3. **Message content** — does the user's reply resolve the gate question?

The director CREATES this file at every STOP gate and DELETES it only when resolved.

While the marker exists, the director MUST NOT open/read/write any artifact besides the marker file itself.

`.director-pending-gate.json` lives under an ALLOWED path (`_bmad-output/implementation-artifacts/tournament/**`) but MUST NOT be staged or committed. Step 10's classification pass skips this file and the other coordination files listed above.

### Writing the marker (atomicity)

At every STOP gate:

1. Generate the gate-id token: 8 hex characters drawn from system entropy (e.g., `python -c "import secrets; print(secrets.token_hex(4))"` or `openssl rand -hex 4`). Do NOT hash context, conversation content, or any deterministic input — collisions across iterations would break anchor uniqueness.
2. Construct the full JSON payload with `director_message_id: "{story-key}-{gate_type}-{token}"`. Per the Universal gate-write contract item 4, the phase-tag portion equals the `gate_type` value verbatim (no abbreviations).
3. Write to a temp path first: `{marker-path}.tmp`.
4. Rename `.tmp` → final path (atomic on Windows/NTFS for same-drive rename).
5. Never write the final path directly; a crash mid-write leaves a corrupt marker that step 0 cannot distinguish from a valid one.

**Collision risk note.** 8 hex chars = 32 bits = ~4.3 billion combinations. Birthday-collision probability across 1,000 lifetime gates is ~0.00001%. Across 100,000 lifetime gates is ~0.1%. Acceptable for this workload.

**False-anchor risk note.** Step 0's substring search for `[gate-id: {director_message_id}]` is a literal-string match. If the user pastes the gate-id back in their reply (e.g., quoting the question), step 0 sees TWO conversation positions containing the substring — the original assistant gate-write turn and the user's reply. The rule is "the most recent ASSISTANT message containing the substring is the gate-write turn"; step 0 must filter by message role, not just substring presence. User messages containing the substring do not count as anchors; they may, however, count as resolution candidates.

### Procedure at every STOP gate

1. Write the marker atomically (above).
2. Your final user-facing message MUST include the literal substring `[gate-id: {director_message_id}]` somewhere in the question text (typically at the end). This is what step 0 searches for on resume.
3. Your final message MUST end with a single explicit question on its own line.
4. After writing that message, take no further tool actions in the same turn.

### Procedure at the start of every invocation (MUST run at step 0, BEFORE step 0a config-read)

1. Check whether `_bmad-output/implementation-artifacts/tournament/.director-pending-gate.json` exists.
2. If it does NOT exist → proceed to step 1.
3. If it exists, read it. If the JSON is malformed, missing required fields (`story_key`, `gate_type`, `question`, `director_message_id`), or otherwise corrupt → **STOP immediately** with a one-line message: `Director: gate marker is corrupt at {path}. Manual recovery needed — inspect the file, then either delete it to clear the gate or fix the JSON.` Do not auto-delete.
4. If the JSON parses cleanly, locate the gate-write anchor by searching the conversation for the literal substring `[gate-id: {director_message_id}]`. The most recent **assistant** message containing that substring is the gate-write turn. (Filter by role; user messages quoting the gate-id are not anchors.)
   - If no assistant message contains the substring → the marker is orphaned. STOP with: `Director: gate marker {director_message_id} has no conversation anchor. Manual recovery needed — delete the marker to clear, or this is a /loop iteration where the prior turn was lost.` Do not auto-delete.
   - If the substring is found, scan for any user message that appears **AFTER** the anchor turn (position-based, not clock-based).
5. Apply the user-message classification:
   - No user message after the anchor → write one line, **redacted to never re-emit `[gate-id: ...]`**: `Director: still awaiting answer (gate type: {gate_type}, marker id: {director_message_id}). Idle this iteration.` Note: the idle line MUST NOT quote the marker's `question` field (which contains `[gate-id: ...]`), and MUST NOT spell out the bracketed `[gate-id: ...]` form. Use the bare `director_message_id` token only. Re-emitting the bracketed substring would create a second anchor in the conversation; the next iteration's "most recent assistant message containing the substring" would shift to the idle message, causing the user's actual reply to be classified as "before the anchor" and ignored indefinitely. Stop. Do NOT re-read sprint-status.yaml, re-invoke any workflow, re-run codex, or re-ask the question.
   - User message exists → classify its content (see "Interpreting user answers" below). If resolving → delete marker, apply the resolution, continue to step 0a. If ambiguous → keep marker, idle, do not re-ask.

### Interpreting user answers

Classify the user's reply that came after the gate was written:

- **Clear affirmative to the gate question** ("yes", "approved", "proceed", "go ahead", "ship it", or a direct positive answer to the specific question) → marker resolved with `decision: approve`. Delete marker, continue. **EXCEPTION: `forbidden-path` is non-approvable.** If the marker's `gate_type` is `forbidden-path` and the user's reply is a clear affirmative, the affirmative is INVALID — Wolf Cup boundary edits cannot be approved by the director's gate flow. Do NOT delete the marker; instead, write a one-line clarification: `Director: forbidden-path gate cannot be resolved with "approve" — the path is across the Wolf Cup boundary (FD-1/FD-2). Reply with one of: revert (discard the change), extract (move it to a separate Wolf Cup task), or abandon (revert the whole story). Marker remains pending.` Then idle.
- **Clear negative** ("no", "reject", "stop", "cancel", "abandon", "not yet") → marker resolved with `decision: deny`. Delete marker. If the gate was a story-start gate (in-flight-resume, spec) → revert the story to `backlog` in `sprint-status.yaml` and stop the cycle. If the gate was mid-flight (codex-high, codex-stale, mcp-failure, party-clarification, shared-approval, forbidden-path, commit-failed, dirty-tree, tests-failed, workflow-misconfig, schema-violation, complete) → STOP the cycle but leave the story in its current status; do not auto-revert without user direction.
- **Directive answer** (e.g., for a codex-High gate: "apply the fix codex suggested" or "skip and STOP"; for an mcp-failure gate: "retry now", "skip this story", or "stop the loop"; for a forbidden-path gate: "revert", "extract", or "abandon" — these three are the ONLY valid resolutions for forbidden-path) → marker resolved with `decision: <the specific directive>`. Delete marker, apply.
- **Ambiguous** ("ok", "sure", "maybe later", an emoji, a question back, a comment that doesn't address the gate question) → marker NOT resolved. Idle this iteration, do NOT re-ask in the same turn, do NOT delete the marker.

When in doubt between "resolving" and "ambiguous", treat as ambiguous — it is safer to idle than to auto-resume on a misread answer.

This gives `/loop` a machine-checkable signal across iterations without depending on clock timestamps.

---

## Anti-patterns

- Silently merging codex auto-fixes without re-reviewing.
- Marking status `done` before the commit lands (status flip and commit are atomic per step 10).
- Skipping tests "in the interest of progress."
- Cross-working into Wolf Cup paths to fix adjacent issues.
- Amending commits, force-pushing, or using `--no-verify`.
- Using `git add -A` / `git add .`.
- Reading a stale `codex-review-latest.md` when the MCP call errored — director uses unique per-story-per-phase output paths.
- Writing "this is probably fine" to justify skipping a gate.
- Writing a gate marker without embedding `[gate-id: ...]` in the user-facing question.
- Re-emitting `[gate-id: ...]` in any non-gate-write message (e.g., quoting the marker's `question` field in the step-0 idle line). Step 0's anchor search would mis-resolve to the most recent message containing the substring, ignoring the user's reply.
- STOPping without writing a gate marker on any failure path — every STOP under /loop must persist a marker. Specifically: codex-High user decisions (steps 3/7/9), test failures (step 6), workflow misconfig (steps 2/5), schema violations / duplicate story-keys (step 1), MCP/codex-stale failures, dirty tree, commit-failed, overall completion. Any STOP without a marker is a contract violation that will cause /loop to spin on the failure.
- Auto-approving a spec gate when codex returned `FIXED N` rather than true `PASS` — auto-approve requires zero applied fixes on first pass.
- Auto-approving a spec gate when the spec's `## Files this story will edit` section is missing, uses globs, or contains free-form prose — declared file lists must be machine-parseable for auto-approve to be safe.
- Resolving a `forbidden-path` gate with `decision: approve`. FORBIDDEN paths are not approvable; only revert/extract/abandon directives are valid.
- Using `git checkout`, `git restore`, or `git reset --hard` on `sprint-status.yaml` as part of step 10 recovery — only `git reset HEAD --` (for index) and atomic backup-rename (for working tree) are sanctioned.
- Overwriting an existing `sprint-status.yaml.pre-step10-backup` file at step 10 start. Its presence means a prior run crashed; preserve it as the recovery anchor.
- Mixing porcelain v1 default-format examples (`R  old -> new`) with `-z` mode parsing in the same step.

## Failure modes

- **Story file already exists for the selected `backlog` story** → someone started it manually. STOP; ask whether to resume.
- **`workflow-tournament.yaml` missing for create-story, dev-story, or code-review** → STOP; do not fall back to Wolf Cup variants. Request the missing fork.
- **Tests cannot be resolved** → STOP; report the failure cleanly with logs. Do not skip.
- **Codex MCP unavailable or times out** → retry once. If still failing, write gate marker `gate_type: "mcp-failure"` and STOP. Question: `Codex MCP appears unavailable after retry. Retry now, skip this story, or stop the loop? [gate-id: ...]`
- **Codex output file is stale or missing** → write gate marker `gate_type: "codex-stale"` and STOP. Question: `Codex output for {phase} appears stale (mtime drift > 5min, or report doesn't reference requested path). Retry, investigate, or stop the loop? [gate-id: ...]`
- **Dirty working tree at orient** → write gate marker `gate_type: "dirty-tree"` and STOP. Question: `Working tree is dirty before story start: {paths}. Commit, stash, or discard before continuing? [gate-id: ...]`
- **Commit failed at step 10c** → restore yaml from backup; write gate marker `gate_type: "commit-failed"` and STOP. Question: `Commit failed at step 10c ({error summary}). Retry the commit, investigate, or revert the story? [gate-id: ...]`
- **Party-mode produces no clear output or user is absent** → STOP at the party step; wait for user to resume.
- **A proposed edit is in SHARED and user declines approval** → revert the change; either re-scope the story or STOP for user direction.
- **A proposed edit is in FORBIDDEN** → never attempt; note in followups.
- **Duplicate story-key in sprint-status.yaml** → STOP at orient with schema-violation message; do not auto-resolve.

## Invocation shapes

- **One story**: user types `/tournament-director`. Run exactly one cycle, stop at the final report.
- **Continuous**: user types `/loop /tournament-director`. Run one cycle per iteration, pacing self. Respect every gate via the loop-pause protocol. The loop does not bypass user gates.
- **Auto-approve clean specs**: user creates `_bmad-output/implementation-artifacts/tournament/.director-config.json` with `{ "version": 1, "auto_approve_clean_specs": true }` to skip the spec gate when codex returns PASS with zero High/Med findings on first pass and the spec touches only ALLOWED paths. SHARED-touching specs and Codex-High gates still require manual approval. Toggle off by setting the flag to `false` or deleting the file.
