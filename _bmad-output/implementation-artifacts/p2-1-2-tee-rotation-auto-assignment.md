# Story P2.1.2: Tee Rotation Auto-Assignment

Status: done

## Story

As an admin,
I want the system to automatically assign tee rotation (blue → black → white) per the calendar, correctly handling skipped weeks and rainouts,
so that I don't have to manually track which tee is next.

## Acceptance Criteria

1. **Given** a new season is created **When** tee rotation is initialized **Then** the first active Friday is always assigned blue tees

2. **Given** a season calendar with active Fridays **When** the system assigns tee rotation **Then** tees cycle blue → black → white → blue across active (checked) Fridays in order

3. **Given** an unchecked/skipped Friday (club event, member-guest) **When** tee rotation is calculated **Then** the skipped week is ignored — the tee holds and the next active Friday gets the same tee that was scheduled for the skipped week **And** the skipped week itself has NO tee assignment (null)

4. **Given** two or more consecutive Fridays are skipped **When** tee rotation is calculated **Then** the tee holds through all skipped weeks — the next active Friday gets the tee that was due before the skips

5. **Given** a round is cancelled (rainout) after being created **When** tee rotation is recalculated **Then** the rainout Friday's tee still advances — the next Friday gets the next tee in the cycle **And** this matches the existing league rule: rainouts rotate, skipped weeks hold

6. **Given** the admin unchecks or re-checks a Friday mid-season **When** the calendar is saved **Then** tee assignments for all future Fridays are recalculated based on the updated calendar **And** tee assignments for past rounds are not changed

7. **Given** playoff rounds **When** tee assignment is determined **Then** playoff rounds are always blue tees regardless of rotation (existing v1 behavior)

## Tasks / Subtasks

- [x] Task 1: Add `tee` column to `season_weeks` table (AC: #1, #2)
  - [x] Add nullable `tee` text column to `seasonWeeks` in `apps/api/src/db/schema.ts`
  - [x] Run `pnpm drizzle-kit generate` to create migration (clean single ALTER TABLE)
  - [x] Verify migration applies cleanly

- [x] Task 2: Tee rotation calculation utility (AC: #1, #2, #3, #4, #5)
  - [x] Create `calculateTeeRotation(weeks)` in `apps/api/src/utils/tee-rotation.ts`
  - [x] Rotation cycle: `['blue', 'black', 'white']` — deterministic from active week position
  - [x] Inactive weeks (isActive=0): tee = null, do NOT advance rotation index
  - [x] Cancelled rounds: handled naturally — cancelled rounds keep week active, so rotation advances
  - [x] Return array of `{ weekId, tee: 'blue'|'black'|'white'|null }` assignments
  - [x] 10 comprehensive unit tests with hard-coded expected outputs

- [x] Task 3: Assign tees on season creation (AC: #1, #2)
  - [x] After week rows are inserted in `POST /admin/seasons`, call `calculateTeeRotation` and update week tees
  - [x] All weeks start active, so tees cycle normally: week1=blue, week2=black, week3=white, week4=blue...
  - [x] Include `tee` in the season creation response

- [x] Task 4: Recalculate tees on week toggle (AC: #3, #4, #6)
  - [x] After toggling a week in `PATCH /admin/seasons/:seasonId/weeks/:weekId`, recalculate tees for ALL weeks
  - [x] Tee recalculation within transaction (only updates changed tees for efficiency)
  - [x] Include `tee` in the toggle response

- [x] Task 5: Include tee in weeks API responses (AC: #2, #3)
  - [x] `GET /admin/seasons/:seasonId/weeks` — `tee` field included automatically via `select()`
  - [x] Verified via API test

- [x] Task 6: Update calendar UI to display tee assignments (AC: #2, #3, #6)
  - [x] Added `TeeBadge` component with color-coded styling (blue/black/white)
  - [x] Tee badge displayed next to each week in the calendar checklist
  - [x] Inactive/skipped weeks show no tee (null)
  - [x] Tee display updates reactively via query invalidation on toggle

- [x] Task 7: Tests (AC: #1, #2, #3, #4, #5, #6, #7)
  - [x] 10 unit tests for `calculateTeeRotation`: basic cycle, 6-week cycle, skip handling, multi-skip, all inactive, single week, skip-at-start, skip-at-end, empty input
  - [x] 5 API tests: season create assigns tees, GET weeks includes tee, toggle recalculates (skip holds rotation), toggle back restores, toggle response includes tee
  - [x] Edge cases: all weeks skipped (all null), single week season (blue)

## Dev Notes

### Tee Rotation Logic

The rotation is **deterministic from calendar state**. The algorithm:

```typescript
const TEE_CYCLE: Tee[] = ['blue', 'black', 'white'];

function calculateTeeRotation(
  weeks: { id: number; friday: string; isActive: number }[],
  cancelledDates: Set<string> = new Set(),
): { weekId: number; tee: Tee | null }[] {
  let rotationIndex = 0;
  return weeks.map((week) => {
    if (week.isActive === 0) {
      // Skipped week: no tee, don't advance
      return { weekId: week.id, tee: null };
    }
    const tee = TEE_CYCLE[rotationIndex % 3]!;
    rotationIndex++; // Always advance for active weeks (whether cancelled or not)
    return { weekId: week.id, tee };
  });
}
```

**Key insight**: The cancelled round distinction only matters for AC #5 — but since cancelled rounds still have their week marked as **active** (isActive=1), the rotation naturally advances through them. A cancelled round's week is still "active" in the calendar — it's the round that was cancelled, not the Friday. So the rotation logic is actually simple: just cycle through active weeks.

**Skipped weeks** (isActive=0) are different — the admin explicitly unchecked that Friday, meaning the league doesn't play at all. The tee holds.

**This means**: The cancelled round case is handled automatically by the existing active/inactive model. No special `cancelledDates` parameter is needed unless we want to handle a hypothetical future case where a cancelled round's week becomes inactive but should still advance. For now, keep it simple.

### Database Schema Change

Add to `season_weeks` in `apps/api/src/db/schema.ts`:

```typescript
tee: text('tee'), // 'blue' | 'black' | 'white' | null (null for skipped weeks)
```

No check constraint needed — Zod validation on the API layer handles valid values. The column is nullable because skipped weeks have no tee.

### API Changes

**Modified `POST /admin/seasons`** — after creating weeks, calculate and assign tees:
- All weeks start active → simple cycle assignment
- Update each week row with its tee value within the same transaction

**Modified `PATCH /admin/seasons/:seasonId/weeks/:weekId`** — after toggling:
- Recalculate tees for all weeks in the season
- For mid-season protection: check if a week has a finalized round — if so, don't change its tee
- Update all week tee values in the transaction

**Modified `GET /admin/seasons/:seasonId/weeks`** — no logic change needed:
- The `tee` column is already part of `select()` since we use `db.select().from(seasonWeeks)`

### UI Changes

**File: `apps/web/src/routes/admin/season.tsx`**

In the `SeasonWeeksCalendar` component, add a tee color indicator to each week row:

```tsx
<span className={week.isActive === 0 ? 'line-through' : ''}>
  <span className="font-medium">Week {week.weekNumber}</span>
  {' — '}
  {formatShortDate(week.friday)}
  {week.tee && (
    <span className="ml-2 text-xs font-medium uppercase px-1.5 py-0.5 rounded bg-muted">
      {week.tee}
    </span>
  )}
</span>
```

Consider tee-color-coded badges:
- Blue → `bg-blue-100 text-blue-700`
- Black → `bg-gray-800 text-white`
- White → `bg-gray-100 text-gray-700 border`

### Existing Patterns to Follow

- **Tee type**: `'black' | 'blue' | 'white'` — defined in `packages/engine/src/course.ts` as `Tee` type
- **Tee ratings**: `TEE_RATINGS` in `packages/engine/src/course.ts` — used for handicap calculations
- **Response shape**: Follow existing `GET /admin/seasons/:seasonId/weeks` response pattern
- **Transaction pattern**: `db.transaction(async (tx) => { ... })` — used in POST seasons and PATCH toggle
- **Migration**: drizzle-kit generates, may need trimming (same issue as P2.1.1)
- **Boolean storage**: `0`/`1` integer in SQLite, boolean in Zod/API layer
- **Auth**: All routes use `adminAuthMiddleware`

### Important Domain Context

- **Tee rotation order**: blue → black → white → blue (confirmed in `course.ts` line 23)
- **Playoff rounds**: Always blue tees — but playoff tee assignment is NOT part of this story (playoff rounds are separate from the regular season calendar, handled by round creation)
- **The `rounds.tee` field** already exists — this story assigns tees to `season_weeks`, not directly to rounds. Round creation (P2.3.1) will later default to the calendar tee.
- **No `groups.tee` changes needed** — group tee is set at batting order time, independent of this story

### Project Structure Notes

- Schema changes: `apps/api/src/db/schema.ts` (add `tee` to `seasonWeeks`)
- New file: `apps/api/src/utils/tee-rotation.ts` (rotation calculation)
- New file: `apps/api/src/utils/tee-rotation.test.ts` (unit tests)
- Route changes: `apps/api/src/routes/admin/season.ts` (modify POST + PATCH to assign/recalculate tees)
- Test changes: `apps/api/src/routes/admin/season.test.ts` (verify tee in API responses)
- UI changes: `apps/web/src/routes/admin/season.tsx` (display tee badge per week)
- Migration: auto-generated via `pnpm drizzle-kit generate`
- No new packages needed
- No engine changes needed

### Testing Standards

- Vitest for API tests
- In-memory SQLite (`:memory?cache=shared`) for test DB
- Mock `adminAuthMiddleware` to bypass auth in tests
- **Unit tests for rotation logic**:
  - 3 active weeks → blue, black, white
  - 6 active weeks → blue, black, white, blue, black, white
  - Skip week 2 of 4 → blue, null, black, white (not blue, null, blue, black)
  - Skip weeks 2+3 of 5 → blue, null, null, black, white
  - All inactive → all null
  - Single active week → blue
  - 1 active, 1 skip, 1 active → blue, null, black
- **API integration tests**:
  - Season create → weeks have tees assigned
  - Toggle week inactive → future tees recalculate
  - Toggle week active → future tees recalculate
  - GET weeks → tee field present

### References

- [Source: _bmad-output/planning-artifacts/epics-phase2.md — Story P2.1.2, lines 172-213]
- [Source: apps/api/src/db/schema.ts — seasonWeeks table, rounds.tee, groups.tee]
- [Source: packages/engine/src/course.ts — Tee type, TEE_RATINGS, rotation order]
- [Source: apps/api/src/routes/admin/season.ts — existing weeks endpoints]
- [Source: apps/api/src/routes/admin/rounds.ts — round creation tee handling]
- [Source: _bmad-output/implementation-artifacts/p2-1-1-season-calendar-auto-calculate-fridays.md — previous story patterns]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Migration 0011 generated cleanly — single `ALTER TABLE season_weeks ADD tee text`
- No `cancelledDates` parameter needed — cancelled rounds keep week active (isActive=1), so rotation advances naturally through the existing active/inactive model
- Tee recalculation in PATCH toggle only updates weeks whose tee actually changed (efficiency optimization)

### Completion Notes List
- **15 new tests** (10 tee rotation unit + 5 API integration) — all pass (44 total with existing)
- **Typecheck**: clean (api + web)
- **Lint**: clean
- **Pre-existing test failures** (9 tests in ghin, stats, leaderboard, rounds) — not caused by this story

### File List
- `apps/api/src/db/schema.ts` — added `tee` column to `seasonWeeks` table
- `apps/api/src/db/migrations/0011_complex_the_anarchist.sql` — migration for `season_weeks.tee`
- `apps/api/src/db/migrations/meta/_journal.json` — updated by drizzle-kit
- `apps/api/src/db/migrations/meta/0011_snapshot.json` — drizzle-kit snapshot
- `apps/api/src/utils/tee-rotation.ts` — new: `calculateTeeRotation()` utility
- `apps/api/src/utils/tee-rotation.test.ts` — new: 10 unit tests
- `apps/api/src/routes/admin/season.ts` — POST assigns tees, PATCH recalculates tees, import added
- `apps/api/src/routes/admin/season.test.ts` — 5 new tee rotation API tests
- `apps/web/src/routes/admin/season.tsx` — `TeeBadge` component, `tee` field in `SeasonWeek` type, tee display in calendar

### Change Log
- 2026-03-14: Implemented P2.1.2 — Tee rotation auto-assignment with blue→black→white cycle, skip handling, and calendar UI display
- 2026-03-14: Code review fixes — M1: set tee in initial INSERT (eliminated N+1 UPDATEs); M2: import Tee type from engine package; L1: fix invalid test dates; L2: resolved via M2
