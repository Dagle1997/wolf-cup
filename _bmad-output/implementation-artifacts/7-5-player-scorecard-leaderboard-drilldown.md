# Story 7.5: Player Scorecard Leaderboard Drilldown

Status: done

## Story

As a viewer of the live leaderboard,
I want to tap any player row to see a hole-by-hole scorecard with golf notation, net scores, and money per hole,
so that I can follow individual performance in detail during a round.

## Acceptance Criteria

1. On the live leaderboard (`/`), each player row is tappable/clickable. Tapping a row that is not selected expands an inline scorecard panel directly below that row. Tapping the already-selected row collapses it. Tapping a different row collapses the previous panel and expands the new one.

2. The scorecard panel shows a row per hole played (holes where `grossScore` exists for the player), with columns: **Hole**, **Par**, **Gross**, **Net**, **Money**. Holes not yet played are omitted.

3. Gross score is rendered with golf notation using CSS shapes:
   - Eagle or better (net ≤ par − 2): gross score inside a **double circle** (two concentric rings)
   - Birdie (net = par − 1): gross score inside a **single circle**
   - Par (net = par): plain text
   - Bogey (net = par + 1): gross score inside a **single square**
   - Double bogey or worse (net ≥ par + 2): gross score inside a **double square**

4. Net score column shows the calculated net score (gross − handicap strokes for that hole).

5. Money column shows the per-hole money result formatted as `+$N`, `-$N`, or `$0`. Money column is hidden (or all `$0`) when `autoCalculateMoney` is false for the round.

6. A loading spinner is shown inside the panel while scorecard data is fetching. If the fetch fails, an inline "Could not load scorecard" message is shown with no retry button (the panel auto-retries on next 5s poll).

7. A new public API endpoint `GET /rounds/:roundId/players/:playerId/scorecard` is added to `apps/api/src/routes/rounds.ts`. It returns:
   ```json
   {
     "playerId": 3,
     "playerName": "Smith",
     "groupId": 7,
     "autoCalculateMoney": true,
     "holes": [
       {
         "holeNumber": 1,
         "par": 5,
         "grossScore": 6,
         "netScore": 5,
         "stablefordPoints": 1,
         "moneyNet": -1
       }
     ]
   }
   ```
   Returns 404 if the round or player is not found in the round. Returns empty `holes: []` if no hole scores exist yet.

8. The scorecard query uses `queryKey: ['scorecard', roundId, playerId]` and does NOT use `refetchInterval` — it inherits fresh data from the leaderboard's 5s polling cycle only when the user opens/reopens the panel. (The scorecard panel data is considered "good enough" between leaderboard refreshes.)

9. `pnpm --filter @wolf-cup/web typecheck` passes with zero errors.

## Tasks / Subtasks

- [x] Task 1: Add scorecard API endpoint (AC: #7)
  - [x] Add `GET /rounds/:roundId/players/:playerId/scorecard` in `apps/api/src/routes/rounds.ts`
  - [x] Look up player's group via `roundPlayers` table; fetch `battingOrder` from `groups`
  - [x] Fetch player's `handicapIndex` from `roundPlayers`; fetch `holeScores` for the player in that group
  - [x] For each hole with a gross score: call `getHandicapStrokes`, compute net score, call `calculateStablefordPoints`
  - [x] For money: inline per-hole money loop (mirrors `recalculateMoney` but captures per-hole `result[pos].total`)
  - [x] Include `autoCalculateMoney` from the round row in the response
  - [x] Return 404 if round doesn't exist or player not in round

- [x] Task 2: Update leaderboard UI — clickable rows + scorecard panel (AC: #1, #2, #3, #4, #5, #6, #8)
  - [x] Add `selectedPlayerId: number | null` state (default `null`) to `LeaderboardPage`
  - [x] Wrap each player `<tr>` with `onClick` that toggles `selectedPlayerId` (set if different, clear if same)
  - [x] Add `cursor-pointer hover:bg-muted/30` styles to player rows
  - [x] After the selected player row, insert a scorecard expansion `<tr>` spanning all columns (via `colSpan`)
  - [x] `ScorecardPanel` inline component renders below selected player row
  - [x] `ScorecardPanel` uses `useQuery(['scorecard', roundId, playerId], ...)` with no refetchInterval
  - [x] Loading: spinner centered in panel; Error: "Could not load scorecard" text; Empty holes: "No scores yet"
  - [x] Golf notation: `renderGolfNotation()` with Tailwind border + rounded classes for circles/squares
  - [x] Hide Money column when `autoCalculateMoney` is false

- [x] Task 3: Verify quality gate (AC: #9)
  - [x] `pnpm --filter @wolf-cup/web typecheck` — zero errors

## Dev Notes

### Files to Create / Edit

```
apps/api/src/routes/rounds.ts   ← EDIT (add scorecard endpoint)
apps/web/src/routes/index.tsx   ← EDIT (clickable rows + scorecard panel)
```

No new files. No route tree regeneration needed (no new routes).

### API Endpoint Detail

Add to `apps/api/src/routes/rounds.ts` before the final export:

```typescript
// GET /rounds/:roundId/players/:playerId/scorecard — public
app.get('/rounds/:roundId/players/:playerId/scorecard', async (c) => {
  const roundId = Number(c.req.param('roundId'));
  const playerId = Number(c.req.param('playerId'));
  if (!Number.isInteger(roundId) || roundId <= 0 || !Number.isInteger(playerId) || playerId <= 0) {
    return c.json({ error: 'Invalid ID' }, 400);
  }

  // Look up round
  const round = await db.select({ autoCalculateMoney: rounds.autoCalculateMoney })
    .from(rounds).where(eq(rounds.id, roundId)).get();
  if (!round) return c.json({ error: 'Round not found' }, 404);

  // Look up player in round
  const rp = await db.select({ groupId: roundPlayers.groupId, handicapIndex: roundPlayers.handicapIndex })
    .from(roundPlayers)
    .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.playerId, playerId)))
    .get();
  if (!rp) return c.json({ error: 'Player not in round' }, 404);

  const { groupId, handicapIndex } = rp;

  // Get batting order
  const group = await db.select({ battingOrder: groups.battingOrder })
    .from(groups).where(eq(groups.id, groupId)).get();
  const battingOrder: number[] = group?.battingOrder ? JSON.parse(group.battingOrder) : [];
  const playerPos = battingOrder.indexOf(playerId); // 0-3

  // Get all hole scores for the group (needed for money calc)
  const [allScores, allDecisions, allHandicaps, playerRow] = await Promise.all([
    db.select({ playerId: holeScores.playerId, holeNumber: holeScores.holeNumber, grossScore: holeScores.grossScore })
      .from(holeScores).where(and(eq(holeScores.roundId, roundId), eq(holeScores.groupId, groupId))),
    db.select({ holeNumber: wolfDecisions.holeNumber, decision: wolfDecisions.decision,
      partnerPlayerId: wolfDecisions.partnerPlayerId, bonusesJson: wolfDecisions.bonusesJson })
      .from(wolfDecisions).where(and(eq(wolfDecisions.roundId, roundId), eq(wolfDecisions.groupId, groupId))),
    db.select({ playerId: roundPlayers.playerId, handicapIndex: roundPlayers.handicapIndex })
      .from(roundPlayers).where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.groupId, groupId))),
    db.select({ name: players.name }).from(players).where(eq(players.id, playerId)).get(),
  ]);

  const handicapMap = new Map(allHandicaps.map(r => [r.playerId, r.handicapIndex]));
  const scoresByHole = new Map<number, Map<number, number>>();
  for (const row of allScores) {
    if (!scoresByHole.has(row.holeNumber)) scoresByHole.set(row.holeNumber, new Map());
    scoresByHole.get(row.holeNumber)!.set(row.playerId, row.grossScore);
  }
  const decisionByHole = new Map(allDecisions.map(r => [r.holeNumber, r]));

  const holes = [];
  for (let holeNum = 1; holeNum <= 18; holeNum++) {
    const holeMap = scoresByHole.get(holeNum);
    const grossScore = holeMap?.get(playerId);
    if (grossScore === undefined) continue; // not played yet

    const courseHole = getCourseHole(holeNum as HoleNumber);
    const strokes = getHandicapStrokes(handicapIndex, courseHole.strokeIndex);
    const netScore = grossScore - strokes;
    const stablefordPoints = calculateStablefordPoints(netScore, courseHole.par);

    // Per-hole money (only if group has all 4 players)
    let moneyNet = 0;
    if (Boolean(round.autoCalculateMoney) && battingOrder.length === 4 && playerPos >= 0 && holeMap && holeMap.size >= 4) {
      const grossScores = battingOrder.map(pid => holeMap.get(pid) ?? 0) as [number, number, number, number];
      const netScores = battingOrder.map((pid, i) => {
        const s = getHandicapStrokes(handicapMap.get(pid) ?? 0, courseHole.strokeIndex);
        return grossScores[i]! - s;
      }) as [number, number, number, number];
      const holeAssignment = buildHoleAssignment(holeNum);
      const decisionRecord = decisionByHole.get(holeNum);
      let wolfDecision: WolfDecision | null = null;
      if (holeNum > 2) {
        if (!decisionRecord?.decision) { holes.push({ holeNumber: holeNum, par: courseHole.par, grossScore, netScore, stablefordPoints, moneyNet: 0 }); continue; }
        wolfDecision = buildWolfDecision(decisionRecord.decision, decisionRecord.partnerPlayerId, battingOrder);
      }
      const bonusInput = buildBonusInput(decisionRecord?.bonusesJson ?? null, battingOrder);
      const base = calculateHoleMoney(netScores, holeAssignment, wolfDecision, courseHole.par);
      const result = bonusInput.greenies.length > 0 || bonusInput.polies.length > 0
        ? applyBonusModifiers(base, netScores, grossScores, bonusInput, holeAssignment, wolfDecision, courseHole.par)
        : base;
      moneyNet = result[playerPos]!.total;
    }

    holes.push({ holeNumber: holeNum, par: courseHole.par, grossScore, netScore, stablefordPoints, moneyNet });
  }

  return c.json({
    playerId,
    playerName: playerRow?.name ?? 'Unknown',
    groupId,
    autoCalculateMoney: Boolean(round.autoCalculateMoney),
    holes,
  });
});
```

### Golf Notation CSS Pattern

Use Tailwind utility classes for circles and squares. Wrap the gross score number in a `<span>` container:

```tsx
// Birdie: single circle
<span className="inline-flex items-center justify-center w-7 h-7 rounded-full border-2 border-foreground text-xs font-bold">
  {grossScore}
</span>

// Eagle: double circle (outer border + inner border via box-shadow or nested spans)
// Use two nested spans:
<span className="inline-flex items-center justify-center w-8 h-8 rounded-full border-2 border-foreground">
  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full border-2 border-foreground text-xs font-bold">
    {grossScore}
  </span>
</span>

// Bogey: single square
<span className="inline-flex items-center justify-center w-7 h-7 border-2 border-foreground text-xs font-bold">
  {grossScore}
</span>

// Double bogey: double square (nested)
<span className="inline-flex items-center justify-center w-8 h-8 border-2 border-foreground">
  <span className="inline-flex items-center justify-center w-5 h-5 border-2 border-foreground text-xs font-bold">
    {grossScore}
  </span>
</span>

// Par: plain
<span className="text-xs font-medium">{grossScore}</span>
```

Classification is based on **net score vs par** (not gross):
- `netScore <= par - 2` → eagle or better (double circle)
- `netScore === par - 1` → birdie (single circle)
- `netScore === par` → par (plain)
- `netScore === par + 1` → bogey (single square)
- `netScore >= par + 2` → double bogey or worse (double square)

### ScorecardPanel Component (inline in index.tsx)

```tsx
type ScorecardHole = {
  holeNumber: number;
  par: number;
  grossScore: number;
  netScore: number;
  stablefordPoints: number;
  moneyNet: number;
};

type ScorecardResponse = {
  playerId: number;
  playerName: string;
  groupId: number;
  autoCalculateMoney: boolean;
  holes: ScorecardHole[];
};

function ScorecardPanel({ roundId, playerId, autoCalculateMoney }: {
  roundId: number;
  playerId: number;
  autoCalculateMoney: boolean;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['scorecard', roundId, playerId],
    queryFn: () => apiFetch<ScorecardResponse>(`/rounds/${roundId}/players/${playerId}/scorecard`),
  });

  if (isLoading) return <div className="p-4 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>;
  if (isError) return <div className="p-4 text-center text-muted-foreground text-xs">Could not load scorecard</div>;
  if (!data || data.holes.length === 0) return <div className="p-4 text-center text-muted-foreground text-xs">No scores yet</div>;

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-muted-foreground">
          <th className="py-1 pl-3 text-left">Hole</th>
          <th className="py-1 text-center">Par</th>
          <th className="py-1 text-center">Gross</th>
          <th className="py-1 text-center">Net</th>
          <th className="py-1 text-center">Stab</th>
          {autoCalculateMoney && <th className="py-1 pr-3 text-right">$</th>}
        </tr>
      </thead>
      <tbody>
        {data.holes.map((hole) => (
          <tr key={hole.holeNumber} className="border-t border-muted">
            <td className="py-1 pl-3">{hole.holeNumber}</td>
            <td className="py-1 text-center">{hole.par}</td>
            <td className="py-1 text-center">{renderGolfNotation(hole.grossScore, hole.netScore, hole.par)}</td>
            <td className="py-1 text-center">{hole.netScore}</td>
            <td className="py-1 text-center">{hole.stablefordPoints}</td>
            {autoCalculateMoney && (
              <td className="py-1 pr-3 text-right">
                {hole.moneyNet > 0 ? `+$${hole.moneyNet}` : hole.moneyNet < 0 ? `-$${Math.abs(hole.moneyNet)}` : '$0'}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

Add `Loader2` to the lucide-react import in `index.tsx`.

### Table Row Expansion Pattern

The scorecard panel renders as an additional `<tr>` immediately after the selected player row. This keeps it inside the `<table>` DOM structure.

```tsx
{data.leaderboard.map((player) => (
  <Fragment key={player.playerId}>
    <tr
      onClick={() => setSelectedPlayerId(prev => prev === player.playerId ? null : player.playerId)}
      className={`border-b last:border-0 cursor-pointer hover:bg-muted/30 transition-colors ${selectedPlayerId === player.playerId ? 'bg-muted/20' : ''}`}
    >
      {/* ... existing cells ... */}
    </tr>
    {selectedPlayerId === player.playerId && (
      <tr className="border-b bg-muted/10">
        <td colSpan={data.harveyLiveEnabled ? 6 : 4} className="p-0">
          <ScorecardPanel
            roundId={data.round.id}
            playerId={player.playerId}
            autoCalculateMoney={data.round.autoCalculateMoney}
          />
        </td>
      </tr>
    )}
  </Fragment>
))}
```

Import `Fragment` from React: `import { useState, useEffect, Fragment } from 'react';`

### Gotchas

- The `recalculateMoney` helper accumulates totals only — do NOT call it for per-hole money. The scorecard endpoint must inline its own per-hole money loop (same logic but storing per-hole result instead of accumulating).
- Wolf holes 1–2 are skins-only; `wolfDecision` is `null` for those holes. Pass `null` to `calculateHoleMoney` — engine handles it.
- If `battingOrder` has fewer than 4 players (e.g. casual round with 3), skip money entirely for that group (`moneyNet: 0` for all holes).
- `buildHoleAssignment`, `buildWolfDecision`, `buildBonusInput` are private helpers already in `rounds.ts` — no need to extract them; the new endpoint goes in the same file.
- `Fragment` must be imported from React (not `React.Fragment`) to use as JSX tag.
- The colSpan must match the actual column count: 4 without Harvey, 6 with Harvey (2 extra columns). Pass `colSpan={data.harveyLiveEnabled ? 6 : 4}`.
- `apiFetch` is already imported in `index.tsx`.

## Dev Agent Record

### Implementation Notes

- `calculateStablefordPoints(gross, handicapIndex, par, strokeIndex)` — takes raw gross score + handicap index, NOT a pre-computed net score. Fixed from story's initial pseudocode which passed `(netScore, par)`.
- Non-null assertion `data.round!.id` needed for `ScorecardPanel` props inside JSX nested conditional — TypeScript can't narrow through JSX even though outer `{data && data.round !== null && (...)}` guard is in place.
- Per-hole money logic is inlined in the scorecard endpoint (not delegated to `recalculateMoney`); uses the same `buildHoleAssignment`, `buildWolfDecision`, `buildBonusInput` helpers already private in `rounds.ts`.
- Wolf holes 1–2 (skins only): `wolfDecision = null` is correctly passed to `calculateHoleMoney`.
- `Fragment` imported from React naively — works correctly with the table row expansion pattern.

### Completion Notes

All ACs satisfied. API endpoint returns 400/404 correctly. UI toggling, golf notation (circles/squares), spinner/error/empty states all implemented. Both API and web typechecks pass clean.

## File List

- `apps/api/src/routes/rounds.ts` — added `GET /rounds/:roundId/players/:playerId/scorecard` endpoint
- `apps/web/src/routes/index.tsx` — added `Fragment`, `Loader2` imports; `ScorecardHole`/`ScorecardResponse` types; `formatHoleMoney`, `renderGolfNotation`, `ScorecardPanel` helpers; `selectedPlayerId` state; clickable player rows with scorecard expansion

## Senior Developer Review (AI)

**Date:** 2026-03-01
**Outcome:** Changes Requested → Fixed

### Action Items (all resolved)

- [x] [MEDIUM] M1: `formatMoney` and `formatHoleMoney` were byte-for-byte identical — removed `formatHoleMoney`, replaced all usages with `formatMoney`
- [x] [LOW] L1: `selectedPlayerId` not cleared on round change — added `useEffect(() => setSelectedPlayerId(null), [data?.round?.id])`
- [x] [LOW] L2: Repeated `data.round!` non-null assertions — extracted `const currentRound = data?.round ?? null`, updated JSX to use `currentRound`
- [x] [LOW] L3: Target player's `getHandicapStrokes` computed twice per hole — reused `strokes` via `pid === playerId` check in netScores map
- [x] [LOW] L4: `autoCalculateMoney` prop could diverge from API response — scorecard table now reads `data.autoCalculateMoney` directly
- [x] [LOW] L5: No `aria-expanded` on clickable rows — added `role="button"` and `aria-expanded={selectedPlayerId === player.playerId}`

## Change Log

- 2026-03-01: Implemented Story 7-5 — player scorecard drilldown on live leaderboard
- 2026-03-01: Code review fixes — M1 duplicate function, L1–L5 low-severity improvements
