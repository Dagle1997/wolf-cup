# Codex Review

- Generated: 2026-04-24T00:28:16.332Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/db/seed.ts, apps/tournament-api/src/routes/courses.ts

## Summary

All four stated fixes appear applied in the provided files: (A) tenant scoping added throughout `GET /api/courses`; (B) hole-number completeness/uniqueness invariant + defensive sort added; (C) per-transaction `delta` accumulator merged only after commit; (D) organizer promotion queries now tenant-scoped. No obvious regressions in the route. A couple of concrete correctness/robustness issues remain in `seed.ts` around organizer promotion and tenant scoping of some revision queries, plus a misleading comment about null handling.

Overall risk: medium

## Findings

1. [medium] promoteOrganizer can return "promoted" even if no player row was updated (cross-tenant/mismatched foreign key case)
   - File: apps/tournament-api/src/db/seed.ts:378-405
   - Confidence: high
   - Why it matters: In the existing-identity path, you tenant-scope the `players` lookup/update (good), but if `oauthIdentities.playerId` points to a player row not in `TENANT_ID` (the mismatch scenario you explicitly mention), `playerRow[0]` will be undefined and the subsequent `update(players)...where(id AND tenantId)` will affect 0 rows. The function still logs `seed_organizer_promoted` and returns `{ action: 'promoted' }`, leaving the organizer unpromoted while reporting success.
   - Suggested fix: After fetching `playerRow`, explicitly handle the missing-player case (e.g., throw with a clear error and log), or perform the update with a returning/rowcount check and only return `promoted` if a row was actually updated.

2. [low] Seed revision queries are not tenant-scoped, weakening defense-in-depth and potentially miscomputing revision numbers in pathological data states
   - File: apps/tournament-api/src/db/seed.ts:245-279
   - Confidence: medium
   - Why it matters: `existingRevision` and the `nextRevisionNumber` lookup filter only by `courseId` (and other fields) but not `tenantId`. While `courseId` is a UUID and normally tenant-specific via the earlier course lookup, this still creates an unnecessary cross-tenant coupling if data is ever inconsistent (e.g., incorrect foreign keys, manual DB edits, future migrations). It also deviates from your explicit posture of tenant-scoping every query for defense-in-depth.
   - Suggested fix: Add `eq(courseRevisions.tenantId, TENANT_ID)` (and similarly for any other dependent tables if queried by foreign key alone) to the `existingRevision` and `existing` (max revision) queries.

3. [low] Comment claims a null-safe sourceUrl match pattern that is not implemented (isNull is unused)
   - File: apps/tournament-api/src/db/seed.ts:241-259
   - Confidence: high
   - Why it matters: The comment says you use an “isNull-or-eq pattern” for future null `sourceUrl`, but the actual `existingRevision` query uses only `eq(courseRevisions.sourceUrl, course.source)`. If future data includes null `sourceUrl`, reruns may create duplicate revisions instead of matching. This is currently a documentation/behavior mismatch, and `isNull` is only retained via `void isNull` rather than used.
   - Suggested fix: Either implement the intended null-tolerant predicate (e.g., `and(eq(courseRevisions.courseId,...), eq(courseRevisions.extractionDate,...), or(isNull(courseRevisions.sourceUrl), eq(courseRevisions.sourceUrl, course.source)))` depending on desired semantics) or adjust the comment/remove the unused import.

4. [low] No tests added for new seed importer invariants/idempotency and organizer promotion paths
   - File: apps/tournament-api/src/db/seed.ts:177-434
   - Confidence: medium
   - Why it matters: This diff replaces a placeholder seed with substantial logic (schema validation, invariants, idempotent upsert-like behavior, organizer promotion). With tests unchanged, regressions in idempotency (duplicate inserts), invariants (holes ordering), and organizer behavior (promotion/preseed) may go unnoticed, especially since CLI-only code paths aren’t typically exercised by existing API tests.
   - Suggested fix: Add targeted tests for `assertInvariants`/`runSeed` idempotency (second run produces only “Skipped”), hole ordering (unsorted holes still compute correct out/in), and `promoteOrganizer` (existing identity promoted, already organizer no-op, invalid sub rejected, mismatched player/tenant handled).

## Strengths

- Fix A verified: `GET /api/courses` scopes courses (line 40), revisions (lines 76-81), and tees (lines 107-112) by `tenantId`.
- Fix B verified: explicit hole-number uniqueness/completeness check (lines 135-145) plus defensive sort before out/in totals and hole inserts (lines 266-270, 315-329).
- Fix C verified: per-course `delta` accumulates within transaction and is merged only after transaction completes (lines 201-208, 332-339).
- Fix D partially verified: player select/update in `promoteOrganizer` now tenant-scoped (lines 383-399).

## Warnings

None.
