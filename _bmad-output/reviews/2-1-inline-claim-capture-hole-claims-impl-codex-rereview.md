# Codex Review

- Generated: 2026-06-22T01:59:47.883Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/claim-write.ts, apps/tournament-api/src/db/schema/hole-claim-writes.ts, apps/tournament-api/src/routes/claims.ts, apps/tournament-api/src/db/migrations/0020_eager_human_cannonball.sql, apps/tournament-api/src/routes/claims.test.ts

## Summary

All three previously-raised issues appear fully resolved in the provided code, and I don’t see a new High-severity regression introduced by these fixes.

1) Concurrency-safe seq / resurrection-proofing
- `seq` is now `INTEGER PRIMARY KEY AUTOINCREMENT` (rowid alias) in both schema and migration (apps/tournament-api/src/db/schema/hole-claim-writes.ts:59; apps/tournament-api/src/db/migrations/0020_eager_human_cannonball.sql:1-3). This eliminates the prior MAX(seq)+1 race/tie entirely: the PK guarantees uniqueness and SQLite assigns it under the single-writer lock.
- `appendClaimWrite` now omits `seq` from `.values(...)` and reads it via `.returning({ seq: ... })` (apps/tournament-api/src/services/claim-write.ts:69-95). Under `ON CONFLICT DO NOTHING`, SQLite’s `RETURNING` yields 0 rows for the no-op path, and your code correctly interprets `result.length === 0` as `{ inserted:false }` (apps/tournament-api/src/services/claim-write.ts:92-96). The route-level dedupe test demonstrates that the conflict/no-op path works end-to-end without appending or auditing (apps/tournament-api/src/routes/claims.test.ts:183-200).
- On “concurrent same-cell set+remove”: with this design the canonical order is now strictly the DB append order (seq). That makes the “latest write per cell” deterministic and prevents the specific resurrection failure mode from tied seq values. Note: if two *distinct* operations (different `clientEventId`s) race, whichever insert actually lands later (higher seq) will be treated as latest—this is expected for an append-only log ordered by server sequence.

2) NUL delimiter removal / Map key safety
- The delimiter is now a printable `|` (apps/tournament-api/src/services/claim-write.ts:141-152). Given the stated invariants in this codepath—`playerId` is UUID-validated at the route boundary (apps/tournament-api/src/routes/claims.ts:54-60), `holeNumber` is an int, and `claimType` is an enum token—`|` collision risk is effectively nil. The prior “literal NUL byte” tooling risk is removed.

3) holesToPlay enforcement
- The claims route now loads `event_rounds.holes_to_play` tenant-scoped through `round.eventRoundId` and rejects `holeNumber > holesToPlay` with 400 `hole_out_of_play` (apps/tournament-api/src/routes/claims.ts:129-155). The new test covers both rejection (hole 14 on a 9-hole round) and acceptance (hole 9) and asserts no writes were appended on rejection (apps/tournament-api/src/routes/claims.test.ts:212-233).

Overall risk: low

## Findings

No concrete findings were identified from the supplied evidence.

## Strengths

- `seq` moved to DB-assigned `INTEGER PRIMARY KEY AUTOINCREMENT` and MAX(seq)+1 logic is fully removed; this directly addresses the original concurrency/tie root cause (claim-write.ts:69-95; hole-claim-writes.ts:59; migration 0020).
- Correct handling of the ON CONFLICT DO NOTHING path by treating empty RETURNING results as deduped/no-op, and the route enforces “no audit/activity on dedupe” (claim-write.ts:89-96; claims.ts:248-254; claims.test.ts:183-200).
- NUL-byte delimiter eliminated; `|` is compatible with toolchains and safe under the route’s UUID/int/enum validation assumptions (claim-write.ts:141-152; claims.ts:53-60).
- holes-to-play gate added with tenant-scoped lookup and has a focused regression test asserting both 400 behavior and zero appended rows (claims.ts:129-155; claims.test.ts:212-233).

## Warnings

None.
