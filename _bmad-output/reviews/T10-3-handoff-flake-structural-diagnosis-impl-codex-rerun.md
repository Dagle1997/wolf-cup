# Codex Review

- Generated: 2026-05-21T19:23:19.820Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/round-lifecycle.integration.test.ts

## Summary

The edit is confined to an inline comment in a test file; no production or non-test logic changed. The comment is notably improved vs the prior over-assertions: it now explicitly distinguishes empirical vs deductive refutation, and it clearly states the one-off 500’s concrete error-path was not captured (so the exact cause remains unproven). A few remaining statements still read stronger than the evidence available in this diff supports (notably around Vitest defaults/config and “correct mitigation” language), and a couple of technical claims could be false under alternate Vitest configurations (e.g., threads pool or global concurrent sequencing).

Overall risk: low

## Findings

1. [medium] Comment still asserts Vitest “default forks + isolate:true” behavior and vitest.config.ts settings without evidence in provided diff; could be false under different Vitest defaults or configs
   - File: apps/tournament-api/src/routes/round-lifecycle.integration.test.ts:505-517
   - Confidence: medium
   - Why it matters: You asked specifically to ensure the comment separates proven evidence from inference. In the provided materials, we cannot verify (a) what Vitest’s default pool is for the repo/version, nor (b) what vitest.config.ts contains. If either is incorrect (e.g., pool is threads, or isolate is disabled via config/CLI), the conclusion “cross-file shared-cache DB is never shared across files” can become wrong and the comment becomes a misleading source of truth for future triage.
   - Suggested fix: Soften/qualify to what was observed during the T10-3 probe run rather than asserting as repo fact, e.g. “In the T10-3 probe run with Vitest 3.2.4 in CI/default settings at the time, we observed separate worker pids per file…” and/or reference the exact config/CLI used. If you want to keep the vitest.config.ts claim, consider wording like “At time of writing, vitest.config.ts does not override pool/isolate” (and ideally include the relevant snippet or link in the diagnosis doc).

2. [low] “No test.concurrent → tests run sequentially” can be incorrect if Vitest is configured for concurrent sequencing
   - File: apps/tournament-api/src/routes/round-lifecycle.integration.test.ts:518-521
   - Confidence: medium
   - Why it matters: Vitest can run tests concurrently via configuration (e.g., sequence.concurrent / fileParallelism patterns) even if individual tests are not marked test.concurrent. If that were enabled, the `__testPlayer` module-global could again be race-prone. The comment currently frames sequential execution as guaranteed purely from the absence of `test.concurrent` in this file.
   - Suggested fix: Qualify the statement to the tested configuration, e.g. “This file contains no `test.concurrent`, and under our current Vitest configuration tests in a file execute sequentially…” or explicitly note the assumption “assuming sequence.concurrent is not enabled”.

3. [low] “retry: 1 is the correct mitigation … NOT a band-aid over an unfixed structural bug” is still stronger than what’s proven
   - File: apps/tournament-api/src/routes/round-lifecycle.integration.test.ts:498-501
   - Confidence: high
   - Why it matters: Even with the improved separation later (“leading remaining INFERENCE”, and the 500 path not captured), these opening lines still assert as fact that there is no remaining structural bug and that the transient explanation is definitively correct. That partially reintroduces the earlier review concern (over-claiming certainty) even though the rest of the comment is careful.
   - Suggested fix: Align the opening with the later cautious framing, e.g. “retry: 1 is retained as a pragmatic mitigation consistent with the current best inference…” and avoid absolute “NOT a band-aid” language unless you can point to captured evidence of the transient failure mode.

4. [low] Comment references scorer-assignments.ts line numbers/paths that are not evidenced in this diff and may rot
   - File: apps/tournament-api/src/routes/round-lifecycle.integration.test.ts:530-535
   - Confidence: medium
   - Why it matters: The comment names two specific 500 codes/locations (`transfer_failed` at scorer-assignments.ts:443 vs `event_not_resolvable` at :227). Without those files/lines in the provided review material, their correctness can’t be verified here; and even if correct now, line-number references tend to drift and become misleading over time.
   - Suggested fix: Prefer stable identifiers over line numbers (function/route name, error code strings only), or link to a specific commit/PR in the diagnosis doc where those line numbers were validated.

## Strengths

- The revised comment now explicitly states the one-off 500’s precise handler/catch path was not captured, avoiding the prior over-assertion about cause.
- It clearly distinguishes empirical refutation (#1/#2) from deductive reasoning (#3), which directly addresses the earlier review point about “direct evidence” vs deduction.
- The comment is scoped to this test’s behavior and includes guidance on what to capture if the issue reappears (body.code + server error string), which is actionable.

## Warnings

None.
