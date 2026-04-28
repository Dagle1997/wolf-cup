# Codex Review

- Generated: 2026-04-28T12:46:20.592Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/db/schema/scoring.ts, apps/tournament-api/src/db/schema/scoring.test.ts, apps/tournament-api/src/db/schema/audit.ts, apps/tournament-api/src/db/schema/audit.test.ts, apps/tournament-api/src/db/schema/index.ts, apps/tournament-api/src/db/migrations/0004_talented_scarlet_witch.sql, apps/tournament-api/PORTS.md, _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md

## Summary

Implementation largely matches the T5-1 spec: all 6 tables exist with the expected columns/FKs/CHECKs, the hole_scores dual-UNIQUE design is present and exercised by tests, and migration 0004 is additive-only (CREATE TABLE/INDEX; no ALTER/DROP). Main concrete mismatch vs the written ACs is that several indexes are specified in the spec as `... created_at DESC` but are created as default (ascending) indexes in both schema and migration. There are also a couple of real test isolation/coverage gaps worth tightening before downstream stories depend on this schema.

Overall risk: medium

## Findings

1. [medium] Spec requires DESC-ordered audit_log indexes, but schema/migration create default (ASC) indexes
   - File: apps/tournament-api/src/db/schema/audit.ts:25-47
   - Confidence: high
   - Why it matters: The spec/ACs explicitly call for indexes keyed by `created_at DESC` for the primary read patterns ("latest first" history views). The current Drizzle index definitions (`index(...).on(..., t.createdAt)`) generate `CREATE INDEX ... (.., created_at)` with default sort order, which is not equivalent. For common queries like `WHERE entity_type=? AND entity_id=? ORDER BY created_at DESC LIMIT N`, SQLite can use an ASC index by scanning backwards, but that is a different plan shape and can impact performance/predictability; more importantly, it is a correctness-vs-spec mismatch that will keep recurring in reviews.
   - Suggested fix: Either (a) update the schema to emit a DESC index (Drizzle supports SQL fragments in index columns in some dialects; if supported here, use something like `index('...').on(t.entityType, t.entityId, sql`${t.createdAt} DESC`)` and similarly for eventTypeIdx), or (b) explicitly document/approve that ASC is acceptable and update the spec/AC language accordingly. Ensure the generated migration matches the intended ordering.

2. [medium] Spec requires DESC-ordered score_corrections index (round_id, hole_number, created_at DESC) but schema/migration create default (ASC) index
   - File: apps/tournament-api/src/db/schema/scoring.ts:155-187
   - Confidence: high
   - Why it matters: AC #1 states an index on `(round_id, hole_number, created_at DESC)` for score_corrections. The schema defines `index('idx_score_corrections_round_hole_created').on(t.roundId, t.holeNumber, t.createdAt)` which generates ASC ordering. Same impact as audit_log: mismatch vs spec and potentially less optimal plans for "latest corrections first" queries.
   - Suggested fix: Use the same approach as audit_log: emit a DESC index if Drizzle/libsql supports it; otherwise align the spec/ACs to accept ASC with reverse scan and add a short rationale.

3. [medium] Potential cross-file test DB interference by using the same shared in-memory libsql URI in multiple test files
   - File: apps/tournament-api/src/db/schema/scoring.test.ts:13-18
   - Confidence: medium
   - Why it matters: Both `scoring.test.ts` and `audit.test.ts` create clients with `url: 'file::memory:?cache=shared'`. In SQLite semantics, `file::memory:?cache=shared` is a shared in-memory database for connections in the same process. If vitest runs these files in the same worker/process (or changes its concurrency settings), the two suites can see each other’s schema/data and cause flakes (migrations applied twice, unexpected rows, delete-order FK surprises). Your per-test cleanup helps, but cross-suite ordering/concurrency can still bite.
   - Suggested fix: Give each test module a unique memory DB name (e.g., `file:scoring-test?mode=memory&cache=shared` vs `file:audit-test?mode=memory&cache=shared`, or append a random/uuid). Alternatively, use non-shared `':memory:'` if drizzle/libsql doesn’t require shared cache for your usage.

4. [low] Several schema constraints mandated by ACs are not covered by tests (risk of accidental drift)
   - File: apps/tournament-api/src/db/schema/scoring.test.ts:158-405
   - Confidence: high
   - Why it matters: Current tests cover FK PRAGMA, the dual-UNIQUE behavior, chk_rounds_event_pairing, and two FK delete postures for hole_scores. But there are no tests pinning: `chk_rounds_holes_to_play` (only 9/18), `chk_hole_scores_hole_number`, `chk_hole_scores_gross_strokes_positive`, `chk_score_corrections_hole_number`, `chk_round_states_state`, and `chk_scorer_assignments_foursome_number_positive`. Since these are part of the AC-described contract, missing tests makes it easier for a future drizzle-kit regen or schema refactor to silently weaken constraints.
   - Suggested fix: Add a small set of negative/positive tests per CHECK (one failing insert each is enough). This can be done with minimal fixture seeding and will materially reduce schema drift risk for downstream T5 stories.

## Strengths

- Migration 0004 is additive-only (all CREATE TABLE/INDEX; no ALTER/DROP), satisfying the additivity requirement.
- Wolf Cup hole_scores port deltas described in scoring.ts/PORTS.md match the generated migration (text PK/FKs, gross_strokes rename, scorer_player_id/client_event_id additions, dual UNIQUE indexes, gross_strokes positivity CHECK).
- Dual-UNIQUE idempotency design is correctly implemented and verified via the exact `onConflictDoNothing({ target: [...] })` insert form in tests 4a/4b/4c.
- FK delete posture matches the spec table: round-scoped CASCADE and player-scoped RESTRICT are consistently applied across tables.
- Path footprint appears compliant with the story constraints (schema/tests/migrations/PORTS.md/index re-exports only; no routes/middleware/UI).

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T5-1-scoring-schema.md
