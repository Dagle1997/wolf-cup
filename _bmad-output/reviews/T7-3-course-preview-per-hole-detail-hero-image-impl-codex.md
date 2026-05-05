# Codex Review

- Generated: 2026-05-05T01:06:07.291Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/course-preview.ts, apps/tournament-api/src/routes/course-preview.integration.test.ts, apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx, apps/tournament-web/src/routes/events.$eventId.courses.$courseId.test.tsx

## Summary

API pinning + uniform-403 behavior largely matches the spec and is covered by integration tests. Main issue is on the web page: Out/In par totals are currently computed from holes (and will override the revision’s printed totals), which contradicts the spec and the component’s own comment. There’s also a plausible null-safety hole in defaultTeeColor matching that could turn some malformed DB states into a 500 (breaking the “uniform 403” posture).

Overall risk: medium

## Findings

1. [high] Out/In par totals are computed from holes, not taken directly from revision totals (spec violation + potential wrong UI)
   - File: apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx:233-248
   - Confidence: high
   - Why it matters: Per spec, Out/In/Total par should come from `revision.outTotal/inTotal/courseTotal` directly (printed totals are the source of truth). Current code displays `outParTotal(...)` whenever any holes exist in the range, which means if the hole pars differ from the revision’s printed totals (bad data, partial hole set, or a future API change), the UI will silently show a different number than the canonical revision totals.
   - Suggested fix: Render Out/In par from the revision totals unconditionally:
- Out row: `{revision.outTotal}`
- In row: `{revision.inTotal}`
If you still want a sanity check, compute `outParTotal` and (only) log/telemetry when it mismatches, but don’t display it over the revision totals.

2. [medium] Tests don’t assert the Out/In par rows use revision.outTotal/inTotal (regression not caught)
   - File: apps/tournament-web/src/routes/events.$eventId.courses.$courseId.test.tsx:82-90
   - Confidence: high
   - Why it matters: The test suite claims it verifies “revision totals come from API, not re-summed”, but it only checks the presence of `72` (courseTotal) somewhere in the document. It does not validate that the Out/In rows display `revision.outTotal`/`revision.inTotal`, so the current bug (computed Out/In) passes tests and could regress again.
   - Suggested fix: Add assertions that specifically target the Out and In rows’ par cells. For example, build a fixture where holes 1–9 sum to something that does NOT equal `revision.outTotal` (e.g., set one hole par to 5) and assert the UI still shows `revision.outTotal` and `revision.inTotal` in the Out/In rows.

3. [low] defaultTeeColor matching can throw if event round teeColor is null/undefined, causing 500 and breaking uniform-403 posture
   - File: apps/tournament-api/src/routes/course-preview.ts:208-214
   - Confidence: medium
   - Why it matters: The route calls `pinning.teeColor.toLowerCase()` without guarding for nullish values. If `event_rounds.tee_color` is nullable (or corrupted) and comes back null, the handler will throw and return a 500. While this is a “shouldn’t happen” DB state, it’s exactly the kind of edge case that can break the endpoint’s reliability and its uniform error behavior assumptions.
   - Suggested fix: Defensively handle nullish tee colors:
```ts
const pinTee = typeof pinning.teeColor === 'string' ? pinning.teeColor : '';
const matchingTee = teeRows.find(t => t.teeColor.toLowerCase() === pinTee.toLowerCase());
const defaultTeeColor = matchingTee ? matchingTee.teeColor : null;
```
(or early-set `defaultTeeColor = null` when `pinning.teeColor` is not a string).

## Strengths

- Pinning implementation uses the specified ordering `(round_number ASC, event_rounds.id ASC)` and filters rounds by joining through course_revisions to enforce `courseId` membership (apps/tournament-api/src/routes/course-preview.ts:51-84).
- Uniform 403 behavior for course-not-in-event / unknown courseId is implemented via the empty-candidate-rounds check (apps/tournament-api/src/routes/course-preview.ts:75-82) and covered by integration tests (apps/tournament-api/src/routes/course-preview.integration.test.ts:315-329).
- defaultTeeColor is matched case-insensitively and returns the canonical teeColor string from `course_tees` when matched (apps/tournament-api/src/routes/course-preview.ts:208-214); mixed-case ordering + matching are tested (apps/tournament-api/src/routes/course-preview.integration.test.ts:295-305).
- Yardage JSON parsing is protected by try/catch and type-filtering to finite numbers, preventing crashes on malformed JSON and preventing non-numeric values from reaching the client (apps/tournament-api/src/routes/course-preview.ts:175-205).
- UI implements the spec’s “no partial sums” yardage totals rule by returning null if any hole in range lacks yardage for that tee (apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx:103-117) and tests it (apps/tournament-web/src/routes/events.$eventId.courses.$courseId.test.tsx:109-128).
- Tee selector chips are buttons with `aria-pressed` and are grouped with an accessible label (apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx:193-213).

## Warnings

None.
