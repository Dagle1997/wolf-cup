# Codex Review

- Generated: 2026-06-22T01:42:50.794Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/claim-write.ts, apps/tournament-api/src/routes/claims.ts, apps/tournament-api/src/db/schema/hole-claim-writes.ts, apps/tournament-api/src/engine/games/types.ts, apps/tournament-api/src/services/games-money.ts, apps/tournament-api/src/middleware/require-scorer-for-round.ts, apps/tournament-api/src/routes/scores.ts, apps/tournament-web/src/lib/offline-queue.ts, apps/tournament-api/src/services/claim-write.test.ts, apps/tournament-api/src/routes/claims.test.ts

## Summary

Core Story 2.1 pieces are present (append-only log + dedupe on client_event_id, current-state derivation, claim capture route with scorer gate reuse, and tests covering dedupe + stale-replay-no-resurrect). The main correctness gap is the server-seq mechanism: MAX(seq)+1 is not concurrency-safe and can break “latest write wins” for a cell under overlapping transactions, undermining the resurrection-proof guarantee. There’s also a literal NUL delimiter embedded in source (risking tooling/build issues), and a couple of smaller contract/compat risks (claims route not enforcing holes_to_play; money path always passing an empty claims object).

Overall risk: high

## Findings

1. [critical] Server seq assignment (MAX(seq)+1) is not concurrency-safe; can make latest-write-per-cell non-deterministic and can violate “remove wins” under overlapping transactions
   - File: apps/tournament-api/src/services/claim-write.ts:64-99
   - Confidence: high
   - Why it matters: Story 2.1’s resurrection-proof guarantee depends on a strict server order key for “latest write per cell”. The implementation computes seq via `SELECT MAX(seq) + 1` (lines 71–75) and then inserts (lines 76–93). If two claim writes run in overlapping transactions (same scorer double-tap, offline drain concurrency, or just concurrent HTTP requests), both transactions can read the same MAX(seq) snapshot and both insert the same `seq`. Because `deriveCurrentClaims` only replaces when `r.seq > prev.seq` (not >=), ties within the same cell will keep whichever row happens to be encountered first in an unordered SELECT, making the current state non-deterministic. In the worst case, a later-intended `remove` can be ignored and the claim appears active (a resurrection-equivalent outcome). This is especially plausible here because there is intentionally no cell-level UNIQUE preventing multiple writes to the same cell.
   - Suggested fix: Make the order key DB-assigned and strictly increasing per insert:
- Preferred: change schema so `seq` is the INTEGER PRIMARY KEY AUTOINCREMENT (rowid alias) and make `id` a UNIQUE text column (not the PK), then drop MAX+1 logic and let SQLite assign `seq`.
- Alternative: keep `id` PK but use SQLite `rowid` as the order key in reads (if accessible) or introduce a separate autoincrement column.
- If you cannot change schema immediately, at least: (a) enforce a UNIQUE constraint on (seq) and retry on conflict, and (b) order the SELECT + use a deterministic tiebreaker (e.g., (seq, createdAt, id)) — but the real fix is DB-assigned monotonic sequencing.

2. [high] Literal NUL character used as Map key delimiter in source file (tooling/build risk)
   - File: apps/tournament-api/src/services/claim-write.ts:141-160
   - Confidence: high
   - Why it matters: `deriveCurrentClaims` constructs and splits keys using a literal NUL character `"\u0000"` embedded directly in the source (rendered as `�` in the provided file) at lines 144 and 154. Null bytes in source files can break or confuse toolchains (TypeScript compiler, linters, bundlers, git diffs, log output), and are extremely hard to spot/review/debug. Even when it “works”, this is a sharp edge for future edits.
   - Suggested fix: Replace the literal NUL with an explicit escape or a visible delimiter:
- Define `const SEP = '\u0000'` (or `'\0'`) and use it in both join/split.
- Or use a safe visible separator unlikely to occur in UUIDs, e.g. `|` or `:` (UUIDs and claim types won’t contain it).

3. [medium] Claims route does not enforce holeNumber <= round.holesToPlay (9-hole rounds can record claims on out-of-play holes)
   - File: apps/tournament-api/src/routes/claims.ts:53-218
   - Confidence: high
   - Why it matters: The body schema validates holeNumber 1–18, but the handler never checks it against the round’s `holesToPlay`. Scores POST explicitly enforces this (in scores route, not shown fully here), so claim writes can be accepted for holes that cannot ever be scored in that round (e.g., holes 10–18 in a 9-hole round). This can confuse the score-entry UI (scores GET now returns `claims`) and can become a settlement correctness hazard once resolvers ship.
   - Suggested fix: Fetch `holesToPlay` in the round query (currently selecting id/eventId/eventRoundId/contextId) and add a 422 similar to scores: `hole_number_exceeds_holes_to_play` when `body.holeNumber > round.holesToPlay`.

4. [medium] Money path always attaches `claims: {}` even when there are no claims; could change engine behavior vs pre-2.1 input shape
   - File: apps/tournament-api/src/services/games-money.ts:388-435
   - Confidence: medium
   - Why it matters: `settleFoursome` now always sets `claims` on every `HoleState` pushed (line 434) with an empty object when no claims exist for that hole. Pre-2.1, the `claims` field did not exist at all. If the engine (now or in future) branches on the presence/truthiness of `hole.claims` (an empty object is truthy), this can change behavior even when there are zero claims, violating the “claims inert / exact same edges before resolvers” goal.
   - Suggested fix: Only include the `claims` property when at least one player has a claim on that hole:
- Build `holeClaims` as you do, then `const hasClaims = Object.keys(holeClaims).length > 0;` and push `{..., ...(hasClaims ? { claims: holeClaims } : {}) }`.
Also consider adding a regression test around `computeF1EventEdges` with no claim rows ensuring edges identical to baseline.

5. [low] Append-only “never hard delete” is contradicted by FK cascade on round deletion (data-loss path)
   - File: apps/tournament-api/src/db/schema/hole-claim-writes.ts:59-76
   - Confidence: medium
   - Why it matters: The table is described as immutable/append-only, but `roundId` references rounds with `onDelete: 'cascade'` (lines 59–61). Deleting a round will hard-delete the entire claim write log. This may be acceptable operationally, but it contradicts the stated discipline and can surprise future maintainers relying on “never deleted” semantics.
   - Suggested fix: If true immutability/audit retention is required, change FK behavior to `restrict` (or remove cascade) and handle round deletion explicitly. If cascade is intentional, update the file header/docs to clarify “append-only while the round exists”.

## Strengths

- Append-only storage model is implemented as specified: no cell-unique constraint, one UNIQUE on `client_event_id`, and `INSERT … ON CONFLICT DO NOTHING` in `appendClaimWrite` (claim-write.ts, hole-claim-writes schema).
- Current-state derivation uses “latest write per cell; op='remove' absent” and is covered by focused unit tests, including STALE-REPLAY-NO-RESURRECT (apps/tournament-api/src/services/claim-write.test.ts).
- Claims route is tenant-scoped on reads/writes, refuses finalized/cancelled rounds via state gate, enforces scorer single-writer semantics by reusing the same decision logic (resolveScorerGate), and has route-level tests for dedupe + stale replay + finalized refusal + non-scorer 403 (apps/tournament-api/src/routes/claims.test.ts).
- Scorer-gate refactor appears behavior-preserving for the scores POST path: same decision tree and response mapping, with logic centralized in resolveScorerGate.

## Warnings

- Truncated file content for review: apps/tournament-api/src/routes/scores.ts
