# Codex Review

- Generated: 2026-04-24T00:31:09.079Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/db/seed.ts, apps/tournament-api/src/db/seed.test.ts, apps/tournament-api/src/routes/courses.ts

## Summary

Reviewed the provided diff for T2-2 seed importer + tests. All four requested fixes are present in the current code:
- Fix A: `promoteOrganizer` now tenant-scopes the player lookup and throws if the referenced player is missing in `TENANT_ID` (prevents zero-row UPDATE being reported as “promoted”).
- Fix B: both revision lookups are now tenant-scoped (`existingRevision` and the max `revisionNumber` query).
- Fix C: removed the unused `isNull` import/handling and updated comments accordingly.
- Fix D: added tests covering (1) hole-number uniqueness invariant, (2) defensive sort on shuffled holes, and (3) cross-tenant mismatch throw in `promoteOrganizer`.

No new concrete bugs/regressions are evident from the provided file contents, and the behavior matches the described intent (idempotent seed + safe organizer promotion).

Overall risk: low

## Findings

No concrete findings were identified from the supplied evidence.

## Strengths

- Fix A is implemented with an explicit existence check on the tenant-scoped `players` row before updating (apps/tournament-api/src/db/seed.ts:385-427).
- Fix B tenant scoping is applied to both revision matching and revision-number computation (apps/tournament-api/src/db/seed.ts:245-255, 275-283).
- Defensive sorting of holes before computing out/in totals is correctly implemented and tested (apps/tournament-api/src/db/seed.ts:267-271; apps/tournament-api/src/db/seed.test.ts:157-176).
- Invariant enforcement now includes hole-number uniqueness/completeness (apps/tournament-api/src/db/seed.ts:135-145) with a dedicated test (apps/tournament-api/src/db/seed.test.ts:149-155).
- The CLI guard prevents side effects when importing `seed.ts` in tests (apps/tournament-api/src/db/seed.ts:504-529).

## Warnings

None.
