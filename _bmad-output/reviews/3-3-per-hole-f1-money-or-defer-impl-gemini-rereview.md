# Gemini Review

- Generated: 2026-06-23T16:19:06.071Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/scorecard.ts, apps/tournament-api/src/routes/scorecard.integration.test.ts

## Summary

The PR successfully addresses the HIGH divergence issue by aligning the scorecard's data sources for `holesToPlay` and `courseRevisionId` with the F1 money settlement engine. The implementation correctly prefers the pinned course revision when available and gracefully falls back to the live event-round configuration, ensuring UI consistency. The associated integration tests effectively prove the divergence is closed, and handle edge cases like pushing zeroes appropriately.

Overall risk: low

## Findings

No concrete findings were identified from the supplied evidence.

## Strengths

- Uses a resilient, explicit null check `moneyByHole !== null && moneyByHole.has(n)` to safeguard against `??` coalescing erasing explicitly settled `$0` push values.
- Comprehensive integration tests that cleanly demonstrate both the bug fix and the correct unpinned fallback behavior.
- Well-commented rationale around the business rules for parity with the money settlement engine, effectively mapping ACs to concrete statements.

## Warnings

None.
