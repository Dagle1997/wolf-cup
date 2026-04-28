# Codex Review

- Generated: 2026-04-28T11:41:50.582Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T4-3-pdf-schedule-pairings-export.md, apps/tournament-api/src/middleware/require-invite-token.ts

## Summary

Spec is largely coherent and evidence-backed for a greenfield PDF endpoint gated by `requireInviteToken`, but there are a few concrete spec-level contract mismatches that will cause implementation/test failures unless corrected (HTTP method vs download UX; anonymous/no-token behavior; inconsistent 403 discussion).

Overall risk: medium

## Findings

1. [high] HTTP method mismatch: spec says POST, but intended browser-download flow implies GET
   - File: _bmad-output/implementation-artifacts/tournament/T4-3-pdf-schedule-pairings-export.md:13-96
   - Confidence: high
   - Why it matters: The story repeatedly specifies `POST /api/events/:eventId/pdf/schedule...` (lines 13, 51, 135) but also says the frontend will be a simple `<a href=...>` navigation and manual test is “Visit ... directly in the browser” (lines 90-91, 195-196). Plain navigation/download uses GET; POST would require JS `fetch` + blob handling (explicitly out of scope). This is a functional contract break likely to fail manual AC #10 and drive awkward workarounds.
   - Suggested fix: Change the route to `GET /api/events/:eventId/pdf/schedule/:token` (or support both GET and POST), and update AC/test bullets accordingly. If you must keep POST, then you need a frontend implementation (contradicts scope) or a form POST workflow.

2. [high] Anonymous / missing-token expectations are inconsistent with `requireInviteToken` behavior and routing
   - File: _bmad-output/implementation-artifacts/tournament/T4-3-pdf-schedule-pairings-export.md:147-169
   - Confidence: high
   - Why it matters: AC expects “401 anonymous (no token in path)” (line 163) while the middleware explicitly returns 500 when mounted on a route without a `:token` param (apps/tournament-api/src/middleware/require-invite-token.ts lines 15-18, 51-60). Also, if the route path includes `:token`, a request that omits that segment usually won’t match the route at all → 404, not 401/500. This will make the proposed tests flaky/incorrect and can mask real auth behavior.
   - Suggested fix: Decide desired behavior and encode it via routing:
- If you want a 401 for missing token, define an explicit sibling route (same path without `:token`) that returns 401.
- Otherwise, update tests/AC to expect 404 when the token segment is absent.
Also keep `requireInviteToken` only on routes that actually have `:token` in the pattern (as its doc requires).

3. [medium] Spec contradicts itself on whether 403 exists (non-participant vs event/token mismatch)
   - File: _bmad-output/implementation-artifacts/tournament/T4-3-pdf-schedule-pairings-export.md:84-140
   - Confidence: high
   - Why it matters: Risk §7 asserts “The 403 path is removed; the 401 path covers all unauthorized callers” (lines 84-87), but AC #2 then requires a 403 `event_token_mismatch` when `:eventId` doesn’t match `c.get('invite').eventId` (lines 138-140) and AC #4 includes a 403 test for that case (line 167). Those are compatible if you mean “no 403 for non-participant auth,” but as written it’s internally inconsistent.
   - Suggested fix: Clarify wording: keep 401 for auth failures (invalid/expired/not found), and keep 403 only for “authenticated-by-token but requesting a different eventId than the token binds to”. Update Risk §7 text accordingly.

4. [medium] Route shape is inconsistently stated (missing :token in early story description)
   - File: _bmad-output/implementation-artifacts/tournament/T4-3-pdf-schedule-pairings-export.md:13-57
   - Confidence: high
   - Why it matters: Line 13 states `POST /api/events/:eventId/pdf/schedule` (no token), but later the chosen route is `.../schedule/:token` (lines 51-57, 135). Given the middleware requires `c.req.param('token')` (require-invite-token.ts line 49), the tokenless path is not implementable with this middleware.
   - Suggested fix: Normalize all mentions to the final chosen route (including the initial story summary) to prevent implementer/test drift.

## Strengths

- Greenfield-vs-port decision is explicitly disclosed with an audit trail plan (Risk §2, lines 37-46) rather than fabricating provenance; that’s sound given the provided claim that no runtime Wolf Cup PDF endpoint exists.
- Two-gate model is clearly described and scoped to the only SHARED files (`package.json` + root lockfile) (lines 19-35, 102-105, 200-207).
- Route token position choice (suffix) is compatible with the provided middleware, which reads the param by name (`c.req.param('token')`) not by position (require-invite-token.ts line 49; spec lines 53-58).
- pdfkit rationale is defensible for a trip-critical, container-friendly server-side print fallback (lines 23-28), and freezing CreationDate for determinism is a reasonable testing strategy (line 29).
- Path footprint is explicit; nothing in the spec implies touching forbidden areas beyond the declared SHARED lockfile + dependency change (lines 92-106, 250-251).
- Test-count targets are concrete and tied to specific scenarios; the 422 pairings_missing rule is clearly defined (lines 80-83, 161-169).

## Warnings

None.
