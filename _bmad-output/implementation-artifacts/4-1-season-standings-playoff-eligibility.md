# Story 4.1: Season Standings & Playoff Eligibility

Status: done (code review complete)

## Story

As any user (scorer, spectator, or admin),
I want to view the year-to-date season standings showing each player's Harvey Cup totals, rounds played, drop score, and playoff eligibility,
so that I can follow the season race and know which players are on track for the playoff.

## Acceptance Criteria

### API Endpoint

1. `GET /api/standings` is publicly accessible (no auth middleware) and returns HTTP 200.

2. When no season exists in the database:
   - Response: `{ season: null, fullMembers: [], subs: [], lastUpdated: "<ISO datetime>" }`

3. When a season exists, the response includes:
   - `season`: `{ id, name, totalRounds, roundsCompleted }` where `roundsCompleted` = count of `official` rounds with status `finalized` for the season
   - `fullMembers`: array of player standing rows for players who are full members (see AC#5)
   - `subs`: array of player standing rows for sub players (see AC#5), may be empty
   - `lastUpdated`: ISO 8601 string — `new Date().toISOString()` set just before the response is returned

4. Each player standing row contains:
   - `playerId`, `name`
   - `roundsPlayed`: count of official non-cancelled rounds the player has `harvey_results` for
   - `roundsDropped`: `max(0, roundsPlayed - 10)` — rounds excluded by best-10 rule
   - `stablefordTotal`: best-10 stableford Harvey points (from `calculateSeasonTotal`)
   - `moneyTotal`: best-10 money Harvey points (from `calculateSeasonTotal`)
   - `combinedTotal`: `stablefordTotal + moneyTotal` (used for ranking)
   - `rank`: 1-based dense rank among their section (full members ranked separately from subs)
   - `isPlayoffEligible`: `true` only for full members with `rank <= 8`; always `false` for subs

5. Full member vs. sub classification:
   - A player is classified as a **full member** if they have at least one `round_players` entry with `is_sub = 0` for this season's rounds
   - A player is classified as a **sub** if ALL their `round_players` entries for this season have `is_sub = 1`
   - Only players with at least one `harvey_results` row for the season appear in standings

6. `fullMembers` sorted by `rank` ascending then `name` ascending (same dense-rank tiebreaker as leaderboard). `subs` sorted the same way (ranked independently within their section).

7. Only **official** rounds (type = `'official'`) with status **not** `'cancelled'` are counted. Casual rounds are excluded entirely from standings. Cancelled official rounds count toward `roundsCompleted = 0` for them (i.e., they're excluded from `roundsCompleted` count too — only `finalized` counts).

8. Best-10 drop applied correctly: the engine's `calculateSeasonTotal(regularRounds, [])` is called with the player's array of `{ stablefordPoints, moneyPoints }` from `harvey_results`. The function selects the top 10 rounds by combined score; if ≤ 10 rounds, no drops.

### Frontend — Standings Page (`/standings`)

9. The standings page fetches `GET /api/standings` once on mount (no polling; manual refresh only).

10. Loading state: three skeleton rows animate while data is not yet available.

11. Error state: shows "Could not load standings — tap to retry" with a retry `Button`.

12. No-season state: when `data.season === null`, shows "No season data available" message.

13. Season header: shows season name and `"Round {roundsCompleted} of {totalRounds}"`.

14. Full members table with columns: **Rank**, **Player** (name + rounds sub-line), **Stab**, **Money**, **Total**. Each row shows `rank`, `name`, `"Rnd {roundsPlayed} (−{roundsDropped})"` sub-line, `stablefordTotal`, `moneyTotal`, `combinedTotal`. Rows with `isPlayoffEligible = true` get a subtle visual indicator (e.g., `bg-green-50 dark:bg-green-950/20` row or a `🏆` prefix on rank).

15. Subs section: only shown when `data.subs.length > 0`. Displayed below the full members table with a "Substitutes" header. Same column layout as full members table but no playoff eligibility indicator.

16. "Refresh" button with `RefreshCw` lucide icon at the top; spins while `isFetching`.

17. `formatHarvey(points: number): string` helper: displays Harvey points rounded to 1 decimal place when they contain a `.5` (tie split), integer otherwise. E.g. `4` → `"4"`, `3.5` → `"3.5"`.

18. No authentication required.

## Tasks / Subtasks

- [x] Task 1: Create `apps/api/src/routes/standings.ts` (AC: #1–8)
  - [x] `GET /standings` handler — no auth middleware
  - [x] Find current season (most recent by `start_date` desc)
  - [x] Fetch all official non-cancelled rounds for the season
  - [x] Fetch `harvey_results` for those round IDs
  - [x] Fetch `round_players` to determine sub classification per player
  - [x] Fetch `players.name` for each player
  - [x] Apply `calculateSeasonTotal` per player
  - [x] Classify full members vs. subs
  - [x] Assign dense ranks within each section
  - [x] Mark `isPlayoffEligible` for top-8 full members
  - [x] Return `{ season, fullMembers, subs, lastUpdated }`

- [x] Task 2: Mount standings router in `apps/api/src/index.ts` (AC: #1)
  - [x] `import standingsRouter from './routes/standings.js'`
  - [x] `app.route('/api', standingsRouter)` alongside other public routes

- [x] Task 3: Replace `apps/web/src/routes/standings.tsx` placeholder with full standings component (AC: #9–18)
  - [x] `useQuery` with `queryKey: ['standings']`, `queryFn`
  - [x] Loading skeleton (3 animated rows)
  - [x] Error state with retry button
  - [x] No-season state
  - [x] Season header
  - [x] Full members table with playoff eligibility indicator
  - [x] Subs section (conditional)
  - [x] Refresh button + `isFetching` spinner
  - [x] `formatHarvey()` helper

- [x] Task 4: Write API tests in `apps/api/src/routes/standings.test.ts` (AC: #1–8)
  - [x] No season → 200, `season: null`, empty arrays
  - [x] Season with no official rounds → empty standings
  - [x] Players with harvey_results → correct aggregation and totals
  - [x] Best-10 applied when player has > 10 rounds
  - [x] Sub classification: player with any is_sub=0 round → full member
  - [x] Sub classification: player with all is_sub=1 → sub section
  - [x] Playoff eligibility: top-8 full members flagged, rank 9+ not flagged
  - [x] Dense ranking: ties get same rank, gap skips (1, 1, 3)
  - [x] Casual rounds excluded from standings

- [x] Task 5: Typecheck + lint (AC: all)
  - [x] `pnpm --filter @wolf-cup/api typecheck`
  - [x] `pnpm --filter @wolf-cup/web typecheck`
  - [x] `pnpm lint`

## Dev Notes

### No `season_standings` Table

The architecture.md mentioned a `season_standings` table in the transaction flow, but it was **never implemented** in the DB schema (schema.ts has no such table, and no migration exists for it). This story computes standings **on-the-fly** from `harvey_results` on every `GET /standings` request.

This is consistent with the architecture's "Reads query stored results — no engine call on read" principle — we still read stored results (`harvey_results`) — we just aggregate them in JS using `calculateSeasonTotal` rather than a pre-computed table. The standings route is not in the hot path (unlike the 5s leaderboard polling), so on-the-fly aggregation is fine.

### API Response Contract

```typescript
// GET /api/standings
type StandingsPlayer = {
  playerId: number;
  name: string;
  roundsPlayed: number;
  roundsDropped: number;
  stablefordTotal: number;    // best-10 stableford Harvey (may be .5)
  moneyTotal: number;         // best-10 money Harvey (may be .5)
  combinedTotal: number;      // stablefordTotal + moneyTotal (for ranking)
  rank: number;               // 1-based dense, within section
  isPlayoffEligible: boolean; // top-8 full members only
};

type StandingsResponse = {
  season: {
    id: number;
    name: string;
    totalRounds: number;     // seasons.total_rounds
    roundsCompleted: number; // count of official finalized rounds for season
  } | null;
  fullMembers: StandingsPlayer[];
  subs: StandingsPlayer[];
  lastUpdated: string;
};
```

### API Implementation Strategy

**Step 1: Find current season (most recent by startDate)**
```typescript
const season = await db
  .select({ id: seasons.id, name: seasons.name, totalRounds: seasons.totalRounds, startDate: seasons.startDate })
  .from(seasons)
  .orderBy(desc(seasons.startDate))
  .get();

if (!season) {
  return c.json({ season: null, fullMembers: [], subs: [], lastUpdated: new Date().toISOString() }, 200);
}
```

**Step 2: Official non-cancelled rounds for this season**
```typescript
const officialRounds = await db
  .select({ id: rounds.id, status: rounds.status })
  .from(rounds)
  .where(and(
    eq(rounds.seasonId, season.id),
    eq(rounds.type, 'official'),
    not(eq(rounds.status, 'cancelled')),
  ));

const officialRoundIds = officialRounds.map(r => r.id);
const roundsCompleted = officialRounds.filter(r => r.status === 'finalized').length;
```

**Step 3: All harvey_results for those rounds**
```typescript
// Guard: if no official rounds, return empty
if (officialRoundIds.length === 0) {
  return c.json({
    season: { id: season.id, name: season.name, totalRounds: season.totalRounds, roundsCompleted },
    fullMembers: [], subs: [], lastUpdated: new Date().toISOString(),
  }, 200);
}

const harveyRows = await db
  .select({
    playerId: harveyResults.playerId,
    roundId: harveyResults.roundId,
    stablefordPoints: harveyResults.stablefordPoints,
    moneyPoints: harveyResults.moneyPoints,
  })
  .from(harveyResults)
  .where(inArray(harveyResults.roundId, officialRoundIds));
```

**Step 4: round_players for sub classification (across ALL season rounds for those players)**
```typescript
const playerIds = [...new Set(harveyRows.map(r => r.playerId))];

// Fetch sub status for each player across all official rounds this season
// (including rounds the player didn't score — to catch sub-to-member conversions)
const roundPlayerRows = playerIds.length > 0
  ? await db
      .select({ playerId: roundPlayers.playerId, isSub: roundPlayers.isSub })
      .from(roundPlayers)
      .where(and(
        inArray(roundPlayers.playerId, playerIds),
        inArray(roundPlayers.roundId, officialRoundIds),
      ))
  : [];
```

**Step 5: Player names**
```typescript
const playerRows = playerIds.length > 0
  ? await db
      .select({ id: players.id, name: players.name })
      .from(players)
      .where(inArray(players.id, playerIds))
  : [];
const nameMap = new Map(playerRows.map(p => [p.id, p.name]));
```

**Step 6: Build per-player harvey results map**
```typescript
// Group harvey results by player
const harveyByPlayer = new Map<number, Array<{ stablefordPoints: number; moneyPoints: number }>>();
for (const row of harveyRows) {
  if (!harveyByPlayer.has(row.playerId)) harveyByPlayer.set(row.playerId, []);
  harveyByPlayer.get(row.playerId)!.push({ stablefordPoints: row.stablefordPoints, moneyPoints: row.moneyPoints });
}

// Determine sub classification: full member if ANY round_players row has is_sub=0
const subStatusByPlayer = new Map<number, boolean>(); // true = is sub
for (const pid of playerIds) {
  const entries = roundPlayerRows.filter(r => r.playerId === pid);
  const hasFullMemberRound = entries.some(r => !r.isSub);
  subStatusByPlayer.set(pid, !hasFullMemberRound); // sub = no full-member round found
}
```

**Step 7: Calculate season totals per player**
```typescript
import { calculateSeasonTotal } from '@wolf-cup/engine';

const playerStandings = playerIds.map(pid => {
  const rounds = harveyByPlayer.get(pid) ?? [];
  const totals = calculateSeasonTotal(rounds, []);
  return {
    playerId: pid,
    name: nameMap.get(pid) ?? 'Unknown',
    roundsPlayed: totals.roundsPlayed,
    roundsDropped: totals.roundsDropped,
    stablefordTotal: totals.stableford,
    moneyTotal: totals.money,
    combinedTotal: totals.stableford + totals.money,
    isSub: subStatusByPlayer.get(pid) ?? true,
  };
});
```

**Step 8: Assign dense ranks and playoff eligibility**
Reuse the same `assignRanks` pattern from leaderboard.ts (copy it into standings.ts — don't import cross-route):

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

const fullMemberRows = playerStandings.filter(p => !p.isSub);
const subRows = playerStandings.filter(p => p.isSub);

const fullMemberRanks = assignRanks(fullMemberRows.map(p => ({ playerId: p.playerId, total: p.combinedTotal })));
const subRanks = assignRanks(subRows.map(p => ({ playerId: p.playerId, total: p.combinedTotal })));

const sortByRankName = (a: StandingsPlayer, b: StandingsPlayer) =>
  a.rank - b.rank || a.name.localeCompare(b.name);

const fullMembers: StandingsPlayer[] = fullMemberRows
  .map(p => ({
    ...p,
    rank: fullMemberRanks.get(p.playerId) ?? fullMemberRows.length,
    isPlayoffEligible: (fullMemberRanks.get(p.playerId) ?? 999) <= 8,
  }))
  .sort(sortByRankName);

const subs: StandingsPlayer[] = subRows
  .map(p => ({
    ...p,
    rank: subRanks.get(p.playerId) ?? subRows.length,
    isPlayoffEligible: false,
  }))
  .sort(sortByRankName);
```

### DB Imports for standings.ts

```typescript
import { rounds, roundPlayers, players, harveyResults, seasons } from '../db/schema.js';
import { eq, and, inArray, not, desc } from 'drizzle-orm';
import { calculateSeasonTotal } from '@wolf-cup/engine';
```

Note: `not` from drizzle-orm is needed for `not(eq(rounds.status, 'cancelled'))`.

### Frontend Component Structure

**File:** `apps/web/src/routes/standings.tsx` — replace placeholder.

```typescript
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
```

**`formatHarvey` helper:**
```typescript
function formatHarvey(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}
```

**Query setup (no polling — standings change infrequently):**
```typescript
const { data, isLoading, isError, isFetching, refetch } = useQuery({
  queryKey: ['standings'],
  queryFn: () => apiFetch<StandingsResponse>('/standings'),
});
```

**Playoff eligibility row styling:**
```tsx
<tr
  key={player.playerId}
  className={`border-b last:border-0 ${player.isPlayoffEligible ? 'bg-green-50 dark:bg-green-950/20' : ''}`}
>
```

**Rank display with playoff badge:**
```tsx
<td className="py-2 px-3 font-medium text-muted-foreground">
  {player.rank}
  {player.isPlayoffEligible && <span className="ml-1 text-green-600 text-xs">✓</span>}
</td>
```

**Player sub-line (rounds played + dropped):**
```tsx
<div className="text-xs text-muted-foreground">
  Rnd {player.roundsPlayed}{player.roundsDropped > 0 ? ` (−${player.roundsDropped})` : ''}
</div>
```

**Table columns:** Rank, Player (name + rounds sub-line), Stab, Money, Total — 5 columns.

### Test File Patterns

Follow the same pattern as `leaderboard.test.ts`:
- `vi.mock('../db/index.js', ...)` using in-memory SQLite
- `beforeAll`: run migrations, seed seasons/rounds/groups/players
- `afterEach`: clean harvey_results, round_results, round_players for the round (preserve season fixture)
- Import `standingsApp` from `./standings.js`
- Use `standingsApp.request('/standings')` for HTTP tests

**Key seeding pattern for standings tests:**
```typescript
// Seed harvey_results directly — standings reads pre-computed results
await db.insert(harveyResults).values({
  roundId, playerId, stablefordRank: 1, moneyRank: 1,
  stablefordPoints: 4, moneyPoints: 4, updatedAt: Date.now(),
});
```

**Test for >10 rounds (best-10 drop):**
Seed 11 harvey_results for one player across 11 different rounds.
Lowest combined round = 1+1 = 2. Expect `roundsDropped = 1` and `stablefordTotal` not to include the dropped round.

**Test for sub classification:**
Seed a player with `is_sub: 1` for all their round_players entries → expect in `subs` array.
Seed another player with one `is_sub: 0` entry → expect in `fullMembers`.

### Architecture Compliance

- Public endpoint (no auth): matches architecture's three-tier auth — `GET /api/standings` is public [Source: architecture.md — API & Endpoints]
- `calculateSeasonTotal` from `@wolf-cup/engine` — pure function, safe to call on read path since it's just array sorting/summing, not full hole-by-hole recalculation [Source: architecture.md — Recalculation Strategy]
- Only official non-cancelled rounds counted: "Official vs. casual distinction enforced in DB schema (`rounds.type`)" [Source: architecture.md — Cross-Cutting Concerns]
- Sub player classification via `round_players.is_sub`: "A player can be a sub in one round and a full member in another" [Source: architecture.md — Gap 2: Sub player data model]
- Dense ranking: same `assignRanks` pattern as leaderboard (copy, don't import cross-route)
- `lastUpdated` set just before response is returned (lesson from Story 3.8 code review)

### Project Structure Notes

- **New file:** `apps/api/src/routes/standings.ts` — `GET /standings` — no auth middleware
- **New file:** `apps/api/src/routes/standings.test.ts` — API tests
- **Modified:** `apps/api/src/index.ts` — mount standings router
- **Modified:** `apps/web/src/routes/standings.tsx` — replace "Coming soon" placeholder with full component
- No schema changes needed — reads from existing `harvey_results`, `round_players`, `players`, `rounds`, `seasons`
- No migrations needed

### References

- FR42: "Any user can view year-to-date season standings including Harvey Cup point totals (Stableford + money), rounds played, and current drop score" [Source: epics.md]
- FR43: "The standings display sub player results in a section separate from full league member standings" [Source: epics.md]
- FR44: "The system identifies and displays playoff-eligible players based on the top-8 season standing cutoff after regular season rounds are complete" [Source: epics.md]
- NFR5: "Harvey Cup points are assigned to league-wide ranks (not per-group ranks) across all groups in the round" [Source: epics.md]
- `calculateSeasonTotal` signature: `(regularRounds: readonly HarveyRoundResult[], playoffRounds?: readonly HarveyRoundResult[]) => HarveySeasonTotal` [Source: packages/engine/src/harvey.ts:123]
- `HarveySeasonTotal`: `{ stableford, money, roundsPlayed, roundsDropped }` [Source: packages/engine/src/types.ts:119]
- `HarveyRoundResult`: `{ stablefordPoints, moneyPoints }` [Source: packages/engine/src/types.ts:139]
- Best-10 selects top rounds by **combined** (stab+money) score, both categories from the same 10 rounds [Source: packages/engine/src/harvey.ts:131–134]
- Sub classification: `round_players.is_sub` boolean per round [Source: architecture.md — Gap 2]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

_None_

### Completion Notes List

**Code Review Fixes Applied:**
- H1: Season name now rendered in standings header — `data.season.name` shown as `"{name} Standings"` in `<h2>` when season is loaded.
- M1: Hollow "no-season" test replaced with real assertions — verifies response shape, `season.name`, `season.totalRounds`, and empty standings arrays.
- M2: Sub-line always shows `(−{roundsDropped})` regardless of value (spec compliance).
- M3: Best-10 drop test now asserts `stablefordTotal: 68` and `moneyTotal: 68` in addition to `roundsDropped: 1`.

- Implemented on-the-fly standings aggregation from `harvey_results` using `calculateSeasonTotal` from engine.
- `vi.mock` DB URL: used `file::memory:?cache=shared` (not `?cache=shared&mode=...` which libsql rejects).
- `onConflictDoNothing()` used in playoff eligibility test to safely insert across multiple rounds per player.
- `groups` table imported for sub player test cleanup.
- 13 tests covering all ACs: aggregation, best-10 drop, sub classification, playoff eligibility, dense ranking, casual/cancelled round exclusion, sort order, lastUpdated.

### File List

- `apps/api/src/routes/standings.ts` — new
- `apps/api/src/routes/standings.test.ts` — new
- `apps/api/src/index.ts` — modified (added standings router)
- `apps/web/src/routes/standings.tsx` — modified (replaced placeholder)
