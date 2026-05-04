# Codex Review

- Generated: 2026-05-04T14:21:34.540Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T6-4-score-commit-hook-hole-complete-press-evaluation.md, apps/tournament-api/src/routes/scores.ts

## Summary

Based on the provided files, the T6-4 spec describes new wiring in `apps/tournament-api/src/routes/scores.ts` (step 5b orchestrator call + outer try/catch mapping `BusinessRuleError('press_engine_error')` → 422), but the provided `scores.ts` content does not contain either change. This is a concrete spec/implementation mismatch that will prevent the intended behavior (hole-complete press evaluation and correct 422 mapping) from working.

I cannot verify the rewritten hole-complete query, foursome-size guardrail, activity payload contract, UNIQUE-violation handling, or orchestrator boundary because the orchestrator/schema/migration/test files are not included in the provided content.

Overall risk: high

## Findings

1. [critical] scores.ts lacks the T6-4 outer try/catch for BusinessRuleError('press_engine_error') → 422 (spec Section 6)
   - File: apps/tournament-api/src/routes/scores.ts:258-549
   - Confidence: high
   - Why it matters: The spec requires press-engine failures to rollback the transaction and return a 422 response with code `press_engine_error`. In the provided implementation, the handler directly returns `await db.transaction(...)` with no outer error mapping. Any `BusinessRuleError` thrown from new press orchestration (once added) would bubble to Hono’s default handler and likely become a 500, violating AC-6 and changing client retry semantics.
   - Suggested fix: Wrap the existing `await db.transaction(async (tx) => { ... })` call in a `try/catch` at the route handler level. In the catch, detect `err instanceof BusinessRuleError && err.code === 'press_engine_error'` and return `422` with `{ error: 'unprocessable', code: 'press_engine_error', requestId }`; rethrow all other errors.

2. [high] scores.ts does not invoke the press orchestrator at all (missing step 5b wiring)
   - File: apps/tournament-api/src/routes/scores.ts:433-537
   - Confidence: high
   - Why it matters: The T6-4 story’s core requirement is: after a score commit, run press evaluation only when the hole becomes complete, within the same transaction, with idempotent dedupe. The provided `scores.ts` has audit+activity (step 5) and then immediately proceeds to state transitions (steps 6–7) and returns 201 (step 8). There is no orchestrator import, no call, and no derived `foursomeNumber` lookup. As-is, no press evaluation can occur and no `team_press_log` rows or `press.auto_fired` activities can ever be produced.
   - Suggested fix: Add an in-transaction call between the existing step (5) and step (6): derive `foursomeNumber` for `body.playerId` within the round’s `eventRoundId` via `pairing_members ⨝ pairings` (tenant-scoped), then call `runPressOrchestrator(tx, { roundId, holeNumber, scorerPlayerId: player.id, scoredPlayerId: body.playerId, foursomeNumber, ... }, TENANT_ID)`.

## Strengths

- The existing score commit logic still has solid idempotency handling for replayed `clientEventId` (returns 200 with `deduped: true`) and a distinct 409 path for cell-level uniqueness conflicts with a different `clientEventId`.
- The round writability gate and transaction-embedded state transition logic appear unchanged and consistent with the existing T5-6/T5-8 patterns.

## Warnings

None.
