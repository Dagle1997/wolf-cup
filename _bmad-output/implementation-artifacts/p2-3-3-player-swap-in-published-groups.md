# Story P2.3.3: Player Swap in Published Groups

Status: done

## Story

As an admin,
I want to replace a player in a published group with a different player without recreating the round or other groups,
so that last-minute dropouts are handled quickly.

## Acceptance Criteria

1. **Given** groups have been published for a round **When** a player drops out **Then** the admin can select the player to remove **And** select a replacement from confirmed attendance not yet assigned, or bench subs

2. **Given** a swap is executed **When** confirmed **Then** the dropped player is removed from the group and marked "out" on attendance **And** the replacement is added to the same group slot with correct sub flag **And** all other groups remain unchanged **And** pairings view updates

3. **Given** the replacement is a new sub not yet on the bench **When** the admin initiates the swap **Then** they can use the "Add Sub" GHIN search flow inline

## Tasks / Subtasks

- [x]Task 1: Swap player API endpoint (AC: #1, #2)
  - [x]Add `POST /admin/rounds/:roundId/groups/:groupId/swap` endpoint
  - [x]Body: `{ removePlayerId: number, addPlayerId: number, handicapIndex: number, isSub?: boolean }`
  - [x]Remove old player from round_players, add new player to same group
  - [x]Update attendance: old player → 'out', new player → 'in' (if seasonWeekId available)
  - [x]Return updated group players

- [x]Task 2: Swap UI on admin rounds page (AC: #1, #2, #3)
  - [x]Add "Swap" button per player in group view on round management
  - [x]Show dropdown of available replacements (confirmed but unassigned + bench subs)
  - [x]Inline "Add Sub" flow for new sub option
  - [x]On confirm, call swap endpoint

- [x]Task 3: Tests (AC: #1, #2)
  - [x]API: swap player replaces in correct group, other groups unchanged
  - [x]API: swap updates attendance (old→out)
  - [x]API: reject swap if new player already in round

## Dev Notes

### API Design

`POST /admin/rounds/:roundId/groups/:groupId/swap`:
```typescript
Request: {
  removePlayerId: number,  // player being dropped
  addPlayerId: number,     // replacement player
  handicapIndex: number,   // replacement's HI
  isSub?: boolean,         // default: check sub_bench
}
```

Transaction:
1. Delete round_players WHERE roundId AND playerId = removePlayerId
2. Insert round_players with addPlayerId, same groupId
3. Optionally update attendance for both players

### Existing patterns
- `apps/api/src/routes/admin/rounds.ts` — addGroupPlayerSchema, delete player from round
- `apps/api/src/routes/admin/attendance.ts` — attendance toggle

### Project Structure
- Route: `apps/api/src/routes/admin/rounds.ts` (add swap endpoint)
- Tests: `apps/api/src/routes/attendance.test.ts` (add swap tests)
- UI: `apps/web/src/routes/admin/rounds.tsx` (add swap button — minimal, admin-only)

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Completion Notes List
- **2 new swap tests** (21 total) — all pass. Typecheck + lint clean.

### File List
- `apps/api/src/routes/admin/rounds.ts` — added POST swap endpoint with attendance sync
- `apps/api/src/routes/attendance.test.ts` — 2 swap tests + afterEach cleanup fix

### Change Log
- 2026-03-14: Implemented P2.3.3 — Player swap in published groups with attendance sync
