# Story 3.7: Offline Queue & Sync

Status: done

## Story

As a scorer using the app during a round,
I want my hole scores saved locally when I lose cell signal on the course,
so that I never lose entered scores and they automatically sync to the server when connectivity is restored.

## Acceptance Criteria

### Queue On Network Failure

1. When "Submit Hole" is tapped and the score POST fails with a **network error** (fetch throws TypeError, or `navigator.onLine === false`):
   - The hole entry (scores + wolf decision if applicable) is saved to an IndexedDB queue.
   - The hole automatically advances to the next hole (same as a successful submit).
   - An "X scores pending sync" badge appears at the top of the score entry page.
   - The error message is NOT shown (data is locally safe, not lost).

2. When "Submit Hole" fails with a **server error** (422 `INVALID_SCORES`, etc.) — the network IS available but the server rejected the submission:
   - The hole does NOT advance (same as current behavior).
   - The existing server-side error message is displayed.
   - Data is NOT queued (server saw the request; fix the error before retrying).

3. Wolf decision data is bundled into the queue entry so both scores and wolf decision are replayed together on drain. The bundle captures: `decision`, `partnerId`, `greenies`, `polies`, `autoCalculateMoney` flag. Wolf decision is `null` in the entry when `autoCalculateMoney=false` or the hole has neither a decision nor bonuses (skins holes 1–2 with no polies/greenies).

### Auto-Sync On Reconnect

4. When `window.addEventListener('online', ...)` fires, the queue is drained **sequentially by `holeNumber` ascending** — never in parallel.

5. Drain sequence per entry:
   - POST `/rounds/:roundId/groups/:groupId/holes/:holeNumber/scores` with stored scores.
   - If entry has a wolf decision AND `autoCalculateMoney=true`: POST `.../holes/:holeNumber/wolf-decision` with stored wolf data.
   - Remove from queue **only after both** succeed.

6. After a complete successful drain:
   - Invalidate `['scores', roundId, groupId]` and `['wolf-decisions', roundId, groupId]` TanStack Query keys so the UI shows the freshly synced data.
   - Pending count badge disappears.

7. If drain fails mid-way (entry throws network error again):
   - Remaining entries are left in the queue.
   - Brief message appears: "Sync failed — will retry when connection is restored."
   - Badge still shows remaining count.

### UI Badge

8. When `pendingCount > 0`: amber badge at top of score entry page: `"X score(s) pending sync"` with a `WifiOff` lucide icon. Visible on both the hole entry view and the summary view (hole 19).
9. While drain is running: `Loader2` spinner appears next to the badge text.
10. When `pendingCount = 0`: badge is not rendered.

### New Files & Package

11. New: `apps/web/src/lib/offline-queue.ts` — `idb`-based queue; exports `enqueueScore`, `getQueue`, `removeFromQueue`, `getQueueCount`.
12. New: `apps/web/src/hooks/useOnlineStatus.ts` — returns `boolean`, wraps `navigator.onLine` + `online`/`offline` events.
13. New: `apps/web/src/hooks/useOfflineQueue.ts` — returns `{ pendingCount, isDraining, drainError, drain, refreshCount }`.
14. `idb` package added: `pnpm --filter @wolf-cup/web add idb`.

### Quality

15. `pnpm --filter @wolf-cup/web typecheck` passes.
16. `pnpm --filter @wolf-cup/web lint` passes.

## Tasks / Subtasks

- [x] Task 1: Install `idb` and create `lib/offline-queue.ts` (AC: #11, #14)
  - [x] `pnpm --filter @wolf-cup/web add idb`
  - [x] Create `apps/web/src/lib/offline-queue.ts` with `QueueEntry` interface, `openDB` wrapper, and the four exported functions

- [x] Task 2: Create `hooks/useOnlineStatus.ts` (AC: #12)
  - [x] `useState(navigator.onLine)` + `online`/`offline` listeners in `useEffect` with cleanup

- [x] Task 3: Create `hooks/useOfflineQueue.ts` (AC: #4–7, #13)
  - [x] `pendingCount`, `isDraining`, `drainError` state
  - [x] `drain()`: sequential `getQueue()` → score POST → wolf-decision POST → `removeFromQueue()`
  - [x] `refreshCount()`: re-reads `getQueueCount()` and updates state
  - [x] Auto-drain via `window.addEventListener('online', ...)` inside hook
  - [x] After successful drain: invalidate `['scores', roundId, groupId]` and `['wolf-decisions', roundId, groupId]`

- [x] Task 4: Modify `score-entry-hole.tsx` (AC: #1–3, #8–10)
  - [x] Import `enqueueScore` from `@/lib/offline-queue`
  - [x] Call `useOfflineQueue(session.roundId, session.groupId!)` at component top
  - [x] Add `isNetworkError(err)` helper
  - [x] In `submitMutation.onError`: if network error → `enqueueScore(...)` → advance hole → `refreshCount()`; else show existing server-error messages
  - [x] Pending badge + drain error display in both summary view (hole 19) and hole entry view
  - [x] Import `WifiOff` from `lucide-react`

- [x] Task 5: Typecheck + lint (AC: #15–16)

## Dev Notes

### `idb` Library

`idb` wraps the browser IndexedDB API with a Promise-based interface. It is already in the architecture spec. Version: install latest (`idb` — types bundled, no `@types/idb` needed).

```typescript
// apps/web/src/lib/offline-queue.ts
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'wolf-cup-offline';
const STORE_NAME = 'score-queue';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}
```

Cache the `dbPromise` so `openDB` is only called once per session.

### `QueueEntry` Type (exact shape)

```typescript
export interface QueueEntry {
  id?: number;           // auto-increment keyPath; undefined before add()
  roundId: number;
  groupId: number;
  holeNumber: number;   // primary sort key for drain order
  scores: Array<{ playerId: number; grossScore: number }>;
  wolfDecision: {
    decision: 'alone' | 'partner' | 'blind_wolf' | null;
    partnerId: number | null;
    greenies: number[];
    polies: number[];
  } | null;              // null when no wolf data to replay
  autoCalculateMoney: boolean;
  entryCode: string | null;   // from session.entryCode
  timestamp: number;          // Date.now() at enqueue time
}
```

### Network Error Detection

`apiFetch` throws `new Error(body.code ?? body.error ?? 'HTTP N')` for server errors — these are always strings like `'INVALID_SCORES'`. Network failures throw `TypeError` (native fetch) with message `'Failed to fetch'`.

```typescript
function isNetworkError(err: Error): boolean {
  return !navigator.onLine || err instanceof TypeError || err.message === 'Failed to fetch';
}
```

This cleanly separates:
- **Network error** → queue + advance (score is safe locally)
- **Server error** → surface to user (score was seen by server, needs correction)

### `submitMutation.onError` New Logic

```typescript
onError: (err: Error, { holeNum, inputs }) => {
  if (isNetworkError(err)) {
    void enqueueScore({
      roundId: session!.roundId,
      groupId: session!.groupId!,
      holeNumber: holeNum,
      scores: orderedPlayers.map((p) => ({
        playerId: p.id,
        grossScore: Number(inputs[p.id]),
      })),
      wolfDecision: roundData?.autoCalculateMoney && (holeNum >= 3 ? currentDecision !== null : false || currentGreenies.size > 0 || currentPolies.size > 0)
        ? {
            decision: holeNum >= 3 ? currentDecision : null,
            partnerId: currentPartnerId,
            greenies: [...currentGreenies],
            polies: [...currentPolies],
          }
        : null,
      autoCalculateMoney: roundData?.autoCalculateMoney ?? false,
      entryCode: session!.entryCode ?? null,
      timestamp: Date.now(),
    }).then(() => void refreshCount());

    if (holeNum < 18) {
      setCurrentHole(holeNum + 1);
      setCurrentInputs({});
    } else {
      setCurrentHole(19);
    }
  } else {
    if (err.message === 'INVALID_SCORES') {
      setSubmitError('One or more player scores are invalid.');
    } else if (err.message === 'INVALID_ENTRY_CODE') {
      setSubmitError('Entry code no longer valid — please re-join the round.');
    } else {
      setSubmitError('Could not save scores — please try again.');
    }
  }
},
```

Note: `enqueueScore` is async, but we don't `await` it in the mutation callback (mutations callbacks are synchronous). Use `.then(() => void refreshCount())` to update the count after the write completes.

### Drain Sequence (CRITICAL: sequential only, by holeNumber)

```typescript
// In useOfflineQueue.ts drain()
const entries = await getQueue(); // sorted by holeNumber ASC in getQueue()
for (const entry of entries) {
  await apiFetch(
    `/rounds/${entry.roundId}/groups/${entry.groupId}/holes/${entry.holeNumber}/scores`,
    {
      method: 'POST',
      headers: entry.entryCode ? { 'x-entry-code': entry.entryCode } : {},
      body: JSON.stringify({ scores: entry.scores }),
    },
  );

  if (entry.wolfDecision && entry.autoCalculateMoney) {
    const { decision, partnerId, greenies, polies } = entry.wolfDecision;
    const body: Record<string, unknown> = { greenies, polies };
    if (decision !== null) {
      body['decision'] = decision;
      if (decision === 'partner' && partnerId !== null) {
        body['partnerPlayerId'] = partnerId;
      }
    }
    await apiFetch(
      `/rounds/${entry.roundId}/groups/${entry.groupId}/holes/${entry.holeNumber}/wolf-decision`,
      {
        method: 'POST',
        headers: entry.entryCode ? { 'x-entry-code': entry.entryCode } : {},
        body: JSON.stringify(body),
      },
    );
  }

  await removeFromQueue(entry.id!);
  setPendingCount((prev) => Math.max(0, prev - 1));
}
```

**NEVER use `Promise.all` for drain** — NFR19 and the architecture mandate sequential by holeNumber.

### Idempotency — Why Replay Is Safe

Both endpoints use `onConflictDoUpdate`:
- Score POST (`round_id, player_id, hole_number` unique) — replaying an already-persisted score is a no-op update.
- Wolf decision POST (`round_id, group_id, hole_number` unique) — same.

If connectivity drops mid-drain and some entries were already submitted, re-draining those entries on the next reconnect is safe.

### Badge JSX

Place at the very top of the component's returned JSX (before the hole header), outside any conditional block so it's visible on both hole view and summary view:

```tsx
{pendingCount > 0 && (
  <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-300 text-amber-800 text-sm px-3 py-2">
    <WifiOff className="w-4 h-4 shrink-0" />
    {pendingCount} score{pendingCount !== 1 ? 's' : ''} pending sync
    {isDraining && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
  </div>
)}
{drainError && (
  <div className="flex items-center gap-2 text-amber-700 text-sm">
    <AlertCircle className="w-4 h-4 shrink-0" />
    {drainError}
  </div>
)}
```

`WifiOff` is available from `lucide-react` (already installed). Add to the existing import line.

### iOS Safari Constraints

- iOS Safari does **not** support the `BackgroundSync` Service Worker API.
- The primary sync mechanism is foreground: `window.addEventListener('online', ...)` fires when Safari detects connectivity return.
- The `vite-plugin-pwa` Service Worker (set up in Story 3.1) caches the app shell — **no modifications to the Service Worker are needed for this story**.
- Visibility-change drain (on tab focus) is NOT required for this story — keep it simple.

### `useOfflineQueue` Hook Skeleton

```typescript
// apps/web/src/hooks/useOfflineQueue.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getQueue, removeFromQueue, getQueueCount } from '@/lib/offline-queue';
import { apiFetch } from '@/lib/api';

export function useOfflineQueue(roundId: number, groupId: number) {
  const queryClient = useQueryClient();
  const [pendingCount, setPendingCount] = useState(0);
  const [isDraining, setIsDraining] = useState(false);
  const [drainError, setDrainError] = useState<string | null>(null);
  const isDrainingRef = useRef(false);  // avoid stale closure in event listener

  const refreshCount = useCallback(async () => {
    const count = await getQueueCount();
    setPendingCount(count);
  }, []);

  const drain = useCallback(async () => {
    if (isDrainingRef.current) return;
    isDrainingRef.current = true;
    setIsDraining(true);
    setDrainError(null);
    try {
      // ... sequential drain loop ...
      await queryClient.invalidateQueries({ queryKey: ['scores', roundId, groupId] });
      await queryClient.invalidateQueries({ queryKey: ['wolf-decisions', roundId, groupId] });
    } catch {
      setDrainError('Sync failed — will retry when connection is restored.');
    } finally {
      isDrainingRef.current = false;
      setIsDraining(false);
      await refreshCount();
    }
  }, [roundId, groupId, queryClient, refreshCount]);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  useEffect(() => {
    const handleOnline = () => { void drain(); };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [drain]);

  return { pendingCount, isDraining, drainError, drain, refreshCount };
}
```

Use `isDrainingRef` to prevent double-drain if the `online` event fires twice rapidly. `isDraining` state is for UI only.

### Current Score Entry Flow (Unchanged for Online Path)

The online path in `submitMutation` remains exactly as-is:
- POST scores → onSuccess → if autoCalculateMoney + decision/bonuses → POST wolf-decision → advance hole
- Only `onError` gets the new isNetworkError branch.

### Project Structure Notes

- Architecture location for hooks: `apps/web/src/hooks/` — directory does NOT yet exist, create it.
- Architecture location for queue lib: `apps/web/src/lib/offline-queue.ts` — `lib/` exists, add new file.
- Modified: `apps/web/src/routes/score-entry-hole.tsx` (imports + `onError` logic + badge JSX)
- Modified: `apps/web/package.json` (idb dependency)
- Modified: `pnpm-lock.yaml` (auto-generated by pnpm)

No API changes. No DB schema changes. No migration.

### References

- FR31: "system queues score entries locally when offline and automatically syncs to server when connectivity is restored" [Source: `_bmad-output/planning-artifacts/epics.md`]
- NFR19: "Offline score entry must preserve 100% of entered data with zero loss; scores must sync in correct hole order upon reconnect" [Source: `_bmad-output/planning-artifacts/epics.md`]
- Architecture offline queue spec: IndexedDB via `idb`, sequential drain by holeNumber, foreground sync [Source: `_bmad-output/planning-artifacts/architecture.md` — Frontend Architecture section]
- Architecture mandate: "Drain the offline queue **sequentially by hole number** — never in parallel" [Source: architecture.md — All AI Agents MUST section]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

_None_

### Completion Notes List

- `idb` installed in `apps/web`; `offline-queue.ts` uses a cached `dbPromise` singleton so `openDB` is called once per session.
- `useOnlineStatus.ts` is a simple wrapper — not used directly in `score-entry-hole.tsx` (the hook exposes the online state, but `isNetworkError` reads `navigator.onLine` inline for the mutation callback).
- `useOfflineQueue.ts` uses `isDrainingRef` (a `useRef`) as a guard to prevent double-drain if the `online` event fires twice in quick succession. `isDraining` state is separately maintained for UI only.
- Badge JSX placed in both the summary view (`currentHole === 19` branch) and the hole entry view main return, per AC #8.
- `typecheck` and `lint` both pass clean.

### File List

- `apps/web/src/lib/offline-queue.ts` (new)
- `apps/web/src/hooks/useOnlineStatus.ts` (new)
- `apps/web/src/hooks/useOfflineQueue.ts` (new)
- `apps/web/src/routes/score-entry-hole.tsx` (modified)
- `apps/web/package.json` (modified — idb added)
- `pnpm-lock.yaml` (modified — auto-generated)

### Code Review Fixes (2026-03-01)

- **H1**: `enqueueScore` `.catch()` added — hole now advances only inside `.then()`, preventing data-loss-with-no-feedback if IndexedDB write fails.
- **M1**: `wolfDecisionMutation.onError` gains `isNetworkError` branch — if score POST succeeds but wolf POST fails on network drop, score (from `submittedScores`) + wolf decision are re-enqueued together (score replay is idempotent); hole advances.
- **M2**: Offline badge moved to top of hole entry view JSX (before hole header), matching AC#8 ("at top of score entry page").
- **M3**: `getQueueCount` now filters by `roundId/groupId` — `pendingCount` badge reflects only the current session's queued entries, not the global store total.
