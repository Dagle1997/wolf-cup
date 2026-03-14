# Story P2.2.1: Weekly Attendance Board

Status: done

## Story

As an admin,
I want an attendance page for each scheduled Friday where I can toggle players in/out as responses come in across the week,
so that I can track attendance incrementally without holding it in my head or re-reading GroupMe.

As a player,
I want to see who's confirmed for this week without scrolling through GroupMe,
so that I know the headcount instantly.

## Acceptance Criteria

1. **Given** a season with a calendar of scheduled Fridays (from P2.1) **When** any user navigates to the attendance page **Then** the current or next upcoming Friday is displayed by default with the full league roster **And** each player shows their in/out status **And** the confirmed count is displayed (e.g., "14/16 confirmed")

2. **Given** the attendance page is displayed **When** an admin toggles a player's status to "in" or "out" **Then** the status is persisted immediately **And** the confirmed count updates in real time

3. **Given** a non-admin user views the attendance page **When** they view the roster **Then** they can see all player statuses (read-only) **And** they cannot toggle any checkboxes

4. **Given** the attendance page **When** accessed from the app's main navigation **Then** it is reachable in one tap from the home screen (top-level nav item)

5. **Given** the attendance page is loaded on Android Chrome mobile **When** the admin interacts with player toggles **Then** all controls are functional with 48px+ touch targets and no horizontal scrolling

## Tasks / Subtasks

- [x] Task 1: Add `attendance` table to database schema (AC: #1, #2)
  - [x] Define `attendance` table with unique index on `(seasonWeekId, playerId)`
  - [x] Migration 0012: clean CREATE TABLE + indexes

- [x] Task 2: Public attendance API endpoint (AC: #1, #3)
  - [x] `GET /attendance` — auto-detects current/next active Friday from latest season
  - [x] Returns full active roster with attendance status ('in'|'out'|'unset')
  - [x] Registered as public router (no auth)

- [x] Task 3: Admin attendance toggle endpoint (AC: #2)
  - [x] `PATCH /admin/attendance/:seasonWeekId/players/:playerId` — upsert with `onConflictDoUpdate`
  - [x] Returns `{ status, confirmed, total }`

- [x] Task 4: Admin attendance list by week endpoint (AC: #1, #2)
  - [x] `GET /admin/attendance/:seasonWeekId` — same shape as public, for any week

- [x] Task 5: Auth check endpoint for UI (AC: #3)
  - [x] `GET /admin/auth/check` — lightweight 200/401 check

- [x] Task 6: Attendance page UI (AC: #1, #2, #3, #4, #5)
  - [x] `/attendance` route with auto-detection of current week
  - [x] Silent admin auth check — toggles visible only for admins
  - [x] Color-coded status dots (green=in, red=out, gray=unset)
  - [x] 48px+ touch targets (py-3 on player rows)
  - [x] Week navigation arrows (admin only)
  - [x] Tee display and confirmed count

- [x] Task 7: Add attendance to bottom navigation (AC: #4)
  - [x] 5th tab "Attend" with clipboard emoji, 5-column grid

- [x] Task 8: Tests (AC: #1, #2, #3)
  - [x] 9 tests: GET public, no-season graceful, PATCH upsert create/update, multi-player count, 404 week, 400 invalid status, GET admin week, admin 404

## Dev Notes

### Database Schema

Add to `apps/api/src/db/schema.ts`:

```typescript
export const attendance = sqliteTable(
  'attendance',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seasonWeekId: integer('season_week_id')
      .notNull()
      .references(() => seasonWeeks.id, { onDelete: 'cascade' }),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id),
    status: text('status').notNull(), // 'in' | 'out'
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    weekPlayerUniq: uniqueIndex('uniq_attendance_week_player').on(t.seasonWeekId, t.playerId),
    weekIdx: index('idx_attendance_season_week').on(t.seasonWeekId),
  }),
);
```

Key decisions:
- No "unset" status in DB — absence of a row = unset (saves space, simplifies logic)
- `onDelete: 'cascade'` on seasonWeekId — deleting season weeks cleans up attendance
- Status is 'in' or 'out' — binary, no third state stored
- Add to the cascade delete list in `DELETE /admin/seasons/:id`

### API Architecture

**New file: `apps/api/src/routes/attendance.ts`** — public attendance endpoints
**Additions to: `apps/api/src/routes/admin/attendance.ts`** — admin toggle/view endpoints

**Public `GET /attendance`**:
```typescript
// 1. Find latest season (ORDER BY startDate DESC LIMIT 1)
// 2. Find current/next active Friday (friday >= today, isActive=1, ORDER BY friday ASC LIMIT 1)
//    If no future Friday, show the most recent past active Friday
// 3. Get all active roster players (isActive=1, isGuest=0)
// 4. Left join with attendance table for that seasonWeekId
// 5. Return merged list with status ('in'|'out'|'unset')
```

**Admin `PATCH /admin/attendance/:seasonWeekId/players/:playerId`**:
```typescript
// Upsert using INSERT ... ON CONFLICT UPDATE
await db
  .insert(attendance)
  .values({ seasonWeekId, playerId, status, updatedAt: Date.now() })
  .onConflictDoUpdate({
    target: [attendance.seasonWeekId, attendance.playerId],
    set: { status, updatedAt: Date.now() },
  });
```

### UI Architecture

**Single page at `/attendance`** serves both public and admin views:
- On mount, silently check admin auth (`GET /admin/auth/check`)
- If admin: show toggle checkboxes for each player
- If not admin: show read-only status indicators (green dot = in, gray = out, empty = unset)

**Layout**:
```
┌─────────────────────────────┐
│ Attendance                  │
│ Week 12 — Fri, Jun 19  ◀ ▶ │
│ Blue tees                   │
├─────────────────────────────┤
│ 14/16 confirmed             │
├─────────────────────────────┤
│ ☑ Bonner, Josh       10.2  │ ← 48px+ row height
│ ☑ Dagle, Jason        7.1  │
│ ☐ Jaquint, Mike      15.7  │ ← out (unchecked)
│ ○ Smith, Tom          9.7  │ ← unset (no response)
│ ...                         │
└─────────────────────────────┘
```

### Navigation

**Bottom nav currently has 4 tabs**:
1. Leaderboard (🏆) → `/`
2. Standings (📊) → `/standings`
3. Score (⛳) → `/score-entry`
4. Stats (📈) → `/stats`

**Add 5th tab**:
1. Leaderboard → `/`
2. Standings → `/standings`
3. **Attendance → `/attendance`** (NEW)
4. Score → `/score-entry`
5. Stats → `/stats`

Use `ClipboardList` icon from lucide-react. Label: "Attend" (short for mobile).

### Existing Patterns to Follow

- **Public API pattern**: See `apps/api/src/routes/standings.ts` — no auth, query latest season
- **Admin API pattern**: See `apps/api/src/routes/admin/roster.ts` — adminAuthMiddleware, CRUD
- **Public UI pattern**: See `apps/web/src/routes/standings.tsx` — useQuery, loading/error states
- **Admin toggle pattern**: See season.tsx SeasonWeeksCalendar — checkbox toggle with mutation
- **Response shape**: `{ items: [] }` for lists, single resource for detail
- **Error codes**: `VALIDATION_ERROR`, `NOT_FOUND`, `INTERNAL_ERROR`
- **Touch targets**: 48px+ row height (py-3 on rows with text-sm)
- **Mobile width**: `max-w-2xl mx-auto p-4`

### Date Logic for "Current or Next Friday"

```typescript
function getCurrentOrNextFriday(today: string): string | null {
  // today is ISO YYYY-MM-DD
  // Find first active week with friday >= today
  // If none found (season over), return most recent active week
}
```

Use `new Date().toISOString().slice(0, 10)` for today's date (server-side, UTC is fine for date comparison since Fridays are full days).

### Important: Add to Season Delete Cascade

The new `attendance` table references `seasonWeeks`. The `seasonWeeks.onDelete: 'cascade'` should handle this automatically since attendance has `onDelete: 'cascade'` on the FK. But to be safe, also add explicit deletion in the `DELETE /admin/seasons/:id` handler — delete attendance rows for all season weeks before deleting weeks.

### Project Structure Notes

- New file: `apps/api/src/routes/attendance.ts` (public endpoint)
- New file: `apps/api/src/routes/admin/attendance.ts` (admin endpoints)
- New file: `apps/api/src/routes/attendance.test.ts` (tests)
- New file: `apps/web/src/routes/attendance.tsx` (UI)
- Schema changes: `apps/api/src/db/schema.ts` (add attendance table)
- Route registration: `apps/api/src/index.ts` (add attendance routers)
- Nav changes: `apps/web/src/routes/__root.tsx` (add 5th tab)
- Migration: auto-generated via `pnpm drizzle-kit generate`
- Cascade update: `apps/api/src/routes/admin/season.ts` (add attendance to delete cascade)
- No new packages needed

### References

- [Source: _bmad-output/planning-artifacts/epics-phase2.md — Story P2.2.1, lines 245-284]
- [Source: apps/api/src/db/schema.ts — seasonWeeks, players, rounds tables]
- [Source: apps/api/src/routes/standings.ts — public endpoint pattern, latest season query]
- [Source: apps/api/src/routes/admin/roster.ts — admin CRUD pattern]
- [Source: apps/web/src/routes/__root.tsx — bottom nav structure]
- [Source: apps/web/src/routes/standings.tsx — public page UI pattern]
- [Source: _bmad-output/implementation-artifacts/p2-1-1-season-calendar-auto-calculate-fridays.md — season weeks patterns]

### Testing Standards

- Vitest for API tests
- In-memory SQLite (`:memory?cache=shared`) for test DB
- Mock `adminAuthMiddleware` to bypass auth in admin tests
- Seed: season + weeks + active players for test data
- Test: GET /attendance returns current week with full roster
- Test: PATCH toggle creates and updates attendance
- Test: confirmed count matches 'in' status count
- Test: no season → graceful response
- Test: all unset → confirmed = 0

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Attendance is independent of rounds — new `attendance` table tracks per-week-per-player status before round creation
- Public endpoint auto-detects current/next Friday using `friday >= today` with fallback to most recent active week
- Admin auth check endpoint added to `auth.ts` for silent UI capability detection
- Bottom nav expanded from 4 to 5 columns; "Leaderboard" shortened to "Board" for space
- Season delete cascade updated to include attendance cleanup before seasonWeeks deletion
- Season test afterEach updated with attendance cleanup

### Completion Notes List
- **9 new attendance tests** — all pass (60 total across all story files)
- **Typecheck**: clean (engine + api + web)
- **Lint**: clean

### File List
- `apps/api/src/db/schema.ts` — added `attendance` table
- `apps/api/src/db/migrations/0012_outgoing_lester.sql` — migration for attendance table
- `apps/api/src/db/migrations/meta/_journal.json` — updated by drizzle-kit
- `apps/api/src/db/migrations/meta/0012_snapshot.json` — drizzle-kit snapshot
- `apps/api/src/routes/attendance.ts` — new: public GET /attendance endpoint
- `apps/api/src/routes/admin/attendance.ts` — new: admin GET + PATCH attendance endpoints
- `apps/api/src/routes/attendance.test.ts` — new: 9 tests
- `apps/api/src/routes/admin/auth.ts` — added GET /auth/check endpoint
- `apps/api/src/index.ts` — registered attendance routers
- `apps/api/src/routes/admin/season.ts` — added attendance to delete cascade
- `apps/api/src/routes/admin/season.test.ts` — added attendance to afterEach cleanup
- `apps/web/src/routes/attendance.tsx` — new: attendance page with admin toggle
- `apps/web/src/routes/__root.tsx` — added 5th bottom nav tab "Attend"

### Change Log
- 2026-03-14: Implemented P2.2.1 — Weekly attendance board with public read-only view, admin toggle, auto-detect current week, 5-tab nav
