# Story 7.3: Admin Season Settings UI

Status: done

## Story

As an admin (Jason or Josh),
I want a web UI for managing season settings and side games,
so that I can create and edit seasons (dates, round count, playoff format, Harvey live toggle) and manage the side game schedule and results without touching the database directly.

## Acceptance Criteria

1. Navigating to `/admin/season` fetches `GET /admin/seasons` (with `retry: false`). While loading, show a skeleton placeholder. On 401, redirect to `/admin/login`. On other error, show a retry button.

2. The page has two sections: **Season Settings** (top) and **Side Games** (bottom). Season Settings renders first; Side Games section only becomes interactive once a season is selected.

3. **Season list & selection:** Seasons are shown in a list (sorted by ID). Clicking a season row selects it (highlighted), which populates the Season Settings edit form and loads that season's side games via `GET /admin/seasons/:seasonId/side-games`.

4. **Create Season form** (always visible above the list): Fields: Name (text, required), Start Date (`<input type="date">`, required), End Date (`<input type="date">`, required), Total Rounds (number ≥ 1, required), Playoff Format (text, required). Submitting calls `POST /admin/seasons`; the new season appears in the list and is auto-selected.

5. **Edit Season form** (inline, appears when a season is selected): Pre-filled from selected season. Fields: Name, Start Date, End Date, Total Rounds, Playoff Format. Saving calls `PATCH /admin/seasons/:id` with only changed fields. Closes (deselects) on success. If nothing changed, clicking Save closes without an API call.

6. **Harvey Live toggle** (within Edit Season form): A labeled checkbox `harveyLiveEnabled`. Sends `{ harveyLiveEnabled: true | false }` in the PATCH body. Updates in-place on success. Note: API returns `harveyLiveEnabled` as `0 | 1` (SQLite integer); display as boolean (`=== 1`); send `true`/`false` to PATCH.

7. **Side Games section** (visible when a season is selected): Shows a list of side games for the selected season. Each side game row shows: Name, Format, number of scheduled rounds. Has an Add Side Game form and per-row edit/delete actions.

8. **Add Side Game form**: Fields: Name (text, required), Format (text, required). Submitting calls `POST /admin/seasons/:seasonId/side-games`. The new side game appears in the list immediately. `scheduledRoundIds` is optional — not collected in the create form (too complex for this story).

9. **Edit Side Game (inline):** Each side game row has an Edit button that expands an inline form pre-filled with Name and Format. Saving calls `PATCH /admin/side-games/:id` with only changed fields. One row in edit mode at a time (`editingId` pattern).

10. **Record Side Game Result:** Each side game row has a "Record Result" button. Clicking expands an inline result form for a specific round: Round selector (dropdown of rounds for this season, sorted by date), Winner Name (text, required — free text for simplicity, no roster lookup needed). Submitting calls `POST /admin/rounds/:roundId/side-game-results` with `{ sideGameId, winnerName }`. On success, show a brief inline confirmation and close.

11. While any mutation is in-flight, its action button is disabled and shows a loading spinner. On 401 from any mutation, redirect to `/admin/login`.

12. Error state: if initial load fails (non-401), show error with retry button. If a mutation fails (non-401), show inline error message.

13. `pnpm --filter @wolf-cup/web typecheck` passes with zero errors.

## Tasks / Subtasks

- [x] Task 1: Page skeleton + season list + parallel data fetch (AC: #1, #2, #3)
  - [x] Replace "Coming soon" stub in `apps/web/src/routes/admin/season.tsx`
  - [x] `useQuery` for `GET /admin/seasons` with `queryKey: ['admin-seasons']`, `retry: false`
  - [x] Render loading skeleton while query is loading
  - [x] Render error state with retry button; 401 redirects to `/admin/login`
  - [x] Season list with click-to-select (highlight selected row)
  - [x] On season select, load side games via second `useQuery` keyed by `['admin-side-games', seasonId]`

- [x] Task 2: Create Season form (AC: #4)
  - [x] Form with Name, Start Date, End Date, Total Rounds, Playoff Format fields
  - [x] `useMutation` calling `POST /admin/seasons`; on success `invalidateQueries(['admin-seasons'])` + auto-select new season + clear form
  - [x] Inline error on failure; button disabled + spinner while pending

- [x] Task 3: Edit Season form + Harvey toggle (AC: #5, #6)
  - [x] Inline form shown below selected season row; pre-filled from selected season data
  - [x] Fields: Name, Start Date, End Date, Total Rounds, Playoff Format, Harvey Live checkbox
  - [x] Build PATCH body with only changed fields (bracket notation on `Record<string, unknown>`)
  - [x] `useMutation` calling `PATCH /admin/seasons/:id`; on success `invalidateQueries(['admin-seasons'])` + close panel
  - [x] If nothing changed, close without API call
  - [x] 401 on mutation → redirect to `/admin/login`

- [x] Task 4: Side Games list + Add form (AC: #7, #8)
  - [x] Side games section visible only when a season is selected
  - [x] `useQuery` for `GET /admin/seasons/:seasonId/side-games` with `queryKey: ['admin-side-games', seasonId]`
  - [x] Side games list: Name, Format, scheduled round count
  - [x] Add Side Game form: Name (required), Format (required)
  - [x] `useMutation` calling `POST /admin/seasons/:seasonId/side-games`; on success `invalidateQueries(['admin-side-games', seasonId])` + clear form

- [x] Task 5: Edit Side Game inline (AC: #9)
  - [x] Edit button per side game row → inline form with Name and Format pre-filled
  - [x] `useMutation` calling `PATCH /admin/side-games/:id` with only changed fields
  - [x] `editingId` state — only one row in edit mode at a time; closes on success
  - [x] 401 on mutation → redirect to `/admin/login`

- [x] Task 6: Record Side Game Result (AC: #10, #11)
  - [x] "Record Result" button per side game row → inline result form
  - [x] Round dropdown populated from `['admin-rounds']` query filtered to selected season
  - [x] Winner Name (free text, required)
  - [x] `useMutation` calling `POST /admin/rounds/:roundId/side-game-results` with `{ sideGameId, winnerName }`
  - [x] On success: show brief inline "Result recorded ✓" then close; 401 → redirect

- [x] Task 7: Verify quality gate (AC: #13)
  - [x] `pnpm --filter @wolf-cup/web typecheck` — zero errors

## Dev Notes

### File to Edit

**Only one file needs to be created/replaced:**
```
apps/web/src/routes/admin/season.tsx   ← replace the "Coming soon" stub
```

Do NOT edit `routeTree.gen.ts` — auto-generated. Do NOT create new component files — inline all subcomponents in `season.tsx`.

### API Endpoints

All under `/api/admin/` prefix (Vite dev proxies `/api` → `http://localhost:3000`):

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/admin/seasons` | — | `{ items: Season[] }` (200) |
| POST | `/admin/seasons` | `{ name, startDate, endDate, totalRounds, playoffFormat }` | `{ season: Season }` (201) |
| PATCH | `/admin/seasons/:id` | `{ name?, startDate?, endDate?, totalRounds?, playoffFormat?, harveyLiveEnabled? }` | `{ season: Season }` (200) |
| GET | `/admin/seasons/:seasonId/side-games` | — | `{ items: SideGame[] }` (200) |
| POST | `/admin/seasons/:seasonId/side-games` | `{ name, format }` | `{ sideGame: SideGame }` (201) |
| PATCH | `/admin/side-games/:id` | `{ name?, format? }` | `{ sideGame: SideGame }` (200) |
| GET | `/admin/rounds` | — | `{ items: Round[] }` (200) |
| POST | `/admin/rounds/:roundId/side-game-results` | `{ sideGameId, winnerName }` | `{ result: SideGameResult }` (201) |

**Important schema constraints:**
- `createSeasonSchema`: name min 1, startDate/endDate `YYYY-MM-DD` regex, totalRounds int ≥ 1, playoffFormat min 1
- `updateSeasonSchema`: all optional, at least one field required, `harveyLiveEnabled: z.boolean()`
- `createSideGameSchema`: name min 1, format min 1, scheduledRoundIds optional
- `updateSideGameSchema`: name/format optional, at least one field required
- `createSideGameResultSchema`: sideGameId required, winnerPlayerId OR winnerName required (either/or). For this UI, always send `winnerName` (free text — simpler, no roster lookup).

### Types

```typescript
type Season = {
  id: number;
  name: string;
  startDate: string;   // YYYY-MM-DD
  endDate: string;     // YYYY-MM-DD
  totalRounds: number;
  playoffFormat: string;
  harveyLiveEnabled: number;  // 0 | 1 (SQLite integer boolean)
  createdAt: number;
};

type SideGame = {
  id: number;
  seasonId: number;
  name: string;
  format: string;
  scheduledRoundIds: number[];  // already parsed from JSON by API helper
};

type Round = {
  id: number;
  seasonId: number;
  type: 'official' | 'casual';
  status: 'scheduled' | 'active' | 'finalized' | 'cancelled';
  scheduledDate: string;  // YYYY-MM-DD
  autoCalculateMoney: number;
  headcount: number | null;
  createdAt: number;
};
```

`harveyLiveEnabled` comes from API as `0` or `1`. Convert with `season.harveyLiveEnabled === 1` for display; send `true`/`false` in PATCH body.

### 401 Handling Pattern (from roster.tsx / rounds.tsx)

```tsx
// On useQuery error:
if ((error as Error).message === 'UNAUTHORIZED') {
  void navigate({ to: '/admin/login' });
  return null;
}

// On useMutation onError:
if (err.message === 'UNAUTHORIZED') {
  void navigate({ to: '/admin/login' });
  return;
}
```

Add `retry: false` to all `useQuery` calls.

### Harvey Live Toggle

`harveyLiveEnabled` is sent as boolean in PATCH, returned as integer from GET:

```tsx
// Display:
const harveyOn = season.harveyLiveEnabled === 1;

// In edit form initial state:
const [harveyLive, setHarveyLive] = useState(season.harveyLiveEnabled === 1);

// In PATCH body building:
if (harveyLive !== (season.harveyLiveEnabled === 1)) patch['harveyLiveEnabled'] = harveyLive;
```

### Edit Season PATCH Body (only changed fields)

Use bracket notation on `Record<string, unknown>` to satisfy `noPropertyAccessFromIndexSignature`:

```typescript
const patch: Record<string, unknown> = {};
if (name !== season.name)             patch['name'] = name;
if (startDate !== season.startDate)   patch['startDate'] = startDate;
if (endDate !== season.endDate)       patch['endDate'] = endDate;
if (Number(totalRounds) !== season.totalRounds) patch['totalRounds'] = Number(totalRounds);
if (playoffFormat !== season.playoffFormat) patch['playoffFormat'] = playoffFormat;
if (harveyLive !== (season.harveyLiveEnabled === 1)) patch['harveyLiveEnabled'] = harveyLive;

if (Object.keys(patch).length === 0) { onClose(); return; }
editMutation.mutate(patch);
```

### Edit Side Game PATCH Body

```typescript
const patch: Record<string, unknown> = {};
if (name !== game.name)     patch['name'] = name;
if (format !== game.format) patch['format'] = format;
if (Object.keys(patch).length === 0) { setEditingId(null); return; }
patchMutation.mutate({ id: game.id, body: patch });
```

### Date Formatting

```typescript
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}
```

### Side Games — `scheduledRoundIds`

The API stores `scheduledRoundIds` as a JSON string in SQLite but the `toSideGameResponse` helper in `side-games.ts` already parses it:
```typescript
scheduledRoundIds: row.scheduledRoundIds ? (JSON.parse(row.scheduledRoundIds) as number[]) : []
```
So the client receives `scheduledRoundIds: number[]` directly — no extra parsing needed.

The "scheduled round count" column in the side games list can simply display `game.scheduledRoundIds.length` (with fallback "—" if 0).

### Round Selector for Side Game Results

For the "Record Result" inline form, populate a round dropdown from the rounds already in the `['admin-rounds']` cache (or fetch fresh). Filter by `seasonId === selectedSeasonId` to show only rounds for the current season. Sort by `scheduledDate`.

```tsx
const roundsQuery = useQuery({
  queryKey: ['admin-rounds'],
  queryFn: () => apiFetch<{ items: Round[] }>('/admin/rounds'),
  retry: false,
});

const seasonRounds = (roundsQuery.data?.items ?? [])
  .filter((r) => r.seasonId === selectedSeasonId)
  .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
```

### Loading Skeleton (copy from rounds.tsx)

```tsx
function LoadingSkeleton() {
  return (
    <div className="rounded-md border overflow-hidden animate-pulse">
      <div className="h-9 bg-muted/50" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3 px-3 py-3 border-b last:border-0">
          <div className="flex-1 h-4 bg-muted rounded" />
          <div className="h-4 w-20 bg-muted rounded" />
          <div className="h-4 w-16 bg-muted rounded" />
        </div>
      ))}
    </div>
  );
}
```

### Mutation Invalidation

```typescript
// After POST /admin/seasons or PATCH /admin/seasons/:id:
void queryClient.invalidateQueries({ queryKey: ['admin-seasons'] });

// After POST /admin/seasons/:seasonId/side-games or PATCH /admin/side-games/:id:
void queryClient.invalidateQueries({ queryKey: ['admin-side-games', seasonId] });

// After POST /admin/rounds/:roundId/side-game-results:
// No additional invalidation needed (results not displayed in this UI)
```

### Icons (Lucide — already installed)

- `Pencil` — edit button
- `Plus` — add/create button
- `Loader2` with `animate-spin` — loading spinner
- `AlertCircle` — error state
- `RefreshCw` — retry button
- `Trophy` — side game result recording
- `Check` — Harvey live enabled indicator
- `X` — Harvey live disabled indicator

### State Structure

The page manages:
```typescript
const [selectedSeasonId, setSelectedSeasonId] = useState<number | null>(null);
const [editingSeasonId, setEditingSeasonId] = useState<number | null>(null);
const [editingSideGameId, setEditingSideGameId] = useState<number | null>(null);
const [recordingResultForGameId, setRecordingResultForGameId] = useState<number | null>(null);
```

Only one panel open at a time per section. Selecting a different season closes the edit season form.

### Create Season Form Reset on Success

```typescript
onSuccess: (data) => {
  void queryClient.invalidateQueries({ queryKey: ['admin-seasons'] });
  setSelectedSeasonId(data.season.id);  // auto-select new season
  setName(''); setStartDate(''); setEndDate('');
  setTotalRounds(''); setPlayoffFormat('');
  setFormError(null);
},
```

### References

- File to replace: `apps/web/src/routes/admin/season.tsx`
- Previous story pattern (auth, mutations, retry:false, bracket notation): `apps/web/src/routes/admin/rounds.tsx`
- Roster pattern (editingId, inline forms): `apps/web/src/routes/admin/roster.tsx`
- API implementation — seasons: `apps/api/src/routes/admin/season.ts`
- API implementation — side games: `apps/api/src/routes/admin/side-games.ts`
- Season schema: `apps/api/src/schemas/season.ts`
- Side game schema: `apps/api/src/schemas/side-game.ts`
- DB schema (seasons table): `apps/api/src/db/schema.ts:46–55`
- DB schema (side_games table): `apps/api/src/db/schema.ts:272–287`
- DB schema (side_game_results table): `apps/api/src/db/schema.ts:293–311`
- apiFetch helper: `apps/web/src/lib/api.ts`
- queryClient: `apps/web/src/lib/query-client.ts`
- Button component: `apps/web/src/components/ui/button.tsx`
- Admin layout: `apps/web/src/routes/admin.tsx`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Single file implementation — all subcomponents inlined in `season.tsx`
- Season list with click-to-select + toggle-deselect; selected row highlighted with border-l-primary
- `EditSeasonPanel` renders inline below selected season row; pre-filled from season data; deselects on save success or Cancel
- `CreateSeasonForm.onSuccess` auto-selects newly created season via `onCreated(data.season.id)` callback
- `harveyLiveEnabled` received as `0|1`, sent as `boolean` in PATCH body; bracket notation on patch Record
- `SideGamesSection` is a separate component with its own `useQuery(['admin-side-games', seasonId])`; only rendered when a season is selected
- `editingSideGameId` and `recordingResultForGameId` states in `SideGamesSection` are mutually exclusive — opening one closes the other
- `RecordResultRow`: rounds filtered to selected season and sorted by scheduledDate; shows green success message for 1.5s then closes
- `['admin-rounds']` query fetched at page level (reuses cache from rounds page); filtered to selected season before passing to `SideGamesSection`
- 401 handling on all queries (seasons, rounds, side-games) and all mutations (create/edit season, add/edit side game, record result)

### File List

- `apps/web/src/routes/admin/season.tsx` — replaced "Coming soon" stub with full season settings UI

### Code Review Fixes (code-review pass)

- M1: `EditSeasonPanel.handleSave()` now validates `name` and `playoffFormat` before building patch — shows specific field error instead of generic "Could not save"
- M2: `RecordResultRow` shows "No rounds for this season" placeholder in dropdown when `sortedRounds.length === 0`; Record button disabled when no rounds available
- L1: Removed `setTimeout(onClose, 1500)` — success state now shows a "Done" button instead of auto-closing after a timer; eliminates stale-state-setter risk on unmounted component
