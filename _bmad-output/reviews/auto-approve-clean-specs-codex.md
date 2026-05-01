# Codex Review

- Generated: 2026-05-01T00:02:27.644Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: .claude/commands/tournament-director.md, _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md, _bmad/bmm/workflows/4-implementation/create-story/template.md, _bmad/bmm/workflows/4-implementation/create-story/workflow-tournament.yaml

## Summary

Recommendation for Pinehurst trip-week (risk-averse operator, 6 working days, ~25 trip-critical stories): **do not enable `auto_approve_clean_specs` yet** unless you first close two concrete safety gaps in the director spec itself (below). As written, the flag meaningfully increases the chance that a wrong/underspecified story ships unattended under `/loop`, because the remaining gates are primarily *correctness vs the spec* and *path-boundary safety*, not *product/architecture intent validation*.

1) Safety under realistic `/loop` conditions (worst case walk-through)
- If a spec gets **Codex PASS (0 H/M)** and includes a parseable `## Files this story will edit` list (director step 4, lines 183–191), the director can skip the only routine human touchpoint.
- From there, the load-bearing gates that still protect you are:
  - **Step 5b path classification**: prevents SHARED/FORBIDDEN/Wolf Cup boundary edits before tests/commit (lines 210–224). This is strong for *boundary safety*, not spec quality.
  - **Step 6 regression tests**: catches regressions and some functional mistakes (lines 226–240).
  - **Step 7 impl codex review**: catches correctness/security/testing gaps *relative to the diff and the spec* (lines 241–260).
  - **Step 8 party-mode**: can surface gaps/edge cases, but it’s still operating against the written spec/ACs (lines 261–278).
  - **Step 10 commit classification + verification**: prevents committing forbidden/shared/unclassified paths (lines 312–356).
- What those gates *do not reliably catch*: a spec that is “clean” syntactically but wrong on architecture/product intent. If the spec is missing a critical constraint (offline sync invariant, scoring edge-case, auth/tenant boundary nuance, migration ordering constraint, etc.) and Codex doesn’t flag it, then:
  - Implementation can still pass tests (especially if tests mirror the flawed spec).
  - Impl-codex/party-codex tend to enforce “meets spec” rather than “spec is right.”
  - The commit can land and `/loop` continues.

2) Velocity vs quality: is the rest of the pipeline an adequate replacement for human spec review?
- Not fully. The rest of the pipeline is strong at: (a) **path boundary control** (ALLOWED/SHARED/FORBIDDEN), and (b) **implementation correctness given the written ACs**.
- The spec gate exists because it’s where you catch:
  - **missing acceptance criteria / mis-scoped story** (what you meant vs what was written),
  - **cross-story coupling/ordering constraints** (e.g., “this needs a new migration” vs “migration already exists”),
  - **UX/product decisions** that shouldn’t be delegated to Codex/party heuristics,
  - **risk acceptance** tradeoffs (especially around trip-critical reliability).
- Auto-approving replaces “Josh sanity-checks intent” with “Codex/party sanity-checks text,” which is a different (weaker) check for trip-week reliability.

3) Template change required: minimum, lowest-risk way to make auto-approve actually fire
- **Yes: add a new top-level `## Files this story will edit` section** to `_bmad/bmm/workflows/4-implementation/create-story/template.md` (currently absent; template ends at `### File List`, line 49, but that’s under Dev Agent Record and not the required section name).
- Lowest-risk content pattern is:
  - Put it near the top (after Acceptance Criteria),
  - Require **one repo-relative path per line**, optional `- ` prefix (director step 4.2, lines 185–188).
- **Do not auto-derive from Tasks/Subtasks**. That’s riskier: tasks are prose, may omit files, and parsing would be brittle.

4) Trip-week recommendation among (a)/(b)/(c)
- **(b) Leave it off** is the safest given the current director text.
- (a) Enable globally is only defensible if you fix the two concrete gaps below first, and even then I’d still be cautious for trip-critical stories.
- (c) “Enable only for a class of stories (direct ports)” is the best compromise *in principle*, but the director/config as provided only supports a single global boolean (lines 30–35). There’s no enforcement mechanism for “only these story keys / only ports” in the provided config schema.
  - To enforce (c), you’d need an additional explicit machine-checkable signal (e.g., config allowlist of story keys, or a required spec header like `Story type: PORT` with additional invariants) and the director must treat absence as manual gate.

5) Cross-check with the codex-review feedback loop (spec vs impl)
- Spec-stage codex (step 3) is explicitly asked to find ambiguity, missing ACs, boundary/architecture issues (lines 154–161).
- Impl-stage codex (step 7) focuses on correctness/security/testing/drift from spec (lines 251–256).
- If the spec is wrong but internally consistent, impl-codex is *less likely* to flag it because the “truth” it compares against is the spec.

6) First thing likely to go wrong in a 12-hour unattended `/loop`
- The most likely *early* failure mode is not “Codex misses architecture” (that’s rare-but-high-cost); it’s **a false auto-approve due to weak coupling between “Codex reviewed the right file” and “auto-approve is allowed.”** The director freshness check explicitly allows continuing even when the codex report’s Reviewed-files header does not include the requested path (step 3 decision matrix, lines 170–171). As written, step 4 doesn’t tighten auto-approve to require that primary signal.
- The second likely failure is **scope creep within ALLOWED paths**: auto-approve claims step 5b catches drift outside the declared file list, but step 5b (lines 210–224) only classifies ALLOWED/SHARED/FORBIDDEN; it does not compare against the declared list.

Bottom line: given Josh’s risk profile and the social cost of trip failures, the time saved (~5–15 min/story) is not worth it *until* the director spec’s “declared file list” guarantee is actually enforced and auto-approve is protected against wrong-file codex reports. If you still want speed, implement option (c) properly (story-key allowlist) and keep manual spec gate for anything that touches scoring correctness, offline sync, auth/tenant scoping, or migrations.

Overall risk: high

## Findings

1. [high] Auto-approve safety claim is unsupported: step 5b does not enforce “no drift outside declared file list”
   - File: .claude/commands/tournament-director.md:183-225
   - Confidence: high
   - Why it matters: Step 4 asserts that step 5b “will still catch any post-spec edits that drift outside the declared list” (lines 190–191). But step 5b, as written, only classifies changed paths into ALLOWED/SHARED/FORBIDDEN (lines 210–224) and never compares the post-dev-story change set to the spec’s declared `## Files this story will edit` list. This materially increases the blast radius of an inappropriate spec auto-approve: the declared list can be incomplete/incorrect and the workflow will not stop as long as changes remain within ALLOWED paths.
   - Suggested fix: In step 5b (and/or step 10 verification), explicitly parse the spec’s `## Files this story will edit` section into an exact set and HARD STOP if `git status` union contains any additional paths (excluding coordination files and generated review artifacts you intentionally allow). If you truly intend only boundary safety (ALLOWED/SHARED/FORBIDDEN), remove the drift claim from step 4 to avoid a false sense of protection.

2. [high] Auto-approve can proceed even when the codex report may not correspond to the spec file (Reviewed-files mismatch allowed)
   - File: .claude/commands/tournament-director.md:163-191
   - Confidence: high
   - Why it matters: Step 3’s freshness policy explicitly permits proceeding when the report’s “Reviewed files” header does not include the requested path (lines 170–171). Step 4’s auto-approve criteria only require “Codex returned PASS with 0 High/Medium” (line 186) and does not require the Reviewed-files signal to be PASS. Under `/loop`, this creates a realistic failure mode where the director uses a fresh-but-wrong codex report and auto-approves a spec that was not actually reviewed.
   - Suggested fix: Add an additional hard requirement for auto-approve: the report’s Reviewed-files header MUST include the spec path (step 3 signal #1 must be PASS). If it’s FAIL, force the manual spec gate even if you otherwise proceed “with caution.”

3. [medium] Auto-approve likely won’t fire for many real stories because “no globs” conflicts with common generated-file patterns (e.g., migrations)
   - File: .claude/commands/tournament-director.md:183-188
   - Confidence: high
   - Why it matters: Auto-approve disallows glob patterns/directory references in the declared file list (line 187). The representative spec includes a migration glob `apps/tournament-api/src/db/migrations/0004_*.sql` (T5-1 spec line 26), which would be ineligible. If a significant fraction of trip-week stories generate migrations or other nondeterministic filenames, enabling the flag may yield little-to-no velocity gain while still adding operational complexity.
   - Suggested fix: Either (a) accept that migration-touching stories always require manual spec approval, or (b) define a narrow, machine-checkable exception rule for known generated patterns (still risky), or (c) require the spec to list a deterministic directory + an exact filename placeholder that the director later resolves and validates before proceeding (more complex).

4. [medium] Create-story template does not emit the required `## Files this story will edit` section, so the feature is currently nonfunctional
   - File: _bmad/bmm/workflows/4-implementation/create-story/template.md:1-50
   - Confidence: high
   - Why it matters: Step 4 auto-approve requires an exact-titled section `## Files this story will edit` (or `### ...`) with line-by-line paths (director lines 185–188). The create-story template contains no such section (it ends with `### File List` under Dev Agent Record, line 49). As a result, enabling the flag without a template + instructions update will not change behavior (manual spec gate every story).
   - Suggested fix: Add a top-level `## Files this story will edit` section to the template (near ACs) with strict instructions: one repo-relative path per line, no prose, no globs. Ensure the create-story instructions actually populate it (template alone may not be sufficient depending on how instructions.xml drives generation).

5. [low] Inconsistent mtime drift threshold in stale-codex failure mode guidance
   - File: .claude/commands/tournament-director.md:163-176
   - Confidence: high
   - Why it matters: The freshness check describes a 10-minute mtime window (line 166), but later the Failure modes section describes “mtime drift > 5min” (line 554). Inconsistency can lead to operator confusion or inconsistent behavior when re-implementing the procedure.
   - Suggested fix: Make the drift threshold consistent everywhere (either 5 or 10) and ensure failure-mode text matches the actual decision matrix.

## Strengths

- Strong path-boundary safety model with ALLOWED/SHARED/FORBIDDEN and explicit HARD STOP behaviors (director lines 45–82, 208–224, 316–356).
- Robust `/loop` pause protocol with durable gate markers and conversation anchoring to prevent runaway automation (lines 444–524).
- Atomic commit + status flip design with a concrete failure-recovery contract reduces state corruption risk (lines 289–377).
- Union-based change-set enumeration (`--cached`, unstaged, porcelain `-z`) is a solid defense against missing untracked/renamed paths (lines 85–91, 243–248, 312–315).

## Warnings

None.
