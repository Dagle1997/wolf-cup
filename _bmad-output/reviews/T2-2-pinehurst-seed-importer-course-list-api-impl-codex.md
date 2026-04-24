# Codex Review

- Generated: 2026-04-24T00:24:43.240Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/db/seed.ts, apps/tournament-api/src/db/seed.test.ts, apps/tournament-api/src/routes/courses.ts, apps/tournament-api/src/routes/courses.test.ts, apps/tournament-api/src/app.ts, apps/tournament-api/package.json, apps/tournament-api/Dockerfile

## Summary

T2-2 implementation largely matches the stated transforms/spec: seed JSON is schema-validated via Zod, invariants catch SI/yardage issues, revision idempotency keys align with spec, per-course transactions prevent partial per-course inserts, and the Dockerfile copies the reference JSON into the expected dist layout. The GET /api/courses route returns camelCase data with tees/courses ordering and highest-revision selection, and tests cover core behaviors.

Main concrete risks found are around multi-tenant scoping in the read API (and some write paths), and a correctness assumption that the holes array is already ordered 1–18 when computing out/in totals and when inserting holes.

Overall risk: medium

## Findings

1. [high] GET /api/courses is not tenant-scoped (potential cross-tenant data leak / incorrect results)
   - File: apps/tournament-api/src/routes/courses.ts:27-116
   - Confidence: high
   - Why it matters: The handler selects all rows from `courses` with no `tenantId`/`contextId` filter, then loads revisions/tees by courseId. In any environment where the DB contains multiple tenants (or future expands to), this endpoint will return other tenants’ course library data. This is both a privacy/security concern and a correctness issue (wrong data shown in admin UI/event creation).
   - Suggested fix: Add tenant scoping to every query, e.g. `where(eq(courses.tenantId, TENANT_ID))` (or derive tenant from auth/session) and similarly scope courseRevisions/courseTees queries (even if via join). Consider enforcing tenant via joins rather than trusting courseId alone.

2. [medium] Seed totals and hole insertion assume `holes` array is ordered 1..18; duplicates/missing hole numbers aren’t validated
   - File: apps/tournament-api/src/db/seed.ts:114-299
   - Confidence: high
   - Why it matters: `outTotal`/`inTotal` are computed via `slice(0, 9)`/`slice(9)` (lines 237-240), which only corresponds to holes 1–9/10–18 if the JSON array is already ordered. Zod constrains each hole’s `hole` to 1..18 but does not enforce uniqueness or ordering; `assertInvariants` validates SI coverage but not hole-number coverage/order. If the input ever comes unsorted or with duplicated/missing hole numbers, you can store wrong totals and insert inconsistent hole rows.
   - Suggested fix: Either (a) assert hole numbers are exactly 1..18 with no duplicates and in ascending order, or (b) sort a copy of `course.holes` by `hole` before computing totals and inserting rows. Add a test that shuffles holes to ensure totals still compute correctly (or that the seed rejects it).

3. [medium] Seed report counters can become inaccurate if a transaction rolls back after incrementing counts
   - File: apps/tournament-api/src/db/seed.ts:165-303
   - Confidence: medium
   - Why it matters: The report counters are mutated inside the transaction after inserts (e.g., `report.revisionsInserted += 1` at line 268). If any later insert in the same transaction fails (e.g., a tee/hole insert constraint error), the transaction will roll back but the report will still claim inserts occurred. This can mislead operators/CI diagnostics.
   - Suggested fix: Accumulate per-course/per-transaction deltas in local variables and only merge into `report` after the transaction resolves successfully. Alternatively, increment after all inserts succeed (end of tx function) so thrown errors prevent mutation.

4. [low] promoteOrganizer updates/selects players without tenant/context filtering (future multi-tenant ambiguity)
   - File: apps/tournament-api/src/db/seed.ts:311-392
   - Confidence: medium
   - Why it matters: `promoteOrganizer` looks up the oauth identity with a tenant filter (good), but then reads/updates `players` by `id` only (lines 341-356). If player IDs are not globally unique across tenants (or if the schema changes), this could promote the wrong row. Even with UUIDs, adding tenant scoping makes the intent explicit and guards against unexpected future constraints.
   - Suggested fix: Include `tenantId` (and possibly `contextId`) filters in the player select/update: `where(and(eq(players.id, playerId), eq(players.tenantId, TENANT_ID)))` and ensure inserts always set those fields (tests too).

## Strengths

- Seed JSON is strongly validated with Zod (`SeedDataSchema`) and fails fast before DB writes.
- Good invariant checks for SI coverage and per-tee yardage presence; warns (not fails) on claimed-par vs hole-sum divergence as intended.
- Per-course transaction boundaries prevent partial per-course writes; read-first idempotency keys match the stated design for courses and revisions.
- Rating transform `Math.round(tee.rating * 10)` and extractionDate parsing align with the spec; verified defaulting behavior matches the described rules.
- CLI guard prevents side effects on test import; dev/prod path resolution is explicit and Dockerfile copies JSON to the expected dist location.
- Route tests cover ordering, camelCase shape, rating scaling, tee ordering, and latest-revision selection.

## Warnings

None.
