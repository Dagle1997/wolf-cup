# Story 7.1: Admin Roster UI

Status: done

## Story

As an admin (Jason or Josh),
I want a web UI for managing the league player roster,
so that I can add new players, edit names/GHIN numbers, and deactivate players without touching the database directly.

## Acceptance Criteria

1. Navigating to `/admin/roster` shows a list of all non-guest league players fetched from `GET /admin/players`, with columns: Name, GHIN #, Status (Active/Inactive).

2. Inactive players (`isActive === 0`) are shown in the list but visually de-emphasized (muted/grayed text or an "Inactive" badge) — they are never hidden.

3. Guest players (`isGuest === 1`) are filtered out of the list entirely (guests are round-only, not roster members).

4. An "Add Player" form is visible at the top of the page. Fields: Name (required), GHIN # (optional text). Submitting calls `POST /admin/players` and the new player appears in the list immediately without a full reload.

5. Each player row has an Edit button. Clicking it expands an inline form pre-filled with the player's current name and GHIN #. Saving calls `PATCH /admin/players/:id` and updates the row in-place.

6. Each player row has a Deactivate / Reactivate toggle button (based on current `isActive`). Clicking calls `PATCH /admin/players/:id` with `{ isActive: 0 }` or `{ isActive: 1 }`. The row updates in-place.

7. While any mutation is in-flight, its action button is disabled and shows a loading indicator to prevent double-submit.

8. If the API returns a 401 (unauthenticated — `apiFetch` throws with message `'UNAUTHORIZED'`), the page redirects to `/admin/login`.

9. Loading state: a skeleton placeholder is shown while the initial player list loads.

10. Error state: if the initial load fails for any reason other than 401, a retry button is shown.

11. `pnpm --filter @wolf-cup/web typecheck` passes with zero errors.

## Tasks / Subtasks

- [x] Task 1: Replace roster stub with full component skeleton (AC: #1, #9, #10)
  - [x] Replace "Coming soon" stub in `apps/web/src/routes/admin/roster.tsx`
  - [x] Add `useQuery` to fetch `GET /admin/players` with queryKey `['admin-roster']`
  - [x] Filter out `isGuest === 1` players client-side
  - [x] Render loading skeleton (same pattern as `standings.tsx`)
  - [x] Render error state with retry button + 401 redirect to `/admin/login`

- [x] Task 2: Render player list table (AC: #1, #2, #3)
  - [x] Table columns: Name, GHIN #, Status badge
  - [x] Inactive rows: render name/GHIN in muted text + "Inactive" badge
  - [x] Active rows: full-contrast text + "Active" badge (or no badge — just muted for inactive)

- [x] Task 3: Add Player form (AC: #4, #7)
  - [x] Form above table: Name input (required), GHIN # input (optional), Add button
  - [x] `useMutation` calling `POST /admin/players`
  - [x] On success: `queryClient.invalidateQueries({ queryKey: ['admin-roster'] })` + clear form
  - [x] On error: show inline error message below form
  - [x] Button disabled + spinner while mutation pending

- [x] Task 4: Inline edit form per row (AC: #5, #7)
  - [x] Each row has an Edit button (pencil icon or "Edit" text)
  - [x] Clicking Edit shows an expanded inline form with Name and GHIN # inputs pre-filled
  - [x] Cancel button closes the form without saving; Save button calls `PATCH /admin/players/:id`
  - [x] `useMutation` calling `PATCH /admin/players/:id` with `{ name, ghinNumber }`
  - [x] On success: `queryClient.invalidateQueries({ queryKey: ['admin-roster'] })` + close form
  - [x] Only one row can be in edit mode at a time (tracking by `editingId` state)

- [x] Task 5: Deactivate/Reactivate toggle (AC: #6, #7)
  - [x] Each row has a Deactivate button (active players) or Reactivate button (inactive players)
  - [x] Calls `PATCH /admin/players/:id` with `{ isActive: 0 }` or `{ isActive: 1 }`
  - [x] `useMutation` with `onSuccess` calling `queryClient.invalidateQueries`
  - [x] Button disabled while any mutation for that player is pending

- [x] Task 6: Verify quality gate (AC: #11)
  - [x] `pnpm --filter @wolf-cup/web typecheck` — zero errors

## Dev Notes

### File to Edit

**Only one file needs to be created/replaced:**
```
apps/web/src/routes/admin/roster.tsx   ← replace the "Coming soon" stub
```

No new routes, no route tree changes, no new components directory — the existing `routeTree.gen.ts` already has `/admin/roster` registered. TanStack Router auto-generates the route tree; do NOT edit `routeTree.gen.ts` manually.

### Admin Auth Middleware

All `/api/admin/*` routes require session cookie auth (set by `POST /admin/login`). The cookie is `HttpOnly` and sent automatically on same-origin requests. The `apiFetch` helper sends requests to `/api${path}` — no auth headers needed.

If the user is not logged in, `GET /admin/players` returns 401 and `apiFetch` throws with `err.message === 'UNAUTHORIZED'`. Handle this in the `useQuery` error:

```tsx
const navigate = useNavigate();

const { data, isLoading, isError, error, refetch } = useQuery({
  queryKey: ['admin-roster'],
  queryFn: () => apiFetch<{ items: Player[] }>('/admin/players'),
});

// In render:
if (isError) {
  if ((error as Error).message === 'UNAUTHORIZED') {
    void navigate({ to: '/admin/login' });
    return null;
  }
  // ... show retry UI
}
```

### API Endpoints

All under `/api/admin/` prefix (Vite proxies `/api` → `http://localhost:3000`):

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/admin/players` | — | `{ items: Player[] }` |
| POST | `/admin/players` | `{ name: string; ghinNumber?: string }` | `{ player: Player }` (201) |
| PATCH | `/admin/players/:id` | `{ name?: string; ghinNumber?: string \| null; isActive?: 0 \| 1 }` | `{ player: Player }` (200) |

The `GET /admin/players` response includes guests (`isGuest: 1`). Filter them out on the client:
```typescript
const rosterPlayers = (data?.items ?? []).filter((p) => p.isGuest === 0);
```

### Player Type

```typescript
type Player = {
  id: number;
  name: string;
  ghinNumber: string | null;
  isActive: number;  // 1 = active, 0 = inactive (SQLite integer boolean)
  isGuest: number;   // filter out: 1 = guest, 0 = roster member
  createdAt: number;
};
```

### Data Fetching Pattern (from `standings.tsx`)

```typescript
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { queryClient } from '@/lib/query-client';

const { data, isLoading, isError, error, refetch } = useQuery({
  queryKey: ['admin-roster'],
  queryFn: () => apiFetch<{ items: Player[] }>('/admin/players'),
});
```

### Mutation Pattern (from `ball-draw.tsx`)

```typescript
const addMutation = useMutation({
  mutationFn: (body: { name: string; ghinNumber?: string }) =>
    apiFetch<{ player: Player }>('/admin/players', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-roster'] });
    setName('');
    setGhin('');
  },
  onError: (err: Error) => {
    setAddError(err.message === 'VALIDATION_ERROR' ? 'Name is required.' : 'Could not add player — try again.');
  },
});
```

For the PATCH mutations (edit + deactivate), keep them as two separate `useMutation` instances or use a single generic one. The simplest approach: one `updateMutation` for edit (name/ghin) and one `toggleMutation` for isActive — or combine into a single `patchMutation` that accepts `{ id, patch }`.

### Table Pattern (from `standings.tsx`)

```tsx
<div className="rounded-md border overflow-hidden">
  <table className="w-full text-sm">
    <thead>
      <tr className="border-b bg-muted/50">
        <th className="py-2 px-3 text-left font-medium text-muted-foreground">Name</th>
        <th className="py-2 px-3 text-left font-medium text-muted-foreground">GHIN #</th>
        <th className="py-2 px-3 text-left font-medium text-muted-foreground">Status</th>
        <th className="py-2 px-3" />
      </tr>
    </thead>
    <tbody>
      {rosterPlayers.map((p) => (
        <PlayerRow key={p.id} player={p} />
      ))}
    </tbody>
  </table>
</div>
```

### Loading Skeleton (from `standings.tsx` — copy the same pattern)

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

### Button Component

Available at `@/components/ui/button` with variants: `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`. Sizes: `default`, `sm`, `lg`, `icon`.

Use `variant="outline" size="sm"` for Edit/Deactivate row actions to keep them visually lightweight.

### Lucide Icons

Lucide is already installed. Use:
- `Pencil` — edit button
- `UserX` / `UserCheck` — deactivate / reactivate
- `Plus` — add player
- `Loader2` with `animate-spin` — loading spinner on buttons
- `AlertCircle` — error state (matches standings.tsx)
- `RefreshCw` — retry/refresh button

### Single Edit at a Time

Track the currently-editing player by ID:

```typescript
const [editingId, setEditingId] = useState<number | null>(null);
```

When a row is in edit mode, render inputs instead of static text. Clicking Edit on another row (or Cancel) resets `editingId`. This prevents concurrent edits.

### Deactivate/Reactivate Button State

Track which player id currently has a pending toggle to disable its button:

```typescript
const [togglingId, setTogglingId] = useState<number | null>(null);

const toggleMutation = useMutation({
  mutationFn: ({ id, isActive }: { id: number; isActive: 0 | 1 }) =>
    apiFetch<{ player: Player }>(`/admin/players/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),
  onMutate: ({ id }) => setTogglingId(id),
  onSettled: () => setTogglingId(null),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-roster'] }),
});
```

### Project Structure Notes

- Edit `apps/web/src/routes/admin/roster.tsx` — **do not create new files**
- Do NOT edit `routeTree.gen.ts` — auto-generated by TanStack Router plugin
- Do NOT add components to `apps/web/src/components/` — inline all subcomponents in roster.tsx
- `apiFetch` is at `@/lib/api` (alias `@` = `apps/web/src/`)
- `queryClient` is at `@/lib/query-client`
- Admin layout (`apps/web/src/routes/admin.tsx`) already renders the amber "Admin Panel" header + `<Outlet />`

### References

- Existing roster stub: `apps/web/src/routes/admin/roster.tsx`
- Data fetch pattern: `apps/web/src/routes/standings.tsx`
- Mutation pattern: `apps/web/src/routes/ball-draw.tsx:147–197`
- API client: `apps/web/src/lib/api.ts`
- Query client: `apps/web/src/lib/query-client.ts`
- Button component: `apps/web/src/components/ui/button.tsx`
- API implementation: `apps/api/src/routes/admin/roster.ts`
- DB schema (players table): `apps/api/src/db/schema.ts:58–75`
- Admin layout: `apps/web/src/routes/admin.tsx`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Single file implementation — all subcomponents inlined in `roster.tsx` per story constraint
- `EditRow` renders a full-width `colSpan={4}` inline form; single edit tracked by `editingId` state
- `togglingId` pattern with `onMutate`/`onSettled` gives per-row toggle loading state without extra state management
- `ghinNumber: string | null` passed correctly to PATCH body (empty string → null)
- 401 redirect handled in render (navigate + return null), not in useQuery's onError

### File List

- `apps/web/src/routes/admin/roster.tsx` — replaced "Coming soon" stub with full roster management UI

### Code Review Fixes (code-review pass)

- M1: Added `retry: false` to `useQuery` — prevents spurious second 401 request before login redirect
- M2: Marked all task checkboxes `[x]` — story file was never updated during implementation
- L1: Added 401 redirect (`void navigate({ to: '/admin/login' })`) to `onError` of all three mutations (add, edit, toggle)
- L2: Added `aria-label` to Edit and Deactivate/Reactivate buttons for mobile accessibility
- L3: Name input `onChange` clears `addError` immediately so stale validation message doesn't linger
- L4: Edit button now `disabled={isToggling}` to prevent opening edit form while toggle is in-flight
