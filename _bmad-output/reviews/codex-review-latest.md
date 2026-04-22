# Codex Review

- Generated: 2026-04-22T17:01:44.540Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/api/src/routes/ctp-entries.ts, apps/api/src/routes/ctp-entries.test.ts

## Summary

Round-3 items appear closed in the provided API route + tests: CTP detection no longer depends on renameable admin fields, non-official rounds are rejected before any auth/side-game logic, and the upsert test now asserts row stability via DB reads (createdAt stable, updatedAt monotonic, single row). I don’t see regressions introduced by the non-official-round rejection in this handler; existing tests still exercise the relevant paths. One small maintenance issue remains: a stale test comment describes the old multi-signal CTP identification logic that no longer exists.

Overall risk: low

## Findings

1. [low] Stale test comment claims CTP detection includes a side-game name match, but the handler now matches only on calculationType === 'manual'
   - File: apps/api/src/routes/ctp-entries.test.ts:223-226
   - Confidence: high
   - Why it matters: This comment is now incorrect and can mislead future changes (e.g., a developer might assume name matching is still enforced and make an unsafe refactor or write/adjust tests based on the wrong contract).
   - Suggested fix: Update or remove the comment to reflect current behavior (manual-only identification + scheduledRoundIds contains roundId, with the explicit assumption that CTP is the only manual side game).

## Strengths

- Non-official rounds are rejected early (before entry-code auth), preventing configuration drift from creating an unauthenticated CTP path (apps/api/src/routes/ctp-entries.ts:64-71).
- CTP activation logic is now resilient to admin display-name renames by using a stable identifier (calculationType === 'manual') and documenting the assumption and required future change (ctp-entries.ts:112-123).
- Upsert correctness is better protected by a stronger regression test that validates createdAt stability and single-row uniqueness via direct DB reads (ctp-entries.test.ts:469-519).
- Atomic upsert correctly blocks updates to finalized rows using ON CONFLICT DO UPDATE ... WHERE finalizedAt IS NULL and treats “no rows returned” as a finalized rejection (ctp-entries.ts:230-281).

## Warnings

None.
