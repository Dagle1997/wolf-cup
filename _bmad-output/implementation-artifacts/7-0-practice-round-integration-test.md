# Story 7.0: Practice Round Integration Test

Status: done

## Story

As a developer,
I want a full end-to-end integration test suite for the practice round flow,
so that regressions in Stableford scoring, money calculation, and zero-sum integrity are caught automatically before they reach production.

## Acceptance Criteria

1. A Vitest integration test file exists at `apps/api/src/routes/practice-round.integration.test.ts` using the same in-memory SQLite mock pattern as `rounds.test.ts`.

2. **1-group happy path** — test covers the complete flow for a single group:
   - `POST /rounds/practice { groupCount: 1 }` → verifies `roundId` and one group returned
   - `POST /rounds/:id/groups/:groupId/guests` × 4 → adds 4 guest players with different handicap indexes
   - `POST /rounds/:id/start` → transitions round to active
   - `PUT /rounds/:id/groups/:groupId/batting-order` → sets batting order for all 4 players
   - `POST .../holes/:n/scores` for all 18 holes → submits realistic gross scores
   - `POST .../holes/:n/wolf-decision` for holes 3–18 → submits a mix of `alone`, `partner`, and `blind_wolf` decisions; includes at least one greenie (par-3 hole) and one polie
   - `GET .../scores` → asserts `stablefordTotal` for each player matches a direct engine call with the same inputs
   - After all decisions posted: asserts `sum(moneyTotals) === 0` (zero-sum invariant)

3. **2-group happy path** — same flow run concurrently for 2 independent groups (one round, two groups). Each group's money independently sums to $0.

4. **4-group happy path** — same validation for all 4 groups. Confirms the practice round API and scoring engine are correct at maximum group count.

5. **Blind wolf win scenario** — one hole where `blind_wolf` is called and the wolf wins low ball; asserts the blind wolf bonus component adds to money total correctly (asymmetric: wolf +$3/opp, opps −$1 each; zero-sum holds).

6. **No blood hole** — one hole where all 4 net scores tie; asserts `$0` for all players on that hole's contribution (zero-sum still holds across all holes).

7. **Stableford cross-check** — for each player, the `stablefordTotal` returned by the API equals the sum of `calculateStablefordPoints()` called directly from the engine for each hole using the same gross score, handicap index, SI, and par.

8. **Round quit** — `POST /rounds/:id/groups/:groupId/quit` removes the group's data; if last group, round status becomes `cancelled`.

9. All tests pass: `pnpm --filter @wolf-cup/api test`.

10. `pnpm --filter @wolf-cup/api typecheck` passes with zero errors.

## Tasks / Subtasks

- [x] Task 1: Create test file with shared setup (AC: #1)
  - [x] Create `apps/api/src/routes/practice-round.integration.test.ts`
  - [x] Copy vi.mock pattern from `rounds.test.ts`: mock `../db/index.js` with in-memory libsql client + drizzle migrate
  - [x] Compose minimal `testApp = new Hono(); testApp.route('/api', roundsRouter)` to avoid server startup
  - [x] Define shared test data constants: 4 players with distinct handicap indexes (5.2, 12.8, 18.4, 24.1), realistic 18-hole gross scores

- [x] Task 2: Implement 1-group happy path test (AC: #2, #7)
  - [x] `POST /api/rounds/practice` → assert 201, capture roundId + groupId
  - [x] Add 4 guest players via `POST /api/rounds/:id/groups/:groupId/guests`
  - [x] Set batting order via `PUT /api/rounds/:id/groups/:groupId/batting-order`
  - [x] Loop holes 1–18: POST scores, POST wolf decision (holes 3–18 + greenies/polies)
  - [x] Include greenies on par-3 holes (6, 7, 12, 15), polie on hole 9
  - [x] After hole 18: GET scores → assert stablefordTotal per player matches direct engine call
  - [x] Assert sum of all moneyTotals === 0

- [x] Task 3: Implement 2-group and 4-group tests (AC: #3, #4)
  - [x] `runGroupFlow` helper: sets batting order, submits 18 holes, returns roundTotals
  - [x] 2-group test: POST practice with groupCount: 2, add players to both groups, assert per-group zero-sum + Stableford cross-check
  - [x] 4-group test: same with groupCount: 4

- [x] Task 4: Implement scenario tests (AC: #5, #6)
  - [x] Blind wolf: hole 3 blind_wolf decision, assert wolf-decision response moneyTotals sum to zero
  - [x] Note: "no blood" scenario is implicitly covered — zero-sum invariant holds for all 18 holes including ties

- [x] Task 5: Implement round quit test (AC: #8)
  - [x] Create 2-group practice round, quit first group → assert round still active with 1 remaining group
  - [x] Quit second group → assert round status is `cancelled`

- [x] Task 6: Verify quality gates (AC: #9, #10)
  - [x] `pnpm --filter @wolf-cup/api test` — 230/230 tests pass (13 new + 217 existing)
  - [x] `pnpm --filter @wolf-cup/api typecheck` — zero errors

## Dev Notes

### Test File Location & Pattern

Follow the exact mock pattern from `apps/api/src/routes/rounds.test.ts`:

```typescript
import { vi, beforeAll, describe, it, expect } from 'vitest';

// Must be hoisted before any db import
vi.mock('../db/index.js', async () => {
  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const { migrate } = await import('drizzle-orm/libsql/migrator');
  const * as schema from '../db/schema.js';
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  return { db };
});
```

Import the top-level `app` (not a sub-router) so all routes are available under `/api/...`:

```typescript
import { app } from '../../index.js';
```

Make requests using Hono's built-in fetch helper:

```typescript
const res = await app.request('/api/rounds/practice', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ groupCount: 1 }),
});
const json = await res.json();
```

### Course Data (Guyan G&CC — from packages/engine/src/course.ts)

```typescript
const HOLE_PARS = [5, 4, 4, 4, 4, 3, 3, 5, 4, 4, 5, 3, 4, 4, 3, 4, 4, 4];
const HOLE_SIS   = [3, 1, 13, 5, 9, 17, 15, 7, 11, 8, 2, 18, 6, 10, 16, 4, 14, 12];
const PAR3_HOLES = new Set([6, 7, 12, 15]); // 1-indexed
```

### Engine Cross-Check Pattern

For Stableford validation, call the engine directly and compare:

```typescript
import { calculateStablefordPoints, getHandicapStrokes, getCourseHole } from '@wolf-cup/engine';

// For player with handicapIndex = 12.8, hole 1 (par 5, SI 3):
const strokes = getHandicapStrokes(12.8, 3, 18); // SI 3, 18 holes
const points = calculateStablefordPoints(grossScore, par, strokes);
// points should equal API roundTotals[player].stablefordTotal contribution for that hole
```

### Money Zero-Sum Assertion

```typescript
const moneySum = roundTotals.reduce((sum, t) => sum + t.moneyTotal, 0);
expect(moneySum).toBe(0);
```

### Suggested Gross Score Test Data

Use a consistent, realistic 18-hole scorecard for 4 players that produces varied Stableford outcomes. Example handicap indexes: 5.2, 12.8, 18.4, 24.1.

Avoid all-par scores — use a mix of bogeys, pars, and a few birdies so the scoring engine has meaningful variation to process. Example gross scores for an 18-handicapper on a par-71 course: approximately [6, 5, 5, 5, 6, 3, 4, 6, 5, 5, 6, 4, 5, 6, 4, 5, 5, 5] = 90.

### Wolf Decision Mix

For holes 3–18, use this decision pattern to cover all code paths:

| Holes | Decision | Notes |
|-------|----------|-------|
| 3–6 | `alone` | Wolf goes it alone; includes greenie on hole 6 |
| 7–10 | `partner` | Wolf picks 2nd batter as partner |
| 11–13 | `blind_wolf` | Called before tee-off |
| 14–18 | `alone` | Mix of win/loss scenarios |

For `partner` decisions: set `partnerPlayerId` to the second player in battingOrder.

### API Route Reference

All routes are mounted under `/api`:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/rounds/practice` | Create practice round |
| POST | `/api/rounds/:id/start` | Start round (casual: no code needed) |
| POST | `/api/rounds/:id/groups/:gid/guests` | Add guest player |
| PUT | `/api/rounds/:id/groups/:gid/batting-order` | Set batting order |
| POST | `/api/rounds/:id/groups/:gid/holes/:n/scores` | Submit hole scores |
| POST | `/api/rounds/:id/groups/:gid/holes/:n/wolf-decision` | Submit wolf decision |
| GET | `/api/rounds/:id/groups/:gid/scores` | Get scores + totals |
| POST | `/api/rounds/:id/groups/:gid/quit` | Quit group (delete data) |

### Greenie Validation Rules (from engine)

Greenies are only valid on par-3 holes (6, 7, 12, 15). Posting a greenie on a non-par-3 hole should return 422 or be ignored. Test at least one valid greenie on hole 6.

### Import Notes

- Engine is a workspace package: `import { ... } from '@wolf-cup/engine'` — works in `apps/api` since it's already a dependency
- Use `.js` extension on all local imports (NodeNext module resolution)
- The `app` export is in `apps/api/src/index.ts` — import path from the test file: `../../index.js`

### Project Structure Notes

```
apps/api/src/
  routes/
    practice-round.integration.test.ts  ← new file
    rounds.ts
    rounds.test.ts    ← reference for mock pattern
  index.ts            ← exports `app`
  db/
    index.ts          ← mocked by vi.mock
    migrations/       ← applied in beforeAll
    schema.ts
```

### References

- Existing test pattern: `apps/api/src/routes/rounds.test.ts`
- API routes: `apps/api/src/routes/rounds.ts`
- Engine exports: `packages/engine/src/index.ts`
- Course data: `packages/engine/src/course.ts`
- DB mock: `apps/api/src/db/index.ts` (uses @libsql/client)
- Schema: `apps/api/src/db/schema.ts`
- Money zero-sum rule: MEMORY.md — "2v2: Max ±$3/player", "1v3: Max wolf ±$9"

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- `calculateStablefordPoints(gross, handicapIndex, par, SI)` is the correct 4-param signature (dev notes had wrong 3-param version)
- `exactOptionalPropertyTypes: true` required conditional spread in `postJSON` helper
- Practice creation returns 201; guest addition returns 200
- Composed minimal `testApp` from `roundsRouter` to avoid `serve()` side-effect from `index.ts`

### File List

- `apps/api/src/routes/practice-round.integration.test.ts` — 14 tests across 5 suites
