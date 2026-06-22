# Gemini Review

- Generated: 2026-06-22T01:45:22.388Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/claim-write.ts, apps/tournament-api/src/routes/claims.ts, apps/tournament-api/src/db/schema/hole-claim-writes.ts, apps/tournament-api/src/engine/games/types.ts, apps/tournament-api/src/services/games-money.ts, apps/tournament-api/src/middleware/require-scorer-for-round.ts, apps/tournament-api/src/routes/scores.ts, apps/tournament-web/src/lib/offline-queue.ts, apps/tournament-api/src/services/claim-write.test.ts, apps/tournament-api/src/routes/claims.test.ts

## Summary

The implementation correctly refactors the scorer gate logic and builds a robust, append-only log for claims that avoids offline-queue resurrect bugs. The integration into the F1 money settlement is safe and fully isolated. However, there is a critical performance regression involving a full table scan on every claim write due to a missing index, and a missing business rule validation for claim hole numbers.

Overall risk: high

## Findings

1. [high] Full table scan on every claim write due to missing index on `seq`
   - File: apps/tournament-api/src/services/claim-write.ts:71-74
   - Confidence: high
   - Why it matters: The `appendClaimWrite` function computes the next sequence number globally using `MAX(seq)` over the entire `holeClaimWrites` table. Because there is no index with `seq` as the first column, SQLite must perform a full table scan on this append-only log for every single claim write. As the table grows over time across all tenants, this O(N) query will dramatically slow down inserts and hold write transactions open longer, leading to lock contention and timeouts. The schema comment incorrectly implies SQLite natively autoincrements this column; it does not because `seq` is not the `INTEGER PRIMARY KEY`.
   - Suggested fix: Add a dedicated index on `seq` (`index('idx_hole_claim_writes_seq').on(t.seq DESC)`) in the schema so `MAX(seq)` can be resolved in O(1) time.

2. [medium] Missing `holesToPlay` validation for claims
   - File: apps/tournament-api/src/routes/claims.ts:101-110
   - Confidence: high
   - Why it matters: The route does not validate that `body.holeNumber` is within the round's `holesToPlay`. A client can submit claims for invalid holes (e.g., hole 18 on a 9-hole round). While `games-money.ts` filters scores for valid holes and thus ignores out-of-bounds claims during settlement, these orphaned claims are saved and returned in the `myClaims` array via the `GET /api/rounds/:roundId` endpoint. This could lead to frontend crashes or unexpected UI rendering when the client attempts to render a claim chip for a non-existent hole. The score-write endpoint correctly performs this validation.
   - Suggested fix: Select `holesToPlay` in the `roundRows` query and add an explicit check `if (body.holeNumber > round.holesToPlay)` returning a 422 before allowing the write, matching the logic in `scores.ts`.

## Strengths

- The scorer gate refactor elegantly extracts the complex validation logic while perfectly replicating existing semantics and 404/403/422 responses.
- The append-only log design (`hole_claim_writes`) combined with global `client_event_id` deduplication permanently closes the offline-queue 'resurrection' bug inherent in hard-delete data models.
- F1 money settlement updates safely fail-close: loading claims does not block the engine if inert, and database-level exception risks are cleanly handled by the pre-existing blast radius isolation.

## Warnings

- Truncated file content for review: apps/tournament-api/src/routes/scores.ts
