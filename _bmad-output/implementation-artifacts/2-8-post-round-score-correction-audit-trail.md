# Story 2.8: Post-Round Score Correction & Audit Trail

Status: done

## Story

As an admin (Jason or Josh),
I want to correct per-hole gross scores and wolf decisions on finalized rounds and have every change recorded in an immutable audit log,
so that scoring errors caught during post-round scorecard review can be fixed without voiding and re-entering the entire round.

## Acceptance Criteria

### Score Correction Endpoint — FR64

1. `POST /api/admin/rounds/:roundId/corrections` (protected by `adminAuthMiddleware`) accepts `{ holeNumber: number, fieldName: string, playerId?: number, groupId?: number, newValue: string }`; returns `{ correction: { id, adminUserId, roundId, holeNumber, playerId, fieldName, oldValue, newValue, correctedAt } }` HTTP 201.

2. `POST /api/admin/rounds/:roundId/corrections` returns `{ error: 'Round not found', code: 'NOT_FOUND' }` HTTP 404 when the round does not exist.

3. `POST /api/admin/rounds/:roundId/corrections` returns `{ error: 'Round is not finalized', code: 'ROUND_NOT_FINALIZED' }` HTTP 422 when `round.status !== 'finalized'`.

4. `fieldName: 'grossScore'` requires `playerId`; if missing, returns 400 VALIDATION_ERROR.

5. `fieldName: 'wolfDecision'` and `fieldName: 'wolfPartnerId'` require `groupId`; if missing, returns 400 VALIDATION_ERROR.

6. `fieldName` must be one of `['grossScore', 'wolfDecision', 'wolfPartnerId']`; any other value returns 400 VALIDATION_ERROR.

7. For `fieldName: 'grossScore'`: reads the current value from `hole_scores` (roundId + playerId + holeNumber); if no row found, returns `{ error: 'Score not found', code: 'NOT_FOUND' }` HTTP 404. Updates `hole_scores.grossScore` to `Number(newValue)`. `newValue` must parse to an integer between 1 and 20 (inclusive); invalid value returns 400 VALIDATION_ERROR.

8. For `fieldName: 'wolfDecision'`: reads current `wolf_decisions.decision` (roundId + groupId + holeNumber); if no row found, returns 404 NOT_FOUND. `newValue` must be `'alone'`, `'partner'`, or `'blind_wolf'`; invalid value returns 400 VALIDATION_ERROR. Updates `wolf_decisions.decision`.

9. For `fieldName: 'wolfPartnerId'`: reads current `wolf_decisions.partnerPlayerId` (roundId + groupId + holeNumber); if no row found, returns 404 NOT_FOUND. `newValue` must be a stringified positive integer (player ID) or `'null'` (to clear the partner). If a player ID is provided, verifies the player exists → 404 if not. Updates `wolf_decisions.partnerPlayerId`.

10. Every accepted correction creates a row in `score_corrections`: `adminUserId` (from session via `c.get('adminId')`), `roundId`, `holeNumber`, `playerId` (null for wolf fields), `fieldName`, `oldValue` (current DB value as string; null values serialized as `'null'`), `newValue`, `correctedAt: Date.now()`.

11. The audit log is immutable — no DELETE or UPDATE endpoint exists for `score_corrections`.

12. `GET /api/admin/rounds/:roundId/corrections` returns `{ items: [...corrections in reverse-chronological order by correctedAt] }` HTTP 200. Returns 404 NOT_FOUND when round does not exist.

### Schema & Infrastructure

13. `apps/api/src/db/schema.ts` exports `scoreCorrections` table:
    ```ts
    export const scoreCorrections = sqliteTable('score_corrections', {
      id: integer('id').primaryKey({ autoIncrement: true }),
      adminUserId: integer('admin_user_id').notNull().references(() => admins.id),
      roundId: integer('round_id').notNull().references(() => rounds.id),
      holeNumber: integer('hole_number').notNull(),
      playerId: integer('player_id').references(() => players.id), // nullable (wolf fields)
      fieldName: text('field_name').notNull(),
      oldValue: text('old_value').notNull(),
      newValue: text('new_value').notNull(),
      correctedAt: integer('corrected_at').notNull(),
    });
    ```

14. A new Drizzle migration is generated (`apps/api/src/db/migrations/0001_*.sql`) by running `pnpm --filter @wolf-cup/api db:generate` after schema update.

15. `apps/api/src/index.ts` imports and mounts `adminScoreCorrectionsRouter` at `/api/admin`.

16. `pnpm --filter @wolf-cup/api typecheck` passes with zero errors.

17. `pnpm --filter @wolf-cup/api lint` passes with zero errors.

18. `pnpm --filter @wolf-cup/api test` passes with tests covering all ACs above.

## Tasks / Subtasks

- [x] Task 1: Add `scoreCorrections` table to `apps/api/src/db/schema.ts` and generate migration (AC: #13, #14)
  - [x] Add `scoreCorrections` table definition to schema.ts (after `sideGameResults`)
  - [x] Run `pnpm --filter @wolf-cup/api db:generate` to generate `0001_*.sql` migration
  - [x] Verify migration file created in `apps/api/src/db/migrations/`

- [x] Task 2: Create `apps/api/src/schemas/score-correction.ts` (AC: #4–#9)
  - [x] Export `createScoreCorrectionSchema` with all fields + refines (grossScore requires playerId; wolfDecision/wolfPartnerId require groupId; fieldName enum)
  - [x] Export inferred type `CreateScoreCorrectionBody`

- [x] Task 3: Create `apps/api/src/routes/admin/score-corrections.ts` (AC: #1–#12)
  - [x] `POST /rounds/:roundId/corrections` — validate round exists → 404, check status === 'finalized' → 422, validate body, dispatch to field-specific handler, insert audit log, return 201
  - [x] `GET /rounds/:roundId/corrections` — validate round exists → 404, return items ordered by `correctedAt DESC`

- [x] Task 4: Mount router in `apps/api/src/index.ts` (AC: #15)
  - [x] Add import + `app.route('/api/admin', adminScoreCorrectionsRouter)`

- [x] Task 5: Create `apps/api/src/routes/admin/score-corrections.test.ts` (AC: #18)
  - [x] Set up in-memory DB mock (same pattern as all other test files)
  - [x] `beforeAll`: migrate, seed admin, season, round (status: 'finalized'), group, player, hole_score row, wolf_decisions row
  - [x] `afterEach`: delete test-created score_corrections rows
  - [x] POST grossScore correction tests (201 happy path, 404 unknown round, 422 not finalized, 400 missing playerId, 404 score not found, 400 invalid newValue)
  - [x] POST wolfDecision correction tests (201 happy path, 400 missing groupId, 404 wolf decision not found, 400 invalid newValue)
  - [x] POST wolfPartnerId correction tests (201 set partner, 201 clear partner to 'null', 404 unknown player)
  - [x] POST fieldName validation tests (400 unknown fieldName)
  - [x] GET corrections tests (200 empty list, 200 non-empty list in reverse order, 404 unknown round)

- [x] Task 6: Typecheck, lint, test (AC: #16, #17, #18)
  - [x] `pnpm --filter @wolf-cup/api typecheck` — zero errors
  - [x] `pnpm --filter @wolf-cup/api lint` — zero errors
  - [x] `pnpm --filter @wolf-cup/api test` — all passing

## Dev Notes

### What Previous Stories Already Provide

**From Story 2.1 (DB Schema) — ALL source data tables already exist:**

```ts
// hole_scores — correctable for 'grossScore'
export const holeScores = sqliteTable('hole_scores', {
  id, roundId, groupId, playerId,
  holeNumber, grossScore, createdAt, updatedAt
  // uniqueIndex on (roundId, playerId, holeNumber)
});

// wolf_decisions — correctable for 'wolfDecision', 'wolfPartnerId'
export const wolfDecisions = sqliteTable('wolf_decisions', {
  id, roundId, groupId, holeNumber, wolfPlayerId,
  decision,        // 'partner' | 'alone' | 'blind_wolf'
  partnerPlayerId, // nullable
  outcome,         // 'win' | 'loss' | 'push' | null
  createdAt
});
```

**`scoreCorrections` table is NEW and requires migration** — this is the first migration since Story 2.1 (`0000_busy_toad_men.sql`). The new migration will be `0001_*.sql`.

**From Stories 2.2–2.7 (established patterns):**
- In-memory DB mock: `vi.mock('../../db/index.js', ...)` with `file::memory:?cache=shared`
- adminAuthMiddleware mock: `c.set('adminId' as never, 1 as never)` — this is how `c.get('adminId')` returns `1` for audit log in tests
- Route validation: `Number(param)` + `Number.isInteger(id) && id > 0`
- Error shape: `{ error: string, code: string }` (and `issues: [...]` for VALIDATION_ERROR)
- `safeParse` + `result.success` pattern for all body validation
- `select({ id: table.id }).from(table).where(eq(...)).get()` for existence checks
- `.returning()` on insert for created row data
- `eq`, `and` from `drizzle-orm`

### Critical Implementation Details

**`score_corrections` table — full definition:**
```ts
import { admins, rounds, players } from './schema.js'; // existing tables

export const scoreCorrections = sqliteTable(
  'score_corrections',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    adminUserId: integer('admin_user_id').notNull().references(() => admins.id),
    roundId: integer('round_id').notNull().references(() => rounds.id),
    holeNumber: integer('hole_number').notNull(),
    playerId: integer('player_id').references(() => players.id), // nullable
    fieldName: text('field_name').notNull(),
    oldValue: text('old_value').notNull(),
    newValue: text('new_value').notNull(),
    correctedAt: integer('corrected_at').notNull(),
  },
  (t) => ({
    roundIdx: index('idx_score_corrections_round_id').on(t.roundId),
  }),
);
```

**Generating the migration:**
After adding the table to schema.ts, run:
```bash
pnpm --filter @wolf-cup/api db:generate
```
This produces `apps/api/src/db/migrations/0001_<name>.sql`. Commit this file. The test setup uses `migrate(db, { migrationsFolder })` which will automatically apply it.

**Schema Zod validation:**
```ts
export const createScoreCorrectionSchema = z
  .object({
    holeNumber: z.number().int().min(1).max(18),
    fieldName: z.enum(['grossScore', 'wolfDecision', 'wolfPartnerId']),
    playerId: z.number().int().positive().optional(),
    groupId: z.number().int().positive().optional(),
    newValue: z.string().min(1),
  })
  .refine(
    (data) =>
      data.fieldName !== 'grossScore' || data.playerId !== undefined,
    { message: 'playerId is required for grossScore corrections' },
  )
  .refine(
    (data) =>
      (data.fieldName !== 'wolfDecision' && data.fieldName !== 'wolfPartnerId') ||
      data.groupId !== undefined,
    { message: 'groupId is required for wolf field corrections' },
  );

export type CreateScoreCorrectionBody = z.infer<typeof createScoreCorrectionSchema>;
```

**POST handler — field dispatch pattern:**
```ts
// After round exists + finalized checks, after body validation:
const { holeNumber, fieldName, playerId, groupId, newValue } = result.data;
const adminUserId = c.get('adminId' as never) as number;

let oldValue: string;

if (fieldName === 'grossScore') {
  // 1. Read current gross score
  const row = await db.select({ grossScore: holeScores.grossScore, id: holeScores.id })
    .from(holeScores)
    .where(and(
      eq(holeScores.roundId, roundId),
      eq(holeScores.playerId, playerId!),
      eq(holeScores.holeNumber, holeNumber),
    ))
    .get();
  if (!row) return c.json({ error: 'Score not found', code: 'NOT_FOUND' }, 404);

  // 2. Validate new value
  const parsed = parseInt(newValue, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR',
      issues: [{ message: 'grossScore must be an integer 1–20' }] }, 400);
  }

  oldValue = String(row.grossScore);

  // 3. Update hole_scores
  await db.update(holeScores)
    .set({ grossScore: parsed, updatedAt: Date.now() })
    .where(eq(holeScores.id, row.id));

} else if (fieldName === 'wolfDecision') {
  // Read from wolf_decisions, validate, update
  ...
} else {
  // wolfPartnerId
  ...
}

// 4. Insert audit log (always, regardless of field)
const [correction] = await db.insert(scoreCorrections).values({
  adminUserId,
  roundId,
  holeNumber,
  playerId: playerId ?? null,
  fieldName,
  oldValue,
  newValue,
  correctedAt: Date.now(),
}).returning();

return c.json({ correction }, 201);
```

**GET handler — reverse-chronological order:**
```ts
import { desc } from 'drizzle-orm';

const items = await db.select()
  .from(scoreCorrections)
  .where(eq(scoreCorrections.roundId, roundId))
  .orderBy(desc(scoreCorrections.correctedAt));
return c.json({ items }, 200);
```

**`wolfPartnerId` null serialization:**
```ts
// oldValue when partnerPlayerId is null:
oldValue = row.partnerPlayerId !== null ? String(row.partnerPlayerId) : 'null';

// newValue 'null' → set DB to null:
const newPartnerId = newValue === 'null' ? null : parseInt(newValue, 10);
```

**422 status code for non-finalized round:**
```ts
return c.json({ error: 'Round is not finalized', code: 'ROUND_NOT_FINALIZED' }, 422);
```

Note: 422 Unprocessable is the correct code for this (per architecture API error spec), NOT 400 or 409.

**Note on engine recalculation:**
FR64 specifies "recalculates all affected net scores, Stableford points, money results, and YTD totals atomically". This full recalculation pipeline will be integrated in Epic 3 when the score submission endpoint (`POST /api/scores`) is built, since it requires the same engine wiring, round context loading, and atomic DB write pattern. Story 2.8 establishes the correction + audit trail infrastructure. The raw data updates to `hole_scores` and `wolf_decisions` are correct and persist — Epic 3 will add the downstream recalculation of `round_results` and `harvey_results` when the full scoring pipeline is built. This is a deliberate Epic 2/3 boundary.

### Test Setup Pattern

```ts
let testSeasonId: number;
let testRoundId: number;
let testGroupId: number;
let testPlayerId: number;
let testHoleScoreId: number;
let testWolfDecisionId: number;

beforeAll(async () => {
  await migrate(db, { migrationsFolder });

  const [season] = await db.insert(seasons).values({
    name: 'Test Season SC',
    startDate: '2026-01-01', endDate: '2026-12-31',
    totalRounds: 17, playoffFormat: 'top8', createdAt: Date.now(),
  }).returning();
  testSeasonId = season!.id;

  // IMPORTANT: Round must be 'finalized' for corrections to work
  const [round] = await db.insert(rounds).values({
    seasonId: testSeasonId, type: 'official', status: 'finalized',
    scheduledDate: '2026-06-06', autoCalculateMoney: 1, createdAt: Date.now(),
  }).returning();
  testRoundId = round!.id;

  const [group] = await db.insert(groups).values({
    roundId: testRoundId, groupNumber: 1, battingOrder: null,
  }).returning();
  testGroupId = group!.id;

  const [player] = await db.insert(players).values({
    name: 'Test Player SC', createdAt: Date.now(),
  }).returning();
  testPlayerId = player!.id;

  // Seed a hole score for grossScore correction tests
  const [hs] = await db.insert(holeScores).values({
    roundId: testRoundId, groupId: testGroupId, playerId: testPlayerId,
    holeNumber: 5, grossScore: 5, createdAt: Date.now(), updatedAt: Date.now(),
  }).returning();
  testHoleScoreId = hs!.id;

  // Seed a wolf decision for wolfDecision/wolfPartnerId correction tests
  const [wd] = await db.insert(wolfDecisions).values({
    roundId: testRoundId, groupId: testGroupId, holeNumber: 5,
    wolfPlayerId: testPlayerId, decision: 'partner', partnerPlayerId: null,
    createdAt: Date.now(),
  }).returning();
  testWolfDecisionId = wd!.id;
});

afterEach(async () => {
  // Delete test-created corrections
  await db.delete(scoreCorrections).where(eq(scoreCorrections.roundId, testRoundId));
  // Reset seeded hole_score to original value
  await db.update(holeScores).set({ grossScore: 5, updatedAt: Date.now() })
    .where(eq(holeScores.id, testHoleScoreId));
  // Reset seeded wolf_decision to original value
  await db.update(wolfDecisions)
    .set({ decision: 'partner', partnerPlayerId: null })
    .where(eq(wolfDecisions.id, testWolfDecisionId));
});
```

**⚠️ Important for tests:**
- `c.get('adminId')` returns `1` (the mocked admin ID) — the test seeds no admin row but uses it for `adminUserId` in audit log
- The 422 test needs a NON-finalized round — create a separate round with `status: 'scheduled'` in the test or `beforeAll`
- The correction for 'wolfPartnerId' to 'null' should produce `oldValue: 'null'` in the audit log when the current `partnerPlayerId` is already null, and `newValue: 'null'`

### FK Delete Order (afterEach)

`score_corrections` references `rounds` and `players` (FKs). Since we only delete `score_corrections` in afterEach (not the referenced rows), FK order doesn't matter here. The seeded `hole_scores` and `wolf_decisions` rows are reset (not deleted) to avoid FK complications.

### File Structure

```
apps/api/src/
  db/
    schema.ts              ← updated (add scoreCorrections table)
    migrations/
      0000_busy_toad_men.sql  ← existing (do not touch)
      0001_*.sql              ← NEW (generated by drizzle-kit)
  schemas/
    score-correction.ts    ← NEW
  routes/admin/
    score-corrections.ts      ← NEW
    score-corrections.test.ts ← NEW
  index.ts                 ← updated (import + mount adminScoreCorrectionsRouter)
```

### Architecture References

- [Source: architecture.md#Data Architecture] — "Score correction triggers full round recalculation" (deferred to Epic 3)
- [Source: architecture.md#API Patterns] — 422 for scoring engine validation failures
- [Source: architecture.md#Authentication] — `adminAuthMiddleware` on all `/api/admin/*` routes
- NFR29: "Admin edit operations on finalized round data must be atomic — all recalculations succeed or none are persisted" (raw data update is atomic; full downstream recalculation deferred to Epic 3)
- FR64: immutable audit log with admin_user_id, timestamp, round_id, hole_number, player_id, field_name, old_value, new_value

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- 103/103 tests passing (81 pre-existing + 22 new in score-corrections.test.ts after code review fixes)
- Migration `0001_third_frank_castle.sql` generated by drizzle-kit — creates `score_corrections` table with FK to admins, rounds, players
- Admin row must be seeded in `beforeAll` (id=1) since `score_corrections.admin_user_id` FK references `admins.id`; mock sets `adminId=1` via adminAuthMiddleware
- 422 `ROUND_NOT_FINALIZED` for non-finalized rounds; seeded a separate `status: 'scheduled'` round for that test
- `wolfPartnerId` null serialization: DB null → `'null'` string in oldValue; `newValue: 'null'` → DB null
- `afterEach` resets seeded hole_scores and wolf_decisions rows to original values (not deletes) to preserve FK integrity
- Engine recalculation explicitly deferred to Epic 3 — raw data updates (hole_scores, wolf_decisions) persist correctly

### File List

- `apps/api/src/db/schema.ts` — updated (add scoreCorrections table)
- `apps/api/src/db/migrations/0001_third_frank_castle.sql` — new (drizzle-kit generated: score_corrections table)
- `apps/api/src/db/migrations/0002_secret_lethal_legion.sql` — new (drizzle-kit generated: adds blind_wolf to wolf_decisions CHECK constraint)
- `apps/api/src/schemas/score-correction.ts` — new
- `apps/api/src/routes/admin/score-corrections.ts` — new
- `apps/api/src/routes/admin/score-corrections.test.ts` — new
- `apps/api/src/index.ts` — updated (import + mount adminScoreCorrectionsRouter)
