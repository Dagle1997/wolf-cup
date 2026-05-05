# Codex Review

- Generated: 2026-05-05T13:17:06.010Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/lib/r2-client.ts, apps/tournament-api/src/lib/r2-client.test.ts, apps/tournament-api/src/routes/gallery.ts, apps/tournament-api/src/routes/gallery.integration.test.ts, apps/tournament-api/src/db/schema/gallery.ts, apps/tournament-api/src/db/schema/gallery.test.ts, apps/tournament-api/src/db/schema/index.ts, apps/tournament-api/src/db/migrations/0008_gallery_photos.sql, apps/tournament-api/src/db/migrations/meta/_journal.json, apps/tournament-api/src/lib/audit-log.ts, apps/tournament-api/src/lib/env.ts, apps/tournament-api/src/app.ts

## Summary

The core upload flow is structurally sound (R2 PUT → DB tx with gallery row + audit + activity → best‑effort R2 cleanup on tx failure), and the schema FK posture matches the stated CASCADE/SET NULL/RESTRICT intent with tests that actually exercise those constraints. Main risks are around (1) post-commit failures (presigning) causing clients to retry and create duplicates, (2) missing test coverage for the “R2 succeeded, DB failed → cleanup” path, (3) DELETE ordering (R2-first) creating broken DB rows if the DB delete fails, and (4) the aws-sdk presigner client cast potentially hiding a future runtime incompatibility. Also one integration test claims to validate grouping/ordering but currently doesn’t.

Overall risk: medium

## Findings

1. [high] POST upload can return 500 after DB commit if presigning fails, encouraging client retries and duplicate photos
   - File: apps/tournament-api/src/routes/gallery.ts:193-243
   - Confidence: high
   - Why it matters: In POST, once the DB transaction commits (gallery row + audit + activity), the handler then calls `getSignedDownloadUrl` outside any try/catch (line 236). If presigning throws (aws-sdk mismatch, transient failure, misconfig where r2Configured is true but client/presigner errors), the request will fail after the photo is already persisted. Clients typically retry failed uploads, producing duplicate gallery rows and extra R2 objects. This is a correctness/data-integrity risk in the exact upload sequence you asked to focus on.
   - Suggested fix: Wrap presigning in a try/catch. On failure, still return success for the already-created photo (e.g., `{ id, roundId, signedUrl: null }` or omit `signedUrl`) and have the client refetch the list to obtain a signed URL. Alternatively sign earlier (before commit) but that has other failure modes; the key is to avoid surfacing a hard failure after persistence.

2. [medium] Missing test for “R2 PUT succeeded, DB insert failed → best-effort R2 cleanup” path
   - File: apps/tournament-api/src/routes/gallery.integration.test.ts:365-559
   - Confidence: high
   - Why it matters: The route explicitly implements R2-first then DB with cleanup-on-DB-failure (apps/tournament-api/src/routes/gallery.ts:182–234), but the integration suite doesn’t currently force the DB transaction to fail after a successful mocked R2 upload, so it never asserts that `deleteFromR2(r2Key)` is called and that no row/audit/activity remains. This is a key acceptance-risk area because regressions here silently leak R2 orphans.
   - Suggested fix: Add an integration test that makes the tx fail after R2 upload. Practical approach: mock `randomUUID()` (node:crypto) to return deterministic values so `r2Key` collides with an existing `gallery_photos.r2_key` UNIQUE constraint, causing the insert to throw. Assert: response 500 internal, `galleryPhotos` has 0 new rows, and `r2State.deleteCalls` contains the uploaded key (cleanup attempted).

3. [medium] DELETE deletes from R2 before deleting from DB; if DB delete fails, UI will show a photo whose signed URL 404s
   - File: apps/tournament-api/src/routes/gallery.ts:382-405
   - Confidence: medium
   - Why it matters: The DELETE handler performs best-effort R2 delete first (lines 384–393) and then does the DB delete inside a transaction (395–404). If the DB transaction fails (db locked, transient libsql errors, etc.) after R2 deletion succeeded, you’re left with a DB row that will continue to appear in GET results, but the underlying object is gone (broken gallery entry). The current comment argues for avoiding “ghost-render via stale signed URL,” but the current ordering only guarantees that when the DB delete succeeds; it makes the opposite failure mode worse.
   - Suggested fix: Prefer DB-first: delete the `gallery_photos` row (and audit) in a transaction, then perform best-effort R2 delete after commit. If you want stronger guarantees, record a tombstone state in DB and have a background janitor delete from R2, but simplest is “DB → R2 best-effort”.

4. [medium] GET grouping/order integration test does not actually validate multi-round grouping or round_date DESC ordering
   - File: apps/tournament-api/src/routes/gallery.integration.test.ts:561-613
   - Confidence: high
   - Why it matters: The test name says it validates grouping by round and ordering (`round_date DESC; unassociated LAST`), but it deletes both rounds before the final GET (lines 581–584), which forces all photos into the unassociated bucket (as the test comment notes). That means it cannot catch regressions in the ordering logic at apps/tournament-api/src/routes/gallery.ts:320–327 when multiple round groups exist.
   - Suggested fix: Change the test to keep both rounds in place, upload one photo per round plus one unassociated, then assert group order is [round2, round1, null] and that each group contains the expected photo ids. Keep a separate test for FK SET NULL if needed (you already have one at lines 755+).

5. [medium] Unsafe aws-sdk client cast in presigner may hide real incompatibilities; could break at runtime when package minors diverge
   - File: apps/tournament-api/src/lib/r2-client.ts:71-87
   - Confidence: medium
   - Why it matters: `getSignedUrl(s3 as unknown as Parameters<typeof getSignedUrl>[0], ...)` (line 81) suppresses type mismatches between `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`. This can turn a legitimate API incompatibility into a runtime failure (especially given the comment notes prior divergence). Since POST/GET rely on presigning, a runtime break here takes out all reads (and the upload response if you continue to presign there).
   - Suggested fix: Pin `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` to the exact same version (or use workspace overrides) to keep types/runtime aligned. Consider using the presigner’s recommended client typing (e.g., ensure both packages share the same Smithy client version) instead of casting through unknown.

6. [low] `isSafeEventId` guard is applied only inside POST handler and runs after requireEventParticipant middleware
   - File: apps/tournament-api/src/routes/gallery.ts:75-118
   - Confidence: high
   - Why it matters: The story calls out bucket-key traversal defense via `isSafeEventId`, but in POST the guard runs after `requireEventParticipant` (middleware order lines 89–106), and GET/DELETE don’t use it at all. Today that’s mostly okay because only POST mints an R2 key using `eventId`, but the guard is less “defense-in-depth” than intended and won’t protect middleware code paths that use `eventId` if a future change adds R2 key usage elsewhere.
   - Suggested fix: Add a small param-validation middleware that runs before `requireEventParticipant` for all three routes (e.g., `galleryRouter.use('/:eventId/*', ...)`), returning 400 on unsafe ids. Keep POST’s guard or rely on the shared middleware.

7. [low] Given the 2026-04-26 lesson, reliance on manual real-R2 smoke for presigning is a calculated risk; consider an env-gated real-R2 test
   - File: apps/tournament-api/src/lib/r2-client.test.ts:1-150
   - Confidence: medium
   - Why it matters: All current tests mock aws-sdk and do not validate real presigner output against Cloudflare R2. Wolf Cup’s daily smokes don’t cover the presigner path, and the code contains a known-risk cast. Manual smoke in the DoD may be sufficient operationally, but it’s a gap versus the “external integration” lesson if a dependency bump breaks presigning silently.
   - Suggested fix: Option A: keep manual smoke but add explicit version pinning/overrides. Option B: add an integration test that runs only when `R2_*` envs are present (skipped in CI by default) to perform a small PUT + presign + GET (and cleanup), validating the runtime contract end-to-end.

## Strengths

- Upload sequence largely matches the spec: R2 PUT happens before DB transaction; DB failure triggers best-effort R2 cleanup (apps/tournament-api/src/routes/gallery.ts:182–234).
- Per-photo size cap (10MB) plus request bodyLimit (12MB) is correctly enforced, and there are integration tests for both (gallery.integration.test.ts:509–531).
- Content-type allowlist is enforced server-side and covered by tests (gallery.ts:48–55; gallery.integration.test.ts:493–507).
- Schema FK delete posture is correctly implemented in both migration and Drizzle schema (0008_gallery_photos.sql:11–13; schema/gallery.ts:52–61) and is exercised by tests (schema/gallery.test.ts:171–238; gallery.integration.test.ts:755–781).
- GET route sets Cache-Control: no-store (gallery.ts:257–262) and tests assert it (gallery.integration.test.ts:593–594).
- Cross-event isolation on DELETE is enforced by filtering on both photoId and eventId and is tested (gallery.ts:373–380; gallery.integration.test.ts:677–728).
- Allowlist constraint appears satisfied by the provided diff: changes are confined to apps/tournament-api (plus the noted shared files not included here), and no Wolf Cup paths are shown modified in this diff.

## Warnings

None.
