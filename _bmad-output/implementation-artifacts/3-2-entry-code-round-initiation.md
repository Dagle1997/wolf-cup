# Story 3.2: Entry Code & Round Initiation

Status: done

## Story

As a scorer,
I want to select and join an available round (entering the weekly entry code for official rounds),
so that I can begin recording hole-by-hole scores for my group.

## Acceptance Criteria

### Public API — Round Listing

1. `GET /api/rounds` returns a JSON array of rounds with status `scheduled` or `active`, scheduled within a ±1-day window of today, ordered by `scheduledDate` descending. Response shape: `{ items: Round[] }` where `Round` = `{ id, type, status, scheduledDate, autoCalculateMoney }`. `entryCodeHash` is **never** included.

2. `GET /api/rounds/:id` returns a single round with its groups and each group's player list. Response shape:
   ```json
   {
     "round": {
       "id": 1,
       "type": "official",
       "status": "scheduled",
       "scheduledDate": "2026-06-06",
       "autoCalculateMoney": true,
       "groups": [
         {
           "id": 10,
           "groupNumber": 1,
           "battingOrder": null,
           "players": [{ "id": 1, "name": "Josh Stoll", "handicapIndex": 14.2 }]
         }
       ]
     }
   }
   ```
   Returns 404 `NOT_FOUND` if round does not exist.

### Public API — Round Initiation

3. `POST /api/rounds/:id/start` on a **casual** round with any (or no) entry code returns 200 with the round detail (same shape as AC#2), regardless of code. No header required.

4. `POST /api/rounds/:id/start` on an **official** round with a **valid** `x-entry-code` header returns 200 with round detail and transitions round status to `active` (if previously `scheduled`).

5. `POST /api/rounds/:id/start` on an **official** round with a **missing or invalid** `x-entry-code` header returns 403 `INVALID_ENTRY_CODE`.

6. `POST /api/rounds/:id/start` on an **already-active** official round with a valid code returns 200 (idempotent — does not error; round stays `active`).

7. `POST /api/rounds/:id/start` on a **cancelled** or **finalized** round returns 422 `ROUND_NOT_JOINABLE` regardless of code.

8. `POST /api/rounds/:id/start` on a non-existent round returns 404 `NOT_FOUND`.

### Web — Score Entry Initiation UI

9. The `/score-entry` page (replacing the stub) fetches available rounds via `GET /api/rounds` on mount. While loading, shows a skeleton card. If no rounds are available, shows "No rounds available today" with a muted message.

10. Each available round is shown as a card with: round date, type badge (Official / Casual), status badge (Scheduled / Active), and a "Join" button.

11. Clicking "Join" on a **casual round** calls `POST /api/rounds/:id/start` with no entry code header and, on success, stores `{ roundId, entryCode: null }` in `sessionStorage` under key `wolf-cup:session` then renders a confirmation view: "Joined casual round — ready to begin" with a "Start Ball Draw" placeholder button (disabled, tooltip "Coming next story").

12. Clicking "Join" on an **official round** opens an inline code-entry form with a text input labeled "Weekly Entry Code" and a "Submit" button. Submitting calls `POST /api/rounds/:id/start` with `x-entry-code: <entered code>`. On success: stores `{ roundId, entryCode: <plaintext code> }` in `sessionStorage` under key `wolf-cup:session`, renders confirmation view (same as AC#11 but says "Official round joined").

13. On 403 `INVALID_ENTRY_CODE`, shows inline error "Invalid entry code — please try again." Entry code input is cleared. The form stays visible for retry.

14. On 422 `ROUND_NOT_JOINABLE`, shows "This round is no longer joinable."

15. If `sessionStorage` already contains `wolf-cup:session` with a matching `roundId` for an available round, the initiation flow is skipped and the confirmation view is shown immediately (prevents re-entry after page refresh mid-round).

16. The "Join" / "Submit" button shows a loading spinner and is disabled during the in-flight API call.

### Quality

17. `pnpm --filter @wolf-cup/api test` passes with new tests covering:
    - `GET /api/rounds` returns only scheduled/active rounds in date window
    - `GET /api/rounds/:id` returns round with groups and players
    - `POST /api/rounds/:id/start` happy-path: casual (no code), official (valid code) → 200, status → active
    - `POST /api/rounds/:id/start` official, missing/wrong code → 403
    - `POST /api/rounds/:id/start` finalized round → 422
    - `POST /api/rounds/:id/start` already-active official + valid code → 200 (idempotent)

18. `pnpm --filter @wolf-cup/api typecheck` passes.

19. `pnpm --filter @wolf-cup/web typecheck` passes (includes route tree regeneration).

20. `pnpm --filter @wolf-cup/web lint` passes.

## Tasks / Subtasks

- [x] Task 1: Create public rounds API routes (AC: #1–8, #17–18)
  - [x] Create `apps/api/src/routes/rounds.ts` with `GET /rounds`, `GET /rounds/:id`, `POST /rounds/:id/start`
  - [x] Mount in `apps/api/src/index.ts` as `app.route('/api', publicRoundsRouter)`
  - [x] Add Zod round schemas to `apps/api/src/schemas/round.ts` if needed (none required for this story since no request body)
  - [x] Create `apps/api/src/routes/rounds.test.ts` with in-memory SQLite tests

- [x] Task 2: Build score-entry UI (AC: #9–16, #19–20)
  - [x] Replace `apps/web/src/routes/score-entry.tsx` stub with full initiation component
  - [x] Create `apps/web/src/lib/session-store.ts` — typed get/set/clear for `wolf-cup:session` in sessionStorage
  - [x] Use TanStack Query `useQuery(['rounds', 'available'])` with `queryFn: () => apiFetch<RoundsResponse>('/rounds')`
  - [x] Implement round selection UI, code-entry form, confirmation view

## Dev Notes

### Critical: Do NOT confuse public rounds routes with admin rounds routes

| File | Auth | Routes |
|------|------|--------|
| `apps/api/src/routes/admin/rounds.ts` | `adminAuthMiddleware` | `/api/admin/rounds` — admin CRUD |
| `apps/api/src/routes/rounds.ts` (NEW) | None / inline code check | `/api/rounds` — public read + scorer initiation |

These are separate files. The public file is what this story creates. The admin file already exists and must not be modified.

### API — `GET /api/rounds` date window

Filter rounds where `scheduledDate >= today - 1` AND `scheduledDate <= today + 1` (±1 day buffer) AND `status IN ('scheduled', 'active')`. Use `new Date().toISOString().slice(0, 10)` to get today's YYYY-MM-DD. Compute window with simple string arithmetic or `Date` manipulation.

```typescript
import { and, gte, lte, inArray } from 'drizzle-orm';
// ...
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const rows = await db
  .select({ id: rounds.id, type: rounds.type, status: rounds.status,
            scheduledDate: rounds.scheduledDate, autoCalculateMoney: rounds.autoCalculateMoney })
  .from(rounds)
  .where(
    and(
      gte(rounds.scheduledDate, yesterday),
      lte(rounds.scheduledDate, tomorrow),
      inArray(rounds.status, ['scheduled', 'active'])
    )
  )
  .orderBy(desc(rounds.scheduledDate));
```

Never return `entryCodeHash` from any public route.

### API — `GET /api/rounds/:id` with groups + players

Join `groups` and `round_players` + `players` tables. Build a nested structure: round → groups[] → players[]. Use multiple queries rather than a complex join for clarity:

```typescript
// 1. Get round (no entryCodeHash)
// 2. Get groups for round
// 3. Get round_players + player info for this round
// 4. Assemble: group.players = players where groupId matches
```

Response field `autoCalculateMoney` should be boolean (`true`/`false`), not integer 0/1. Apply `Boolean(row.autoCalculateMoney)` before responding.

### API — `POST /api/rounds/:id/start` — Entry Code Validation

**Do NOT use `entryCodeMiddleware` directly** on this route. The middleware reads `roundId` from `?roundId=` query param, but here `roundId` is a path parameter. Instead, **inline the same validation logic**:

```typescript
app.post('/rounds/:id/start', async (c) => {
  const id = Number(c.req.param('id'));
  // ... validate id is integer > 0 ...
  const round = await db.select({ ... }).from(rounds).where(eq(rounds.id, id)).get();
  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  if (round.status === 'finalized' || round.status === 'cancelled') {
    return c.json({ error: 'Round not joinable', code: 'ROUND_NOT_JOINABLE' }, 422);
  }
  // Casual rounds bypass code check (FR25)
  if (round.type !== 'official') {
    // Return round detail (fetch full with groups, see below)
    return c.json({ round: await getRoundDetail(id) }, 200);
  }
  // Official round: validate entry code
  const providedCode = c.req.header('x-entry-code');
  if (!providedCode || !round.entryCodeHash) {
    return c.json({ error: 'Invalid entry code', code: 'INVALID_ENTRY_CODE' }, 403);
  }
  const valid = await bcrypt.compare(providedCode, round.entryCodeHash);
  if (!valid) return c.json({ error: 'Invalid entry code', code: 'INVALID_ENTRY_CODE' }, 403);
  // Transition scheduled → active (idempotent: already-active is fine)
  if (round.status === 'scheduled') {
    await db.update(rounds).set({ status: 'active' }).where(eq(rounds.id, id));
  }
  return c.json({ round: await getRoundDetail(id) }, 200);
});
```

Extract a helper `getRoundDetail(roundId: number)` to avoid duplicating the join logic between GET and POST routes.

### API — DB import

```typescript
import { db } from '../../db/index.js';
import { rounds, groups, roundPlayers, players } from '../../db/schema.js';
import { eq, and, gte, lte, inArray, desc } from 'drizzle-orm';
import bcrypt from 'bcrypt';
```

Note: `@libsql/client` (not `better-sqlite3`) is the actual SQLite driver. MEMORY.md has a stale note — the actual package.json uses `@libsql/client ^0.17.0`.

### API — Test pattern (in-memory SQLite)

Tests use `vi.mock('../../db/index.js')` with `@libsql/client` in-memory SQLite + full migrations. Copy the pattern from `apps/api/src/routes/admin/auth.test.ts`:

```typescript
vi.mock('../../db/index.js', async () => {
  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../../db/schema.js');
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client, { schema });
  return { db };
});

import roundsApp from './rounds.js';
import { db } from '../../db/index.js';
import { rounds, seasons } from '../../db/schema.js';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, '../../db/migrations');

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
  // Insert test season
  await db.insert(seasons).values({ name: '2026', startDate: '2026-06-01', endDate: '2026-10-31',
    totalRounds: 15, playoffFormat: 'top-8', harveyLiveEnabled: 0, createdAt: Date.now() });
});
```

The `roundsApp` is tested in isolation (not via the full `app` from `index.ts`), same as `authApp` in auth tests.

vitest version in `apps/api` is `^3.0.0` (NOT 2.x as used in the engine package).

### Web — TanStack Query key and `apiFetch`

```typescript
// apps/web/src/routes/score-entry.tsx
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

type Round = {
  id: number; type: 'official' | 'casual'; status: string;
  scheduledDate: string; autoCalculateMoney: boolean;
};
type RoundsResponse = { items: Round[] };

const { data, isLoading } = useQuery({
  queryKey: ['rounds', 'available'],
  queryFn: () => apiFetch<RoundsResponse>('/rounds'),
});

const startMutation = useMutation({
  mutationFn: ({ id, entryCode }: { id: number; entryCode?: string }) =>
    apiFetch<{ round: RoundDetail }>(`/rounds/${id}/start`, {
      method: 'POST',
      headers: entryCode ? { 'x-entry-code': entryCode } : {},
    }),
});
```

On error, `apiFetch` throws `new Error(body.code)` — so check `e.message === 'INVALID_ENTRY_CODE'` in mutation's `onError`.

### Web — sessionStorage key and type

```typescript
// apps/web/src/lib/session-store.ts
export type WolfSession = { roundId: number; entryCode: string | null };
const KEY = 'wolf-cup:session';
export const getSession = (): WolfSession | null => {
  const raw = sessionStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as WolfSession) : null;
};
export const setSession = (s: WolfSession) => sessionStorage.setItem(KEY, JSON.stringify(s));
export const clearSession = () => sessionStorage.removeItem(KEY);
```

This module is used in Story 3.2 (set) and later stories (get — to retrieve code + roundId for score submission).

### Web — AC#15 session restore on mount

On mount, check `getSession()`. If found, and its `roundId` exists in the available rounds list, skip initiation and show the confirmation view with that session. If the `roundId` is not in the available rounds (round finished or different day), clear the session and show the normal initiation flow.

```typescript
const session = getSession();
const [joined, setJoined] = useState<WolfSession | null>(null);

// After rounds load:
useEffect(() => {
  if (session && data?.items.some(r => r.id === session.roundId)) {
    setJoined(session); // Skip to confirmation view
  }
}, [data]);
```

### Web — shadcn/ui components available

Story 3-1 installed: `@radix-ui/react-slot`, `class-variance-authority`, `lucide-react`. Available shadcn component: `Button` from `@/components/ui/button`. Use `lucide-react` icons where helpful (e.g., `Loader2` for spinner, `CheckCircle2` for success). Additional shadcn components can be added manually (following the pattern in `src/components/ui/button.tsx`) — do NOT run `npx shadcn@latest add` (network restricted). If you need `Input`, `Card`, `Badge`, implement them manually or inline with Tailwind — keep it simple.

### Web — routing after successful initiation

Story 3.3 adds the ball draw route. For now, the confirmation view shows a disabled "Start Ball Draw" button. Do NOT add a new route in this story — just show the confirmation state in the same `/score-entry` page.

### Web — mobile-first UI requirements

- All interactive elements: minimum 48×48px touch target (`min-h-12 min-w-12` in Tailwind)
- Entry code input: large text (`text-2xl`), centered, uppercase display
- Loading skeleton for round cards: 2 placeholder rectangles while `isLoading`
- Error text: red color via `text-destructive` (from shadcn CSS vars)

### Architecture References

- [Source: architecture.md#Authentication & Security] — Entry code stored in sessionStorage; code validated via bcrypt compare; casual rounds bypass code check
- [Source: architecture.md#Authorization tiers] — `POST /api/rounds/:id/start` is code-gated; `GET /api/rounds/*` is public
- [Source: architecture.md#API & Communication Patterns] — response shape `{ items: [] }` for collections; `{ round: {...} }` for single resource
- [Source: architecture.md#TanStack Query Key Conventions] — `['rounds', 'active']` for active round; extended to `['rounds', 'available']` for this story's list
- [Source: architecture.md#Error handling standard] — errors always `{ error: string, code: string }`; 403 for auth failures, 422 for unprocessable
- [Source: architecture.md#Loading State Patterns] — show skeleton for table/card rows while loading; never blank page
- FR24 — Scorer initiates official round by entering weekly entry code
- FR25 — Scorer initiates casual round without a code
- FR62 — Score entry for official rounds restricted to valid entry code holders
- NFR23 — Entry codes invalidated when a new code is set or round is closed

### Project Structure Notes

- New file: `apps/api/src/routes/rounds.ts` — public rounds router (DO NOT modify `admin/rounds.ts`)
- New file: `apps/api/src/routes/rounds.test.ts` — co-located test (pattern from `admin/auth.test.ts`)
- New file: `apps/web/src/lib/session-store.ts` — sessionStorage helper
- Modified file: `apps/web/src/routes/score-entry.tsx` — replace stub
- Modified file: `apps/api/src/index.ts` — add `app.route('/api', publicRoundsRouter)` import and mount BEFORE admin routes
- No schema changes needed — existing `rounds`, `groups`, `roundPlayers`, `players` tables cover all requirements
- No new migrations needed

### What This Story Does NOT Include

- Ball draw / batting order entry (Story 3.3)
- Gross score submission (Story 3.4)
- Wolf partner decision UI (Story 3.5)
- Guest player addition for casual rounds (Story 3.6)
- Offline queue (Story 3.7)
- The "Start Ball Draw" button is a disabled placeholder only

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Test mock path bug: `rounds.test.ts` sits in `src/routes/` not `src/routes/admin/`, so mock path is `'../db/index.js'` (not `'../../db/index.js'`). Fixed.
- `file::memory:?cache=shared&rounds=1` URL rejected by `@libsql/client` (`URL_PARAM_NOT_SUPPORTED`). `@libsql/client` only accepts `cache` query param for in-memory SQLite. Vitest 3.x `pool: 'forks'` isolates test files by process so all files safely share `'file::memory:?cache=shared'` without contamination. Fixed.
- Unused `today` variable in `GET /rounds` handler triggered ESLint `no-unused-vars`. Only `yesterday`/`tomorrow` needed for the date window filter. Removed `today`.

### Completion Notes List

- **Task 1 — Public rounds API:** Created `apps/api/src/routes/rounds.ts` with 3 public endpoints. `GET /rounds` uses ±1-day date window + status filter (`scheduled`/`active`), never exposes `entryCodeHash`, returns `autoCalculateMoney` as boolean. `GET /rounds/:id` returns nested groups+players via helper `getRoundDetail()`. `POST /rounds/:id/start` inlines bcrypt validation (not using `entryCodeMiddleware` due to path param vs query param mismatch), casual bypass (FR25), idempotent active→active, 422 for finalized/cancelled. Mounted at `/api` prefix in `index.ts`. 17 new tests, all 120 total pass.
- **Task 2 — Score entry UI:** Replaced stub `score-entry.tsx` with 3-state component: round list → official code form / casual direct join → confirmation. `session-store.ts` provides typed get/set/clear for `wolf-cup:session` in sessionStorage. Session restore on mount prevents re-entry after page refresh. Error handling: `INVALID_ENTRY_CODE` → inline error + clear input; `ROUND_NOT_JOINABLE` → inline error. All shadcn/Tailwind, mobile-first, 48px touch targets, loading skeleton, disabled "Start Ball Draw" placeholder.

### File List

- `apps/api/src/routes/rounds.ts` — new (public rounds router: GET /rounds, GET /rounds/:id, POST /rounds/:id/start)
- `apps/api/src/routes/rounds.test.ts` — new (17 tests covering all ACs #1–8 and #17)
- `apps/api/src/index.ts` — updated (import + mount publicRoundsRouter at /api)
- `apps/web/src/routes/score-entry.tsx` — updated (replaced stub with full initiation UI)
- `apps/web/src/lib/session-store.ts` — new (WolfSession type + get/set/clear sessionStorage helpers)
