# Story 2.3: League Roster & Handicap Management

Status: done

## Story

As an admin (Jason or Josh),
I want to create and maintain the league player roster and enter per-round handicap indexes,
so that every player has a current record and each round uses the correct handicap for net score calculation.

## Acceptance Criteria

1. `GET /api/admin/players` (protected by `adminAuthMiddleware`) returns `{ items: Player[] }` HTTP 200 with ALL players (active and inactive). Each `Player` object includes `id`, `name`, `ghinNumber` (string or null), `isActive` (0 or 1), `createdAt` (Unix ms integer).

2. `POST /api/admin/players` (protected) accepts `{ name, ghinNumber? }` JSON body validated by `createPlayerSchema`; returns `{ player: {...} }` HTTP 201 on success with the newly created player.

3. `POST /api/admin/players` returns `{ error: "...", code: "VALIDATION_ERROR", issues: [...] }` HTTP 400 when `name` is missing or empty string.

4. `PATCH /api/admin/players/:id` (protected) accepts `{ name?, ghinNumber?, isActive? }` validated by `updatePlayerSchema` (at least one field required); returns `{ player: {...} }` HTTP 200 with the full updated player record.

5. `PATCH /api/admin/players/:id` returns `{ error: "Player not found", code: "NOT_FOUND" }` HTTP 404 when the player ID does not exist.

6. `PATCH /api/admin/players/:id` with `{ isActive: 0 }` soft-deletes the player (sets `is_active = 0` in DB); player continues to appear in `GET /api/admin/players` with `isActive: 0`.

7. `PATCH /api/admin/rounds/:roundId/players/:playerId/handicap` (protected) accepts `{ handicapIndex }` (number, 0–54 inclusive) validated by `updateHandicapSchema`; updates `handicap_index` on the matching `round_players` row; returns `{ roundPlayer: { roundId, playerId, handicapIndex } }` HTTP 200.

8. `PATCH /api/admin/rounds/:roundId/players/:playerId/handicap` returns `{ error: "Player not in round", code: "NOT_FOUND" }` HTTP 404 when no `round_players` row exists for the given `(roundId, playerId)` pair.

9. `PATCH /api/admin/rounds/:roundId/players/:playerId/handicap` returns `{ error: "...", code: "VALIDATION_ERROR", issues: [...] }` HTTP 400 when `handicapIndex` is missing, not a number, negative, or greater than 54.

10. `apps/api/src/schemas/player.ts` exports:
    - `createPlayerSchema`: `z.object({ name: z.string().min(1), ghinNumber: z.string().optional() })`
    - `updatePlayerSchema`: `z.object({ name: z.string().min(1).optional(), ghinNumber: z.string().nullable().optional(), isActive: z.literal(0).or(z.literal(1)).optional() }).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' })`
    - Exported types: `CreatePlayerBody`, `UpdatePlayerBody`
    - `apps/api/src/schemas/handicap.ts` exports `updateHandicapSchema`: `z.object({ handicapIndex: z.number().min(0).max(54) })` and type `UpdateHandicapBody`

11. All 4 endpoints return HTTP 401 UNAUTHORIZED when called without a valid session cookie (enforced by `adminAuthMiddleware`).

12. `pnpm --filter @wolf-cup/api typecheck` passes with zero errors.

13. `pnpm --filter @wolf-cup/api lint` passes with zero errors.

14. `pnpm --filter @wolf-cup/api test` runs and passes tests covering:
    - GET /players returns all players (active + inactive)
    - POST /players creates player successfully
    - POST /players with missing name → 400 VALIDATION_ERROR
    - PATCH /players/:id updates player name
    - PATCH /players/:id with isActive: 0 soft-deletes player
    - PATCH /players/:id with unknown ID → 404 NOT_FOUND
    - PATCH /rounds/:roundId/players/:playerId/handicap updates handicap successfully
    - PATCH /rounds/:roundId/players/:playerId/handicap with no round_players row → 404 NOT_FOUND
    - PATCH /rounds/:roundId/players/:playerId/handicap with invalid handicapIndex → 400 VALIDATION_ERROR

## Tasks / Subtasks

- [x] Task 1: Create Zod schemas (AC: #10)
  - [x] Create `apps/api/src/schemas/player.ts`
  - [x] Export `createPlayerSchema`: `z.object({ name: z.string().min(1), ghinNumber: z.string().optional() })`
  - [x] Export `updatePlayerSchema` with `.refine()` requiring at least one field
  - [x] Export inferred types: `CreatePlayerBody`, `UpdatePlayerBody`
  - [x] Create `apps/api/src/schemas/handicap.ts`
  - [x] Export `updateHandicapSchema`: `z.object({ handicapIndex: z.number().min(0).max(54) })`
  - [x] Export inferred type: `UpdateHandicapBody`

- [x] Task 2: Implement player CRUD routes (AC: #1, #2, #3, #4, #5, #6)
  - [x] Create `apps/api/src/routes/admin/roster.ts`
  - [x] Implement `GET /players`:
    - Query `players` table, return all rows ordered by `id ASC`
    - Return `{ items: [...] }` HTTP 200
  - [x] Implement `POST /players`:
    - Parse and validate body with `createPlayerSchema`; return 400 on failure
    - Insert into `players` table with `createdAt: Date.now()`
    - Return `{ player: newPlayer }` HTTP 201
  - [x] Implement `PATCH /players/:id`:
    - Parse `:id` as integer; return 400 if not valid integer > 0
    - Parse and validate body with `updatePlayerSchema`; return 400 on failure
    - Query `players` table for existing row; return 404 if not found
    - Build update object from provided fields only (name, ghinNumber, isActive)
    - Update and return `{ player: updatedPlayer }` HTTP 200
  - [x] Wrap all DB calls in try/catch; return 500 INTERNAL_ERROR on DB failure
  - [x] Export a Hono sub-app from `roster.ts`

- [x] Task 3: Implement handicap update route (AC: #7, #8, #9)
  - [x] Add to `apps/api/src/routes/admin/roster.ts`:
    - `PATCH /rounds/:roundId/players/:playerId/handicap`
    - Parse `:roundId` and `:playerId` as integers; return 400 if invalid
    - Validate body with `updateHandicapSchema`; return 400 on failure
    - Query `round_players` for `(roundId, playerId)` row; return 404 if not found
    - Update `handicap_index` on the row
    - Return `{ roundPlayer: { roundId, playerId, handicapIndex } }` HTTP 200
    - Wrap DB calls in try/catch; return 500 on failure

- [x] Task 4: Register routes in app (AC: #11)
  - [x] Import `adminRosterRouter` in `apps/api/src/index.ts`
  - [x] Mount at `/api/admin`: `app.route('/api/admin', adminRosterRouter)`

- [x] Task 5: Write tests (AC: #14)
  - [x] Create `apps/api/src/routes/admin/roster.test.ts`
  - [x] Mock `../../db/index.js` with in-memory libsql DB (same pattern as auth.test.ts)
  - [x] Mock `../../middleware/admin-auth.js` to bypass auth
  - [x] In `beforeAll`: run migration, seed test player, season, round, group, round_players row
  - [x] In `afterEach`: clean up test-created players
  - [x] 12 tests covering all ACs in #14 (exceeded minimum of 9)

- [x] Task 6: Typecheck and lint (AC: #12, #13)
  - [x] Run `pnpm --filter @wolf-cup/api typecheck` — zero errors
  - [x] Run `pnpm --filter @wolf-cup/api lint` — zero errors
  - [x] Run `pnpm --filter @wolf-cup/api test` — 19/19 pass (12 new + 7 regression)

## Dev Notes

### What Previous Stories Already Provide

**From Story 2.1:**
- `players` table: `id`, `name`, `ghin_number` (nullable), `is_active` (0/1), `created_at`
- `rounds` table: `id`, `season_id`, `type`, `status`, `scheduled_date`, ...
- `round_players` table: `id`, `round_id`, `player_id`, `group_id` (NOT NULL), `handicap_index` (real), `is_sub` (0/1)
  - Unique constraint on `(round_id, player_id)`
- `seasons` table, `groups` table
- `db` singleton (`@libsql/client` + Drizzle), `adminAuthMiddleware`, `Variables` type in `src/types.ts`
- Vitest configured with `pnpm --filter @wolf-cup/api test` (from Story 2.2)
- Test pattern: `vi.mock('../../db/index.js', async () => { ... })` + `migrate(db, { migrationsFolder })`

**From Story 2.2:**
- `apps/api/src/routes/admin/auth.ts` — example of Hono sub-app pattern, Zod validation, error responses
- `apps/api/src/schemas/admin.ts` — example of schema file structure
- Test pattern for mocking `adminAuthMiddleware`:
  ```ts
  vi.mock('../../middleware/admin-auth.js', () => ({
    adminAuthMiddleware: async (c: Context, next: Next) => {
      c.set('adminId', 1);
      await next();
    },
  }));
  ```

### Route Structure Pattern

```ts
// apps/api/src/routes/admin/roster.ts
import { Hono } from 'hono';
import type { Variables } from '../../types.js';

const app = new Hono<{ Variables: Variables }>();

app.get('/players', adminAuthMiddleware, async (c) => { ... });
app.post('/players', adminAuthMiddleware, async (c) => { ... });
app.patch('/players/:id', adminAuthMiddleware, async (c) => { ... });
app.patch('/rounds/:roundId/players/:playerId/handicap', adminAuthMiddleware, async (c) => { ... });

export default app;

// apps/api/src/index.ts
import adminRosterRouter from './routes/admin/roster.js';
app.route('/api/admin', adminRosterRouter);
// Results in: GET /api/admin/players, POST /api/admin/players,
//             PATCH /api/admin/players/:id,
//             PATCH /api/admin/rounds/:roundId/players/:playerId/handicap
```

### Zod Validation Pattern (reuse from Story 2.2)

```ts
// Parse body safely
let body: unknown;
try {
  body = await c.req.json();
} catch {
  return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: [] }, 400);
}
const result = createPlayerSchema.safeParse(body);
if (!result.success) {
  return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues }, 400);
}
```

### Route Param Validation Pattern

```ts
const idParam = c.req.param('id');
const id = Number(idParam);
if (!Number.isInteger(id) || id <= 0) {
  return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
}
```

### PATCH Update Pattern (build dynamic update object)

```ts
// Only update provided fields
const updates: Partial<typeof players.$inferInsert> = {};
if (result.data.name !== undefined) updates.name = result.data.name;
if (result.data.ghinNumber !== undefined) updates.ghinNumber = result.data.ghinNumber;
if (result.data.isActive !== undefined) updates.isActive = result.data.isActive;

await db.update(players).set(updates).where(eq(players.id, id));
```

### Soft Delete Design

There is no `DELETE /api/admin/players/:id` endpoint. Deactivation is done via:
```
PATCH /api/admin/players/:id   body: { "isActive": 0 }
```
This preserves referential integrity since `round_players`, `hole_scores`, `round_results`, etc. all reference `player_id`. Hard deleting a player with historical round data would violate FK constraints.

### Test Seed Setup for Handicap Tests

The handicap endpoint requires a `round_players` row which itself requires `rounds` → `seasons` and `groups` → `rounds`. The test `beforeAll` must seed:
```ts
// 1. Create season
const [season] = await db.insert(seasons).values({ name: 'Test', startDate: '2026-01-01', endDate: '2026-12-31', totalRounds: 17, playoffFormat: 'top8', createdAt: Date.now() }).returning();
// 2. Create round
const [round] = await db.insert(rounds).values({ seasonId: season.id, type: 'official', status: 'scheduled', scheduledDate: '2026-06-06', createdAt: Date.now() }).returning();
// 3. Create group
const [group] = await db.insert(groups).values({ roundId: round.id, groupNumber: 1 }).returning();
// 4. Create player
const [player] = await db.insert(players).values({ name: 'Test Player', createdAt: Date.now() }).returning();
// 5. Create round_players row
await db.insert(roundPlayers).values({ roundId: round.id, playerId: player.id, groupId: group.id, handicapIndex: 15.0 });
```

Note: `db.insert(...).returning()` is supported by `@libsql/client` (libsql adapter). If `.returning()` does not work with libsql, use `db.select()` after insert to fetch the created row.

### Response Shape Reference (from Architecture)

```ts
// Collection:
return c.json({ items: allPlayers }, 200);

// Single (create / update):
return c.json({ player: createdPlayer }, 201);
return c.json({ player: updatedPlayer }, 200);

// Handicap update:
return c.json({ roundPlayer: { roundId, playerId, handicapIndex } }, 200);

// Error:
return c.json({ error: 'Player not found', code: 'NOT_FOUND' }, 404);
return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
```

### GHIN Number Notes

- Stored as `text` (nullable) in `players.ghin_number`
- No format validation beyond optional string — manual entry only (no GHIN API for MVP per architecture)
- `null` means no GHIN number on file; to clear it, PATCH with `{ ghinNumber: null }`

### Handicap Index Range

- USGA handicap index: 0.0 to 54.0 (per current rules)
- Stored as `real` in `round_players.handicap_index`
- Zod: `z.number().min(0).max(54)`
- Whole or decimal values accepted (e.g., 12.5, 18.0)

### Project Structure Notes

Files to create/modify:
- `apps/api/src/schemas/player.ts` — new
- `apps/api/src/schemas/handicap.ts` — new
- `apps/api/src/routes/admin/roster.ts` — new
- `apps/api/src/routes/admin/roster.test.ts` — new
- `apps/api/src/index.ts` — register adminRosterRouter

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#API & Communication Patterns] — route naming, response shape
- [Source: _bmad-output/planning-artifacts/architecture.md#Structure Patterns] — `roster.ts` is designated file for `/api/admin/players`
- [Source: _bmad-output/planning-artifacts/architecture.md#Format Patterns] — `{ items: [...] }` for collections, `{ player: {...} }` for single
- [Source: _bmad-output/planning-artifacts/architecture.md#Naming Patterns] — camelCase JSON, kebab-case endpoints
- FR52: Admin creates and maintains league roster (player names, GHIN numbers)
- FR53: Admin enters and updates player handicap index per round
- NFR24: Player data limited to name, GHIN number, handicap index, round scores — no PII
- Story 2.1 Dev Agent Record: `round_players.group_id` is NOT NULL — test setup must include a group

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- All 6 tasks completed; 20/20 tests pass (13 new roster tests + 7 auth regression tests)
- typecheck: zero errors; lint: zero errors
- libsql `file::memory:?cache=shared` only supports `?cache=shared` query param — no `?mode=...`; each Vitest test file runs in a separate process so in-memory DBs are isolated without extra URL params
- `db.insert(...).returning()` works correctly with the libsql adapter
- `afterEach` resets baseline player name and isActive after each test for reliable isolation; inline resets removed
- Code review fixes: `Record<string, unknown>` → `Partial<typeof players.$inferInsert>` for type-safe PATCH update; added test for empty-body PATCH (400 VALIDATION_ERROR)

### File List

- `apps/api/src/schemas/player.ts` — new; exports `createPlayerSchema`, `updatePlayerSchema`, `CreatePlayerBody`, `UpdatePlayerBody`
- `apps/api/src/schemas/handicap.ts` — new; exports `updateHandicapSchema`, `UpdateHandicapBody`
- `apps/api/src/routes/admin/roster.ts` — new; implements GET /players, POST /players, PATCH /players/:id, PATCH /rounds/:roundId/players/:playerId/handicap
- `apps/api/src/routes/admin/roster.test.ts` — new; 13 tests covering all ACs (added empty-body PATCH test in code review)
- `apps/api/src/index.ts` — updated; added `import adminRosterRouter` and `app.route('/api/admin', adminRosterRouter)`
- `apps/api/package.json` — updated; dependencies/devDependencies modified
