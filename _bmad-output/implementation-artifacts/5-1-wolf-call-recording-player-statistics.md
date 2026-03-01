# Story 5.1: Wolf Call Recording & Player Statistics

Status: done (code review complete)

## Story

As any user (scorer, spectator, or admin),
I want to view personal stat summaries for each player — wolf call record, net birdies/eagles, greenies, polies, and best/worst round money — across all seasons,
so that I can follow individual player performances and bragging rights beyond the season standings.

## Acceptance Criteria

### API Endpoint

1. `GET /api/stats` is publicly accessible (no auth middleware) and returns HTTP 200.

2. Response shape:
   ```typescript
   type PlayerStats = {
     playerId: number;
     name: string;
     // Wolf record (as wolf player, official finalized rounds only)
     wolfCallsTotal: number;   // total holes where this player was wolf
     wolfCallsAlone: number;   // decision = 'alone' OR 'blind_wolf'
     wolfCallsPartner: number; // decision = 'partner'
     wolfWins: number;         // outcome = 'win'
     wolfLosses: number;       // outcome = 'loss'
     wolfPushes: number;       // outcome = 'push'
     // Scoring stats (official finalized rounds)
     netBirdies: number;       // holes where net score = par − 1
     netEagles: number;        // holes where net score ≤ par − 2 (eagle + double eagle)
     greenies: number;         // appearances in bonusesJson.greenies across all official rounds
     polies: number;           // appearances in bonusesJson.polies across all official rounds
     // Money stats (official finalized rounds, per-round totals)
     biggestRoundWin: number;  // max(moneyTotal) across rounds; 0 if never positive
     biggestRoundLoss: number; // min(moneyTotal) across rounds; 0 if never negative
   };
   type StatsResponse = {
     players: PlayerStats[];   // sorted by name ascending
     lastUpdated: string;      // ISO 8601, set just before response returned
   };
   ```

3. Stats are computed across **all seasons** (FR59: "persistent across rounds and seasons") — not just the current season.

4. Only **official** rounds with status **`finalized`** are included. Casual rounds and non-finalized official rounds are excluded.

5. Only non-guest players (`players.is_guest = 0`) are included. Guest players (casual-round-only) are excluded.

6. **Wolf record** (AC for FR57): derived from `wolf_decisions` rows where `wolfPlayerId = playerId`:
   - `wolfCallsTotal` = count of wolf_decisions rows for this player as wolf in official finalized rounds
   - `wolfCallsAlone` = count where `decision IN ('alone', 'blind_wolf')`
   - `wolfCallsPartner` = count where `decision = 'partner'`
   - `wolfWins/Losses/Pushes` = count where `outcome = 'win'/'loss'/'push'`
   - Holes where wolfPlayerId is NULL (skins holes 1–2) are never counted in wolf record

7. **Net birdies/eagles** (AC for FR58): computed on-the-fly from `hole_scores` joined to `round_players` for handicap index, using engine functions `getHandicapStrokes(handicapIndex, strokeIndex)` and `getCourseHole(holeNumber)` (both from `@wolf-cup/engine`):
   - `netScore = grossScore − getHandicapStrokes(handicapIndex, strokeIndex)`
   - `netBirdie` if `netScore === par − 1`
   - `netEagle` if `netScore <= par − 2` (counts both eagle and double eagle toward this total)

8. **Greenies and polies**: counted from `wolf_decisions.bonusesJson` (JSON text `{ greenies?: number[], polies?: number[] }`):
   - Player appears in `greenies` array → increment their `greenies` count
   - Player appears in `polies` array → increment their `polies` count
   - All `wolf_decisions` rows for official finalized rounds are scanned (not just rows where the player was wolf)

9. **Biggest round money**: derived from `round_results.moneyTotal` per player:
   - `biggestRoundWin` = max `moneyTotal` across all their official finalized round results (0 if never > 0)
   - `biggestRoundLoss` = min `moneyTotal` across all their official finalized round results (0 if never < 0)
   - Note: this is per-round total, not per-hole (no per-hole money table exists in schema)

10. Response sorted by `name` ascending. Players with no stats at all (no rounds played, no wolf decisions) still appear in the list with all counts at 0.

### Frontend — Stats Page (`/stats`)

11. New route `apps/web/src/routes/stats.tsx`. `GET /api/stats` fetched once on mount (no polling; manual refresh with `RefreshCw` button like standings).

12. Loading state: three skeleton rows while data loads.

13. Error state: "Could not load stats — tap to retry" with retry `Button`.

14. Empty state (no players at all): "No statistics available yet."

15. Stats table with mobile-friendly horizontal scroll (`overflow-x-auto`). Columns:
    - **Player** (name)
    - **Wolf** (`wolfWins`−`wolfLosses`−`wolfPushes` format, e.g. `"8−3−1"`)
    - **Alone** (`wolfCallsAlone`)
    - **Partner** (`wolfCallsPartner`)
    - **Birdies** (`netBirdies`)
    - **Eagles** (`netEagles`)
    - **Greenies** (`greenies`)
    - **Polies** (`polies`)
    - **Best $** (`biggestRoundWin`, shown as `+$N` or `$0`)
    - **Worst $** (`biggestRoundLoss`, shown as `−$N` or `$0`)

16. Row sorted by player name ascending (same as API response order).

17. Bottom navigation: update `apps/web/src/routes/__root.tsx` to add a 4th Stats nav tab. Change `grid-cols-3` to `grid-cols-4`, add `<Link to="/stats">📈 Stats</Link>` as the 4th item.

18. No authentication required.

## Tasks / Subtasks

- [x] Task 1: Create `apps/api/src/routes/stats.ts` (AC: #1–10)
  - [x] `GET /stats` handler — no auth middleware
  - [x] Fetch all non-guest active players (`is_guest = 0, is_active = 1`)
  - [x] Fetch all wolf_decisions joined to official finalized rounds (for wolf record + greenies/polies)
  - [x] Fetch all hole_scores joined to rounds + round_players (for net birdies/eagles)
  - [x] Fetch round_results joined to official finalized rounds (for biggest win/loss)
  - [x] Compute wolf record per player from wolf_decisions rows
  - [x] Compute greenies/polies per player from bonusesJson parsing
  - [x] Compute net birdies/eagles using `getHandicapStrokes` + `getCourseHole` from engine
  - [x] Compute biggestRoundWin/biggestRoundLoss from round_results
  - [x] Return `{ players: PlayerStats[], lastUpdated }`

- [x] Task 2: Mount stats router in `apps/api/src/index.ts` (AC: #1)
  - [x] `import statsRouter from './routes/stats.js'`
  - [x] `app.route('/api', statsRouter)` alongside other public routes

- [x] Task 3: Create `apps/web/src/routes/stats.tsx` (AC: #11–18)
  - [x] `useQuery` with `queryKey: ['stats']`, `queryFn: () => apiFetch<StatsResponse>('/stats')`
  - [x] Loading skeleton (3 rows)
  - [x] Error state with retry
  - [x] Empty state
  - [x] Stats table with overflow-x-auto scroll
  - [x] All 10 columns per AC#15
  - [x] Refresh button + `isFetching` spinner

- [x] Task 4: Update `apps/web/src/routes/__root.tsx` nav (AC: #17)
  - [x] Change `grid-cols-3` to `grid-cols-4`
  - [x] Add `<Link to="/stats">` with 📈 icon

- [x] Task 5: Write API tests in `apps/api/src/routes/stats.test.ts` (AC: #1–10)
  - [x] Empty DB → 200, empty players array
  - [x] Player with no rounds → appears with all zeros
  - [x] Wolf record counted correctly (alone/partner/win/loss/push)
  - [x] Blind wolf counted as `wolfCallsAlone`
  - [x] Greenies/polies extracted from bonusesJson correctly
  - [x] Net birdies computed correctly (gross - handicap strokes vs par)
  - [x] Net eagles computed correctly
  - [x] Biggest round win/loss from round_results
  - [x] Only official finalized rounds counted (casual excluded, active excluded)
  - [x] Guest players excluded from results

- [x] Task 6: Typecheck + lint (AC: all)
  - [x] `pnpm --filter @wolf-cup/api typecheck`
  - [x] `pnpm --filter @wolf-cup/web typecheck`
  - [x] `pnpm lint`

## Dev Notes

### Data Sources & Schema

All stats are computed on-the-fly from existing tables — **no new DB tables or migrations needed**:

| Stat | Source table(s) | Filter |
|------|----------------|--------|
| Wolf record | `wolf_decisions` JOIN `rounds` | `rounds.type='official'`, `rounds.status='finalized'`, `wd.wolf_player_id IS NOT NULL` |
| Greenies/Polies | `wolf_decisions.bonuses_json` JOIN `rounds` | same as above |
| Net birdies/eagles | `hole_scores` JOIN `rounds` + `round_players` | `rounds.type='official'`, `rounds.status='finalized'` |
| Biggest round $/loss | `round_results` JOIN `rounds` | same as above |

`wolf_decisions` table key fields:
```typescript
wolfPlayerId: integer  // null on skins holes 1–2 — always skip these
decision: text         // 'partner' | 'alone' | 'blind_wolf' | null
partnerPlayerId: integer
bonusesJson: text      // JSON: { greenies?: number[], polies?: number[] }
outcome: text          // 'win' | 'loss' | 'push' | null
```

### API Implementation Strategy

**Step 1: All non-guest players**
```typescript
const allPlayers = await db
  .select({ id: players.id, name: players.name })
  .from(players)
  .where(and(eq(players.isActive, 1), eq(players.isGuest, 0)))
  .orderBy(players.name);
```

**Step 2: Wolf decisions for official finalized rounds (innerJoin)**
```typescript
import { wolfDecisions, rounds, holeScores, roundPlayers, roundResults } from '../db/schema.js';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { getCourseHole, getHandicapStrokes } from '@wolf-cup/engine';

const wdRows = await db
  .select({
    wolfPlayerId: wolfDecisions.wolfPlayerId,
    decision: wolfDecisions.decision,
    outcome: wolfDecisions.outcome,
    bonusesJson: wolfDecisions.bonusesJson,
  })
  .from(wolfDecisions)
  .innerJoin(rounds, eq(rounds.id, wolfDecisions.roundId))
  .where(and(eq(rounds.type, 'official'), eq(rounds.status, 'finalized')));
```

**Step 3: Hole scores for birdies/eagles (innerJoin both rounds and round_players)**
```typescript
const hsRows = await db
  .select({
    playerId: holeScores.playerId,
    holeNumber: holeScores.holeNumber,
    grossScore: holeScores.grossScore,
    handicapIndex: roundPlayers.handicapIndex,
  })
  .from(holeScores)
  .innerJoin(rounds, eq(rounds.id, holeScores.roundId))
  .innerJoin(
    roundPlayers,
    and(
      eq(roundPlayers.roundId, holeScores.roundId),
      eq(roundPlayers.playerId, holeScores.playerId),
    ),
  )
  .where(and(eq(rounds.type, 'official'), eq(rounds.status, 'finalized')));
```

**Step 4: Round money totals**
```typescript
const rrRows = await db
  .select({ playerId: roundResults.playerId, moneyTotal: roundResults.moneyTotal })
  .from(roundResults)
  .innerJoin(rounds, eq(rounds.id, roundResults.roundId))
  .where(and(eq(rounds.type, 'official'), eq(rounds.status, 'finalized')));
```

**Step 5: Aggregate stats per player**
```typescript
// Wolf record
const wolfMap = new Map<number, { total: number; alone: number; partner: number; wins: number; losses: number; pushes: number }>();
for (const row of wdRows) {
  if (row.wolfPlayerId == null) continue; // skip skins holes
  const s = wolfMap.get(row.wolfPlayerId) ?? { total: 0, alone: 0, partner: 0, wins: 0, losses: 0, pushes: 0 };
  s.total++;
  if (row.decision === 'alone' || row.decision === 'blind_wolf') s.alone++;
  else if (row.decision === 'partner') s.partner++;
  if (row.outcome === 'win') s.wins++;
  else if (row.outcome === 'loss') s.losses++;
  else if (row.outcome === 'push') s.pushes++;
  wolfMap.set(row.wolfPlayerId, s);
}

// Greenies + polies
const greenieMap = new Map<number, number>();
const polieMap = new Map<number, number>();
for (const row of wdRows) {
  if (!row.bonusesJson) continue;
  try {
    const b = JSON.parse(row.bonusesJson) as { greenies?: number[]; polies?: number[] };
    for (const pid of b.greenies ?? []) greenieMap.set(pid, (greenieMap.get(pid) ?? 0) + 1);
    for (const pid of b.polies ?? []) polieMap.set(pid, (polieMap.get(pid) ?? 0) + 1);
  } catch { /* ignore malformed JSON */ }
}

// Net birdies/eagles
const birdieMap = new Map<number, number>();
const eagleMap = new Map<number, number>();
for (const row of hsRows) {
  const courseHole = getCourseHole(row.holeNumber as 1);
  const strokes = getHandicapStrokes(row.handicapIndex, courseHole.strokeIndex);
  const netScore = row.grossScore - strokes;
  if (netScore === courseHole.par - 1) {
    birdieMap.set(row.playerId, (birdieMap.get(row.playerId) ?? 0) + 1);
  } else if (netScore <= courseHole.par - 2) {
    eagleMap.set(row.playerId, (eagleMap.get(row.playerId) ?? 0) + 1);
  }
}

// Biggest round win/loss
const winMap = new Map<number, number>();
const lossMap = new Map<number, number>();
for (const row of rrRows) {
  winMap.set(row.playerId, Math.max(winMap.get(row.playerId) ?? 0, row.moneyTotal));
  lossMap.set(row.playerId, Math.min(lossMap.get(row.playerId) ?? 0, row.moneyTotal));
}
```

**Step 6: Build response array**
```typescript
const playerStats = allPlayers.map((p) => {
  const w = wolfMap.get(p.id);
  return {
    playerId: p.id,
    name: p.name,
    wolfCallsTotal: w?.total ?? 0,
    wolfCallsAlone: w?.alone ?? 0,
    wolfCallsPartner: w?.partner ?? 0,
    wolfWins: w?.wins ?? 0,
    wolfLosses: w?.losses ?? 0,
    wolfPushes: w?.pushes ?? 0,
    netBirdies: birdieMap.get(p.id) ?? 0,
    netEagles: eagleMap.get(p.id) ?? 0,
    greenies: greenieMap.get(p.id) ?? 0,
    polies: polieMap.get(p.id) ?? 0,
    biggestRoundWin: winMap.get(p.id) ?? 0,
    biggestRoundLoss: lossMap.get(p.id) ?? 0,
  };
});

return c.json({ players: playerStats, lastUpdated: new Date().toISOString() }, 200);
```

### Engine Imports for stats.ts

```typescript
import { getCourseHole, getHandicapStrokes } from '@wolf-cup/engine';
```

`getCourseHole(holeNumber)` returns `{ hole, par, strokeIndex, yardages }`.
`getHandicapStrokes(handicapIndex, strokeIndex)` returns integer number of strokes.
`holeNumber` must be cast to `1` (or the HoleNumber type) for TypeScript — use `row.holeNumber as Parameters<typeof getCourseHole>[0]` or just `row.holeNumber as 1` (TS accepts numeric union assignments from integer columns).

### Frontend Component: Stats Table

```typescript
// apps/web/src/routes/stats.tsx
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

export const Route = createFileRoute('/stats')({
  component: StatsPage,
});
```

Wolf column display helper:
```typescript
function wolfRecord(p: PlayerStats): string {
  return `${p.wolfWins}−${p.wolfLosses}−${p.wolfPushes}`;
}

function formatMoney(n: number): string {
  if (n === 0) return '$0';
  return n > 0 ? `+$${n}` : `−$${Math.abs(n)}`;
}
```

Table structure (overflow-x-auto wrapping the table):
```tsx
<div className="overflow-x-auto">
  <table className="w-full text-sm min-w-[640px]">
    <thead>
      <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
        <th className="py-2 px-2 text-left">Player</th>
        <th className="py-2 px-2 text-center">Wolf<br/><span className="font-normal">W-L-P</span></th>
        <th className="py-2 px-2 text-center">Alone</th>
        <th className="py-2 px-2 text-center">Partner</th>
        <th className="py-2 px-2 text-center">Birdies</th>
        <th className="py-2 px-2 text-center">Eagles</th>
        <th className="py-2 px-2 text-center">Greenies</th>
        <th className="py-2 px-2 text-center">Polies</th>
        <th className="py-2 px-2 text-right">Best $</th>
        <th className="py-2 px-2 text-right">Worst $</th>
      </tr>
    </thead>
    <tbody>
      {players.map((p) => (
        <tr key={p.playerId} className="border-b last:border-0">
          <td className="py-2 px-2 font-medium">{p.name}</td>
          <td className="py-2 px-2 text-center tabular-nums">{wolfRecord(p)}</td>
          <td className="py-2 px-2 text-center tabular-nums">{p.wolfCallsAlone}</td>
          <td className="py-2 px-2 text-center tabular-nums">{p.wolfCallsPartner}</td>
          <td className="py-2 px-2 text-center tabular-nums">{p.netBirdies}</td>
          <td className="py-2 px-2 text-center tabular-nums">{p.netEagles}</td>
          <td className="py-2 px-2 text-center tabular-nums">{p.greenies}</td>
          <td className="py-2 px-2 text-center tabular-nums">{p.polies}</td>
          <td className="py-2 px-2 text-right tabular-nums text-green-600">{formatMoney(p.biggestRoundWin)}</td>
          <td className="py-2 px-2 text-right tabular-nums text-destructive">{formatMoney(p.biggestRoundLoss)}</td>
        </tr>
      ))}
    </tbody>
  </table>
</div>
```

### Nav Update (__root.tsx)

Change bottom nav from 3 to 4 columns:
```tsx
// Before:
<nav className="... grid-cols-3 ...">
// After:
<nav className="... grid-cols-4 ...">
```

Add 4th link:
```tsx
<Link to="/stats" className="flex flex-col items-center py-3 text-xs [&.active]:font-bold">
  <span>📈</span>Stats
</Link>
```

### Test File Patterns

Follow same `vi.mock('../db/index.js')` + in-memory SQLite pattern as `leaderboard.test.ts` and `standings.test.ts`.

Key seeding for stats tests:
```typescript
// wolf_decisions row
await db.insert(wolfDecisions).values({
  roundId, groupId,
  holeNumber: 3,
  wolfPlayerId: p1Id,
  decision: 'alone',
  partnerPlayerId: null,
  bonusesJson: JSON.stringify({ greenies: [p1Id], polies: [p2Id] }),
  outcome: 'win',
  createdAt: Date.now(),
});

// hole_scores row (for birdies)
await db.insert(holeScores).values({
  roundId, groupId,
  playerId: p1Id,
  holeNumber: 6,  // par 3, strokeIndex 17
  grossScore: 2,  // net birdie if handicap >= 1 (strokeIndex 17 → gets stroke only if handicap >= 17)
  createdAt: Date.now(),
  updatedAt: Date.now(),
});
```

For net birdie test: hole 12 (par 3, strokeIndex 18). A player with `handicapIndex = 18` gets 1 stroke on every hole → stroke on hole 12. Gross 2 → net 1 → net birdie (par 3 − 1 = 2... wait, net score 1 vs par 3 → netBirdie yes, par - 1 = 2... no: net = gross(2) - strokes(1) = 1, par = 3, net - par = 1 - 3 = -2 → that's an eagle!

Let me recalculate: hole 12, par=3, strokeIndex=18. HandicapIndex=18:
- `getHandicapStrokes(18, 18)` = floor(18/18)=1 base + (18 <= 0? no) = 1
- net = 2 - 1 = 1
- net vs par: 1 vs 3 → net = par - 2 → eagle!

For a birdie: gross=2 on hole 12 (par 3) with handicapIndex=0 → 0 strokes → net=2 → par-3-1=2 → birdie. Yes.

Or simpler: hole 6 (par 3, strokeIndex 17), handicapIndex=0, gross=2 → net=2 → par-1=2 → birdie.

Use handicap=0 for pure net score tests to keep math simple.

### Architecture Compliance

- **Public endpoint**: `GET /api/stats` — no auth, consistent with other public routes [Source: architecture.md — Three-tier auth]
- **Engine imports in API**: `getCourseHole` and `getHandicapStrokes` from `@wolf-cup/engine` — package is a peer dependency of `@wolf-cup/api` [Source: architecture.md — Package Structure]
- **On-the-fly computation**: no new tables needed; stats aggregated in JS from existing `wolf_decisions`, `hole_scores`, `round_results` [Source: architecture.md — Data Architecture]
- **Official rounds only for stats**: consistent with standings and leaderboard filtering [Source: architecture.md — Cross-Cutting Concerns]
- **Persistent across seasons**: querying all finalized official rounds regardless of season [Source: FR59]
- **`lastUpdated` set just before response**: established pattern from Story 3.8 code review fix

### Project Structure Notes

- **New file:** `apps/api/src/routes/stats.ts` — `GET /stats`, no auth
- **New file:** `apps/api/src/routes/stats.test.ts` — API tests
- **New file:** `apps/web/src/routes/stats.tsx` — stats page
- **Modified:** `apps/api/src/index.ts` — mount stats router
- **Modified:** `apps/web/src/routes/__root.tsx` — add Stats nav tab, `grid-cols-4`
- No schema changes or migrations needed
- TanStack Router will auto-regenerate `routeTree.gen.ts` on `tsr generate` (run as part of `pnpm --filter @wolf-cup/web typecheck`)

### Important: Per-Hole vs Per-Round Money

FR58 specifies "biggest single-hole money win and loss". The current schema stores only per-round totals (`round_results.money_total`), not per-hole money deltas. There is **no `hole_money_results` table** in the schema.

This story implements `biggestRoundWin`/`biggestRoundLoss` using per-round data. If per-hole tracking is needed in the future, a `hole_money_results` table would need to be added and populated during the score-submission recalculate-on-write path (Stories 3.4/3.5 territory). That is a separate future story if required.

### References

- FR57: "The system records wolf call decisions (alone vs. partner, partner selected, win/loss outcome) per player per hole for statistical purposes" [Source: epics.md]
- FR58: "The app provides statistical summaries per player including most wolves called, wolf win/loss record, most net birdies, most greenies, most polies, and biggest single-hole money win and loss" [Source: epics.md]
- FR59: "Statistical data is stored persistently in a relational database to support historical queries across rounds and seasons" [Source: epics.md]
- `wolf_decisions` schema: `wolfPlayerId`, `decision`, `outcome`, `bonusesJson` [Source: apps/api/src/db/schema.ts:236-266]
- `getCourseHole(n)` returns `{ hole, par, strokeIndex, yardages }` [Source: packages/engine/src/course.ts]
- `getHandicapStrokes(handicapIndex, strokeIndex)` returns number of strokes [Source: packages/engine/src/stableford.ts:7-12]
- `innerJoin` usage pattern established in `leaderboard.ts` and `standings.ts` — Drizzle `.innerJoin(table, on)` [Source: apps/api/src/routes/leaderboard.ts]
- Nav is `grid-cols-3` with 3 links; needs `grid-cols-4` for 4th Stats tab [Source: apps/web/src/routes/__root.tsx:17]
- `vi.mock` + in-memory SQLite test pattern [Source: apps/api/src/routes/standings.test.ts:7-14]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None.

### Completion Notes List

- Implemented `GET /api/stats` — public endpoint aggregating wolf record, net birdies/eagles, greenies/polies, biggest round win/loss across all official finalized rounds (all seasons).
- Wolf record uses `wolfDecisions` inner-joined to `rounds` (type='official', status='finalized'); skins holes (wolfPlayerId=null) skipped.
- Greenies/polies parsed from `bonusesJson` on every wolf_decisions row (not just rows where player was wolf).
- Net birdies/eagles computed on-the-fly using `getCourseHole` + `getHandicapStrokes` from `@wolf-cup/engine`; `netScore === par-1` = birdie, `netScore <= par-2` = eagle.
- Biggest round win/loss uses `round_results.money_total` per-round (no per-hole money table exists).
- Guest players (`is_guest=1`) excluded; response sorted by name ascending.
- Added 4th Stats tab to bottom nav in `__root.tsx` (`grid-cols-3` → `grid-cols-4`).
- 15 new API tests; 215 total tests pass. API typecheck, web typecheck, lint all clean.

### File List

- apps/api/src/routes/stats.ts (new)
- apps/api/src/routes/stats.test.ts (new)
- apps/web/src/routes/stats.tsx (new)
- apps/api/src/index.ts (modified — mount statsRouter)
- apps/web/src/routes/__root.tsx (modified — grid-cols-4, Stats nav tab)
- apps/web/src/routeTree.gen.ts (auto-regenerated by tsr generate)

## Change Log

- 2026-03-01: Implemented Story 5.1 — GET /api/stats endpoint, stats.tsx frontend page, Stats nav tab, 15 API tests. 215 total tests pass.
- 2026-03-01: Code review fixes — M1: renamed misleading test (added Alice/Bob assertions); M2: added test for greenies/polies from non-wolf rows; M3+L1: added wolfCallsTotal and wolfWins assertions to blind_wolf test; L2: added inactive player exclusion test. 217 total tests pass.
