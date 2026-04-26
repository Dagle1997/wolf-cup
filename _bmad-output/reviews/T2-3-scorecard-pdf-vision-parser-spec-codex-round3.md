# Codex Review

- Generated: 2026-04-24T16:05:09.983Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T2-3-scorecard-pdf-vision-parser.md

## Summary

Spec updates 5–7 largely resolve Round 2’s issues: Option A (Hono `bodyLimit` before multipart parsing) is consistently threaded through Risk Acceptance §5, AC #6/#7, Task 8.1, and AC #12’s new test split. Tool-schema wording now correctly references a hand-maintained `TOOL_INPUT_SCHEMA`. AC #14’s math is corrected to ≥20 new tests net.

Two medium-risk concerns remain: (1) `bodyLimit` caps total multipart request bytes, not the PDF file bytes, so an exactly-10MiB file may be rejected due to multipart overhead—this slightly contradicts the “10 MiB file cap” phrasing and may cause edge-case surprises. (2) The “Content-Length fast-fail” test as written may be hard/fragile to implement depending on the test harness (Node fetch/undici/Hono `app.request` may ignore/override manually supplied `Content-Length`).

Overall risk: medium

## Findings

1. [medium] `bodyLimit(maxSize: 10 MiB)` limits total multipart body bytes, not `pdf.size` — could reject a 10 MiB file due to multipart overhead
   - File: _bmad-output/implementation-artifacts/tournament/T2-3-scorecard-pdf-vision-parser.md:56-59
   - Confidence: high
   - Why it matters: Risk Acceptance §5 and AC #6/#7 read like the cap is on the uploaded PDF file size (“Upload size cap: 10 MiB” and later `pdf.size <= 10_485_760`). But `bodyLimit` necessarily enforces a ceiling on the entire HTTP request body (multipart boundaries + headers + other fields), meaning the maximum allowable `pdf.size` is slightly *less* than 10 MiB. This can cause confusing rejections for a legitimate ~10 MiB PDF and makes the spec’s stated cap subtly inaccurate.
   - Suggested fix: Either (a) redefine the cap explicitly as a **request-body** cap (not file-size cap), or (b) set `bodyLimit` to `10 MiB + multipart overhead buffer` (e.g., 10 MiB + 64 KiB) while keeping the strict `pdf.size <= 10 MiB` check in-handler, or (c) keep 10 MiB `bodyLimit` but adjust wording to clarify effective file limit is slightly under 10 MiB due to multipart overhead.

2. [medium] AC #12 “Content-Length fast-fail” test may be unimplementable/flaky if the test client disallows or overrides manual `Content-Length`
   - File: _bmad-output/implementation-artifacts/tournament/T2-3-scorecard-pdf-vision-parser.md:249-250
   - Confidence: medium
   - Why it matters: AC #12 requires a test that manually sets `Content-Length: 10485761` and asserts the middleware’s header-path fires before multipart parse. Depending on how tests are executed (common patterns: Hono `app.request()` with Node’s `fetch`/undici), `Content-Length` can be treated as a managed/forbidden header and may be ignored, recalculated, or stripped. If so, this specific test requirement could block implementation or be flaky across Node/Hono versions.
   - Suggested fix: Allow the test to be implemented via a lower-level HTTP client where `Content-Length` is controllable (e.g., start a real node server + use `http.request`/supertest), **or** relax the assertion to “when the request’s `Content-Length` exceeds maxSize, the route returns 400 `file_too_large` without invoking the handler/parser,” without mandating manual header injection via fetch-style APIs.

## Strengths

- Option A is now internally consistent across Risk Acceptance §5, AC #6/#7, Task 8.1, and AC #12’s updated test plan (lines 56–59, 176–185, 186–197, 314–318, 239–255).
- Route-chain ordering rationale is explicitly documented and consistent (auth middlewares before `bodyLimit`, then handler) (lines 182–184).
- AC #12 now clearly enumerates ≥10 route tests and splits the oversize case into two distinct coverage targets (header fast-fail vs streaming enforcement) (lines 239–255).
- AC #5 tool schema wording correctly references hand-maintained `TOOL_INPUT_SCHEMA` and avoids implying a runtime Zod→JSON-Schema transform (lines 54–55, 160–163, 305–306).
- AC #14’s total new-test-count math is now correct and consistent with AC #11 + AC #12 requirements (lines 261–264).

## Warnings

None.
