# Story 3.5: Wolf Decisions & Bonus Inputs

Status: done

## Story

As a scorer,
I want to record the wolf partner decision and any bonus events (greenies, polies) per hole,
so that money totals are automatically calculated and displayed for each player after every hole.

## Acceptance Criteria

### Database Migration

1. **Schema migration**: Update `wolf_decisions` table to add:
   - `bonuses_json TEXT` column (stores `{ "greenies": [playerId,...], "polies": [playerId,...] }`) — nullable, defaults to null
   - Unique index `uniq_wolf_decisions` on `(round_id, group_id, hole_number)` — enables idempotent upsert

### Public API — Save Wolf Decision & Bonuses

2. `POST /api/rounds/:roundId/groups/:groupId/holes/:holeNumber/wolf-decision` accepts:
   ```json
   {
     "decision": "alone" | "partner" | "blind_wolf",   // required for wolf holes 3–18
     "partnerPlayerId": 7,                               // required when decision === "partner"
     "greenies": [7, 12],                                // optional; playerIds; par-3 holes only
     "polies": [7]                                       // optional; playerIds; any hole
   }
   ```
   - For **official** rounds: requires `x-entry-code` header (bcrypt); returns 403 `INVALID_ENTRY_CODE` if missing/wrong.
   - For **casual** rounds: no entry code required.
   - Returns 422 `ROUND_NOT_ACTIVE` if round is finalized or cancelled.
   - Returns 404 `NOT_FOUND` if round or group not found, or group does not belong to round.

3. Validation rules → 422 `INVALID_DECISION` if violated:
   - `holeNumber` 1–2 (skins holes): `decision` field must **not** be present (only `greenies`/`polies` accepted).
   - `holeNumber` 3–18 (wolf holes): `decision` is **required**.
   - `decision === "partner"`: `partnerPlayerId` is required and must be a different member of the group (not the wolf player).
   - `greenies`: all playerIds must be members of the group; hole must be par-3 (holes 4, 7, 11, 16 — pars from HOLE_PARS constant).
   - `polies`: all playerIds must be members of the group.

4. On success: upserts `wolf_decisions` row (idempotent — re-submitting overwrites).

5. **Money recalculation** triggered after every POST:
   - Fetch all `hole_scores` for the group → group by hole.
   - Fetch all `wolf_decisions` for the group → keyed by holeNumber.
   - Fetch `battingOrder` from `groups` table.
   - Fetch `handicapIndex` for each player from `roundPlayers`.
   - For each hole 1–18 where all 4 players have gross scores:
     - Compute `netScores[4]` via `getCourseHole` + handicap strokes.
     - Skins holes (1–2): `calculateHoleMoney(netScores, {type:'skins'}, {type:'alone'}, par)`, then apply bonuses if present.
     - Wolf holes (3–18) **with** wolf decision: build `WolfDecision` + `HoleAssignment`, call `calculateHoleMoney`, then `applyBonusModifiers` if bonuses present.
     - Wolf holes **without** wolf decision yet: skip (money for that hole stays uncalculated).
   - Sum `result[battingPos].total` per player → upsert `round_results.moneyTotal` for each.
   - Returns 200:
     ```json
     {
       "wolfDecision": { "holeNumber": 5, "decision": "alone", "partnerPlayerId": null, "greenies": [], "polies": [7] },
       "moneyTotals": [{ "playerId": 7, "moneyTotal": 3 }, ...]
     }
     ```

### Public API — Fetch Wolf Decisions

6. `GET /api/rounds/:roundId/groups/:groupId/wolf-decisions` returns all recorded wolf decisions for the group:
   - Returns 200: `{ wolfDecisions: [{ holeNumber, decision, partnerPlayerId, greenies, polies }] }` sorted by holeNumber asc.
   - Returns empty array `[]` if none recorded.
   - Entry code **not required** (read-only).
   - Returns 404 if round or group not found.

### Web — Extended Score Entry Page

7. `score-entry-hole.tsx` on load: fetches **both** `GET /scores` and `GET /wolf-decisions` in parallel to restore all state.

8. **Wolf decision section** (shown only when `round.autoCalculateMoney === true` AND hole is a wolf hole 3–18):
   - Radio/button group: "Alone" | "Partner" | "Blind Wolf"
   - When "Partner" selected: show player dropdown (players in group excluding the wolf player for this hole).
   - Pre-populated from restored wolf decisions on page load.

9. **Greenie section** (shown only on par-3 holes — holes 4, 7, 11, 16):
   - Checkbox per player: "{name} greenie?"
   - Pre-populated from restored bonuses on page load.

10. **Polie section** (shown on every hole):
    - Checkbox per player: "{name} polie?"
    - Pre-populated from restored bonuses on page load.

11. **"Save Hole" button** (existing from Story 3.4) now also fires the wolf-decision POST when autoCalculateMoney is true AND (decision is selected OR greenies/polies are checked). Both score POST and wolf-decision POST run on button click; score POST runs first, wolf-decision POST runs second (only if data to save). Advances to next hole after both succeed.

12. **Summary page** (hole 19): money column now shows actual `moneyTotal` values from `moneyTotals` state (positive = "+$N", negative = "-$N", zero = "$0", undefined = "—").

13. On wolf-decision API error `INVALID_DECISION`: inline error "Invalid wolf decision — please check your inputs." On `INVALID_ENTRY_CODE`: "Entry code no longer valid — please re-join the round." On network error: "Could not save wolf decision — please try again."

### Quality

14. `pnpm --filter @wolf-cup/api test` passes with new tests covering:
    - POST wolf-decision: official round + valid code + "alone" → 200, moneyTotals returned
    - POST wolf-decision: casual round → 200 (no code)
    - POST wolf-decision: "partner" with partnerPlayerId → 200
    - POST wolf-decision: idempotent re-submit overwrites
    - POST wolf-decision: wrong entry code → 403
    - POST wolf-decision: decision on skins hole (1-2) → 422 INVALID_DECISION
    - POST wolf-decision: "partner" without partnerPlayerId → 422 INVALID_DECISION
    - POST wolf-decision: greenie on non-par-3 hole → 422 INVALID_DECISION
    - POST wolf-decision: invalid playerId in polies → 422 INVALID_DECISION
    - POST wolf-decision: finalized round → 422 ROUND_NOT_ACTIVE
    - GET wolf-decisions: returns recorded decisions sorted by holeNumber
    - GET wolf-decisions: returns empty array when none recorded
15. `pnpm --filter @wolf-cup/web typecheck` passes.
16. `pnpm --filter @wolf-cup/web lint` passes.

## Tasks / Subtasks

- [x] Task 1: DB migration + API endpoints (AC: #1–6, #14)
  - [x] Update `apps/api/src/db/schema.ts`: add `bonusesJson` column + unique index to `wolfDecisions`
  - [x] Run `pnpm --filter @wolf-cup/api db:generate` to create migration SQL
  - [x] Add `wolfDecisionSchema` to `apps/api/src/schemas/round.ts`
  - [x] Add `POST /rounds/:roundId/groups/:groupId/holes/:holeNumber/wolf-decision` to `apps/api/src/routes/rounds.ts`
  - [x] Add `GET /rounds/:roundId/groups/:groupId/wolf-decisions` to `apps/api/src/routes/rounds.ts`
  - [x] Add new describe block to `apps/api/src/routes/rounds.test.ts`

- [x] Task 2: Web — extended hole form + summary money (AC: #7–13, #15–16)
  - [x] Update `apps/web/src/routes/score-entry-hole.tsx`: add wolf-decisions query + state
  - [x] Add wolf decision UI (radio buttons + partner dropdown)
  - [x] Add greenie/polie checkbox UI
  - [x] Wire "Save Hole" to fire both score POST + wolf-decision POST
  - [x] Update summary money column to show actual values

## Dev Notes

### DB Migration — Schema Changes (CRITICAL)

Update `wolfDecisions` in `apps/api/src/db/schema.ts`:

```typescript
export const wolfDecisions = sqliteTable(
  'wolf_decisions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    roundId: integer('round_id').notNull().references(() => rounds.id),
    groupId: integer('group_id').notNull().references(() => groups.id),
    holeNumber: integer('hole_number').notNull(),
    wolfPlayerId: integer('wolf_player_id').notNull().references(() => players.id),
    decision: text('decision').notNull(),
    partnerPlayerId: integer('partner_player_id').references(() => players.id),
    bonusesJson: text('bonuses_json'),   // ← NEW: JSON {greenies:[id,...], polies:[id,...]}
    outcome: text('outcome'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    roundDecisionUniq: uniqueIndex('uniq_wolf_decisions').on(t.roundId, t.groupId, t.holeNumber),  // ← NEW
    roundIdx: index('idx_wolf_decisions_round_id').on(t.roundId),
    decisionCheck: check('chk_wolf_decisions_decision', sql`decision IN ('partner', 'alone', 'blind_wolf')`),
    outcomeCheck: check('chk_wolf_decisions_outcome', sql`outcome IS NULL OR outcome IN ('win', 'loss', 'push')`),
  }),
);
```

After editing schema, run:
```bash
pnpm --filter @wolf-cup/api db:generate
```
This creates a new migration file in `apps/api/src/db/migrations/`. The test setup uses `migrate()` which auto-applies all migrations — no test setup changes needed.

### API — Zod Schema (add to `apps/api/src/schemas/round.ts`)

```typescript
export const wolfDecisionSchema = z.object({
  decision: z.enum(['alone', 'partner', 'blind_wolf']).optional(),
  partnerPlayerId: z.number().int().positive().optional(),
  greenies: z.array(z.number().int().positive()).optional().default([]),
  polies: z.array(z.number().int().positive()).optional().default([]),
});
export type WolfDecisionBody = z.infer<typeof wolfDecisionSchema>;
```

Note: `decision` is optional at schema level; business-rule validation (required for wolf holes, forbidden for skins holes) happens in the handler.

### API — Par-3 Hole Numbers

Holes 4, 7, 11, 16 are par-3 at Guyan G&CC. Hardcode this set for greenie validation:
```typescript
const PAR3_HOLES = new Set([4, 7, 11, 16]);
```

### API — wolfPlayerId Lookup

The `wolfDecisions` table requires `wolfPlayerId`. Derive it from `battingOrder` + `holeNumber` using the same formula as the engine:
- Skins holes (1–2): no wolfPlayerId (skip)
- Wolf holes (3–18): `wolfBatterIndex = (holeNumber - 3) % 4`; `wolfPlayerId = battingOrder[wolfBatterIndex]`

```typescript
const group = await db.select({ battingOrder: groups.battingOrder }).from(groups)
  .where(and(eq(groups.id, groupId), eq(groups.roundId, roundId))).get();
const battingOrder = JSON.parse(group!.battingOrder!) as number[];  // must exist
const wolfBatterIndex = (holeNumber - 3) % 4;
const wolfPlayerId = battingOrder[wolfBatterIndex]!;
```

Validate `partnerPlayerId !== wolfPlayerId` and `partnerPlayerId` is in `validPlayerIds`.

### API — Engine: WolfDecision + HoleAssignment Construction

```typescript
import { calculateHoleMoney, applyBonusModifiers, getCourseHole, calculateStablefordPoints } from '@wolf-cup/engine';
import type { HoleNumber, WolfDecision, BonusInput, HoleAssignment, BattingPosition } from '@wolf-cup/engine';

// Build WolfDecision from DB record
function buildWolfDecision(
  decision: string,
  partnerPlayerId: number | null,
  battingOrder: number[],
): WolfDecision {
  if (decision === 'alone') return { type: 'alone' };
  if (decision === 'blind_wolf') return { type: 'blind_wolf' };
  // partner: find batting position of partnerPlayerId
  const partnerBatterIndex = battingOrder.indexOf(partnerPlayerId!) as BattingPosition;
  return { type: 'partner', partnerBatterIndex };
}

// Build HoleAssignment for wolf holes 3-18
function buildHoleAssignment(holeNumber: number, battingOrder: number[]): HoleAssignment {
  if (holeNumber <= 2) return { type: 'skins' };
  const wolfBatterIndex = ((holeNumber - 3) % 4) as BattingPosition;
  return { type: 'wolf', wolfBatterIndex };
}

// Build BonusInput from stored playerIds → batting positions
function buildBonusInput(bonusesJson: string | null, battingOrder: number[]): BonusInput {
  if (!bonusesJson) return { greenies: [], polies: [] };
  const { greenies = [], polies = [] } = JSON.parse(bonusesJson) as { greenies?: number[]; polies?: number[] };
  return {
    greenies: greenies.map(id => battingOrder.indexOf(id) as BattingPosition).filter(p => p >= 0),
    polies: polies.map(id => battingOrder.indexOf(id) as BattingPosition).filter(p => p >= 0),
  };
}
```

### API — Net Score Computation

To get `netScores[4]` (indexed by batting position), use the same pattern as Stableford recalc in Story 3.4:

```typescript
// netScores must be [number, number, number, number] indexed by BattingPosition
const netScores = battingOrder.map((playerId, idx) => {
  const grossScore = holeScoreMap.get(playerId) ?? 0;
  const hi = handicapMap.get(playerId) ?? 0;
  const courseHole = getCourseHole(holeNum as HoleNumber);
  const strokes = Math.floor((hi * courseHole.strokeIndex) / 18);
  return grossScore - strokes;
}) as [number, number, number, number];
```

Wait — check `calculateStablefordPoints` to see how net score is computed. Actually, net score = grossScore − strokes, where `strokes = Math.floor((playingHandicap * strokeIndex) / 18)`. But the engine's `calculateStablefordPoints` handles this internally. For money calculation you need net scores directly. Use the same formula but derive it from the engine's internal logic (or look at how the engine computes it). Actually, looking at the engine: the money engine takes `netScores` directly, not gross scores. The conversion gross→net happens OUTSIDE the money engine.

**CRITICAL**: Check `packages/engine/src/stableford.ts` for the exact formula used to compute net score from handicapIndex, par, strokeIndex. The formula is:
- `playingHandicap = Math.round(handicapIndex * 0.8)` (typically, but verify in engine)
- `strokesOnHole = Math.floor((playingHandicap * courseHole.strokeIndex) / 18)` — CHECK ACTUAL FORMULA in stableford.ts

DO NOT assume — read `packages/engine/src/stableford.ts` before implementing net score calculation.

### API — Money Recalculation Algorithm

After saving wolf decision, recalculate money for ALL holes in the group:

```typescript
async function recalculateMoney(
  roundId: number, groupId: number, db: DrizzleDb
): Promise<Map<number, number>> {
  // 1. Fetch everything needed
  const group = ... // battingOrder
  const battingOrder = JSON.parse(group.battingOrder) as number[];

  const allScores = ... // hole_scores for group, keyed by holeNumber → Map<playerId, grossScore>
  const allDecisions = ... // wolf_decisions for group, keyed by holeNumber
  const handicapMap = ... // roundPlayers: playerId → handicapIndex

  const playerMoneyTotals = new Map<number, number>(); // playerId → cumulative money

  for (let holeNum = 1; holeNum <= 18; holeNum++) {
    const holeMap = allScores.get(holeNum);
    if (!holeMap || holeMap.size < 4) continue; // skip if not all 4 players scored

    const courseHole = getCourseHole(holeNum as HoleNumber);
    const grossScores = battingOrder.map(pid => holeMap.get(pid) ?? 0) as [n,n,n,n];
    const netScores = battingOrder.map((pid, i) => {
      // compute net score — see stableford.ts for exact formula
      return grossScores[i]! - strokesOnHole(handicapMap.get(pid) ?? 0, courseHole.strokeIndex);
    }) as [n,n,n,n];

    const decision = allDecisions.get(holeNum);
    const holeAssignment = buildHoleAssignment(holeNum, battingOrder);

    let wolfDecision: WolfDecision = { type: 'alone' }; // default for skins holes
    if (holeNum >= 3) {
      if (!decision) continue; // wolf hole without decision yet — skip
      wolfDecision = buildWolfDecision(decision.decision, decision.partnerPlayerId, battingOrder);
    }

    const bonusInput = buildBonusInput(decision?.bonusesJson ?? null, battingOrder);
    const base = calculateHoleMoney(netScores, holeAssignment, wolfDecision, courseHole.par);
    const result = (bonusInput.greenies.length > 0 || bonusInput.polies.length > 0)
      ? applyBonusModifiers(base, netScores, grossScores, bonusInput, holeAssignment, wolfDecision, courseHole.par)
      : base;

    for (let pos = 0; pos < 4; pos++) {
      const playerId = battingOrder[pos]!;
      playerMoneyTotals.set(playerId, (playerMoneyTotals.get(playerId) ?? 0) + result[pos]!.total);
    }
  }

  return playerMoneyTotals;
}
```

### API — Route Location

Both new endpoints go into `apps/api/src/routes/rounds.ts` (public routes). Same file as all previous score endpoints. Entry code gating pattern is identical to POST /scores from Story 3.4.

### API — Test Setup

Reuse the `scoreGroupId` variables from the score-entry describe block. The new wolf-decision describe block needs the same 4 players in a group WITH a batting order set (wolf decisions require knowing who the wolf is). In `beforeAll` of the new describe block:
```typescript
// Set battingOrder so wolfPlayerId can be computed
await db.update(groups).set({ battingOrder: JSON.stringify([s1Id, s2Id, s3Id, s4Id]) }).where(eq(groups.id, scoreGroupId));
```
Also ensure hole_scores exist before testing money calculation (submit scores for hole 5 before testing wolf decision for hole 5).

**CRITICAL**: The describe block's `afterEach` must also clean wolf_decisions:
```typescript
await db.delete(wolfDecisions).where(eq(wolfDecisions.roundId, officialRoundId));
await db.delete(wolfDecisions).where(eq(wolfDecisions.roundId, casualRoundId));
```

### Web — Session & Queries

Add a third parallel query alongside round + scores:
```typescript
const { data: decisionsData } = useQuery({
  queryKey: ['wolf-decisions', session?.roundId ?? 0, session?.groupId ?? 0],
  queryFn: () =>
    apiFetch<{ wolfDecisions: StoredWolfDecision[] }>(
      `/rounds/${session!.roundId}/groups/${session!.groupId}/wolf-decisions`,
    ),
  enabled: session !== null && session.groupId !== null,
  staleTime: 0,
});
```

### Web — State for Wolf Decisions

```typescript
// Per hole: wolf decision state
const [holeDecisions, setHoleDecisions] = useState<Map<number, StoredWolfDecision>>(new Map());

// Current hole inputs (persisted across navigation)
const [currentDecision, setCurrentDecision] = useState<'alone' | 'partner' | 'blind_wolf' | null>(null);
const [currentPartnerId, setCurrentPartnerId] = useState<number | null>(null);
const [currentGreenies, setCurrentGreenies] = useState<Set<number>>(new Set());
const [currentPolies, setCurrentPolies] = useState<Set<number>>(new Set());
```

Populate `holeDecisions` from `decisionsData` in a `useEffect([decisionsData])`. Pre-populate current inputs from `holeDecisions.get(currentHole)` in the `useEffect([currentHole])` (same pattern as `currentInputs` pre-population).

### Web — Wolf Decision UI Rendering

```tsx
// Wolf decision (holes 3-18, autoCalculateMoney=true)
{round.autoCalculateMoney && currentHole >= 3 && (
  <div className="flex flex-col gap-2 border rounded-lg p-3">
    <p className="text-sm font-medium">
      Wolf: {wolfHole.wolfPlayerName}
    </p>
    <div className="flex gap-2">
      {(['alone', 'partner', 'blind_wolf'] as const).map((d) => (
        <Button
          key={d}
          variant={currentDecision === d ? 'default' : 'outline'}
          className="flex-1"
          onClick={() => setCurrentDecision(d)}
        >
          {d === 'alone' ? 'Alone' : d === 'partner' ? 'Partner' : 'Blind Wolf'}
        </Button>
      ))}
    </div>
    {currentDecision === 'partner' && (
      <select
        className="border rounded-lg p-2 bg-background"
        value={currentPartnerId ?? ''}
        onChange={(e) => setCurrentPartnerId(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">— select partner —</option>
        {orderedPlayers
          .filter((p) => p.id !== wolfHole.wolfPlayerId)
          .map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
      </select>
    )}
  </div>
)}

// Greenie (par-3 holes only)
{PAR3_HOLES.has(currentHole) && (
  <div className="flex flex-col gap-1">
    <p className="text-sm font-medium text-muted-foreground">Greenie</p>
    {orderedPlayers.map((p) => (
      <label key={p.id} className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={currentGreenies.has(p.id)}
          onChange={(e) => {
            const s = new Set(currentGreenies);
            e.target.checked ? s.add(p.id) : s.delete(p.id);
            setCurrentGreenies(s);
          }}
        />
        {p.name}
      </label>
    ))}
  </div>
)}

// Polie (any hole)
<div className="flex flex-col gap-1">
  <p className="text-sm font-medium text-muted-foreground">Polie</p>
  {orderedPlayers.map((p) => (
    <label key={p.id} className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={currentPolies.has(p.id)}
        onChange={(e) => {
          const s = new Set(currentPolies);
          e.target.checked ? s.add(p.id) : s.delete(p.id);
          setCurrentPolies(s);
        }}
      />
      {p.name}
    </label>
  ))}
</div>
```

### Web — PAR3_HOLES constant

```typescript
const PAR3_HOLES = new Set([4, 7, 11, 16]); // Guyan G&CC par-3 holes
```

### Web — "Save Hole" mutation — firing both POSTs

The existing `submitMutation` (scores POST) fires first. On its `onSuccess`, if wolf decision or bonuses are present, immediately fire the wolf-decision mutation:

```typescript
const wolfDecisionMutation = useMutation({
  mutationFn: ({ holeNum }: { holeNum: number }) => {
    const hasWolfDecision = round.autoCalculateMoney && holeNum >= 3 && currentDecision !== null;
    const hasPartner = currentDecision === 'partner';
    const body = {
      ...(hasWolfDecision && { decision: currentDecision }),
      ...(hasWolfDecision && hasPartner && { partnerPlayerId: currentPartnerId }),
      greenies: [...currentGreenies],
      polies: [...currentPolies],
    };
    return apiFetch<WolfDecisionResponse>(
      `/rounds/${session!.roundId}/groups/${session!.groupId}/holes/${holeNum}/wolf-decision`,
      {
        method: 'POST',
        headers: session?.entryCode ? { 'x-entry-code': session.entryCode } : {},
        body: JSON.stringify(body),
      },
    );
  },
  onSuccess: (data) => {
    // Update moneyTotals state
    const newTotals = new Map<number, number>();
    for (const t of data.moneyTotals) {
      newTotals.set(t.playerId, t.moneyTotal);
    }
    setMoneyTotals(newTotals);
    // Store decision in local state
    setHoleDecisions((prev) => new Map(prev).set(currentHoleForDecision, data.wolfDecision));
  },
  onError: (err: Error) => {
    if (err.message === 'INVALID_DECISION') {
      setWolfError('Invalid wolf decision — please check your inputs.');
    } else if (err.message === 'INVALID_ENTRY_CODE') {
      setWolfError('Entry code no longer valid — please re-join the round.');
    } else {
      setWolfError('Could not save wolf decision — please try again.');
    }
  },
});
```

Trigger wolf decision mutation from `submitMutation.onSuccess` if there's anything to save (decision set OR greenies/polies non-empty). Advance hole AFTER both mutations complete (or after scores if no wolf data to save).

**CRITICAL**: Wolf-decision POST is skipped (fire-and-forget approach avoided) — instead: advance the hole ONLY after wolf-decision completes (if wolf decision has data to submit). If no wolf data, advance immediately after score POST. This prevents hole advancement while wolf-decision POST is still in flight.

### Web — Money Totals State

Add alongside `stablefordTotals`:
```typescript
const [moneyTotals, setMoneyTotals] = useState<Map<number, number>>(new Map());
```

Populate from wolf-decision `onSuccess` (data.moneyTotals). Also populate from decisionsData on load if available (GET /wolf-decisions doesn't return moneyTotals — we only get moneyTotals from POST responses). For page refresh, moneyTotals will be empty on load; they populate after the next wolf-decision POST.

Actually — the summary needs moneyTotals on page refresh. Consider: extend `GET /scores` to include `moneyTotals` from `round_results` (similar to how Story 3.4 added `roundTotals`). The GET /scores endpoint already fetches `round_results` for stableford. Add `moneyTotal` to that query:

```typescript
// In GET /scores handler (rounds.ts), extend the round_results query:
const results = await db
  .select({ playerId: roundResults.playerId, stablefordTotal: roundResults.stablefordTotal, moneyTotal: roundResults.moneyTotal })
  .from(roundResults)
  .where(and(eq(roundResults.roundId, roundId), inArray(roundResults.playerId, groupPlayerIds)));
return c.json({ scores, roundTotals: results }, 200);
```

And update the `RoundTotal` type in web:
```typescript
type RoundTotal = { playerId: number; stablefordTotal: number; moneyTotal: number };
```

This is the cleanest approach — no new endpoint needed.

### Web — Summary Money Formatting

```tsx
<td className="py-2 text-right">
  {moneyTotals.has(player.id)
    ? moneyTotals.get(player.id)! > 0
      ? `+$${moneyTotals.get(player.id)}`
      : moneyTotals.get(player.id)! < 0
      ? `-$${Math.abs(moneyTotals.get(player.id)!)}`
      : '$0'
    : '—'}
</td>
```

### Stableford Net Score Formula — MUST VERIFY

Before implementing net score computation in the money recalculation, read `packages/engine/src/stableford.ts` to get the EXACT strokes-on-hole formula. Do NOT assume. The common formula is:
```
playingHandicap = Math.round(handicapIndex * 0.8)  // or truncate — check engine
strokesOnHole = playingHandicap >= strokeIndex ? 1 : 0  // plus extra if playingHandicap >= 18+strokeIndex
```
But the Wolf Cup may use a different formula. Verify before writing the recalculation.

### What This Story Does NOT Include

- Harvey Cup points calculation (Story 3.8+)
- Wolf outcome recording (win/loss/push — Story 5.1)
- Offline queue (Story 3.7)
- Guest player score entry (Story 3.6)
- Live leaderboard (Story 3.8)
- Admin score corrections for wolf decisions (Story 2.8 already handled gross scores)

### Project Structure Notes

- Modified: `apps/api/src/db/schema.ts` — wolfDecisions table updates
- New: `apps/api/src/db/migrations/XXXX_wolf_decisions_bonuses.sql` (drizzle-kit generated)
- Modified: `apps/api/src/db/migrations/meta/_journal.json` (drizzle-kit updated)
- Modified: `apps/api/src/schemas/round.ts` — add `wolfDecisionSchema`
- Modified: `apps/api/src/routes/rounds.ts` — add POST + GET wolf-decision endpoints
- Modified: `apps/api/src/routes/rounds.test.ts` — new describe block
- Modified: `apps/web/src/routes/score-entry-hole.tsx` — wolf decision + bonus UI

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

_None_

### Completion Notes List

- Schema migration: made `wolfPlayerId` and `decision` nullable on `wolfDecisions` to support skins-hole bonus-only records. Added `bonusesJson` TEXT column and `uniq_wolf_decisions` unique index on `(round_id, group_id, hole_number)`. Fixed migration INSERT/SELECT to use `NULL` for `bonuses_json` from old table.
- API: POST endpoint validates skins-hole vs wolf-hole rules, builds WolfDecision/HoleAssignment/BonusInput from batting order, calls `calculateHoleMoney` + `applyBonusModifiers`, upserts `round_results.moneyTotal`. GET endpoint returns all decisions sorted by holeNumber with greenies/polies parsed from JSON.
- GET /scores extended to include `moneyTotal` in roundTotals (alongside existing `stablefordTotal`).
- Fixed `score-corrections.ts` typecheck: `row.decision` now `string | null` after schema change — used `?? ''` for `oldValue` assignment.
- Net score formula verified from `stableford.ts`: `getHandicapStrokes(handicapIndex, strokeIndex)` uses `Math.round(hi)`, base = floor(ch/18), extra = ch%18, strokes = base + (strokeIndex <= extra ? 1 : 0).
- Web: three parallel queries (round + scores + wolf-decisions). Wolf decision UI: 3 radio buttons + partner dropdown. Greenie checkboxes on par-3 holes (gated on autoCalculateMoney). Polie checkboxes when autoCalculateMoney. Save Hole fires score POST then wolf-decision POST (sequentially); hole advances after wolf-decision completes (or immediately if no wolf data). Summary shows actual money totals formatted as +$N / -$N / $0.
- 166 tests passing (15 new wolf-decision tests in rounds.test.ts). Web typecheck + lint clean.
- Code review fixes: (1) Greenie section now gated on `autoCalculateMoney` (was missing, causing invisible data discard on money-disabled rounds); (2) skins-hole `hasWolfDecision` condition fixed to not fire wolf-decision POST on holes 1–2 unless there are actual bonuses.
- Change Log: 2026-02-28 — Story 3.5 implemented. 2026-03-01 — Code review fixes applied.

### File List

- `apps/api/src/db/schema.ts` — wolfDecisions table: nullable wolfPlayerId/decision, new bonusesJson column, uniq_wolf_decisions index
- `apps/api/src/db/migrations/0003_same_invaders.sql` — migration (with NULL fix for bonuses_json INSERT)
- `apps/api/src/db/migrations/meta/_journal.json` — updated by drizzle-kit
- `apps/api/src/schemas/round.ts` — added wolfDecisionSchema + WolfDecisionBody
- `apps/api/src/routes/rounds.ts` — added helpers, POST wolf-decision endpoint, GET wolf-decisions endpoint, extended GET /scores
- `apps/api/src/routes/rounds.test.ts` — new Wolf decision endpoints describe block (15 tests)
- `apps/api/src/routes/admin/score-corrections.ts` — fixed `oldValue = row.decision ?? ''` typecheck
- `apps/web/src/routes/score-entry-hole.tsx` — wolf decision UI, greenie/polie UI, dual-POST save, money summary
