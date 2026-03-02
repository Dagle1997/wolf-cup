# Story 8.4 — Practice Round: Tee Selection & Roster Integration

## Status: ready

## Overview
When setting up a practice (casual) round, the ball-draw flow currently shows a plain text form (name + HI). This story upgrades it to:
1. Ask which tees are being played before adding players
2. Let players be selected from the active roster (auto-fills name + HI) OR entered as a new guest
3. Display the calculated **course handicap** for each player (based on selected tee + HI)
4. Store the tee on the group so future features can reference it

## Confirmed Course Data — Guyan G&CC (par 71)

| Tee   | Yards | Course Rating | Slope |
|-------|-------|---------------|-------|
| Black | 6,523 | 71.4          | 128   |
| Blue  | 6,209 | 69.9          | 126   |
| White | 5,795 | 67.7          | 119   |

**Course Handicap formula:**
```
courseHandicap = Math.round(handicapIndex × (slopeRating / 113) + (courseRating - par))
```

Example (Josh Stoll HI 15.7, Blue tees):
`Math.round(15.7 × 126/113 + (69.9 - 71)) = Math.round(17.50 − 1.10) = 16`

## Changes Required

### 1. `packages/engine/src/course.ts`
- Export `Tee` type: `'black' | 'blue' | 'white'`
- Add `TEE_RATINGS` constant:
  ```typescript
  export const TEE_RATINGS: Record<Tee, { courseRating: number; slopeRating: number }> = {
    black: { courseRating: 71.4, slopeRating: 128 },
    blue:  { courseRating: 69.9, slopeRating: 126 },
    white: { courseRating: 67.7, slopeRating: 119 },
  };
  ```
- Add `calcCourseHandicap(handicapIndex: number, tee: Tee): number` function:
  ```typescript
  export function calcCourseHandicap(handicapIndex: number, tee: Tee): number {
    const { slopeRating, courseRating } = TEE_RATINGS[tee];
    return Math.round(handicapIndex * (slopeRating / 113) + (courseRating - COURSE_PAR));
  }
  ```
  Where `COURSE_PAR = 71` (already known constant in course.ts).
- Export `calcCourseHandicap` and `TEE_RATINGS` from `packages/engine/src/index.ts`

### 2. DB Migration `0007_group_tee.sql`
```sql
ALTER TABLE groups ADD COLUMN tee TEXT;
```
Add entry to `_journal.json` with idx=7.

### 3. `apps/api/src/db/schema.ts`
Add to groups table:
```typescript
tee: text('tee'), // 'black' | 'blue' | 'white' — nullable (set at ball-draw time)
```

### 4. New public API endpoint: `GET /players/active`
In `apps/api/src/routes/rounds.ts` (or a new public-facing file), add:
```
GET /players/active
```
No auth required. Returns active, non-guest roster players needed for the ball-draw dropdown.

Response:
```json
{
  "players": [
    { "id": 10, "name": "Jay Patterson", "handicapIndex": 12.3 },
    ...
  ]
}
```
Ordered by name alphabetically. Only `isActive=1` and `isGuest=0`.

### 5. `PUT /rounds/:roundId/groups/:groupId/batting-order` — accept `tee`
Update the batting order submission to optionally accept `tee` and save it to the groups record.

Request payload addition:
```typescript
{
  order: number[];  // existing
  tee?: 'black' | 'blue' | 'white';  // new — optional, stored on group
}
```

Update the handler to:
```typescript
if (tee) {
  await db.update(groups).set({ tee }).where(eq(groups.id, groupId));
}
```

### 6. `apps/web/src/routes/ball-draw.tsx` — major UI update

#### New state
```typescript
const [selectedTee, setSelectedTee] = useState<'black' | 'blue' | 'white' | null>(null);
```

#### Tee selection step
For casual rounds, if `selectedTee === null` AND `localPlayers.length === 0` AND `group.battingOrder === null`, show the tee selection screen BEFORE the guest form:

```
Which tees are you playing today?

[⚫ Black  6,523 yds]
[🔵 Blue   6,209 yds]
[⚪ White  5,795 yds]
```

Once a tee is selected, proceed to the player entry form. `selectedTee` is stored in React state (survives navigation within the tab).

#### Player entry form — updated
Replace the current plain text guest form with:

**Name field:** `<select>` with:
  - Blank option: "— Select player —"
  - One `<option>` per active roster player (sorted by name), value = player ID
  - Last option: "New guest…" (value = "guest")

When a roster player is selected:
- Auto-fill `guestName` = player.name
- Auto-fill `guestHI` = player.handicapIndex (if set) or leave blank

When "New guest…" is selected:
- Show a text input for the name
- HI input as before (blank)

**HI field:** Number input 0–54, step 0.1 (unchanged)

**Course handicap display:** Below the HI input, once both tee and HI are filled:
```
Course HC: 16  (Blue tees)
```
Calculated client-side: `Math.round(hi * (slopeRating / 113) + (courseRating - 71))`

Use TEE_RATINGS imported from `@wolf-cup/engine`.

**Add button behavior:** Unchanged — still calls `POST /rounds/:roundId/groups/:groupId/guests`

#### Player list display
Each added player row should show:
```
Josh Stoll   HI: 15.7   →   HC: 16  (Blue)
```

#### Batting order submission — add tee
When `PUT .../batting-order` is called, include `tee: selectedTee` in the payload.

#### Import `calcCourseHandicap` and `TEE_RATINGS`
```typescript
import { calcCourseHandicap, TEE_RATINGS } from '@wolf-cup/engine';
```

## UI Flow Summary (casual round)

```
/ball-draw (casual, no batting order)
  └─ Tee selection screen (if no tee yet)
       ↓ user picks tee
  └─ Player entry form (roster dropdown + HI + course HC preview)
       ↓ add up to 4 players
  └─ Batting order form (unchanged)
       ↓ submit (includes tee)
  └─ Wolf schedule display → /score-entry-hole
```

## Out of Scope
- Official rounds do not use this tee selection flow (tee is set elsewhere)
- Tee is not currently displayed on the score-entry-hole page (future story)
- Guest players added via this form are still stored as `isGuest=1` players

## Acceptance Criteria
- [ ] Tee selection appears before player entry on casual ball-draw
- [ ] Roster dropdown shows all active non-guest players sorted by name
- [ ] Selecting a roster player auto-fills name and HI
- [ ] "New guest…" option allows free-text name entry
- [ ] Course handicap is calculated and displayed next to HI for each player
- [ ] Tee is stored on the group after batting order is submitted
- [ ] `GET /players/active` works without auth and returns name + HI
- [ ] Engine exports `calcCourseHandicap`, `TEE_RATINGS`, `Tee` type
- [ ] All existing official round flows are unaffected
- [ ] typecheck + lint clean
