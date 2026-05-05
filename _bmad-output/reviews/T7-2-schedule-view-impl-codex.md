# Codex Review

- Generated: 2026-05-05T00:15:29.124Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/schedule.ts, apps/tournament-api/src/routes/schedule.integration.test.ts, apps/tournament-web/src/routes/events.$eventId.schedule.tsx, apps/tournament-web/src/routes/events.$eventId.schedule.test.tsx

## Summary

Implements the 3‑state pairing union end-to-end with good no-existence-leak behavior (403 via participant middleware + defense-in-depth) and solid smoke/integration coverage. Main risks are (1) heavy N+1 querying in the API handler, (2) silently dropping rounds when course data is missing, and (3) non-exhaustive handling of the discriminated union in the UI that could crash on unexpected kinds.

Overall risk: medium

## Findings

1. [high] N+1 query pattern per round in schedule endpoint (scales poorly with round count)
   - File: apps/tournament-api/src/routes/schedule.ts:113-218
   - Confidence: high
   - Why it matters: For each round, the handler performs multiple DB round-trips: courseRevision lookup, course lookup, viewer membership lookup, then either pairingMeta+members or an existence check for any pairings. That’s ~3–5 queries per round, which will become a bottleneck as events/rounds grow and increases latency under load.
   - Suggested fix: Batch-fetch data instead of per-round querying: (a) fetch rounds joined to courseRevisions + courses in one query, (b) fetch viewer’s pairingIds for all roundIds in one query, (c) fetch pairingMeta + members for those pairingIds in one query (and group in memory), (d) if you need the distinction between no_pairings_set vs viewer_not_in_foursome, fetch a per-round “hasAnyPairings” map in one query using distinct eventRoundId where eventRoundId IN (...).

2. [high] Silent data loss: orphaned rounds are skipped from API response
   - File: apps/tournament-api/src/routes/schedule.ts:115-141
   - Confidence: high
   - Why it matters: If a round’s courseRevision or course row is missing, the code `continue`s (lines 125 and 140), causing that round to disappear from the response entirely. This can violate the contract (“per-round { course, teeColor, holesToPlay, pairing }”) and make the UI show fewer rounds than exist, hiding data integrity issues and confusing users.
   - Suggested fix: Prefer failing loudly or returning a round with an explicit error shape. Options: (1) return 500 with a clear code (and log details) if invariant data is missing, or (2) include the round with `course: null` and a `courseMissing: true` flag (if the spec allows), so the UI can render an error state instead of dropping it silently.

3. [medium] UI pairing discriminated union is not handled exhaustively; unknown kind will crash at runtime
   - File: apps/tournament-web/src/routes/events.$eventId.schedule.tsx:239-267
   - Confidence: high
   - Why it matters: `PairingBlock` handles two kinds explicitly and then falls through assuming the remaining state is `foursome` (line 250+). If the API ever adds a new `kind` (or a malformed payload arrives), the component will try to read `pairing.members` on a non-foursome value and throw, breaking the whole schedule page.
   - Suggested fix: Use a `switch (pairing.kind)` with an exhaustive check (e.g., `assertNever(pairing)`) and/or a defensive default rendering. Example:
- `case 'foursome': ...`
- `case 'no_pairings_set': ...`
- `case 'viewer_not_in_foursome': ...`
- `default: return <p role="alert">Unknown pairing state</p>`

4. [medium] holesToPlay is unchecked and force-cast to 9|18 in API response
   - File: apps/tournament-api/src/routes/schedule.ts:220-225
   - Confidence: high
   - Why it matters: `holesToPlay: r.holesToPlay as 9 | 18` (line 224) trusts DB contents without runtime validation. If the DB ever contains an unexpected value (migration bug, manual edits, corrupted seed), the API will still emit it while claiming it’s 9|18, and the UI will render misleading data (or future logic may break).
   - Suggested fix: Validate and coerce/guard: e.g. `if (r.holesToPlay !== 9 && r.holesToPlay !== 18) { log.error(...); return 500 }` (or default with explicit flag). Even if DB constraints exist, guarding prevents hard-to-debug inconsistencies.

5. [low] Pairing list lacks an accessible label/context for screen readers
   - File: apps/tournament-web/src/routes/events.$eventId.schedule.tsx:250-266
   - Confidence: medium
   - Why it matters: The `<ul>` of member names is rendered without an aria-label or heading indicating what the list represents (e.g., “Your foursome”). Screen readers may announce a list of names without context, especially since the foursome number isn’t shown.
   - Suggested fix: Add context: render a small heading like `Foursome {pairing.foursomeNumber}` and/or set `aria-label` on the `<ul>` (e.g., `aria-label={
  `Foursome ${pairing.foursomeNumber} players`
}`), optionally including “(you)” for `isViewer`.

## Strengths

- API preserves the no-existence-leak invariant by using `requireEventParticipant` and returns a 403-shaped response even if the event row is missing (apps/tournament-api/src/routes/schedule.ts:74-81).
- Pairing scoping is correct for v1: only the viewer’s pairing is returned, and membership is scoped to the round via `pairings.eventRoundId = r.id` (apps/tournament-api/src/routes/schedule.ts:149-156).
- UI groups by exact `roundDate` equality and sorts group headers chronologically; helper is pure and well-tested (apps/tournament-web/src/routes/events.$eventId.schedule.tsx:109-121; test file:174-210).
- Timezone formatting explicitly uses `event.timezone` and has a targeted test covering a non-local timezone scenario (apps/tournament-web/src/routes/events.$eventId.schedule.tsx:128-135; test file:146-171).
- Integration tests cover all three pairing states plus 403 behaviors for non-participant/malformed/unknown IDs and ordering by roundNumber (apps/tournament-api/src/routes/schedule.integration.test.ts:242-329).

## Warnings

None.
