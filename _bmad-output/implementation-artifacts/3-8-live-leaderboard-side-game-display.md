# Story 3.8: Live Leaderboard & Side Game Display

Status: done

## Story

As any user (scorer or spectator),
I want to see a live leaderboard that updates automatically every 5 seconds showing all players' current scores and the side game for the week,
so that I can follow the round in real time from anywhere without having to log in.

## Acceptance Criteria

### API Endpoint

1. `GET /api/leaderboard/live` is publicly accessible (no auth middleware) and returns HTTP 200.

2. When no round is scheduled or active for today:
   - Response: `{ round: null, harveyLiveEnabled: false, sideGame: null, leaderboard: [], lastUpdated: "<ISO datetime>" }`

3. When a round is scheduled or active for today:
   - `round` contains: `id`, `type` (`official`|`casual`), `status`, `scheduledDate`, `autoCalculateMoney` (boolean)
   - `leaderboard` is an array of player rows sorted by `stablefordRank` ascending (rank 1 = highest Stableford)
   - Each player row contains: `playerId`, `name`, `groupId`, `groupNumber`, `thruHole`, `stablefordTotal`, `moneyTotal`, `stablefordRank`, `moneyRank`
   - `thruHole` = max `holeNumber` from `hole_scores` for that player's group; `0` if no scores yet
   - `stablefordTotal` and `moneyTotal` come from `round_results`; `0` if player has no results yet
   - Players with no round_results yet (round just started) are still returned with totals = 0

4. Harvey display: when the round's season has `harvey_live_enabled = 1`:
   - `harveyLiveEnabled: true` in response
   - Each player row additionally contains `harveyStableford` and `harveyMoney` (from `harvey_results`; `null` if no results yet)

5. Side game display: when a `side_games` record for the round's season has `scheduled_round_ids` JSON containing the current round ID:
   - `sideGame: { name: string, format: string }` in response
   - Only the FIRST matching side game is returned (in insertion order)

6. Tie ranking: players with the same `stablefordTotal` receive the same `stablefordRank`; same for `moneyRank`. Ranks are 1-based dense gaps (1, 1, 3 — not 1, 1, 2).

7. `lastUpdated` is the ISO 8601 datetime when the server generated the response (i.e., `new Date().toISOString()`).

### Frontend — Leaderboard Page (`/`)

8. The leaderboard page polls `GET /api/leaderboard/live` every 5 seconds via TanStack Query (`refetchInterval: 5000`).

9. Loading state (initial fetch only): three skeleton rows animate while data is not yet available.

10. Error state: shows "Could not load leaderboard — tap to retry" with a retry `Button`.

11. No-round state: when `data.round === null`, shows "No active round today" message.

12. Active leaderboard: table with columns: **Rank**, **Player** (name + "Thru X"), **Stab**, **Money**. Each row is one player, sorted by `stablefordRank`.

13. "Thru X" display: shows "F" when `thruHole === 18`; shows "Thru X" when `thruHole > 0`; shows "—" when `thruHole === 0` (not started).

14. Harvey Cup columns: when `harveyLiveEnabled`, two additional columns appear: **H.Stab** and **H.Money** showing Harvey Cup points (or "—" if null).

15. Side game banner: when `sideGame` is present, a card above the leaderboard table shows the side game name and format.

16. Staleness indicator: shows "Updated X seconds ago" where X is `Math.floor((Date.now() - new Date(lastUpdated).getTime()) / 1000)`. Updated every second via `setInterval`. Resets on each successful refetch.

17. Manual refresh: a "Refresh" button (with `RefreshCw` lucide icon) at the top triggers `refetch()`. While `isFetching` is true, the icon spins (`animate-spin`).

18. Money display: use `formatMoney()` helper for `moneyTotal` — `+$N` for positive, `-$N` for negative, `$0` for zero.

19. No authentication required. The route must work when the user is not a scorer and has no session.

## Tasks / Subtasks

- [x] Task 1: Create `apps/api/src/routes/leaderboard.ts` (AC: #1–7)
  - [x] `GET /leaderboard/live` handler — no auth middleware
  - [x] Find today's active/scheduled round (same date window as existing `GET /rounds`)
  - [x] Fetch season for `harveyLiveEnabled` flag
  - [x] Fetch all `round_players` with `players.name` and `groups.groupNumber` for the round
  - [x] Compute `thruHole` per group via `MAX(hole_number)` aggregate query on `hole_scores`
  - [x] Fetch `round_results` (LEFT JOIN style — players with no results get totals of 0)
  - [x] If `harveyLiveEnabled`, fetch `harvey_results` for the round
  - [x] Find active side game: fetch all `side_games` for the season, filter JS-side by `scheduledRoundIds` containing roundId
  - [x] Compute `stablefordRank` and `moneyRank` in JS (same-total = same rank, dense gap)
  - [x] Sort final array by `stablefordRank` ascending, then `name` ascending as tiebreaker
  - [x] Return `{ round, harveyLiveEnabled, sideGame, leaderboard, lastUpdated }`

- [x] Task 2: Mount leaderboard router in `apps/api/src/index.ts` (AC: #1)
  - [x] `import leaderboardRouter from './routes/leaderboard.js'`
  - [x] `app.route('/api', leaderboardRouter)` alongside other public routes

- [x] Task 3: Replace `apps/web/src/routes/index.tsx` with live leaderboard component (AC: #8–19)
  - [x] `useQuery` with `queryKey: ['leaderboard']`, `queryFn`, `refetchInterval: 5000`
  - [x] Loading skeleton (3 animated rows)
  - [x] Error state with retry button
  - [x] No-round state
  - [x] Side game banner (conditional)
  - [x] Refresh button + `isFetching` spinner
  - [x] Staleness indicator with `useEffect` + `setInterval(1000)`
  - [x] Leaderboard table with rank, player+thru, stab, money columns
  - [x] Harvey columns (conditional on `harveyLiveEnabled`)
  - [x] `formatMoney()` helper

- [x] Task 4: Write API tests in `apps/api/src/routes/leaderboard.test.ts` (AC: #1–7)
  - [x] No active round today → 200, `round: null`, empty leaderboard
  - [x] Active round, no scores → all players at totals 0, thruHole 0
  - [x] Active round with scores → correct `thruHole`, totals from `round_results`
  - [x] Rank ties → tied players get same rank, next rank skips correctly (dense)
  - [x] `harveyLiveEnabled: false` → no harvey fields on player rows
  - [x] `harveyLiveEnabled: true` → harvey fields present
  - [x] Side game with matching roundId → `sideGame` populated
  - [x] Side game not matching → `sideGame: null`

- [x] Task 5: Typecheck + lint (AC: all)
  - [x] `pnpm --filter @wolf-cup/api typecheck`
  - [x] `pnpm --filter @wolf-cup/web typecheck`
  - [x] `pnpm --filter @wolf-cup/api lint` (or root lint)
  - [x] `pnpm --filter @wolf-cup/web lint`

## Dev Notes

### API Route File

**New file:** `apps/api/src/routes/leaderboard.ts` — exported default as `app` (same pattern as `rounds.ts`).

**Mount in `apps/api/src/index.ts`:**
```typescript
import leaderboardRouter from './routes/leaderboard.js';
// ...
app.route('/api', leaderboardRouter);
```

### API Response Contract

```typescript
// GET /api/leaderboard/live
type LeaderboardPlayer = {
  playerId: number;
  name: string;
  groupId: number;
  groupNumber: number;
  thruHole: number;        // 0 = not started; 1–18 = last scored hole; no "F" sentinel needed — F is UI logic
  stablefordTotal: number; // 0 if no round_results yet
  moneyTotal: number;      // 0 if no round_results yet
  stablefordRank: number;  // 1-based, ties get same rank
  moneyRank: number;
  harveyStableford: number | null; // only populated if harveyLiveEnabled; null if no harvey_results yet
  harveyMoney: number | null;
};

type LeaderboardResponse = {
  round: {
    id: number;
    type: 'official' | 'casual';
    status: string;
    scheduledDate: string;
    autoCalculateMoney: boolean;
  } | null;
  harveyLiveEnabled: boolean;
  sideGame: { name: string; format: string } | null;
  leaderboard: LeaderboardPlayer[];
  lastUpdated: string; // ISO 8601 datetime — new Date().toISOString()
};
```

### API Implementation Strategy

**Step 1: Find today's round** (same query as GET /rounds but `.get()` instead of array):
```typescript
const TODAY = new Date().toISOString().slice(0, 10);
const round = await db
  .select({
    id: rounds.id, type: rounds.type, status: rounds.status,
    scheduledDate: rounds.scheduledDate, autoCalculateMoney: rounds.autoCalculateMoney,
    seasonId: rounds.seasonId,
  })
  .from(rounds)
  .where(and(
    eq(rounds.scheduledDate, TODAY),
    inArray(rounds.status, ['scheduled', 'active']),
  ))
  .orderBy(desc(rounds.scheduledDate))
  .get();

if (!round) return c.json({ round: null, harveyLiveEnabled: false, sideGame: null, leaderboard: [], lastUpdated: new Date().toISOString() }, 200);
```

**Step 2: Season (for harveyLiveEnabled):**
```typescript
const season = await db
  .select({ harveyLiveEnabled: seasons.harveyLiveEnabled })
  .from(seasons).where(eq(seasons.id, round.seasonId)).get();
const harveyLiveEnabled = Boolean(season?.harveyLiveEnabled);
```

**Step 3: All round_players with group info:**
```typescript
const playerRows = await db
  .select({
    playerId: roundPlayers.playerId,
    groupId: roundPlayers.groupId,
    groupNumber: groups.groupNumber,
    name: players.name,
  })
  .from(roundPlayers)
  .innerJoin(players, eq(players.id, roundPlayers.playerId))
  .innerJoin(groups, eq(groups.id, roundPlayers.groupId))
  .where(eq(roundPlayers.roundId, round.id));
```

**Step 4: thruHole per group** (aggregate MAX by groupId):
```typescript
const thruHoleRows = await db
  .select({
    groupId: holeScores.groupId,
    thruHole: sql<number>`max(${holeScores.holeNumber})`,
  })
  .from(holeScores)
  .where(eq(holeScores.roundId, round.id))
  .groupBy(holeScores.groupId);
const thruHoleMap = new Map(thruHoleRows.map(r => [r.groupId, r.thruHole ?? 0]));
```

**Step 5: round_results** (players who have submitted at least 1 hole):
```typescript
const resultRows = await db
  .select({
    playerId: roundResults.playerId,
    stablefordTotal: roundResults.stablefordTotal,
    moneyTotal: roundResults.moneyTotal,
  })
  .from(roundResults)
  .where(eq(roundResults.roundId, round.id));
const resultMap = new Map(resultRows.map(r => [r.playerId, r]));
```

**Step 6: harvey_results (conditional):**
```typescript
let harveyMap = new Map<number, { stablefordPoints: number; moneyPoints: number }>();
if (harveyLiveEnabled) {
  const harveyRows = await db
    .select({
      playerId: harveyResults.playerId,
      stablefordPoints: harveyResults.stablefordPoints,
      moneyPoints: harveyResults.moneyPoints,
    })
    .from(harveyResults)
    .where(eq(harveyResults.roundId, round.id));
  harveyMap = new Map(harveyRows.map(r => [r.playerId, r]));
}
```

**Step 7: Active side game** (JS filter on scheduledRoundIds JSON):
```typescript
const allSideGames = await db
  .select({ name: sideGames.name, format: sideGames.format, scheduledRoundIds: sideGames.scheduledRoundIds })
  .from(sideGames)
  .where(eq(sideGames.seasonId, round.seasonId));
const activeSideGame = allSideGames.find(sg => {
  try {
    const ids = JSON.parse(sg.scheduledRoundIds ?? '[]') as number[];
    return Array.isArray(ids) && ids.includes(round.id);
  } catch { return false; }
});
const sideGame = activeSideGame ? { name: activeSideGame.name, format: activeSideGame.format } : null;
```

**Step 8: Rank assignment** (dense ranking, same score = same rank):
```typescript
function assignRanks(items: { playerId: number; total: number }[]): Map<number, number> {
  const sorted = [...items].sort((a, b) => b.total - a.total);
  const ranks = new Map<number, number>();
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i]!.total < sorted[i - 1]!.total) rank = i + 1;
    ranks.set(sorted[i]!.playerId, rank);
  }
  return ranks;
}
```

**Step 9: Assemble and sort leaderboard:**
```typescript
const stablefordRanks = assignRanks(playerRows.map(p => ({
  playerId: p.playerId, total: resultMap.get(p.playerId)?.stablefordTotal ?? 0,
})));
const moneyRanks = assignRanks(playerRows.map(p => ({
  playerId: p.playerId, total: resultMap.get(p.playerId)?.moneyTotal ?? 0,
})));

const leaderboard: LeaderboardPlayer[] = playerRows
  .map(p => {
    const result = resultMap.get(p.playerId);
    const harvey = harveyMap.get(p.playerId);
    return {
      playerId: p.playerId,
      name: p.name,
      groupId: p.groupId,
      groupNumber: p.groupNumber,
      thruHole: thruHoleMap.get(p.groupId) ?? 0,
      stablefordTotal: result?.stablefordTotal ?? 0,
      moneyTotal: result?.moneyTotal ?? 0,
      stablefordRank: stablefordRanks.get(p.playerId) ?? playerRows.length,
      moneyRank: moneyRanks.get(p.playerId) ?? playerRows.length,
      harveyStableford: harveyLiveEnabled ? (harvey?.stablefordPoints ?? null) : null,
      harveyMoney: harveyLiveEnabled ? (harvey?.moneyPoints ?? null) : null,
    };
  })
  .sort((a, b) => a.stablefordRank - b.stablefordRank || a.name.localeCompare(b.name));
```

### DB Imports for leaderboard.ts

```typescript
import { rounds, groups, roundPlayers, players, holeScores, roundResults, harveyResults, seasons, sideGames } from '../db/schema.js';
```

Note: `harveyResults` and `seasons` and `sideGames` are in schema but currently only used in admin routes. They are safe to import here.

### Frontend Component Structure (`apps/web/src/routes/index.tsx`)

```typescript
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

// Types matching LeaderboardResponse
// formatMoney helper (same as score-entry-hole.tsx)
// Staleness hook logic (setInterval inside useEffect)
// Component
```

**`formatMoney` helper** — same as `score-entry-hole.tsx`:
```typescript
function formatMoney(amount: number): string {
  if (amount > 0) return `+$${amount}`;
  if (amount < 0) return `-$${Math.abs(amount)}`;
  return '$0';
}
```

**Staleness indicator** — update every second:
```typescript
const [secondsAgo, setSecondsAgo] = useState(0);

useEffect(() => {
  if (!data?.lastUpdated) return;
  // Compute immediately on mount/data change
  setSecondsAgo(Math.floor((Date.now() - new Date(data.lastUpdated).getTime()) / 1000));
  const interval = setInterval(() => {
    setSecondsAgo(Math.floor((Date.now() - new Date(data.lastUpdated).getTime()) / 1000));
  }, 1000);
  return () => clearInterval(interval);
}, [data?.lastUpdated]);
```

**"Thru X" display logic:**
```typescript
function formatThru(thruHole: number): string {
  if (thruHole === 0) return '—';
  if (thruHole === 18) return 'F';
  return `Thru ${thruHole}`;
}
```

**TanStack Query config:**
```typescript
const { data, isLoading, isError, isFetching, refetch } = useQuery({
  queryKey: ['leaderboard'],
  queryFn: () => apiFetch<LeaderboardResponse>('/leaderboard/live'),
  refetchInterval: 5000,
  // staleTime: 4000 from global QueryClient defaults (already configured)
});
```

**Loading skeleton** (3 rows, matches existing skeleton patterns in score-entry-hole.tsx):
```tsx
{isLoading && (
  <div className="p-4 flex flex-col gap-3">
    {[1, 2, 3].map((n) => (
      <div key={n} className="h-12 rounded-xl bg-muted animate-pulse" />
    ))}
  </div>
)}
```

**Leaderboard table layout** (mobile-first):
```tsx
<table className="w-full text-sm">
  <thead>
    <tr className="border-b text-muted-foreground">
      <th className="text-left py-2 pr-2 w-8">#</th>
      <th className="text-left py-2 pr-2">Player</th>
      <th className="text-right py-2 pr-2">Stab</th>
      <th className="text-right py-2 pr-2">Money</th>
      {data.harveyLiveEnabled && <th className="text-right py-2 pr-2">H.Stab</th>}
      {data.harveyLiveEnabled && <th className="text-right py-2">H.Money</th>}
    </tr>
  </thead>
  <tbody>
    {data.leaderboard.map((player) => (
      <tr key={player.playerId} className="border-b last:border-0">
        <td className="py-2 pr-2 font-medium">{player.stablefordRank}</td>
        <td className="py-2 pr-2">
          <div className="font-medium">{player.name}</div>
          <div className="text-xs text-muted-foreground">{formatThru(player.thruHole)}</div>
        </td>
        <td className="py-2 pr-2 text-right font-medium">{player.stablefordTotal}</td>
        <td className="py-2 pr-2 text-right">{formatMoney(player.moneyTotal)}</td>
        {data.harveyLiveEnabled && (
          <td className="py-2 pr-2 text-right">
            {player.harveyStableford !== null ? player.harveyStableford : '—'}
          </td>
        )}
        {data.harveyLiveEnabled && (
          <td className="py-2 text-right">
            {player.harveyMoney !== null ? player.harveyMoney : '—'}
          </td>
        )}
      </tr>
    ))}
  </tbody>
</table>
```

### Test File Patterns

Follow the same pattern as `rounds.test.ts`:
- `vi.mock('../db/index.js', ...)` using in-memory SQLite
- `beforeAll`: run migrations, seed seasons/rounds/groups/players
- `afterEach`: clean test data (preserve season fixture)
- Import `leaderboardApp` from `./leaderboard.js`
- Use `leaderboardApp.request(...)` for HTTP tests

**Test file location:** `apps/api/src/routes/leaderboard.test.ts`

**Seeding for tests** — needs: `seasons`, `rounds`, `groups`, `round_players`, `players`. For scored tests also: `hole_scores`, `round_results`. For Harvey tests: `harvey_results`. For side game tests: `side_games`.

```typescript
// Example: active round with 4 players, 1 group, scores through hole 5
// thruHole should be 5 for all players in the group
// stablefordTotal comes from round_results
```

### Project Structure Notes

- **New file:** `apps/api/src/routes/leaderboard.ts` — pattern matches `rounds.ts`
- **Modified:** `apps/api/src/index.ts` — mount leaderboard router
- **Modified:** `apps/web/src/routes/index.tsx` — replace placeholder with full leaderboard component
- **New file:** `apps/api/src/routes/leaderboard.test.ts` — API tests
- No schema changes needed — reads from existing `round_results`, `harvey_results`, `hole_scores`, `seasons`, `side_games`
- No migrations needed

### Architecture Compliance

- Public endpoint (no auth middleware): architecture mandates "GET /api/leaderboard/* — public, no middleware" [Source: architecture.md — Authentication & Security]
- `refetchInterval: 5000`: architecture mandates "TanStack Query refetchInterval: 5000, staleTime: 4000 for leaderboard polling" [Source: architecture.md — Frontend Architecture]
- `staleTime: 4000` is already set globally in `apps/web/src/lib/query-client.ts`
- Architecture says `GET /api/leaderboard/live` returns `lastUpdated` timestamp [Source: architecture.md — API & Communication Patterns]
- Leaderboard ranking is LEAGUE-WIDE across all groups, not per-group [Source: epics.md — FR5, NFR5]
- No engine calls on leaderboard read — reads from pre-computed `round_results` and `harvey_results` [Source: architecture.md — Data Architecture — "Reads query stored results — no engine call on read"]

### Side Game Data Model Note

`side_games.scheduled_round_ids` is a TEXT column containing a JSON array of round IDs (e.g., `[1, 2, 3]`). The JSON is parsed in JavaScript — do NOT use SQLite JSON functions. If `scheduled_round_ids` is null/empty, treat as `[]`.

### Harvey Results Table Note

`harvey_results` stores `stableford_points` and `money_points` as `real` (can be `0.5` for tie splits). Display as-is (e.g., "8.0" or "6.5"). The `stablefordRank` and `moneyRank` columns in `harvey_results` are the Harvey ranks, not the leaderboard display ranks — don't confuse them. The leaderboard rank (`stablefordRank` on `LeaderboardPlayer`) is derived from `round_results.stableford_total`, not from Harvey data.

### References

- FR36: "Any user can view the live in-round leaderboard without authentication" [Source: epics.md]
- FR37: "Leaderboard displays each player's current Stableford score, money position, and the last hole their group has completed" [Source: epics.md]
- FR38: "Leaderboard automatically refreshes at regular intervals without user action" (5s) [Source: epics.md; architecture.md]
- FR39: "Users can manually trigger an immediate leaderboard refresh" [Source: epics.md]
- FR40: "Leaderboard displays a data freshness indicator showing time since last update" [Source: epics.md]
- FR41: "Admin can toggle live Harvey Cup points display on the mid-round leaderboard" (display side only) [Source: epics.md]
- FR55: "App displays the active weekly side game name and format to all users" [Source: epics.md]
- NFR5: "Harvey Cup points are assigned to league-wide ranks (not per-group ranks)" [Source: epics.md]
- NFR16: "Leaderboard polling interval: 5 seconds; update visible to all users within 10 seconds of score entry" [Source: epics.md]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

_None_

### Completion Notes List

- All 13 new leaderboard tests pass (187 API tests total); typecheck and lint clean for both api and web.
- Code review fixes: (M1) round ordering changed from `orderBy(rounds.id)` to `orderBy(desc(rounds.id))` so most-recently-created round wins when multiple rounds exist today; (M2) `lastUpdated` moved to just before each `return c.json()` to accurately reflect response generation time; (M3) thruHole test now asserts all 4 players in the group show the same group-scoped value, not just Alice.
- `assignRanks` uses dense ranking: sorted descending by total, rank advances to `i+1` only when total strictly drops — matches the 1,1,3 pattern specified in AC#6.
- `thruHole` uses `MAX(hole_number)` SQL aggregate grouped by `groupId`; players in groups with no scores default to 0 via Map lookup fallback.
- Harvey fields are always `null` when `harveyLiveEnabled: false`; populated only when enabled (null if no harvey_results row exists for that player).
- Side game matching is JS-side JSON parse of `scheduled_round_ids` TEXT column; gracefully handles null/malformed JSON.
- Frontend staleness indicator resets on each successful refetch via `data?.lastUpdated` as `useEffect` dependency.

### File List

- `apps/api/src/routes/leaderboard.ts` (new)
- `apps/api/src/routes/leaderboard.test.ts` (new)
- `apps/api/src/index.ts` (modified — mount leaderboard router)
- `apps/web/src/routes/index.tsx` (modified — full leaderboard component)
