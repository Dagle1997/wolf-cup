# Codex Review

- Generated: 2026-05-04T13:44:55.162Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/db/schema/bets.ts, apps/tournament-api/src/db/schema/index.ts, apps/tournament-api/src/db/migrations/0005_individual_bets.sql, apps/tournament-api/src/lib/audit-log.ts, apps/tournament-api/src/engine/rules/individual-bets.ts, apps/tournament-api/src/engine/rules/individual-bets.test.ts, apps/tournament-api/src/engine/rules/__fixtures__/individual-bet-a-per-hole-1-round.json, apps/tournament-api/src/engine/rules/__fixtures__/individual-bet-c-auto-press-chain.json, apps/tournament-api/src/engine/rules/__fixtures__/individual-bet-d-tie-round.json, apps/tournament-api/src/routes/bets.ts, apps/tournament-api/src/routes/bets.integration.test.ts, apps/tournament-api/src/app.ts

## Summary

T6-3 largely matches the described spec surface: new schema tables/constraints, audit constants, pure computeIndividualBet engine with fixed-point auto-press discovery, and a POST /api/events/:eventId/bets route with in-tx business validation + UNIQUE handling. Tests cover many key cases.

Main risks found are (1) engine/press-fire suppression hard-codes 18 holes (can emit presses beyond the actual round length), (2) DB integrity depends on the route for canonical ordering + anti-self-bet (allowing swapped duplicates / self-bets via other writers), and (3) route validation order differs from the stated/required order (config validated before in-tx checks), affecting error precedence and potentially AC-12 compliance.

Overall risk: medium

## Findings

1. [high] Auto-press suppression hard-codes 18 holes; can emit presses for holes that don't exist in the round (e.g., 9-hole rounds / shortened rounds)
   - File: apps/tournament-api/src/engine/rules/individual-bets.ts:440-482
   - Confidence: high
   - Why it matters: findAutoFiresInSegment suppresses a fire only when firedAtHole > 18. If a round is fewer than 18 holes (the schema has eventRounds.holesToPlay elsewhere, and courses/rounds can plausibly be 9 holes), the engine can emit a PressFireRow with firedAtHole beyond the last playable hole. That press would (a) be nonsensical to persist, and (b) create replay/idempotency noise or downstream validation failures if later layers assume firedAtHole must be within the round’s holes.
   - Suggested fix: Replace the hard-coded `<= 18` check with a check against the round’s actual last hole. Options: (1) pass `maxHoleNumber` (derived from `holes` or `scoredHoleNumbers`) into findAutoFiresInSegment; (2) compute `const maxHole = Math.max(...holes.map(h=>h.holeNumber))` once in computeAutoPressFixedPoint and suppress fires where `firedAtHole > maxHole`. Add a test for a 9-hole round where a trigger at hole 9 should NOT fire (firedAtHole=10).

2. [medium] DB integrity relies on route to enforce canonical (player_a_id, player_b_id) ordering and to prevent self-bets; swapped duplicates and A==B are possible via non-route writers
   - File: apps/tournament-api/src/db/schema/bets.ts:23-84
   - Confidence: high
   - Why it matters: The UNIQUE index is on (event_id, player_a_id, player_b_id, bet_type). Without a DB-level CHECK enforcing `player_a_id < player_b_id` (canonical ordering), it’s possible to insert both (A,B) and (B,A) directly into the DB and bypass uniqueness. Similarly, there is no DB-level constraint preventing `player_a_id = player_b_id`.

Even if today only the route writes these tables, this is the first schema-touching story in T6 and future code paths (admin scripts, backfills, other endpoints) can accidentally create corrupt duplicates that the DB won’t block.
   - Suggested fix: Add CHECK constraints in `individual_bets` such as:
- `CHECK(player_a_id <> player_b_id)`
- `CHECK(player_a_id < player_b_id)` (or whatever canonical comparator you’re using)
Then regenerate/adjust the migration. If you intentionally deferred this, consider at least adding the self-bet CHECK now (it doesn’t depend on lexical ordering semantics).

3. [medium] Route validation order differs from the documented/spec order; config is validated before in-tx checks, changing error precedence (AC-12 risk)
   - File: apps/tournament-api/src/routes/bets.ts:11-162
   - Confidence: high
   - Why it matters: The header comment states validation order "per T6-3 spec Section 6" with config validation occurring inside the transaction after several in-tx validations. In the implementation, config is validated before starting the transaction (routes/bets.ts:125-150), meaning requests that would otherwise fail with e.g. self_bet_not_allowed / players_not_in_event can instead fail first with invalid_config.

If AC-12 expects specific precedence (and your integration tests mention explicit ordering/no-leak behavior), this deviation can cause regressions later when clients depend on stable error codes.
   - Suggested fix: Move config validation into the transaction at the intended step, or update the spec/comment/tests to explicitly allow config validation to occur earlier. If keeping it early, add integration tests that lock in the expected precedence (e.g., self-bet + invalid config → which code wins) to prevent future drift.

## Strengths

- Schema includes the requested UNIQUE and CHECK constraints for bet_type/stake and press constraints (hole range, trigger_type enum, multiplier >= 1).
- Engine is pure (no I/O/clock/DB) and includes explicit boundary validation and deterministic replay tests.
- Fixed-point evaluation dedupes against existing presses and preserves existing multipliers by copying persisted rows and only applying current multiplier to newly triggered presses.
- Route correctly enforces canonical player ordering before insert, checks both players are event participants, validates applicable rounds belong to event, and catches UNIQUE violations as a business error.
- Integration tests assert canonical ordering persistence and audit row creation, plus duplicate bet handling and no-existence-leak behavior via requireEventParticipant.

## Warnings

None.
