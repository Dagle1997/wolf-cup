# T7-3: Course Preview — Per-Hole Detail (Hero Image Deferred)

## Status

ready-for-dev

## Story

As any Event participant, I want a Course Preview page per course showing the full 18-hole table (par, yardage per tee, SI) plus the course name + clubName, so that I can glance at the par-3 14th before the round (FR-E4).

## v1 Scope (TRIM from epic AC)

The epic AC mentions: hero image, city/state, architect, hole description/tips. **None of these have schema fields** — `courses` has only `id, name, clubName`; `course_revisions` has `outTotal, inTotal, courseTotal, sourceUrl, extractionDate, verified` + no place for hero/architect/city/state/description.

v1 trims:
- **DROP hero image, city/state, architect.** Renders a neutral gradient header with course name + clubName (matches AC's "no hero" fallback path, just promoted to default). Followups T7-3a (hero image after T2 admin UI surfaces it) + T7-3b (city/state/architect schema columns).
- **DROP per-hole description/tips.** Followup T7-3c.
- **KEEP** tee selector chips (from `course_tees` rows), per-hole table (hole number, par, yardage, SI), Out/In/Total totals, multi-revision pinning per FD-8 (the revision id pinned by event_rounds, NOT latest).

### Multi-revision pinning rule

For the URL's `:courseId`, find the `course_revisions.id` referenced by THIS event's rounds. The "pinning round" is selected by:

1. Filter `event_rounds` to those whose `course_revisions.course_id === :courseId` AND `event_rounds.event_id === :eventId`.
2. Order by `(round_number ASC, event_rounds.id ASC)` — the secondary `id` ascending is a deterministic tie-breaker if the same `round_number` is used twice (defense-in-depth; T3-1 has no UNIQUE on round_number alone but the admin UI should prevent duplicates).
3. The first row in that ordering is the pinning round. Its `course_revision_id` is `revision.id` in the response; its `tee_color` is `defaultTeeColor`.

If the course isn't referenced by ANY of the event's rounds → 403 `not_event_participant` (uniform with the participant middleware's 403; see AC-2 for rationale on dropping the 404 distinction).

### Backend addition

`GET /api/events/:eventId/courses/:courseId` returning:

```ts
{
  course: { id: string; name: string; clubName: string };
  revision: {
    id: string;                      // course_revisions.id (pinned, not latest)
    revisionNumber: number;
    outTotal: number;                // par totals from the scorecard
    inTotal: number;
    courseTotal: number;
  };
  tees: Array<{ teeColor: string; rating: number; slope: number }>;     // ordered by lowercase(teeColor) ASC for stable display across mixed-case admin entries (e.g., "Blue" vs "blue")
  holes: Array<{
    holeNumber: number;              // 1..18
    par: 3 | 4 | 5;
    si: number;                      // 1..18
    yardageByTee: Record<string, number>;   // parsed from yardage_per_tee_json
  }>;     // ordered by holeNumber asc
  defaultTeeColor: string | null;    // tee_color of the pinning round (defined above); null if the pinning round's tee_color isn't found in the revision's tees (defensive)
}
```

**Note on `defaultTeeColor`**: tee_color is per-`event_round`, not per-player. All players in a round play the same tees. The "default" therefore means "what tees this revision is being played on by THIS event for the relevant round" — there's no ambiguity per-viewer. If the round's tee_color value happens to NOT match any of the revision's `course_tees.tee_color` rows (data integrity issue), `defaultTeeColor` is `null` and the UI selects the first tee alphabetically.

`cache-control: no-store`. Auth: `requireSession` + `requireEventParticipant`.

## Path footprint — ALLOWED only

```
apps/tournament-api/src/routes/course-preview.ts                            [NEW]
apps/tournament-api/src/routes/course-preview.integration.test.ts           [NEW]
apps/tournament-api/src/app.ts                                       [MODIFIED — mount]
apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx       [NEW]
apps/tournament-web/src/routes/events.$eventId.courses.$courseId.test.tsx  [NEW]
```

4 NEW + 1 MODIFIED. All under `apps/tournament-*/`. Zero SHARED, zero FORBIDDEN.

## Acceptance Criteria

**AC-1 — `GET /api/events/:eventId/courses/:courseId` happy path.**

**Given** session player is a participant AND `:courseId` is referenced by ≥1 of the event's rounds
**When** invoked
**Then** returns 200 with the response shape above. `revision` is the pinned revision (lowest `event_rounds.round_number` referencing this course in this event); tees + holes belong to that revision; `defaultTeeColor` is the first matching `event_rounds.tee_color`.

**AC-2 — Course not in event → 403 (no soft-leak).**

**Given** session player is a participant of `:eventId` AND `:courseId` either (a) exists but is NOT referenced by any of the event's rounds, OR (b) does not exist at all, OR (c) is malformed
**When** invoked
**Then** returns **403** `{ error: 'forbidden', code: 'not_event_participant', requestId }` — same shape as the participant middleware's 403. **Uniform response** across all three cases means an attacker cannot enumerate which courses are referenced by this event vs. courses they have no entitlement to know about.

Original draft used 404 + a "course IDs are non-secret library entries" rationale; codex spec-codex round 1 (M #4) flagged that this still lets a participant differentiate "course X is in this event" from "course X exists elsewhere", which is a real (if narrow) membership leak. Removed the leak by collapsing to 403.

**AC-3 — Auth chain + no-existence-leak (events).**

`requireSession` → 401. `requireEventParticipant` → 403 `not_event_participant`. Malformed/unknown `:eventId` → 403 `not_event_participant` from the middleware. The course-existence check runs ONLY after the participant check passes.

**AC-4 — Multi-revision pinning preserved.**

**Given** course X has revisions R1 (created first) and R2 (created later); the event's round 1 uses R2 and round 2 uses R1
**When** the preview is fetched for course X
**Then** the response uses the revision pinned by the LOWEST round_number → R2 (round 1). `revision.revisionNumber === R2.revisionNumber`. Holes + tees come from R2. (Followup T7-3d may add a `revisionId` query param to override.)

**AC-5 — Web page renders.**

**Given** the API returns 200
**When** `/events/:eventId/courses/:courseId` loads
**Then** the page renders:
  - Header band (neutral gradient, no hero image): course name in display type + clubName subtitle.
  - Tee selector: one chip per tee in `tees`; default selection is `defaultTeeColor` if set, else the first tee alphabetically. Selecting a tee re-renders the yardage column only.
  - 18-hole table with columns: Hole, Par, Yardage (selected tee), SI.
  - Out/In/Total totals row:
    - **Par totals**: render the response's `revision.outTotal`, `revision.inTotal`, `revision.courseTotal` directly (these are the scorecard's printed totals; T2-4 validator is the upstream source of truth). Do NOT independently re-sum the per-hole pars in the UI — single source of truth from the API.
    - **Yardage totals (per selected tee)**: sum the per-hole yardages for holes 1–9 (Out), 10–18 (In), 1–18 (Total). If ANY hole in a given range has no yardage entry for the selected tee, that range's total renders `—` instead of a partial sum (so users don't think the partial number is the full total).
  - When a tee has missing yardage entries for some holes, the cell shows `—` (not a 0).

**AC-6 — Web page 403.**

**Given** API returns 403 (any cause: non-participant, course not in event, malformed/unknown courseId)
**When** the page loads
**Then** renders inline "You aren't a participant in this event, or this course isn't part of it." card. The unified message matches the unified API response (AC-2).

**AC-7 — Tests.**

API:
  - 200 happy path: 18 holes, 3 tees, defaultTeeColor matches event_round.tee_color.
  - 200 with multi-revision pinning: round 1 uses R2, round 2 uses R1 → response is R2's data.
  - 200 tees ordered by lowercase teeColor (mixed-case fixture: "Blue", "white", "RED").
  - 200 defaultTeeColor null when round's tee_color doesn't match any tees row (defensive).
  - 403 for course not in event (uniform shape).
  - 403 for unknown courseId (uniform shape).
  - 403 non-participant.
  - 403 malformed eventId.

Web:
  - Renders 18-hole table with correct par + SI values.
  - Renders revision.outTotal/inTotal/courseTotal directly (no re-summing of per-hole pars).
  - Tee selector switch: yardage column updates; par + SI unchanged.
  - Missing yardage for a tee renders `—`.
  - When a range (Out/In/Total) has any missing yardage for the selected tee, the corresponding yardage total renders `—`.
  - Forbidden card on 403 with the unified message.

## Codex review notes

Spec-codex round 1: 0 critical, 0 H, 5 M, 2 L. All addressed inline:

- **Medium #1 (pinning tie-breaker)** — explicit `(round_number ASC, event_rounds.id ASC)` ordering.
- **Medium #2 (defaultTeeColor selection underspecified)** — clarified: tee_color is per-event_round (not per-player); the default IS the pinning round's tee_color; `null` only on data integrity issues.
- **Medium #3 + #4 (404 soft-leak + membership-leak)** — collapsed: AC-2 now returns uniform 403 for "course not in event" / "unknown courseId" / "malformed courseId". No leak.
- **Medium #5 (totals reconciliation ambiguity)** — split clearly: par totals come from `revision.outTotal/inTotal/courseTotal` (single source of truth); yardage totals are summed by the UI from per-hole yardages.
- **Low #6 (missing yardage in totals)** — explicit rule: if any hole in a range is missing for the selected tee, the range total renders `—` (no partial-sum confusion).
- **Low #7 (tees ordering normalization)** — pinned to `lowercase(teeColor) ASC`.

Per autonomous-progress mandate: proceeding to implementation without a third spec round.

### Impl-codex round 1: 0 critical, 1 H, 1 M, 1 L. All addressed inline:

- **High #1 (Out/In par totals re-summed from holes vs spec's "single source of truth = revision printed totals")** — addressed: web page now renders `revision.outTotal` / `revision.inTotal` / `revision.courseTotal` directly. The `outParTotal` helper is removed.
- **Medium #2 (no test asserting Out/In rows use revision values)** — addressed: added regression test that injects discrepant revision.outTotal/inTotal values (35/37 vs the per-hole sum of 36/36) and asserts the rendered UI shows 35/37, not 36/36. Future regressions to per-hole-summing fail.
- **Low #3 (defaultTeeColor null-safety)** — addressed: `(pinning.teeColor ?? '').toLowerCase()` + early-out if empty. Malformed DB state can't 500 the route; uniform-403 posture preserved.

## Followups

- **T7-3a (hero image):** add `hero_image_url` (or R2 key) to courses or course_revisions; surface on the preview header.
- **T7-3b (city/state/architect):** schema columns + admin UI to set; render in header subtitle.
- **T7-3c (per-hole description/tips):** schema column on `course_holes`; render below or in expanded row.
- **T7-3d (revision override query param):** `?revisionId=…` lets organizer preview the latest rev even if it's not pinned by any round yet.
- **T7-3e (entry card on home page + schedule deep-link):** tap a course on T7-2's schedule card to land on this preview page.

## Files this story will edit

- apps/tournament-api/src/routes/course-preview.ts
- apps/tournament-api/src/routes/course-preview.integration.test.ts
- apps/tournament-api/src/app.ts
- apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx
- apps/tournament-web/src/routes/events.$eventId.courses.$courseId.test.tsx

## Risks / Followups

- **N+1 queries** on the API handler (per-tee + per-hole lookups). Acceptable v1; consolidation deferred to T7-3f if perf becomes an issue.
- **The 404 vs 403 boundary** for "course exists but not in event" is a slight no-existence-leak softening: an attacker could enumerate course IDs they're not entitled to know about. Mitigation: course IDs are non-secret library entries (scorecard data, reusable across events); the boundary is acceptable. Documented in AC-2.
