# Story 2.5: Sub Player Management

Status: done

## Story

As an admin (Jason or Josh),
I want to mark a player as a substitute for a round and convert a sub to a full league member before the playoff cutoff,
so that sub results are tracked separately from full-member standings and admins have full flexibility to correct sub status at any time.

## Acceptance Criteria

### Mark Player as Sub / Convert to Full Member (FR50, FR51)

1. `PATCH /api/admin/rounds/:roundId/players/:playerId/sub` (protected by `adminAuthMiddleware`) accepts `{ isSub: boolean }` validated by `updateSubStatusSchema`; returns `{ roundPlayer: { roundId, playerId, isSub } }` HTTP 200.

2. When `isSub: true` is sent, `round_players.is_sub` is set to `1` in the database (FR50 — marks player as sub for this round; results excluded from full-member season standings).

3. When `isSub: false` is sent, `round_players.is_sub` is set to `0` in the database (FR51 — converts sub to full league member for this round; results now count toward season standings).

4. `PATCH /api/admin/rounds/:roundId/players/:playerId/sub` returns `{ error: 'Round not found', code: 'NOT_FOUND' }` HTTP 404 when the round does not exist.

5. `PATCH /api/admin/rounds/:roundId/players/:playerId/sub` returns `{ error: 'Player not in round', code: 'NOT_FOUND' }` HTTP 404 when the player has no `round_players` row for the given round (i.e., player was never added to this round via Story 2.4's group assignment).

6. `PATCH /api/admin/rounds/:roundId/players/:playerId/sub` returns `{ error: 'Validation error', code: 'VALIDATION_ERROR', issues: [...] }` HTTP 400 when `isSub` is missing or is not a boolean.

7. `PATCH /api/admin/rounds/:roundId/players/:playerId/sub` returns HTTP 401 when called without a valid session cookie.

### Schema & Quality

8. `apps/api/src/schemas/sub.ts` exports:
   - `updateSubStatusSchema`: `z.object({ isSub: z.boolean() })`
   - `UpdateSubStatusBody`: `z.infer<typeof updateSubStatusSchema>`

9. `pnpm --filter @wolf-cup/api typecheck` passes with zero errors.

10. `pnpm --filter @wolf-cup/api lint` passes with zero errors.

11. `pnpm --filter @wolf-cup/api test` passes with tests covering:
    - PATCH /.../sub with `{ isSub: true }` → 200, DB `is_sub = 1` (FR50)
    - PATCH /.../sub with `{ isSub: false }` → 200, DB `is_sub = 0` (FR51)
    - PATCH /.../sub with unknown `roundId` → 404 NOT_FOUND
    - PATCH /.../sub with player not in round → 404 NOT_FOUND
    - PATCH /.../sub with missing `isSub` → 400 VALIDATION_ERROR

## Tasks / Subtasks

- [x] Task 1: Create Zod schema (AC: #8)
  - [x] Create `apps/api/src/schemas/sub.ts`
  - [x] Export `updateSubStatusSchema = z.object({ isSub: z.boolean() })`
  - [x] Export `UpdateSubStatusBody = z.infer<typeof updateSubStatusSchema>`

- [x] Task 2: Implement sub status route in `roster.ts` (AC: #1–#7)
  - [x] Add `PATCH /rounds/:roundId/players/:playerId/sub` handler to `apps/api/src/routes/admin/roster.ts`
  - [x] Parse and validate `roundId` and `playerId` as positive integers (400 INVALID_ID if not)
  - [x] Parse and validate body with `updateSubStatusSchema` (400 VALIDATION_ERROR if invalid)
  - [x] Check round exists → 404 if not found
  - [x] Check player is in round → 404 `'Player not in round'` if not found
  - [x] Update `round_players.is_sub` with `isSub ? 1 : 0`
  - [x] Return `{ roundPlayer: { roundId, playerId, isSub: isSub ? 1 : 0 } }` HTTP 200
  - [x] Added `rounds` to schema import; added `updateSubStatusSchema` import

- [x] Task 3: Write tests (AC: #11)
  - [x] Added sub player tests to `apps/api/src/routes/admin/roster.test.ts`
  - [x] Reused existing `beforeAll` seed (testRoundId, testGroupId, testPlayerId, round_players row)
  - [x] Test: `{ isSub: true }` → 200, DB is_sub = 1 verified
  - [x] Test: `{ isSub: false }` → 200, DB is_sub = 0 verified
  - [x] Test: unknown `roundId` → 404 NOT_FOUND
  - [x] Test: player not in round → 404 NOT_FOUND
  - [x] Test: missing `isSub` → 400 VALIDATION_ERROR
  - [x] `afterEach` resets `round_players.is_sub = 0`

- [x] Task 4: Typecheck and lint (AC: #9, #10)
  - [x] `pnpm --filter @wolf-cup/api typecheck` — zero errors
  - [x] `pnpm --filter @wolf-cup/api lint` — zero errors
  - [x] `pnpm --filter @wolf-cup/api test` — 55/55 passing

## Dev Notes

### What Previous Stories Already Provide

**From Story 2.1 (DB Schema):**

The `round_players` table already has `is_sub INTEGER NOT NULL DEFAULT 0`. No migration required.

```
round_players: id, round_id, player_id, group_id, handicap_index, is_sub (0/1)
uniqueIndex: uniq_round_players ON (round_id, player_id)
```

Drizzle schema field:
```ts
// apps/api/src/db/schema.ts line 135
isSub: integer('is_sub').notNull().default(0), // boolean 0/1
```

**From Story 2.3 (roster.ts patterns):**

The `PATCH /rounds/:roundId/players/:playerId/handicap` endpoint in `apps/api/src/routes/admin/roster.ts` is the **direct template** for this story's endpoint. Same structure:
- Parse roundId + playerId from params
- Validate body with a Zod schema
- Check `round_players` row exists → 404 `'Player not in round'` if missing
- `db.update(roundPlayers).set({...}).where(and(eq(...), eq(...)))`
- Return updated resource

**From Story 2.4 (rounds.ts):**

The `rounds` table and `rounds` Drizzle export are available. The sub endpoint must first check round existence (same pattern as other round-scoped routes). Import `rounds` from schema if not already imported in `roster.ts`.

Note: Currently `roster.ts` imports:
```ts
import { players, roundPlayers } from '../../db/schema.js';
```
You need to add `rounds` to this import for the round-existence check.

### Critical Implementation Rules

**Boolean → integer conversion:**
Drizzle/SQLite stores booleans as integers (0/1). `z.boolean()` will give you a JS boolean. Convert before writing to DB:
```ts
const { isSub } = result.data; // boolean
await db.update(roundPlayers)
  .set({ isSub: isSub ? 1 : 0 })
  .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.playerId, playerId)));
```

**Response shape:** The response only needs to confirm the update — include `roundId`, `playerId`, and the resulting `isSub` integer value (0 or 1):
```ts
return c.json({ roundPlayer: { roundId, playerId, isSub: isSub ? 1 : 0 } }, 200);
```

**No `.returning()` needed:** The update doesn't need to return DB rows since we already know all fields. Just verify it doesn't throw.

**Round-existence check order:** Check round exists FIRST, then check player-in-round. This matches the established pattern from `rounds.ts` (round → group → player order).

**No new schema refine needed:** `updateSubStatusSchema` is just `z.object({ isSub: z.boolean() })` — no `.refine()` since `isSub` is required (not optional).

### Where to Add the Handler

Add inside `apps/api/src/routes/admin/roster.ts` AFTER the existing `PATCH /rounds/:roundId/players/:playerId/handicap` handler, before `export default app`:

```ts
// ---------------------------------------------------------------------------
// PATCH /rounds/:roundId/players/:playerId/sub — mark/unmark as sub
// ---------------------------------------------------------------------------

app.patch(
  '/rounds/:roundId/players/:playerId/sub',
  adminAuthMiddleware,
  async (c) => {
    // ... implementation
  },
);
```

### Zod Schema

```ts
// apps/api/src/schemas/sub.ts
import { z } from 'zod';

export const updateSubStatusSchema = z.object({
  isSub: z.boolean(),
});

export type UpdateSubStatusBody = z.infer<typeof updateSubStatusSchema>;
```

Note: `z.boolean()` rejects non-boolean values. JSON `true`/`false` parse correctly. `0`/`1` integers do NOT pass `z.boolean()` — this is intentional. The API client must send actual JSON booleans.

### Test Pattern

Add to `apps/api/src/routes/admin/roster.test.ts`. The existing `beforeAll` already seeds `testRoundId` and `testPlayerId`. You need a `round_players` row for the tests. Options:

**Option A:** Add a second player to `beforeAll` and create a `round_players` row specifically for sub tests (keep separate from existing handicap test row to avoid conflicts).

**Option B:** Reuse `testRoundId` and `testPlayerId` but add a `round_players` row in `beforeAll` with `is_sub: 0`, and clean up in `afterEach`.

The simplest approach: in `beforeAll`, after the existing setup, also insert a round_players row for sub testing:
```ts
// Seed a round_players row for sub tests (isSub starts at 0)
await db.insert(roundPlayers).values({
  roundId: testRoundId,
  groupId: testGroupId,
  playerId: testPlayerId,
  handicapIndex: 10.0,
  isSub: 0,
});
```

In `afterEach` for sub tests: reset `is_sub = 0` on that row.

Note: Check `roster.test.ts` to see what `testRoundId`, `testGroupId`, `testPlayerId` already exist — use them. If they don't exist in that test file (roster.test.ts only seeds players, not rounds), you'll need to seed the round and group in `beforeAll`.

**Look at the current roster.test.ts `beforeAll`** to understand what's seeded. It seeds:
- Players → `testPlayerId`

But it does NOT seed rounds/groups. So you'll need to also seed a round + group + round_players row in `beforeAll` for the sub endpoint tests. Or use a separate `describe` block with its own local setup.

Actually the cleanest approach: use a `beforeAll` that seeds whatever is needed within the sub test describe block, using the shared in-memory DB (same mock pattern):

```ts
describe('PATCH /rounds/:roundId/players/:playerId/sub', () => {
  let subTestRoundId: number;
  let subTestGroupId: number;

  beforeAll(async () => {
    // Seed a season
    const [season] = await db.insert(seasons).values({...}).returning();
    // Seed a round
    const [round] = await db.insert(rounds).values({...}).returning();
    subTestRoundId = round!.id;
    // Seed a group
    const [group] = await db.insert(groups).values({...}).returning();
    subTestGroupId = group!.id;
    // Seed a round_players row (isSub: 0)
    await db.insert(roundPlayers).values({
      roundId: subTestRoundId,
      groupId: subTestGroupId,
      playerId: testPlayerId,
      handicapIndex: 10.0,
      isSub: 0,
    });
  });

  afterEach(async () => {
    // Reset is_sub to 0 after each test
    await db.update(roundPlayers)
      .set({ isSub: 0 })
      .where(and(eq(roundPlayers.roundId, subTestRoundId), eq(roundPlayers.playerId, testPlayerId)));
  });

  it('marks player as sub (isSub: true → 200, DB is_sub = 1)', ...);
  it('converts sub to full member (isSub: false → 200, DB is_sub = 0)', ...);
  it('returns 404 NOT_FOUND for unknown roundId', ...);
  it('returns 404 NOT_FOUND for player not in round', ...);
  it('returns 400 VALIDATION_ERROR when isSub is missing', ...);
});
```

You need to import `seasons`, `rounds`, `groups` in addition to the existing imports in `roster.test.ts`.

### Imports Needed

In `roster.ts` — add `rounds` to the schema import:
```ts
import { players, roundPlayers, rounds } from '../../db/schema.js';
```

In `roster.ts` — add sub schema import:
```ts
import { updateSubStatusSchema } from '../../schemas/sub.js';
```

In `roster.test.ts` — additional imports for seeding:
```ts
import { players, roundPlayers, rounds, groups, seasons } from '../../db/schema.js';
```

### Architecture References

- [Source: architecture.md#Authentication] — sub endpoint under `/api/admin/rounds/...` is admin-protected
- [Source: architecture.md#API Patterns] — route prefix `/api/admin`, mounted via `app.route('/api/admin', adminRosterRouter)` in `index.ts`
- [Source: architecture.md#Data Architecture] — `round_players.is_sub` is the primary field for sub tracking
- FR50: Mark player as sub for a round → `is_sub = 1`
- FR51: Convert sub to full league member before playoff cutoff → `is_sub = 0`
- FR43: Sub player results tracked separately from full member standings (downstream, Epic 4 — this story only sets the flag)
- No new DB migration needed — `is_sub` field exists in the schema from Story 2.1

### Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- 55/55 tests passing (50 pre-existing + 5 new sub tests)
- No new migration needed — `round_players.is_sub` was already in schema from Story 2.1
- Boolean→integer conversion: `isSub ? 1 : 0` before DB write; response reflects integer value (0 or 1)
- Reused existing `roster.test.ts` `beforeAll` seed — testRoundId, testGroupId, testPlayerId, and round_players row all available

### File List

- `apps/api/src/schemas/sub.ts` — new
- `apps/api/src/routes/admin/roster.ts` — updated (added `rounds` import, `updateSubStatusSchema` import, PATCH sub handler)
- `apps/api/src/routes/admin/roster.test.ts` — updated (afterEach reset + 5 sub tests)
