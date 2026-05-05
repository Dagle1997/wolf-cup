# Codex Review

- Generated: 2026-05-05T13:21:23.291Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/gallery.ts, apps/tournament-api/src/routes/gallery.integration.test.ts

## Summary

The POST reorder (R2 PUT → presign → DB tx) and DELETE reorder (DB tx → best-effort R2 delete) are directionally correct and remove the previously identified duplicate-retry and broken-row hazards. The new cleanup-on-tx-fail test is plausible, but as written it may not actually force the route’s transaction to fail because it spies on the audit module after the route module has already imported `writeAudit`.

Overall risk: medium

## Findings

1. [high] Integration test may not actually exercise the “tx fails after R2 PUT succeeds” path (spy applied after route import; may not affect already-imported binding)
   - File: apps/tournament-api/src/routes/gallery.integration.test.ts:545-574
   - Confidence: medium
   - Why it matters: This test is meant to validate a critical cleanup property: if the DB transaction fails after an R2 upload, the handler returns 500, no DB row persists, and an R2 delete is attempted. However, `galleryRouter` is imported earlier (line 93), and `gallery.ts` imports `writeAudit` as a named import. Depending on how Vitest/ESM handles `vi.spyOn()` on module namespace objects, the spy may not replace the function actually invoked inside the already-loaded route module. If the spy doesn’t take effect, the transaction may succeed and the test would fail; or worse, the spy might not throw but the test could still pass if some other failure occurs. Also, the test never asserts that `writeAudit` was actually called, so it doesn’t prove the failure happened “mid-tx after insert” as intended.
   - Suggested fix: Make the failure injection unambiguous:
- Prefer `vi.mock('../lib/audit-log.js', ...)` at the top of the file (before importing `galleryRouter`) and expose a test-controlled toggle/spy function.
- Or import `galleryRouter` only after installing the spy/mock.
- Add `expect(auditSpy).toHaveBeenCalled()` (and ideally assert that the R2 PUT happened before the failure, e.g., `expect(r2State.uploadCalls.length).toBe(1)` prior to asserting cleanup).

2. [medium] DELETE DB transaction failure returns an unstructured 500 and skips R2 delete, with no explicit error handling
   - File: apps/tournament-api/src/routes/gallery.ts:408-433
   - Confidence: high
   - Why it matters: The DELETE path now correctly performs the DB mutation first, which avoids broken rows if R2 deletion fails. However, the DB transaction is not wrapped in a try/catch. If `tx.delete(...)` or `writeAudit(...)` throws, the handler will bubble an exception (likely a generic 500 without a JSON body), and no best-effort R2 delete will run. While the DB rollback preserves UI correctness, callers get inconsistent error shape vs other endpoints, and operational visibility may suffer (missing structured log/event for DB-delete failure).
   - Suggested fix: Wrap the `db.transaction(...)` in try/catch similar to POST: log a structured `gallery_db_delete_failed` event and return `c.json({ error: 'internal', requestId }, 500)` (or a more specific code) for consistency.

## Strengths

- POST sequence now avoids the prior “commit succeeded but response 500” duplicate-retry hazard by presigning before the transaction and cleaning up the R2 object on presign failure (gallery.ts:183-210).
- POST handles the tx-fail-after-upload case with best-effort R2 cleanup and does not leak a DB row when the transaction fails (gallery.ts:215-259).
- DELETE reorder (DB tx first, then best-effort R2 delete) avoids broken gallery rows when object deletion fails (gallery.ts:408-430).
- Grouping/ordering test now asserts multi-round ordering (round_date DESC) and unassociated last in a way that keeps both rounds intact (gallery.integration.test.ts:593-651).

## Warnings

None.
