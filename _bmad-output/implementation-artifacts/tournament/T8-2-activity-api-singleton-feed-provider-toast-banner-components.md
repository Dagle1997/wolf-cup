# T8-2: Activity API + Singleton Feed Provider + Toast/Banner Components (FR-C3, D3-4)

## Status

ready-for-dev

## Story

As any Event participant, I want `GET /api/events/:eventId/activity` supporting both live polling (`?after=<cursor>`) AND historical backfill (`?before=<cursor>`) with an opaque stable compound cursor, plus a singleton `ActivityFeedProvider` mounted at root that a shared TanStack Query subscription feeds, plus a Toast (auto-dismiss 6s) and a Banner (persist until ack, storm-collapse 3+/5s) component, so that live events flow in without duplicate notifications across mounted consumers AND historical backfill works for the T8-3 feed's "Load more" path without dropping burst events (FR-C3, D3-4).

## v1 Scope

T8-1 shipped the activity spine — schema + typed emitter + 14 migrated call sites + ESLint gate. T8-2 puts a queryable read API in front of that spine and the in-app surfaces (toast + banner) that consume the live stream. T8-3 (player-home feed) and T8-4 (award triggers) build on top of T8-2's provider context.

### Layer 1 — Backend GET endpoint (`apps/tournament-api/src/routes/activity.ts`, NEW)

Mounts under `app.route('/api/events', activityRouter)` so the effective URL is `/api/events/:eventId/activity`. Auth chain: `requireSession` → `requireEventParticipant` (existing T3-8 middleware that 403s outsiders). Behavior matrix:

| Query param | Order              | Filter                              |
|-------------|--------------------|-------------------------------------|
| `?after=<cursor>` | `created_at ASC, id ASC` | rows STRICTLY newer than the cursor |
| `?before=<cursor>` | `created_at DESC, id DESC` | rows STRICTLY older than the cursor |
| Neither     | `created_at DESC, id DESC` | newest 100 rows                     |

100-row hard limit per page. Both query params present is a 400 (`{ error: 'bad_request', code: 'cursor_params_mutually_exclusive' }`) — explicit reject so the client can't accidentally combine them.

**Cursor semantics (codex spec round-1 Critical #1).** The response cursors track the LAST PHYSICAL ROW the server inspected for each direction — they are NEVER null on a non-empty response. Specifically:

- `nextCursorAfter` is the cursor of the NEWEST row in the response (highest `created_at`, tie-broken by highest `id`). Null only when the response contains zero rows AND the request's after-cursor (or initial-cursor inferred for neither-param case) is also null. The client uses `nextCursorAfter` for the next live poll; the server ALWAYS returns a usable cursor when there's any page boundary the client could resume from.
- `nextCursorBefore` is the cursor of the OLDEST row in the response (lowest `created_at`, tie-broken by lowest `id`). Null only when the response is empty AND the request's before-cursor is null.
- An empty response with `nextCursorAfter === <request's after-cursor>` (i.e., the cursor did not advance) is the explicit "you're caught up" signal; the client knows to wait for the next 5s tick.

**Page-size is NOT a terminus signal.** A page returning <100 rows simply means there are <100 rows past the cursor at this instant — NOT that pagination is done. Pagination on `?after` terminates when a poll returns ZERO rows. The client must compare the response cursor against the request cursor; if equal, it's caught up.

**Why this matters (concrete failure mode):** the v1 draft of the spec said "nextCursorAfter is null if <100 rows returned". A client receiving a 50-row page with `nextCursorAfter: null` would either (a) re-poll WITHOUT `?after`, getting all 50 rows again as "newest 100 DESC" duplicates, OR (b) be stuck unable to advance. Both are wrong. The fix is to ALWAYS return a forward-progress cursor on non-empty pages.

**Cursor format (Codex High 2 in epic spec):** `base64url(JSON.stringify({ createdAt: number, id: string }))`. The compound `(createdAt, id)` cursor is what makes the pagination stable when multiple rows share the same `created_at` ms — the `id` (UUID) breaks ties via the index's `id DESC` (or ASC for after-mode). Server validates: cursor decodes to JSON, has both keys, `createdAt` is integer, `id` matches UUID regex; anything malformed is a 400 (`{ error: 'bad_request', code: 'invalid_cursor' }`). Cursor is OPAQUE to the client — never parsed or constructed client-side.

**Strict-newer / strict-older semantics.** For `?after=<cursor>`:

```
WHERE event_id = ? AND tenant_id = ?
  AND (created_at > ? OR (created_at = ? AND id > ?))
ORDER BY created_at ASC, id ASC LIMIT 100
```

For `?before=<cursor>`:

```
WHERE event_id = ? AND tenant_id = ?
  AND (created_at < ? OR (created_at = ? AND id < ?))
ORDER BY created_at DESC, id DESC LIMIT 100
```

The composite `idx_activity_event_created_id (event_id, created_at DESC, id DESC)` from T8-1 supports the DESC paths directly; for ASC the planner uses the same index in reverse. Codex spec round-1 may flag whether SQLite's index reversal is actually used — call out in dev-notes that the index is two-direction.

**Response shape (codex spec round-1 Med #5):**

```ts
type ActivityRow = {
  id: string;                    // activity.id (UUID)
  createdAt: number;             // ms-since-epoch UTC
  event: ActivityEvent;          // typed payload, decoded from payload_json
};

type ActivityResponse = {
  rows: ActivityRow[];
  nextCursorAfter: string | null;
  nextCursorBefore: string | null;
};
```

The wrapper is necessary because `ActivityEvent` (T8-1's discriminated union) carries the EVENT data only, not the database-row metadata (`id` + `createdAt`). Consumers need both: the feed UI uses `id` for React keys + `createdAt` for relative-time display; the cursor encode/decode uses `(createdAt, id)` for stable pagination. Putting these on the wrapper rather than mutating the parsed event keeps the `ActivityEvent` type untouched (it's the same type T8-1 emitter consumes; mutating it for read-side would create asymmetry).

`rows` are decoded from `payload_json` via `JSON.parse` and asserted to match the discriminated union shape. Decoding uses the same `activityEventSchemas` Zod schemas from T8-1 — defense-in-depth: any row whose JSON is corrupt (e.g., manual DB tampering, schema drift) is filtered OUT with a logged warning rather than 500'ing the whole response. Caller sees a slightly-shorter rows array.

**Cursor advancement under corrupt-row filtering (codex spec round-1 Critical #2).** Cursor computation uses the LAST DATABASE ROW returned by the SQL query, NOT the last surviving decoded row. If the query returned 100 rows and 5 failed Zod parse, the response has 95 rows in `rows[]` BUT `nextCursorAfter`/`nextCursorBefore` is still computed from the 100-row physical result. This guarantees the next poll's cursor is past the corrupt rows, so they are NOT re-fetched on every cycle.

Concrete pseudocode for the after-mode branch:

```ts
const sqlRows = await tx.select(...).from(activity).where(...).limit(100);
const decodedRows: ActivityRow[] = [];
for (const sqlRow of sqlRows) {
  try {
    const parsed = activityEventSchemas[sqlRow.type as ActivityType].parse(JSON.parse(sqlRow.payloadJson));
    decodedRows.push({ id: sqlRow.id, createdAt: sqlRow.createdAt, event: parsed as ActivityEvent });
  } catch (err) {
    log.warn({ msg: 'activity_corrupt_row_skipped', activityId: sqlRow.id, err: String(err) });
    // Do NOT push; do NOT abort. Loop continues.
  }
}
// Cursor uses the PHYSICAL last/first row from the query, not decodedRows.
const lastSqlRow = sqlRows[sqlRows.length - 1];
const firstSqlRow = sqlRows[0];
const nextCursorAfter = (mode === 'after')
  ? (lastSqlRow ? encodeCursor(lastSqlRow) : requestAfterCursor)
  : (firstSqlRow ? encodeCursor(firstSqlRow) : null);
// (analogous logic for nextCursorBefore)
```

This pattern is the standard "skip-row-don't-skip-cursor" pattern for resilient pagination over a partially-corrupt dataset.

**Cursor encoding location:** a small helper `encodeCursor`/`decodeCursor` lives in `apps/tournament-api/src/services/activity-cursor.ts` so both this route and any future consumers (admin export, etc.) share the same format.

### Layer 2 — Backend tests (`apps/tournament-api/src/routes/activity.integration.test.ts`, NEW)

Coverage matrix:

1. **Auth:** caller without session → 401. Caller with session but not an event participant → 403. Both via existing middleware contracts.
2. **Initial page (no params):** seed 25 events into `activity` for the test event; assert response has 25 rows, `created_at DESC` ordering, `nextCursorAfter` non-null pointing at row 1 (the NEWEST — for live polling), `nextCursorBefore` non-null pointing at row 25 (the OLDEST in this page — for backfill from this page boundary). Both cursors decode to valid `(createdAt, id)` shapes via the cursor helper.
3. **Initial page caps at 100:** seed 250 events; assert response has 100 rows newest-first, `nextCursorBefore` non-null pointing at the 100th row, `nextCursorAfter` non-null pointing at row 1 (the newest).
3a. **Empty event:** zero activity rows ever for an event; GET returns `rows: []`, both cursors null. Subsequent poll with no params returns the same shape until activity arrives.
3b. **After-cursor caught-up:** poll with `?after=<cursor-of-newest-row>` against an event that has no newer rows; response is empty BUT `nextCursorAfter === request.afterCursor` (no advance). Client recognizes this as "caught up" via cursor equality.
4. **`?after=cursor` ASC ordering:** seed 250 events with `created_at` separated by 10ms each; client polls with cursor encoded BEFORE row 1; assert response is 100 rows in ASC order (oldest-first), `nextCursorAfter` is the 100th row's cursor.
5. **Burst-drop integration test (epic AC #3):** seed 250 fresh rows; client polls with the cursor before any were inserted; loop polling using `nextCursorAfter` until null; assert ALL 250 rows consumed across exactly 3 cycles, in strictly ASC order, with zero duplicates and zero skips.
6. **Same-timestamp cursor stability (epic AC):** seed 5 rows with IDENTICAL `created_at` and 5 different IDs; client polls with `?after=<cursor-before-batch>`; assert all 5 returned in `id ASC` order, then `?after=<row5-cursor>` returns empty. Repeat with `?before=` for `id DESC`.
7. **`?before=cursor` DESC ordering:** seed 250 events; client backfills via `?before=<initial-newest-cursor>`; assert 100 rows DESC ordering older than the cursor, `nextCursorBefore` set.
8. **Both params reject:** `?after=x&before=y` → 400 `cursor_params_mutually_exclusive`.
9. **Malformed cursor:** `?after=not-base64` → 400 `invalid_cursor`. `?after=<base64-of-non-json>` → 400. `?after=<base64-json-missing-id>` → 400.
10. **Cross-event isolation:** seed 50 rows for event A and 50 for event B; GET /api/events/A/activity returns ONLY A's rows.
11. **Corrupt JSON row defense:** insert one row whose `payload_json` is `{"type":"score.committed"}` (missing required fields); assert response excludes that row, includes a warn-level log, OTHER rows still returned.

Tests use the same `file::memory:?cache=shared` URL + FK chain seed pattern as activity.test.ts (T8-1) — see `feedback_libsql_memory_shared_cache.md` memory entry.

### Layer 3 — Mount + barrel (`apps/tournament-api/src/app.ts`)

Add `app.route('/api/events', activityRouter)` alongside the existing `eventsLeaderboardRouter` mount. Order doesn't matter (Hono routes are tried in registration order; `/:eventId/activity` and `/:eventId/leaderboard` don't overlap).

### Layer 4 — Frontend: ActivityFeedProvider (`apps/tournament-web/src/providers/activity-feed-provider.tsx`, NEW directory + file)

Single root-mounted provider that drives the live polling subscription for the current event, exposed via React context. The Toast, Banner, and (future) T8-3 Feed all read from this ONE provider — no consumer instantiates its own poll, satisfying the singleton-poll invariant (epic AC g).

```tsx
type ActivityFeedContextValue = {
  rows: ActivityRow[];           // accumulated stream, newest-first (DESC)
  cursorAfter: string | null;    // for next live poll (server-managed)
  cursorBefore: string | null;   // for backfill (T8-3 will use)
  isPolling: boolean;
  error: ApiError | null;
  // Subscribe to NEW rows as they arrive (Toast/Banner consume this).
  // Handler receives ASC-ordered new rows.
  subscribe: (handler: (newRows: ActivityRow[]) => void) => () => void;
  // Imperative backfill (T8-3 "Load more" hooks this).
  loadMore: () => Promise<void>;
};
```

The context-value type uses `ActivityRow` (the wrapper from Layer 1) — NOT `ActivityEvent`. Toast and Banner consumers need `id` (for stable React keys when multiple events render simultaneously) and `createdAt` (for relative-time labels and storm-collapse window arithmetic). Wrapping the typed event keeps T8-1's `ActivityEvent` type untouched at the emitter layer (codex spec round-2 Med #4).

**Mount strategy (Codex-anticipated question).** The provider must know the current `eventId`. Two designs were considered:

1. **Mount at __root.tsx, parse eventId from URL** — mirrors T7-6's `extractEventIdFromLocation()` pattern at `__root.tsx:195-211`. Provider renders null when URL is not event-scoped.
2. **Mount inside event-scoped layout route** — `events.$eventId._layout.tsx` wraps Outlet with `<ActivityFeedProvider eventId={params.eventId}>`. More React-idiomatic.

**Decision: Option 1.** Justifications: (a) mirrors the existing T7-6 install-prompt-host pattern that proved out at trip-day (FD-14); (b) avoids creating a new `_layout.tsx` route file just for this provider; (c) the provider's no-op-when-not-event-scoped branch is identical to the Toast/Banner's natural empty-stream state, so there's no UX downside.

**Polling cadence + initial-load contract (codex spec round-1 High #4).** The provider has TWO modes, transitioning once on mount:

1. **Bootstrap fetch (mount-time, exactly once per provider instance):** `GET /api/events/:eventId/activity` with NO query params. Response is newest-100 in DESC order. Provider stores these in `rows[]` and captures the response's `nextCursorAfter` (newest row's cursor) for live polling.
2. **Live polls (every 5s thereafter):** `GET /api/events/:eventId/activity?after=<storedCursor>`. Response is rows in ASC order. Provider PREPENDS new rows to `rows[]` (since they're newer than everything already there) and updates the stored cursor to the response's `nextCursorAfter`.

This is what `useQuery` looks like (codex spec round-2 High #2 + High #3):

```ts
// Cursor + bootstrapped flag live in refs (NOT state) so updating them
// does NOT change the queryKey or trigger a re-subscription. The
// stable queryKey ['activity', eventId] is the load-bearing piece for
// the singleton invariant — every cursor change re-keying the query
// would create a new TanStack Query subscription per advance, defeating
// the singleton design (codex spec round-2 High #3).
const afterCursorRef = useRef<string | null>(null);
const bootstrappedRef = useRef(false);

const query = useQuery({
  queryKey: ['activity', eventId],  // STABLE across cursor advances
  queryFn: async () => {
    const cursor = afterCursorRef.current;
    const url = bootstrappedRef.current && cursor !== null
      ? `/api/events/${eventId}/activity?after=${encodeURIComponent(cursor)}`
      : `/api/events/${eventId}/activity`;
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new ApiError(res.status);
    const body = (await res.json()) as ActivityResponse;
    // After successful fetch: advance cursor + flip bootstrapped.
    // These are intentionally REF mutations, not setState — see queryKey
    // rationale above.
    if (body.nextCursorAfter !== null) {
      afterCursorRef.current = body.nextCursorAfter;
    }
    bootstrappedRef.current = true;
    // Burst-drop loop happens HERE inside queryFn (not on a separate
    // useEffect tick): if body.rows.length === 100 AND cursor advanced,
    // loop a fresh fetch immediately. See AC #7 for the loop contract.
    return body;
  },
  refetchInterval: 5_000,
  refetchIntervalInBackground: false,
  enabled: eventId !== null,
});
```

**Why refs for cursor + bootstrapped (codex spec round-2 High #3):** if these were `useState` and included in the `queryKey`, every cursor advance would CHANGE the query key. TanStack Query treats different keys as different queries — the cache would accumulate one entry per advance, AND the singleton invariant (one subscription) would break (each new key = new subscription). The fix is a STABLE `queryKey: ['activity', eventId]` with cursor state in refs. This is a documented TanStack Query pattern for stateful queryFn closures.

**The bootstrap → live transition (codex spec round-2 High #2):** the transition fires inside the queryFn AFTER the first successful fetch — `bootstrappedRef.current = true` and `afterCursorRef.current = body.nextCursorAfter`. The next 5s tick re-runs the queryFn, which now reads `bootstrappedRef.current === true` and `afterCursorRef.current !== null`, so it constructs the `?after=` URL. The transition is automatic and doesn't depend on a separate trigger.

**Subscriber invocation:** the queryFn is the right place to fire `subscribe()` callbacks because that's where new rows actually arrive. After updating `afterCursorRef`, before returning, the queryFn calls each registered subscriber with the new rows in chronological ASC order.

The 5s cadence matches the leaderboard polling rhythm (FD-5 "pull not push"). `refetchIntervalInBackground: false` so backgrounded tabs don't burn battery — polling resumes on focus.

**rows[] display order.** The provider's `rows` is canonically newest-first (DESC). The bootstrap fills it with the newest-100-DESC verbatim. Live polls receive ASC new rows but the provider PREPENDS them in newest-first order before storing — so `rows[]` always reads top-down newest-to-oldest for display consumers like the T8-3 feed.

**Subscriber payload.** When new rows arrive (live poll completes with N>0 new rows), the provider calls each subscriber's handler with the new rows in CHRONOLOGICAL ASC order — even though `rows[]` stores them DESC. ASC for subscribers makes the toast/banner render-order intuitive ("first event was X, then Y, then Z"). DESC for `rows[]` matches the natural display order of a reverse-chronological feed.

**Burst-drop loop (Codex High 2 in epic spec).** The provider's queryFn doesn't make ONE fetch and stop. After receiving a page, the loop continues if BOTH (a) response had 100 rows (page may have hit the limit, more might be waiting) AND (b) the response's `nextCursorAfter` ADVANCED past the request's after-cursor (the server returned newer-than-cursor rows). The loop terminates when EITHER:
- Response has fewer than 100 rows (server ran out of newer rows beyond the cursor), OR
- `response.nextCursorAfter === requestAfterCursor` (cursor did not advance — formal "caught up" signal regardless of page size), OR
- Three loop iterations have run (defensive cap — log a warning if exceeded; the burst-drop test asserts exactly-3 for the 250-row scenario).

This satisfies the "no events skipped" invariant when >100 events arrive between two 5s polls.

**Subscribe API.** `subscribe(handler)` returns an unsubscribe function. The provider tracks subscribers in a `Set<Handler>`. When new rows arrive (the queryFn loop completes), the provider calls every handler with the just-arrived rows in chronological order. Toast and Banner each register one subscriber on mount, unsubscribe on unmount. The handler payload is the slice of NEW rows since last poll, NOT the cumulative `rows` array — subscribers don't need to diff.

### Layer 5 — Frontend: hooks (`apps/tournament-web/src/hooks/use-activity-feed.ts`, NEW)

```ts
// Pulls the cumulative rows + state from context. Used by the (future T8-3) feed.
export function useActivityFeed(): {
  rows: ActivityRow[];
  cursorBefore: string | null;
  loadMore: () => Promise<void>;
  isPolling: boolean;
  error: ApiError | null;
};

// Subscribes to NEW rows only. Used by Toast + Banner.
// Handler receives `ActivityRow[]` (id + createdAt + event) in ASC order.
export function useActivityStream(handler: (newRows: ActivityRow[]) => void): void;
```

Both hooks throw `'must be within ActivityFeedProvider'` if called outside the provider tree (epic AC).

### Layer 6 — Frontend: TournamentToast (`apps/tournament-web/src/components/tournament-toast.tsx`, NEW)

Subscribes to `useActivityStream`. Filters to qualifying types:
- `score.committed` WHERE `isBirdieOrBetter === true`
- `press.auto_fired`
- `press.manual_fired`
- `award.triggered`

Other types are ignored at the toast surface (still flow into T8-3's feed). For each qualifying event, renders a transient card that auto-dismisses after 6 seconds. Stacking: multiple toasts render in a vertical stack; oldest at the bottom. Layout: slides in from top on mobile (`@media (max-width: 768px)`); top-right on desktop. CSS uses inline styles for parity with the T7-6 install-prompt component (no new CSS modules in tournament-web yet).

**Headline rendering per type** (Codex spec round-1 may want exact strings):
- `score.committed`: `"🐦 {playerId} scored {grossStrokes} on hole {holeNumber} — {birdie|eagle|albatross|condor}!"`
- `press.auto_fired`: `"⚡ Auto-press fired on hole {triggerHole}: Team {teamA|teamB} ({multiplier}x)"`
- `press.manual_fired`: `"🎯 {teamA|teamB} pressed from hole {fromHole} ({multiplier}x)"`
- `award.triggered`: `"🦅 First {birdie|eagle} of the trip — hole {context.holeNumber}!"`

**v1 simplification:** `playerId` is rendered as the raw ID string for v1. T8-3 will hydrate to player names via a `players` lookup; T8-2 keeps the toast/banner self-contained because the event payload doesn't include the player NAME (only ID). This is an explicit v1 acceptance — the trip is small enough that organizers can identify players by ID at first surface.

### Layer 7 — Frontend: TournamentBanner (`apps/tournament-web/src/components/tournament-banner.tsx`, NEW)

Subscribes to `useActivityStream`. Filters to money-affecting types:
- `press.auto_fired`
- `press.manual_fired`
- `rule_set.revised`
- `round.finalized`

Persists until user taps Dismiss. Dismissed activity IDs persist to localStorage under `tournament:banner-dismissed:<eventId>` so a page refresh doesn't resurrect them. Banner row re-render filters out any activity whose `id` is in the dismiss-set.

**Storm collapse (epic AC).** When ≥3 banner-eligible events arrive within a 5-second window (e.g., offline-drain replay after reconnect), the individual banners collapse into one summary banner: `"N updates ({press ×N1, rule-edit ×N2, round-finalized ×N3}) — tap to review"`. Tapping expands a modal listing all N events. Dismissing the summary marks all N as dismissed in localStorage atomically.

The 5-second window is computed from the FIRST event in the batch, not a rolling window — keeps the logic simple and predictable. Implementation: maintain a `pendingBatch` list; on each new banner-eligible event, push to `pendingBatch` AND start a 5s timer if not running. When timer fires, if `pendingBatch.length >= 3`, render summary; else flush each event as an individual banner.

**Unmount + edge cases (codex spec round-1 Low #7).** The 5s timer must be cleared in the component's `useEffect` cleanup (unmount). On unmount, any in-flight `pendingBatch` is DROPPED — events that were queued but never displayed are not "lost" (they're still in `rows[]` accessible via the future T8-3 feed); they just never surface as a banner. This is acceptable: banner is best-effort awareness, not durable notification. The component test asserts: (a) timer cleared on unmount; (b) re-mounting on the same eventId reads dismissed-state from localStorage; (c) re-mounting does NOT replay events that arrived during the unmounted window (the stream's subscriber was unregistered).

**Overlap with toast is intentional (Josh call 5 in epic spec).** Press events get BOTH an immediate-awareness toast (auto-dismiss 6s) AND a persist-until-ack banner (money-affecting). `rule_set.revised` + `round.finalized` are banner-only (the toast surface filters them out — only birdie/press/award qualify).

### Layer 8 — Wire ActivityFeedProvider into __root.tsx

```tsx
function RootComponent() {
  return (
    <FirstMutationProvider>
      <ActivityFeedProvider>
        <div>
          <Outlet />
          <InstallPromptHost />
          <TournamentToast />
          <TournamentBanner />
        </div>
      </ActivityFeedProvider>
    </FirstMutationProvider>
  );
}
```

Toast + Banner are mounted alongside InstallPromptHost as global UI. Both are no-ops on routes without an event context (the provider's eventId is null → empty stream → nothing renders).

### Layer 9 — Component tests

- `apps/tournament-web/src/components/tournament-toast.test.tsx` (NEW) — verifies (a) auto-dismiss at 6s via fake timers; (b) qualifying-type filter (score.committed without isBirdieOrBetter is suppressed); (c) stack rendering for multiple events.
- `apps/tournament-web/src/components/tournament-banner.test.tsx` (NEW) — verifies (a) persistence until dismiss; (b) localStorage survives remount (renders with same eventId, dismiss state restored); (c) storm collapse (3 events within 5s → 1 summary); (d) modal expansion; (e) dismiss-summary marks all N atomic.
- `apps/tournament-web/src/providers/activity-feed-provider.test.tsx` (NEW) — verifies (a) burst-drop loop (mock 250-row server, assert 3 fetch cycles); (b) singleton invariant (mount Toast + Banner + a synthetic feed consumer; assert exactly ONE TanStack Query subscription per 5s window via spying on the queryFn); (c) subscriber ordering (subscribers receive new rows in `created_at ASC, id ASC` chronological order); (d) hooks-outside-provider throws.
- `apps/tournament-web/src/hooks/use-activity-feed.test.tsx` (NEW) — small unit tests for the `must be within ActivityFeedProvider` error message and successful context-read.

### Layer 10 — Sprint-status

Flip `T8-2` from `backlog → ready-for-dev → in-progress → review → done` through the cycle. No epic flag changes needed (epic-T8 is already `in-progress`).

## Acceptance Criteria

**AC #1 — Backend route shape + auth.**

**Given** `apps/tournament-api/src/routes/activity.ts`
**When** inspected
**Then** it exports `activityRouter`, mounted in `app.ts` as `app.route('/api/events', activityRouter)`. The route `GET /:eventId/activity` is gated by `requireSession` then `requireEventParticipant`. Caller without session → 401; caller with session but not a participant → 403; valid participant → 200.

**AC #2 — Cursor pagination semantics.**

**Given** `?after=<cursor>` (decoded `{createdAt, id}`)
**When** processed
**Then** the WHERE clause filters `created_at > X OR (created_at = X AND id > Y)`, ORDER BY `created_at ASC, id ASC`, LIMIT 100. The `id ASC` tiebreaker is load-bearing — without it, rows sharing a `created_at` paginate non-deterministically.

**Given** `?before=<cursor>`
**When** processed
**Then** WHERE filters `created_at < X OR (created_at = X AND id < Y)`, ORDER BY `created_at DESC, id DESC`, LIMIT 100.

**Given** neither query param
**When** processed
**Then** returns the newest 100 rows DESC. `nextCursorAfter` is set to the cursor of the NEWEST row in the response (always, when the response is non-empty). `nextCursorBefore` is set to the cursor of the OLDEST row in the response. Both cursors null only when the response is completely empty (zero activity rows for this event ever).

**Given** both `?after` AND `?before` are present
**When** processed
**Then** returns `400 { error: 'bad_request', code: 'cursor_params_mutually_exclusive' }`.

**Given** a malformed cursor (non-base64, non-JSON, missing keys, wrong types)
**When** processed
**Then** returns `400 { error: 'bad_request', code: 'invalid_cursor' }`.

**AC #3 — Burst-drop invariant (Codex High 2 in epic spec).**

**Given** 250 fresh rows seeded for event E with strictly-increasing `created_at` (10ms steps)
**When** a client polls `?after=<cursor-before-row-1>` and loops while `nextCursorAfter !== null`
**Then** all 250 rows are consumed across exactly 3 poll iterations (100 + 100 + 50), in strictly ASC order, with zero duplicates and zero skips. The integration test at `apps/tournament-api/src/routes/activity.integration.test.ts` asserts this explicitly.

**AC #4 — Same-timestamp cursor stability.**

**Given** 5 rows for event E with IDENTICAL `created_at` ms but distinct UUIDs
**When** the client paginates with `?after=` then `?before=`
**Then** the rows return in deterministic `id ASC` (after) and `id DESC` (before) order, and the post-batch cursor returns empty.

**AC #5 — Corrupt JSON row defense.**

**Given** an `activity` row whose `payload_json` fails Zod parse (e.g. missing required field added by a future schema bump)
**When** the route response is built
**Then** that row is excluded from `rows` AND a warning is logged (`level='warn'`, with the row id and the parse error). Other rows are returned. The route does NOT 500.

**AC #6 — Singleton ActivityFeedProvider.**

**Given** `apps/tournament-web/src/providers/activity-feed-provider.tsx`
**When** inspected
**Then** the provider mounts at `__root.tsx` (above Toast + Banner + Outlet) and uses ONE `useQuery` subscription with a 5-second `refetchInterval`. Toast, Banner, and any future feed consumer ALL read from the same context — none instantiates its own poll. The provider component reads `eventId` from the URL via `extractEventIdFromLocation()` (mirroring T7-6's pattern at __root.tsx:195-211) and renders its children with a null/empty stream when no eventId is present.

**AC #7 — Burst-drop client loop.**

**Given** the provider's queryFn receives a 100-row page with `nextCursorAfter !== null`
**When** the queryFn returns
**Then** the provider does NOT wait for the next 5s tick; it loops a fresh fetch immediately, accumulates rows, and continues until either (a) response has fewer than 100 rows, OR (b) `response.nextCursorAfter === requestAfterCursor` (cursor did not advance — explicit "caught up"), OR (c) 3 loop iterations have run (defensive cap; a warning is logged on the 3rd-iteration boundary). The provider test asserts exactly 3 cycles for a 250-row queue.

**AC #8 — Hooks contract.**

**Given** `apps/tournament-web/src/hooks/use-activity-feed.ts`
**When** inspected
**Then** it exports `useActivityFeed()` returning `{rows: ActivityRow[], cursorBefore, loadMore, isPolling, error}` and `useActivityStream(handler: (newRows: ActivityRow[]) => void)` registering a subscriber. Both hooks throw `'must be within ActivityFeedProvider'` if called outside the provider tree. The `rows` array is newest-first DESC for display; the subscriber handler receives ASC-ordered new rows.

**AC #9 — Toast.**

**Given** `apps/tournament-web/src/components/tournament-toast.tsx`
**When** the activity stream emits a qualifying type (`score.committed && isBirdieOrBetter`, `press.auto_fired`, `press.manual_fired`, `award.triggered`)
**Then** a toast renders with the type-appropriate headline, auto-dismisses after 6 seconds, and is positioned per the mobile/desktop CSS rules. Non-qualifying types are silently ignored.

**Given** the test at `tournament-toast.test.tsx`
**When** run with fake timers
**Then** verified: 6s auto-dismiss; non-qualifying type filtered out; multi-toast stack rendering.

**AC #10 — Banner.**

**Given** `apps/tournament-web/src/components/tournament-banner.tsx`
**When** the stream emits a money-affecting type (`press.auto_fired`, `press.manual_fired`, `rule_set.revised`, `round.finalized`)
**Then** a banner renders, persists until tapped Dismiss, and the dismissed `activity.id` is stored in localStorage under `tournament:banner-dismissed:<eventId>` so the banner does not resurrect on page refresh.

**Given** ≥3 banner-eligible events arrive within a 5-second window
**When** processed
**Then** they collapse into a single summary banner (`"N updates ({type-counts}) — tap to review"`). The 5-second window is anchored on the first event in the batch. Tapping expands a modal listing all N events. Dismissing the summary marks all N as dismissed atomically.

**Given** the test at `tournament-banner.test.tsx`
**When** run
**Then** verified: persistence until dismiss; localStorage survives remount; storm collapse (3 within 5s → 1 summary); modal expansion; atomic dismiss of summary.

**AC #11 — Singleton subscription invariant (codex spec round-1 High #3).**

**Given** the provider test at `activity-feed-provider.test.tsx`
**When** Toast + Banner + a synthetic feed consumer are all mounted simultaneously inside one `<ActivityFeedProvider>`
**Then** the test asserts there is exactly ONE TanStack Query subscription registered (regardless of consumer count). Concretely: spy on the provider's queryFn (the function passed to `useQuery`); mount Toast + Banner + synthetic consumer; advance fake timers by 5 seconds; assert the queryFn was registered exactly once.

**Important nuance**: the queryFn may be CALLED multiple times within a single 5-second window during burst-drop catch-up (per AC #7's loop). The invariant is "one SUBSCRIPTION per provider instance", NOT "one fetch call per 5s window". Three independent subscriptions would mean three separate 5s ticks producing 3× fetches; one subscription with burst-drop catch-up is correct behavior.

**Test implementation pattern (codex spec round-2 Med #5):** the canonical assertion is the TanStack Query cache shape:

```ts
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
render(
  <QueryClientProvider client={queryClient}>
    <ActivityFeedProvider eventId="evt-test">
      <TournamentToast />
      <TournamentBanner />
      <SyntheticConsumer />  {/* useActivityStream(...) */}
    </ActivityFeedProvider>
  </QueryClientProvider>
);
await act(() => /* let queries register */);
// Singleton invariant: exactly one query in the cache for ('activity', eventId).
const activityQueries = queryClient.getQueryCache().getAll().filter(
  (q) => q.queryKey[0] === 'activity' && q.queryKey[1] === 'evt-test',
);
expect(activityQueries).toHaveLength(1);
```

This is the load-bearing assertion: three consumers must NOT produce three separate query cache entries. The queryFn-call-count is incidental (1 baseline + N for burst-drop catch-up is correct behavior); what matters is that there is ONE subscription powering all consumers. The cache-count check is unambiguous because it doesn't conflate "subscriptions" with "fetches".

**AC #12 — __root.tsx wiring.**

**Given** `apps/tournament-web/src/routes/__root.tsx`
**When** inspected
**Then** `<ActivityFeedProvider>` wraps `<Outlet />`, `<InstallPromptHost />`, `<TournamentToast />`, and `<TournamentBanner />`. The provider sits ABOVE Toast and Banner in the tree (so the hooks resolve to its context). FirstMutationProvider remains the outermost wrapper (T7-6 contract).

## Tasks / Subtasks

- [ ] **Task 1 — Backend cursor helper + route + tests (AC #1–#5).**
  - [ ] Write `apps/tournament-api/src/services/activity-cursor.ts` with `encodeCursor({createdAt, id})` and `decodeCursor(s)` (returns parsed object or throws). Cursor uses `base64url` to avoid URL-encoding `+/=` issues.
  - [ ] Write `apps/tournament-api/src/routes/activity.ts` exporting `activityRouter`. Implement the three branches (after/before/neither) with the strict-newer/strict-older WHERE clauses. Decode each row's `payload_json` via the matching Zod schema; filter out parse failures with a warn-level log.
  - [ ] Mount in `apps/tournament-api/src/app.ts` via `app.route('/api/events', activityRouter)`.
  - [ ] Write `apps/tournament-api/src/routes/activity.integration.test.ts` covering all 11 cases enumerated in Layer 2.

- [ ] **Task 2 — ActivityFeedProvider + hooks (AC #6–#8, #11).**
  - [ ] Create directory `apps/tournament-web/src/providers/`.
  - [ ] Write `activity-feed-provider.tsx` per Layer 4 — useQuery subscription, burst-drop loop with 3-iteration cap, subscriber Set, eventId-from-URL detection.
  - [ ] Write `apps/tournament-web/src/hooks/use-activity-feed.ts` exporting both hooks per Layer 5.
  - [ ] Write `activity-feed-provider.test.tsx` + `use-activity-feed.test.tsx` per Layer 9.

- [ ] **Task 3 — TournamentToast (AC #9).**
  - [ ] Write `apps/tournament-web/src/components/tournament-toast.tsx` per Layer 6.
  - [ ] Write `tournament-toast.test.tsx` per Layer 9 (fake timers).

- [ ] **Task 4 — TournamentBanner (AC #10).**
  - [ ] Write `apps/tournament-web/src/components/tournament-banner.tsx` per Layer 7 — including localStorage dismiss state and the storm-collapse logic.
  - [ ] Write `tournament-banner.test.tsx` per Layer 9.

- [ ] **Task 5 — __root.tsx wiring (AC #12).**
  - [ ] Update `apps/tournament-web/src/routes/__root.tsx` to wrap `<ActivityFeedProvider>` around the existing tree, and mount `<TournamentToast />` + `<TournamentBanner />` alongside `<InstallPromptHost />`.

- [ ] **Task 6 — Regression sweep.**
  - [ ] `pnpm --filter @tournament/api test` — every previously-passing test still passes; +N tests for activity route.
  - [ ] `pnpm --filter @tournament/web test` — every previously-passing test still passes; +N tests for provider/toast/banner/hooks.
  - [ ] `pnpm -r typecheck` and `pnpm -r lint` — clean.

## Files this story will edit

- apps/tournament-api/src/services/activity-cursor.ts
- apps/tournament-api/src/services/activity-cursor.test.ts
- apps/tournament-api/src/routes/activity.ts
- apps/tournament-api/src/routes/activity.integration.test.ts
- apps/tournament-api/src/app.ts
- apps/tournament-web/src/providers/activity-feed-provider.tsx
- apps/tournament-web/src/providers/activity-feed-provider.test.tsx
- apps/tournament-web/src/hooks/use-activity-feed.ts
- apps/tournament-web/src/hooks/use-activity-feed.test.tsx
- apps/tournament-web/src/components/tournament-toast.tsx
- apps/tournament-web/src/components/tournament-toast.test.tsx
- apps/tournament-web/src/components/tournament-banner.tsx
- apps/tournament-web/src/components/tournament-banner.test.tsx
- apps/tournament-web/src/routes/__root.tsx
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

## Dev Notes

### Architectural alignment

- **FR-C3**: "in-app surfaces (toast, banner, feed)" requirement satisfied by Toast + Banner here; Feed lands in T8-3.
- **FD-5** ("pull not push"): the 5s polling cadence + stream-on-pull contract is the literal embodiment. No push notifications, no SMS, no email anywhere in the pipeline.
- **D3-4** (singleton invariant): the provider exists specifically to prevent the "three consumers, three polls" footgun. AC #11's HTTP-layer spy is the load-bearing test.
- **T8-1 spine**: this story consumes the typed `ActivityEvent` discriminated union and the same `activityEventSchemas` Zod schemas for parse-on-decode defense.

### Key references

- **events-leaderboard.ts** route shape: existing `requireSession + requireEventParticipant + Hono GET handler` template at `apps/tournament-api/src/routes/events-leaderboard.ts:47-75`. New activity route mirrors the auth chain + 404-on-unknown-event posture.
- **install-prompt host pattern**: `__root.tsx:75-211` shows the URL-based eventId detection + extractEventIdFromLocation regex pattern that the ActivityFeedProvider mirrors.
- **T7-6 install-prompt component**: `apps/tournament-web/src/components/install-prompt.tsx` — inline-style, no new CSS modules, follows the same posture this story uses for Toast/Banner.
- **T8-1 emitter + Zod schemas**: `apps/tournament-api/src/lib/activity.ts` + `apps/tournament-api/src/engine/types/activity-events.ts` — the read-side decoders should reuse `activityEventSchemas[type].parse(payload)` so encode/decode share validation rules.

### Risk acceptance

- **5-second polling battery cost on backgrounded tabs**: `refetchIntervalInBackground: false` keeps the tab quiet when not focused. Trip-day batteries matter.
- **Burst-drop 3-iteration cap**: a runaway burst (>300 events between polls) hits the cap and logs a warn; the next 5s tick resumes catch-up. Acceptable for v1 — Pinehurst-scale event volume is well under 300/5s.
- **Player NAME hydration deferred to T8-3**: Toast/Banner v1 render `playerId` as the raw ID. T8-3's feed will hydrate via a `players` lookup. Trip-day organizer experience is acceptable since the foursome size is small enough to ID-match mentally.
- **localStorage banner-dismiss persistence is per-eventId**: cross-event dismissals don't leak (`tournament:banner-dismissed:<eventId>` key includes eventId). Multiple events on the same device persist independently.
- **No SSE / no WebSocket**: explicitly out of scope per FD-5. Polling at 5s is the architecture, not a temporary v1 stopgap.

### Followups

- **Player-name hydration in Toast/Banner** (v1.5) — pull names from a tiny `players` lookup query so toasts read "Rick birdied 11" instead of "{rick-uuid} birdied 11". Trip 1 acceptable as-is.
- **Toast / Banner CSS modules** — current spec inlines styles per T7-6 convention. v1.5 polish would extract into modules + design-token usage.
- **Burst-drop cap config** — the 3-iteration safeguard is hardcoded. v1.5 could expose via env/config for trips with bigger volume.
- **Visual aid for storm-collapse modal** — current "N updates" summary is text-only. v1.5 could add type-color icons for at-a-glance scanning.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Opus 4.7, 1M context)

### Debug Log References

### Completion Notes List

### File List
