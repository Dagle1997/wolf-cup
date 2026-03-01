# Story 3.3: Ball Draw & Wolf Assignment Display

Status: done

## Story

As a scorer,
I want to record my group's ball draw batting order and see the wolf assignment for every hole,
so that I know who is wolf on each hole before score entry begins.

## Acceptance Criteria

### Public API — Save Batting Order

1. `PUT /api/rounds/:roundId/groups/:groupId/batting-order` with body `{ order: [id1, id2, id3, id4] }` saves the batting order for the group.
   - For **official** rounds: requires `x-entry-code` header validated via bcrypt against `rounds.entryCodeHash`; returns 403 `INVALID_ENTRY_CODE` if missing or wrong.
   - For **casual** rounds: no entry code required.
   - On success returns 200: `{ group: { id, groupNumber, battingOrder: number[], wolfSchedule: WolfHoleSchedule[] } }`.
   - `battingOrder` in response is a parsed `number[]` (not a JSON string).

2. Returns 422 `INVALID_BATTING_ORDER` if:
   - `order` does not have exactly 4 entries.
   - Any player ID in `order` is not registered in the group (via `round_players`).
   - Duplicate player IDs present.

3. Returns 404 `NOT_FOUND` if the round or group does not exist, or if the group does not belong to the round.

4. Returns 422 `ROUND_NOT_JOINABLE` if round status is `finalized` or `cancelled`.

5. The `wolfSchedule` in the response is an array of 18 objects (one per hole):
   ```json
   [
     { "holeNumber": 1, "type": "skins", "wolfPlayerId": null, "wolfPlayerName": null },
     { "holeNumber": 2, "type": "skins", "wolfPlayerId": null, "wolfPlayerName": null },
     { "holeNumber": 3, "type": "wolf", "wolfPlayerId": 7, "wolfPlayerName": "Josh Stoll" },
     ...
   ]
   ```
   Computed deterministically from the batting order using the engine's `getWolfAssignment`.

### Public API — GET Round Detail Update

6. `GET /api/rounds/:id` (and the internal `getRoundDetail` helper) returns `battingOrder` as `number[] | null` (parsed from JSON) instead of `string | null`. Groups with no batting order return `battingOrder: null`.

### Web — Ball Draw Page

7. `/score-entry` confirmation view: "Start Ball Draw" button is **enabled** and navigates to `/ball-draw` via TanStack Router `<Link>`. Remove the "Coming next story" disabled state.

8. `/ball-draw` page: on mount reads `wolf-cup:session` from sessionStorage. If no session exists, redirects to `/score-entry` immediately.

9. `/ball-draw` page fetches round detail via `GET /api/rounds/:id` (using `session.roundId`). Shows the group players and the batting order entry UI. If the group's `battingOrder` is already set (non-null), skips entry and shows the wolf schedule directly (allows page refresh after ball draw without re-entering).

10. Ball draw UI shows 4 labeled positions: **1st**, **2nd**, **3rd**, **4th**. Each position has a player selector (native `<select>` styled with Tailwind) listing the players in the group. A player selected in one position is disabled in all other selectors (prevents duplicates).

11. "Confirm Ball Draw" button is disabled until all 4 positions are filled with distinct players. On submit: calls `PUT /api/rounds/:id/groups/:groupId/batting-order` with `x-entry-code` header (from `session.entryCode`) for official rounds, no header for casual. On success: stores `groupId` in session (`wolf-cup:session`), transitions to wolf schedule view.

12. Wolf schedule view: shows a table of all 18 holes with columns **Hole**, **Par**, **Type**, **Wolf**. Skins holes (1–2): Type = "Skins", Wolf = "—". Wolf holes (3–18): Type = "Wolf", Wolf = player name. Below the table: a "Begin Score Entry" placeholder button (disabled, `title="Coming next story"`).

13. On API error `INVALID_BATTING_ORDER`, shows inline error "Invalid batting order — please check player assignments." On `INVALID_ENTRY_CODE`, shows "Entry code no longer valid — please re-join the round." On network error, shows "Something went wrong — please try again."

### Session Store Update

14. `WolfSession` type is extended with `groupId: number | null`. `score-entry.tsx` sets `groupId: null` when creating the session on join. `ball-draw.tsx` updates `groupId` in the session after successful batting order save.

### Quality

15. `pnpm --filter @wolf-cup/api test` passes with new tests covering:
    - PUT batting order: official round + valid code → 200, battingOrder saved, wolfSchedule computed correctly (hole 3 wolf = first batter, etc.)
    - PUT batting order: casual round → 200 (no code required)
    - PUT batting order: official round + wrong code → 403
    - PUT batting order: player ID not in group → 422 `INVALID_BATTING_ORDER`
    - PUT batting order: duplicate player IDs → 422 `INVALID_BATTING_ORDER`
    - PUT batting order: wrong player count (3 or 5) → 422 `INVALID_BATTING_ORDER`
    - PUT batting order: non-existent group → 404
    - PUT batting order: group belonging to different round → 404
    - GET /rounds/:id: battingOrder returned as `number[]` after being set

16. `pnpm --filter @wolf-cup/web typecheck` passes.
17. `pnpm --filter @wolf-cup/web lint` passes.

## Tasks / Subtasks

- [x] Task 1: API — PUT batting-order endpoint + GET update (AC: #1–6, #15)
  - [x] Add `PUT /rounds/:roundId/groups/:groupId/batting-order` to `apps/api/src/routes/rounds.ts`
  - [x] Add Zod schema `battingOrderSchema` to `apps/api/src/schemas/round.ts`
  - [x] Update `getRoundDetail` helper to parse `battingOrder` JSON string → `number[] | null`
  - [x] Create `apps/api/src/routes/rounds.test.ts` additions (or new describe block) for batting-order tests

- [x] Task 2: Web — Ball draw page + session update (AC: #7–14, #16–17)
  - [x] Extend `WolfSession` type in `apps/web/src/lib/session-store.ts` to add `groupId: number | null`
  - [x] Update `score-entry.tsx` to set `groupId: null` when creating session, and enable "Start Ball Draw" as a `<Link to="/ball-draw">`
  - [x] Create `apps/web/src/routes/ball-draw.tsx` with full ball draw flow

## Dev Notes

### API — Route structure (CRITICAL: public rounds router, not admin)

This endpoint goes into `apps/api/src/routes/rounds.ts` (the **public** rounds router, NOT `admin/rounds.ts`). Mount path: `app.put('/rounds/:roundId/groups/:groupId/batting-order', ...)`.

The public router is already mounted at `/api` in `index.ts`, so the full URL is `/api/rounds/:roundId/groups/:groupId/batting-order`.

### API — Entry code gating pattern

Same inline pattern as `POST /rounds/:id/start` (Story 3.2). Do NOT use `entryCodeMiddleware` — it reads from query params, not path params. Inline the bcrypt check:

```typescript
app.put('/rounds/:roundId/groups/:groupId/batting-order', async (c) => {
  const roundId = Number(c.req.param('roundId'));
  const groupId = Number(c.req.param('groupId'));
  if (!Number.isInteger(roundId) || roundId <= 0 || !Number.isInteger(groupId) || groupId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  // Fetch round (need status + type + entryCodeHash)
  const round = await db.select({ id: rounds.id, type: rounds.type, status: rounds.status,
    entryCodeHash: rounds.entryCodeHash }).from(rounds).where(eq(rounds.id, roundId)).get();
  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  if (round.status === 'finalized' || round.status === 'cancelled')
    return c.json({ error: 'Round not joinable', code: 'ROUND_NOT_JOINABLE' }, 422);

  // Entry code check (official only)
  if (round.type === 'official') {
    const code = c.req.header('x-entry-code');
    if (!code || !round.entryCodeHash) return c.json({ error: 'Invalid entry code', code: 'INVALID_ENTRY_CODE' }, 403);
    const valid = await bcrypt.compare(code, round.entryCodeHash);
    if (!valid) return c.json({ error: 'Invalid entry code', code: 'INVALID_ENTRY_CODE' }, 403);
  }

  // Fetch group
  const group = await db.select().from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.roundId, roundId))).get();
  if (!group) return c.json({ error: 'Group not found', code: 'NOT_FOUND' }, 404);

  // Parse and validate body
  const body = await c.req.json();
  const parsed = battingOrderSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);
  const { order } = parsed.data;

  // Validate all 4 players are in the group
  const groupPlayers = await db.select({ playerId: roundPlayers.playerId })
    .from(roundPlayers).where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.groupId, groupId)));
  const validPlayerIds = new Set(groupPlayers.map(p => p.playerId));
  for (const id of order) {
    if (!validPlayerIds.has(id))
      return c.json({ error: 'Invalid batting order', code: 'INVALID_BATTING_ORDER' }, 422);
  }
  if (new Set(order).size !== 4)
    return c.json({ error: 'Invalid batting order', code: 'INVALID_BATTING_ORDER' }, 422);

  // Save battingOrder as JSON
  await db.update(groups).set({ battingOrder: JSON.stringify(order) }).where(eq(groups.id, groupId));

  // Compute wolf schedule
  const wolfSchedule = buildWolfSchedule(order, groupPlayers with player names...);
  // ...
});
```

### API — Wolf schedule computation

Import `getWolfAssignment` from `@wolf-cup/engine` (already a dep of `apps/api`):

```typescript
import { getWolfAssignment } from '@wolf-cup/engine';
// BattingOrder<TPlayerId> is [TPlayerId, TPlayerId, TPlayerId, TPlayerId]
// Use number IDs as the generic:
const battingOrderTuple: [number, number, number, number] = [order[0], order[1], order[2], order[3]];

// Fetch player names for the group
const playerRows = await db.select({ playerId: roundPlayers.playerId, name: players.name })
  .from(roundPlayers)
  .innerJoin(players, eq(roundPlayers.playerId, players.id))
  .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.groupId, groupId)));
const playerNameMap = new Map(playerRows.map(p => [p.playerId, p.name]));

const wolfSchedule = Array.from({ length: 18 }, (_, i) => {
  const holeNumber = (i + 1) as HoleNumber;
  const assignment = getWolfAssignment(battingOrderTuple, holeNumber);
  if (assignment.type === 'skins') {
    return { holeNumber, type: 'skins' as const, wolfPlayerId: null, wolfPlayerName: null };
  }
  const wolfPlayerId = battingOrderTuple[assignment.wolfBatterIndex];
  return {
    holeNumber,
    type: 'wolf' as const,
    wolfPlayerId,
    wolfPlayerName: playerNameMap.get(wolfPlayerId) ?? null,
  };
});
```

Import `HoleNumber` type from `@wolf-cup/engine`:
```typescript
import { getWolfAssignment, type HoleNumber } from '@wolf-cup/engine';
```

### API — Update getRoundDetail to parse battingOrder

Change the battingOrder field in the assembled groups:
```typescript
battingOrder: g.battingOrder ? (JSON.parse(g.battingOrder) as number[]) : null,
```

This is a BREAKING CHANGE to the GET /api/rounds/:id response (battingOrder changes from `string|null` to `number[]|null`). Update the TypeScript types in `score-entry.tsx` accordingly — the `RoundDetail.groups[].battingOrder` field type changes from `string | null` to `number[] | null`. **Update rounds.test.ts** to reflect parsed type for existing tests that check battingOrder.

### API — Zod schema for batting order

Add to `apps/api/src/schemas/round.ts`:

```typescript
export const battingOrderSchema = z.object({
  order: z.array(z.number().int().positive()).length(4),
});
```

Note: The length(4) check only validates count. Duplicate and membership checks are done in the handler after fetching group players from DB.

### API — Test mock path

`rounds.test.ts` is in `src/routes/` (NOT `src/routes/admin/`). Mock paths use:
- `vi.mock('../db/index.js')` (one level up from routes/)
- `import { db } from '../db/index.js'`
- `migrationsFolder = resolve(__dirname, '../db/migrations')`

This is already established from Story 3.2. Do NOT change to `../../db/index.js`.

### Web — Session store: WolfSession extension

Update `apps/web/src/lib/session-store.ts`:

```typescript
export type WolfSession = {
  roundId: number;
  entryCode: string | null;
  groupId: number | null;  // set after ball draw group is selected
};
```

Update `score-entry.tsx` where `setSession` is called to include `groupId: null`:
```typescript
const session: WolfSession = {
  roundId: variables.id,
  entryCode: variables.code ?? null,
  groupId: null,
};
```

### Web — TanStack Router: new ball-draw route

Create `apps/web/src/routes/ball-draw.tsx`:
```typescript
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { getSession, setSession } from '@/lib/session-store';

export const Route = createFileRoute('/ball-draw')({
  component: BallDrawPage,
});

function BallDrawPage() {
  const router = useRouter();
  const session = getSession();

  useEffect(() => {
    if (!session) {
      router.navigate({ to: '/score-entry' });
    }
  }, []);

  if (!session) return null; // redirect pending
  // ...
}
```

After `tsr generate` (called by `pnpm --filter @wolf-cup/web typecheck`), the route tree is updated automatically.

### Web — score-entry.tsx changes

In the confirmation view, change the "Start Ball Draw" button from disabled `<Button>` to a `<Link>` (TanStack Router):

```tsx
import { Link } from '@tanstack/react-router';
// ...
<Link to="/ball-draw">
  <Button className="mt-4 min-h-12 w-full max-w-xs">
    Start Ball Draw
  </Button>
</Link>
```

Remove `disabled` attribute and the "Ball draw coming in next story" paragraph. Also update the RoundDetail type — `battingOrder` on groups changes from `string | null` to `number[] | null` (matches the updated API response).

### Web — Ball draw UI design (mobile-first)

The ball draw page has 3 states:
1. **Loading**: skeleton while fetching round detail
2. **Entry form**: 4 position selectors + submit button
3. **Schedule view**: wolf hole table (after successful submission or if battingOrder already set)

**Entry form** — 4 position rows using native `<select>` styled with Tailwind:

```tsx
const POSITIONS = ['1st', '2nd', '3rd', '4th'] as const;

function BattingOrderForm({ group, onSubmit }: { group: Group; onSubmit: (order: number[]) => void }) {
  const [order, setOrder] = useState<(number | null)[]>([null, null, null, null]);
  // players: group.players
  // For each position, show dropdown with players NOT selected elsewhere
  const usedIds = new Set(order.filter(id => id !== null) as number[]);

  return (
    <div className="flex flex-col gap-3">
      {POSITIONS.map((pos, idx) => (
        <div key={pos} className="flex items-center gap-3">
          <span className="w-8 font-semibold text-sm text-muted-foreground">{pos}</span>
          <select
            className="flex-1 border rounded-lg p-3 min-h-12 bg-background"
            value={order[idx] ?? ''}
            onChange={e => {
              const newOrder = [...order];
              newOrder[idx] = e.target.value ? Number(e.target.value) : null;
              setOrder(newOrder);
            }}
          >
            <option value="">— select player —</option>
            {group.players.map(p => (
              <option key={p.id} value={p.id} disabled={usedIds.has(p.id) && order[idx] !== p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      ))}
      <Button
        className="min-h-12 w-full mt-2"
        disabled={order.some(id => id === null)}
        onClick={() => onSubmit(order as number[])}
      >
        Confirm Ball Draw
      </Button>
    </div>
  );
}
```

**Wolf schedule table** — after ball draw confirmed:

```tsx
<table className="w-full text-sm">
  <thead>
    <tr className="border-b">
      <th className="text-left py-2">Hole</th>
      <th className="text-left py-2">Par</th>
      <th className="text-left py-2">Type</th>
      <th className="text-left py-2">Wolf</th>
    </tr>
  </thead>
  <tbody>
    {wolfSchedule.map(hole => (
      <tr key={hole.holeNumber} className="border-b last:border-0">
        <td className="py-2">{hole.holeNumber}</td>
        <td className="py-2">{courseHoles[hole.holeNumber - 1]?.par ?? '—'}</td>
        <td className="py-2">{hole.type === 'skins' ? 'Skins' : 'Wolf'}</td>
        <td className="py-2">{hole.wolfPlayerName ?? '—'}</td>
      </tr>
    ))}
  </tbody>
</table>
```

Note: `courseHoles` — either hardcode the Guyan G&CC pars inline or import them. Since the web does NOT import from `@wolf-cup/engine`, hardcode a `HOLE_PARS` constant:

```typescript
// Par for each hole 1-18 at Guyan G&CC (from engine/course.ts)
const HOLE_PARS = [4,4,4,3,4,4,3,5,4,4,3,4,4,5,4,3,4,4] as const;
// Usage: HOLE_PARS[holeNumber - 1]
```

This avoids adding the engine package as a web dependency while keeping the display correct.

### Web — apiFetch for PUT

```typescript
const submitMutation = useMutation({
  mutationFn: ({ groupId, order }: { groupId: number; order: number[] }) =>
    apiFetch<{ group: GroupWithSchedule }>(`/rounds/${session!.roundId}/groups/${groupId}/batting-order`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(session!.entryCode ? { 'x-entry-code': session!.entryCode } : {}),
      },
      body: JSON.stringify({ order }),
    }),
  onSuccess: (data) => {
    setSession({ ...session!, groupId: data.group.id });
    setWolfSchedule(data.group.wolfSchedule);
  },
  onError: (err: Error) => {
    if (err.message === 'INVALID_BATTING_ORDER') setError('Invalid batting order — please check player assignments.');
    else if (err.message === 'INVALID_ENTRY_CODE') setError('Entry code no longer valid — please re-join the round.');
    else setError('Something went wrong — please try again.');
  },
});
```

### Web — Handling multiple groups on ball draw page

For MVP, admin creates groups and assigns players. The round detail returns `groups[]`. The ball draw page should:
- If 1 group: auto-select it
- If multiple groups: show a group selector first (radio/tap cards), then show ball draw for selected group

Since all 2026 rounds likely have exactly 1 group of 4, handle multiple groups simply (list, user taps their group).

### Architecture References

- [Source: architecture.md#API Structure] — public routes in `apps/api/src/routes/rounds.ts`; no admin routes modified
- [Source: architecture.md#Authorization tiers] — PUT batting-order is code-gated (same as score submission routes)
- [Source: architecture.md#Frontend Architecture] — web routes: `/ball-draw` is new file route; scoring display from API responses
- [Source: architecture.md#Component architecture] — `components/score-entry/WolfDisplay` mentioned as future component
- [Source: architecture.md#Naming Patterns] — kebab-case files, camelCase functions, PascalCase components
- FR26 — Scorer records ball draw batting order for their group
- FR29 — Wolf assignment displayed to scorer per hole (deterministic from engine)
- NFR10 — Wolf hole assignments must be deterministic and immutable once ball draw is entered

### What This Story Does NOT Include

- Gross score entry per hole (Story 3.4)
- Wolf partner decision recording (Story 3.5)
- Guest player addition (Story 3.6)
- Offline queue (Story 3.7)
- The "Begin Score Entry" button is a disabled placeholder only

### Project Structure Notes

- Modified: `apps/api/src/routes/rounds.ts` — add PUT batting-order endpoint + update getRoundDetail
- Modified: `apps/api/src/schemas/round.ts` — add `battingOrderSchema`
- Modified: `apps/api/src/routes/rounds.test.ts` — add describe block for PUT batting-order + update battingOrder type in GET test
- Modified: `apps/web/src/lib/session-store.ts` — add `groupId` to WolfSession
- Modified: `apps/web/src/routes/score-entry.tsx` — enable ball draw button + update RoundDetail type
- New: `apps/web/src/routes/ball-draw.tsx` — ball draw + wolf schedule page

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Wolf schedule for the "already set" restore case is computed client-side inline (simple 2-line rotation formula: holes 1-2 = skins, holes 3-18 = battingOrder[(hole-3)%4]) rather than calling PUT again, avoiding a redundant API round-trip.
- `eslint-disable` comments for `react-hooks/exhaustive-deps` were removed because the rule is not configured in the project's ESLint config (no react-hooks plugin).
- 134/134 API tests pass (2 added during code review); web typecheck and lint both clean.

### Code Review Fixes (2026-02-28)

- **H1 fixed**: Removed `.length(4)` from `battingOrderSchema`; added explicit length check in handler returning 422 `INVALID_BATTING_ORDER` (matching AC#2). Updated wrong-count test to assert 422 + code, added 5-player over-count test.
- **M1 fixed**: Added test for 422 `ROUND_NOT_JOINABLE` on PUT batting-order with a finalized round (AC#4 coverage).
- **M2 fixed**: Split merged `useEffect([data])` into two effects with correct dependency arrays — `[data, selectedGroupId]` for auto-select, `[data, selectedGroupId, wolfSchedule]` for wolf-schedule restore. Multi-group restore now fires when user selects their group, not only when data first loads.

### File List

- `apps/api/src/routes/rounds.ts` — added PUT batting-order endpoint, updated getRoundDetail to parse battingOrder
- `apps/api/src/schemas/round.ts` — added battingOrderSchema + BattingOrderBody type
- `apps/api/src/routes/rounds.test.ts` — added 10 batting-order tests (29 total in public rounds suite)
- `apps/web/src/lib/session-store.ts` — added groupId field to WolfSession
- `apps/web/src/routes/score-entry.tsx` — set groupId: null on join, enabled Start Ball Draw as Link
- `apps/web/src/routes/ball-draw.tsx` — new ball draw + wolf schedule page
