# Story 7.4: Admin Score Correction UI

Status: done

## Story

As an admin (Jason or Josh),
I want a web UI for post-round score corrections on finalized rounds,
so that I can fix gross scores, wolf decisions, and wolf partner assignments without touching the database directly, while maintaining an immutable audit trail.

## Acceptance Criteria

1. A nav card for "Score Corrections" is added to `/admin/` dashboard (`admin/index.tsx`), linking to `/admin/score-corrections`. It appears alongside Roster, Rounds, and Season cards.

2. Navigating to `/admin/score-corrections` fetches `GET /admin/rounds` and `GET /admin/players` in parallel. The page renders a round selector dropdown showing only finalized rounds (client-side filter). If no finalized rounds exist, the dropdown shows a disabled "No finalized rounds" option and the correction form is hidden.

3. Selecting a round from the dropdown fetches `GET /admin/rounds/:roundId/groups` and `GET /admin/rounds/:roundId/corrections` in parallel. Both results are used to populate the correction form and the audit log below it.

4. The correction form has these fields:
   - **Hole Number**: `<select>` with options 1–18, required.
   - **Field to Correct**: segmented button toggle — "Gross Score" | "Wolf Decision" | "Wolf Partner", required.
   - **Conditional fields** (shown based on field selection):
     - `grossScore`: Player select (all active non-guest players) + Gross Score number input (1–20).
     - `wolfDecision`: Group select (populated from groups query) + Decision select (alone / partner / blind_wolf).
     - `wolfPartnerId`: Group select (populated from groups query) + Partner select (all active non-guest players + a "None (clear partner)" option at top).
   - **Submit** button: disabled while pending, shows spinner.

5. Submitting calls `POST /admin/rounds/:roundId/corrections`. On success (201), the correction form resets (hole/field selects stay, conditionals reset), and the audit log refetches to show the new entry at the top. A brief inline success message "Correction recorded." appears.

6. Submission error handling: API returns 404 if the score/decision record doesn't exist for the given player/group/hole (e.g., admin picked wrong player). Display the error message inline below the form. 401 redirects to `/admin/login`.

7. The audit log below the form shows all corrections for the selected round, sorted most-recent first (`correctedAt DESC`). Each row displays: timestamp (formatted human-readable), hole number, field name, old value → new value. If no corrections exist, show "No corrections recorded for this round."

8. Loading state: skeleton placeholder shown while initial data loads (rounds + players). A secondary loading indicator is shown while the round-specific queries (groups + corrections) are in flight after selecting a round.

9. Error state: if initial load fails for any reason other than 401, show a retry button. If 401, redirect to `/admin/login`.

10. While the correction mutation is in-flight, the Submit button is disabled and shows a loading spinner. All field selects are also disabled.

11. `pnpm --filter @wolf-cup/web typecheck` passes with zero errors.

## Tasks / Subtasks

- [x] Task 1: Create route file + add nav card (AC: #1, #9, #10)
  - [x] Create `apps/web/src/routes/admin/score-corrections.tsx` with `createFileRoute('/admin/score-corrections')` export
  - [x] Add "Score Corrections" nav card to `admin/index.tsx` (import `FilePenLine` from lucide-react)
  - [x] Run `pnpm --filter @wolf-cup/web exec tsr generate` to regenerate `routeTree.gen.ts`
  - [x] Render loading skeleton while initial data loads; error state with retry button; 401 redirect

- [x] Task 2: Round selector + parallel initial data fetch (AC: #2, #8)
  - [x] `useQuery` for `GET /admin/rounds` with `queryKey: ['admin-rounds']`, `retry: false`
  - [x] `useQuery` for `GET /admin/players` with `queryKey: ['admin-players']`, `retry: false`
  - [x] Filter rounds client-side: `rounds.filter(r => r.status === 'finalized')`
  - [x] Round selector `<select>` sorted by `scheduledDate` DESC, formatted with `formatDate()`
  - [x] If no finalized rounds: show disabled "No finalized rounds" option, hide form below

- [x] Task 3: Round-specific data fetch on selection (AC: #3, #8)
  - [x] `selectedRoundId: number | null` state; `useQuery` for groups + corrections enabled when `selectedRoundId !== null`
  - [x] `useQuery` for `GET /admin/rounds/:roundId/groups` with `queryKey: ['admin-round-groups', roundId]`, `retry: false`, `enabled: !!selectedRoundId`
  - [x] `useQuery` for `GET /admin/rounds/:roundId/corrections` with `queryKey: ['admin-round-corrections', roundId]`, `retry: false`, `enabled: !!selectedRoundId`
  - [x] Show secondary loading indicator while either round-specific query loads

- [x] Task 4: Correction form (AC: #4, #5, #6, #10)
  - [x] Hole number `<select>` 1–18
  - [x] Field type segmented toggle: "Gross Score" | "Wolf Decision" | "Wolf Partner"
  - [x] Conditional rendering: grossScore shows player select (active non-guest) + score input; wolfDecision shows group select + decision select; wolfPartnerId shows group select + partner select
  - [x] Player select: filter `players.filter(p => p.isActive === 1 && p.isGuest === 0)`
  - [x] Partner select: "None (clear partner)" option with value `"null"` at top, then active non-guest players
  - [x] `useMutation` calling `POST /admin/rounds/${roundId}/corrections`
  - [x] On success (201): invalidate `['admin-round-corrections', roundId]`, reset conditional field state, show inline "Correction recorded." message
  - [x] On error: show inline error message; 401 redirects to `/admin/login`
  - [x] All inputs disabled while mutation pending

- [x] Task 5: Audit log (AC: #7)
  - [x] Table or list below form showing corrections for selected round
  - [x] Columns: Timestamp, Hole, Field, Old Value, New Value
  - [x] Formatted timestamp: `new Date(correctedAt).toLocaleString('en-US', { ... })`
  - [x] Empty state: "No corrections recorded for this round."

- [x] Task 6: Verify quality gate (AC: #11)
  - [x] `pnpm --filter @wolf-cup/web typecheck` — zero errors

## Dev Notes

### Files to Create / Edit

```
apps/web/src/routes/admin/score-corrections.tsx   ← CREATE (new file, no stub exists)
apps/web/src/routes/admin/index.tsx               ← EDIT (add nav card)
apps/web/src/routeTree.gen.ts                     ← auto-regenerated (DO NOT edit manually)
```

Run after creating the new route file:
```bash
pnpm --filter @wolf-cup/web exec tsr generate
```

Do NOT create new component files — inline all subcomponents in `score-corrections.tsx`.

### API Endpoints

All under `/api/admin/` prefix (Vite dev proxies `/api` → `http://localhost:3000`):

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/admin/rounds` | — | `{ items: Round[] }` (200) |
| GET | `/admin/players` | — | `{ items: Player[] }` (200) |
| GET | `/admin/rounds/:roundId/groups` | — | `{ items: Group[] }` (200) |
| GET | `/admin/rounds/:roundId/corrections` | — | `{ items: ScoreCorrection[] }` (200, sorted correctedAt DESC) |
| POST | `/admin/rounds/:roundId/corrections` | see below | `{ correction: ScoreCorrection }` (201) |

**POST body** (`createScoreCorrectionSchema`):
```typescript
{
  holeNumber: number;           // 1–18
  fieldName: 'grossScore' | 'wolfDecision' | 'wolfPartnerId';
  playerId?: number;            // required when fieldName === 'grossScore'
  groupId?: number;             // required when fieldName === 'wolfDecision' | 'wolfPartnerId'
  newValue: string;             // always a string:
                                //   grossScore: "1"–"20"
                                //   wolfDecision: "alone" | "partner" | "blind_wolf"
                                //   wolfPartnerId: stringified positive int or "null"
}
```

**API error codes to handle**:
- `422 ROUND_NOT_FINALIZED` — round isn't finalized (shouldn't happen since we filter client-side, but handle gracefully)
- `404 NOT_FOUND` — no score/decision record found for given player/group/hole
- `400 VALIDATION_ERROR` — invalid newValue (e.g., score out of 1–20 range)
- `401 UNAUTHORIZED` — redirect to `/admin/login`

### Types

```typescript
type Round = {
  id: number;
  seasonId: number;
  type: 'official' | 'casual';
  status: 'scheduled' | 'active' | 'finalized' | 'cancelled';
  scheduledDate: string;        // YYYY-MM-DD
  autoCalculateMoney: number;   // 0 | 1
  headcount: number | null;
  createdAt: number;
};

type Player = {
  id: number;
  name: string;
  ghinNumber: string | null;
  isActive: number;   // 0 | 1
  isGuest: number;    // 0 | 1
  createdAt: number;
};

type Group = {
  id: number;
  roundId: number;
  groupNumber: number;
};

type ScoreCorrection = {
  id: number;
  adminUserId: number;
  roundId: number;
  holeNumber: number;
  playerId: number | null;      // null for wolfDecision / wolfPartnerId
  fieldName: string;            // 'grossScore' | 'wolfDecision' | 'wolfPartnerId'
  oldValue: string;
  newValue: string;
  correctedAt: number;          // Unix ms timestamp
};
```

### Route File Boilerplate

```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/score-corrections')({
  component: ScoreCorrectionsPage,
});
```

### Nav Card Addition (admin/index.tsx)

Add a fourth card to `NAV_CARDS`:
```tsx
import { Users, CalendarDays, Trophy, FilePenLine } from 'lucide-react';

{
  to: '/admin/score-corrections' as const,
  icon: FilePenLine,
  title: 'Score Corrections',
  description: 'Edit finalized round scores with full audit trail',
},
```

Note: TypeScript `as const` on `to` is required for TanStack Router's type inference.

### 401 Handling Pattern (from roster.tsx)

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

### Parallel Initial Queries Pattern

```tsx
const roundsQuery = useQuery({
  queryKey: ['admin-rounds'],
  queryFn: () => apiFetch<{ items: Round[] }>('/admin/rounds'),
  retry: false,
});
const playersQuery = useQuery({
  queryKey: ['admin-players'],
  queryFn: () => apiFetch<{ items: Player[] }>('/admin/players'),
  retry: false,
});

const isLoading = roundsQuery.isLoading || playersQuery.isLoading;
const isError   = roundsQuery.isError   || playersQuery.isError;
const error     = roundsQuery.error     ?? playersQuery.error;
```

### Round-Specific Conditional Queries

```tsx
const [selectedRoundId, setSelectedRoundId] = useState<number | null>(null);

const groupsQuery = useQuery({
  queryKey: ['admin-round-groups', selectedRoundId],
  queryFn: () => apiFetch<{ items: Group[] }>(`/admin/rounds/${selectedRoundId}/groups`),
  enabled: selectedRoundId !== null,
  retry: false,
});
const correctionsQuery = useQuery({
  queryKey: ['admin-round-corrections', selectedRoundId],
  queryFn: () => apiFetch<{ items: ScoreCorrection[] }>(`/admin/rounds/${selectedRoundId}/corrections`),
  enabled: selectedRoundId !== null,
  retry: false,
});
```

### Correction Form State

```tsx
const [holeNumber, setHoleNumber] = useState<number>(1);
const [fieldName, setFieldName] = useState<'grossScore' | 'wolfDecision' | 'wolfPartnerId'>('grossScore');
const [playerId, setPlayerId] = useState<string>('');         // string for select value
const [grossScore, setGrossScore] = useState<string>('');
const [groupId, setGroupId] = useState<string>('');
const [wolfDecision, setWolfDecision] = useState<string>('alone');
const [wolfPartnerId, setWolfPartnerId] = useState<string>('null');
const [successMsg, setSuccessMsg] = useState('');
const [submitError, setSubmitError] = useState('');
```

### Mutation Body Construction

```tsx
const addMutation = useMutation({
  mutationFn: (body: Record<string, unknown>) =>
    apiFetch<{ correction: ScoreCorrection }>(
      `/admin/rounds/${selectedRoundId}/corrections`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-round-corrections', selectedRoundId] });
    // Reset conditional fields only (keep hole + fieldName)
    setPlayerId('');
    setGrossScore('');
    setGroupId('');
    setWolfDecision('alone');
    setWolfPartnerId('null');
    setSubmitError('');
    setSuccessMsg('Correction recorded.');
  },
  onError: (err: Error) => {
    if (err.message === 'UNAUTHORIZED') { void navigate({ to: '/admin/login' }); return; }
    setSubmitError(err.message || 'Failed to save correction.');
    setSuccessMsg('');
  },
});

function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  setSubmitError('');
  setSuccessMsg('');
  const body: Record<string, unknown> = {
    holeNumber,
    fieldName,
  };
  if (fieldName === 'grossScore') {
    if (!playerId || !grossScore) { setSubmitError('Player and score are required.'); return; }
    body['playerId'] = Number(playerId);
    body['newValue'] = grossScore;
  } else if (fieldName === 'wolfDecision') {
    if (!groupId) { setSubmitError('Group is required.'); return; }
    body['groupId'] = Number(groupId);
    body['newValue'] = wolfDecision;
  } else {
    // wolfPartnerId
    if (!groupId) { setSubmitError('Group is required.'); return; }
    body['groupId'] = Number(groupId);
    body['newValue'] = wolfPartnerId;
  }
  addMutation.mutate(body);
}
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

### Timestamp Formatting (Audit Log)

```typescript
function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}
```

### Field Name Display

```typescript
const FIELD_LABELS: Record<string, string> = {
  grossScore:    'Gross Score',
  wolfDecision:  'Wolf Decision',
  wolfPartnerId: 'Wolf Partner',
};
```

### Loading Skeleton (same pattern as roster.tsx)

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

### Player Filtering

Active non-guest players only (for both grossScore and wolfPartnerId selects):
```typescript
const activePlayers = players.filter(p => p.isActive === 1 && p.isGuest === 0);
```

### Icons (Lucide — already installed)

- `FilePenLine` — nav card icon
- `Loader2` with `animate-spin` — loading spinner
- `AlertCircle` — error state
- `RefreshCw` — retry button
- `CheckCircle2` — success indicator
- `ClipboardList` — audit log heading icon

### TypeScript Notes

- Use bracket notation on `body` (`body['playerId']`, not `body.playerId`) to satisfy `noPropertyAccessFromIndexSignature`.
- `enabled: selectedRoundId !== null` — TypeScript may warn if `selectedRoundId` is typed as `number | null` and used in the queryFn template literal; use `selectedRoundId!` inside the queryFn (safe because enabled guards it).
- All `as const` on TanStack Router `to` props.

### References

- New file to create: `apps/web/src/routes/admin/score-corrections.tsx`
- File to edit: `apps/web/src/routes/admin/index.tsx`
- API implementation: `apps/api/src/routes/admin/score-corrections.ts`
- API schemas: `apps/api/src/schemas/score-correction.ts`
- Groups endpoint: `apps/api/src/routes/admin/rounds.ts` (GET /rounds/:roundId/groups)
- DB schema: `apps/api/src/db/schema.ts` (scoreCorrections table lines 317–337)
- Previous story pattern (auth, mutations, retry:false): `apps/web/src/routes/admin/roster.tsx`
- apiFetch helper: `apps/web/src/lib/api.ts`
- queryClient: `apps/web/src/lib/query-client.ts`
- Admin layout: `apps/web/src/routes/admin.tsx`
- Admin dashboard (to edit): `apps/web/src/routes/admin/index.tsx`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Two-file implementation: new `score-corrections.tsx` + nav card edit to `admin/index.tsx`
- Parallel initial queries: `['admin-rounds']` + `['admin-players']`; combined `isLoading`/`isError`; 401 on either redirects to `/admin/login`
- Client-side filter `status === 'finalized'` on rounds list; "No finalized rounds" shown when empty
- Round-specific conditional queries (`enabled: true` once `RoundSection` mounts, keyed by `roundId`): groups + corrections
- `CorrectionForm` segmented toggle switches between three field types; conditional rendering shows appropriate inputs per type
- `body['key']` bracket notation used throughout (satisfies `noPropertyAccessFromIndexSignature`)
- Error messages mapped: `NOT_FOUND` → player/group/hole not found explanation; `VALIDATION_ERROR` → invalid value; fallback generic
- On success: conditional field states reset, audit log invalidated (`['admin-round-corrections', roundId]`), success message shown inline
- `AuditLog`: table with Timestamp / Hole / Field / Change columns; `formatTimestamp()` for human-readable dates; empty state message
- `routeTree.gen.ts` regenerated via `npx tsr generate` from `apps/web` directory
- `pnpm --filter @wolf-cup/web typecheck` passes with zero errors

### Code Review Fixes (code-review pass)

- M1: Added `key={selectedRoundId}` to `<RoundSection>` — forces remount on round change, preventing stale form state (holeNumber, playerId, groupId, etc.) from leaking across round selections
- M2: Non-401 errors from `groupsQuery`/`correctionsQuery` now surface inline: groups error shows a message in place of the form; corrections error shows a message in place of the audit log
- L1: `handleSubmit` now validates gross score range (`Number.isInteger && ≥1 && ≤20`) before submit, showing "Gross score must be a whole number between 1 and 20." instead of a generic API error

### File List

- `apps/web/src/routes/admin/score-corrections.tsx` — new file: full score corrections UI
- `apps/web/src/routes/admin/index.tsx` — added Score Corrections nav card
- `apps/web/src/routeTree.gen.ts` — auto-regenerated (new `/admin/score-corrections` route)
