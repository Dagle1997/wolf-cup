# Codex Review

- Generated: 2026-04-30T23:41:13.678Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: .claude/commands/tournament-director.md, _bmad-output/reviews/tournament-director-v4-codex.md

## Summary

Re-review result: not PASS. Several of the 9 prior findings are resolved (notably the step-0 idle-line redaction and the new forbidden-path gate semantics), but there are still concrete contradictions that break the intended guarantees:
- Config-read ordering is still contradicted elsewhere in the document.
- Step-10 staging order is internally inconsistent (10b would stage sprint-status.yaml despite the “stage only at 10c” rule).
- Codex freshness check still STOPs on Reviewed-files mismatch alone, which conflicts with the stated “both signals must fail before STOP” intent.

These are actionable doc-level bugs that could cause /loop misbehavior or reintroduce the atomicity/index hazard the patch was meant to eliminate.

Overall risk: high

## Findings

1. [high] Config read ordering still contradicted (violates/undermines “only read marker while gated” guarantee)
   - File: .claude/commands/tournament-director.md:24-27
   - Confidence: high
   - Why it matters: You updated step 0 to require the pending-gate check before reading any other file (good), but other parts of the document still state the opposite ordering:
- “Director config” section says config is read “at the start… (step 0a, before the pending-gate check)” (line 26).
- Loop pause protocol procedure header still says it runs “at step 0, after step 0a config-read” (line 493).

These directly contradict step 0’s hard rule (“Do NOT read the director config… while a gate is pending” at line 110). A future executor cannot satisfy both, and may read config while gated (regression of prior finding #2).
   - Suggested fix: Make all references consistent with the intended ordering:
- Update line 26 to say config is read at step 0a **after** the pending-gate check clears.
- Update the loop protocol header at line 493 to remove “after step 0a config-read” (it should be “at step 0” / “before step 0a”).
- Ensure there is exactly one canonical ordering stated throughout: Step 0 gate-check → Step 0a config read.

2. [high] Step 10b staging rules conflict with the “delay staging sprint-status.yaml until 10c” requirement
   - File: .claude/commands/tournament-director.md:304-351
   - Confidence: high
   - Why it matters: You added the intended rule to delay staging sprint-status.yaml until step 10c (lines 335–336, 349–352), but step 10b’s generic staging-by-status rules would still stage it:
- Step 10a modifies sprint-status.yaml (line 306).
- Step 10b then says for modified tracked files (` M` / `M ` / etc.) you MUST `git add -- <path>` (line 316), which includes sprint-status.yaml unless explicitly excluded.

So the ordering is not unambiguous/realizable as written: a compliant executor of 10b will stage sprint-status.yaml early, reintroducing the larger “status: done sitting in the index” window that the patch claims to minimize (and that finding #5 aimed to address).
   - Suggested fix: Explicitly carve sprint-status.yaml out of step 10b:
- Add a rule in 10b like: “If <path> is sprint-status.yaml, DO NOT stage it in 10b; defer to 10c.”
- Or reorder steps so the 10b enumeration+bulk staging occurs before 10a modifies sprint-status.yaml.
- Ensure 10b’s ‘stage by status code (MUST)’ section cannot be read as applying to sprint-status.yaml in this cycle.

3. [medium] Codex freshness check still STOPs on Reviewed-files mismatch alone (contradicts the stated two-signal requirement)
   - File: .claude/commands/tournament-director.md:163-167
   - Confidence: high
   - Why it matters: Your updated freshness check says Reviewed-files is primary and mtime is secondary, and also states “If both checks fail … STOP” (line 166). However, step (1) currently says if Reviewed-files is missing → write marker and STOP immediately (line 165).

That means it does not actually implement the intended “mtime+Reviewed-files both must fail before STOP” behavior requested in the re-review criteria (#9). It’s also internally inconsistent (line 165’s unconditional STOP vs line 166’s ‘both fail’ logic).
   - Suggested fix: Make the decision logic consistent. If the desired behavior is “STOP only if both checks fail,” revise step (1) to treat Reviewed-files mismatch as suspicious (trigger retry / consult mtime) rather than an immediate STOP, and only STOP when both signals indicate staleness (or after the defined retry policy).

## Strengths

- Step-0 idle line is correctly redacted to avoid re-emitting the bracketed `[gate-id: ...]` anchor; it uses the bare token form `marker id: {director_message_id}` (lines 501–503), addressing prior finding #1.
- Config-read ordering is corrected in the step list itself (step 0 gate-check then step 0a config read) (lines 108–116), matching the intended ‘only read marker while gated’ rule—once the contradictory references are fixed.
- STOP paths for the specifically-called-out cases now explicitly name gate_type and include question text with `[gate-id: ...]` (e.g., workflow-misconfig at lines 150–151 and 202–203; schema-violation at line 130; tests-failed at line 233; codex-high-user-decision at lines 173–174, 253–254, 283–284; complete at line 139).
- FORBIDDEN handling is now non-approvable via a dedicated `forbidden-path` gate type, and the user-answer interpreter explicitly blocks `decision: approve` for forbidden-path (lines 214–215 and 509–512), resolving prior finding #4.
- Step 5b now cross-references the `-z` two-record rename/copy parsing rule and requires classifying BOTH old and new paths (lines 210–211), resolving prior finding #8.
- Step-10 recovery contract now addresses both working-tree restoration and index unstaging for sprint-status.yaml via `git reset HEAD -- sprint-status.yaml` (lines 296–299), aligning with prior finding #5’s index hazard concern (though staging-order ambiguity still needs fixing).

## Warnings

None.
