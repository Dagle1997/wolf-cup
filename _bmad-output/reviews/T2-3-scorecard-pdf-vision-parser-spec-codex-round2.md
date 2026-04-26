# Codex Review

- Generated: 2026-04-24T15:25:39.477Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T2-3-scorecard-pdf-vision-parser.md

## Summary

Round-2 review of `_bmad-output/implementation-artifacts/tournament/T2-3-scorecard-pdf-vision-parser.md`.

Your mechanical fixes (dep contradiction resolution via hand-maintained TOOL_INPUT_SCHEMA, raising route-test floor to ≥10, pinning `system`/`cache_control` shape to SDK contract check, and MIME main-type parsing/empty-type handling) mostly land cleanly.

However, two new/remaining spec-level contradictions stand out (tool schema “derived” vs “hand-maintained”, and test-count arithmetic). The previously-flagged size-cap issue remains a High risk/contradiction: Hono `parseBody()` cannot enforce a hard 10 MiB cap “before buffering” in the way the spec currently promises.

Wolf Cup isolation/path allowlist still looks clean per the explicit file list and constraints.

Overall risk: high

## Findings

1. [high] 10 MiB cap is specified as enforced “BEFORE buffering”, but the handler uses `c.req.parseBody()` which necessarily buffers/consumes the request body first
   - File: _bmad-output/implementation-artifacts/tournament/T2-3-scorecard-pdf-vision-parser.md:56-193
   - Confidence: high
   - Why it matters: The spec promises a DoS-relevant property (reject >10 MiB before fully buffering into memory) that is not achievable with the described implementation path:
- Risk Acceptance §5 states the cap is enforced “BEFORE buffering the full body into memory” (line 58).
- AC #7 step 1 parses multipart via `c.req.parseBody({ all: false })` (line 187), and only after that checks `pdf.size` (line 189) and later calls `pdf.arrayBuffer()`.
In typical Hono/Fetch implementations, multipart parsing requires reading the full request body into memory (or at least consuming it) before a `File` object with `size` exists. So the spec is internally contradictory and may provide a false sense of protection; an oversized upload could still impose memory/CPU cost even if later rejected.
   - Suggested fix: Josh decision point (Option A vs B) should be reflected explicitly in the AC text:
- Option A (stronger): add an early body-size gate that triggers while reading the request (Hono `bodyLimit` middleware, platform/nginx limit like `client_max_body_size`, or a route-specific streaming parser that enforces a cap). If you want to preserve the current 400/`file_too_large` shape, specify catching the middleware’s error and mapping it to 400 (rather than introducing an externally visible 413).
- Option B (simpler): relax the claim and state the 10 MiB cap is enforced *after multipart parsing* but before sending bytes to Anthropic, and document the residual risk (bounded by organizer auth + infra limits). Also consider adding a best-effort `Content-Length` precheck (when present) to fail fast, while still handling chunked uploads.
Whichever is chosen, align §5 (line 58) and AC #7 steps (lines 187–193) to the same truth.

2. [medium] Tool input schema is still described as “derived from ParsedCourseSchema” in AC #5, contradicting the new “hand-maintain TOOL_INPUT_SCHEMA; no dependency” approach
   - File: _bmad-output/implementation-artifacts/tournament/T2-3-scorecard-pdf-vision-parser.md:54-303
   - Confidence: high
   - Why it matters: You fixed the dependency contradiction by switching to a hand-maintained `TOOL_INPUT_SCHEMA` (Task 6.3, lines 302–303). But AC #5 still specifies `input_schema: <JSON schema derived from ParsedCourseSchema>` (line 160). That’s a direct contradiction that can cause spec drift during implementation (dev may reintroduce a transform dependency or implement an unnecessary generator).
   - Suggested fix: Make AC #5 match the chosen approach, e.g.:
- Replace “derived from ParsedCourseSchema” with “provided by TOOL_INPUT_SCHEMA (hand-maintained JSON Schema kept in sync with ParsedCourseSchema; see Task 6.3 test)”.
Optionally also tighten Risk Acceptance §4 (lines 54–55) to remove “transform” language if it’s no longer an allowed path.

3. [medium] Test-count math in AC #14 is now inconsistent with the updated per-file minimums
   - File: _bmad-output/implementation-artifacts/tournament/T2-3-scorecard-pdf-vision-parser.md:220-261
   - Confidence: high
   - Why it matters: AC #11 requires ≥10 tests in `course-parser.test.ts` (line 222) and AC #12 requires ≥10 tests in `admin-courses.test.ts` (line 239). That implies ≥20 new tests.
But AC #14 still states “≥18 new from AC #11 + #12” (line 260), which appears to be leftover from the prior “≥8” wording and is now contradictory. This can weaken the gating/verification step (it would allow fewer tests than the earlier ACs require, or create confusion over what to enforce).
   - Suggested fix: Update AC #14 to match the new minimums, e.g. “current-count + ≥20 new from AC #11 + #12” (or rephrase to avoid arithmetic: “increases by at least the number of tests added in AC #11 and AC #12, and those AC minimums are met”).

## Strengths

- FIX 4 (MIME main-type extraction + empty-type skip) is now precise and implementable, and it cleanly preserves magic-byte authority (lines 60–66, 189–193).
- FIX 3 (SDK-pinned `system` shape and cache_control conditional drop) avoids a hard spec lock to one SDK typing and explicitly preserves functionality without caching (lines 162–163).
- The TOOL_INPUT_SCHEMA approach explicitly eliminates the earlier dependency contradiction and keeps “@anthropic-ai/sdk is the only new dep” consistent with AC #1/Task 6.3 intent (lines 96–99, 302–303).
- Wolf Cup isolation is clearly stated with an explicit allowlist/denylist and a concrete post-shape tree (lines 262–276, 369–396).

## Warnings

None.
