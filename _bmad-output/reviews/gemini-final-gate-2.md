# Gemini Review

- Generated: 2026-06-23T03:06:01.964Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\Wolf-cup
- Reviewed files: apps/api/src/routes/stats.ts, apps/api/src/routes/standings.ts, apps/api/src/lib/sub-status.ts

## Summary

The logic fixes are robust and completely resolve the 'Unknown' leaks by properly scoping both the highlighting and partnership aggregations to the `eligible` active roster set. However, a fatal syntax error was introduced near the truncation point in `stats.ts` that will block the deploy.

Overall risk: high

## Findings

1. [critical] Stray character causes syntax error
   - File: apps/api/src/routes/stats.ts:720
   - Confidence: high
   - Why it matters: A stray `c` character is present at the end of the opponent pair block. This invalid syntax will fail the TypeScript build and immediately block deployment.
   - Suggested fix: Remove the stray `c` character and ensure the rest of the opponent pair logic (like updating `pairMap`) is correctly finished.

## Strengths

- The eligibility guards completely solve the 'Unknown' name leaks without breaking the aggregation logic.
- The hypothetical ranking for subs is cleanly executed, applying standard competition ranking independently against the full member board.
- Centralizing the sub-status check to read directly from `players.status` reduces synchronization issues.

## Warnings

- Truncated file content for review: apps/api/src/routes/stats.ts
