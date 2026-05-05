# T7-2: Schedule View

## Status

ready-for-dev

## Story

As any Event participant, I want a Schedule page showing all rounds with course name, date in the event's timezone, tee color, holes-to-play chip, and viewer's pairing for each round, so that I can screenshot it to iMessage with everything I need for the trip — including whether any day has an Emergency 9 or two 9-hole matches (FR-E3, FR-E7).

## v1 Scope (TRIM from epic AC)

The epic AC mentions: hero image, tee time, "tap-to-open foursome detail modal", pairings-not-set placeholder, browser-tab graceful state. v1 trims:

- **DROP hero image** — no `hero_image_url` column exists on `courses` or `course_revisions`. Adding the field is its own story (ties into T7-3 course preview + T7-4 photo gallery / R2 storage). Followup T7-2a.
- **DROP tee time** — no `tee_time` column on `event_rounds`. Adding it requires a migration + admin-UI for setting it (today the round_date is a date). Followup T7-2b.
- **DROP modal** for tap-to-open-foursome — clicking the pairing row instead links to a dedicated route `/events/:eventId/rounds/:roundId/pairings` that doesn't exist yet. Followup T7-2c. v1 just renders the foursome list inline (no tap target).
- **KEEP** browser-tab graceful — page works without PWA install (no special handling needed; matches existing tournament-web pattern).

### What v1 ships

- Backend: new `GET /api/events/:eventId/schedule` returning rounds with `course.name`, `course.clubName`, viewer's pairing-per-round (3 other player names + their HI), and `groupedByDate` rendering hint.
- Frontend: `/events/:eventId/schedule` page rendering one card per round, grouped by `roundDate`, with viewer-name highlighted in the pairing list.

### Visibility model

`requireSession` + `requireEventParticipant` (group-member check). Same no-existence-leak as money/bets/leaderboard: 403 for non-participant, malformed eventId, or unknown eventId. Other players' pairings ARE event-wide-visible per FR-H6 — but **v1 only RENDERS the viewer's own foursome on the schedule card** (less wire payload, simpler UX). The fact that all-foursomes are FR-H6-visible doesn't broaden v1's render — it just means there's no privacy issue if a future story (T7-2c, the foursome-detail route/modal) surfaces all foursomes. v1 trim, not a visibility constraint.

## Path footprint — ALLOWED only

```
apps/tournament-api/src/routes/schedule.ts                        [NEW]
apps/tournament-api/src/routes/schedule.integration.test.ts       [NEW]
apps/tournament-api/src/app.ts                                    [MODIFIED — mount]
apps/tournament-web/src/routes/events.$eventId.schedule.tsx       [NEW]
apps/tournament-web/src/routes/events.$eventId.schedule.test.tsx  [NEW]
```

4 NEW + 1 MODIFIED. All under `apps/tournament-*/`. Zero SHARED, zero FORBIDDEN.

## Acceptance Criteria

**AC-1 — `GET /api/events/:eventId/schedule` happy path.**

**Given** session player is a participant
**When** invoked
**Then** returns 200 with body:

```ts
{
  event: { id: string; name: string; timezone: string };
  rounds: Array<{
    id: string;                         // event_rounds.id
    roundNumber: number;
    roundDate: number;                  // ms-since-epoch (event-tz local-day-start, per T7-1 convention)
    holesToPlay: 9 | 18;
    teeColor: string;
    course: { id: string; name: string; clubName: string };
    pairing:
      | { kind: 'foursome'; foursomeNumber: number; members: Array<{ playerId: string; name: string; handicapIndex: number; isViewer: boolean }> }
      | { kind: 'no_pairings_set' }            // no pairings rows exist for this round at all
      | { kind: 'viewer_not_in_foursome' };    // pairings exist but viewer is not assigned (e.g., subbed out)
  }>;        // ordered by round_number asc
}
```

The discriminated union distinguishes the two states the UI text needs to express differently:
- `no_pairings_set` → "Pairings not set yet" placeholder
- `viewer_not_in_foursome` → "You're not in a foursome this round" placeholder (e.g., subbed out)

`cache-control: no-store`.

**AC-2 — Pairing scoping (3-way discriminated state).**

The handler queries pairings + pairingMembers for the round and decides:

  - **`{ kind: 'foursome', foursomeNumber: N, members: [...] }`** when the session player has a `pairing_members` row in this round's pairings: returns that pairing's 4 members with `isViewer === true` for the session player exactly once. The other 3 entries get `isViewer === false`.
  - **`{ kind: 'no_pairings_set' }`** when ZERO pairings rows exist for this round (the round has no foursomes assigned at all).
  - **`{ kind: 'viewer_not_in_foursome' }`** when pairings exist for this round but the viewer is not a member of any of them (e.g., subbed out, late add).

The two non-foursome states are distinguished server-side because the UI text differs (AC-4).

**AC-3 — Auth chain + no-existence-leak.**

`requireSession` → 401. `requireEventParticipant` → 403 `not_event_participant`. Malformed/unknown `:eventId` → 403 `not_event_participant` (no 404 leakage) — handled BY the existing middleware: `apps/tournament-api/src/middleware/require-event-participant.ts:71-87` runs `WHERE groups.event_id = ?` against a string parameter; for both malformed UUIDs AND unknown UUIDs the SQL returns 0 rows and the predicate evaluates "not a participant", which serves the same 403 shape. Route handler body never runs in those cases. Mirrors money/bets/leaderboard/T7-1 verbatim.

**AC-4 — Web page renders.**

**Given** the API returns rounds
**When** `/events/:eventId/schedule` loads
**Then** the page renders:
  - `<h1>` "Schedule".
  - **Date grouping rule:** rounds are split into groups whose `roundDate` (ms-since-epoch) is **exactly equal** (`===`); each group has a single date header formatted in `event.timezone`. Within a group, rounds are ordered by `roundNumber` ascending. Groups are listed in chronological `roundDate` order.
  - One card per round in `roundNumber` order within each date group.
  - Each card displays: round number badge ("Round N"), course name + clubName, tee color, holes-to-play chip ("9 holes" or "18 holes"), pairing slot.
  - Pairing slot rendering by `pairing.kind`:
    - `'foursome'`: 4 player rows showing name + HI; viewer's row visually highlighted (e.g., bold + accent background).
    - `'no_pairings_set'`: text "Pairings not set yet".
    - `'viewer_not_in_foursome'`: text "You're not in a foursome this round".
  - Date format: `Intl.DateTimeFormat` with `timeZone: event.timezone` (NEVER viewer's local). Format: `EEEE, MMMM d` (e.g., "Friday, May 8") so Saturday-vs-Sunday is unambiguous on the trip.
  - **`event.timezone` validation:** trust the value; `Intl.DateTimeFormat` throws `RangeError` for invalid IANA strings. The admin event-creation flow (T3-2) is the source of validation; if a malformed timezone reaches this point, surfacing the error is correct.

**AC-5 — Auth/error UI.**

Mirrors T7-1: `beforeLoad` redirects anonymous to OAuth; data-fetch 403 → inline forbidden card.

**AC-6 — Tests.**

API:
  - 200 happy path: 2 rounds, viewer in foursome of both → pairing.kind === 'foursome' with isViewer flag.
  - 200 round with NO pairings rows → pairing.kind === 'no_pairings_set'.
  - 200 round with pairings but viewer is NOT a member → pairing.kind === 'viewer_not_in_foursome'.
  - 200 viewer in different foursomes across rounds → each round returns the viewer's own foursome.
  - 403 non-participant.
  - 403 malformed eventId.
  - 403 unknown eventId.

Web:
  - Renders rounds with course name + tee color + holes chip + pairing list.
  - Renders "Pairings not set yet" when `pairing.kind === 'no_pairings_set'`.
  - Renders "You're not in a foursome this round" when `pairing.kind === 'viewer_not_in_foursome'`.
  - Renders forbidden card on 403.
  - Same-day rounds group under a single date header (asserted with two rounds at identical `roundDate`).
  - Date format uses `event.timezone` (Pacific/Auckland fixture asserts non-local rendering, mirroring T7-1's pattern).

## Codex review notes

Spec-codex round 1: 0 critical, 2 H, 3 M, 1 L. All addressed inline:

- **High #1 (`pairing === null` collapses two states)** — replaced with discriminated union `{ kind: 'foursome' | 'no_pairings_set' | 'viewer_not_in_foursome' }` so UI text differs server-side.
- **High #2 (FR-H6 visibility conflict)** — clarified that pairings ARE event-wide-visible per FR-H6, but v1 only RENDERS the viewer's foursome on the schedule card (less wire payload, simpler UX). All-foursomes is followup T7-2c, not a privacy boundary.
- **Medium #3 (`groupedByDate` undefined)** — removed the "groupedByDate rendering hint" from the response shape; client groups based on `roundDate` equality (rule pinned in AC-4).
- **Medium #4 (malformed eventId underspecified)** — AC-3 now cites the existing `requireEventParticipant` middleware (line 71-87) which handles malformed UUIDs via SQL `WHERE eq` returning 0 rows.
- **Medium #5 (same-day grouping precision)** — AC-4 now states the grouping rule explicitly: `roundDate === roundDate` exact equality, within-group order by roundNumber, between-groups chronological.
- **Low #6 (timezone invalid handling)** — AC-4 now trusts T3-2 admin validation; `Intl.DateTimeFormat` throws on invalid IANA — surfacing the error is correct (don't silently fall back).

Per autonomous-progress mandate: proceeding to implementation without a third spec round.

### Impl-codex round 1: 0 critical, 2 H, 2 M, 1 L. One H rejected (already documented as v1-acceptable); rest addressed inline:

- **High #1 (N+1 queries in schedule endpoint)** — REJECTED as already documented. Spec's "Risks / Followups" section calls this out as acceptable for v1 (round counts ≤5 typical) with T7-2e tracked for future consolidation.
- **High #2 (silent skip on orphaned rounds)** — addressed: added `log.warn` for both course_revision-missing and course-missing skip cases so the silent drop is observable in CI/prod logs.
- **Medium #3 (non-exhaustive discriminated union in UI)** — addressed: `PairingBlock` now uses `switch (pairing.kind)` with a `default: { const _exhaustive: never = pairing; }` compile-time exhaustiveness check.
- **Medium #4 (holesToPlay force-cast)** — addressed: defense-in-depth `log.warn` if value is not 9 or 18 (the schema doesn't constrain; admin UI is the trusted source). Cast retained per the trust-upstream-validation pattern.
- **Low #5 (pairing list lacks aria-label)** — addressed: `<ul aria-label="Foursome N roster">` for screen readers.

## Followups

- **T7-2a (hero image):** add `hero_image_url` (or R2 key) to `courses` or `course_revisions`; surface on the schedule card. Coordinates with T2's course-admin UI.
- **T7-2b (tee time):** add `tee_time` to `event_rounds` (ms-since-epoch or HH:MM string?); admin UI to set it; render on the card.
- **T7-2c (foursome detail modal/route):** clicking the pairing row opens a dedicated `/events/:eventId/rounds/:roundId/pairings` route showing all foursomes in the round (or modal). Useful for spectating.
- **T7-2d (entry card on home page):** once T7-2 ships, add the Schedule card to T7-1's home page entry-cards list (per T7-1c followup).

## Files this story will edit

- apps/tournament-api/src/routes/schedule.ts
- apps/tournament-api/src/routes/schedule.integration.test.ts
- apps/tournament-api/src/app.ts
- apps/tournament-web/src/routes/events.$eventId.schedule.tsx
- apps/tournament-web/src/routes/events.$eventId.schedule.test.tsx

## Risks / Followups

- **Per-round queries are N+1 in the schedule endpoint** — for each round, the route loads pairings + pairingMembers + players + courses. Acceptable for v1 (tournament rounds count is ≤5 typically); followup T7-2e tracks consolidation if needed.
- **Pairing visibility** — FR-H6 says event-wide pairings are visible to all participants. `pairing` returns ONLY the viewer's foursome (not all foursomes); this is a v1 trim (less data over the wire). Showing all foursomes is T7-2c.
