# Story 3.4: Per-Hole Score Entry

Status: done

## Story

As a scorer,
I want to enter gross scores for each player in my group on a per-hole basis with immediate Stableford feedback,
so that the round is tracked accurately hole-by-hole and totals are always up to date.

## Acceptance Criteria

### Public API — Submit Hole Scores

1. `POST /api/rounds/:roundId/groups/:groupId/holes/:holeNumber/scores` with body `{ scores: [{ playerId, grossScore }, ...] }` (exactly 4 entries) saves gross scores for all 4 players on the given hole.
   - For **official** rounds: requires `x-entry-code` header validated via bcrypt; returns 403 `INVALID_ENTRY_CODE` if missing or wrong.
   - For **casual** rounds: no entry code required.
   - `holeNumber` must be 1–18; returns 400 if out of range.
   - `grossScore` must be integer ≥ 1; returns 400 `VALIDATION_ERROR` if invalid.
   - Exactly 4 score entries required; returns 400 `VALIDATION_ERROR` if wrong count.
   - All `playerId` values must be members of the group; returns 422 `INVALID_SCORES` if any is not.
   - POST is **idempotent via upsert** — re-submitting a hole overwrites previous scores.

2. Returns 422 `ROUND_NOT_ACTIVE` if round status is `finalized` or `cancelled`. (Note: `scheduled` rounds are allowed — scorer may submit before the round officially transitions to `active`.)

3. Returns 404 `NOT_FOUND` if round or group does not exist, or group does not belong to the round.

4. On success returns 200:
   ```json
   {
     "holeScores": [
       { "holeNumber": 1, "playerId": 7, "grossScore": 5 },
       ...
     ],
     "roundTotals": [
       { "playerId": 7, "stablefordTotal": 12 },
       ...
     ]
   }
   ```
   - `holeScores`: all hole scores recorded so far for this group (all players, all holes submitted).
   - `roundTotals`: current cumulative Stableford total per player for the round (recomputed after every submission).

5. After saving, **Stableford points are recomputed** for every submitted hole for each player in the group using `getCourseHole(holeNumber)` and `calculateStablefordPoints(grossScore, handicapIndex, par, strokeIndex)` from `@wolf-cup/engine`. Results are upserted into `round_results` (Stableford only; `moneyTotal` stays 0 until Story 3.5).

### Public API — Fetch Group Scores

6. `GET /api/rounds/:roundId/groups/:groupId/scores` returns all submitted hole scores for the group.
   - Returns 200: `{ scores: [{ holeNumber, playerId, grossScore }, ...] }` sorted by holeNumber asc, then playerId asc.
   - Returns empty array `[]` if no holes submitted yet.
   - Entry code **not required** for GET (read-only, same as GET /rounds/:id).
   - Returns 404 if round or group not found.

### Web — Score Entry Page

7. `ball-draw.tsx`: "Begin Score Entry" button is **enabled** and navigates to `/score-entry-hole` via TanStack Router `<Link>`. Remove the `disabled` attribute and `title="Coming next story"`.

8. `/score-entry-hole` page: on mount reads `wolf-cup:session` from sessionStorage. If no session or `session.groupId` is null, redirects to `/score-entry` immediately.

9. `/score-entry-hole` page fetches:
   - Round detail via `GET /api/rounds/:roundId` (for group players, battingOrder)
   - Existing scores via `GET /api/rounds/:roundId/groups/:groupId/scores` (restore state on page refresh)
   - If `group.battingOrder` is null, redirects to `/ball-draw`.

10. **Hole entry form**: Shows one hole at a time. For each player in batting order:
    - Player name label
    - Native `<input type="number" min="1" max="20">` for gross score
    - Displays hole info header: **Hole N**, **Par X**, **SI Y**, **Type** (Skins / Wolf), **Wolf** (player name or "—")

11. **"Save Hole" button**: disabled until all 4 players have valid integer scores (≥ 1). On click: calls `POST /api/rounds/:roundId/groups/:groupId/holes/:holeNumber/scores` with `x-entry-code` header from `session.entryCode` for official rounds. On success: saves hole data locally, advances to next unscored hole (or summary if hole 18 complete).

12. **Hole navigation**: Previous/next buttons allow reviewing and re-editing any hole. Already-scored holes show entered scores as pre-populated inputs. Navigation wraps from hole 18 to summary.

13. **Round summary**: After hole 18 is submitted, shows a completion state with:
    - Table: Player | Stableford Total (for all 4 players)
    - "Round complete — awaiting finalization" message
    - No finalize button (admin handles finalization)

14. On API error `INVALID_SCORES`, shows inline error "One or more player scores are invalid." On `INVALID_ENTRY_CODE`, shows "Entry code no longer valid — please re-join the round." On network error, shows "Could not save scores — please try again."

### Quality

15. `pnpm --filter @wolf-cup/api test` passes with new tests covering:
    - POST scores: official round + valid code, all 4 players → 200, Stableford computed
    - POST scores: casual round → 200 (no code)
    - POST scores: idempotent re-submit overwrites and recomputes
    - POST scores: wrong entry code → 403
    - POST scores: holeNumber out of range → 400
    - POST scores: grossScore < 1 → 400
    - POST scores: wrong player count → 400
    - POST scores: player not in group → 422 INVALID_SCORES
    - POST scores: finalized round → 422 ROUND_NOT_ACTIVE
    - POST scores: non-existent group → 404
    - GET scores: returns all submitted hole scores sorted correctly
    - GET scores: returns empty array when none submitted
16. `pnpm --filter @wolf-cup/web typecheck` passes.
17. `pnpm --filter @wolf-cup/web lint` passes.

## Tasks / Subtasks

- [x] Task 1: API — POST + GET score endpoints + Stableford recalculation (AC: #1–6, #15)
  - [x] Add `submitHoleScoresSchema` to `apps/api/src/schemas/round.ts`
  - [x] Add `POST /rounds/:roundId/groups/:groupId/holes/:holeNumber/scores` to `apps/api/src/routes/rounds.ts`
  - [x] Add `GET /rounds/:roundId/groups/:groupId/scores` to `apps/api/src/routes/rounds.ts`
  - [x] Add new describe block to `apps/api/src/routes/rounds.test.ts`

- [x] Task 2: Web — score-entry-hole page + ball-draw update (AC: #7–14, #16–17)
  - [x] Update `apps/web/src/routes/ball-draw.tsx`: enable "Begin Score Entry" as `<Link to="/score-entry-hole">`
  - [x] Create `apps/web/src/routes/score-entry-hole.tsx` with full score entry flow

## Dev Notes

### API — Route location (CRITICAL)

Both endpoints go into `apps/api/src/routes/rounds.ts` — the **public** rounds router (NOT admin). The router is mounted at `/api` in `index.ts`, so full URLs are:
- `POST /api/rounds/:roundId/groups/:groupId/holes/:holeNumber/scores`
- `GET /api/rounds/:roundId/groups/:groupId/scores`

No new files. No changes to `apps/api/src/index.ts`.

### API — Entry code gating pattern (CRITICAL: copy exactly from PUT batting-order)

Use the same inline bcrypt pattern established in Story 3.3. Do NOT use any middleware. For official rounds only:

```typescript
app.post('/rounds/:roundId/groups/:groupId/holes/:holeNumber/scores', async (c) => {
  const roundId = Number(c.req.param('roundId'));
  const groupId = Number(c.req.param('groupId'));
  const holeNumber = Number(c.req.param('holeNumber'));

  if (!Number.isInteger(roundId) || roundId <= 0 || !Number.isInteger(groupId) || groupId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }
  if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18) {
    return c.json({ error: 'Invalid hole number', code: 'INVALID_HOLE' }, 400);
  }

  // Fetch round (need status + type + entryCodeHash)
  const round = await db.select({ id: rounds.id, type: rounds.type, status: rounds.status, entryCodeHash: rounds.entryCodeHash })
    .from(rounds).where(eq(rounds.id, roundId)).get();
  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  if (round.status === 'finalized' || round.status === 'cancelled') {
    return c.json({ error: 'Round not active', code: 'ROUND_NOT_ACTIVE' }, 422);
  }

  // Entry code check (official only)
  if (round.type === 'official') {
    const code = c.req.header('x-entry-code');
    if (!code || !round.entryCodeHash) return c.json({ error: 'Invalid entry code', code: 'INVALID_ENTRY_CODE' }, 403);
    const valid = await bcrypt.compare(code, round.entryCodeHash);
    if (!valid) return c.json({ error: 'Invalid entry code', code: 'INVALID_ENTRY_CODE' }, 403);
  }

  // Fetch group (must belong to this round)
  const group = await db.select({ id: groups.id })
    .from(groups).where(and(eq(groups.id, groupId), eq(groups.roundId, roundId))).get();
  if (!group) return c.json({ error: 'Group not found', code: 'NOT_FOUND' }, 404);

  // ... parse body, validate, upsert, recalculate
});
```

### API — Zod schema

Add to `apps/api/src/schemas/round.ts`:

```typescript
export const submitHoleScoresSchema = z.object({
  scores: z.array(z.object({
    playerId: z.number().int().positive(),
    grossScore: z.number().int().min(1).max(20),
  })).length(4),
});
export type SubmitHoleScoresBody = z.infer<typeof submitHoleScoresSchema>;
```

Note: `length(4)` returns 400 VALIDATION_ERROR (Zod schema error) which is correct per the AC. No special handling needed — unlike the batting-order story where we changed to a manual check for 422, here a wrong count is a genuine schema violation worth 400.

### API — hole_scores upsert

The `hole_scores` table has a unique index on `(round_id, player_id, hole_number)`. Use Drizzle's `onConflictDoUpdate` to implement idempotent upsert:

```typescript
for (const { playerId, grossScore } of order) {
  await db.insert(holeScores).values({
    roundId,
    groupId,
    playerId,
    holeNumber,
    grossScore,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [holeScores.roundId, holeScores.playerId, holeScores.holeNumber],
    set: { grossScore, updatedAt: now },
  });
}
```

Import: `import { holeScores, roundResults, ... } from '../db/schema.js';`

### API — Stableford recalculation (CRITICAL: recalculate ALL holes, not just submitted hole)

After saving the hole's scores, recalculate Stableford for every player across ALL their submitted holes (not just the current hole). This handles edits correctly — changing hole 5's score updates the cumulative total.

```typescript
import { getCourseHole, calculateStablefordPoints } from '@wolf-cup/engine';
import type { HoleNumber } from '@wolf-cup/engine';

// Fetch handicaps for this group's players
const groupPlayerRows = await db
  .select({ playerId: roundPlayers.playerId, handicapIndex: roundPlayers.handicapIndex })
  .from(roundPlayers)
  .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.groupId, groupId)));

const handicapMap = new Map(groupPlayerRows.map(p => [p.playerId, p.handicapIndex]));

// Fetch ALL hole scores for this group (all holes submitted so far)
const allHoleScores = await db
  .select({ playerId: holeScores.playerId, holeNumber: holeScores.holeNumber, grossScore: holeScores.grossScore })
  .from(holeScores)
  .where(and(eq(holeScores.roundId, roundId), eq(holeScores.groupId, groupId)));

// Sum Stableford per player
const stablefordTotals = new Map<number, number>();
for (const row of allHoleScores) {
  const hi = handicapMap.get(row.playerId) ?? 0;
  const courseHole = getCourseHole(row.holeNumber as HoleNumber);
  const points = calculateStablefordPoints(row.grossScore, hi, courseHole.par, courseHole.strokeIndex);
  stablefordTotals.set(row.playerId, (stablefordTotals.get(row.playerId) ?? 0) + points);
}

// Upsert round_results per player
const now = Date.now();
for (const [playerId, stablefordTotal] of stablefordTotals) {
  await db.insert(roundResults).values({
    roundId,
    playerId,
    stablefordTotal,
    moneyTotal: 0,  // placeholder until Story 3.5
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [roundResults.roundId, roundResults.playerId],
    set: { stablefordTotal, updatedAt: now },
  });
}
```

**Import additions needed in rounds.ts**:
```typescript
import { getCourseHole, calculateStablefordPoints } from '@wolf-cup/engine';
import type { HoleNumber } from '@wolf-cup/engine';
import { holeScores, roundResults } from '../db/schema.js';
```

### API — GET scores response

Simple query, return all hole scores for the group sorted:
```typescript
const scores = await db
  .select({ holeNumber: holeScores.holeNumber, playerId: holeScores.playerId, grossScore: holeScores.grossScore })
  .from(holeScores)
  .where(and(eq(holeScores.roundId, roundId), eq(holeScores.groupId, groupId)))
  .orderBy(holeScores.holeNumber, holeScores.playerId);
return c.json({ scores }, 200);
```

GET does not require entry code (same as GET /rounds/:id — read-only public endpoint).

### API — POST response shape

Return all hole scores for the group and the computed round totals:
```typescript
return c.json({
  holeScores: allHoleScores,  // already fetched during recalc
  roundTotals: Array.from(stablefordTotals.entries()).map(([playerId, stablefordTotal]) => ({
    playerId,
    stablefordTotal,
  })),
}, 200);
```

### API — Test mock pattern (CRITICAL: same as rounds.test.ts)

Add a new `describe` block at the bottom of `apps/api/src/routes/rounds.test.ts`. Use the existing `beforeAll` fixtures (officialRoundId, casualRoundId, the 4 fresh players p1Id–p4Id, groupOf4Id, casualGroupId from Story 3.3 tests). No new DB setup needed — reuse the existing batting-order test fixtures.

Add `afterEach` to clean up `hole_scores` and `round_results` for the test groups:
```typescript
afterEach(async () => {
  await db.delete(holeScores).where(eq(holeScores.roundId, officialRoundId));
  await db.delete(holeScores).where(eq(holeScores.roundId, casualRoundId));
  await db.delete(roundResults).where(eq(roundResults.roundId, officialRoundId));
  await db.delete(roundResults).where(eq(roundResults.roundId, casualRoundId));
});
```

**CRITICAL**: The `afterEach` in the batting-order describe block resets `battingOrder` to null. The new score tests need the batting order already set (so the group is valid). Set the battingOrder explicitly in `beforeAll` of the score describe block, or at the start of each test via `db.update(groups)`.

Actually, simpler: just set battingOrder before the test. The existing `groupOf4Id` is in `officialRoundId` with players `[p1Id, p2Id, p3Id, p4Id]`. Use those IDs directly for score submission tests.

### API — Stableford computation check

For testing: use a simple hole (e.g., hole 3, par 4, stroke index based on course data). For player with handicapIndex=14.2 shooting grossScore=4 on a par-4 SI-5 hole: they get 0 extra strokes (14.2 playing handicap → floor(14.2/18 * 5) — actually Stableford uses a different formula).

The engine's `calculateStablefordPoints(grossScore, handicapIndex, par, strokeIndex)` handles it internally. Trust the engine for test assertions — just verify the total is an integer ≥ 0, or use a known case from the engine tests.

### Web — Session flow for score entry page

The session contains all needed context:
```typescript
const session = getSession();
// session.roundId  → used for API calls
// session.groupId  → which group to submit for (set in Story 3.3)
// session.entryCode → x-entry-code header for official rounds
```

Guards: redirect to `/score-entry` if no session, redirect to `/ball-draw` if session.groupId is null.

### Web — HOLE_PARS constant

Reuse the same pattern from `ball-draw.tsx`:
```typescript
const HOLE_PARS = [4, 4, 4, 3, 4, 4, 3, 5, 4, 4, 3, 4, 4, 5, 4, 3, 4, 4] as const;
const HOLE_STROKE_INDEXES = [5, 1, 15, 9, 13, 7, 17, 3, 11, 6, 16, 12, 8, 2, 14, 18, 4, 10] as const;
```

Stroke indexes from Guyan G&CC course data (packages/engine/src/course.ts). Both are needed: HOLE_PARS for display, HOLE_STROKE_INDEXES for displaying SI on the hole entry form.

### Web — Wolf schedule derivation (same as ball-draw.tsx)

Reuse the same inline formula (don't import from engine):
```typescript
function buildWolfScheduleFromOrder(battingOrder: number[], players: Player[]): WolfHole[] {
  const nameMap = new Map(players.map((p) => [p.id, p.name]));
  return Array.from({ length: 18 }, (_, i) => {
    const holeNumber = i + 1;
    if (holeNumber <= 2) return { holeNumber, type: 'skins' as const, wolfPlayerId: null, wolfPlayerName: null };
    const wolfPlayerId = battingOrder[(holeNumber - 3) % 4]!;
    return { holeNumber, type: 'wolf' as const, wolfPlayerId, wolfPlayerName: nameMap.get(wolfPlayerId) ?? null };
  });
}
```

### Web — Player order for score entry inputs

Display players in **batting order** (not arbitrary order). The `group.battingOrder` is `number[]` (player IDs in position order). Map each position to a player from `group.players`. This ensures the scorer sees players in the same order as the wolf schedule.

```typescript
const orderedPlayers = group.battingOrder!.map(
  id => group.players.find(p => p.id === id)!
);
```

### Web — Local state management for score entry

```typescript
// Map from holeNumber → Map from playerId → grossScore (already submitted)
const [submittedScores, setSubmittedScores] = useState<Map<number, Map<number, number>>>(new Map());

// Current inputs for the hole being edited (playerId → string value)
const [currentInputs, setCurrentInputs] = useState<Record<number, string>>({});

// Current hole being displayed
const [currentHole, setCurrentHole] = useState<number>(1);
```

On load (from GET /api/rounds/:roundId/groups/:groupId/scores):
- Populate `submittedScores` from returned data
- Set `currentHole` = first unscored hole (min hole not in submittedScores), or 19 (summary state) if all 18 done

When navigating to a hole:
- If that hole already has scores, pre-populate `currentInputs` from `submittedScores`
- If not, clear `currentInputs`

### Web — apiFetch for POST scores

```typescript
const submitMutation = useMutation({
  mutationFn: ({ holeNumber, inputs }: { holeNumber: number; inputs: Record<number, string> }) =>
    apiFetch<SubmitResponse>(`/rounds/${session!.roundId}/groups/${session!.groupId}/holes/${holeNumber}/scores`, {
      method: 'POST',
      headers: session?.entryCode ? { 'x-entry-code': session.entryCode } : {},
      body: JSON.stringify({
        scores: orderedPlayers.map(p => ({
          playerId: p.id,
          grossScore: Number(inputs[p.id]),
        })),
      }),
    }),
  onSuccess: (data, { holeNumber }) => {
    // Update local submitted scores map
    const newMap = new Map(submittedScores);
    const holeMap = new Map<number, number>();
    for (const s of data.holeScores.filter(s => s.holeNumber === holeNumber)) {
      holeMap.set(s.playerId, s.grossScore);
    }
    newMap.set(holeNumber, holeMap);
    setSubmittedScores(newMap);
    // Advance to next hole
    if (holeNumber < 18) {
      setCurrentHole(holeNumber + 1);
      setCurrentInputs({});
    } else {
      setCurrentHole(19); // summary state
    }
  },
});
```

### Web — Hole header info display

For the active hole, show a concise header:
```tsx
const wolfHole = wolfSchedule[currentHole - 1]!;
const par = HOLE_PARS[currentHole - 1]!;
const si = HOLE_STROKE_INDEXES[currentHole - 1]!;

<div className="flex gap-4 text-sm text-muted-foreground mb-3">
  <span>Hole {currentHole}</span>
  <span>Par {par}</span>
  <span>SI {si}</span>
  <span>{wolfHole.type === 'skins' ? 'Skins' : `Wolf: ${wolfHole.wolfPlayerName}`}</span>
</div>
```

### Web — ball-draw.tsx change (minimal)

Only change the `<Button>` at the bottom of the wolf schedule view from disabled to a Link:

```tsx
// Before:
<Button className="min-h-12 w-full mt-2" disabled title="Coming next story">
  Begin Score Entry
</Button>

// After:
<Link to="/score-entry-hole" className="w-full">
  <Button className="min-h-12 w-full mt-2">
    Begin Score Entry
  </Button>
</Link>
```

Must also import `Link` from `@tanstack/react-router` if not already imported. (ball-draw.tsx does NOT currently import Link — add it.)

### Web — TanStack Router route

Create `apps/web/src/routes/score-entry-hole.tsx`. After creating the file, running `pnpm --filter @wolf-cup/web typecheck` will automatically run `tsr generate` to update `routeTree.gen.ts`. No manual routeTree changes needed.

### Web — No new packages needed

All dependencies already present:
- `@tanstack/react-query` (useMutation, useQuery) ✓
- `@tanstack/react-router` (createFileRoute, useRouter, Link) ✓
- `lucide-react` (Loader2, AlertCircle, ChevronLeft, ChevronRight) ✓
- `@/components/ui/button` ✓
- `@/lib/api` (apiFetch) ✓
- `@/lib/session-store` (getSession) ✓

### Database — No migration needed

`hole_scores` and `round_results` tables already exist with correct schema (Story 2.1). No new columns, no new tables required.

### Architecture References

- [Source: epics.md#FR27] — Scorer enters gross scores per hole per player
- [Source: epics.md#FR28] — System calculates net score using handicap + stroke index (Stableford)
- [Source: epics.md#FR30] — Scorer reviews and edits any hole before round finalization (idempotent PUT)
- [Source: epics.md#Additional Requirements] — "Recalculate-on-write: every score POST triggers full round recalculation atomically"
- [Source: schema.ts] — `hole_scores` unique on (round_id, player_id, hole_number); `round_results` unique on (round_id, player_id)
- [Source: 3-3-ball-draw-wolf-assignment-display.md#Dev Notes] — entry code gating inline bcrypt pattern; session.groupId/entryCode/roundId; HOLE_PARS constant

### What This Story Does NOT Include

- Wolf partner decision recording (Story 3.5)
- Greenie/polie recording (Story 3.5)
- Money calculation (Story 3.5 — requires wolf decisions)
- Harvey Cup points (Story 3.8 or later — requires full round results)
- Offline queue / IndexedDB (Story 3.7)
- Round finalization (admin-only, Story 2.x already done)
- Live leaderboard (Story 3.8)

### Project Structure Notes

- Modified: `apps/api/src/routes/rounds.ts` — add POST + GET score endpoints
- Modified: `apps/api/src/schemas/round.ts` — add `submitHoleScoresSchema`
- Modified: `apps/api/src/routes/rounds.test.ts` — new describe block for score submission tests
- Modified: `apps/web/src/routes/ball-draw.tsx` — enable "Begin Score Entry" Link
- New: `apps/web/src/routes/score-entry-hole.tsx`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- 151 API tests passing (134 → 151, +17 new score tests including code review fixes)
- Web typecheck and lint clean
- `submitHoleScoresSchema` uses `.length(4)` → 400 VALIDATION_ERROR for wrong count (correct per AC — unlike batting-order which uses manual check for 422)
- Summary shows Player | Gross | Stableford | Money (—) — matching Excel layout; Stableford restored from GET roundTotals on page refresh
- Code review fixes applied: duplicate playerId validation (M1), Next-button ceiling via firstUnscoredHole (M2), max=20 in allValid check (L3)
- GET /scores now returns `roundTotals` alongside scores so Stableford shows correctly on page refresh

### File List

- Modified: `apps/api/src/schemas/round.ts`
- Modified: `apps/api/src/routes/rounds.ts`
- Modified: `apps/api/src/routes/rounds.test.ts`
- Modified: `apps/web/src/routes/ball-draw.tsx`
- New: `apps/web/src/routes/score-entry-hole.tsx`
