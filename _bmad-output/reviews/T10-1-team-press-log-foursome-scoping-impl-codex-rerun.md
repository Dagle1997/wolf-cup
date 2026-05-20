# Codex Review

- Generated: 2026-05-20T19:45:00.715Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/presses.ts, apps/tournament-api/src/routes/export.integration.test.ts

## Summary

The two targeted Low fixes look correct: the presses route header comment now matches the current T10-1 behavior (foursome-scoped UNIQUE, fromHole derivation threads foursomeNumber, DELETE lookup is foursome-scoped), and the new export integration test pins the inserted teamPressLog row deterministically via id + contextId + other fields. No regressions introduced by these edits were found, but there are two minor completeness/flakiness risks to consider.

Overall risk: low

## Findings

1. [low] Stale kill-switch comment still references the old foursome-blind UNIQUE rationale
   - File: apps/tournament-api/src/routes/presses.ts:248-251
   - Confidence: high
   - Why it matters: You updated the header doc comment to correctly describe that T10-1’s UNIQUE is now foursome-scoped, and that the kill switch is an operational override. However, the inline kill-switch comment still says it prevents hitting the “foursome-blind UNIQUE”. That’s now inaccurate and can mislead future maintenance/incident response (someone may think the UNIQUE is still cross-foursome).
   - Suggested fix: Update the inline comment to reflect current reality (e.g., kill switch is retained as operational override / emergency stop; remove the outdated foursome-blind UNIQUE wording).

2. [low] New export test is robust in lookup, but the inserted row could still collide with future fixtures via the foursome-scoped UNIQUE tuple
   - File: apps/tournament-api/src/routes/export.integration.test.ts:931-983
   - Confidence: medium
   - Why it matters: The strengthened `.find()` predicate is deterministic (id + contextId + team + startHole + triggerType), so selection is robust. However, the INSERT uses a fixed `(foursomeNumber=2, team=teamA, startHole=7, triggerType=manual)` tuple; if future seeds/tests start inserting a row with the same tuple for the same round, this test could fail at insert time due to the UNIQUE constraint (even though the lookup is pinned).
   - Suggested fix: To future-proof, pick a startHole less likely to be used (e.g., random within 1..18 with retry on UNIQUE) or pick a tuple derived from randomness (e.g., random startHole) while still asserting the exported row by `id` (the truly unique identifier).

## Strengths

- Header doc comment now aligns with current code paths: fromHole is server-derived, foursomeNumber is threaded into the INSERT, UNIQUE dedupe is foursome-scoped, and DELETE press lookup is scoped by caller’s foursomeNumber (and returns 404 when out-of-foursome).
- Export integration test lookup is now deterministic and resilient to fixture growth: it no longer relies on positional assumptions and pins on id + contextId + other identifying columns.

## Warnings

- Truncated file content for review: apps/tournament-api/src/routes/export.integration.test.ts
