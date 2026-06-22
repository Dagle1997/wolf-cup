# Codex Synthesis (Debate Tribunal)

- Generated: 2026-06-22T18:55:35.121Z
- Synthesized sources: codex-review, gemini-review, codex-critique-of-gemini, gemini-critique-of-codex
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Evidence files: (prior outputs only)

## Verdict

**SHIP** — confidence: medium

## Executive summary

Decision: whether Story 2.4a’s removal of `polieBogeyOrBetter` (gate → pure count) is safe to ship for the money engine. Both reviewers flagged a backward-compat risk if any persisted configs still contain the removed key, but both critiques argue this is currently unsupported by evidence and likely zero-impact given the stated project context and fail-closed behavior. Verdict: ship, with a lightweight pre-flight data check (or migration) and a couple of medium/low follow-ups tracked.

## High-confidence findings (consensus)

1. [medium] Potential backward-compat break if any persisted config_json contains `polieBogeyOrBetter` (will hard-fail validation and be unsettleable)
   - File: N/A (schema/registry behavior)
   - Affirming sources: codex-review, gemini-review, codex-critique-of-gemini, gemini-critique-of-codex
   - Summary: Both reviewers agree that removing `polieBogeyOrBetter` from the Zod schema/registry creates a strict-parse failure for any persisted configs still containing that key. However, both critiques downgrade severity as currently unproven/theoretical given the provided context (F1 off, no real-money rounds, no UI to create, seed predates polie, grep shows no occurrences). The system failing closed is also the correct safety posture (it prevents mis-settlement), so the remaining risk is operational (stuck settlements) only if such configs exist.
   - Recommended action: Run an explicit data check against persisted configs for presence of `polieBogeyOrBetter` (and/or add a small migration to strip it). If none exist, document the intentional backward-incompat and proceed.

## Divergent findings (need resolution)

1. Severity/reachability of the backward-compat risk (blocker vs theoretical)
   - Reviewers initially called it HIGH, critiques say it’s not evidenced and likely zero-impact under current rollout context.
   - Positions:
     - **codex-review** (High): “removing polieBogeyOrBetter hard-rejects any persisted config_json with that key (Zod strict + registry) → unsettleable.”
     - **gemini-review** (High): “backward incompatibility with existing DB configs from Story 2.3 carrying polieBogeyOrBetter → fail validation → unsettleable.”
     - **codex-critique-of-gemini** (Downgrade (missing evidence)): “Gemini's High asserts persisted configs 'currently in the database' WITHOUT evidence… severity depends entirely on whether persisted rows contain the key… add an explicit data check (or migration).”
     - **gemini-critique-of-codex** (Downgrade (theoretical/zero records)): “Codex over-indexed on severity by ignoring project context. The backward-incompatible break affects ZERO production records.”
   - Synthesizer lean: Lean: downgrade to theoretical/operational risk (not a blocker) given the explicit context supplied (F1 off, no prod rounds, no UI, seed predates polie, grep=0) and the fact that failure mode is fail-closed (won’t mis-settle). Still, a quick DB/config scan is warranted to convert this from assumption to fact.

2. Removal of gross-threading end-to-end coverage (regression risk vs correct deletion)
   - Codex called the removal a medium regression risk; Gemini critique says the removal is correct because the feature no longer relies on gross, and Story 2.5 will reintroduce gross consumption/tests.
   - Positions:
     - **codex-review** (Medium concern): “end-to-end gross-threading coverage removed, Story 2.5 could regress silently.”
     - **gemini-critique-of-codex** (Disagree / not a concern): “The removal of gross-threading tests is the CORRECT behavior for a feature that no longer relies on gross scores… Story 2.5 will re-add gross consumption + its own test.”
   - Synthesizer lean: Lean: side with gemini-critique-of-codex—if the implementation truly no longer reads gross, then gross-threading tests are mismatched to current behavior. Track a follow-up to ensure Story 2.5 reintroduces the appropriate gross-related coverage when gross becomes relevant again.

## Dismissed findings

1. Claim that there are existing DB configs carrying `polieBogeyOrBetter` (as a present fact)
   - Raised by: gemini-review
   - Dismissal reason: missing_evidence
   - Reasoning: codex-critique-of-gemini explicitly notes the assertion of “currently in the database” is unsupported, and the provided context strongly suggests there may be none.

## Prioritized actions

1. [should_fix] Run a concrete data check over persisted configurations (DB query / config store scan) to confirm whether any records contain `polieBogeyOrBetter`. If any are found, add a small migration/cleanup to strip the key (or a controlled legacy-parse shim) so those configs don’t become unsettleable.
2. [should_fix] Document the intentional backward-incompatibility + fail-closed behavior in release notes/ADR: legacy/malformed configs with removed keys will be rejected rather than silently interpreted.
3. [should_fix] Track the “unknown-key-on-other-modifiers” validator gap (deferred since 2.2 per codex-review): ensure semantic validation fails closed on stray/unknown keys across modifiers, not only within the currently-parsed variant.
4. [optional] Ensure Story 2.5 explicitly reintroduces the correct gross-consumption threading tests/coverage when gross becomes relevant again (avoid carrying forward removed tests that no longer match current behavior).
5. [optional] If any downstream consumers rely on the reason-string including “=value”, update expectations/docs/tests accordingly (codex-review’s low-priority note).
6. [optional] Consider later refactor: per-modifier variant schemas to make future back-compat shims less awkward (not required for this ship).

## Open questions (for human judgment)

- Do any persisted config records (in any environment that could be used for settlements) contain `polieBogeyOrBetter`? If yes, where (prod vs staging vs historical), and what is the desired migration policy (strip vs reject vs transform)?
- Is there any external integration/logging/analytics consumer that depends on the previous reason-string format including “=value” details?

## Warnings

None.
