# Story 7.2: Admin Rounds UI

Status: done

## Story

As an admin (Jason or Josh),
I want a web UI for managing league rounds,
so that I can create official and casual rounds, set entry codes, toggle auto-calculate money, and cancel rounds without touching the database directly.

## Acceptance Criteria

1. Navigating to `/admin/rounds` fetches both `GET /admin/seasons` and `GET /admin/rounds` in parallel; the page renders a rounds list (sorted most-recent first by `scheduledDate`) and a Create Round form.

2. The rounds list shows per round: scheduled date (formatted human-readable), Type badge (Official / Casual), Status badge (Scheduled / Active / Finalized / Cancelled), Auto-Money indicator (on / off). Cancelled and Finalized rounds are visually de-emphasized (muted text).

3. If the season list is empty (no seasons configured yet), the Create Round form is disabled and shows a message: "Create a season first (Season settings)."

4. The Create Round form fields: Season dropdown (populated from `GET /admin/seasons`, required), Type toggle (Official / Casual, required), Date (`<input type="date">`, required), Entry Code (text, required **only** when type=official — hidden for casual). Submitting calls `POST /admin/rounds` and the new round appears at the top of the list.

5. The Entry Code field is shown and required only when Type=official; it is hidden and not submitted for casual rounds.

6. Each round in the Scheduled or Active state has an Edit button that expands an inline panel for that round with fields: Date (`<input type="date">`), Headcount (`<input type="number">`), Entry Code (official rounds only), Auto-Calculate Money toggle (`<input type="checkbox">`). Saving calls `PATCH /admin/rounds/:id` with only changed fields. The panel closes on success.

7. The Auto-Calculate Money toggle within the edit panel sends `{ autoCalculateMoney: true | false }` to `PATCH /admin/rounds/:id`. The toggle updates in-place on success. Note: the API returns `autoCalculateMoney` as `0 | 1` (SQLite integer); display it as a boolean.

8. Each Scheduled or Active round has a Cancel button. Clicking shows a browser `confirm()` dialog. On confirm, calls `PATCH /admin/rounds/:id` with `{ status: 'cancelled' }`. The row updates in-place (status badge changes, Cancel button disappears, Edit button disappears).

9. Only one round row can be in edit mode at a time (same `editingId` pattern as `roster.tsx`).

10. Loading state: skeleton placeholder shown while initial data loads.

11. Error state: if initial load fails for any reason other than 401, show a retry button. If 401, redirect to `/admin/login`.

12. While any mutation is in-flight, its action button is disabled and shows a loading spinner. 401 from any mutation redirects to `/admin/login`.

13. `pnpm --filter @wolf-cup/web typecheck` passes with zero errors.

## Tasks / Subtasks

- [x] Task 1: Page skeleton + parallel data fetch (AC: #1, #10, #11)
  - [x] Replace "Coming soon" stub in `apps/web/src/routes/admin/rounds.tsx`
  - [x] `useQuery` for `GET /admin/seasons` with queryKey `['admin-seasons']`
  - [x] `useQuery` for `GET /admin/rounds` with queryKey `['admin-rounds']`; `retry: false` on both
  - [x] Render loading skeleton while either query is loading
  - [x] Render error state with retry button; 401 on either query redirects to `/admin/login`

- [x] Task 2: Rounds list table (AC: #2, #8)
  - [x] Table columns: Date, Type badge, Status badge, Auto-Money, Actions
  - [x] Cancelled/Finalized rows: muted text (opacity-60) + no Edit/Cancel buttons
  - [x] Cancel button on Scheduled/Active rows: `confirm()` → PATCH status=cancelled
  - [x] Status badge colors: Scheduled=blue, Active=green, Finalized=gray, Cancelled=muted

- [x] Task 3: Create Round form (AC: #3, #4, #5)
  - [x] Season `<select>` populated from `admin-seasons` query data
  - [x] If no seasons: show disabled form with "Create a season first" message
  - [x] Type selector: Official / Casual segmented button toggle
  - [x] Entry Code field: shown only when type=official; hidden for casual
  - [x] `useMutation` calling `POST /admin/rounds`; on success `invalidateQueries(['admin-rounds'])` + clear form
  - [x] Inline error on failure; button disabled + spinner while pending

- [x] Task 4: Inline edit panel per round row (AC: #6, #7, #9, #12)
  - [x] Edit button on Scheduled/Active rows opens inline panel (`editingId` state in RoundsTable)
  - [x] Fields: Date, Headcount (number), Entry Code (official only), Auto-Money checkbox
  - [x] Cancel closes without saving; Save calls `PATCH /admin/rounds/:id`
  - [x] `useMutation` for PATCH; on success invalidate `['admin-rounds']` + close panel
  - [x] Only one row in edit mode at a time; `editingId` state in the table component
  - [x] 401 on any mutation → redirect to `/admin/login`

- [x] Task 5: Verify quality gate (AC: #13)
  - [x] `pnpm --filter @wolf-cup/web typecheck` — zero errors

## Dev Notes

### File to Edit

**Only one file needs to be created/replaced:**
```
apps/web/src/routes/admin/rounds.tsx   ← replace the "Coming soon" stub
```

Do NOT edit `routeTree.gen.ts` — auto-generated. Do NOT create new component files — inline all subcomponents in `rounds.tsx`.

### API Endpoints

All under `/api/admin/` prefix (Vite dev proxies `/api` → `http://localhost:3000`):

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/admin/seasons` | — | `{ items: Season[] }` (200) |
| GET | `/admin/rounds` | — | `{ items: Round[] }` (200), sorted by scheduledDate DESC |
| POST | `/admin/rounds` | `{ seasonId, type, scheduledDate, entryCode? }` | `{ round: Round }` (201) |
| PATCH | `/admin/rounds/:id` | `{ status?, headcount?, entryCode?, scheduledDate?, autoCalculateMoney? }` | `{ round: Round }` (200) |

**Important PATCH constraints (from `updateRoundSchema`):**
- `status`: `'scheduled' | 'active' | 'finalized' | 'cancelled'`
- `headcount`: positive integer
- `entryCode`: string min 1
- `scheduledDate`: `YYYY-MM-DD` regex
- `autoCalculateMoney`: **boolean** (the schema expects `z.boolean()` — send `true`/`false`, not `1`/`0`)
- At least one field required (schema enforces this)

**No group-player list endpoint exists** — `GET /admin/rounds/:roundId/groups` returns only `{ id, roundId, groupNumber }` per group, not players. Group/player assignment is handled during live score entry; pre-assignment is outside this story's scope.

### Types

```typescript
type Season = {
  id: number;
  name: string;
  startDate: string;   // YYYY-MM-DD
  endDate: string;
  totalRounds: number;
  playoffFormat: string;
  harveyLiveEnabled: number;  // 0 | 1
  createdAt: number;
};

type Round = {
  id: number;
  seasonId: number;
  type: 'official' | 'casual';
  status: 'scheduled' | 'active' | 'finalized' | 'cancelled';
  scheduledDate: string;       // YYYY-MM-DD
  autoCalculateMoney: number;  // 0 | 1 (integer boolean from SQLite)
  headcount: number | null;
  createdAt: number;
  // NOTE: entryCodeHash is NOT returned (stripped by API)
};
```

`autoCalculateMoney` comes back from the API as `0` or `1` (SQLite integer). Convert with `round.autoCalculateMoney === 1` for display, send `true`/`false` in PATCH body.

### 401 Handling Pattern (from roster.tsx)

Both queries and all mutations should redirect on 401:
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

Add `retry: false` to both `useQuery` calls (prevents double 401 request before redirect — same fix applied in roster.tsx code review).

### Create Round Form Logic

Entry code visibility depends on selected type:
```tsx
const [roundType, setRoundType] = useState<'official' | 'casual'>('official');

// In form:
{roundType === 'official' && (
  <input type="text" placeholder="Entry Code *" ... />
)}
```

When submitting:
```typescript
addMutation.mutate({
  seasonId: Number(seasonId),
  type: roundType,
  scheduledDate,
  ...(roundType === 'official' && entryCode ? { entryCode } : {}),
});
```

### Date Formatting

`scheduledDate` from API is ISO `YYYY-MM-DD`. Format for display:
```typescript
function formatDate(iso: string): string {
  // Parse as local date to avoid UTC offset issues
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}
// e.g. "Fri, Mar 14, 2026"
```

For `<input type="date">` value, use the ISO string directly (`YYYY-MM-DD`).

### Status Badge Colors

```tsx
const STATUS_BADGE: Record<Round['status'], string> = {
  scheduled: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  active:    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  finalized: 'bg-muted text-muted-foreground',
  cancelled: 'bg-muted text-muted-foreground',
};
```

### Edit Panel: Build PATCH Body with Only Defined Changes

Avoid sending fields that weren't changed (respect schema's `.refine` requiring at least one):
```typescript
const patch: Record<string, unknown> = {};
if (date !== round.scheduledDate)     patch.scheduledDate = date;
if (headcount !== String(round.headcount ?? '')) patch.headcount = Number(headcount) || undefined;
if (entryCode)                        patch.entryCode = entryCode;
if (autoMoney !== (round.autoCalculateMoney === 1)) patch.autoCalculateMoney = autoMoney;

if (Object.keys(patch).length === 0) { onClose(); return; }
editMutation.mutate(patch);
```

### Cancel with Confirm

Use browser `window.confirm()` — no need for a custom dialog component:
```typescript
function handleCancel(round: Round) {
  if (!window.confirm(`Cancel round on ${formatDate(round.scheduledDate)}? This cannot be undone.`)) return;
  cancelMutation.mutate(round.id);
}
```

### Parallel Queries Pattern

Two independent `useQuery` calls — combined loading/error state:
```tsx
const seasonsQuery = useQuery({ queryKey: ['admin-seasons'], queryFn: () => apiFetch<{ items: Season[] }>('/admin/seasons'), retry: false });
const roundsQuery  = useQuery({ queryKey: ['admin-rounds'],  queryFn: () => apiFetch<{ items: Round[]  }>('/admin/rounds'),  retry: false });

const isLoading = seasonsQuery.isLoading || roundsQuery.isLoading;
const isError   = seasonsQuery.isError   || roundsQuery.isError;
const error     = seasonsQuery.error     ?? roundsQuery.error;
```

### Loading Skeleton (copy from roster.tsx)

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
// After POST /admin/rounds:
void queryClient.invalidateQueries({ queryKey: ['admin-rounds'] });

// After PATCH /admin/rounds/:id (edit or cancel):
void queryClient.invalidateQueries({ queryKey: ['admin-rounds'] });
```

No need to invalidate `['admin-seasons']` — rounds mutations don't affect seasons.

### Icons (Lucide — already installed)

- `CalendarDays` — round date icon
- `Pencil` — edit button
- `X` or `Ban` — cancel button
- `Loader2` with `animate-spin` — loading spinner
- `AlertCircle` — error state
- `RefreshCw` — retry button
- `Plus` — add/create button
- `Check` — auto-money enabled indicator
- `X` (also) — auto-money disabled indicator

### Headcount Field

`headcount` is nullable in the schema (`integer | null`). Initialize edit form field:
```typescript
const [headcount, setHeadcount] = useState(String(round.headcount ?? ''));
// On save, send only if non-empty: Number(headcount) || undefined
```

### References

- File to replace: `apps/web/src/routes/admin/rounds.tsx`
- Previous story pattern (auth, mutations, retry:false): `apps/web/src/routes/admin/roster.tsx`
- API implementation: `apps/api/src/routes/admin/rounds.ts`
- API schemas: `apps/api/src/schemas/round.ts`
- DB schema (rounds table): `apps/api/src/db/schema.ts:74–97`
- DB schema (seasons table): `apps/api/src/db/schema.ts:46–55`
- Season API: `apps/api/src/routes/admin/season.ts`
- apiFetch helper: `apps/web/src/lib/api.ts`
- queryClient: `apps/web/src/lib/query-client.ts`
- Button component: `apps/web/src/components/ui/button.tsx`
- Admin layout: `apps/web/src/routes/admin.tsx`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Single file implementation — all subcomponents inlined in `rounds.tsx`
- Parallel `useQuery` calls for seasons + rounds; combined `isLoading`/`isError` derived from both
- `noPropertyAccessFromIndexSignature` required bracket notation on `patch` Record in `EditRow.handleSave()`
- Segmented button toggle for Official/Casual type selection (no radio inputs needed)
- Entry code field conditionally shown in both create form and edit panel based on `round.type`
- Edit panel: only sends changed fields in PATCH body; closes immediately if nothing changed
- Cancel uses `window.confirm()` — no custom dialog component
- Auto-money displayed as Check/X icon in table; checkbox in edit panel
- 401 handling on all mutations (add, edit, cancel) + both useQuery errors

### Code Review Fixes (code-review pass)

- M1: `CreateRoundForm` received `isLoading` prop; `noSeasons = !isLoading && seasons.length === 0` — prevents "Create a season first" message from flashing during initial data load
- M2: Edit button in `RoundRow` gets `disabled={cancelMutation.isPending}` — prevents opening edit panel while cancel is in-flight
- L1: Replaced `<a href="/admin/season">` with TanStack Router `<Link to="/admin/season">` — avoids full-page reload

### File List

- `apps/web/src/routes/admin/rounds.tsx` — replaced "Coming soon" stub with full rounds management UI
