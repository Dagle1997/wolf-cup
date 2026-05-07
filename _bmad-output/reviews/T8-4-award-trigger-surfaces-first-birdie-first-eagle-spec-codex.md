# Codex Review

- Generated: 2026-05-07T00:39:57.534Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T8-4-award-trigger-surfaces-first-birdie-first-eagle.md

## Summary

Round-2 fixes address the previously flagged auth-before-stream edge (catchup effect + seenIdsRef) and remove the brittle ordering dependency for eagle-vs-birdie selection. The spec’s risk-acceptance for hardcoded TENANT_ID and the SELECT→INSERT race is explicitly documented and consistent with the described project posture. However, there are a couple of concrete spec/code mismatches and one likely correctness issue in the eagle-priority selection that should be resolved before sign-off.

Overall risk: medium

## Findings

1. [medium] Acceptance Criteria still references isBirdieOrBetter early-return, but the spec’s code gates on toPar
   - File: _bmad-output/implementation-artifacts/tournament/T8-4-award-trigger-surfaces-first-birdie-first-eagle.md:39-46
   - Confidence: high
   - Why it matters: Layer 1’s code explicitly uses `if (event.toPar >= 0) return;` (lines 39–46), but AC #1 still states the function "early-returns when `event.isBirdieOrBetter === false`" (lines 326–328) and AC #6’s Given/When likewise uses `isBirdieOrBetter: false` to validate “no DB query” behavior (lines 356–360). Even if `isBirdieOrBetter` is currently derived from `toPar`, this mismatch makes the spec internally inconsistent and can produce incorrect tests (or future regressions if the event shape changes).
   - Suggested fix: Update AC #1 and AC #6 to use `event.toPar >= 0` as the gate (and adjust the test description accordingly). If you still want to assert against `isBirdieOrBetter`, state explicitly that it must be derived from `toPar` and test the `toPar` behavior as the source-of-truth.

2. [medium] Eagle-priority logic selects the first eagle in the TTL window, not the most recent eagle
   - File: _bmad-output/implementation-artifacts/tournament/T8-4-award-trigger-surfaces-first-birdie-first-eagle.md:257-263
   - Confidence: medium
   - Why it matters: `const eagle = entries.find((e) => e.awardType === 'first_eagle_of_event');` (line 261) returns the earliest eagle in `entries`, not necessarily the newest. If multiple celebration entries exist within the 4s TTL (e.g., two awards arrive across polls, or duplicates slip through due to the accepted SELECT→INSERT race), the UI can incorrectly display an older eagle overlay even when a newer celebration should be shown. This is a concrete correctness issue independent of stream ordering.
   - Suggested fix: Pick the most recent eagle (e.g., iterate from the end, use `findLast`, or reduce by `arrivedAt`). Example: `const eagle = [...entries].reverse().find(e => e.awardType==='first_eagle_of_event');` then fallback to last entry.

3. [low] AwardCelebration maps unknown awardType values to birdie instead of ignoring them
   - File: _bmad-output/implementation-artifacts/tournament/T8-4-award-trigger-surfaces-first-birdie-first-eagle.md:206-237
   - Confidence: high
   - Why it matters: Both catchup and stream paths map `awardType` with a ternary that defaults to `'first_birdie_of_event'` (lines 210–212 and 234–236). If additional `award.triggered` award types are introduced later (even accidentally), the celebration will incorrectly show a birdie animation for a non-birdie award. This is forward-compat risk and could create confusing UX during v1.5+ expansion.
   - Suggested fix: Explicitly filter to the two supported award types: return/continue unless `awardType` is exactly `'first_birdie_of_event'` or `'first_eagle_of_event'`. Then you can set `awardType` without a default-to-birdie fallback.

4. [low] Risk-acceptance unique-index example may not match actual column naming used elsewhere in the spec
   - File: _bmad-output/implementation-artifacts/tournament/T8-4-award-trigger-surfaces-first-birdie-first-eagle.md:473-475
   - Confidence: medium
   - Why it matters: The v1.5 hardening note proposes `CREATE UNIQUE INDEX ... ON activity(event_id, json_extract(payload_json, '$.awardType')) ...` (line 474), while the Drizzle code refers to `activity.eventId` (line 65). If the underlying DB column is not `event_id`, the follow-up hardening SQL as written could be wrong/misleading when executed later.
   - Suggested fix: Adjust the suggested SQL to match the real column name in SQLite schema (or explicitly note it’s pseudo-SQL and should be adapted to the actual column names).

## Strengths

- Risk acceptance for hardcoded TENANT_ID and SELECT→INSERT race is clearly documented with an explicit v1.5 hardening path (lines 471–475).
- Auth-resolve catchup effect is correctly keyed on `[myPlayerId, rows]`, bounds replay by TTL, and uses `seenIdsRef` to prevent double-celebration when both stream and catchup see the same row (lines 192–217, 223–227).
- Eagle-over-birdie priority is explicitly encoded rather than relying on stream order (lines 257–263), and the test plan includes an assertion for the intended outcome (lines 314–315).

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T8-4-award-trigger-surfaces-first-birdie-first-eagle.md
