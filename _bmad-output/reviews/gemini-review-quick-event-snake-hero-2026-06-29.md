# Gemini Review

- Generated: 2026-06-29T14:57:07.935Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/db/migrations/0026_warm_gressill.sql, apps/tournament-api/src/db/schema/subgames.ts, apps/tournament-api/src/routes/scores.ts, apps/tournament-web/src/routes/admin.events.quick.tsx, apps/tournament-web/src/routes/index.tsx

## Summary

The feature orchestrates existing APIs effectively and the snake logic correctly aligns with security + authorization bounds. However, the UI introduces a critical money-settlement error for decimal inputs and heavily limits group assignments for standard configurations (e.g., 4 players). Returning players also face a regression due to incorrect auto-redirect conditions.

Overall risk: high

## Findings

1. [high] Decimal Point Values Are Incorrectly Rounded Before Converting to Cents
   - File: apps/tournament-web/src/routes/admin.events.quick.tsx:226
   - Confidence: high
   - Why it matters: The Quick Event wizard rounds the `pointDollars` input to the nearest integer *before* multiplying by 100. If an organizer inputs a decimal point value (e.g., `2.50`), it rounds to `3` and sets the game to $3.00 per point instead of $2.50, causing incorrect real-money settlement.
   - Suggested fix: Multiply by 100 before rounding to correctly capture the decimal cents: `Math.round((Number(pointDollars) || 0) * 100)`.

2. [high] Arrange Foursomes Dropdown Prevents Creating New Groups for Multiples of 4
   - File: apps/tournament-web/src/routes/admin.events.quick.tsx:401
   - Confidence: high
   - Why it matters: The `<select>` options for group assignments cap the maximum group number at `Math.max(numFoursomes, Math.ceil(numPlayers / 4))`. If `numPlayers` is 4, this evaluates to `1`. The dropdown will only display "Group 1", making it strictly impossible for an organizer to split 4 players into two separate groups.
   - Suggested fix: Generate options based on the currently used number of groups plus one (so the user can always create a new empty group): `length: numFoursomes + 1`.

3. [medium] Auto-Redirect Fails for Players with Past Archived Events
   - File: apps/tournament-web/src/routes/index.tsx:137-139
   - Confidence: high
   - Why it matters: The auto-redirect logic relies on `events.length === 1`. This evaluates the total historical array (both active and archived events). Returning players with one active event but one or more older (archived) events will bypass the redirect, degrading the UX requirement that players with a single active event auto-enter.
   - Suggested fix: Evaluate the already-filtered active events array instead: `activeEvents.length === 1 ? activeEvents[0]!.id : null;`.

## Strengths

- Secure orchestration of the `snake` token logic by rigorously enforcing the `resolveScorerGate` gate, ensuring no unauthorized players can transfer it.
- Smart idempotent design using `clientEventId` constraints in `snakeHolderWrites`, safeguarding the endpoint from offline queue replay duplicates.
- Data-preserving 0026 migration correctly sidesteps Drizzle drift issues without compromising the `sub_games` parent-child relationships.

## Warnings

- Truncated file content for review: apps/tournament-api/src/routes/scores.ts
