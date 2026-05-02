# Codex Review

- Generated: 2026-05-02T13:14:20.827Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/scores.integration.test.ts, apps/tournament-web/src/scripts/drill-offline-scorer.md

## Summary

The new 409 test assertions materially strengthen the first-writer-wins and “no audit on 409” guarantees by verifying the surviving DB row’s identity (via clientEventId) and by checking both entity-scoped and global score.committed audit counts. The Step 3 drill wording is substantially improved (correct primary signal + Safari/example.com secondary check + explicit warning about PWA cache), but the instructions still omit an explicit “return to the PWA” action before checking the in-app indicator, which can confuse execution and invalidate the primary check.

Overall risk: low

## Findings

1. [medium] Offline drill Step 3: missing explicit instruction to return to PWA before checking in-app offline indicator
   - File: apps/tournament-web/src/scripts/drill-offline-scorer.md:45-53
   - Confidence: high
   - Why it matters: Step 3’s primary pass/fail signal is “the in-app offline indicator … must be visible,” but the procedure currently has the operator inside iOS Settings (and optionally Safari). Without explicitly instructing them to switch back to the PWA score-entry page before evaluating the indicator, the step is ambiguous and may be performed incorrectly (e.g., operator stays in Settings, can’t see the indicator, or checks it at the wrong time). That can cause false fails or inconsistent drill records.
   - Suggested fix: Amend Step 3 to explicitly say to return to the PWA score-entry page after toggling Airplane Mode ON, and (if Safari secondary check is used) to return to the PWA again before proceeding. Example: “Return to the tournament PWA (score-entry page) and confirm the offline chip/badge is visible.”

2. [low] 409 test: first insert response is not asserted, making failures slightly harder to diagnose
   - File: apps/tournament-api/src/routes/scores.integration.test.ts:341-349
   - Confidence: high
   - Why it matters: The test relies on the first POST having created the original row. If that insert ever fails unexpectedly, the test will still fail later, but the error will be less direct (e.g., missing row vs. explicit “expected first status 201”). This is not a correctness bug, but it can slow down debugging regressions in the setup/first commit path.
   - Suggested fix: Capture the first response and assert `status === 201` (and optionally `deduped === false`) before issuing the conflicting second write.

## Strengths

- 409 path is now defended against a silent overwrite by checking both grossStrokes and clientEventId identity (apps/tournament-api/src/routes/scores.integration.test.ts:367-385).
- Audit non-emission on 409 is tested with two complementary queries: entity-scoped and global eventType count (apps/tournament-api/src/routes/scores.integration.test.ts:386-409).
- Drill Step 3 now correctly treats the in-app offline indicator as the primary signal and avoids the “PWA hard refresh proves offline” fallacy by using Safari/example.com as an optional independent network check (apps/tournament-web/src/scripts/drill-offline-scorer.md:49-51).
- Public doc no longer embeds VPS/host credentials; it references an internal SOP for access details (apps/tournament-web/src/scripts/drill-offline-scorer.md:104-107).

## Warnings

None.
