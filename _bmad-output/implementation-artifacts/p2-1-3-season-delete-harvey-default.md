# Story P2.1.3: Season Delete & Harvey Default

Status: done

## Story

As an admin,
I want to delete a test season and have Harvey live default to ON when creating a new season,
so that I can clean up test data and avoid re-entering settings that never change.

## Acceptance Criteria

1. **Given** an admin views the list of seasons **When** they select delete on a season **Then** the season and all associated data (rounds, scores, results, attendance, pairing history) are permanently removed **And** a confirmation prompt warns "This will permanently delete all data for this season. This cannot be undone."

2. **Given** a season has finalized rounds with player data **When** the admin attempts to delete it **Then** the confirmation prompt includes the round count and player count to make the impact clear

3. **Given** an admin creates a new season **When** the season settings form is displayed **Then** the Harvey live toggle defaults to ON (enabled)

## Tasks / Subtasks

- [x] Task 1: Add `DELETE /admin/seasons/:id` API endpoint (AC: #1, #2)
  - [x] Add `GET /admin/seasons/:id/stats` to return round count + unique player count (for confirmation prompt)
  - [x] Add `DELETE /admin/seasons/:id` with manual cascading delete in a transaction (leaf tables first)
  - [x] Delete order: scoreCorrections → wolfDecisions → harveyResults → roundResults → holeScores → roundPlayers → groups → sideGameResults → rounds → sideGames → pairingHistory → seasonWeeks → season
  - [x] Return `{ deleted: true, seasonName }` on success

- [x] Task 2: Harvey live default to ON in create flow (AC: #3)
  - [x] Add optional `harveyLiveEnabled` boolean to `createSeasonSchema` (default: true)
  - [x] Update `POST /admin/seasons` handler to pass `harveyLiveEnabled` (default 1) to insert
  - [x] Update `CreateSeasonForm` UI to include Harvey live checkbox, defaulting to checked

- [x] Task 3: Season delete UI with confirmation (AC: #1, #2)
  - [x] Add delete button (destructive variant) to `EditSeasonPanel`
  - [x] On click, fetch `/admin/seasons/:id/stats` to get impact data
  - [x] Show confirmation via `window.confirm()` with round/player counts
  - [x] On confirm, call `DELETE /admin/seasons/:id`
  - [x] Invalidate seasons query and close panel on success

- [x] Task 4: Tests (AC: #1, #2, #3)
  - [x] API test: DELETE season with no rounds → success, verified season gone
  - [x] API test: DELETE season with rounds, groups, roundPlayers → all cascade deleted
  - [x] API test: DELETE non-existent season → 404
  - [x] API test: GET stats returns correct round/player counts + hasFinalized
  - [x] API test: GET stats 404 for non-existent season
  - [x] API test: POST season defaults harveyLiveEnabled to 1
  - [x] API test: POST season with harveyLiveEnabled: false → stored as 0

## Dev Notes

### Cascading Delete Strategy

**SQLite cannot ALTER existing foreign key constraints** — cannot add `ON DELETE CASCADE` to existing tables without recreating them. The safe approach is **manual cascading delete in a transaction**.

Delete order (leaf tables first, respecting FK dependencies):

```
season
├── seasonWeeks (has CASCADE — auto-deleted, but include for safety)
├── rounds
│   ├── scoreCorrections
│   ├── wolfDecisions
│   ├── harveyResults
│   ├── roundResults
│   ├── holeScores
│   ├── roundPlayers
│   ├── groups
│   └── sideGameResults
├── sideGames
└── pairingHistory
```

```typescript
await db.transaction(async (tx) => {
  // Get all round IDs for this season
  const seasonRounds = await tx
    .select({ id: rounds.id })
    .from(rounds)
    .where(eq(rounds.seasonId, seasonId));
  const roundIds = seasonRounds.map((r) => r.id);

  if (roundIds.length > 0) {
    // Delete round-dependent leaf tables
    for (const rid of roundIds) {
      await tx.delete(scoreCorrections).where(eq(scoreCorrections.roundId, rid));
      await tx.delete(wolfDecisions).where(eq(wolfDecisions.roundId, rid));
      await tx.delete(harveyResults).where(eq(harveyResults.roundId, rid));
      await tx.delete(roundResults).where(eq(roundResults.roundId, rid));
      await tx.delete(holeScores).where(eq(holeScores.roundId, rid));
      await tx.delete(roundPlayers).where(eq(roundPlayers.roundId, rid));
      await tx.delete(groups).where(eq(groups.roundId, rid));
      await tx.delete(sideGameResults).where(eq(sideGameResults.roundId, rid));
    }
    // Delete rounds themselves
    await tx.delete(rounds).where(eq(rounds.seasonId, seasonId));
  }

  // Delete season-level dependent tables
  await tx.delete(sideGames).where(eq(sideGames.seasonId, seasonId));
  await tx.delete(pairingHistory).where(eq(pairingHistory.seasonId, seasonId));
  await tx.delete(seasonWeeks).where(eq(seasonWeeks.seasonId, seasonId));

  // Delete the season
  await tx.delete(seasons).where(eq(seasons.id, seasonId));
});
```

**Important**: Use `inArray` from drizzle-orm instead of looping per round for efficiency:
```typescript
import { inArray } from 'drizzle-orm';
await tx.delete(scoreCorrections).where(inArray(scoreCorrections.roundId, roundIds));
```

### Harvey Live Default

**Current state**: `harveyLiveEnabled` has DB default of `0` (off), is not in `createSeasonSchema`, and is not in the create form UI.

**Changes needed**:
1. Add `harveyLiveEnabled` to `createSeasonSchema` as optional boolean defaulting to `true`
2. In POST handler, convert to `1`/`0` integer for DB: `harveyLiveEnabled: result.data.harveyLiveEnabled === false ? 0 : 1`
3. In UI, add checkbox defaulting to checked

### Stats Endpoint for Confirmation

```typescript
GET /admin/seasons/:id/stats
Response: {
  roundCount: number,      // total rounds in season
  playerCount: number,     // unique players across all rounds
  hasFinalized: boolean,   // any finalized rounds?
}
```

This is used by the UI to build the confirmation message before calling DELETE.

### Existing Patterns to Follow

- **Auth**: `adminAuthMiddleware` on all routes
- **Error codes**: `VALIDATION_ERROR`, `NOT_FOUND`, `INTERNAL_ERROR`
- **Transaction pattern**: `db.transaction(async (tx) => { ... })`
- **UI mutation pattern**: `useMutation` + `queryClient.invalidateQueries`
- **Confirmation UX**: No existing confirmation dialog pattern — use `window.confirm()` for simplicity (consistent with mobile-first approach, works on Android Chrome)

### Project Structure Notes

- Route changes: `apps/api/src/routes/admin/season.ts` (add DELETE + GET stats)
- Schema changes: `apps/api/src/schemas/season.ts` (add harveyLiveEnabled to create schema)
- Route changes: `apps/api/src/routes/admin/season.ts` (update POST to handle harveyLiveEnabled)
- UI changes: `apps/web/src/routes/admin/season.tsx` (delete button, Harvey checkbox in create form)
- Test changes: `apps/api/src/routes/admin/season.test.ts`
- No migration needed (no schema changes)
- No new packages needed

### References

- [Source: _bmad-output/planning-artifacts/epics-phase2.md — Story P2.1.3, lines 214-237]
- [Source: apps/api/src/db/schema.ts — all FK relationships]
- [Source: apps/api/src/routes/admin/season.ts — existing endpoints]
- [Source: apps/web/src/routes/admin/season.tsx — existing UI components]

### Testing Standards

- Vitest for API tests
- In-memory SQLite (`:memory?cache=shared`) for test DB
- Mock `adminAuthMiddleware` to bypass auth
- Seed a season with rounds, players, scores for cascade delete verification
- Verify child tables are empty after delete
- Verify Harvey default in POST response

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- SQLite FK enforcement is active (libsql client) — manual cascading delete required since existing FKs lack CASCADE and SQLite can't ALTER FK constraints
- Test `afterEach` cleanup needed same cascading delete logic to avoid FK constraint failures
- Seeded test players (id 1, 2) in `beforeAll` for `roundPlayers` FK requirements
- Used `inArray` from drizzle-orm for batch delete efficiency (not per-round loops)

### Completion Notes List
- **7 new tests** (3 DELETE + 2 stats + 2 Harvey default) — 51 total, all pass
- **Typecheck**: clean (engine + api + web)
- **Lint**: clean (engine + api + web)

### File List
- `apps/api/src/routes/admin/season.ts` — added DELETE /seasons/:id, GET /seasons/:id/stats, harveyLiveEnabled in POST
- `apps/api/src/routes/admin/season.test.ts` — 7 new tests, cascading afterEach cleanup, test player seeding
- `apps/api/src/schemas/season.ts` — added harveyLiveEnabled to createSeasonSchema with default true
- `apps/web/src/routes/admin/season.tsx` — delete button + confirmation, Harvey checkbox in create form

### Change Log
- 2026-03-14: Implemented P2.1.3 — Season delete with cascading cleanup, Harvey live default ON, confirmation dialog with impact stats
- 2026-03-14: Code review fixes — M1: fixed singular possessive in confirm message; L1: added UNAUTHORIZED check in stats fetch; L2: added sideGames + pairingHistory cascade assertions
