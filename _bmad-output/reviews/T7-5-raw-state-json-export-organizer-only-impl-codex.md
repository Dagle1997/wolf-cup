# Codex Review

- Generated: 2026-05-05T14:32:31.503Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/services/export.ts, apps/tournament-api/src/services/export.test.ts, apps/tournament-api/src/routes/export.ts, apps/tournament-api/src/routes/export.integration.test.ts, apps/tournament-api/src/app.ts

## Summary

Core export builder is structured sensibly (dependency-ordered fetches, empty-IN short-circuits, per-(entityType, ids) OR filter for audit_log) and the route mounts behind requireSession → requireOrganizer as intended. Main correctness risks are: (1) filename date formatting can throw on invalid timezones outside the route’s try/catch, (2) tenant scoping is only enforced on the initial events lookup (other tables are queried without tenant/context filters), and (3) a likely TypeScript type error around the Db type aliasing. The integration test file is truncated in the provided content, so AC-4 (full FK-closure replay) cannot be confirmed from evidence here.

Overall risk: medium

## Findings

1. [high] Route can throw after successful export build if event timezone is invalid (outside try/catch)
   - File: apps/tournament-api/src/routes/export.ts:43-72
   - Confidence: high
   - Why it matters: The try/catch only wraps buildEventExport(). After payload is built, exportFilename() calls exportYmd(), which uses Intl.DateTimeFormat with the event’s timezone. If the DB contains an invalid IANA timezone (or a legacy/empty value), Intl.DateTimeFormat throws a RangeError. That would bypass the handler’s error response path and can result in an unhandled exception (500 without your structured { code, requestId } payload, and potentially noisy logs/crash depending on runtime).
   - Suggested fix: Move filename computation inside the existing try/catch, or wrap exportFilename(...) in its own try/catch and fall back to UTC on failure (and/or push a warning into payload.warnings). Add an integration/unit test that seeds an event with an invalid timezone and asserts a stable 200 with a UTC-based filename or a structured 500 with code=export_failed.

2. [medium] Tenant scoping enforced only for events table; other exported tables can be cross-tenant contaminated if IDs are reused
   - File: apps/tournament-api/src/services/export.ts:143-397
   - Confidence: medium
   - Why it matters: buildEventExport() checks (events.id, events.tenantId) (lines 144-149), but subsequent selects are only scoped by eventId/eventRoundId/roundId etc. If IDs are ever reused across tenants (e.g., imports, test fixtures, manual DB edits, or non-UUID identifiers in future), the export could include rows from another tenant that happen to share the same eventId/roundId/etc. This is a data-leak risk and can also violate the intended per-tenant closure invariant.
   - Suggested fix: Add tenantId (and where appropriate contextId) predicates to all table queries, e.g. .where(and(eq(table.eventId, eventId), eq(table.tenantId, tenantId))) and similarly for round-scoped tables via joins/subqueries or by filtering on tenantId directly if present. Consider a regression test that seeds a second tenant with a colliding eventId/roundId and asserts those rows do not appear.

3. [medium] Suspicious/likely-invalid Db type aliasing (`import type` + `typeof`)
   - File: apps/tournament-api/src/services/export.ts:25-60
   - Confidence: high
   - Why it matters: The file does `import type { db as DbType } from '../db/index.js'` (line 26) and then `type Db = typeof DbType;` (line 59). In standard TypeScript, `typeof X` in a type position requires X to be a value identifier; `import type` explicitly removes the value import. This pattern typically fails typechecking and/or confuses the intended type, risking drift between the real db type and the function signature.
   - Suggested fix: If the goal is “type of the exported db value”, use a value import and type-query it: `import { db } from '../db/index.js'; type Db = typeof db;` (but avoid runtime import if that’s undesirable). Or, if db/index exports a dedicated type (common pattern), import that: `import type { Db } from '../db/index.js';` and use it directly (no `typeof`).

4. [medium] Cannot verify AC-4 (full FK-closure replay) from provided evidence due to truncated integration test content
   - File: apps/tournament-api/src/routes/export.integration.test.ts:711
   - Confidence: medium
   - Why it matters: The spec focus calls out FK-closure replay under PRAGMA foreign_keys=ON. The provided integration test content shows a replay helper inserting a subset of tables, but the file is truncated mid-helper, so it’s not possible here to confirm whether all exported tables (pairings, round_states, scorer_assignments, score_corrections, presses, sub_game_* results, gallery_photos, audit_log, etc.) are replayed and validated without constraint violations. If replay omits any exported FK-bearing table, the test may pass while the export is not actually replayable as a closed set (the stronger AC-4 claim).
   - Suggested fix: Ensure the round-trip test re-inserts every exported table that participates in FK constraints and fails on any insert-order/closure issue. If moneyMatrix parity is the only intent, add a separate explicit FK-closure replay test that inserts *all* exported rows and asserts no exceptions under foreign_keys=ON.

## Strengths

- Audit-log query composition is correctly OR-composed per (entityType, entityId-list), preventing cross-type entityId collisions (apps/tournament-api/src/services/export.ts:332-348).
- Empty-IN-list short-circuits are consistently applied before inArray(...) to avoid malformed query composition and unnecessary DB calls (multiple sections, e.g., groupMembers at 179-185, auditPredicates at 340-348).
- Route auth chain order matches the stated 401 < 403 < 404 resolution (apps/tournament-api/src/routes/export.ts:34-61).
- Filename slugging is restrictive (a-z0-9 and hyphen only), which mitigates Content-Disposition header injection via event names (apps/tournament-api/src/services/export.ts:740-748).
- Integration tests cover happy path, empty event behavior, auth outcomes, and auditLog scoping for unrelated events (apps/tournament-api/src/routes/export.integration.test.ts:565-709).

## Warnings

- Truncated file content for review: apps/tournament-api/src/routes/export.integration.test.ts
