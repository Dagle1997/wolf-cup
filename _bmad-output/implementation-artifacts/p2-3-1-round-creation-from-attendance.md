# Story P2.3.1: Round Creation from Attendance Board

Status: done

## Story

As an admin,
I want to create a round directly from the attendance board with all confirmed players, tees, and sub flags pre-populated,
so that I don't have to re-enter player selections or round settings manually.

## Acceptance Criteria

1. **Given** the attendance board shows all players confirmed and headcount is a multiple of 4 **When** the admin views the attendance board **Then** a "Create Round" button is visible and enabled

2. **Given** the headcount is not a multiple of 4 (e.g., 13 or 15) **When** the admin views the attendance board **Then** the "Create Round" button is disabled **And** a message indicates how many more players are needed (e.g., "1 more needed for groups of 4")

3. **Given** the admin clicks "Create Round" **When** the round is created **Then** all confirmed players are added to the round as round_players **And** sub bench players are flagged as `is_sub = true` **And** the tee is set from the season calendar's tee rotation for that week **And** an entry code is auto-generated **And** the scheduled date is set to that Friday **And** the round is created with initial groups (headcount/4) with players distributed — admin uses "Suggest Groups" on rounds page to optimize

4. **Given** the round is created from attendance **When** a scorer enters the entry code on Friday **Then** they can select their group and proceed to scoring as normal (existing v1 flow)

## Tasks / Subtasks

- [x]Task 1: Create round from attendance API endpoint (AC: #1, #2, #3)
  - [x]Add `POST /admin/rounds/from-attendance` endpoint
  - [x]Body: `{ seasonWeekId: number }`
  - [x]Validate: headcount of confirmed players is multiple of 4
  - [x]Auto-generate 4-digit entry code
  - [x]Create round with tee from season_weeks, scheduledDate from friday
  - [x]Create N groups (confirmed/4)
  - [x]Add all confirmed players as round_players (distribute across groups round-robin)
  - [x]Flag sub_bench players with isSub=1
  - [x]All in one transaction
  - [x]Return round with entry code (unhashed, for display)

- [x]Task 2: Attendance UI — Create Round button (AC: #1, #2)
  - [x]Show "Create Round" button on attendance page (admin only, below player list)
  - [x]Enable only when confirmed count is multiple of 4 and > 0
  - [x]Show "N more needed" message when not multiple of 4
  - [x]On success, show entry code and link to round management

- [x]Task 3: Tests (AC: #1, #2, #3)
  - [x]API: create round from attendance with 4 confirmed → round + 1 group + 4 players
  - [x]API: create round with 8 confirmed → 2 groups + 8 players
  - [x]API: sub bench player gets isSub=1
  - [x]API: reject when confirmed not multiple of 4
  - [x]API: tee and scheduledDate from season_weeks
  - [x]API: entry code returned in response

## Dev Notes

### API Endpoint

**`POST /admin/rounds/from-attendance`**

```typescript
Request: { seasonWeekId: number }

// Logic:
// 1. Get season_week → extract friday, tee, seasonId
// 2. Get all attendance with status='in' for this week
// 3. Validate confirmed count is multiple of 4
// 4. Generate 4-digit entry code
// 5. Transaction:
//    a. Create round (seasonId, 'official', 'scheduled', friday, tee, entryCodeHash)
//    b. Create N groups (confirmed/4)
//    c. For each confirmed player:
//       - Check if in sub_bench for this season → isSub
//       - Insert round_players with groupId (round-robin), handicapIndex, isSub
// 6. Return { round, entryCode, groupCount, playerCount }
```

### Entry Code Generation

Auto-generate a 4-digit numeric code:
```typescript
const entryCode = String(Math.floor(1000 + Math.random() * 9000)); // 1000-9999
const entryCodeHash = await bcrypt.hash(entryCode, 10);
```

Return the plaintext `entryCode` in the response so the admin can share it. The hash is stored in DB.

### Sub Detection

Query `sub_bench` for the season to build a set of sub player IDs:
```typescript
const subs = await db.select({ playerId: subBench.playerId })
  .from(subBench)
  .where(eq(subBench.seasonId, seasonId));
const subIds = new Set(subs.map(s => s.playerId));
```

### Round-Robin Group Assignment

Distribute players across groups evenly:
```typescript
const groupCount = confirmed.length / 4;
// Create groups
const groupIds = [];
for (let i = 0; i < groupCount; i++) {
  const [g] = await tx.insert(groups).values({ roundId, groupNumber: i + 1 }).returning();
  groupIds.push(g.id);
}
// Assign players round-robin
for (let i = 0; i < confirmed.length; i++) {
  const groupId = groupIds[i % groupCount];
  await tx.insert(roundPlayers).values({
    roundId, playerId: confirmed[i].id, groupId,
    handicapIndex: confirmed[i].handicapIndex ?? 0,
    isSub: subIds.has(confirmed[i].id) ? 1 : 0,
  });
}
```

### Existing Patterns

- **Round creation**: `apps/api/src/routes/admin/rounds.ts` POST /admin/rounds
- **bcrypt for entry codes**: Already used in round creation (cost 10)
- **Round schema**: `apps/api/src/schemas/round.ts` createRoundSchema
- **Attendance query**: `apps/api/src/routes/admin/attendance.ts` GET endpoint

### Project Structure Notes

- Route changes: `apps/api/src/routes/admin/rounds.ts` (add POST from-attendance endpoint)
- UI changes: `apps/web/src/routes/attendance.tsx` (Create Round button)
- Tests: `apps/api/src/routes/attendance.test.ts` (add from-attendance tests)
- No schema changes, no migration

### References

- [Source: _bmad-output/planning-artifacts/epics-phase2.md — Story P2.3.1]
- [Source: apps/api/src/routes/admin/rounds.ts — existing round creation]
- [Source: apps/api/src/routes/admin/attendance.ts — attendance + sub bench endpoints]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Used `sql` template for IN clause since `inArray` requires import overhead for dynamic arrays
- Round-robin player distribution across groups (player i → group i%N)
- Entry code auto-generated as 4-digit number (1000-9999), bcrypt hashed for storage
- Duplicate round check by seasonId + scheduledDate prevents accidental re-creation

### Completion Notes List
- **4 new from-attendance tests** (17 total attendance tests) — all pass
- **Typecheck**: clean
- **Lint**: clean

### File List
- `apps/api/src/routes/admin/rounds.ts` — added POST /rounds/from-attendance endpoint
- `apps/api/src/schemas/round.ts` — added fromAttendanceSchema
- `apps/api/src/routes/attendance.test.ts` — 4 new from-attendance tests + 2 more seed players + round cleanup
- `apps/web/src/routes/attendance.tsx` — CreateRoundButton component with headcount validation

### Change Log
- 2026-03-14: Implemented P2.3.1 — Round creation from attendance with auto-generated entry code, tee from calendar, sub detection, groups of 4
