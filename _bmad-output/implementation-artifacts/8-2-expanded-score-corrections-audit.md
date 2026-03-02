# Story 8.2: Expanded Score Corrections & Full Audit Log

Status: ready-for-dev

## Story

As an admin,
I want to correct any scoring input (gross score, wolf decision, wolf partner, greenie,
polie, handicap index) on a finalized round,
so that errors can be fixed post-round with a full immutable audit trail showing who
changed what, when, and what the old and new values were.

## Background / Context

The existing score corrections system (Story 7.4) only covers three fields:
`grossScore`, `wolfDecision`, `wolfPartnerId`. Greenies and polies (stored in
`wolfDecisions.bonusesJson`) and per-round handicap indexes (`round_players.handicapIndex`)
are not correctable. The audit log schema already supports arbitrary `fieldName/oldValue/newValue`
entries — we just need to extend the backend logic and UI.

All corrections must:
- Be applied atomically with a rescore of the affected group
- Be recorded in `score_corrections` with `adminUserId`, `roundId`, `holeNumber`,
  `playerId` (if applicable), `fieldName`, `oldValue`, `newValue`, `correctedAt`
- Be visible in the audit log on the admin score corrections page

## Data Model Notes

- **Greenie / Polie**: stored in `wolf_decisions.bonuses_json` as
  `{ greenies: number[], polies: number[] }` (arrays of player IDs).
  Correcting greenie/polie = add or remove a player ID from the relevant array,
  then re-run scoring for that group/hole.
  - `fieldName`: `'greenie'` or `'polie'`
  - `oldValue` / `newValue`: serialized player ID arrays, e.g. `"[12,15]"` → `"[12]"`

- **Handicap Index**: stored in `round_players.handicap_index` (real number).
  Correcting = update that row, then re-run ALL 18 holes of scoring for that player's group.
  - `fieldName`: `'handicapIndex'`
  - `oldValue` / `newValue`: string representation of the float, e.g. `"14.2"` → `"12.8"`
  - `holeNumber`: use `0` as sentinel (correction is round-wide, not hole-specific)

## Acceptance Criteria

1. **Backend — greenie correction**
   - `POST /admin/rounds/:roundId/corrections` accepts `fieldName: 'greenie'`
   - Body: `{ holeNumber: 1–18, fieldName: 'greenie', groupId: number, playerId: number, newValue: 'add' | 'remove' }`
   - Reads current `bonusesJson.greenies` for the group/hole wolf_decision row
   - Adds or removes `playerId` from the array
   - Validates: hole must be a par-3 (holes 6, 7, 12, 15 at Guyan G&CC)
   - Writes updated `bonusesJson` back to `wolf_decisions`
   - Re-runs scoring for the group (all 18 holes) via the engine
   - Logs to `score_corrections`: `oldValue = JSON.stringify(old greenies array)`, `newValue = JSON.stringify(new array)`
   - Returns updated group money totals

2. **Backend — polie correction**
   - Same as greenie but `fieldName: 'polie'`, no hole restriction (any hole)
   - Body: `{ holeNumber: 1–18, fieldName: 'polie', groupId: number, playerId: number, newValue: 'add' | 'remove' }`

3. **Backend — handicap index correction**
   - `POST /admin/rounds/:roundId/corrections` accepts `fieldName: 'handicapIndex'`
   - Body: `{ holeNumber: 0, fieldName: 'handicapIndex', playerId: number, newValue: string (float) }`
   - Validates: newValue parses as a valid handicap index (0.0–54.0)
   - Updates `round_players.handicap_index` for the player in this round
   - Re-runs scoring for the player's group (all 18 holes)
   - Logs to `score_corrections` with `holeNumber: 0`, `oldValue`, `newValue`
   - Returns updated group money/stableford totals

4. **`GET /admin/rounds/:roundId/corrections` response**
   - Returns all corrections for the round sorted by `correctedAt` desc
   - Each row includes: `id`, `correctedAt`, `holeNumber`, `fieldName`, `oldValue`,
     `newValue`, `playerId`, `playerName` (joined), `adminUsername` (joined from admins table)

5. **Admin Score Corrections UI — new field types**
   - Field type selector adds: "Greenie", "Polie", "Handicap Index"

   **Greenie / Polie fields:**
   - Round selector (finalized rounds only) — existing
   - Hole selector (1–18; greenie restricted to par-3 holes 6, 7, 12, 15)
   - Group selector
   - Player selector (players in that group)
   - Action: "Add" / "Remove" radio
   - Shows current greenies/polies for that hole/group as read-only chips before submitting

   **Handicap Index fields:**
   - Round selector (finalized rounds only)
   - Player selector (all players in the round, not just one group)
   - New HI input (numeric, 0.0–54.0, step 0.1)
   - Shows current HI for that player in that round before submitting

6. **Audit log display** — existing table extended:
   - Shows `Admin` column (who made the correction) — pull from `adminUsername`
   - All existing fields remain: When, Hole, Field, Old → New
   - `holeNumber: 0` displayed as "Round" (for handicap index corrections)
   - Greenie/polie old/new values formatted as player name lists (resolve IDs to names)

7. **Tests**: new tests in `score-corrections.test.ts`:
   - Greenie add/remove happy path
   - Polie add/remove happy path
   - Handicap index correction happy path (verify round_players updated)
   - Invalid par-3 check for greenie on non-par-3 hole
   - Invalid HI value (out of range)

8. **Typecheck**: `pnpm --filter @wolf-cup/api typecheck` and `pnpm --filter @wolf-cup/web typecheck` pass.

## Dev Notes

### Rescore after correction
The existing `POST /admin/rounds/:roundId/corrections` handler for `grossScore` already
triggers a full rescore. Extend the same pattern for the new field types.

The rescore function reads all hole_scores + wolf_decisions for the group, runs the
engine, and writes back to `round_results` + `harvey_results` atomically. This is
already implemented — reuse it.

### groupId for handicap corrections
Handicap affects net score which feeds into both Stableford and money. Look up the
player's groupId from `round_players` to rescore the right group.

### Admin identity in audit log
The `adminAuthMiddleware` attaches admin session to context. Pull `adminId` from
context and join to `admins.username` in the GET response. The `adminUserId` column
already exists on `score_corrections`.

### Par-3 holes at Guyan G&CC
Holes 6, 7, 12, 15 are par-3. Hard-code this validation server-side or import
from the engine's course data.

## Tasks / Subtasks

- [ ] Task 1: Backend — greenie correction handler
  - [ ] Extend corrections POST to handle `fieldName: 'greenie'`
  - [ ] Read/write bonusesJson, validate par-3, log audit, rescore

- [ ] Task 2: Backend — polie correction handler
  - [ ] Extend corrections POST to handle `fieldName: 'polie'`
  - [ ] Same pattern as greenie, no hole restriction

- [ ] Task 3: Backend — handicap index correction handler
  - [ ] Extend corrections POST to handle `fieldName: 'handicapIndex'`
  - [ ] Update round_players, validate range, log audit, rescore full group

- [ ] Task 4: Backend — extend GET corrections response
  - [ ] Add `adminUsername` and `playerName` to response via JOIN
  - [ ] Handle `holeNumber: 0` display sentinel

- [ ] Task 5: API tests for new correction types

- [ ] Task 6: Admin UI — Greenie/Polie correction form
  - [ ] Add field type options to selector
  - [ ] Hole dropdown (greenie: par-3 only), group/player/action selectors
  - [ ] Show current bonus state before submit

- [ ] Task 7: Admin UI — Handicap Index correction form
  - [ ] Player selector across all round players
  - [ ] Show current HI, numeric input, submit

- [ ] Task 8: Admin UI — extend audit log
  - [ ] Add Admin column
  - [ ] Format greenie/polie values as player names
  - [ ] "Round" label for holeNumber 0

- [ ] Task 9: Quality gates
