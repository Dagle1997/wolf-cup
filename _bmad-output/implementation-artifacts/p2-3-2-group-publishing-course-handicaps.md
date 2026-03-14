# Story P2.3.2: Group Publishing with Course Handicaps

Status: done

## Story

As an admin,
I want to suggest and publish groups that all players can see, with course handicaps from the correct tee and a handicap freshness timestamp,
so that players know their group and course handicap before Friday without needing a Golf Game Book screenshot.

As a player,
I want to see my group assignment and course handicap in the app,
so that I don't have to wait for a GroupMe screenshot or calculate my own course handicap.

## Acceptance Criteria

1. **Given** an admin has created a round from the attendance board **When** they navigate to round management and click "Suggest Groups" **Then** the weighted pairing algorithm runs with pairing history counts displayed per suggested group **And** the admin can accept, modify, or re-suggest

2. **Given** pairing history is displayed per suggested group **When** group details are shown **Then** an expandable section shows all pair combinations with grouping count (e.g., "Ben + Jeff: 4x") **And** collapsed view shows highest pair count ("Most paired: Ben + Jeff 4x")

3. **Given** groups are assigned **When** the pairings view is displayed (admin or any user) **Then** each group shows player names with **course handicap** from the selected tee **And** tee color and round date displayed **And** "Handicaps updated [timestamp]" shown

4. **Given** the pairings view on mobile with up to 5 groups **Then** all groups render in a single viewport without scrolling **And** screenshot-friendly layout

5. **Given** pairing history counts **When** calculated **Then** only finalized official rounds are considered (cancelled, practice excluded)

## Tasks / Subtasks

- [x]Task 1: Add `handicapUpdatedAt` column to rounds table (AC: #3)
  - [x]Add nullable `handicapUpdatedAt` integer column to rounds schema
  - [x]Generate migration
  - [x]Set to `Date.now()` on round creation in POST /rounds and POST /rounds/from-attendance

- [x]Task 2: Public pairings API endpoint (AC: #3)
  - [x]Add `GET /pairings/:roundId` — public endpoint returning groups with course handicaps
  - [x]Return: groups with player names, course handicap (calculated from HI + tee), tee, date, handicapUpdatedAt
  - [x]No auth required

- [x]Task 3: Public pairings page UI (AC: #3, #4)
  - [x]Create `apps/web/src/routes/pairings.$roundId.tsx`
  - [x]Display all groups in compact card layout
  - [x]Player names + course handicap (not HI)
  - [x]Tee badge + date header
  - [x]"Handicaps updated [time]" footer
  - [x]Screenshot-friendly: high contrast, no excess chrome, all groups visible

- [x]Task 4: Enhance suggest groups UI with pairing history (AC: #1, #2)
  - [x]In rounds.tsx suggest flow, show pair counts per group
  - [x]Collapsed: "Most paired: X + Y Nx"
  - [x]Expandable: all C(n,2) pair counts within group

- [x]Task 5: Tests (AC: #2, #3, #5)
  - [x]API: GET /pairings/:roundId returns groups with courseHandicap
  - [x]API: courseHandicap matches engine calculation
  - [x]Unit: verify pairing history excludes cancelled rounds (already tested in pairing engine)

## Dev Notes

### Course Handicap Calculation

Already in engine — `calcCourseHandicap(handicapIndex, tee)`:
```typescript
Math.round(HI × (slopeRating / 113) + (courseRating - 71))
```

Calculate at API response time, not stored. Include in pairings response.

### Public Pairings Endpoint

New file: `apps/api/src/routes/pairings.ts`

```typescript
GET /pairings/:roundId
Response: {
  round: { id, scheduledDate, tee, status, handicapUpdatedAt },
  groups: [{
    groupNumber: number,
    players: [{
      id, name, handicapIndex, courseHandicap, isSub
    }]
  }]
}
```

Use `calcCourseHandicap` from engine package. The API already depends on `@wolf-cup/engine`.

### Pairings Page UI

Route: `/pairings/$roundId` (TanStack Router file-based: `pairings.$roundId.tsx`)

Compact layout for screenshot-friendliness:
```
┌─────────────────────────────────┐
│ Groups — Fri, Apr 10            │
│ Blue tees · Updated 6:03am      │
├─────────────────────────────────┤
│ Group 1          │ Group 2      │
│ Bonner      10   │ Dagle    7   │
│ Jaquint     16   │ Smith   10   │
│ Moses        5   │ Wellman 12   │
│ Pierson      9   │ Allen    8   │
├─────────────────────────────────┤
│ Group 3          │ Group 4      │
│ ...              │ ...          │
└─────────────────────────────────┘
```

2-column grid for groups, 4 rows per group. Compact text, tabular numbers for handicaps.

### Pairing History Enhancement

The existing suggest groups response returns `groups: [{groupNumber, playerIds}]`. The UI needs pairing counts per group. Two approaches:
1. Enhance API response to include pair counts — cleanest
2. Calculate in UI from pairing history data — more complex

Go with option 1: add `pairCounts` to suggest response in `POST /admin/rounds/:roundId/suggest-groups`.

### Project Structure Notes

- Schema: `apps/api/src/db/schema.ts` (add handicapUpdatedAt to rounds)
- New file: `apps/api/src/routes/pairings.ts` (public pairings endpoint)
- Route registration: `apps/api/src/index.ts`
- New file: `apps/web/src/routes/pairings.$roundId.tsx` (public pairings page)
- UI changes: `apps/web/src/routes/admin/rounds.tsx` (enhance suggest flow)
- Route changes: `apps/api/src/routes/admin/rounds.ts` (set handicapUpdatedAt on creation)
- Migration: drizzle-kit generate

### References

- [Source: packages/engine/src/course.ts — calcCourseHandicap, TEE_RATINGS]
- [Source: apps/api/src/routes/admin/pairing.ts — suggest groups endpoint]
- [Source: apps/api/src/routes/rounds.ts — public round detail]
- [Source: apps/web/src/routes/admin/rounds.tsx — suggest groups UI]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Course handicap verified: Alice HI=10.2 on blue tees → courseHCP=10 (round(10.2*(126/113)+(69.9-71)))
- Suggest groups response enhanced with pairCounts array + maxPairCount per group
- Pairings page uses 2-column grid for screenshot-friendly compact layout

### Completion Notes List
- **2 new pairings tests** (19 total attendance file) — all pass
- **Typecheck**: clean
- **Lint**: clean

### File List
- `apps/api/src/db/schema.ts` — added `handicapUpdatedAt` to rounds
- `apps/api/src/db/migrations/0014_old_gertrude_yorkes.sql` — migration
- `apps/api/src/db/migrations/meta/_journal.json` — updated
- `apps/api/src/db/migrations/meta/0014_snapshot.json` — snapshot
- `apps/api/src/routes/pairings.ts` — new: public GET /pairings/:roundId with course handicaps
- `apps/api/src/routes/admin/rounds.ts` — set handicapUpdatedAt on round creation
- `apps/api/src/routes/admin/pairing.ts` — enhanced suggest response with pairCounts
- `apps/api/src/index.ts` — registered pairings router
- `apps/api/src/routes/attendance.test.ts` — 2 new pairings tests
- `apps/web/src/routes/pairings.$roundId.tsx` — new: public pairings page with course HCPs

### Change Log
- 2026-03-14: Implemented P2.3.2 — Public pairings view with course handicaps, handicap timestamp, enhanced suggest groups with pair counts
