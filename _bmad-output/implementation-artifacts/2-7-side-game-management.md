# Story 2.7: Side Game Management

Status: done

## Story

As an admin (Jason or Josh),
I want to configure side games for the season and record side game results per round,
so that weekly side competitions (e.g., closest to pin, longest drive) are tracked and winners recognized.

## Acceptance Criteria

### Side Game CRUD — FR48

1. `POST /api/admin/seasons/:seasonId/side-games` (protected by `adminAuthMiddleware`) accepts `{ name: string, format: string, scheduledRoundIds?: number[] }`; returns `{ sideGame: { id, seasonId, name, format, scheduledRoundIds: number[] } }` HTTP 201.

2. When `scheduledRoundIds` is provided, the value is serialized as a JSON string in `side_games.scheduled_round_ids`; when omitted, the field is stored as `null`. The API always returns `scheduledRoundIds` as a parsed array (empty `[]` when null).

3. `POST /api/admin/seasons/:seasonId/side-games` returns `{ error: 'Season not found', code: 'NOT_FOUND' }` HTTP 404 when the season does not exist.

4. `POST /api/admin/seasons/:seasonId/side-games` returns `{ error: 'Validation error', code: 'VALIDATION_ERROR', issues: [...] }` HTTP 400 when `name` or `format` is missing.

5. `GET /api/admin/seasons/:seasonId/side-games` returns `{ items: [{ id, seasonId, name, format, scheduledRoundIds: number[] }] }` HTTP 200 with all side games for the season; `scheduledRoundIds` is always a parsed array. Returns 404 NOT_FOUND when season does not exist.

6. `PATCH /api/admin/side-games/:id` (protected by `adminAuthMiddleware`) accepts `{ name?: string, format?: string, scheduledRoundIds?: number[] }` (at least one field required); returns `{ sideGame: { id, seasonId, name, format, scheduledRoundIds: number[] } }` HTTP 200.

7. `PATCH /api/admin/side-games/:id` returns 404 NOT_FOUND when the side game does not exist.

8. `PATCH /api/admin/side-games/:id` returns 400 VALIDATION_ERROR when body is empty.

### Side Game Results — FR49, FR56

9. `POST /api/admin/rounds/:roundId/side-game-results` (protected by `adminAuthMiddleware`) accepts `{ sideGameId: number, winnerPlayerId?: number, winnerName?: string, notes?: string }` — at least one of `winnerPlayerId` or `winnerName` required; returns `{ result: { id, sideGameId, roundId, winnerPlayerId, winnerName, notes } }` HTTP 201.

10. `POST /api/admin/rounds/:roundId/side-game-results` returns 404 NOT_FOUND when the round does not exist.

11. `POST /api/admin/rounds/:roundId/side-game-results` returns 404 NOT_FOUND when `sideGameId` does not reference an existing side game.

12. `POST /api/admin/rounds/:roundId/side-game-results` returns 404 NOT_FOUND when `winnerPlayerId` is provided but the player does not exist.

13. `POST /api/admin/rounds/:roundId/side-game-results` returns 400 VALIDATION_ERROR when neither `winnerPlayerId` nor `winnerName` is provided.

14. `GET /api/admin/rounds/:roundId/side-game-results` returns `{ items: [...] }` HTTP 200 with all results for the round. Returns 404 NOT_FOUND when round does not exist.

### Schema & Infrastructure

15. `apps/api/src/schemas/side-game.ts` exports:
    - `createSideGameSchema`: `z.object({ name: z.string().min(1), format: z.string().min(1), scheduledRoundIds: z.array(z.number().int().positive()).optional() })`
    - `updateSideGameSchema`: same fields optional + `.refine(at least one field)`
    - `createSideGameResultSchema`: `z.object({ sideGameId: z.number().int().positive(), winnerPlayerId: z.number().int().positive().optional(), winnerName: z.string().min(1).optional(), notes: z.string().optional() })` + `.refine(winnerPlayerId or winnerName required)`

16. `apps/api/src/index.ts` imports and mounts `adminSideGamesRouter` at `/api/admin`.

17. `pnpm --filter @wolf-cup/api typecheck` passes with zero errors.

18. `pnpm --filter @wolf-cup/api lint` passes with zero errors.

19. `pnpm --filter @wolf-cup/api test` passes with tests covering all ACs above.

## Tasks / Subtasks

- [x] Task 1: Create `apps/api/src/schemas/side-game.ts` (AC: #15)
  - [x] Export `createSideGameSchema`
  - [x] Export `updateSideGameSchema` with `.refine` (at least one field)
  - [x] Export `createSideGameResultSchema` with `.refine` (winnerPlayerId or winnerName)
  - [x] Export inferred types: `CreateSideGameBody`, `UpdateSideGameBody`, `CreateSideGameResultBody`

- [x] Task 2: Create `apps/api/src/routes/admin/side-games.ts` (AC: #1–#14)
  - [x] Define helper `toSideGameResponse(row)` — parses `scheduledRoundIds` from JSON string to number[] (null → [])
  - [x] `GET /seasons/:seasonId/side-games` — verify season exists → 404, then list side games
  - [x] `POST /seasons/:seasonId/side-games` — verify season exists → 404, validate body, insert, return 201
  - [x] `PATCH /side-games/:id` — validate id, validate body, check exists → 404, update, return 200
  - [x] `POST /rounds/:roundId/side-game-results` — verify round → 404, verify sideGame → 404, verify player (if provided) → 404, insert result, return 201
  - [x] `GET /rounds/:roundId/side-game-results` — verify round → 404, list results, return 200

- [x] Task 3: Mount router in `apps/api/src/index.ts` (AC: #16)
  - [x] Add `import adminSideGamesRouter from './routes/admin/side-games.js';`
  - [x] Add `app.route('/api/admin', adminSideGamesRouter);`

- [x] Task 4: Create `apps/api/src/routes/admin/side-games.test.ts` (AC: #19)
  - [x] Set up in-memory DB mock (same pattern as all other test files)
  - [x] `beforeAll`: migrate, seed season, round, group, player
  - [x] `afterEach`: delete test-created side games and results; keep baseline data
  - [x] GET /seasons/:seasonId/side-games tests (empty list, 404)
  - [x] POST /seasons/:seasonId/side-games tests (201 valid, scheduledRoundIds stored, 404 unknown season, 400 missing name, 400 missing format)
  - [x] PATCH /side-games/:id tests (200 update name, 200 update scheduledRoundIds, 404 unknown, 400 empty body)
  - [x] POST /rounds/:roundId/side-game-results tests (201 with playerId, 201 with winnerName guest, 404 unknown round, 404 unknown sideGame, 404 unknown winnerPlayerId, 400 no winner)
  - [x] GET /rounds/:roundId/side-game-results tests (200 items, 404 unknown round)

- [x] Task 5: Typecheck and lint (AC: #17, #18)
  - [x] `pnpm --filter @wolf-cup/api typecheck` — zero errors
  - [x] `pnpm --filter @wolf-cup/api lint` — zero errors
  - [x] `pnpm --filter @wolf-cup/api test` — all passing

## Dev Notes

### What Previous Stories Already Provide

**From Story 2.1 (DB Schema) — NO MIGRATION NEEDED:**

Both tables exist in `apps/api/src/db/schema.ts`:

```ts
// side_games table (schema.ts lines 271-286)
export const sideGames = sqliteTable('side_games', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  seasonId: integer('season_id').notNull().references(() => seasons.id),
  name: text('name').notNull(),
  format: text('format').notNull(),
  scheduledRoundIds: text('scheduled_round_ids'), // JSON array of round IDs — nullable
  createdAt: integer('created_at').notNull(),
});

// side_game_results table (schema.ts lines 291-310)
export const sideGameResults = sqliteTable('side_game_results', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sideGameId: integer('side_game_id').notNull().references(() => sideGames.id),
  roundId: integer('round_id').notNull().references(() => rounds.id),
  winnerPlayerId: integer('winner_player_id').references(() => players.id), // nullable
  winnerName: text('winner_name'),  // nullable — for guests not in roster
  notes: text('notes'),             // nullable
  createdAt: integer('created_at').notNull(),
});
```

**From Stories 2.4–2.6 (established patterns):**

All these patterns are battle-tested and must be followed exactly:
- In-memory DB mock: `vi.mock('../../db/index.js', ...)` with `file::memory:?cache=shared`
- adminAuthMiddleware mock: `c.set('adminId' as never, 1 as never)`
- Route validation: parse ID params as `Number(param)`, check `Number.isInteger(id) && id > 0`
- Error shape: `{ error: string, code: string }` (and `issues: [...]` for VALIDATION_ERROR)
- `safeParse` + `result.success` pattern for all body validation
- `select({ id: table.id }).from(table).where(eq(...)).get()` for existence checks
- `.returning()` on insert for created row data

### Critical Implementation Rules

**`scheduledRoundIds` — JSON serialization:**
The DB stores this as a nullable TEXT column. The API accepts `number[]` and stores as `JSON.stringify(arr)`, returns as parsed array:

```ts
// Helper — use in GET and PATCH responses:
function toSideGameResponse(row: typeof sideGames.$inferSelect) {
  return {
    id: row.id,
    seasonId: row.seasonId,
    name: row.name,
    format: row.format,
    scheduledRoundIds: row.scheduledRoundIds
      ? (JSON.parse(row.scheduledRoundIds) as number[])
      : [],
  };
}

// When writing to DB:
scheduledRoundIds: scheduledRoundIds ? JSON.stringify(scheduledRoundIds) : null,
// Or on PATCH (update only if provided):
if (data.scheduledRoundIds !== undefined)
  updates.scheduledRoundIds = JSON.stringify(data.scheduledRoundIds);
```

**`createSideGameResultSchema` — winnerPlayerId OR winnerName required:**
```ts
export const createSideGameResultSchema = z
  .object({
    sideGameId: z.number().int().positive(),
    winnerPlayerId: z.number().int().positive().optional(),
    winnerName: z.string().min(1).optional(),
    notes: z.string().optional(),
  })
  .refine(
    (data) => data.winnerPlayerId !== undefined || data.winnerName !== undefined,
    { message: 'Either winnerPlayerId or winnerName is required' },
  );
```

**Existence check order for `POST /rounds/:roundId/side-game-results`:**
1. Validate path ID (`roundId`) format
2. Validate body with `createSideGameResultSchema`
3. Check round exists → 404
4. Check sideGame exists → 404
5. If `winnerPlayerId` provided, check player exists → 404
6. Insert and return 201

**`updateSideGameSchema` refine — same pattern as other update schemas:**
```ts
export const updateSideGameSchema = z
  .object({
    name: z.string().min(1).optional(),
    format: z.string().min(1).optional(),
    scheduledRoundIds: z.array(z.number().int().positive()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field required',
  });
```

**⚠️ NOTE:** The `.refine` on `updateSideGameSchema` checks `Object.keys(data).length > 0`. This works correctly because Zod only includes keys that were present in the original input (not missing optional keys). If body is `{}`, the refine fails. If body is `{ scheduledRoundIds: [] }`, the refine passes (length=1) even though the array is empty — this is intentional since clearing the schedule to `[]` is a valid operation.

### File Structure

```
apps/api/src/
  schemas/
    side-game.ts          ← NEW
  routes/admin/
    side-games.ts         ← NEW
    side-games.test.ts    ← NEW
  index.ts                ← updated (add import + mount)
```

### Test Setup Pattern

All test files follow the exact same structure. Key points:

```ts
// Import ALL schema tables used in seeding:
import { seasons, rounds, groups, players, sideGames, sideGameResults } from '../../db/schema.js';

// Seed in beforeAll:
let testSeasonId: number;
let testRoundId: number;
let testPlayerId: number;
let testSideGameId: number; // seed one baseline side game for result tests

beforeAll(async () => {
  await migrate(db, { migrationsFolder });

  const [season] = await db.insert(seasons).values({...}).returning();
  testSeasonId = season!.id;

  const [round] = await db.insert(rounds).values({
    seasonId: testSeasonId, type: 'official', status: 'scheduled',
    scheduledDate: '2026-06-06', autoCalculateMoney: 1, createdAt: Date.now(),
  }).returning();
  testRoundId = round!.id;

  const [player] = await db.insert(players).values({
    name: 'Test Player', createdAt: Date.now(),
  }).returning();
  testPlayerId = player!.id;

  // Seed baseline side game for result tests
  const [game] = await db.insert(sideGames).values({
    seasonId: testSeasonId, name: 'Closest to Pin', format: 'manual',
    createdAt: Date.now(),
  }).returning();
  testSideGameId = game!.id;
});

afterEach(async () => {
  // Delete results first (FK constraint)
  await db.delete(sideGameResults).where(eq(sideGameResults.roundId, testRoundId));
  // Delete test-created side games (keep baseline)
  // Use a filter that excludes testSideGameId
  // Simplest: delete any side game with name 'Test Game'
  await db.delete(sideGames).where(eq(sideGames.name, 'Test Game'));
});
```

**⚠️ IMPORTANT — FK delete order:** `sideGameResults` references `sideGames` (FK), so you must delete results BEFORE deleting side games in afterEach. Also `sideGameResults` references `rounds`. Delete results before cleaning up any side games that tests may have created.

### Route Handler Structure for `side-games.ts`

```ts
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { seasons, rounds, players, sideGames, sideGameResults } from '../../db/schema.js';
import { adminAuthMiddleware } from '../../middleware/admin-auth.js';
import {
  createSideGameSchema,
  updateSideGameSchema,
  createSideGameResultSchema,
} from '../../schemas/side-game.js';
import type { Variables } from '../../types.js';

const app = new Hono<{ Variables: Variables }>();

// Helper: parse scheduledRoundIds from JSON string → number[]
function toSideGameResponse(row: typeof sideGames.$inferSelect) {
  return {
    id: row.id,
    seasonId: row.seasonId,
    name: row.name,
    format: row.format,
    scheduledRoundIds: row.scheduledRoundIds
      ? (JSON.parse(row.scheduledRoundIds) as number[])
      : [],
  };
}

// GET /seasons/:seasonId/side-games
// POST /seasons/:seasonId/side-games
// PATCH /side-games/:id
// POST /rounds/:roundId/side-game-results
// GET /rounds/:roundId/side-game-results

export default app;
```

### Architecture References

- [Source: architecture.md#Data Architecture] — `side_games` and `side_game_results` tables
- [Source: architecture.md#API Patterns] — REST, JSON, `{ error, code }` errors, admin-auth
- FR48: Side game schedule per season; active side game per round → via `scheduledRoundIds` JSON array
- FR49: Record side game winner(s) per round → `side_game_results` insert
- FR56: Record manual side game result — same endpoint as FR49 (winnerName for ad-hoc guests)
- `winnerName` (text) allows recording guest/non-roster winners without a player record
- Epic 3 will read `scheduledRoundIds` to display active side game on leaderboard (FR55) — no change needed here

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- 81/81 tests passing (61 pre-existing + 20 new in side-games.test.ts after code review fixes)
- No migration needed — `side_games` and `side_game_results` tables already in DB schema from Story 2.1
- `scheduledRoundIds` stored as JSON text in DB (`JSON.stringify`), always returned as `number[]` via `toSideGameResponse()` helper (null → [])
- `winnerName` allows guest/non-roster winners without a player record (FR56)
- FK delete order in `afterEach`: `sideGameResults` deleted before `sideGames` to satisfy FK constraint
- Existence check order for POST /rounds/:roundId/side-game-results: validate ID → validate body → check round → check sideGame → check player (if provided) → insert

### File List

- `apps/api/src/schemas/side-game.ts` — new
- `apps/api/src/routes/admin/side-games.ts` — new
- `apps/api/src/routes/admin/side-games.test.ts` — new
- `apps/api/src/index.ts` — updated (add side-games router import + mount)
