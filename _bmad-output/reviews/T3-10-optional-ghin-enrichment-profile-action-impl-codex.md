# Codex Review

- Generated: 2026-04-27T20:21:44.799Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/players.ts, apps/tournament-api/src/routes/players.test.ts, apps/tournament-api/src/routes/auth.ts, apps/tournament-api/src/routes/auth.test.ts, apps/tournament-web/src/routes/profile.tsx, apps/tournament-web/src/routes/profile.test.tsx, _bmad-output/implementation-artifacts/tournament/T3-10-optional-ghin-enrichment-profile-action.md

## Summary

Spec alignment is mostly strong: 3 new requireSession-gated mutation endpoints exist with 4KB bodyLimit; link responses use the `result` discriminator; search single-match re-validates via getHandicap before binding; 404/503/409 paths do not write `players.ghin`; /api/auth/status is extended additively and tenant-scoped. Two concrete issues remain: a test file syntax error due to a late `import`, and API correctness risk where successful responses are returned even if the tenant-scoped UPDATE matched 0 rows.

Overall risk: high

## Findings

1. [critical] players.test.ts has an `import` mid-file (module syntax error)
   - File: apps/tournament-api/src/routes/players.test.ts:283-294
   - Confidence: high
   - Why it matters: In ESM/TS, `import` declarations must appear before other statements. The added `import { eq } from 'drizzle-orm';` after existing code will fail parsing, preventing the entire test file (and likely the suite) from running. This undermines the claimed +18 backend tests and can mask regressions.
   - Suggested fix: Move `import { eq } from 'drizzle-orm';` up with the other top-level imports (and ensure it’s declared only once). Alternatively, remove this late import and reuse an existing top import.

2. [medium] Link/manual-handicap/unlink return success even if tenant-scoped UPDATE affects 0 rows
   - File: apps/tournament-api/src/routes/players.ts:260-459
   - Confidence: high
   - Why it matters: All three mutation routes scope UPDATEs by `(players.id = session.playerId AND players.tenantId = TENANT_ID)` but never verify that a row was actually updated. If `requireSession` ever yields a session whose player row has a different/missing tenantId (or the player row was deleted), the API will still return 200 (including `result:'linked'`) even though no state changed. That’s a correctness bug and can create confusing UX and harder-to-debug auth/tenant issues.
   - Suggested fix: Check the update result’s affected row count (e.g., `rowsAffected`) and if 0, return a safe error (404 player_not_found or 500) rather than reporting success. Apply to bindGhin UPDATE, unlink UPDATE, and manual-handicap UPDATE.

3. [low] No tests pin the 4KB `bodyLimit` 400 body_too_large branch for the new mutation endpoints
   - File: apps/tournament-api/src/routes/players.test.ts:296-581
   - Confidence: high
   - Why it matters: AC contract explicitly calls out bodyLimit=4KB and the `400 body_too_large` branch. The middleware is present, but without tests it’s easier for future refactors to drop or misconfigure the limit unnoticed.
   - Suggested fix: Add at least one test per route (or table-driven test) that sends a >4KB JSON body and asserts 400 `{ code:'body_too_large' }`.

## Strengths

- All three new mutation endpoints are present under players router and gated by requireSession, and all three apply a 4KB bodyLimit middleware (AC #1-#3).
- POST /me/ghin/link uses a discriminated union request schema and returns an explicit `result: 'linked' | 'multi-match'` discriminator (AC #2).
- Search single-match auto-links via bindGhin(), which re-validates using `ghinClient.getHandicap()` before writing (spec-required re-validation).
- 409 ghin_already_linked is driven by catching a SQLite UNIQUE constraint error during the UPDATE, matching the acceptance contract; there is a dedicated test for the collision path.
- 404 ghin_not_found paths return before any UPDATE, and multi-match returns without updating, preserving FR-E11 ‘failures don’t mutate player state’ (AC #16).
- GET /api/auth/status is extended additively to include `ghin` and `manualHandicapIndex`, and the player SELECT is tenant-scoped (AC #6).
- No new backend guard of the form `if (player.ghin === null) return ...` was introduced in the touched API files; the /profile page renders with ghin=null (FR-E11 invariant).
- Touched paths appear to stay within the story’s ALLOWED file list (no SHARED/forbidden edits evident in the provided diff).

## Warnings

- Truncated file content for review: apps/tournament-api/src/routes/auth.ts
- Truncated file content for review: apps/tournament-api/src/routes/auth.test.ts
