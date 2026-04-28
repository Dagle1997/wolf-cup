# Codex Review

- Generated: 2026-04-28T12:54:30.922Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/db/schema/scoring.ts, apps/tournament-api/src/db/schema/scoring.test.ts, apps/tournament-api/src/db/schema/audit.ts, apps/tournament-api/src/db/schema/audit.test.ts, apps/tournament-api/src/db/schema/index.ts, apps/tournament-api/src/db/migrations/0004_supreme_gambit.sql, apps/tournament-api/PORTS.md

## Summary

Round-2 MED/LOW fixes visible in the provided files look resolved (added `:memory:` rationale comments; `scoring.test.ts` now deletes new T5-1 tables in FK-safe order). No new obvious regressions were introduced by those changes.

The earlier [HIGH] “migration history rewrite” concern is largely outside what can be proven from this diff alone. Within the repo contents shown here, only `0004_supreme_gambit.sql` exists and it is additive; nothing in the diff indicates a committed rewrite. A residual risk remains for any database that might have applied uncommitted local migrations (even if you believe none exist), because Drizzle/libsql migration tooling generally won’t protect you from “applied-but-file-missing” drift without an explicit guard.

One concrete, code-level risk worth addressing before commit is the hard-coded `tenant_id DEFAULT 'guyan'` on all newly created tables in `0004_supreme_gambit.sql` (and implied by `ecosystemColumns()` usage). If any caller forgets to set `tenantId`, rows will silently land in the default tenant, which is a cross-tenant data integrity/security footgun in a schema that otherwise clearly models tenancy.

Overall risk: medium

## Findings

1. [medium] New scoring/audit tables default `tenant_id` to a specific tenant (`'guyan'`), risking silent cross-tenant writes if callers omit tenantId
   - File: apps/tournament-api/src/db/migrations/0004_supreme_gambit.sql:1-106
   - Confidence: high
   - Why it matters: All new tables (`audit_log`, `rounds`, `hole_scores`, `score_corrections`, `round_states`, `scorer_assignments`) declare `tenant_id text DEFAULT 'guyan' NOT NULL`. In a schema that includes `tenant_id`/`context_id` everywhere, this strongly implies multi-tenant partitioning is intended. A default tenant means any insert path (present or future) that forgets to set `tenantId` will still succeed and will write into the wrong tenant—this is both a data integrity bug and, depending on authorization patterns, can become a data isolation/security issue.
   - Suggested fix: Remove the `DEFAULT 'guyan'` for `tenant_id` on these new tables (and ideally everywhere, but at least for the new ones) so missing tenantId fails fast. If existing tables intentionally keep the default, consider adding app-layer insert helpers that always set tenantId/contextId, and/or add migration-time assertions/tests that inserts without tenantId are rejected.

2. [low] Residual migration-drift risk is not mitigated in-repo (applied-but-missing local migrations would leave a DB unable to reconcile history)
   - File: apps/tournament-api/src/db/migrations/0004_supreme_gambit.sql:1-106
   - Confidence: medium
   - Why it matters: Your narrative asserts no environment ever applied the uncommitted 0004/0005 files. That may be true, but it is not enforceable from the repository itself. If any persistent DB (a dev machine, a forgotten staging file, etc.) did apply them, Drizzle’s migration system can end up in an unrecoverable or confusing state where `__drizzle_migrations` contains entries that no longer correspond to files, complicating future upgrades and potentially causing manual intervention/data risk.
   - Suggested fix: If you want this fully closed at the repo level, add a small deploy/startup guard that checks `__drizzle_migrations` entries are a subset of the filenames present in `src/db/migrations/` and fails with a clear error if unknown migrations are detected. Also document a recovery procedure (dump/restore or manual row deletion) if drift is found.

3. [low] `rounds.opened_at` and `opened_by_player_id` can be set inconsistently (no CHECK tying nullability together)
   - File: apps/tournament-api/src/db/schema/scoring.ts:67-95
   - Confidence: medium
   - Why it matters: `openedAt` is nullable and `openedByPlayerId` is nullable, but nothing prevents `opened_at` being set while `opened_by_player_id` is NULL (or vice versa). That can complicate downstream logic (who opened the round? when?) and makes audit attribution weaker.
   - Suggested fix: Add a CHECK similar to your event/event_round pairing check, e.g. `(opened_at IS NULL) = (opened_by_player_id IS NULL)` if v1 semantics require both-or-neither. If you intentionally allow system-opened rounds, encode that explicitly (e.g., allow opened_at non-null with opened_by null).

## Strengths

- Round-2 test isolation documentation is now present in both `scoring.test.ts` and `audit.test.ts` (`:memory:` rationale is clearly explained).
- `scoring.test.ts` `beforeEach` now clears all new T5-1 tables in reverse FK order, reducing cross-test contamination risk.
- Schema expresses key invariants with CHECKs and FK actions (notably `chk_rounds_event_pairing` and hole score bounds), and the dual-UNIQUE behavior is exercised with targeted tests (4a/4b/4c).
- Indexing choices match anticipated query patterns (by round, by scorer, by entity+created_at in audit).

## Warnings

None.
