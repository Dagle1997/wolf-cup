# Codex Review

- Generated: 2026-04-28T12:08:50.602Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/lib/pdf-gen.ts, apps/tournament-api/src/lib/pdf-gen.test.ts, apps/tournament-api/src/routes/pdf-schedule.ts, apps/tournament-api/src/routes/pdf-schedule.test.ts, apps/tournament-api/src/app.ts, apps/tournament-api/PORTS.md, _bmad-output/implementation-artifacts/tournament/T4-3-pdf-schedule-pairings-export.md

## Summary

Meets the main story shape (pure pdfkit renderer w/ frozen CreationDate, token-gated GET route, router mount, and test coverage). Two concrete spec/security gaps stand out: missing tenant scoping on course lookups, and 422 response shape drift (error field). Minor drift: happy-path body is a Blob, not a Buffer as AC #2 states; and one renderer test is effectively a no-op.

Overall risk: medium

## Findings

1. [medium] Missing tenant scoping on courseRevisions/courses SELECTs (cross-tenant data exposure risk)
   - File: apps/tournament-api/src/routes/pdf-schedule.ts:116-131
   - Confidence: high
   - Why it matters: AC #2 requires tenant scoping on every query. The event/course revision IDs are UUIDs, but if an attacker ever learns/guesses a valid revision/course ID from another tenant (logs, side channels, or future endpoints), this route could resolve and disclose foreign course names. This also breaks the stated hardening pattern.
   - Suggested fix: Add tenant predicates to both lookups, e.g. `where(and(inArray(courseRevisions.id, revisionIds), eq(courseRevisions.tenantId, TENANT_ID)))` and similarly for `courses` (`eq(courses.tenantId, TENANT_ID)`). Consider also scoping by `contextId` if that’s part of your tenancy model.

2. [medium] 422 response shape drift: `error` should be `pairings_missing` per contract, not `unprocessable`
   - File: apps/tournament-api/src/routes/pdf-schedule.ts:159-167
   - Confidence: high
   - Why it matters: Acceptance criteria contract explicitly calls for `422 { error: 'pairings_missing', code: 'event_pairings_not_saved', requestId }`. Current implementation returns `{ error: 'unprocessable', ... }`, which can break clients/tests relying on the documented error string.
   - Suggested fix: Change the 422 payload to `{ error: 'pairings_missing', code: 'event_pairings_not_saved', requestId }` to match AC #2 (and update/extend tests to assert the `error` field too).

3. [low] Happy-path response body is a Blob, not a Buffer (AC calls for Buffer body)
   - File: apps/tournament-api/src/routes/pdf-schedule.ts:315-330
   - Confidence: high
   - Why it matters: AC #2 specifies a Buffer body. Returning a Blob likely works in Node/undici, but it’s a spec drift and adds complexity (ArrayBuffer copy + Blob) that could be avoided. Also, using `new Response(...)` bypasses Hono helpers that may standardize responses.
   - Suggested fix: Prefer `return new Response(pdfBuffer, { headers: ... })` (Buffer is a Uint8Array and is valid BodyInit) or `return c.body(pdfBuffer, 200, headers)` if available in your Hono version. If you keep the copy, you can still return a `Uint8Array` rather than a Blob.

4. [low] `pdf-gen` “handicap formatting” test does not assert formatting (effectively no-op)
   - File: apps/tournament-api/src/lib/pdf-gen.test.ts:90-98
   - Confidence: high
   - Why it matters: The test claims to validate formatting but only checks `buf.length > 0`, so a regression in `formatHandicap` would not be caught. Given this is a greenfield renderer, tests are the main contract.
   - Suggested fix: Either (a) export `formatHandicap` (or a small helper) for unit testing, or (b) configure pdfkit to avoid stream compression and then assert expected substrings (e.g., '(—)', '(+2.1)', '(12.5)') appear in the PDF bytes.

## Strengths

- `renderEventPdf` is pure w.r.t. DB/I/O and freezes `CreationDate` (apps/tournament-api/src/lib/pdf-gen.ts:86-96), and you have a determinism test (pdf-gen.test.ts:84-88).
- Defense-in-depth eventId/token binding is implemented (pdf-schedule.ts:71-77) and covered by tests (pdf-schedule.test.ts:261-272).
- 404 no-route-without-token behavior is enforced by route shape and tested (pdf-schedule.test.ts:218-224).
- Slugification strips non-alphanumerics and avoids obvious header injection vectors (pdf-schedule.ts:47-53).
- Pairings-missing condition matches the intended semantics (“no pairings rows under any event_round”) (pdf-schedule.ts:139-168).

## Warnings

None.
