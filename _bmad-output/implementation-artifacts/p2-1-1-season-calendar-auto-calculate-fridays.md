# Story P2.1.1: Season Calendar — Auto-Calculate Fridays & Off-Week Management

Status: done

## Story

As an admin,
I want to enter a start and end date and have the system auto-calculate all Fridays, with the ability to uncheck off-weeks,
so that I don't have to manually count Fridays or enter a total round count.

## Acceptance Criteria

1. **Given** an admin is creating a season **When** they enter a start date and end date (both must be Fridays) **Then** the system calculates all Fridays between those dates (inclusive of both boundaries) and creates season weeks **And** auto-populates the total round count from the number of Fridays **And** the season creation + week generation is atomic (one operation)

2. **Given** the calendar of Fridays is displayed **When** the admin unchecks a Friday (e.g., member-guest weekend) **Then** that Friday is marked inactive/skipped **And** the active round count updates automatically **And** the original total Fridays count remains unchanged (players need to know the full potential)

3. **Given** a season is already active mid-season **When** the admin unchecks a newly discovered off-week Friday **Then** the calendar updates, active round count adjusts, and no existing round data is affected **And** if a round exists for that Friday, the admin is warned but the toggle is allowed (round is not deleted)

4. **Given** the admin is configuring a season **When** the playoff format field is displayed **Then** it is pre-filled with the standard playoff format (Round of 8 → Round of 4) **And** the admin does not need to re-enter it each season

5. **Given** start or end date is not a Friday **When** the admin submits the season form **Then** validation rejects with a clear error message

6. **Given** all weeks are toggled inactive **When** the admin unchecks the last active week **Then** a warning is shown ("No active rounds remaining") but the operation is allowed

## Tasks / Subtasks

- [x] Task 1: Add `season_weeks` table to database schema (AC: #1)
  - [x] Define `season_weeks` table in `apps/api/src/db/schema.ts` — columns: `id`, `seasonId`, `friday`, `isActive`, `createdAt` (NO `weekNumber` — computed on read)
  - [x] Run `pnpm drizzle-kit generate` to create migration
  - [x] Verify migration applies cleanly

- [x] Task 2: Friday calculation utility (AC: #1, #5)
  - [x] Create `getFridaysInRange(startDate: string, endDate: string): string[]` utility
  - [x] Validate both dates are Fridays — reject if not
  - [x] Handle edge cases: same Friday for start and end (returns 1), no Fridays in range (returns empty)
  - [x] Add hard-coded validation test: April 10, 2026 to August 28, 2026 → exact expected list of 21 Fridays (corrected: April 11 is Saturday, April 10 is Friday)

- [x] Task 3: Update season creation to atomically generate weeks (AC: #1)
  - [x] Modify `POST /admin/seasons` to auto-generate `season_weeks` rows within the same transaction
  - [x] Validate start/end dates are Fridays before creating season
  - [x] Set `totalRounds` to the number of generated Fridays
  - [x] Return season with weeks in response

- [x] Task 4: Create season weeks API endpoints (AC: #2, #3, #6)
  - [x] Add Zod schema `toggleWeekSchema` in `apps/api/src/schemas/season.ts`
  - [x] Add `GET /admin/seasons/:seasonId/weeks` — list all weeks ordered by `friday ASC`, compute week number from position
  - [x] Add `PATCH /admin/seasons/:seasonId/weeks/:weekId` — toggle week active/inactive, update `seasons.totalRounds` (count of active weeks)
  - [x] Return both `totalFridays` (all weeks) and `activeRounds` (active weeks) in responses
  - [x] Warn (in response) if toggling would leave zero active weeks

- [x] Task 5: Pre-fill playoff format default (AC: #4)
  - [x] Default `playoffFormat` to "Round of 8 → Round of 4" in the create season UI
  - [x] API still accepts custom values but UI pre-fills the standard

- [x] Task 6: Season settings UI — calendar display and management (AC: #1, #2, #3, #6)
  - [x] Add calendar/week list component to admin season settings page
  - [x] Display all Fridays as a checklist with computed week numbers
  - [x] Admin can uncheck/check individual Fridays
  - [x] Show: "**17 active rounds** of 19 total Fridays (2 skipped)"
  - [x] Pre-fill playoff format in season creation form
  - [x] Warn visually if a toggled week has an existing round

- [x] Task 7: Protect existing round data on mid-season edits (AC: #3)
  - [x] When toggling a week inactive, check if a round exists for that date (match by `scheduledDate`)
  - [x] If round exists: include warning in API response, UI displays warning but allows toggle
  - [x] Round is NOT deleted — just the week is marked inactive

- [x] Task 8: Tests (AC: #1, #2, #3, #4, #5, #6)
  - [x] Friday calculation utility: known date range produces exact expected Fridays, both boundaries inclusive, non-Friday rejection, same-day Friday, empty range
  - [x] API tests: season create auto-generates weeks, list weeks with computed week numbers, toggle week updates activeRounds, totalRounds reflects active count
  - [x] Edge case tests: all weeks unchecked (warning), toggle with existing round (warning), re-create season regenerates weeks
  - [x] Validate start/end must be Fridays

## Dev Notes

### Database Schema

Add to `apps/api/src/db/schema.ts`:

```typescript
export const seasonWeeks = sqliteTable(
  'season_weeks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    friday: text('friday').notNull(), // ISO YYYY-MM-DD, must be a Friday
    isActive: integer('is_active').notNull().default(1), // 0=skipped, 1=active
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    seasonWeekUniq: uniqueIndex('uniq_season_week').on(t.seasonId, t.friday),
    seasonIdx: index('idx_season_weeks_season').on(t.seasonId),
  }),
);
```

Key decisions:
- **NO `weekNumber` column** — compute week number on read by ordering active weeks by date. Avoids renumbering headaches when weeks are toggled. The API response includes a computed `weekNumber` field.
- `onDelete: 'cascade'` — when season is deleted (P2.1.3), weeks are auto-deleted
- Unique on `(seasonId, friday)` — prevents duplicate Friday entries
- `isActive` as 0/1 integer following existing SQLite boolean pattern (`harveyLiveEnabled`, `is_sub`, etc.)
- `friday` stored as ISO date string (consistent with `seasons.startDate` / `seasons.endDate`)

### API Endpoints

All endpoints on the existing season admin router (`apps/api/src/routes/admin/season.ts`), protected by `adminAuthMiddleware`.

**Modified `POST /admin/seasons` (atomic create + generate weeks)**
- Validates start/end dates are Fridays (day of week check)
- Creates season record
- Calculates all Fridays between start and end (inclusive)
- Inserts `season_weeks` rows for each Friday (all active by default)
- Sets `seasons.totalRounds` to the Friday count
- All within a single transaction
- Returns `{ season: Season, weeks: SeasonWeek[], totalFridays: number }`

**`GET /admin/seasons/:seasonId/weeks`**
- Returns `{ items: SeasonWeek[], totalFridays: number, activeRounds: number }`
- Items ordered by `friday ASC`
- Each item includes computed `weekNumber` (1-based position in full list, not just active)
- `totalFridays` = total weeks count, `activeRounds` = count where `isActive = 1`

**`PATCH /admin/seasons/:seasonId/weeks/:weekId`**
- Body: `{ isActive: boolean }`
- Toggles the week active/inactive
- Recalculates `seasons.totalRounds` (count of active weeks)
- Checks if a round exists for this Friday's date — includes `hasRound: true` warning in response
- Checks if this leaves zero active weeks — includes `warning: 'No active rounds remaining'` in response
- Returns `{ week: SeasonWeek, activeRounds: number, totalFridays: number, hasRound?: boolean, warning?: string }`

### Date Validation

**Start and end dates must be Fridays.** Add validation to `createSeasonSchema`:

```typescript
export const createSeasonSchema = z.object({
  name: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
    (d) => new Date(d + 'T12:00:00').getDay() === 5,
    { message: 'Start date must be a Friday' }
  ),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
    (d) => new Date(d + 'T12:00:00').getDay() === 5,
    { message: 'End date must be a Friday' }
  ),
  playoffFormat: z.string().min(1),
}).refine(
  (d) => d.startDate <= d.endDate,
  { message: 'Start date must be before or equal to end date' }
);
```

### Friday Calculation

Utility function — lives in the season route file or a shared utility in `apps/api/src/utils/`:

```typescript
function getFridaysInRange(startDate: string, endDate: string): string[] {
  const fridays: string[] = [];
  const start = new Date(startDate + 'T12:00:00'); // noon to avoid TZ issues
  const end = new Date(endDate + 'T12:00:00');

  // Validate both are Fridays
  if (start.getDay() !== 5 || end.getDay() !== 5) {
    throw new Error('Both start and end dates must be Fridays');
  }

  const current = new Date(start);
  while (current <= end) {
    fridays.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 7);
  }

  return fridays;
}
```

Since both dates are validated as Fridays, the calculation is trivial — start on start date, add 7 days until past end date. No "find first Friday" logic needed.

### UI Changes

File: `apps/web/src/routes/admin/season.tsx`

**Season creation form changes:**
- `playoffFormat` input pre-filled with "Round of 8 → Round of 4"
- Start/end date inputs should hint "Must be a Friday" or validate on blur
- On successful season create, the response includes weeks — display calendar immediately

**New calendar component (within season settings):**
- List of Fridays with checkboxes
- Each row: `☑ Week 1 — Friday, April 11` or `☐ Week 8 — Friday, June 6`
- Unchecked rows dimmed/strikethrough
- Toggle calls `PATCH /seasons/:id/weeks/:weekId` with `{ isActive: !current }`
- If response includes `hasRound: true`, show warning icon/text
- Footer: "**17 active rounds** of 19 total Fridays (2 skipped)"
- Warning banner if zero active rounds
- `activeRounds` display updates reactively via query invalidation

### Important Domain Context

- **Start date**: Always a Friday. Typically 2nd week after course aeration.
- **End date**: Always a Friday. Usually last Friday in August, sometimes first Friday in September.
- **Total Fridays matters**: Players need to know the full potential (e.g., "22 possible rounds") even if some get skipped. This is used to plan attendance and understand how many rounds they can participate in.
- **Seasons are created once per year** unless the first week has issues requiring recreation.
- **Playoff rounds are separate** from the regular season calendar (handled by P2.1.2 tee rotation, which is the next story).

### Existing patterns to follow

- **Response shape**: `{ items: [] }` for lists, `{ season: {} }` for single resource
- **Error codes**: `VALIDATION_ERROR`, `NOT_FOUND`, `INTERNAL_ERROR`
- **Auth**: All routes use `adminAuthMiddleware`
- **DB pattern**: `db.insert().values().returning()`, `db.update().set().where().returning()`
- **Transactions**: Use `db.transaction(async (tx) => { ... })` for atomic operations
- **UI pattern**: `useQuery` + `useMutation` + `queryClient.invalidateQueries`
- **Boolean storage**: `0`/`1` integer in SQLite, boolean in Zod/API layer

### Project Structure Notes

- Schema changes: `apps/api/src/db/schema.ts` (add `seasonWeeks` table)
- Route changes: `apps/api/src/routes/admin/season.ts` (modify create, add 2 endpoints)
- Schema changes: `apps/api/src/schemas/season.ts` (add Friday validation to create, add `toggleWeekSchema`)
- UI changes: `apps/web/src/routes/admin/season.tsx` (calendar component, pre-fill playoff format)
- Migration: auto-generated via `pnpm drizzle-kit generate`
- No new packages needed
- No engine changes needed

### References

- [Source: _bmad-output/planning-artifacts/epics-phase2.md — Story P2.1.1]
- [Source: apps/api/src/db/schema.ts — existing table patterns, seasons table structure]
- [Source: apps/api/src/routes/admin/season.ts — existing season API endpoints]
- [Source: apps/api/src/schemas/season.ts — existing Zod validation patterns]
- [Source: apps/web/src/routes/admin/season.tsx — existing season UI components]
- [Source: apps/api/drizzle.config.ts — migration configuration]

### Testing Standards

- Vitest for API tests
- In-memory SQLite (`:memory?cache=shared`) for test DB
- Mock `adminAuthMiddleware` to bypass auth in tests
- **Hard-coded validation test**: April 11, 2026 to August 28, 2026 → exact expected list of Fridays (verify count and specific dates)
- Test: season create with non-Friday dates → rejection
- Test: season create atomically generates weeks
- Test: toggle week updates activeRounds correctly
- Test: toggle all weeks off → warning in response
- Test: toggle week with existing round → hasRound warning
- Test: same Friday start/end → 1 week created
- Test: start after end → rejection

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Hard-coded validation test date corrected: April 11, 2026 is a Saturday, not a Friday. Used April 10, 2026 (verified Friday) instead.
- Migration 0010 generated by drizzle-kit included duplicate DDL from manually-created migrations 0006-0009 (pairing_history, group tee, player handicap_index, round tee). Trimmed to only `season_weeks` CREATE + indexes.
- `createSeasonSchema` updated to remove `totalRounds` from request body (now auto-calculated from Fridays). Existing `updateSeasonSchema` still allows `totalRounds` for direct patching.
- Removed `totalRounds` input from CreateSeasonForm UI — rounds are now auto-calculated.
- Removed `totalRounds` editing from EditSeasonPanel UI — managed by week toggles instead.

### Completion Notes List
- **29 new tests** (23 season API + 6 Friday utility) — all pass
- **Typecheck**: clean (api + web)
- **Lint**: clean
- **Pre-existing test failures** (9 tests in ghin, stats, leaderboard, rounds) — not caused by this story

### File List
- `apps/api/src/db/schema.ts` — added `seasonWeeks` table definition
- `apps/api/src/db/migrations/0010_nasty_forge.sql` — new migration for `season_weeks` table
- `apps/api/src/db/migrations/meta/_journal.json` — updated by drizzle-kit
- `apps/api/src/db/migrations/meta/0010_snapshot.json` — drizzle-kit snapshot for migration 0010
- `apps/api/src/utils/fridays.ts` — new: `getFridaysInRange()` utility
- `apps/api/src/utils/fridays.test.ts` — new: 6 tests for Friday utility
- `apps/api/src/schemas/season.ts` — added Friday validation to `createSeasonSchema`, added `toggleWeekSchema`, removed `totalRounds` from create schema
- `apps/api/src/routes/admin/season.ts` — atomic season+weeks creation, GET weeks, PATCH week toggle (transactional), round protection warning
- `apps/api/src/routes/admin/season.test.ts` — updated existing tests for new API shape, added 13 new tests for weeks endpoints
- `apps/web/src/routes/admin/season.tsx` — `SeasonWeeksCalendar` component with `hasRound`/warning display, pre-filled playoff format, removed totalRounds input, client-side Friday validation

### Change Log
- 2026-03-14: Implemented P2.1.1 — Season Calendar with auto-calculated Fridays, week toggle management, and pre-filled playoff format
- 2026-03-14: Code review fixes — H1: added `hasRound`/warning display in calendar UI; M1: wrapped PATCH toggle in transaction; M2: added snapshot to File List; M3: added re-create season independence test; L1: removed dead try/catch around `getFridaysInRange` (Zod already validates); L2: replaced `toISOString().slice(0,10)` with local-date `toISODate()` helper for timezone safety
