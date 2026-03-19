# Story 9.1: Weighted Average Pairing — Group Assignment Optimization

Status: review

## Story

As an admin (Jason/Josh),
I want the system to suggest optimal group assignments for each round based on pairing history,
so that players rotate through the entire league over the course of a season instead of always playing with the same people.

## Background & Motivation

Jason previously maintained a spreadsheet that tracked who played with whom and used it to manually balance groups each week. This story automates that process. The algorithm suggests groups weighted by pairing history (least-paired-with = most preferred), and the admin can override suggestions before locking the round.

Key real-world constraints:
- **Variable attendance**: You never know who's showing up until they check in. Lineup changes weekly.
- **Player requests**: "I need first group" (early tee time), "I need last group" (running late). These are soft constraints the admin must be able to honor.
- **Group size must be 4**: Wolf game requires exactly 4 players per group. Remainders (if headcount isn't a multiple of 4) need special handling — likely a 3-some or 5-some with adjusted rules, but that's out of scope for this story. The algorithm should flag remainders for admin resolution.
- **Season-scoped history**: Pairing history resets each season. Last year's data doesn't carry over — player attendance patterns change year to year.
- **Admin override is king**: The algorithm SUGGESTS, the admin DECIDES. Final group assignments are always a human decision.

## Acceptance Criteria

### AC1: Pairing History Tracking
**Given** a finalized round with groups assigned
**When** the round is finalized (status → 'finalized')
**Then** the system records every pair of players who were in the same group for that round
**And** pairing history is scoped to the current season (seasonId)
**And** pairing counts are queryable per season

### AC2: Pairing Matrix API
**Given** an admin viewing round setup for an active season
**When** the admin requests pairing suggestions for a set of attending players
**Then** the API returns the full N×N pairing matrix (how many times each pair has played together this season)
**And** the matrix is symmetric (player A with B = player B with A)

### AC3: Group Suggestion Algorithm
**Given** a list of attending player IDs and a target group size of 4
**When** the admin requests group suggestions
**Then** the algorithm returns suggested groups that MINIMIZE the maximum pairing count within each group
**And** groups are balanced so no group has significantly more "repeat pairings" than another
**And** if the player count is not a multiple of 4, the response includes a `remainder` array of unassigned players with a warning

### AC4: Player Slot Constraints (Pinning)
**Given** an admin has pinned specific players to specific group slots (e.g., "Player X must be in Group 1")
**When** group suggestions are generated
**Then** pinned players are locked into their assigned groups
**And** the algorithm optimizes the remaining unpinned players around the pinned constraints

### AC5: Admin Override & Commit
**Given** suggested groups are displayed in the admin UI
**When** the admin drags/moves players between groups or manually assigns them
**Then** the modified groups replace the suggestions
**And** the admin can re-run suggestions at any time (with current pins preserved)
**And** committing the groups creates the actual `groups` and `round_players` records via existing API

### AC6: Season Reset
**Given** a new season is created
**When** pairing suggestions are requested for the new season
**Then** pairing history from the previous season is NOT included
**And** all players start with zero pairing history

## Tasks / Subtasks

- [x] Task 1: Pairing History Schema (AC: #1, #6)
  - [x] 1.1 Create `pairing_history` table: `id`, `seasonId`, `playerAId`, `playerBId`, `pairCount` (unique on seasonId+playerA+playerB, always store lower ID first)
  - [x] 1.2 Add migration via drizzle-kit
  - [x] 1.3 Write `recordPairings(seasonId, groupPlayerIds[])` helper — on round finalize, upsert all C(n,2) pairs per group

- [x] Task 2: Pairing History Recording Hook (AC: #1)
  - [x] 2.1 In the round finalization endpoint (`POST /admin/rounds/:id/finalize`), after status update, call `recordPairings` for each group
  - [x] 2.2 Handle idempotency — re-finalizing shouldn't double-count (use upsert with increment)

- [x] Task 3: Pairing Matrix API (AC: #2)
  - [x] 3.1 `GET /admin/pairing/matrix?seasonId=X&playerIds=1,2,3,...` — returns `{ matrix: Record<string, Record<string, number>> }` for the given players
  - [x] 3.2 If no playerIds filter, return matrix for all players with any pairing history in the season

- [x] Task 4: Group Suggestion Algorithm (AC: #3, #4)
  - [x] 4.1 Implement in `packages/engine/src/pairing.ts` as a pure function: `suggestGroups(pairingMatrix, playerIds, pinnedAssignments?, groupSize=4) → { groups: number[][], remainder: number[] }`
  - [x] 4.2 Algorithm approach: greedy optimization — iteratively assign the least-paired players together, respecting pinned slots
  - [x] 4.3 Cost function: minimize the sum of pairing counts within each group, with secondary objective of balancing max-pairing across groups
  - [x] 4.4 Unit tests in `packages/engine/src/pairing.test.ts` — 16 tests covering 4/8/12/16 players, pins, remainders, history avoidance

- [x] Task 5: Suggestion API Endpoint (AC: #3, #4)
  - [x] 5.1 `POST /admin/rounds/:roundId/suggest-groups` — body: `{ playerIds: number[], pins?: Record<number, number> }` (pin maps playerId → groupNumber)
  - [x] 5.2 Returns `{ groups: Array<{ groupNumber: number, playerIds: number[], pairCounts, maxPairCount }>, remainder: number[], totalCost }`
  - [x] 5.3 Does NOT persist — just returns suggestions for admin review

- [x] Task 6: Admin UI — Group Suggestion Panel (AC: #5)
  - [x] 6.1 Add "Suggest Groups" button to the round setup page (admin/rounds)
  - [x] 6.2 Display suggested groups with Apply/Re-roll/Dismiss controls
  - [x] 6.3 Pin/unpin player to group slot — tap-cycle: Pin → 1st → Last → unpin. Pins passed to suggest API and preserved on re-roll.
  - [x] 6.4 "Re-roll" button that preserves current pins
  - [x] 6.5 "Apply" button that commits groups via existing group/player API endpoints
  - [x] 6.6 Show pairing heat indicator (total cost with color coding)

- [x] Task 7: Tests (all ACs)
  - [x] 7.1 Engine unit tests: 16 tests covering 4/8/12/16 players, with/without pins, uneven counts, history avoidance, cost validation
  - [x] 7.2 API routes implemented and wired (pairing.ts mounted at /api/admin)
  - [x] 7.3 Edge cases: zero history, single group (4 players), invalid pins, 3 players (all remainder)

## Dev Notes

### Algorithm Design

The pairing optimization problem is a variant of the **balanced graph coloring / minimum-weight partition** problem. For the Wolf Cup scale (~16-24 players, 4-6 groups), a greedy heuristic is perfectly adequate — exhaustive search of all partitions is computationally infeasible for N>12, but greedy with random restarts will produce near-optimal results in milliseconds.

**Recommended approach:**
1. Build an N×N cost matrix from pairing history (0 = never paired = most desirable)
2. Respect pinned players as fixed assignments
3. For unpinned players, use a greedy assignment: pick the player with the highest total pairing cost across current group members, assign to the group where they'd add the least cost
4. Optionally run 10-50 random shuffles of player order and keep the best result
5. Return groups sorted by group number

**Cost function**: `sum of pairCount(a,b) for all pairs (a,b) in same group` — minimize this globally.

**Why not ILP/SAT?** Overkill for 16-24 players. Greedy with restarts will be within 5% of optimal and runs in <10ms. No external solver dependency needed — keep the engine zero-deps.

### Database Design

```sql
CREATE TABLE pairing_history (
  id INTEGER PRIMARY KEY,
  season_id INTEGER NOT NULL REFERENCES seasons(id),
  player_a_id INTEGER NOT NULL REFERENCES players(id),
  player_b_id INTEGER NOT NULL REFERENCES players(id),
  pair_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(season_id, player_a_id, player_b_id)
);
-- Convention: player_a_id < player_b_id (canonical ordering)
CREATE INDEX idx_pairing_history_season ON pairing_history(season_id);
```

In Drizzle ORM:
```typescript
export const pairingHistory = sqliteTable('pairing_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  seasonId: integer('season_id').notNull().references(() => seasons.id),
  playerAId: integer('player_a_id').notNull().references(() => players.id),
  playerBId: integer('player_b_id').notNull().references(() => players.id),
  pairCount: integer('pair_count').notNull().default(0),
}, (t) => ({
  uniq: unique().on(t.seasonId, t.playerAId, t.playerBId),
  seasonIdx: index('idx_pairing_history_season').on(t.seasonId),
}));
```

### Existing Code to Reuse

- **Round finalization**: `POST /admin/rounds/:id/finalize` in `apps/api/src/routes/admin/rounds.ts` — hook pairing recording here
- **Group/player management**: existing `POST /rounds/:roundId/groups` and `POST /rounds/:roundId/groups/:groupId/players` endpoints — the suggestion UI should commit via these
- **Admin auth**: all new endpoints go under `adminAuthMiddleware` in `apps/api/src/routes/admin/`
- **Schema patterns**: follow existing Drizzle table patterns in `apps/api/src/db/schema.ts`
- **Engine pure functions**: `packages/engine/src/pairing.ts` — zero deps, pure TypeScript, Vitest tests
- **Admin UI patterns**: follow existing patterns in `apps/web/src/routes/admin/rounds.tsx` for the suggestion panel

### Project Structure Notes

New files:
- `packages/engine/src/pairing.ts` — pure suggestion algorithm
- `packages/engine/src/pairing.test.ts` — unit tests
- `apps/api/src/routes/admin/pairing.ts` — API routes (matrix, suggest)
- Update `apps/api/src/db/schema.ts` — add `pairingHistory` table
- Update `apps/api/src/routes/admin/rounds.ts` — hook pairing recording into finalize
- Update `apps/web/src/routes/admin/rounds.tsx` — suggestion UI panel
- Update `packages/engine/src/index.ts` — export pairing module

### Key Constraints

- **Engine must remain zero-deps**: no optimization libraries. Pure TypeScript greedy algorithm only.
- **SQLite limitations**: no native upsert with increment — use `INSERT ... ON CONFLICT DO UPDATE SET pair_count = pair_count + 1` (supported by better-sqlite3 via Drizzle's `onConflictDoUpdate`)
- **Group size is always 4**: don't over-engineer for variable group sizes. Wolf game requires exactly 4.
- **Admin UI is mobile-friendly**: 48px touch targets, works on phone. Drag-and-drop may be impractical on mobile — provide move buttons as alternative.

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 2, FR47: Admin sets headcount and group assignments]
- [Source: _bmad-output/planning-artifacts/architecture.md — API Patterns, Drizzle ORM, Admin Auth]
- [Source: apps/api/src/db/schema.ts — existing schema patterns]
- [Source: apps/api/src/routes/admin/rounds.ts — round finalization, group management]
- [Source: apps/web/src/routes/admin/rounds.tsx — admin rounds UI patterns]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
