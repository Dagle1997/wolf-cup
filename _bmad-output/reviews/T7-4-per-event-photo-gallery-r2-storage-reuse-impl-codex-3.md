# Codex Review

- Generated: 2026-05-05T13:24:47.521Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/gallery.ts, apps/tournament-api/src/routes/gallery.integration.test.ts

## Summary

Confirmed both stated fixes based on the provided code:

- Upload tx-failure cleanup test: the added `expect(auditSpy).toHaveBeenCalledTimes(1)` is indeed load-bearing and would fail if the spy didn’t fire, preventing a false-positive pass.
- DELETE handler: the `db.transaction(...)` is now wrapped in `try/catch`; on tx failure it logs `gallery_delete_failed` and returns a structured `{ error: 'internal', requestId }` 500, and the R2 delete is only attempted after the tx succeeds.

No obvious regressions introduced, but there are a couple of concrete reliability/coverage gaps worth addressing.

Overall risk: low

## Findings

1. [medium] DELETE transaction doesn’t verify it actually deleted a row; can emit a deletion audit for a non-deleted photo under races
   - File: apps/tournament-api/src/routes/gallery.ts:413-423
   - Confidence: medium
   - Why it matters: The handler does an existence check (lines 393-403) and then later deletes by `photoId` only (line 415). If the row disappears between the SELECT and the transaction (concurrent delete/job cleanup), `DELETE` can affect 0 rows but the code will still write a `GALLERY_DELETED` audit entry and return 204. That produces an incorrect audit trail (claims a deletion happened when it may not have) and can make debugging/data reconciliation harder.
   - Suggested fix: Inside the transaction, perform the delete with an event guard and verify affected-row count, e.g. `delete ... where id = ? and event_id = ?` and if `rowsAffected === 0` then throw/rollback and return 404 (or treat as idempotent delete but then also suppress audit).

2. [medium] No test covering the new DELETE tx-failure path (structured 500 and no R2 delete attempted)
   - File: apps/tournament-api/src/routes/gallery.integration.test.ts:676-796
   - Confidence: high
   - Why it matters: Round-2 fix #2 is implemented, but not exercised by an integration test. Without a test, it’s easier for a future refactor to accidentally move the R2 delete ahead of the tx again, or regress back to an unstructured 500 response.
   - Suggested fix: Add a test that forces the DELETE transaction to throw (e.g. `vi.spyOn(auditModule, 'writeAudit').mockImplementationOnce(() => { throw ... })` for the delete path), then assert: (1) status 500 and body contains `{ error: 'internal', requestId }`, (2) `r2State.deleteCalls.length === 0`, and (3) the DB row still exists.

3. [low] Spy cleanup in upload tx-failure test is not in a finally/afterEach; a failed assertion can leak the spy into later tests
   - File: apps/tournament-api/src/routes/gallery.integration.test.ts:545-579
   - Confidence: high
   - Why it matters: `auditSpy.mockRestore()` is only reached if the test completes normally (line 578). If an earlier assertion throws, the spy remains installed and can affect subsequent tests in this file (especially if additional tests are added later that rely on the real `writeAudit`).
   - Suggested fix: Wrap the test body in `try/finally { auditSpy.mockRestore(); }`, or add a file-level `afterEach(() => vi.restoreAllMocks())` (ensuring it doesn’t break other intentional mocks).

## Strengths

- Upload failure-path test improvement is effective: `toHaveBeenCalledTimes(1)` will fail loudly if the spy didn’t intercept the route’s `writeAudit` call, preventing a false-positive on the cleanup assertions. (apps/tournament-api/src/routes/gallery.integration.test.ts:555-568)
- DELETE handler now cleanly gates the R2 delete behind a successful DB transaction, and returns a structured 500 with `requestId` on tx failure. (apps/tournament-api/src/routes/gallery.ts:413-437)
- DELETE route still preserves cross-event isolation by selecting the photo using both `photoId` and `eventId` before mutating. (apps/tournament-api/src/routes/gallery.ts:393-403)

## Warnings

None.
