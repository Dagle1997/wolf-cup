# Story 2.6: Round Settings — Auto-Calculate & Harvey Toggle

Status: done

## Story

As an admin (Jason or Josh),
I want to toggle auto-calculate money mode per round and Harvey Cup live display per season,
so that I control whether money is auto-calculated during score entry and whether scorers see Harvey Cup points on the leaderboard.

## Acceptance Criteria

### FR32 — Auto-Calculate Money Toggle (rounds)

1. `PATCH /api/admin/rounds/:id` (protected by `adminAuthMiddleware`) accepts `{ autoCalculateMoney: boolean }` as part of the existing `updateRoundSchema`; returns the updated round JSON (sans `entryCodeHash`) HTTP 200.

2. When `autoCalculateMoney: true` is sent, `rounds.auto_calculate_money` is set to `1` in the database.

3. When `autoCalculateMoney: false` is sent, `rounds.auto_calculate_money` is set to `0` in the database.

4. `PATCH /api/admin/rounds/:id` with `{ autoCalculateMoney: "yes" }` (non-boolean) returns `{ error: 'Validation error', code: 'VALIDATION_ERROR', issues: [...] }` HTTP 400.

### FR41 — Harvey Live Toggle (seasons)

5. `PATCH /api/admin/seasons/:id` (protected by `adminAuthMiddleware`) accepts `{ harveyLiveEnabled: boolean }` as part of the existing `updateSeasonSchema`; returns the updated season JSON HTTP 200.

6. When `harveyLiveEnabled: true` is sent, `seasons.harvey_live_enabled` is set to `1` in the database.

7. When `harveyLiveEnabled: false` is sent, `seasons.harvey_live_enabled` is set to `0` in the database.

8. `PATCH /api/admin/seasons/:id` with `{ harveyLiveEnabled: "on" }` returns 400 VALIDATION_ERROR.

9. `PATCH /api/admin/seasons/99999` returns `{ error: 'Season not found', code: 'NOT_FOUND' }` HTTP 404.

### Schema & Quality

10. `updateRoundSchema` in `apps/api/src/schemas/round.ts` gains optional field `autoCalculateMoney: z.boolean().optional()` while preserving existing `.refine` (at least one field required).

11. `updateSeasonSchema` in `apps/api/src/schemas/season.ts` gains optional field `harveyLiveEnabled: z.boolean().optional()` while preserving existing `.refine`.

12. `pnpm --filter @wolf-cup/api typecheck` passes with zero errors.

13. `pnpm --filter @wolf-cup/api lint` passes with zero errors.

14. `pnpm --filter @wolf-cup/api test` passes with tests covering:
    - PATCH /rounds/:id `{ autoCalculateMoney: true }` → 200, DB `auto_calculate_money = 1` (FR32)
    - PATCH /rounds/:id `{ autoCalculateMoney: false }` → 200, DB `auto_calculate_money = 0` (FR32)
    - PATCH /seasons/:id `{ harveyLiveEnabled: true }` → 200, DB `harvey_live_enabled = 1` (FR41)
    - PATCH /seasons/:id `{ harveyLiveEnabled: false }` → 200, DB `harvey_live_enabled = 0` (FR41)
    - PATCH /seasons/:id with non-boolean → 400 VALIDATION_ERROR
    - PATCH /seasons/99999 → 404 NOT_FOUND
    - Plus baseline season CRUD tests (GET /seasons, POST /seasons valid, POST /seasons invalid)

## Tasks / Subtasks

- [x] Task 1: Extend schemas (AC: #10, #11)
  - [x] In `apps/api/src/schemas/round.ts`: add `autoCalculateMoney: z.boolean().optional()` to `updateRoundSchema` object before the `.refine`
  - [x] In `apps/api/src/schemas/season.ts`: add `harveyLiveEnabled: z.boolean().optional()` to `updateSeasonSchema` object before the `.refine`
  - [x] Update `UpdateRoundBody` and `UpdateSeasonBody` types (via `z.infer` — no manual change needed, they auto-pick up the new field)

- [x] Task 2: Wire `autoCalculateMoney` into rounds.ts PATCH handler (AC: #1–#4)
  - [x] In `apps/api/src/routes/admin/rounds.ts`, in the `PATCH /rounds/:id` handler, after the existing field guards (`status`, `headcount`, `scheduledDate`, `entryCode`), add:
    `if (result.data.autoCalculateMoney !== undefined) updates.autoCalculateMoney = result.data.autoCalculateMoney ? 1 : 0;`
  - [x] The `toRoundResponse()` helper already passes through `autoCalculateMoney` — no change needed

- [x] Task 3: Wire `harveyLiveEnabled` into season.ts PATCH handler (AC: #5–#9)
  - [x] In `apps/api/src/routes/admin/season.ts`, in the `PATCH /seasons/:id` handler, after the existing field guards, add:
    `if (result.data.harveyLiveEnabled !== undefined) updates.harveyLiveEnabled = result.data.harveyLiveEnabled ? 1 : 0;`

- [x] Task 4: Create `apps/api/src/routes/admin/season.test.ts` (AC: #14)
  - [x] Set up in-memory DB mock (same pattern as `roster.test.ts` and `rounds.test.ts`)
  - [x] Seed baseline season in `beforeAll`
  - [x] `afterEach` reset `harvey_live_enabled = 0`
  - [x] Tests: GET /seasons → 200 items array; POST /seasons (valid) → 201; POST /seasons (missing name) → 400; PATCH `{ harveyLiveEnabled: true }` → 200, DB = 1; PATCH `{ harveyLiveEnabled: false }` → 200, DB = 0; PATCH /99999 → 404; PATCH `{ harveyLiveEnabled: "on" }` → 400

- [x] Task 5: Add autoCalculateMoney tests to `rounds.test.ts` (AC: #14)
  - [x] In `apps/api/src/routes/admin/rounds.test.ts`, add two tests to the existing PATCH /rounds/:id describe block:
    - PATCH `{ autoCalculateMoney: true }` → 200, DB `auto_calculate_money = 1`
    - PATCH `{ autoCalculateMoney: false }` → 200, DB `auto_calculate_money = 0`
  - [x] Add `afterEach` reset for `auto_calculate_money = 1` (restore default)

- [x] Task 6: Typecheck and lint (AC: #12, #13)
  - [x] `pnpm --filter @wolf-cup/api typecheck` — zero errors
  - [x] `pnpm --filter @wolf-cup/api lint` — zero errors
  - [x] `pnpm --filter @wolf-cup/api test` — 60/60 passing

## Dev Notes

### What Previous Stories Already Provide

**From Story 2.1 (DB Schema):**

Both toggle fields are already in the DB — no migration required:
```
rounds.auto_calculate_money  INTEGER NOT NULL DEFAULT 1   (rounds table, line 84 schema.ts)
seasons.harvey_live_enabled  INTEGER NOT NULL DEFAULT 0   (seasons table, line 53 schema.ts)
```

**From Story 2.4 (rounds.ts patterns):**

`PATCH /api/admin/rounds/:id` already exists. The `updates` object pattern is established — add new fields with `if (field !== undefined)` guards. The `toRoundResponse()` helper strips `entryCodeHash` only; `autoCalculateMoney` passes through automatically.

**From Stories 2.1–2.4 (season.ts already exists):**

`apps/api/src/routes/admin/season.ts` is a complete file already mounted at `/api/admin`:
- GET /seasons — list all seasons
- POST /seasons — create season (createSeasonSchema)
- PATCH /seasons/:id — update season (updateSeasonSchema, missing `harveyLiveEnabled` wiring)

All three endpoints exist. Story 2.6 only adds `harveyLiveEnabled` to the existing PATCH handler and tests the full file.

### Critical Implementation Rules

**Boolean → integer conversion (same as Story 2.5 `isSub`):**
```ts
// In PATCH /rounds/:id handler:
if (result.data.autoCalculateMoney !== undefined) {
  updates.autoCalculateMoney = result.data.autoCalculateMoney ? 1 : 0;
}

// In PATCH /seasons/:id handler:
if (result.data.harveyLiveEnabled !== undefined) {
  updates.harveyLiveEnabled = result.data.harveyLiveEnabled ? 1 : 0;
}
```

**Schema `.refine` compatibility:** Both `updateRoundSchema` and `updateSeasonSchema` have `.refine((data) => Object.keys(data).length > 0)`. Adding optional fields to the `.object({...})` block does NOT break the refine — `{ autoCalculateMoney: false }` has 1 key, passes the guard. `{}` still has 0 keys, fails correctly.

**TypeScript: `Partial<typeof seasons.$inferInsert>`** includes `harveyLiveEnabled: number | undefined` since the schema stores integer 0/1. Assigning `result.data.harveyLiveEnabled ? 1 : 0` (a number) satisfies this type. ✓

### Where to Insert the Field in Schemas

**`schemas/round.ts` — add inside the `updateRoundSchema` object, before `.refine`:**
```ts
export const updateRoundSchema = z
  .object({
    status: z.enum(roundStatuses).optional(),
    headcount: z.number().int().positive().optional(),
    entryCode: z.string().min(1).optional(),
    scheduledDate: z.string().regex(dateRegex).optional(),
    autoCalculateMoney: z.boolean().optional(),   // ← ADD THIS
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field required',
  });
```

**`schemas/season.ts` — add inside the `updateSeasonSchema` object, before `.refine`:**
```ts
export const updateSeasonSchema = z
  .object({
    name: z.string().min(1).optional(),
    startDate: z.string().regex(dateRegex).optional(),
    endDate: z.string().regex(dateRegex).optional(),
    totalRounds: z.number().int().min(1).optional(),
    playoffFormat: z.string().min(1).optional(),
    harveyLiveEnabled: z.boolean().optional(),    // ← ADD THIS
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field required',
  });
```

### Test File Pattern for `season.test.ts`

Follow the exact same in-memory DB mock pattern as `roster.test.ts` and `rounds.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { Context, Next } from 'hono';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { eq } from 'drizzle-orm';

vi.mock('../../db/index.js', async () => {
  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../../db/schema.js');
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client, { schema });
  return { db };
});

vi.mock('../../middleware/admin-auth.js', () => ({
  adminAuthMiddleware: async (c: Context, next: Next) => {
    c.set('adminId' as never, 1 as never);
    await next();
  },
}));

import seasonApp from './season.js';
import { db } from '../../db/index.js';
import { seasons } from '../../db/schema.js';
import { migrate } from 'drizzle-orm/libsql/migrator';
```

**Note:** `file::memory:?cache=shared` is the shared in-memory DB string used across all test files. Each test file gets its own isolated DB instance because they run in separate Vitest worker processes.

**⚠️ WARNING:** Do NOT use `beforeAll` to seed data that's mutated by the toggle tests — use `afterEach` to reset `harvey_live_enabled = 0` so toggle tests don't bleed into each other.

### Seed pattern for `beforeAll`:
```ts
let testSeasonId: number;

beforeAll(async () => {
  await migrate(db, { migrationsFolder });

  const rows = await db.insert(seasons).values({
    name: 'Test Season',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    totalRounds: 17,
    playoffFormat: 'top8',
    createdAt: Date.now(),
  }).returning();
  testSeasonId = rows[0]!.id;
});

afterEach(async () => {
  // Reset harvey_live_enabled to default after toggle tests
  await db.update(seasons).set({ harveyLiveEnabled: 0 }).where(eq(seasons.id, testSeasonId));
});
```

### autoCalculateMoney Test Pattern (rounds.test.ts addition)

Add inside the existing `describe('PATCH /rounds/:id', ...)` block. The existing `beforeAll` already seeds `testRoundId`. Add an `afterEach` reset for the `auto_calculate_money` field (or add to the existing top-level `afterEach`).

```ts
it('sets autoCalculateMoney to 0 (off)', async () => {
  const res = await roundsApp.request(`/rounds/${testRoundId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoCalculateMoney: false }),
  });
  expect(res.status).toBe(200);
  const body = await res.json() as { round: { autoCalculateMoney: number } };
  expect(body.round.autoCalculateMoney).toBe(0);

  // Verify DB
  const row = await db.select({ auto: rounds.autoCalculateMoney })
    .from(rounds).where(eq(rounds.id, testRoundId)).get();
  expect(row?.auto).toBe(0);
});
```

Reset in afterEach for rounds tests: `await db.update(rounds).set({ autoCalculateMoney: 1 }).where(eq(rounds.id, testRoundId));`

### Architecture References

- [Source: architecture.md#Authentication] — `/api/admin/*` routes protected by `adminAuthMiddleware`
- [Source: architecture.md#Data Architecture] — `seasons.harvey_live_enabled`, `rounds.auto_calculate_money` fields
- FR32: Auto-calculate money mode toggle per round → `rounds.auto_calculate_money`
- FR41: Harvey live display toggle per season → `seasons.harvey_live_enabled`; off by default for regular season; always ON for playoff rounds (playoff override is a downstream concern — Story 2.6 only sets the admin-toggled flag)

### File Structure

```
apps/api/src/
  schemas/
    round.ts       ← add autoCalculateMoney: z.boolean().optional()
    season.ts      ← add harveyLiveEnabled: z.boolean().optional()
  routes/admin/
    rounds.ts      ← add autoCalculateMoney handler line in PATCH /rounds/:id
    season.ts      ← add harveyLiveEnabled handler line in PATCH /seasons/:id
    season.test.ts ← NEW — comprehensive season tests (~10 tests)
    rounds.test.ts ← add 2 autoCalculateMoney tests
```

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- 61/61 tests passing (55 pre-existing + 6 new: 3 in rounds.test.ts [2 toggle + 1 non-boolean AC#4], 3 in season.test.ts harvey block)
- No migration needed — `rounds.auto_calculate_money` (default 1) and `seasons.harvey_live_enabled` (default 0) already in DB schema from Story 2.1
- Boolean→integer conversion: `autoCalculateMoney ? 1 : 0` and `harveyLiveEnabled ? 1 : 0` before DB write
- `season.test.ts` already existed with 8 tests; added 3 harvey toggle tests + updated afterEach to reset `harveyLiveEnabled: 0`
- `rounds.test.ts` updated afterEach to also reset `autoCalculateMoney: 1`
- `toRoundResponse()` helper in rounds.ts passes through `autoCalculateMoney` automatically (only strips `entryCodeHash`)

### File List

- `apps/api/src/schemas/round.ts` — updated (add `autoCalculateMoney: z.boolean().optional()`)
- `apps/api/src/schemas/season.ts` — updated (add `harveyLiveEnabled: z.boolean().optional()`)
- `apps/api/src/routes/admin/rounds.ts` — updated (wire autoCalculateMoney in PATCH handler)
- `apps/api/src/routes/admin/season.ts` — updated (wire harveyLiveEnabled in PATCH handler)
- `apps/api/src/routes/admin/season.test.ts` — updated (3 new harvey toggle tests + afterEach reset)
- `apps/api/src/routes/admin/rounds.test.ts` — updated (2 new autoCalculateMoney tests + afterEach reset)
