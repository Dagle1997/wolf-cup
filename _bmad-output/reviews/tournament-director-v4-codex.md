# Codex Review

- Generated: 2026-04-30T23:06:49.263Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: .claude/commands/tournament-director.md, _bmad-output/reviews/tournament-director-v4-improvements-2026-04-29.md, ../Claude/2026/.claude/commands/v10-director.md

## Summary

The v4 command is substantially clearer than v3 (explicit mtime freshness, unique output paths, explicit porcelain -z parsing, step-10 status/commit folding). However, there are several concrete /loop-breaking and boundary-safety issues: (1) step 0’s idle message can unintentionally create a *new* anchor containing the gate-id and introduce a pause/resume race; (2) step 0a config-read-before-gate-check contradicts the loop protocol’s “only read marker” rule; (3) multiple STOP paths still don’t specify a gate marker + gate_type (codex-high user-decision, tests failure, workflow hard-guards, schema violation), which can cause /loop spinning or loss of the specific gate context; (4) step 5b reuses `shared-approval` for FORBIDDEN paths, but the “Interpreting user answers” rules allow “approve → continue”, which is incompatible with FORBIDDEN being non-approvable; (5) step-10 recovery restores the working-tree YAML but does not address the index/staging state, leaving a plausible “status=done still staged” hazard after a failed commit.

Net: the intent is solid, but a future LLM executing this prose could plausibly do the wrong thing on several failure paths, especially under /loop.

Overall risk: high

## Findings

1. [critical] Loop pause/resume race: step 0 idle message likely re-anchors the gate-id and can cause the user’s reply to be ignored indefinitely
   - File: .claude/commands/tournament-director.md:490-496
   - Confidence: high
   - Why it matters: Step 0 defines the anchor as “the most recent assistant message containing `[gate-id: {director_message_id}]`” (lines 490–494). When there is no user message after the anchor, step 0 instructs emitting an idle line that *quotes the full `question` string* (line 494). The marker contract requires `question` to contain the literal substring `[gate-id: …]` (line 440), so the idle message will also contain `[gate-id: …]`.

This creates a real /loop race:
- Iteration N: gate written; marker exists.
- User replies *while iteration N+1 is running* (after step 0 has checked for “user message after anchor” but before it prints the idle message).
- Step 0 prints the idle message quoting `question` (thus re-emitting `[gate-id: …]`).
- Next iteration, step 0 picks the “most recent assistant message containing the substring” — now the idle message — and will only consider user messages after *that* idle message. The user’s reply is now “before the anchor” and will be ignored; the loop can idle forever until manual marker deletion.

This is a new failure mode introduced by the gate-id substring approach combined with quoting the question verbatim during idle.
   - Suggested fix: Change the step-0 idle behavior so it never emits the exact `[gate-id: {director_message_id}]` substring except in the original gate-write turn. Options:
- In the idle line, do **not** quote `question`; instead print a redacted form with the bracketed gate-id removed, or print only `gate_type` + `director_message_id` without the bracket form.
- Or change the anchor selection rule to prefer the **earliest** assistant message containing the substring (or require exactly one assistant anchor and STOP if multiple), which avoids anchor drift if the assistant reprints the substring.
Also explicitly state: “Never repeat `[gate-id: …]` in non-gate messages.”

2. [high] Step 0a reads .director-config.json before pending-gate check, contradicting the loop protocol’s “only read marker file” rule
   - File: .claude/commands/tournament-director.md:106-116
   - Confidence: high
   - Why it matters: The command mandates config read as the “MANDATORY first action” (step 0a, lines 108–111) and only then runs the pending-gate check (step 0, lines 112–116). But the Loop pause protocol states: “While the marker exists, the director MUST NOT open/read/write any artifact besides the marker file itself.” (lines 460–461).

If a pending gate exists, step 0a violates the protocol by reading another file before idling. This is a concrete internal inconsistency: a future executor can’t satisfy both rules simultaneously. Under strict interpretations, this can also reintroduce /loop side effects during a supposed idle iteration.
   - Suggested fix: Pick one:
- Move config read to after the pending-gate check (restore the stronger ‘no artifact reads while gated’ guarantee).
- Or amend the loop protocol to explicitly allow reading **coordination files** (at least `.director-config.json`) before the marker check, and update line 460 accordingly. Be explicit about the allowed set and keep it minimal.

3. [high] Multiple STOP paths still lack explicit gate marker + gate_type instructions (risk: /loop spins or loses the specific gating context)
   - File: .claude/commands/tournament-director.md:143-282
   - Confidence: high
   - Why it matters: The v4 file improves gate coverage, but several STOPs do not name a `gate_type` nor explicitly require marker writing at the point of failure:
- Spec codex High-requires-user-input: step 3 ends with “If any High requires user input, STOP.” (lines 173–174) but does not say to write `gate_type: "codex-high-user-decision"`.
- Impl codex High-requires-user-input: step 7 similarly says STOP (lines 251–252) without a gate marker instruction.
- Party-codex High-requires-user-input: step 9 says STOP (lines 281–282) without a gate marker instruction.
- Regression test failure: step 6 says “STOP and investigate” (lines 231–233) without a gate marker.
- Hard guards for wrong workflow variant: steps 2 and 5 say STOP (lines 150–151, 202–203) with no gate marker.
- Duplicate story-key schema violation: step 1 says STOP with a one-line message (line 130) with no gate marker.
- “Overall completion” path: step 1 says “announce overall completion and stop” (line 139) but does not write a marker; under `/loop` that can repeat every iteration.

Even if step 1’s generic `in-flight-resume` gate eventually pauses the loop for some mid-cycle failures, that loses the *specific* question/context (codex finding, test failure, workflow misconfig) and requires an extra loop iteration to reach a pause state.
   - Suggested fix: For every STOP that expects user action/decision, require an explicit marker write with a specific `gate_type` and a concrete question containing `[gate-id: …]`. Concretely:
- For codex High user-decision in steps 3/7/9: always write `gate_type: "codex-high-user-decision"`.
- For test failures: add a `gate_type` (e.g., `tests-failed`) or reuse an existing one with clear semantics (better: add a distinct enum).
- For workflow misconfiguration/missing fork: add `gate_type: "workflow-misconfig"` (or similar).
- For schema violations like duplicate story-key: add `gate_type: "schema-violation"`.
- For overall completion under `/loop`: write a marker (new `gate_type: "complete"` or reuse `epic` with clear meaning) so /loop doesn’t re-run forever.

4. [high] Step 5b treats FORBIDDEN touches as `shared-approval`, but the answer-handling rules allow “approve → continue” (FORBIDDEN must never be approvable)
   - File: .claude/commands/tournament-director.md:206-505
   - Confidence: high
   - Why it matters: Step 5b says any FORBIDDEN path touch is a HARD STOP but instructs writing `gate_type: "shared-approval"` (lines 212–214), calling it a “slight misnomer”. However, the “Interpreting user answers” section says a clear affirmative resolves the gate with `decision: approve`, deletes the marker, and continues (lines 501–503).

That combination is unsafe/ambiguous: a user could “approve” what is effectively a boundary violation, and the director’s generic resolution logic would treat it like SHARED approval. Even if later commit-time classification would stop, this invites continued execution (tests/codex/party) on a tainted state and undermines the “FORBIDDEN — do not propose a fix” boundary (lines 74–81).
   - Suggested fix: Do not overload `shared-approval` for forbidden. Either:
- Add a distinct `gate_type` such as `forbidden-path` (and update the enum at line 439), with resolution rules that **never** allow ‘approve → proceed’, only ‘revert/extract/abandon’ directives.
- Or, if you insist on keeping a single gate_type, add a required boolean field in the marker (e.g., `"forbidden": true`) and update “Interpreting user answers” to treat approvals as invalid when forbidden is true.
Also remove/replace the claim “marker enum is fixed” (line 212) since the file already evolves the enum.

5. [medium] Step-10 “atomic” recovery restores sprint-status.yaml in the working tree but doesn’t address index/staging state; failed commits can leave `status: done` staged
   - File: .claude/commands/tournament-director.md:287-362
   - Confidence: high
   - Why it matters: The failure-recovery contract says on any failure between 10a and successful 10c, “restore yaml from the backup by atomically renaming … → sprint-status.yaml” (lines 293–294, 361–362). But step 10’s process stages files before commit (10b) and can fail at commit (10c). In common failure modes (hook rejection, commit-msg failure), Git leaves the index intact.

If `sprint-status.yaml` (with `status: done`) was staged and `git commit` fails, renaming the backup file only changes the working tree. The index can still contain the staged `done` version, creating an inconsistent state where:
- `git diff --cached` still shows `status: done` staged,
- the working tree shows `review`,
- a subsequent commit attempt (manual or automated) might commit `done` unexpectedly.

This undermines the “atomic with respect to story status” claim (line 285) in the presence of commit failures.
   - Suggested fix: Extend the recovery contract to restore both working tree *and index* for `sprint-status.yaml` after failures. Examples (describe at prose level, not necessarily prescribing a single command):
- After restoring the backup to the working tree, re-stage the restored file (so index matches review), or explicitly unstage it.
- Alternatively, delay staging `sprint-status.yaml` until immediately before commit, and on failure ensure it is unstaged.
Also add a rule for the case “backup file already exists at step 10 start” (likely indicates prior crash) — stop and ask user before overwriting it.

6. [medium] Auto-approve clean-specs: unclear behavior if the spec lacks a declared file list (could accidentally auto-approve)
   - File: .claude/commands/tournament-director.md:175-187
   - Confidence: high
   - Why it matters: Step 4’s auto-approve check requires that “The spec’s declared ‘files this story will edit’ list (or equivalent …) contains only ALLOWED paths.” (lines 182–184). But it doesn’t define what to do if the story spec does not include such a list, or if it’s ambiguous.

Given the directive treats ambiguity as defect, a future executor could interpret “or equivalent” loosely and auto-approve with insufficient evidence, bypassing the intended user review gate for specs.
   - Suggested fix: Make it explicit: if the story spec does not contain a clearly delineated, machine-checkable list of intended edit paths, auto-approve is disallowed and the director must fall back to the manual `spec` gate.

7. [medium] Orient dirty-tree check is internally ambiguous: it references “current selected story would not own” before story selection occurs
   - File: .claude/commands/tournament-director.md:118-141
   - Confidence: high
   - Why it matters: Step 1 runs a dirty-tree check before reading sprint-status and selecting the story (lines 120–128 vs selection at lines 132–141). But the dirty-tree STOP condition includes: “include any tournament file from a prior incomplete cycle that the current selected story would not own” (line 122).

At that point, there is no “current selected story” yet, so a future executor could implement inconsistent logic (e.g., guessing ownership, re-ordering steps, or skipping the check). This is exactly the kind of prose ambiguity that can cause divergent behavior across runs.
   - Suggested fix: Either:
- Move story selection (read sprint-status, determine selected story) before the dirty-tree ownership reasoning, or
- Rephrase the dirty-tree rule to reference only information available pre-selection (e.g., “any dirty tournament path → dirty-tree gate”) and defer ownership checks until after selection.

8. [low] Step 5b path-classification gate doesn’t specify rename/deletion parsing details (risk: incomplete classification on `git status --porcelain=v1 -z`)
   - File: .claude/commands/tournament-director.md:206-218
   - Confidence: high
   - Why it matters: Step 5b mandates `git status --porcelain=v1 -z` and “enumerate every changed path” (lines 208–214) but does not restate the rename/copy two-record rule that step 10b specifies (lines 304–305). A future executor might parse only the “new” path for renames, missing that the old path can be in a different bucket (boundary crossing), or might mishandle deletions.

Given step 5b’s purpose is to catch wrong-tree edits early, missing old-path classification on renames is a realistic loophole.
   - Suggested fix: In step 5b, explicitly reference the step 10b `-z` parsing rule (two consecutive records for `R `/`C `) and require classifying BOTH old and new paths (and treating either side being SHARED/FORBIDDEN as a stop).

9. [low] Codex “mtime within 5 minutes” freshness check may false-positive under clock skew; no guidance for benign drift
   - File: .claude/commands/tournament-director.md:163-170
   - Confidence: medium
   - Why it matters: The freshness check uses `T_call_returned − mtime > 5 minutes` (lines 165–170). If the filesystem clock is skewed, or if the MCP writes the file but returns significantly later (slow IO, retries inside MCP), this can incorrectly label a fresh report as stale and force an unnecessary `codex-stale` gate.

This is not a correctness bug in the happy path, but it can create avoidable STOPs in real environments.
   - Suggested fix: Widen or make the check more robust, e.g.:
- Allow a larger window (10–15 minutes), and/or
- Check that `mtime` is within a window of the MCP call *start* and *return* times, and treat `mtime` slightly in the future as suspicious rather than auto-pass.
Keep the “Reviewed files contains requested path” check as the stronger signal.

## Strengths

- Universal gate-write contract is explicit and (mostly) consistently referenced, including the `[gate-id: …]` literal substring requirement and atomic marker writes (lines 446–473).
- Unique per-story/per-phase codex output paths (lines 161–162, 249–250) reduce stale-file confusion versus `*-latest.md`.
- Step 10 folding of `review → done` into the same commit is the right direction and matches the motivating failure mode (lines 283–286).
- Porcelain `-z` parsing guidance in step 10b is unusually concrete and avoids the common `R old -> new` mixed-mode trap (lines 304–305).
- Adding a pre-test classification gate (step 5b) is a pragmatic containment layer to avoid burning tests/codex cycles on wrong-tree edits (lines 206–218).

## Warnings

- Git diff could not be loaded for the selected files.
