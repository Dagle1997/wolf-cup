# Codex Review

- Generated: 2026-05-04T21:11:40.652Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T7-1-event-home-page-countdown-schedule-entry.md

## Summary

Spec is largely coherent for a minimal v1 and the trim rationale (avoid linking to non-existent routes) is sound. However, there are a few concrete inconsistencies and underspecified areas that risk implementation divergence: response shape mismatch (eventRoundId), ambiguous countdown/timezone semantics for “roundDate” vs event timezone, and unclear frontend auth/error handling (401 redirect vs 403 inline card) without defining how the page fetch distinguishes them. A couple acceptance criteria should be tightened to preserve the “no existence leak” guarantee without accidentally converting malformed IDs into 500s.

Overall risk: medium

## Findings

1. [high] API response shape mismatch: story mentions `eventRoundId` but AC schema omits it
   - File: _bmad-output/implementation-artifacts/tournament/T7-1-event-home-page-countdown-schedule-entry.md:25-64
   - Confidence: high
   - Why it matters: Line 25 says the endpoint returns `rounds: Array<{ id, eventRoundId, roundNumber, roundDate, holesToPlay }>` but AC-1’s TypeScript schema (lines 58–64) does not include `eventRoundId`. This is a concrete inconsistency that will cause either tests to fail or downstream consumers to build against the wrong contract.
   - Suggested fix: Pick one contract and make it consistent everywhere. If clients only need `event_rounds.id`, delete `eventRoundId` mention at line 25. If they need both, add `eventRoundId` to AC-1 schema and tests.

2. [high] Countdown logic is underspecified around timezones and the meaning of `roundDate` (instant vs local-day)
   - File: _bmad-output/implementation-artifacts/tournament/T7-1-event-home-page-countdown-schedule-entry.md:16-83
   - Confidence: high
   - Why it matters: AC-3 requires countdown comparisons like `now < firstRoundDate` and “between rounds,” but does not define whether `roundDate` is a start timestamp (instant) or a date-only value representing a day in the event timezone. If `roundDate` is stored as midnight UTC (or midnight event-local encoded as epoch), naive comparisons can be off by hours/day depending on timezone and DST. This is exactly the class of bug the spec is trying to avoid (event timezone vs viewer timezone).
   - Suggested fix: Explicitly define `roundDate` semantics: e.g., “roundDate is the scheduled tee time instant in ms since epoch (UTC),” or “roundDate is event-local midnight for the round day.” Then define how to compute “Round N starts in …” (what instant is ‘start’). Add an AC/test fixture that uses a non-local timezone and a DST-adjacent date, and ensure `now` is controlled in tests (fake timers / injected clock).

3. [medium] No-existence-leak requirement + malformed IDs needs explicit validation behavior to avoid 500s
   - File: _bmad-output/implementation-artifacts/tournament/T7-1-event-home-page-countdown-schedule-entry.md:69-72
   - Confidence: medium
   - Why it matters: AC-2 states “malformed or unknown eventId returns 403, not 404.” That’s a strong requirement, but without explicit input validation guidance it’s easy for the API route to throw (e.g., DB query expecting UUID) and return 500, which both breaks the AC and may leak existence via error patterns. Also, returning 403 for malformed IDs is nonstandard and can hide real client bugs unless it’s deliberate and consistently implemented.
   - Suggested fix: Add a concrete AC note like: “If `eventId` is not a valid UUID, treat it as non-participant (403) without querying.” Also require the integration test to cover a malformed `eventId` (e.g., `not-a-uuid`) expecting 403 (and no 500).

4. [medium] Frontend auth/error handling is ambiguous: how does the page distinguish 401 vs 403 and where does redirect occur?
   - File: _bmad-output/implementation-artifacts/tournament/T7-1-event-home-page-countdown-schedule-entry.md:84-87
   - Confidence: medium
   - Why it matters: AC-4 says anonymous viewer triggers `window.location.assign('/api/auth/google')` redirect, and 403 renders an inline forbidden card. But the spec doesn’t state whether the page fetch is performed in a TanStack Router loader (possibly during SSR) or purely client-side. If a loader runs on the server, `window` isn’t available; if it runs on the client, you need a consistent mapping: 401 => redirect, 403 => inline. Without clarification, implementations may incorrectly redirect on any non-200, or render a forbidden card for anonymous users.
   - Suggested fix: Specify the fetch layer and behavior: e.g., “Loader calls GET /api/events/:eventId; on 401, throw a redirect to /api/auth/google (or return a component that triggers client redirect); on 403, render forbidden card.” Add a web test explicitly asserting 401 -> redirect behavior (or, if not testable in jsdom, at least unit-test the decision function).

5. [low] Countdown copy and rounding rules not specified; tests may be flaky without deterministic ‘now’ control
   - File: _bmad-output/implementation-artifacts/tournament/T7-1-event-home-page-countdown-schedule-entry.md:80-99
   - Confidence: medium
   - Why it matters: AC-3 and AC-5 assert string prefixes (“Round 1 starts in”, “Event complete”), but do not define rounding (floor/ceil), pluralization, or what happens when `now` is exactly equal to a round boundary. If tests assert more than the prefix, they’ll be brittle; if they assert only the prefix, correctness around boundaries may regress unnoticed.
   - Suggested fix: Define minimal, testable rules: e.g., “Compute remaining duration in whole hours (floor) and whole days (floor), omit minutes; at `now >= lastRoundDateEnd` show ‘Event complete’; at exact boundary treat as ‘between rounds’ or ‘live’ (but v1 has no ‘live’ state).” Ensure tests pin `now` via fake timers and only assert stable parts of the string unless you want strict formatting tests.

## Strengths

- Trim decision is justified and explicitly avoids linking to routes that aren’t shipped yet (prevents dead-end navigation).
- Clear path allowlist compliance: all intended changes are under `apps/tournament-api/**` and `apps/tournament-web/**` with no Wolf Cup / forbidden paths mentioned.
- Good callout on TanStack Router file-route naming (`events.$eventId.index.tsx`) to avoid conflicts with existing `events.$eventId.*` siblings (line 39).
- Explicitly calls out timezone requirement to use `event.timezone` (lines 79–80, 120), which is a common source of bugs, and suggests pinning it in tests.

## Warnings

None.
