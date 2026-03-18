---
title: 'Champions & Historical Standings Page'
slug: 'champions-historical-standings'
created: '2026-03-17'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack: [typescript, vitest, hono, drizzle, libsql, react, tanstack-router, tanstack-query, tailwindcss, zod]
files_to_modify:
  - apps/api/src/db/schema.ts
  - apps/api/src/db/migrations/ (auto-generated + custom for year backfill)
  - apps/api/src/schemas/history.ts (new)
  - apps/api/src/schemas/season.ts (update — add year field)
  - apps/api/src/routes/history.ts (new)
  - apps/api/src/routes/admin/history.ts (new)
  - apps/api/src/routes/history.test.ts (new)
  - apps/api/src/index.ts
  - apps/api/src/db/seed.ts
  - apps/api/src/db/history-data.ts (new — typed historical data arrays)
  - apps/web/src/routes/standings.tsx
  - apps/web/src/routes/standings.history.tsx (new)
  - apps/web/src/routes/stats.tsx
code_patterns:
  - Drizzle ORM with libsql, FK via .references(() => table.id)
  - Migrations auto-generated via pnpm -C apps/api db:generate
  - Admin routes use adminAuthMiddleware, Zod safeParse, standard error codes
  - TanStack Router file-based routing, dot notation for sibling routes
  - Public routes no auth, admin routes session-cookie auth
  - apiFetch<T> helper with TanStack Query
test_patterns:
  - API tests use in-memory SQLite with mocked db module
  - Zod schemas tested via safeParse
  - Existing season.test.ts for reference
---

# Tech-Spec: Champions & Historical Standings Page

**Created:** 2026-03-17

## Overview

### Problem Statement

The Wolf Cup app has no historical context. No champion recognition, no way to browse prior seasons, no sense of the league's history dating back to ~2015. Players and champions from prior years deserve recognition — and current-season stat cards should reflect career achievements like championship wins.

### Solution

Extend the existing `seasons` table with `championPlayerId`, add a `seasonStandings` table, build admin endpoints for incremental data entry, a public history page with champions gallery and season standings, and display championship badges on the current-season stats page.

### Scope

**In Scope:**
- Extend `seasons` table with `championPlayerId` (nullable FK → players)
- New `seasonStandings` table (seasonId, playerId, rank, points — extensible)
- Admin endpoints: create historical season, set champion, upsert standings
- Public API: `GET /history` returning all seasons with champions + standings + win counts
- `/standings/history` route: champions gallery with win count badges + per-season standings
- Trophy banner on `/standings` page linking to history
- Championship badges on current `/stats` page cards (e.g., "4×🏆" next to Preston's name)
- Seed known historical data (2015–2025 champions + available standings)
- Champion photos from static files with graceful fallback

**Out of Scope:**
- Per-round historical breakdown (future spec)
- Per-hole stats and geek view (future spec — see `project_future_stats_vision.md`)
- Playoff elimination math (future spec — killer feature, needs own design)
- Full badge/achievement system beyond championship count (future spec — see `project_badge_achievements.md`)
- Admin UI for history management (API-only for now)
- Seasons before 2015 (until Jason provides data)

## Context for Development

### Codebase Patterns

**Existing `seasons` table (`apps/api/src/db/schema.ts` line 46):**
```typescript
export const seasons = sqliteTable('seasons', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  totalRounds: integer('total_rounds').notNull(),
  playoffFormat: text('playoff_format').notNull(),
  harveyLiveEnabled: integer('harvey_live_enabled').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});
```
- Need to add: `year` (integer, not null) and `championPlayerId` (nullable FK → players)
- `year` is the natural key everyone thinks in — "the 2023 season" — avoids parsing from fake start dates
- Historical seasons (2015–2025) created with minimal fields (year, name, approximate dates, totalRounds=0 for unknown)

**Migration pattern:** Modify `schema.ts`, run `pnpm -C apps/api db:generate` → auto-generates `.sql`

**Admin route pattern:** Hono + `adminAuthMiddleware` + Zod safeParse + standard error codes

**TanStack Router:** The current `standings.tsx` is a **leaf route, not a layout route** (no `<Outlet />`). To add `/standings/history` as a sibling, you must either: (a) convert `standings.tsx` into a layout route with `<Outlet />` and move current content to `standings/index.tsx`, or (b) use a **pathless layout** or **flat route naming**. **Recommended approach (b):** Name the file `standings_.history.tsx` (with underscore) or simply `history.tsx` at root level with `createFileRoute('/standings/history')`. Check TanStack Router docs for the exact flat route file naming convention. The dev agent MUST verify this works by checking `routeTree.gen.ts` after creating the file.

**Stats page (`apps/web/src/routes/stats.tsx`):** Player cards with name in header. Championship badge goes after player name span: `<span className="font-semibold">{p.name}</span>` in `flex items-center gap-2.5` container.

**Standings page (`apps/web/src/routes/standings.tsx`):** Header section with title + refresh button. Trophy banner goes here.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `apps/api/src/db/schema.ts` | Existing `seasons` + `players` tables |
| `apps/api/src/db/seed.ts` | Seed pattern (idempotent upsert) |
| `apps/api/src/middleware/admin-auth.ts` | `adminAuthMiddleware` |
| `apps/api/src/schemas/admin.ts` | Zod schema pattern |
| `apps/api/src/routes/admin/season.ts` | Existing season admin routes |
| `apps/api/src/routes/stats.ts` | Stats endpoint — add champion win counts here |
| `apps/api/src/index.ts` | Route mounting |
| `apps/web/src/routes/standings.tsx` | Add trophy banner |
| `apps/web/src/routes/stats.tsx` | Add championship badges to player cards |
| `apps/web/src/lib/api.ts` | `apiFetch` helper |

### Technical Decisions

- **Extend existing `seasons` table** — historical seasons are seasons. They just don't have rounds/weeks.
- **Add `year` integer column** — the natural key everyone thinks in. Unique index. Avoids parsing from fake start dates.
- **`championPlayerId` is nullable** — current season won't have a champion until playoffs end.
- **`seasonStandings` designed for extensibility** — `rank` (required) + `points` (nullable). Future columns: `stablefordTotal`, `moneyTotal`, `roundsPlayed` can be added without redesign.
- **Championship win counts come from the DB** — count seasons where `championPlayerId = playerId`. Returned as part of stats response so badges display on current season stat cards without a separate API call.
- **Historical data in separate typed file** (`history-data.ts`) — clean separation from seed logic, easy to update when Jason delivers more data.
- **True upsert for standings** — `onConflictDoUpdate` on `(seasonId, playerId)`, same pattern used in `attendance.ts` and `rounds.ts`. Allows adding individual players without wiping existing data.
- **Static photos** in `/public/champions/{year}.jpg` — frontend `onError` fallback to initials/trophy placeholder.
- **Historical players** use existing `players` table with `isActive: 0`. Copley already exists. Others added as needed.
- **Champion card design:** Win count is the hero number (×4 🏆), confirmed years listed below. The DB count is authoritative.
- **FK constraint protects champions** — default `onDelete: no action` means you can't delete a player who is a champion. This is correct behavior.
- **Information architecture designed for progressive depth:**
  ```
  /standings → /standings/history (THIS SPEC)
  /stats → /stats/player/:id (future: career + per-hole)
  /playoffs (future: elimination math)
  ```

## Implementation Plan

### Tasks

#### Part A: Database Schema

- [ ] Task 1: Add `year` and `championPlayerId` to `seasons` table
  - File: `apps/api/src/db/schema.ts`
  - Action: Add two columns to existing `seasons` table definition:
    ```typescript
    year: integer('year').notNull().default(0),
    championPlayerId: integer('champion_player_id').references(() => players.id),
    ```
    Add `year` after `name`, `championPlayerId` after `harveyLiveEnabled`. Also add a unique index on `year`:
    ```typescript
    (t) => [uniqueIndex('uniq_seasons_year').on(t.year)]
    ```
  - Notes: **SQLite cannot ADD NOT NULL column without a default to existing rows.** Use `.default(0)` so the auto-generated migration succeeds. Then write a **custom SQL statement** appended to the migration file (or a separate migration) to backfill: `UPDATE seasons SET year = CAST(SUBSTR(start_date, 1, 4) AS INTEGER) WHERE year = 0;`. This sets the existing 2026 row's year from its `start_date`. The `.default(0)` is only for migration safety — application code should always provide `year` explicitly.

- [ ] Task 1b: Update existing season creation to include `year`
  - File: `apps/api/src/schemas/season.ts`
  - Action: Add `year: z.number().int().min(2014).max(2100)` to the existing `createSeasonSchema`. Update `apps/api/src/routes/admin/season.ts` to include `year` in the `INSERT` values when creating a season.
  - Notes: Without this, the existing `POST /admin/seasons` endpoint will fail after the schema change because it never provides a `year` value. This is a **required companion change** to Task 1.

- [ ] Task 2: Create `seasonStandings` table
  - File: `apps/api/src/db/schema.ts`
  - Action: Add new table after `seasons`:
    ```typescript
    export const seasonStandings = sqliteTable(
      'season_standings',
      {
        id: integer('id').primaryKey({ autoIncrement: true }),
        seasonId: integer('season_id')
          .notNull()
          .references(() => seasons.id, { onDelete: 'cascade' }),
        playerId: integer('player_id')
          .notNull()
          .references(() => players.id),
        rank: integer('rank').notNull(),
        points: real('points'), // nullable — some historical years have rank only, no points
        createdAt: integer('created_at').notNull(),
      },
      (t) => [
        uniqueIndex('uniq_season_standings_season_player').on(t.seasonId, t.playerId),
        index('idx_season_standings_season').on(t.seasonId),
      ],
    );
    ```
  - Notes: `points` is `real` (not integer) because Harvey points can be decimals (e.g., 285.5). Unique constraint prevents duplicate player entries per season. Cascade delete if a season is removed.

- [ ] Task 3: Generate and verify migration
  - Action: Run `pnpm -C apps/api db:generate`. Verify the generated SQL adds the column and creates the table correctly. Check that existing season data is preserved.
  - Notes: The migration should produce an ALTER TABLE for `seasons` and a CREATE TABLE for `season_standings`.

#### Part B: API — Zod Schemas

- [ ] Task 4: Create history Zod schemas
  - File: `apps/api/src/schemas/history.ts` (new)
  - Action: Create validation schemas:
    ```typescript
    import { z } from 'zod';

    export const createHistoricalSeasonSchema = z.object({
      year: z.number().int().min(2014).max(2100),  // REQUIRED — natural key
      name: z.string().min(1),           // e.g., "2023 Season"
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      totalRounds: z.number().int().min(0).default(0),
      playoffFormat: z.string().default('top8'),
      championPlayerId: z.number().int().positive().optional(),
    });

    export const setChampionSchema = z.object({
      championPlayerId: z.number().int().positive(),
    });

    export const upsertStandingsSchema = z.object({
      standings: z.array(z.object({
        playerId: z.number().int().positive(),
        rank: z.number().int().positive(),
        points: z.number().optional(),    // nullable for rank-only data
      })).min(1),
    });
    ```

#### Part C: API — Admin Endpoints

- [ ] Task 5: Create admin history routes
  - File: `apps/api/src/routes/admin/history.ts` (new)
  - Action: Create Hono app with three endpoints:
    - `POST /` — Create a historical season. Validate with `createHistoricalSeasonSchema`. Insert into `seasons` table. If `championPlayerId` provided, set it. Return `{ id, name }`.
    - `PATCH /:seasonId/champion` — Set champion for existing season. Validate with `setChampionSchema`. Verify season and player exist. Update `seasons.championPlayerId`. Return `{ success: true }`.
    - `PUT /:seasonId/standings` — Upsert standings for a season. Validate with `upsertStandingsSchema`. For each entry: use Drizzle `onConflictDoUpdate` on unique `(seasonId, playerId)` to update rank + points. Verify season exists. Return `{ success: true, count: N }`.
  - Notes: All endpoints use `adminAuthMiddleware`. Standard error handling pattern from `season.ts`. True upsert via `onConflictDoUpdate` (same pattern as `pairingHistory` in the codebase) — allows adding individual players to a season's standings without wiping existing data.

- [ ] Task 6: Mount admin history routes
  - File: `apps/api/src/index.ts`
  - Action: Import and mount. **Check `index.ts` for the correct prefix pattern** — existing admin routes are mounted under `/api/admin` (e.g., `app.route('/api/admin/seasons', ...)`). Mount as: `app.route('/api/admin/history', historyAdminRoutes)`.
  - Notes: The `apiFetch` helper on the frontend prepends `/api`, so public routes must also be under `/api`. Verify the exact mounting pattern in `index.ts` before implementing.

#### Part D: API — Public Endpoint

- [ ] Task 7: Create public history endpoint
  - File: `apps/api/src/routes/history.ts` (new)
  - Action: Create `GET /history` endpoint (no auth). Query:
    1. All seasons ordered by `year` DESC
    2. For each season with `championPlayerId`, join `players` to get champion name
    3. All `seasonStandings` joined with `players` for names, ordered by rank ASC
    4. Compute `championshipCounts`: count of seasons won per player (for badge display)

    Response shape:
    ```typescript
    {
      seasons: {
        id: number;
        name: string;
        year: number;          // from seasons.year column
        champion: { playerId: number; name: string; wins: number } | null;
        standings: { playerId: number; name: string; rank: number; points: number | null }[];
      }[];
      championshipCounts: { playerId: number; name: string; wins: number }[];
    }
    ```
  - Notes: `championshipCounts` is a top-level field so the stats page can use it for badges without fetching the full history. The `wins` field on each champion is denormalized for convenience. `year` comes directly from the `seasons.year` column.

- [ ] Task 8: Mount public history route
  - File: `apps/api/src/index.ts`
  - Action: Import and mount under the API prefix: `app.route('/api/history', historyRoutes)`. Verify the exact prefix pattern in `index.ts` — all routes must be accessible via the frontend's `apiFetch('/history')` which prepends `/api`.

#### Part E: Stats Page — Championship Badges

- [ ] Task 9: Add championship badges to stats endpoint
  - File: `apps/api/src/routes/stats.ts`
  - Action: Add a query to count championship wins per player:
    ```typescript
    const champCounts = await db
      .select({ playerId: seasons.championPlayerId, wins: count() })
      .from(seasons)
      .where(isNotNull(seasons.championPlayerId))
      .groupBy(seasons.championPlayerId);
    ```
    Add optional `championshipWins` field to `PlayerStats` response. Only include when wins > 0.
  - Notes: Small addition — one extra query, one optional field. Import `count`, `isNotNull` from drizzle-orm. **`stats.test.ts` DOES exist** at `apps/api/src/routes/stats.test.ts` — add test cases for the championship wins query there. Test: player with wins returns `championshipWins: N`, player without wins has no field.

- [ ] Task 10: Display championship badges on stats cards
  - File: `apps/web/src/routes/stats.tsx`
  - Action: Update `PlayerStats` type to include `championshipWins?: number`. In `PlayerCard` header, after player name, conditionally render badge:
    ```tsx
    {p.championshipWins && (
      <span className="text-xs font-bold text-amber-600" title={`${p.championshipWins}× Wolf Cup Champion`}>
        {p.championshipWins}×🏆
      </span>
    )}
    ```
  - Notes: Small gold text badge. Tooltip on hover shows full text. Only renders when player has wins.

#### Part F: Standings Page — Trophy Banner + History Page

- [ ] Task 11: Add trophy banner to standings page
  - File: `apps/web/src/routes/standings.tsx`
  - Action: Add a banner in the header section (before the title) linking to history. Use TanStack Router `Link`:
    ```tsx
    <Link
      to="/standings/history"
      className="flex items-center justify-between px-4 py-2 mb-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 group"
    >
      <span className="text-sm font-semibold text-amber-800 dark:text-amber-200">
        🏆 Champions & History
      </span>
      <span className="text-xs text-amber-600 dark:text-amber-400 group-hover:translate-x-0.5 transition-transform">→</span>
    </Link>
    ```
  - Notes: Warm amber colors match trophy/gold theme. Dark mode variant included. Positioned above the season standings title. **Add `Link` to the imports** from `@tanstack/react-router` (not currently imported in `standings.tsx`).

- [ ] Task 12: Create history page
  - File: `apps/web/src/routes/standings.history.tsx` (new)
  - Action: Create route with `createFileRoute('/standings/history')`. Fetch data via `useQuery({ queryKey: ['history'], queryFn: () => apiFetch<HistoryResponse>('/history') })`. Layout:

    **Section 1: Champions Gallery**
    - Horizontal scroll container of champion cards
    - Each card layout: photo (or fallback) at top, player name below, **win count as hero number** ("×4 🏆" large), list of confirmed winning years below in small text
    - Sorted by most wins DESC, then most recent win
    - Photo: `<img src="/champions/{year}.jpg" onError={fallback} />` — fallback to initials circle with trophy emoji
    - Win count is the visual hero — the number people screenshot
    - Only show confirmed years (don't guess — the DB win count is authoritative)

    **Section 2: Season History**
    - Reverse chronological list of seasons
    - Each season: collapsible/expandable card
    - Header: year, champion name + photo thumbnail, "🏆 Champion" label
    - Expanded: standings table (rank, name, points) — same style as standings page table
    - Seasons with no standings show "Champion only" with just the champion card

    **Back navigation:** Back arrow or "← Standings" link at top

  - Notes: Mobile-first. Horizontal scroll for gallery uses `overflow-x-auto flex gap-3`. Season cards use `useState` toggle for expand/collapse (not `<details>` — better animation control + React hydration). Default: most recent season expanded, rest collapsed. Page container: `p-4 max-w-2xl mx-auto` (matches other pages).

#### Part G: Seed Historical Data

- [ ] Task 13a: Create historical data file
  - File: `apps/api/src/db/history-data.ts` (new)
  - Action: Create typed data arrays for all known historical data:
    ```typescript
    export const HISTORICAL_CHAMPIONS: { year: number; playerName: string }[] = [
      { year: 2025, playerName: 'Matt Jaquint' },
      { year: 2024, playerName: 'Ronnie Adkins' },
      { year: 2023, playerName: 'Nathan Copley' },
      { year: 2022, playerName: 'Chris Preston' },
      { year: 2021, playerName: 'Jeff Madden' },
      { year: 2020, playerName: 'Chris Preston' },
      { year: 2019, playerName: 'Chris McNeely' },
      { year: 2018, playerName: 'Chris Preston' },
      { year: 2016, playerName: 'Jason Moses' },
      { year: 2015, playerName: 'Matt Jaquint' },
      // 2017: TBD — skip until Josh/Jason confirm
    ];

    export const HISTORICAL_STANDINGS: {
      year: number;
      standings: { name: string; rank: number; points?: number }[];
    }[] = [
      { year: 2023, standings: [
        { name: 'Ronnie Adkins', rank: 1, points: 285.5 },
        { name: 'Nathan Copley', rank: 2, points: 273.5 },
        // ... full 19 players
      ]},
      // 2021: full standings from Excel
      // 2025: from season-standings.json
      // 2015–2020: partial ranks, no points
    ];

    export const HISTORICAL_PLAYERS: string[] = [
      // Players that may need to be added with isActive: 0
      'Nathan Copley', 'A. Dawson', 'Alan Beasley',
      'Chris Keaton', 'Sean Wilson', // etc.
    ];
    ```
  - Notes: Separate file keeps seed.ts clean. Easy to update when Jason delivers more data. All data from this conversation's Excel parsing is captured here. See "Available Historical Data" section for complete data.

- [ ] Task 13b: Add history seed function
  - File: `apps/api/src/db/seed.ts`
  - Action: Import from `history-data.ts`. Add `seedHistory()` function:
    1. Ensure historical players exist (upsert with `isActive: 0` for missing ones)
    2. Create seasons for each year (upsert by `year` — skip if exists)
    3. Set `championPlayerId` by looking up player by name
    4. Upsert standings using `onConflictDoUpdate`
    Call `seedHistory()` from existing seed flow.
  - Notes: Idempotent — safe to run multiple times. Uses upsert patterns throughout. The existing `seed.ts` is a monolithic `main()` that only seeds admins — add `seedHistory()` as a separate async function called from `main()` after admin seeding. Use `db.select().from(seasons).where(eq(seasons.year, year)).get()` to check existence before insert (the existing seed pattern uses manual checks, not `onConflictDoUpdate`).

#### Part H: API Tests

- [ ] Task 14: Create history API tests
  - File: `apps/api/src/routes/history.test.ts` (new)
  - Action: Create test file with in-memory SQLite. Test cases:
    - `GET /history` returns empty seasons array when none exist
    - `GET /history` returns seasons ordered by year DESC
    - `GET /history` includes champion name and win count
    - `GET /history` includes standings ordered by rank ASC
    - `GET /history` returns `championshipCounts` with correct win tallies
    - Season with no champion returns `champion: null`
    - Season with no standings returns empty `standings: []`
    - `POST /admin/history` creates a historical season (requires auth)
    - `PATCH /admin/history/:id/champion` sets champion (requires auth)
    - `PUT /admin/history/:id/standings` upserts standings (requires auth)
    - All admin endpoints return 401 without session cookie
    - Validation errors return 400 with `VALIDATION_ERROR` code

### Acceptance Criteria

#### Database
- [ ] AC 1: Given the existing `seasons` table, when migration runs, then `champion_player_id` column is added as nullable integer with FK to `players.id`.
- [ ] AC 1b: Given the existing 2026 season row, when migration runs, then the row's `year` column is backfilled to 2026 (from `start_date`) and the row is fully intact.
- [ ] AC 2: Given the new schema, when `seasonStandings` table is created, then it has columns `id`, `season_id` (FK), `player_id` (FK), `rank` (int, not null), `points` (real, nullable), `created_at`, with unique constraint on `(season_id, player_id)`.

#### Admin API
- [ ] AC 3: Given an authenticated admin, when POST `/admin/history` with valid season data, then a new season is created and `{ id, name }` is returned.
- [ ] AC 4: Given an authenticated admin, when PATCH `/admin/history/:id/champion` with valid playerId, then the season's `championPlayerId` is updated.
- [ ] AC 5: Given an authenticated admin, when PUT `/admin/history/:id/standings` with an array of `{ playerId, rank, points? }`, then standings are upserted for that season.
- [ ] AC 6: Given an unauthenticated request to any admin history endpoint, then 401 is returned.
- [ ] AC 7: Given invalid request body, when any admin history endpoint is called, then 400 with `VALIDATION_ERROR` is returned.

#### Public API
- [ ] AC 8: Given seasons with champions and standings in the database, when `GET /history` is called, then all seasons are returned ordered by year DESC with champion info, standings, and championship counts.
- [ ] AC 9: Given a player who has won 4 seasons, when `GET /history` is called, then `championshipCounts` includes that player with `wins: 4`.
- [ ] AC 10: Given a season with no standings data, when `GET /history` is called, then that season's `standings` is an empty array and `champion` is still populated.

#### Stats Page Badges
- [ ] AC 11: Given a player with 4 championship wins, when the stats page loads, then "4×🏆" badge appears next to their name.
- [ ] AC 12: Given a player with 0 championship wins, when the stats page loads, then no championship badge is shown.

#### Standings + History Page
- [ ] AC 13: Given the standings page, when it loads, then a trophy banner "🏆 Champions & History" links to `/standings/history`.
- [ ] AC 14: Given the history page, when it loads, then a champions gallery shows all champions with win count badges, sorted by most wins.
- [ ] AC 15: Given the history page with 2023 season data, when user expands the 2023 season, then standings show Ronnie A. (285.5), Copley (273.5), Preston (270), etc.
- [ ] AC 16: Given a champion photo exists at `/champions/2023.jpg`, when the history page loads, then the photo displays for the 2023 champion. Given no photo exists for 2021, then a fallback placeholder is shown.
- [ ] AC 17: Given the history page on mobile, when viewing the champions gallery, then it is horizontally scrollable.

#### Seed Data
- [ ] AC 18: Given a fresh database, when `seed` runs, then historical seasons (2015–2025) are created with correct champions and available standings data.
- [ ] AC 19: Given seed has already run, when seed runs again, then no duplicate seasons or standings are created (idempotent).

## Additional Context

### Dependencies

- Existing `seasons` and `players` tables
- Drizzle migration toolchain (`pnpm -C apps/api db:generate`)
- TanStack Router route generation (auto on dev server start)
- No new npm packages required

### Testing Strategy

- **API integration tests** (`history.test.ts`): In-memory SQLite via `@libsql/client` with `file::memory:?cache=shared` (NOT `better-sqlite3` — match existing test driver pattern). Seed test data, verify all endpoints + response shapes + auth + validation.
- **Stats badge tests** (`stats.test.ts` — file EXISTS): Add championship wins test cases to the existing test file.
- **Existing test regression**: Run full test suite — seasons table change could affect `season.test.ts` (existing create endpoint needs `year` field now).
- **Manual testing**: Load `/standings/history`, verify gallery rendering, season expand/collapse, photo fallback, back navigation, dark mode
- **Seed verification**: Run seed against fresh DB and verify data matches expected champions/standings

### Notes

- **Information architecture for future specs:**
  ```
  /standings → /standings/history (THIS SPEC)
  /stats → /stats/player/:id (future: career + per-hole deep stats)
  /stats with "geek view" toggle (future: detailed analytics)
  /playoffs (future: elimination math — the killer feature)
  ```
- **Future badge/achievement system** (separate spec): pH Balance Award (3rd place streak), most runner-up finishes, most birdies in season, lowest net-to-par in history, etc. Championship badges from this spec are the first step.
- **Preston has won 4 times** per Josh (2018, 2020, 2022 + one more TBD — only 3 confirmed in seed data so far). Jaquint has won twice (2015, 2025). The DB count is authoritative — badge will show 3× until the 4th is confirmed and seeded. AC 11 should test with actual seeded count, not assumed 4.
- **2017 champion unknown** — seed skips champion for that year until Josh/Jason confirm.
- **Copley is inactive** (2 kids, plans to return) — `isActive: 0` in players table. Still shows as 2023 champion.
- **Champion photos:** Portrait orientation, `/public/champions/{year}.jpg`. Josh will add these when available.
- **The playoff elimination math** Josh described (Copley needing 1st in both, Ronnie needing 4th+3rd) is a future killer feature. The season/standings data model from this spec is a prerequisite.

### Available Historical Data (for seed)

**Full standings with points:**

*2023 (from Auto-Printable):*
1. Ronnie A. 285.5, 2. Copley 273.5, 3. Preston 270, 4. McNeely 269, 5. Jaquint 268, 6. Stoll 263.5, 7. Moses 255, 8. Pierson 252.5, 9. McGinnis 244, 10. Biederman 239, 11. Bonner 232, 12. Madden 231.5, 13. Dawson 215.5, 14. Cox 199, 15. White 198.5, 16. Wilson 132, 17. Keaton 131, 18. Patterson 111.5, 19. Beasley 32.5

*2021 + 2025:* Extract from Excel / existing fixtures.

**Partial ranks (no points) from Stats sheet:**

| Player | 2020 | 2019 | 2018 | 2017 | 2016 | 2015 |
|--------|------|------|------|------|------|------|
| Madden | 7 | 6 | 2 | 8 | 5 | - |
| Moses | - | 3 | 7 | 7 | 1 | 2 |
| Patterson | 4 | 2 | 5 | 6 | - | - |
| Preston | 1 | 5 | 1 | 1 | 4 | 5 |
| Ronnie | 5 | - | 6 | - | - | - |
| McNeely | - | 1 | - | - | 8 | 7 |
| Wilson | 2 | 7 | - | - | - | - |
| Cox | 8 | - | - | - | - | - |
| Bonner | - | - | - | - | - | - |
| Stoll | 6 | 4 | 4 | - | - | 8 |
| Dawson | 3 | - | - | 3 | - | - |
| Copley | - | - | - | - | - | - |
| White | - | - | - | 4 | 3 | 3 |
| Keaton | - | - | 3 | - | - | 6 |
| Jaquint | - | - | 8 | 2 | 2 | 1 |
| Pierson | - | - | - | - | - | - |
| McGinnis | - | - | - | - | - | - |
