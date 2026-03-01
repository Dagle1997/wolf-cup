# Story 3.6: Guest Players — Casual Rounds

Status: done

## Story

As a casual round organizer,
I want to add guest players by name and handicap index to my group before the ball draw,
so that people who aren't on the league roster can participate in a casual round and have scores, Stableford points, and money calculated correctly.

## Acceptance Criteria

### Database Migration

1. **Schema migration**: Add `is_guest INTEGER NOT NULL DEFAULT 0` to the `players` table.
   - Existing rows default to 0 (not a guest).
   - This is an additive `ALTER TABLE` — drizzle-kit generates a simple column-add migration, not a table recreation.
   - Run `pnpm --filter @wolf-cup/api db:generate` to produce migration `0004_*.sql`.

### Public API — Add Guest Player

2. `POST /api/rounds/:roundId/groups/:groupId/guests` accepts:
   ```json
   { "name": "John Smith", "handicapIndex": 12.4 }
   ```
   - **No entry code required** — this endpoint is casual-round-only and bypass entry code middleware entirely.
   - Returns 404 `NOT_FOUND` if round or group not found / group doesn't belong to round.
   - Returns 422 `CASUAL_ONLY` if `round.type === 'official'` — guests are not allowed in official rounds.
   - Returns 422 `ROUND_NOT_ACTIVE` if round status is `'finalized'` or `'cancelled'`.
   - Returns 422 `GROUP_FULL` if the group already has 4 `round_players` rows.
   - Returns 400 `VALIDATION_ERROR` if name is empty/blank or `handicapIndex` is outside [0, 54].

3. On success (200):
   - Inserts a row in `players`: `{ name, ghinNumber: null, isActive: 1, isGuest: 1, createdAt: now }`.
   - Inserts a row in `round_players`: `{ roundId, playerId, groupId, handicapIndex, isSub: 0 }`.
   - Returns:
     ```json
     { "player": { "id": 42, "name": "John Smith", "handicapIndex": 12.4 } }
     ```
   - The new player immediately appears in `GET /rounds/:roundId` group.players on next fetch (existing `getRoundDetail` join covers it).

### Web — Ball Draw Extended

4. **Guest player form** shown in `ball-draw.tsx` only when ALL of:
   - `round.type === 'casual'`
   - The group has fewer than 4 players (roster + guests combined, tracked in local `localPlayers` state)
   - No batting order has been set yet (group.battingOrder is null AND wolfSchedule is null)

   Form fields:
   - Name: text input, placeholder "Guest name", required
   - Handicap Index: number input, min 0, max 54, step 0.1, placeholder "e.g. 12.4", required
   - "Add Guest" button: disabled when either field is empty/invalid or mutation is pending

5. On guest added successfully:
   - Append the returned player to `localPlayers` state (no round query refetch needed).
   - Clear both form inputs.
   - Show the player appearing in the group players list immediately.

6. Batting order form is shown only when `localPlayers.length >= 4`. For official rounds or when batting order already set, guest form is never shown. The `BattingOrderForm` component receives `localPlayers` (not the raw `group.players` from query).

7. Error display on mutation failure:
   - `GROUP_FULL` → "Your group already has 4 players."
   - `CASUAL_ONLY` → "Guest players can only be added to casual rounds."
   - Network/other → "Could not add guest — please try again."

### Quality

8. `pnpm --filter @wolf-cup/api test` passes with new tests covering:
   - POST guests: casual round + valid body → 200, `player.id` returned, player has `isGuest=1`
   - POST guests: official round → 422 `CASUAL_ONLY`
   - POST guests: group already at 4 players → 422 `GROUP_FULL`
   - POST guests: finalized round → 422 `ROUND_NOT_ACTIVE`
   - POST guests: empty name → 400 `VALIDATION_ERROR`
   - POST guests: handicapIndex out of range (e.g., 55) → 400 `VALIDATION_ERROR`
   - GET /rounds/:id: guest player appears in group.players after being added
9. `pnpm --filter @wolf-cup/web typecheck` passes.
10. `pnpm --filter @wolf-cup/web lint` passes.

## Tasks / Subtasks

- [x] Task 1: DB migration + API endpoint (AC: #1–3, #8)
  - [x] Add `isGuest: integer('is_guest').notNull().default(0)` to `players` table in `apps/api/src/db/schema.ts`
  - [x] Run `pnpm --filter @wolf-cup/api db:generate` → produces `0004_*.sql`
  - [x] Add `addGuestSchema` to `apps/api/src/schemas/round.ts`
  - [x] Add `POST /rounds/:roundId/groups/:groupId/guests` to `apps/api/src/routes/rounds.ts`
  - [x] Add "Guest players" describe block to `apps/api/src/routes/rounds.test.ts`

- [x] Task 2: Web — ball-draw guest form (AC: #4–7, #9–10)
  - [x] Add `localPlayers` state + guest form to `apps/web/src/routes/ball-draw.tsx`
  - [x] Wire guest mutation to POST /guests
  - [x] Gate batting order form on `localPlayers.length >= 4`

## Dev Notes

### Schema Change — Exact Code

In `apps/api/src/db/schema.ts`, add one field to `players`:

```typescript
export const players = sqliteTable('players', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  ghinNumber: text('ghin_number'),
  isActive: integer('is_active').notNull().default(1),
  isGuest: integer('is_guest').notNull().default(0),  // ← NEW
  createdAt: integer('created_at').notNull(),
});
```

After editing, run:
```bash
pnpm --filter @wolf-cup/api db:generate
```
Drizzle-kit generates an `ALTER TABLE players ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0` migration (not a table recreation — SQLite allows additive column adds with defaults).

### Zod Schema (add to `apps/api/src/schemas/round.ts`)

```typescript
export const addGuestSchema = z.object({
  name: z.string().min(1).max(100),
  handicapIndex: z.number().min(0).max(54),
});
export type AddGuestBody = z.infer<typeof addGuestSchema>;
```

### API Endpoint Structure

Pattern follows existing endpoints in `apps/api/src/routes/rounds.ts`. Rough shape:

```typescript
app.post('/rounds/:roundId/groups/:groupId/guests', async (c) => {
  const roundId = Number(c.req.param('roundId'));
  const groupId = Number(c.req.param('groupId'));
  // 1. Validate IDs
  // 2. Fetch round — check exists → 404, check type === 'official' → 422 CASUAL_ONLY,
  //    check status finalized/cancelled → 422 ROUND_NOT_ACTIVE
  // 3. Fetch group — check exists + belongs to round → 404
  // 4. Count round_players for this group — if >= 4 → 422 GROUP_FULL
  // 5. Parse + validate body via addGuestSchema → 400 VALIDATION_ERROR
  // 6. Insert players row: { name, ghinNumber: null, isActive: 1, isGuest: 1, createdAt: now }
  // 7. Insert round_players row: { roundId, playerId, groupId, handicapIndex, isSub: 0 }
  // 8. Return 200 { player: { id, name, handicapIndex } }
});
```

**No entry code check** — casual rounds have no entry code by definition.

**Group player count:** Count via `db.select({ count: ... }).from(roundPlayers).where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.groupId, groupId)))`. If count >= 4 → 422 GROUP_FULL.

**Insert player:** Use `.returning({ id: players.id })` to get the new player's ID.

**Insert round_players:** The `uniq_round_players` unique index is on `(round_id, player_id)`. Since the guest player is newly created, there's no conflict — no need for `onConflictDoUpdate`.

### Web — ball-draw.tsx Changes

**New state:**
```typescript
const [localPlayers, setLocalPlayers] = useState<Player[]>([]);
const [guestName, setGuestName] = useState('');
const [guestHandicap, setGuestHandicap] = useState('');
const [guestError, setGuestError] = useState<string | null>(null);
```

**Initialization:** After round data loads, initialize `localPlayers` from the selected group:
```typescript
useEffect(() => {
  if (!data || selectedGroupId === null) return;
  const group = data.groups.find((g) => g.id === selectedGroupId);
  if (group) setLocalPlayers(group.players);
}, [data, selectedGroupId]);
```

**Guest mutation:**
```typescript
const guestMutation = useMutation({
  mutationFn: ({ name, handicapIndex }: { name: string; handicapIndex: number }) =>
    apiFetch<{ player: Player }>(
      `/rounds/${session!.roundId}/groups/${selectedGroupId!}/guests`,
      {
        method: 'POST',
        body: JSON.stringify({ name, handicapIndex }),
      },
    ),
  onSuccess: (data) => {
    setLocalPlayers((prev) => [...prev, data.player]);
    setGuestName('');
    setGuestHandicap('');
    setGuestError(null);
  },
  onError: (err: Error) => {
    if (err.message === 'GROUP_FULL') {
      setGuestError('Your group already has 4 players.');
    } else if (err.message === 'CASUAL_ONLY') {
      setGuestError('Guest players can only be added to casual rounds.');
    } else {
      setGuestError('Could not add guest — please try again.');
    }
  },
});
```

**Guest form rendering** — show when casual + < 4 players + no batting order:
```tsx
{data?.type === 'casual' && localPlayers.length < 4 && !wolfSchedule && (
  <div className="flex flex-col gap-3 border rounded-xl p-4">
    <p className="text-sm font-medium">Add Guest Player ({localPlayers.length}/4)</p>
    <input
      type="text"
      placeholder="Guest name"
      value={guestName}
      onChange={(e) => setGuestName(e.target.value)}
      className="border rounded-lg p-2 min-h-12 bg-background text-sm"
    />
    <input
      type="number"
      placeholder="Handicap index (e.g. 12.4)"
      min={0}
      max={54}
      step={0.1}
      value={guestHandicap}
      onChange={(e) => setGuestHandicap(e.target.value)}
      className="border rounded-lg p-2 min-h-12 bg-background text-sm"
    />
    {guestError && (
      <div className="flex items-center gap-2 text-destructive text-sm">
        <AlertCircle className="w-4 h-4 shrink-0" />
        {guestError}
      </div>
    )}
    <Button
      variant="outline"
      className="min-h-12 w-full"
      disabled={!guestName.trim() || !guestHandicap || guestMutation.isPending}
      onClick={() =>
        guestMutation.mutate({
          name: guestName.trim(),
          handicapIndex: Number(guestHandicap),
        })
      }
    >
      {guestMutation.isPending ? (
        <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Adding…</>
      ) : (
        'Add Guest'
      )}
    </Button>
    {localPlayers.length > 0 && (
      <div className="text-xs text-muted-foreground">
        Current players: {localPlayers.map((p) => p.name).join(', ')}
      </div>
    )}
  </div>
)}
```

**Batting order form gate:** Pass `localPlayers` to `BattingOrderForm` and only render it when `localPlayers.length >= 4`:
```tsx
{localPlayers.length >= 4 && (
  <BattingOrderForm
    group={{ ...group, players: localPlayers }}
    isPending={submitMutation.isPending}
    onSubmit={(order) => submitMutation.mutate({ groupId: group.id, order })}
  />
)}
```

**IMPORTANT:** The batting-order PUT endpoint validates "all players in order must be in this group" via `round_players` join. This works because the guest POST inserts the guest into `round_players` before the batting order is submitted. No changes needed to the PUT endpoint.

### Test Setup — "Guest players" describe block

Reuse existing `casualRoundId` and fixture infrastructure from rounds.test.ts. The new describe block needs:
- A test group in the casual round with 0–3 registered players
- `afterEach`: clean up newly created guest `players` and `round_players` rows (use `db.delete(players).where(eq(players.isGuest, 1))` — cascades not needed since `round_players` is cleaned separately)

For the "group full" test: pre-insert 4 `round_players` rows for the group.

**Count query for group player check:**
```typescript
const countResult = await db
  .select({ count: sql<number>`count(*)` })
  .from(roundPlayers)
  .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.groupId, groupId)))
  .get();
if ((countResult?.count ?? 0) >= 4) {
  return c.json({ error: 'Group full', code: 'GROUP_FULL' }, 422);
}
```

### Important Constraints

- Guests are **not subs** (`isSub: 0`) — subs are league members; guests are entirely external
- Guests **should not appear in the admin roster** — the existing admin roster endpoint filters players by `isActive` and `isGuest` separately; no change needed to that endpoint in this story (admin roster was built in Story 2.3 and already exists)
- `handicapIndex` drives Stableford + money net score calculation — guests need a real index for math to work (the UI must accept decimals, e.g., 12.4)
- Guest `players` rows persist in the DB after the round ends (they're referenced by `hole_scores`, `round_results`) — this is correct and expected; they don't appear in season standings since only official rounds count
- The `ghinNumber` is `null` for guests — the `players.ghin_number` column is already nullable, no schema change needed for that
- No max-guests enforcement beyond the group-full check (4 total: roster + guests)

### What This Story Does NOT Include

- Admin ability to add guests (that would go through admin panel — not needed; the organizer does it in the app)
- Removing a guest once added (out of scope for this story)
- Guest players in season standings (only official rounds count — guests play in casual rounds)
- Guest player names validated against existing roster (intentionally skipped per FR54 — it's a name-only field)

### Project Structure Notes

- Modified: `apps/api/src/db/schema.ts` — `isGuest` column on `players`
- New: `apps/api/src/db/migrations/0004_*.sql` — drizzle-kit generated
- Modified: `apps/api/src/db/migrations/meta/_journal.json` — drizzle-kit updated
- Modified: `apps/api/src/schemas/round.ts` — add `addGuestSchema`
- Modified: `apps/api/src/routes/rounds.ts` — add POST /guests endpoint
- Modified: `apps/api/src/routes/rounds.test.ts` — new "Guest players" describe block
- Modified: `apps/web/src/routes/ball-draw.tsx` — guest form + localPlayers state

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

_None_

### Completion Notes List

- Check ordering in POST /guests: ROUND_NOT_ACTIVE checked before CASUAL_ONLY to surface the correct error code when a finalized official round is used in tests.
- `localPlayers` state in ball-draw.tsx enables guest appending without round query refetch; initialized from `group.players` via useEffect when group first selected (ref guard prevents overwrite on query refetch).
- Guest insert + round_players insert wrapped in a single `db.transaction()` — eliminates orphaned player rows on partial failure and closes the group-capacity race condition.
- `addGuestSchema` name field uses `z.string().trim().min(1)` to reject whitespace-only names at the API boundary.
- GROUP_FULL test temp players now flagged `isGuest: 1` so `afterEach` handles cleanup (removed in-test cleanup that failed to run on assertion error).
- Added whitespace-only name test to cover the trim fix.
- 174 API tests passing; web typecheck and lint clean.

### File List

- `apps/api/src/db/schema.ts`
- `apps/api/src/db/migrations/0004_right_slyde.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/schemas/round.ts`
- `apps/api/src/routes/rounds.ts`
- `apps/api/src/routes/rounds.test.ts`
- `apps/web/src/routes/ball-draw.tsx`
