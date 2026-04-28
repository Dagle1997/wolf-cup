# T5-4: Offline Course + Scorecard Shell Cache [port-claimed; greenfield-in-practice]

## Status

Ready for Dev

## Story

As a scorer,
I want the active round's course data + scorecard shell cached locally the moment the round is opened online,
So that the scorer UI renders fully offline even on a cold PWA launch in the parking lot at Mid Pines (FR-B5).

T5-4 is the **offline-resilience floor for the score-entry UX**. T5-3 shipped the offline mutation queue (writes survive offline); T5-4 ships the offline READ — the score-entry route renders fully from IndexedDB when the network is unreachable. Combined, T5-2 + T5-3 + T5-4 give the scorer a fully-offline-capable workflow.

## Risk Acceptance

### 1. Path footprint — ALLOWED only

This story touches:

**Backend (1 new endpoint):**
- `apps/tournament-api/src/routes/scores.ts` — modified (add `GET /:roundId/course` handler returning the courseRevision + courseHoles + courseTees joined data scoped by the round's eventRoundId)
- `apps/tournament-api/src/routes/scores.course.test.ts` — NEW (5 GET tests)

**Frontend (1 new cache lib + UI integration):**
- `apps/tournament-web/src/lib/round-cache.ts` — NEW (~150 lines; IDB-backed cache for round-detail + course payloads; reads + writes; cache-miss returns null)
- `apps/tournament-web/src/lib/round-cache.test.ts` — NEW (8 cache tests via fake-indexeddb)
- `apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx` — modified (wire round-cache via TanStack Query's `placeholderData` + a custom `queryFn` that falls through to cache on network error; display course par/SI in the score-entry view)
- `apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx` — modified (add 2 tests for cache integration: cold-online writes cache + populates UI; cold-offline reads cache + populates UI)
- `apps/tournament-web/PORTS.md` — modified (append round-cache entry; greenfield since Wolf Cup has no equivalent)

**Story-tracking:**
- `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml`
- spec + codex review files

**Zero SHARED files.** No `package.json` change. No `pnpm-lock.yaml` change. (`idb` is already a tournament-web dep from T5-3.)

**Zero FORBIDDEN edits.**

### 2. Wolf Cup port investigation — greenfield in practice

The epic AC tags T5-4 as `[port]`. Investigation: `apps/web/src/lib/*cache*` returns no files; grep for `indexedDB` / `idb.openDB` / `round-cache` / `scorecard-cache` in `apps/web/src` returns no matches. Wolf Cup uses `vite-plugin-pwa`'s workbox-generated PWA cache (the `apps/web/dev-dist/` artifacts) for static assets only — the workbox runtime cache for `/api/*` routes was REMOVED in commit `67238a2` (the score-entry SW kill memory). No custom IDB-backed round-cache exists in Wolf Cup.

T5-4 ships fresh under the `[port]` epic tag. PORTS.md entry documents the greenfield decision (same pattern as T4-3's pdfkit greenfield).

### 3. Backend `GET /api/events/:eventId/rounds/:roundId/course`

Path: matches epic AC line 1372 exactly. Mounted in a NEW handler under `apps/tournament-api/src/routes/scores.ts` but the path is `GET /api/events/:eventId/rounds/:roundId/course`. To make this work alongside T5-2's `/api/rounds/:roundId` mount on the SAME `scoresRouter`, the new handler is registered on a SECOND mount: `app.route('/api/events', scoresEventsCourseRouter)` with `scoresEventsCourseRouter.get('/:eventId/rounds/:roundId/course', ...)`. Two routers exporting from the same file is fine; alternatively, reuse the existing T4-3 PDF schedule router pattern (mounted at `/api/events`).

**Chain**: `requireSession` → `requireEventParticipant` (T3-8 middleware; reads `:eventId` from URL — that's why we keep the eventId in the URL despite the redundancy with the round's FK). This gates non-participants (a session in a different event can't probe course data). Round-1 codex caught this auth-permissiveness risk.

**Effective path**: `GET /api/events/:eventId/rounds/:roundId/course`.

The handler resolves rounds → event_rounds → course_revisions → courses → course_holes/course_tees, BUT also defensively verifies `round.event_id === :eventId` and returns 404 `round_not_found` on mismatch (defense-in-depth against a token-for-event-A used in event-B's URL — same pattern as T4-3's `event_token_mismatch` 403 except this returns 404 since there's no token here, just a session).

**Response shape (200)**:
```ts
{
  roundId: string,
  courseRevisionId: string,
  course: {
    name: string,
    clubName: string,
  },
  holes: Array<{
    holeNumber: number,        // 1-18
    par: number,
    si: number,                // stroke index 1-18
    yardagePerTee: Record<string, number>, // {blue: 420, white: 390, ...}
  }>,
  tees: Array<{
    teeColor: string,
    rating: number,             // ×10 integer (per T2-1 schema)
    slope: number,
  }>,
  selectedTeeColor: string,    // matches event_round.tee_color
}
```

**Error shapes**:
- 401 — no session.
- 400 `invalid_round_id` — path UUID-shape fail.
- 404 `round_not_found` — round doesn't exist OR foreign tenant.
- 404 `course_not_found` — round has `event_round_id` but the course revision is missing (data integrity error; should never fire in practice given FK constraints).

**Tenant scoping**: every SELECT filters on `tenant_id = TENANT_ID`. The lookup chain:
1. `rounds` row by id + tenant.
2. `event_rounds` row by id (resolved from rounds.event_round_id) + tenant.
3. `course_revisions` row by id (resolved from event_rounds.course_revision_id) + tenant.
4. `courses` row by id (resolved from course_revisions.course_id) + tenant.
5. All `course_holes` for course_revision_id + tenant (ordered by hole_number ASC).
6. All `course_tees` for course_revision_id + tenant.

### 4. Frontend `round-cache.ts` lib

**Pattern**: TWO IDB object stores in a NEW database `tournament-round-cache` (separate from T5-3's `tournament-offline` mutation queue — different lifecycle, different gc semantics):
- `round-detail` — keyed by `roundId`. Stores the full T5-2 GET response.
- `round-course` — keyed by `roundId`. Stores the new T5-4 GET /:roundId/course response.

**Exported API**:
```ts
// round-detail
export async function readCachedRoundDetail(roundId: string): Promise<RoundDetail | null>;
export async function writeCachedRoundDetail(roundId: string, data: RoundDetail): Promise<void>;
export async function clearCachedRoundDetail(roundId: string): Promise<void>;

// round-course
export async function readCachedRoundCourse(roundId: string): Promise<RoundCourse | null>;
export async function writeCachedRoundCourse(roundId: string, data: RoundCourse): Promise<void>;
export async function clearCachedRoundCourse(roundId: string): Promise<void>;

// debug + tests only
export async function _resetCacheForTests(): Promise<void>;
```

Each `read*` returns `null` on cache-miss (no row for that roundId; OR malformed deserialization that gets caught and treated as miss). Each `write*` upserts (DELETE-then-INSERT or `put`). The `clear*` functions exist for explicit invalidation but are NOT called by the v1 route — the cache-aside pattern overwrites on every fresh fetch.

**Cache invalidation strategy**: cache is overwritten on every successful network fetch (the "cache-aside" pattern). Stale data on disk is never served if the network succeeds. Offline-only path: cache is the only data source.

### 5. Frontend integration in `rounds.$roundId.score-entry.tsx`

**TanStack Query `queryFn` with cache fall-through** (the queryFn returns the unmodified data shape; cache-source signal flows via a separate ref/state — see View-branch additions below):
```ts
async function fetchOrCacheRoundDetail(
  roundId: string,
  onSource: (s: 'network' | 'cache') => void,
): Promise<RoundDetail> {
  try {
    const fresh = await fetchRoundDetail(roundId); // existing T5-2 fetch
    await writeCachedRoundDetail(roundId, fresh);
    onSource('network');
    return fresh;
  } catch (err) {
    // ANY error from the network call — try cache. Don't try to
    // distinguish "network down" from "5xx" via heuristic; if the
    // fetch returned 4xx/5xx with a parsed body, fetchRoundDetail
    // already threw an ApiError (with .status set); we treat
    // ApiError as a real failure and re-throw rather than serving
    // stale cache for a logical 404/422. Pure network errors
    // (TypeError from fetch — "Failed to fetch") have NO .status,
    // so we discriminate that way.
    const isApiError =
      err && typeof err === 'object' && 'status' in (err as object);
    if (!isApiError) {
      const cached = await readCachedRoundDetail(roundId);
      if (cached) {
        onSource('cache');
        return cached;
      }
    }
    throw err;
  }
}
```

Same pattern for the course query.

**TanStack Query options**: both queries use `retry: false` so a network failure doesn't burn 3 retries before falling through to cache (round-1 codex catch). `staleTime: 0` so any new data updates the cache immediately. `refetchInterval: 15_000` (matches T5-2's existing polling) **with `refetchIntervalInBackground: false`** so backgrounded tabs don't poll. **Additional**: poll-while-offline guard — when the last fetch came from cache (i.e., the most recent attempt failed network), TanStack Query's `enabled` flag stays true but the queryFn's network call will fail again on every tick. To avoid a 15s loop of futile fetches against a known-down network, the queryFn checks `navigator.onLine === false` at the top and short-circuits to `readCachedRoundCourse` directly (no fetch attempted). The `'online'` window event listener (already wired by T5-3's `useOnlineStatus`) drives `queryClient.invalidateQueries` to retry on reconnect.

**View-branch additions**:
- **"Offline mode" chip** rendered at the page header when EITHER query's last successful resolution came from the cache. The cache-source signal is **NOT a `__source` field on the data** (would pollute the consumer's typed shape and risk persisting `__source` back into the cache on the next write). Instead: the queryFn returns the unmodified data shape, AND the component owns a `useRef<{detail: 'network' | 'cache' | null; course: 'network' | 'cache' | null}>` that the queryFn updates via a closed-over reference (the queryFn receives the ref-update callback as a parameter). The chip checks the ref's current values inside a useMemo keyed on the queries' `dataUpdatedAt` timestamps so it re-evaluates on every refetch.
  - **Why a ref, not useState**: a useState write inside queryFn triggers a re-render mid-fetch, which can cause TanStack Query to abort or re-execute. A ref is non-reactive — safe to write inside any async path. The chip's render is driven by the existing `dataUpdatedAt`-keyed useMemo, not by a state-driven re-render.
  - **DO NOT use TanStack Query's `meta` field** for this — `meta` is intended as a static config payload; mutating it inside queryFn is unsupported and may not propagate to the component on re-render.
- **Scorecard-shell strip** rendered ABOVE the score input grid when course data is loaded. Single-hole format (NOT per-hole row): `Hole {currentHole} • Par {par} • SI {si}` displayed once for the current hole. Round 1 codex round caught the per-hole-row vs single-hole-label ambiguity. Layout: simple `<div>` with three `<span>` children separated by ` • ` text. Course data lookup: `course.holes.find((h) => h.holeNumber === currentHole)`.
- **Course-revision-superseded banner** (epic AC line 1378-1380): when a fresh network fetch returns course data DIFFERENT from the cached value, set a state flag + render a dismissible banner: "Course data updated — review hole SIs". Banner has a "Dismiss" button. **Does NOT discard in-flight score entries** (the form's `currentInputs` state is unaffected; the banner is purely informational).
  - **Comparison method** (NOT JSON.stringify — key-order unstable across implementations): compute `prevHash = course.holes.map((h) => \`${h.holeNumber}:${h.par}:${h.si}\`).join('|')` from the cached payload AND the same hash from the fresh payload. If `prevHash !== freshHash`, the par/SI for some hole changed — fire the banner. Yardage and tee-rating changes do NOT fire the banner (those don't affect scoring). The hash function is stable across runs because hole numbers are deterministic 1-18.
  - **Ordering (load-bearing)** in `fetchOrCacheRoundCourse`: (1) READ cached value FIRST via `readCachedRoundCourse`. (2) Compute `cachedHash` (or null if no cache). (3) Issue network fetch. (4) On success, compute `freshHash`. (5) Compare; if different AND cached !== null, set the banner-state ref. (6) ONLY THEN write the fresh value to cache via `writeCachedRoundCourse` (overwriting the prior). If you write before reading, the comparison reads its own write and never differs.
  - **First-fetch guard**: if the cached payload is null (no prior cache entry — first time visiting this round), DO NOT fire the banner. The banner only fires on a fetch where the cache had a prior value AND the new value's hash differs. Implementation: the comparison branch is gated `if (cached !== null && cachedHash !== freshHash)`. Test #11 explicitly seeds a prior cache entry before testing the banner.

### 6. Test surface

**Backend** (`scores.course.test.ts`): 5 GET tests covering happy + error + tenant.

**Frontend lib** (`round-cache.test.ts`): 8 tests (read miss / write+read round-trip ×2 stores / clear / overwrite-on-write / per-roundId scoping / atomic move test).

**Frontend integration** (`rounds.$roundId.score-entry.test.tsx`): +3 tests (cold-online writes-cache+renders; cold-offline reads-cache+renders; course-superseded banner fires + Dismiss + currentInputs preserved).

**Total: +16 tests minimum** (5 backend + 8 cache-lib + 3 frontend integration).

### 7. UX scope: par/SI display

The current score-entry UI from T5-2 shows just hole number + 4 score inputs. T5-4 adds a one-line scorecard-shell strip above the inputs:

```
Hole 5  •  Par 4  •  SI 11
```

This is a small UX addition; not a redesign.

## Acceptance Criteria

**AC #1 — Backend GET endpoint at `/api/events/:eventId/rounds/:roundId/course`**

Given `apps/tournament-api/src/routes/scores.ts`
When inspected
Then it exports an additional handler with effective path `GET /api/events/:eventId/rounds/:roundId/course` mounted via a separate router (or via a second mount on the existing `scoresRouter`) at `app.route('/api/events', ...)`. **Chain**: `requireSession` → `requireEventParticipant` (T3-8). Path-params validate: `:eventId` UUID-shape (400 `invalid_event_id`); `:roundId` UUID-shape (400 `invalid_round_id`). Defense-in-depth: handler verifies `round.event_id === :eventId` — mismatch → 404 `round_not_found` (uniform with foreign-tenant). 404 `round_not_found` on missing/foreign-tenant round; 404 `course_not_found` if the course revision can't be resolved. Tenant-scoped on every SELECT.

**AC #2 — Course endpoint response shape**

Given a round whose event_round → course_revision points at a valid course with 18 holes + 1 tee
When the GET is invoked
Then `holes` is an array of 18 `{ holeNumber, par, si, yardagePerTee }` ordered by holeNumber ASC. `tees` carries the per-tee `teeColor`, `rating`, `slope`. `selectedTeeColor` matches `event_round.tee_color`. `course.name` and `course.clubName` populated.

**AC #3 — `round-cache.ts` lib API**

Given `apps/tournament-web/src/lib/round-cache.ts`
When inspected
Then it exports `readCachedRoundDetail`, `writeCachedRoundDetail`, `clearCachedRoundDetail`, `readCachedRoundCourse`, `writeCachedRoundCourse`, `clearCachedRoundCourse`, `_resetCacheForTests`. Stores: `round-detail` and `round-course` in a new `tournament-round-cache` DB. Each store keyed by `roundId`. Per Risk Acceptance §4.

**AC #4 — Cache fall-through on offline**

Given the score-entry route loaded online once and the cache populated
When the user later opens the same route with `navigator.onLine === false` (or `fetch` rejects with TypeError)
Then both round-detail and course queries fall through to the cache; the score-entry form renders with member names, hole grid, par/SI per hole — no network errors visible. The "Offline mode" chip appears.

**AC #5 — Cache write on every successful fetch**

Given a successful network fetch of round-detail OR course
When the response lands
Then the cache is overwritten with the new payload. (Cache-aside pattern; stale data is never served if the network succeeds.)

**AC #6 — Tenant scoping defense-in-depth**

Given a round under a foreign tenant
When the GET /:roundId/course is invoked with a session in the local tenant
Then 404 `round_not_found` (uniform with the existing T5-2 GET).

**AC #7 — Tests**

Given the new + modified test files
When `pnpm -F @tournament/api test` and `pnpm -F @tournament/web test` run
Then a **net +16 or more new passing tests** vs baseline (tournament-api: 499 → ≥504; tournament-web: 92 → ≥103). No previously-passing test goes red. typecheck + lint clean.

Test attribution (minimum):
- `scores.course.test.ts` (5 tests):
  1. 200 happy path: 18 holes + 1 tee + selectedTeeColor.
  2. 200 with multiple tees (blue + white + red).
  3. 400 invalid_round_id (non-UUID path).
  4. 401 no session.
  5. 404 round_not_found (foreign-tenant defense).
- `round-cache.test.ts` (8 tests):
  1. readCachedRoundDetail returns null on miss.
  2. write then read round-trip for round-detail.
  3. write then read round-trip for round-course.
  4. clear removes the row.
  5. overwrite-on-write (second write replaces).
  6. per-roundId scoping (write to roundA doesn't affect roundB).
  7. _resetCacheForTests clears both stores.
  8. malformed data in IDB returns null (the read* function catches structural errors at deserialize time and returns null + console.warn; consumers treat null as "cache miss", same as truly absent).
- `rounds.$roundId.score-entry.test.tsx` (+3 tests):
  9. cold-online: GET succeeds, cache populates, UI renders par/SI strip, "Offline mode" chip absent.
  10. cold-offline: fetch rejects with TypeError, cache hits, UI renders from cache including par/SI, "Offline mode" chip visible.
  11. course-superseded banner: cache has course-A; network returns course-B (different par on hole 5); banner renders with "Course data updated — review hole SIs" + Dismiss button. After Dismiss tap, banner unmounts. `currentInputs` state preserved (banner does NOT clear in-flight scores).

**AC #8 — Wolf Cup regression clean**

`pnpm --filter @wolf-cup/engine test` 472 + `pnpm --filter @wolf-cup/api test` 507 unchanged. typecheck + lint clean across all workspaces.

**AC #9 — `apps/tournament-web/PORTS.md` row appended**

Documents the greenfield decision (no Wolf Cup analogue) for round-cache + the per-spec deviation for the course endpoint mount path.

## Tasks

1. Capture baseline test counts.
2. Add `GET /:roundId/course` to `apps/tournament-api/src/routes/scores.ts` per AC #1-#2.
3. Write `apps/tournament-api/src/routes/scores.course.test.ts` (5 tests).
4. Write `apps/tournament-web/src/lib/round-cache.ts` per AC #3.
5. Write `apps/tournament-web/src/lib/round-cache.test.ts` (8 tests).
6. Modify `apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx`: add `useQuery` for course; wire `fetchOrCacheRoundDetail` + `fetchOrCacheRoundCourse`; render par/SI scorecard-shell strip; render "Offline mode" chip.
7. Modify `rounds.$roundId.score-entry.test.tsx`: add 2 cache-integration tests.
8. Append `apps/tournament-web/PORTS.md` row.
9. Run tests + typecheck + lint + Wolf Cup regression.

## Followups

- Banner display in the read-only / no-scorer placeholders (currently only the form view shows the par/SI strip + course-superseded banner). v1.5.
- Course-shell display in the read-only / no-scorer placeholders (currently only the form view shows par/SI). v1.5.
- Pairings cache for cross-foursome leaderboard view — T5-5 (leaderboard) territory; T5-4 only caches MY foursome's data via T5-2's GET response.

## Risks

- **navigator.onLine vs fetch failure**: jsdom doesn't reliably set navigator.onLine; tests use `fetch` rejections directly. Real browser: navigator.onLine + 'offline' window event drives the cache fall-through. The spec uses **ApiError-vs-no-status discrimination** on fetch errors (per Risk Acceptance §5) rather than navigator.onLine. fetchRoundDetail throws `ApiError {status, ...}` for HTTP 4xx/5xx; pure network failures throw TypeError without `.status`. The fall-through checks `'status' in err`.

- **Cache staleness on course revision change**: cache is overwritten on every online fetch. If a course revision is updated upstream while a scorer is mid-round, the cache picks up the new version on the next 15s refetch + the course-superseded banner fires (per Risk Acceptance §5 banner rules + first-fetch guard).

- **IDB DB-name conflict**: `tournament-round-cache` is intentionally separate from T5-3's `tournament-offline`. Different lifecycles (cache evicts on cold launch via PWA workbox; queue persists across launches).

- **Scorecard-shell display row**: small UI addition; tests verify the par/SI text renders. No visual regression for existing T5-2 form layout.
