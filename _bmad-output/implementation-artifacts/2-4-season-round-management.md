# Story 2.4: Season & Round Management

Status: done

## Story

As an admin (Jason or Josh),
I want to create and configure seasons, create official and casual rounds with entry codes, cancel rounds, set headcount, and assign players to playing groups,
so that each week's round is fully set up and ready for scorers before anyone arrives at the course.

## Acceptance Criteria

### Season CRUD (FR45)

1. `GET /api/admin/seasons` (protected by `adminAuthMiddleware`) returns `{ items: Season[] }` HTTP 200. Each `Season` includes `id`, `name`, `startDate`, `endDate`, `totalRounds`, `playoffFormat`, `harveyLiveEnabled` (0 or 1), `createdAt` (Unix ms integer).

2. `POST /api/admin/seasons` (protected) accepts `{ name, startDate, endDate, totalRounds, playoffFormat }` validated by `createSeasonSchema`; returns `{ season: {...} }` HTTP 201.

3. `POST /api/admin/seasons` returns `{ error: "...", code: "VALIDATION_ERROR", issues: [...] }` HTTP 400 when any required field is missing, `name` is empty, `totalRounds < 1`, or dates are not `YYYY-MM-DD` format.

4. `PATCH /api/admin/seasons/:id` (protected) accepts `{ name?, startDate?, endDate?, totalRounds?, playoffFormat? }` validated by `updateSeasonSchema` (at least one field required); returns `{ season: {...} }` HTTP 200 with the full updated season.

5. `PATCH /api/admin/seasons/:id` returns `{ error: "Season not found", code: "NOT_FOUND" }` HTTP 404 when the season ID does not exist.

### Round CRUD (FR20, FR21, FR22, FR23, FR46)

6. `GET /api/admin/rounds` (protected) returns `{ items: Round[] }` HTTP 200 ordered by `scheduledDate` DESC. Each `Round` includes `id`, `seasonId`, `type`, `status`, `scheduledDate`, `headcount`, `autoCalculateMoney`, `createdAt`. **`entryCodeHash` is never returned in any round response** (security).

7. `POST /api/admin/rounds` (protected) accepts `{ seasonId, type, scheduledDate, entryCode? }` validated by `createRoundSchema`; returns `{ round: {...} }` HTTP 201. When `entryCode` is provided, it is bcrypt-hashed (cost 10) and stored as `entry_code_hash`; the raw code and the hash are both excluded from the response.

8. `POST /api/admin/rounds` returns `{ error: "...", code: "VALIDATION_ERROR", issues: [...] }` HTTP 400 when `type` is not `'official'` or `'casual'`, `scheduledDate` is not `YYYY-MM-DD`, or required fields are missing.

9. `POST /api/admin/rounds` returns `{ error: "Season not found", code: "NOT_FOUND" }` HTTP 404 when `seasonId` does not exist.

10. `PATCH /api/admin/rounds/:id` (protected) accepts `{ status?, headcount?, entryCode?, scheduledDate? }` validated by `updateRoundSchema` (at least one field); returns `{ round: {...} }` HTTP 200. When `entryCode` is updated, the new value is bcrypt-hashed before storage. When `status: 'cancelled'`, `entry_code_hash` is also set to `null` in the same DB write.

11. `PATCH /api/admin/rounds/:id` returns `{ error: "Round not found", code: "NOT_FOUND" }` HTTP 404 when round ID does not exist.

### Group & Player Assignment (FR47)

12. `GET /api/admin/rounds/:roundId/groups` (protected) returns `{ items: Group[] }` HTTP 200 — each group includes `id`, `roundId`, `groupNumber`. Returns `{ items: [] }` if no groups exist.

13. `POST /api/admin/rounds/:roundId/groups` (protected) accepts `{ groupNumber }` validated by `createGroupSchema` (`groupNumber`: positive integer); returns `{ group: { id, roundId, groupNumber } }` HTTP 201.

14. `POST /api/admin/rounds/:roundId/groups` returns `{ error: "Round not found", code: "NOT_FOUND" }` HTTP 404 when the round ID does not exist.

15. `POST /api/admin/rounds/:roundId/groups/:groupId/players` (protected) accepts `{ playerId, handicapIndex }` validated by `addGroupPlayerSchema`; creates a `round_players` row with `isSub: 0`; returns `{ roundPlayer: { roundId, groupId, playerId, handicapIndex, isSub } }` HTTP 201.

16. `POST /api/admin/rounds/:roundId/groups/:groupId/players` returns `{ error: "Not found", code: "NOT_FOUND" }` HTTP 404 when the round, group, or player does not exist.

17. `POST /api/admin/rounds/:roundId/groups/:groupId/players` returns `{ error: "Player already in round", code: "CONFLICT" }` HTTP 409 when the player is already assigned to this round (`UNIQUE constraint failed: round_players.round_id, round_players.player_id`).

### Auth & Quality

18. All endpoints (GET seasons, POST seasons, PATCH seasons/:id, GET rounds, POST rounds, PATCH rounds/:id, GET rounds/:roundId/groups, POST rounds/:roundId/groups, POST rounds/:roundId/groups/:groupId/players) return HTTP 401 UNAUTHORIZED when called without a valid session cookie.

19. `apps/api/src/schemas/season.ts` exports:
    - `createSeasonSchema`: `z.object({ name: z.string().min(1), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), totalRounds: z.number().int().min(1), playoffFormat: z.string().min(1) })`
    - `updateSeasonSchema`: same fields all optional + `.refine()` at least one field
    - Exported types: `CreateSeasonBody`, `UpdateSeasonBody`
    - `apps/api/src/schemas/round.ts` exports:
      - `createRoundSchema`: `z.object({ seasonId: z.number().int().positive(), type: z.enum(['official', 'casual']), scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), entryCode: z.string().min(1).optional() })`
      - `updateRoundSchema`: `z.object({ status: z.enum([...]).optional(), headcount: z.number().int().positive().optional(), entryCode: z.string().min(1).optional(), scheduledDate: z.string().regex(...).optional() }).refine(...)` at least one field
      - `createGroupSchema`: `z.object({ groupNumber: z.number().int().positive() })`
      - `addGroupPlayerSchema`: `z.object({ playerId: z.number().int().positive(), handicapIndex: z.number().min(0).max(54) })`
      - Exported types: `CreateRoundBody`, `UpdateRoundBody`, `CreateGroupBody`, `AddGroupPlayerBody`

20. `pnpm --filter @wolf-cup/api typecheck` passes with zero errors.

21. `pnpm --filter @wolf-cup/api lint` passes with zero errors.

22. `pnpm --filter @wolf-cup/api test` passes with tests covering:
    - GET /seasons returns items array
    - POST /seasons creates season
    - POST /seasons with missing name → 400 VALIDATION_ERROR
    - PATCH /seasons/:id updates a field
    - PATCH /seasons/:id with unknown ID → 404 NOT_FOUND
    - GET /rounds returns items array
    - POST /rounds creates official round
    - POST /rounds with entryCode — response excludes entryCodeHash; raw DB row has non-null entry_code_hash
    - POST /rounds with invalid type → 400 VALIDATION_ERROR
    - POST /rounds with unknown seasonId → 404 NOT_FOUND
    - PATCH /rounds/:id updates headcount
    - PATCH /rounds/:id sets status: 'cancelled' and clears entry_code_hash in DB
    - PATCH /rounds/:id with unknown ID → 404 NOT_FOUND
    - GET /rounds/:roundId/groups returns items array
    - POST /rounds/:roundId/groups creates group
    - POST /rounds/:roundId/groups with unknown roundId → 404 NOT_FOUND
    - POST /rounds/:roundId/groups/:groupId/players adds player to group
    - POST /rounds/:roundId/groups/:groupId/players with unknown groupId → 404 NOT_FOUND
    - POST /rounds/:roundId/groups/:groupId/players duplicate player → 409 CONFLICT

## Tasks / Subtasks

- [x] Task 1: Create Zod schemas (AC: #19)
  - [x] Create `apps/api/src/schemas/season.ts` — export `createSeasonSchema`, `updateSeasonSchema`, `CreateSeasonBody`, `UpdateSeasonBody`
  - [x] Create `apps/api/src/schemas/round.ts` — export `createRoundSchema`, `updateRoundSchema`, `createGroupSchema`, `addGroupPlayerSchema`, and all inferred types
  - [x] `updateSeasonSchema` must use `.refine()` to require at least one field (same pattern as `updatePlayerSchema` from Story 2.3)
  - [x] `updateRoundSchema` must use `.refine()` to require at least one field

- [x] Task 2: Implement season routes (AC: #1, #2, #3, #4, #5, #18)
  - [x] Create `apps/api/src/routes/admin/season.ts`
  - [x] `GET /seasons` — query `seasons` table ordered by `id` ASC, return `{ items }` 200
  - [x] `POST /seasons` — validate with `createSeasonSchema`, insert with `createdAt: Date.now()`, return `{ season }` 201
  - [x] `PATCH /seasons/:id` — parse id, validate with `updateSeasonSchema`, check existence (404), dynamic update, return `{ season }` 200
  - [x] Apply `adminAuthMiddleware` to all three routes
  - [x] Export default Hono sub-app

- [x] Task 3: Implement round routes (AC: #6, #7, #8, #9, #10, #11, #12, #13, #14, #15, #16, #17, #18)
  - [x] Create `apps/api/src/routes/admin/rounds.ts`
  - [x] `GET /rounds` — query `rounds` ordered by `scheduledDate` DESC; exclude `entryCodeHash` from every round response
  - [x] `POST /rounds` — validate, check season exists, hash entryCode if provided, insert, return without hash
  - [x] `PATCH /rounds/:id` — validate, check round exists, hash new entryCode if provided, clear hash on cancellation
  - [x] `GET /rounds/:roundId/groups` — return groups for round
  - [x] `POST /rounds/:roundId/groups` — validate, check round exists, insert group
  - [x] `POST /rounds/:roundId/groups/:groupId/players` — validate all IDs, pre-check for duplicate (409), insert round_player
  - [x] Apply `adminAuthMiddleware` to all routes
  - [x] Export default Hono sub-app

- [x] Task 4: Register routes in app (AC: #18)
  - [x] In `apps/api/src/index.ts`, import and mount adminSeasonRouter and adminRoundsRouter

- [x] Task 5: Write tests (AC: #22)
  - [x] Create `apps/api/src/routes/admin/season.test.ts` — 8 tests
  - [x] Create `apps/api/src/routes/admin/rounds.test.ts` — 19 tests
  - [x] entryCode test: verifies DB hash non-null and hash ≠ plaintext; response excludes it

- [x] Task 6: Typecheck and lint (AC: #20, #21)
  - [x] `pnpm --filter @wolf-cup/api typecheck` — zero errors
  - [x] `pnpm --filter @wolf-cup/api lint` — zero errors (added `varsIgnorePattern: '^_'` to root eslint.config.js)
  - [x] `pnpm --filter @wolf-cup/api test` — 50/50 passing

## Dev Notes

### What Previous Stories Already Provide

**From Story 2.1 (API Foundation):**

The DB schema is **fully in place** — no new migrations needed. Key tables:

```
seasons: id, name, start_date, end_date, total_rounds, playoff_format,
         harvey_live_enabled (INTEGER default 0), created_at

rounds: id, season_id, type ('official'|'casual'), status ('scheduled'|'active'|'finalized'|'cancelled'),
        scheduled_date (TEXT YYYY-MM-DD), entry_code_hash (TEXT nullable),
        auto_calculate_money (INTEGER default 1), headcount (INTEGER nullable), created_at

groups: id, round_id, group_number, batting_order (TEXT nullable — JSON array)
        index: idx_groups_round_id

round_players: id, round_id, player_id, group_id, handicap_index (REAL),
               is_sub (INTEGER default 0)
               uniqueIndex: uniq_round_players ON (round_id, player_id)
               indexes: idx_round_players_round_id, idx_round_players_player_id
```

Drizzle exports from `../../db/schema.js`: `seasons`, `rounds`, `groups`, `roundPlayers`, `players`

**From Story 2.2 (Admin Auth):**
- `bcrypt` is already installed as a dependency of `@wolf-cup/api`. Import: `import bcrypt from 'bcrypt';`
- `adminAuthMiddleware` pattern is established; test mock pattern:
  ```ts
  vi.mock('../../middleware/admin-auth.js', () => ({
    adminAuthMiddleware: async (c: Context, next: Next) => {
      c.set('adminId' as never, 1 as never);
      await next();
    },
  }));
  ```

**From Story 2.3 (Roster & Handicap):**
- Full test pattern: `vi.mock('../../db/index.js', async () => {...})` + in-memory libsql + migrate in `beforeAll`
- `updatePlayerSchema` refine pattern (reuse for `updateSeasonSchema` and `updateRoundSchema`)
- `afterEach` resets baseline data to prevent test bleed

### Critical Implementation Rules

**NEVER return `entryCodeHash` in any response.** Strip it in every route using:
```ts
const { entryCodeHash: _hash, ...roundData } = inserted[0]!;
return c.json({ round: roundData }, 201);
```
The `_hash` prefix tells TypeScript the variable is intentionally unused. This pattern must be applied in `POST /rounds`, `PATCH /rounds/:id`, and `GET /rounds`.

**Entry code hashing:**
```ts
import bcrypt from 'bcrypt';
const hash = await bcrypt.hash(entryCode, 10);
// store hash as entryCodeHash in DB
```
Cost factor 10 matches admin password hashing from Story 2.2. Never return the hash or the raw code.

**Cancellation clears the entry code hash:**
```ts
if (updates.status === 'cancelled') {
  updates.entryCodeHash = null;
}
```
This invalidates the entry code per NFR23: "Code automatically invalid when: new code set by admin, or round is closed/cancelled."

**409 CONFLICT for duplicate player in round:**
```ts
try {
  await db.insert(roundPlayers).values({ roundId, groupId, playerId, handicapIndex, isSub: 0 });
} catch (err) {
  if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
    return c.json({ error: 'Player already in round', code: 'CONFLICT' }, 409);
  }
  return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
}
```

**`harveyLiveEnabled` is NOT in `updateSeasonSchema`** — that's FR41, Story 2.6. The field exists in the DB and defaults to 0. Just don't expose it in update routes yet.

**`autoCalculateMoney` is NOT in round creation/update schemas** — that's FR32, Story 2.6. It defaults to 1 in the DB. Include it in GET round responses but not in create/update schemas.

**`battingOrder` in groups** — always `null` at creation time. It gets populated during ball draw entry (FR26, Story 3.3). `createGroupSchema` must NOT include this field.

**`isSub` in `addGroupPlayerSchema`** — always `0` when admin assigns players to a regular round group. Story 2.5 handles marking subs. Hard-code `isSub: 0` in the `round_players` insert.

### Zod Schema Patterns

```ts
// apps/api/src/schemas/season.ts
import { z } from 'zod';
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
export const createSeasonSchema = z.object({
  name: z.string().min(1),
  startDate: z.string().regex(dateRegex),
  endDate: z.string().regex(dateRegex),
  totalRounds: z.number().int().min(1),
  playoffFormat: z.string().min(1),
});
export const updateSeasonSchema = z.object({
  name: z.string().min(1).optional(),
  startDate: z.string().regex(dateRegex).optional(),
  endDate: z.string().regex(dateRegex).optional(),
  totalRounds: z.number().int().min(1).optional(),
  playoffFormat: z.string().min(1).optional(),
}).refine((data) => Object.keys(data).length > 0, { message: 'At least one field required' });
export type CreateSeasonBody = z.infer<typeof createSeasonSchema>;
export type UpdateSeasonBody = z.infer<typeof updateSeasonSchema>;

// apps/api/src/schemas/round.ts
const statuses = ['scheduled', 'active', 'finalized', 'cancelled'] as const;
export const createRoundSchema = z.object({
  seasonId: z.number().int().positive(),
  type: z.enum(['official', 'casual']),
  scheduledDate: z.string().regex(dateRegex),
  entryCode: z.string().min(1).optional(),
});
export const updateRoundSchema = z.object({
  status: z.enum(statuses).optional(),
  headcount: z.number().int().positive().optional(),
  entryCode: z.string().min(1).optional(),
  scheduledDate: z.string().regex(dateRegex).optional(),
}).refine((data) => Object.keys(data).length > 0, { message: 'At least one field required' });
export const createGroupSchema = z.object({ groupNumber: z.number().int().positive() });
export const addGroupPlayerSchema = z.object({
  playerId: z.number().int().positive(),
  handicapIndex: z.number().min(0).max(54),
});
// export types...
```

### Route Structure Pattern

```ts
// apps/api/src/routes/admin/season.ts
import { Hono } from 'hono';
import type { Variables } from '../../types.js';
const app = new Hono<{ Variables: Variables }>();
app.get('/seasons', adminAuthMiddleware, async (c) => { ... });
app.post('/seasons', adminAuthMiddleware, async (c) => { ... });
app.patch('/seasons/:id', adminAuthMiddleware, async (c) => { ... });
export default app;

// apps/api/src/routes/admin/rounds.ts
const app = new Hono<{ Variables: Variables }>();
app.get('/rounds', adminAuthMiddleware, async (c) => { ... });
app.post('/rounds', adminAuthMiddleware, async (c) => { ... });
app.patch('/rounds/:id', adminAuthMiddleware, async (c) => { ... });
app.get('/rounds/:roundId/groups', adminAuthMiddleware, async (c) => { ... });
app.post('/rounds/:roundId/groups', adminAuthMiddleware, async (c) => { ... });
app.post('/rounds/:roundId/groups/:groupId/players', adminAuthMiddleware, async (c) => { ... });
export default app;

// apps/api/src/index.ts additions:
import adminSeasonRouter from './routes/admin/season.js';
import adminRoundsRouter from './routes/admin/rounds.js';
app.route('/api/admin', adminSeasonRouter);
app.route('/api/admin', adminRoundsRouter);
```

### Dynamic Update Pattern (from Story 2.3, reuse)

```ts
const updates: Partial<typeof seasons.$inferInsert> = {};
if (data.name !== undefined) updates.name = data.name;
// ... etc
await db.update(seasons).set(updates).where(eq(seasons.id, id)).returning();
```

### Group Existence Check (must verify group belongs to round)

```ts
const group = await db
  .select({ id: groups.id, roundId: groups.roundId })
  .from(groups)
  .where(and(eq(groups.id, groupId), eq(groups.roundId, roundId)))
  .get();
if (!group) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
```
This prevents adding players to a group that doesn't belong to the specified round.

### Test Seed Setup

Season and round tests are independent — seed a season in `beforeAll` in `rounds.test.ts`:
```ts
beforeAll(async () => {
  await migrate(db, { migrationsFolder });
  const [season] = await db.insert(seasons)
    .values({ name: 'Test', startDate: '2026-01-01', endDate: '2026-12-31',
              totalRounds: 17, playoffFormat: 'top8', createdAt: Date.now() })
    .returning();
  testSeasonId = season!.id;
});
```

In `afterEach`, clean up created rounds (and groups/round_players cascade via FK if ON DELETE CASCADE is set — **check: the DB schema doesn't specify ON DELETE CASCADE**, so clean up manually in reverse FK order: roundPlayers → groups → rounds if needed, or just delete rounds that aren't the seed).

Actually, simpler: don't seed a baseline round in `beforeAll`. Each round test creates its own round and cleans up after. Use a known name/date to target deletions:
```ts
afterEach(async () => {
  // Delete test rounds by date pattern (cascade groups/round_players manually first)
  await db.delete(roundPlayers).where(/* ... */);
  await db.delete(groups).where(/* ... */);
  await db.delete(rounds).where(eq(rounds.scheduledDate, '2026-06-06'));
});
```

Or, simpler: since these are in-memory DBs, just re-run the migration in `beforeEach` to get a clean slate. However, the pattern from Stories 2.2 and 2.3 is to use `beforeAll` + targeted cleanup in `afterEach`.

The simplest approach: seed one round in `beforeAll` for tests that need one, create additional rounds in individual tests, and in `afterEach` delete everything except the seed.

### Response Shape Reference

```ts
// Season:
return c.json({ items: allSeasons }, 200);
return c.json({ season: createdSeason }, 201);
return c.json({ season: updatedSeason }, 200);

// Round (always strip entryCodeHash):
const { entryCodeHash: _h, ...roundData } = row;
return c.json({ items: allRoundsWithoutHash }, 200);
return c.json({ round: roundData }, 201);

// Group:
return c.json({ items: allGroups }, 200);
return c.json({ group: { id, roundId, groupNumber } }, 201);

// Round player:
return c.json({ roundPlayer: { roundId, groupId, playerId, handicapIndex, isSub } }, 201);

// Errors:
return c.json({ error: 'Season not found', code: 'NOT_FOUND' }, 404);
return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
return c.json({ error: 'Player already in round', code: 'CONFLICT' }, 409);
return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
```

### Architecture References

- [Source: architecture.md#Structure Patterns] — `admin/season.ts` designated for season config; `admin/rounds.ts` for CRUD /api/admin/rounds
- [Source: architecture.md#API Naming Conventions] — admin routes all under `/api/admin/` prefix; no trailing slashes
- [Source: architecture.md#Format Patterns] — collections: `{ items: [...] }`; single resource: `{ round: {...} }`; errors: `{ error, code }`
- [Source: architecture.md#Authentication & Security] — entry code stored as bcrypt hash; `entryCodeMiddleware` validates it (Story 3.2)
- FR20: Admin creates official round with entry code
- FR21: Admin creates casual round (open, no code required)
- FR22: Admin cancels/marks round as rainout → `status: 'cancelled'`
- FR23: `type` field enforced by DB CHECK constraint (`IN ('official', 'casual')`)
- FR45: Season config (name, dates, round count, playoff format)
- FR46: Entry code per round — bcrypt-hashed before storage
- FR47: Headcount and group assignments per round
- NFR23: Entry code invalid when new code set or round cancelled

### Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- 50/50 tests passing (27 pre-existing + 8 season + 22 rounds; 3 tests added during code review)
- 409 CONFLICT for duplicate player-in-round implemented via SELECT-before-INSERT pre-check (libsql error message format is unreliable through Drizzle's error wrapping)
- Added `varsIgnorePattern: '^_'` and `argsIgnorePattern: '^_'` to root `eslint.config.js` to support intentionally-unused destructured variables (e.g., stripping `entryCodeHash` from round responses)
- `toRoundResponse()` helper strips `entryCodeHash` from all round DB rows before any response — used in GET /rounds, POST /rounds, and PATCH /rounds/:id
- Code review (M1): Added test for `PATCH /rounds/:id` empty body → 400 VALIDATION_ERROR
- Code review (M2): Added test for `POST /.../players` with unknown roundId → 404 NOT_FOUND
- Code review (M3): Added round-existence check to `GET /rounds/:roundId/groups` (returns 404 for unknown round, consistent with POST counterpart); added test coverage

### File List

- `apps/api/src/schemas/season.ts` — new
- `apps/api/src/schemas/round.ts` — new
- `apps/api/src/routes/admin/season.ts` — new
- `apps/api/src/routes/admin/rounds.ts` — new
- `apps/api/src/routes/admin/season.test.ts` — new
- `apps/api/src/routes/admin/rounds.test.ts` — new
- `apps/api/src/index.ts` — updated (added season and rounds routers)
- `eslint.config.js` — updated (added varsIgnorePattern/argsIgnorePattern)
