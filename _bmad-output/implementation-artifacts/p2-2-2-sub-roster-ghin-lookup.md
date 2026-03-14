# Story P2.2.2: Sub Roster & GHIN Lookup

Status: done

## Story

As an admin,
I want to add a sub from the attendance board by searching GHIN, auto-populating their info, and saving them to a season bench,
so that I don't re-enter sub info every time they play and I can quickly see which subs have played the most.

## Acceptance Criteria

1. **Given** an admin is on the attendance board and needs a sub **When** they click "Add Sub" **Then** a form appears with a name text input and a GHIN search button

2. **Given** the admin types a name and triggers GHIN search **When** the search returns results **Then** matching GHIN profiles are displayed (name, GHIN number, handicap index, club) **And** the admin can select the correct match

3. **Given** the admin selects a GHIN match **When** the selection is confirmed **Then** the sub's GHIN number and current handicap index are auto-populated **And** the sub is saved to the season's sub bench **And** the sub is marked as "in" on the current week's attendance board

4. **Given** a sub who has previously played this season **When** the admin clicks "Add Sub" **Then** a dropdown shows existing bench subs with round count (e.g., "Wellman — 3 rounds") **And** selecting a bench sub auto-refreshes their handicap from GHIN **And** the sub is marked as "in" on the current week's attendance board

5. **Given** a sub is on the bench from a previous week **When** their handicap is refreshed from GHIN **Then** the updated handicap index is saved to the player record

## Tasks / Subtasks

- [x] Task 1: Add `sub_bench` table to database schema (AC: #3, #4)
  - [x]Define `sub_bench` table: `id`, `seasonId` (FK seasons), `playerId` (FK players), `roundCount` (default 0), `createdAt`, `updatedAt`
  - [x]Add unique index on `(seasonId, playerId)`
  - [x]Run drizzle-kit generate and verify migration
  - [x]Add `sub_bench` to season delete cascade in `DELETE /admin/seasons/:id`

- [x]Task 2: Sub bench API endpoints (AC: #1, #3, #4)
  - [x]`GET /admin/seasons/:seasonId/subs` — list bench subs with player info and round count
  - [x]`POST /admin/seasons/:seasonId/subs` — add new sub to bench (create player if needed + bench entry + attendance "in")
  - [x]Body: `{ name, ghinNumber?, handicapIndex?, seasonWeekId }` — seasonWeekId for auto-marking "in"
  - [x]`POST /admin/seasons/:seasonId/subs/:subBenchId/add-to-week` — add existing bench sub to week's attendance
  - [x]Body: `{ seasonWeekId }` — marks sub "in", refreshes HI from GHIN if ghinNumber exists

- [x]Task 3: GHIN search is already implemented (AC: #2)
  - [x]Verify `GET /admin/ghin/search?last_name=...&first_name=...` works
  - [x]Reuse existing endpoint from `apps/api/src/routes/admin/ghin.ts`
  - [x]No new API work needed — just wire UI to existing endpoint

- [x]Task 4: Add Sub UI on attendance page (AC: #1, #2, #3, #4, #5)
  - [x]Add "Add Sub" button below player list (admin only)
  - [x]Expandable form: name input + "Search GHIN" button
  - [x]GHIN search results dropdown (name, GHIN#, HI, club)
  - [x]Select result → auto-populate fields → confirm adds to bench + attendance
  - [x]"Returning Sub" dropdown showing bench subs with round count
  - [x]Selecting returning sub auto-refreshes HI and marks "in"

- [x]Task 5: Tests (AC: #1, #2, #3, #4, #5)
  - [x]API: POST new sub creates player + bench entry + attendance
  - [x]API: POST existing bench sub to week marks "in"
  - [x]API: GET bench subs returns list with round count
  - [x]API: Sub appears in attendance list after being added
  - [x]Edge: duplicate sub (same player, same season) → upsert bench entry

## Dev Notes

### Database Schema

Add to `apps/api/src/db/schema.ts`:

```typescript
export const subBench = sqliteTable(
  'sub_bench',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id),
    roundCount: integer('round_count').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    seasonPlayerUniq: uniqueIndex('uniq_sub_bench_season_player').on(t.seasonId, t.playerId),
    seasonIdx: index('idx_sub_bench_season').on(t.seasonId),
  }),
);
```

Key decisions:
- `playerId` FK to `players` — sub exists as a real player record (not guest, isActive=1, isGuest=0)
- `roundCount` tracked on bench — incremented when sub is added to a round (P2.3 story will handle this)
- Season-scoped: unique on `(seasonId, playerId)` — same player can sub in multiple seasons
- Player record stores name, ghinNumber, handicapIndex — no duplication on sub_bench

### API Design

**`GET /admin/seasons/:seasonId/subs`**
```typescript
Response: {
  items: [{
    id: number,           // sub_bench.id
    playerId: number,
    name: string,         // from players table
    ghinNumber: string | null,
    handicapIndex: number | null,
    roundCount: number,
  }]
}
```

**`POST /admin/seasons/:seasonId/subs`** — Add new sub
```typescript
Request: {
  name: string,
  ghinNumber?: string,
  handicapIndex?: number,
  seasonWeekId: number,    // auto-mark "in" on this week
}

// Logic:
// 1. Find or create player (by ghinNumber match or name match)
// 2. Create sub_bench entry (upsert if already exists)
// 3. Create attendance entry with status='in' for seasonWeekId
// 4. Return { sub: SubBenchEntry, player: Player }
```

**`POST /admin/seasons/:seasonId/subs/:subBenchId/add-to-week`** — Return existing bench sub
```typescript
Request: { seasonWeekId: number }

// Logic:
// 1. Look up sub_bench entry → get playerId
// 2. If player has ghinNumber, refresh HI from GHIN API
// 3. Update player.handicapIndex if refreshed
// 4. Create attendance entry with status='in'
// 5. Return { sub, player, handicapRefreshed: boolean }
```

### GHIN Search — Already Implemented

Existing endpoint: `GET /admin/ghin/search?last_name=X&first_name=Y`

Returns:
```typescript
{
  items: [{
    ghinNumber: number,
    firstName: string,
    lastName: string,
    handicapIndex: number | null,
    club: string | null,
    state: string | null,
  }]
}
```

The UI just needs to call this endpoint and display results. Pattern from `apps/web/src/routes/admin/roster.tsx` EditRow component.

### UI Design

Below the player list on the attendance page (admin only):

```
┌──────────────────────────────────────┐
│ + Add Sub                            │
├──────────────────────────────────────┤
│ Returning subs:                      │
│ ┌──────────────────────────────────┐ │
│ │ Wellman — 3 rounds          [+] │ │
│ │ Thompson — 1 round          [+] │ │
│ └──────────────────────────────────┘ │
│                                      │
│ New sub:                             │
│ [Name________________] [Search GHIN] │
│                                      │
│ Search results:                      │
│ ┌──────────────────────────────────┐ │
│ │ Wellman, Tom  #1234567  12.3 HI │ │
│ │ Guyan G&CC, WV              [+] │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

### Player Record Strategy

When adding a new sub:
- Check if player with matching `ghinNumber` already exists → reuse
- If not, check by exact name match → reuse (with warning)
- If no match, create new player record with `isGuest=0, isActive=1`
- The sub is a real roster player who happens to be subbing this season

### Existing Patterns

- **GHIN search UI**: `apps/web/src/routes/admin/roster.tsx` lines ~200-300 (EditRow with search results dropdown)
- **Admin CRUD pattern**: `apps/api/src/routes/admin/roster.ts`
- **Attendance toggle**: `apps/api/src/routes/admin/attendance.ts`
- **Player creation**: `apps/api/src/routes/admin/roster.ts` POST /players
- **onConflictDoUpdate**: Used in attendance PATCH for upsert pattern

### Season Delete Cascade

Add `sub_bench` deletion after `pairingHistory`:
```typescript
await tx.delete(subBench).where(eq(subBench.seasonId, id));
```

### Project Structure Notes

- Schema: `apps/api/src/db/schema.ts` (add subBench table)
- Routes: `apps/api/src/routes/admin/attendance.ts` (add sub endpoints — keep attendance-related)
- Tests: `apps/api/src/routes/attendance.test.ts` (add sub tests)
- UI: `apps/web/src/routes/attendance.tsx` (add sub section)
- Cascade: `apps/api/src/routes/admin/season.ts` (add subBench to delete)
- Cascade test: `apps/api/src/routes/admin/season.test.ts` (add subBench to afterEach)
- Migration: auto-generated

### References

- [Source: _bmad-output/planning-artifacts/epics-phase2.md — Story P2.2.2]
- [Source: apps/api/src/routes/admin/ghin.ts — existing GHIN search endpoint]
- [Source: apps/api/src/lib/ghin-client.ts — GHIN API client]
- [Source: apps/web/src/routes/admin/roster.tsx — GHIN search UI pattern]
- [Source: apps/api/src/routes/admin/attendance.ts — attendance endpoints]
- [Source: apps/web/src/routes/attendance.tsx — attendance page UI]

### Testing Standards

- Vitest, in-memory SQLite, mock adminAuthMiddleware
- Mock GHIN client for HI refresh tests (or skip GHIN integration tests since GHIN env vars aren't set in test)
- Test: create new sub → player + bench + attendance created
- Test: add existing bench sub to new week → attendance created
- Test: GET bench subs returns correct list
- Test: duplicate sub bench entry → upsert

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Sub bench uses `playerId` FK to players table — subs are real player records, not separate entities
- Player lookup by ghinNumber for deduplication; creates new player if no match
- Upsert pattern on both sub_bench and attendance for idempotent adds
- `exactOptionalPropertyTypes` in web tsconfig required explicit undefined handling for optional props

### Completion Notes List
- **13 attendance tests** (9 original + 4 new sub bench) — all pass
- **35 season tests** — all pass (with sub_bench in cascade + cleanup)
- **Typecheck**: clean (engine + api + web)
- **Lint**: clean

### File List
- `apps/api/src/db/schema.ts` — added `subBench` table
- `apps/api/src/db/migrations/0013_late_rogue.sql` — migration for sub_bench
- `apps/api/src/db/migrations/meta/_journal.json` — updated
- `apps/api/src/db/migrations/meta/0013_snapshot.json` — drizzle-kit snapshot
- `apps/api/src/routes/admin/attendance.ts` — added GET/POST subs endpoints, add-to-week
- `apps/api/src/routes/attendance.test.ts` — 4 new sub bench tests
- `apps/api/src/routes/admin/season.ts` — added subBench to delete cascade
- `apps/api/src/routes/admin/season.test.ts` — added subBench to afterEach cleanup
- `apps/web/src/routes/attendance.tsx` — AddSubSection component with GHIN search + bench subs

### Change Log
- 2026-03-14: Implemented P2.2.2 — Sub bench with GHIN lookup, returning sub dropdown, auto-attendance marking
