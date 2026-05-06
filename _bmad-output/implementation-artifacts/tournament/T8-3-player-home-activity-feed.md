# T8-3: Player-Home Activity Feed (FR-C3, FD-5)

## Status

ready-for-dev

## Story

As any Event participant, I want a "What's Happening" feed on the Event home page showing recent activity in reverse-chronological order with a "Load more" button paginating via `?before=<cursor>`, so that between shots I can glance at the app and see everything that just happened, and scroll back through earlier events without gaps (FR-C3, FD-5 "pull not push").

## v1 Scope

Pure frontend story. T8-1 ships the activity table + emitter. T8-2 ships the read API + ActivityFeedProvider that lives at root, polls every 5s, and exposes `rows` (newest-first DESC), `cursorBefore`, and `loadMore()`. T8-3 adds the visible feed surface that consumes that provider context.

### Layer 1 — `apps/tournament-web/src/components/activity-feed.tsx` (NEW)

A scrollable list component that consumes `useActivityFeed()` from the existing provider. Renders:

- An empty-state card when `rows.length === 0`: `"Activity will show here once scoring starts."` (the epic spec's countdown variant is deferred — see Followups; the current EventHomePage already shows the round countdown above this surface).
- For each visible row: an icon + headline + relative time, with a tap target that routes to the relevant surface (score → leaderboard; press → money page; rule_set → leaderboard for the affected round; gallery → gallery; subgame → money; round.finalized → leaderboard).
- A "Load more" button below the list when the user has more rows to reveal (visible-count cap below `rows.length`) OR the provider can backfill (`cursorBefore !== null`).

**Visible-count state + concurrency guard (codex spec round-1 High #1, round-2 High #1).** The feed maintains local `visibleCount` (default 20), `loadingMore: boolean` state for the UI (disables the button), AND a `loadingMoreRef: useRef<boolean>` synchronous guard. The synchronous ref is load-bearing — React state updates are asynchronous; a rapid double-click can fire a second handler call BEFORE `setState(loadingMore=true)` has flushed, and only the synchronous ref prevents the duplicate `loadMore()` call.

The handler:
```ts
async function onLoadMoreClick() {
  if (loadingMoreRef.current) return;            // synchronous re-entry guard
  if (visibleCount < rows.length) {
    setVisibleCount((v) => Math.min(v + 20, rows.length));
    return;
  }
  if (cursorBefore === null) return;             // end of history
  loadingMoreRef.current = true;
  setLoadingMore(true);
  try {
    await loadMore();
    setVisibleCount((v) => v + 20);              // cap-by-render via slice
  } finally {
    loadingMoreRef.current = false;
    setLoadingMore(false);
  }
}
```

The button's `disabled` attribute is bound to `loadingMore` (state, for visual feedback) but the handler's first line checks `loadingMoreRef.current` (ref, for re-entry). Both are necessary — the state drives the rendered disabled appearance; the ref prevents the millisecond-window race the spec round-2 codex flagged.

The button is hidden (NOT just disabled) when both `visibleCount >= rows.length` AND `cursorBefore === null` — that's the "end of history" state.

**Empty-state precedence (codex spec round-1 High #2).** When `rows.length === 0`, the feed renders the empty-state card AND no Load more button — regardless of `cursorBefore`. The Load more button is only visible when there is at least one row to anchor the operation against. (cursorBefore could in edge cases be non-null with rows empty if the provider's bootstrap captured a backfill cursor before rows arrived; the feed's safer posture is "no rows = empty state, period".)

This two-stage pattern (slice locally first, then backfill) is what the epic's AC literally describes — "shows the newest 20 events from the provider's current state" + "fires `?before=` via a query imperatively". It also keeps the UI responsive even when the provider has 100+ rows already cached: the user sees an instant 20→40 reveal before the network round-trip.

**Live event prepend.** Already handled by the provider — `rows[]` is updated whenever a live poll picks up new rows, with newest prepended. The feed re-renders automatically because `rows` is reactive context. The feed does NOT re-fetch the historical page on a live event arrival (epic AC).

**Headline rendering per type.** Same conventions as TournamentToast (T8-2):

- `score.committed`: `"{playerId} scored {grossStrokes} on hole {holeNumber} — {descriptor}"` (using `toPar` to derive the descriptor). Renders for ALL score commits — the feed is the persistent record (epic note: "feed ≠ banner — feed is persistent historical record"). **Complete `toPar → descriptor` mapping (codex spec round-1 Med #4):**

  | toPar | descriptor       |
  |-------|------------------|
  | ≤-4   | condor           |
  | -3    | albatross        |
  | -2    | eagle            |
  | -1    | birdie           |
  | 0     | par              |
  | 1     | bogey            |
  | 2     | double bogey     |
  | 3     | triple bogey     |
  | ≥4    | "+{toPar}"       |

  The `≤-4` floor guards against any future relaxation of T8-1's Zod min(-4) bound (codex spec round-2 Med #3); today the schema only emits values in `[-4, 17]`, but the helper is defensive.

  The Toast surface (T8-2) uses the same descriptors but only when `isBirdieOrBetter === true` (toPar < 0); the feed uses them across the full range so even a par or bogey shows up in the historical record.
- `score.corrected`: `"Corrected by {actorPlayerId}: hole {holeNumber}, {priorGross} → {newGross}"` — uses inline `priorGross` + `newGross` (T8-1 typed payload) so no secondary join needed.
- `scorer.transferred`: `"Scorer transferred: {fromPlayerId} → {toPlayerId} (foursome {foursomeNumber})"`.
- `round.finalized`: `"Round finalized"`.
- `round.cancelled`: `"Round cancelled"`.
- `press.auto_fired`: `"Auto-press fired (hole {triggerHole}, {team} {multiplier}x)"` — same string used in TournamentBanner. Banner copy shared via a small helper (see Layer 2).
- `press.manual_fired`: `"{team} pressed from hole {fromHole} ({multiplier}x)"`.
- `press.manual_undone`: `"Press undone"`.
- `bet.created`: `"New bet: {betType} ({playerAId} vs {playerBId}, ${stakePerHoleCents/100}/hole)"`.
- `rule_set.revised`: `"Rule set revised"`.
- `subgame.computed`: `"Sub-game computed: {subGameId} (${totalPotCents/100} pot)"`.
- `gallery.uploaded`: `"Photo uploaded"`.
- `award.triggered`: `"First {awardType: birdie|eagle} of the trip — hole {context.holeNumber}!"`. (No trophy emoji in the headline — the row's leading icon column already renders 🏆 per the icon table below; codex spec round-1 Low #7.)

Player-name hydration is OUT OF SCOPE for v1 (same posture as T8-2 Toast/Banner — raw playerId rendered; documented v1.5 followup). The score-correction "Corrected by {actorPlayerId}" wording matches the epic AC ("Corrected by {actor}").

**Icon per type.** A small lookup table keyed off `event.type` returns an emoji or single-character glyph rendered as the row's leading marker:
- `score.committed` → 🏌️
- `score.corrected` → ✏️
- `scorer.transferred` → 🔄
- `round.finalized` → ✅
- `round.cancelled` → ✖️
- `press.auto_fired` → ⚡
- `press.manual_fired` → 🎯
- `press.manual_undone` → ↩️
- `bet.created` → 🤝
- `rule_set.revised` → 📋
- `subgame.computed` → 💰
- `gallery.uploaded` → 📷
- `award.triggered` → 🏆

**Relative time.** `createdAt` is integer ms-since-epoch UTC (T8-1's emitter contract; T8-2's ActivityRow type carries `createdAt: number` directly). The helper computes `Math.max(0, Math.floor((Date.now() - createdAt) / 1000))` to get seconds (`Math.max(0, ...)` clamps clock-skew negative values; future-dated rows render as "just now" — codex spec round-2 Low #4) and labels it as "just now" (≤30s), "{N}s ago" (31-59s), "{N}m ago" (1-59min), "{N}h ago" (1-23h), "{N}d ago" (≥24h). No `Date.parse()` is needed — the type is already number, not string. The feed re-computes on each render — no per-row timer because the provider's 5s refetchInterval already triggers a re-render whenever new activity lands.

**Tap routing (codex spec round-1 Med #6).** Each row is wrapped in a TanStack Router `<Link>` (or rendered without a wrapper for non-navigating types). TanStack Router's `<Link>` takes `to` (the route id with `$param` placeholders) + `params` (the substitution map). EventHomePage already uses this pattern at `events.$eventId.index.tsx:227-229` (`<Link to={card.to} params={{ eventId }}>`). The feed mirrors that.

| Type                    | `to`                                          | `params`                          |
|-------------------------|-----------------------------------------------|-----------------------------------|
| `score.committed`       | `/events/$eventId/leaderboard`                | `{ eventId }`                     |
| `score.corrected`       | `/events/$eventId/leaderboard`                | `{ eventId }`                     |
| `scorer.transferred`    | `/rounds/$roundId/score-entry`                | `{ roundId }`                     |
| `round.finalized`       | `/events/$eventId/leaderboard`                | `{ eventId }`                     |
| `round.cancelled`       | (no link — render plain `<div>`)              | (n/a)                             |
| `press.auto_fired`      | `/events/$eventId/money`                      | `{ eventId }`                     |
| `press.manual_fired`    | `/events/$eventId/money`                      | `{ eventId }`                     |
| `press.manual_undone`   | `/events/$eventId/money`                      | `{ eventId }`                     |
| `bet.created`           | `/events/$eventId/bets`                       | `{ eventId }`                     |
| `rule_set.revised`      | `/events/$eventId/leaderboard`                | `{ eventId }`                     |
| `subgame.computed`      | `/events/$eventId/money`                      | `{ eventId }`                     |
| `gallery.uploaded`      | `/events/$eventId/gallery`                    | `{ eventId }`                     |
| `award.triggered`       | `/events/$eventId/leaderboard`                | `{ eventId }`                     |

`eventId` is read from `row.event.eventId` (the typed payload — required on every variant per T8-1). `roundId` for `scorer.transferred` is read from `row.event.roundId` (variant-required for that type). All twelve `to` values resolve against routes that exist in `apps/tournament-web/src/routes/` today (verified by grep against the routes directory).

### Layer 2 — Shared headline helper (`apps/tournament-web/src/lib/activity-headline.ts`, NEW)

Both the feed and the toast/banner build headlines from `ActivityRow.event` payloads. T8-2 inlined string-building per component because the consumers diverged in tone (toast emoji-heavy, banner terse). T8-3's feed adds a third consumer that needs DIFFERENT wording (more neutral, pluralized, includes more variants). Rather than triplicate, extract a helper:

```ts
export type HeadlineSurface = 'toast' | 'banner' | 'feed';
export function buildActivityHeadline(
  row: ActivityRow,
  surface: HeadlineSurface,
): string;
```

The helper switches on `(row.event.type, surface)` and returns the appropriate copy. This consolidation is the right time to extract — the existing T8-2 code paths inline the same string-building twice with diverging copy, and T8-3 would make it a third inline copy. The helper is a pure function, ~80 lines, fully unit-testable. T8-2's `tournament-toast.tsx` and `tournament-banner.tsx` are migrated to use it; their existing tests continue to pass because the externally observable copy is preserved (codex spec round-1 may call this out as a refactor that's wider than T8-3 — accepted because the consolidation pays back when T8-4's award surfaces also need a fourth copy variant).

### Layer 3 — Wire the feed into EventHomePage

Add `<ActivityFeed />` below the entry cards `<nav>` block at `apps/tournament-web/src/routes/events.$eventId.index.tsx:223-245`. Position: directly after the `</nav>` close. No props needed — the feed reads `eventId` from URL via the provider, same as Toast/Banner.

### Layer 4 — Component test (`apps/tournament-web/src/components/activity-feed.test.tsx`, NEW)

Uses the same StubProvider pattern as `tournament-banner.test.tsx` — a mock context that exposes `rows`, `cursorBefore`, `loadMore`, `subscribe`, `isPolling`, `error`. Tests mock `useActivityFeed` directly (not through the real provider) so the feed surface is tested in isolation.

Coverage:

- **Empty state**: `rows: []` → renders the "Activity will show here once scoring starts." card; no Load more button.
- **20-event initial render**: `rows: 20` events → 20 list entries, no Load more (visible count = rows.length AND cursorBefore = null).
- **20-event with cursorBefore non-null**: 20 events but `cursorBefore: 'cursor-x'` → Load more button visible; clicking it calls `loadMore()` exactly once.
- **40-event with visibleCount=20**: 40 events in rows, but only first 20 rendered. Load more click reveals next 20 (visibleCount → 40), no `loadMore()` call needed (rows already had them).
- **Load more after slice catches up**: 20 events with cursorBefore non-null → click Load more → assert `loadMore()` was called → mock provider appends 20 more rows + advances cursor → next click increases visibleCount.
- **Live-event prepend**: simulate provider rows changing (newest row added) → feed re-renders with new row at top; visibleCount unchanged.
- **Score-correction inline rendering**: a `score.corrected` row in `rows` → headline includes both `priorGross` and `newGross` AND the actor.
- **Relative time across fixture timestamps**: render rows with `createdAt` values 5s, 30s, 5min, 2h, 3d ago → assert each row's time label matches the buckets.
- **Tap routing**: a `score.committed` row's wrapping element is a Link with `to="/events/{eventId}/leaderboard"`.
- **Round.cancelled non-link**: a `round.cancelled` row renders WITHOUT a Link wrapper (no route mapping).

### Layer 5 — EventHomePage integration test

Add a single test in `events.$eventId.index.test.tsx` (existing) that mounts EventHomePage and asserts `<ActivityFeed />` is rendered (look for the empty-state testid OR the feed-list testid). Verifies the wiring without re-testing the feed's internals.

### Layer 6 — Sprint-status hygiene

Flip T8-3 from `backlog → ready-for-dev → in-progress → review → done` through the cycle. No epic-flag changes needed (epic-T8 is `in-progress`).

## Acceptance Criteria

**AC #1 — ActivityFeed component exists and consumes the provider.**

**Given** `apps/tournament-web/src/components/activity-feed.tsx`
**When** inspected
**Then** it imports `useActivityFeed` from `../hooks/use-activity-feed` and reads `{rows, cursorBefore, loadMore, isPolling, error}`. The component does NOT call `fetch` directly NOR mount its own `useQuery` — the provider is the singleton (T8-2 invariant).

**AC #2 — Initial render: newest 20 events.**

**Given** the provider's `rows` contains 50 events
**When** ActivityFeed renders for the first time
**Then** the rendered list shows the 20 newest rows (rows[0..20], DESC). A "Load more" button is visible below the list because there are more rows.

**AC #3 — Load more advances visibleCount THEN backfills.**

**Given** ActivityFeed has `visibleCount=20` and `rows.length=40`
**When** the user taps Load more
**Then** the rendered list grows to 40 rows; `loadMore()` is NOT called (provider already has them); the button remains visible only if `cursorBefore !== null`.

**Given** ActivityFeed has `visibleCount=20` and `rows.length=20` and `cursorBefore !== null`
**When** the user taps Load more
**Then** the provider's `loadMore()` is called exactly once; after the provider's rows[] grows, visibleCount also advances (capped to the new rows.length).

**AC #4 — Empty state.**

**Given** `rows.length === 0`
**When** ActivityFeed renders
**Then** the empty-state card renders with copy "Activity will show here once scoring starts." (or equivalent reading-friendly variant); no Load more button is rendered.

**AC #5 — Live event prepend.**

**Given** the user is viewing the feed with `visibleCount=20` and the provider's `rows` then receives a new event at index 0 (live poll)
**When** the feed re-renders
**Then** the new row appears at the top of the rendered list; visibleCount unchanged (still 20, but the slice now ends one index later); no historical re-fetch is triggered.

**AC #6 — Score-correction inline rendering.**

**Given** a `score.corrected` row in `rows`
**When** rendered
**Then** the headline contains both `priorGross` and `newGross` values inline AND a "Corrected by {actorPlayerId}" attribution. The component does NOT join against any other data source for these values (T8-1's typed payload carries them).

**AC #7 — Relative time.**

**Given** rows with `createdAt` values N seconds/minutes/hours/days in the past
**When** rendered
**Then** each row's time label is one of: "just now" (≤30s), "{N}s ago" (31-59s), "{N}m ago" (1-59min), "{N}h ago" (1-23h), "{N}d ago" (≥24h).

**AC #8 — Tap routing.**

**Given** rows of all 13 ActivityType values
**When** rendered
**Then** each row whose type is in the routing table (12 of 13; `round.cancelled` excluded) is wrapped in a TanStack Router `<Link>` whose `to` is the placeholder-form route id (e.g. `to="/events/$eventId/leaderboard"`) and `params` is the substitution object (e.g. `{ eventId: row.event.eventId }`) — matching the existing pattern at `events.$eventId.index.tsx:227-229`. The TEST asserts on the rendered anchor's `href` (resolved post-Link-substitution; `/events/{actual-event-id}/leaderboard`), NOT on the `to` placeholder string. `round.cancelled` rows render without a Link wrapper (a plain `<div>`).

**AC #9 — Headline helper extracted + Toast/Banner migrated.**

**Given** `apps/tournament-web/src/lib/activity-headline.ts`
**When** inspected
**Then** it exports `buildActivityHeadline(row, surface)` returning per-type strings keyed off `(row.event.type, surface)`. `surface` is `'toast' | 'banner' | 'feed'`. The function is a pure mapping with no side effects.

**Given** `apps/tournament-web/src/components/tournament-toast.tsx` and `tournament-banner.tsx`
**When** inspected
**Then** both files now call `buildActivityHeadline(row, 'toast')` / `buildActivityHeadline(row, 'banner')` instead of inlining the string-building. The externally-observable copy is preserved (T8-2 component tests still pass without modification).

**AC #10 — Component test coverage.**

**Given** `apps/tournament-web/src/components/activity-feed.test.tsx`
**When** the new tests run
**Then** all 10 cases enumerated in Layer 4 are verified.

**Given** `apps/tournament-web/src/lib/activity-headline.test.ts` (NEW)
**When** the new tests run
**Then** each of the 13 types has at least one valid (row → expected string) assertion per surface (toast / banner / feed) — that's up to 39 assertions, but many types render identically across surfaces (e.g., `gallery.uploaded` is "Photo uploaded" everywhere); the test file groups by type and asserts the surface-specific deviations explicitly.

**AC #11 — EventHomePage wiring.**

**Given** `apps/tournament-web/src/routes/events.$eventId.index.tsx`
**When** inspected
**Then** `<ActivityFeed />` is rendered below the entry cards `<nav>` block. The component receives no props — eventId is read from URL via the provider.

**Given** the existing test at `events.$eventId.index.test.tsx`
**When** updated
**Then** asserts that the feed surface (its test-id anchor) is present in the rendered output.

## Tasks / Subtasks

- [ ] **Task 1 — Headline helper (AC #9).**
  - [ ] Write `apps/tournament-web/src/lib/activity-headline.ts` with the typed `buildActivityHeadline` function.
  - [ ] Write `apps/tournament-web/src/lib/activity-headline.test.ts` covering all 13 types × 3 surfaces (with merged assertions where surfaces share copy).
  - [ ] Migrate `tournament-toast.tsx` to call `buildActivityHeadline(row, 'toast')`. Verify existing T8-2 toast tests still pass without modification.
  - [ ] Migrate `tournament-banner.tsx` to call `buildActivityHeadline(row, 'banner')`. Verify existing T8-2 banner tests still pass.

- [ ] **Task 2 — ActivityFeed component (AC #1–#8).**
  - [ ] Write `apps/tournament-web/src/components/activity-feed.tsx` per Layer 1 — visibleCount state, slice rendering, Load more two-stage logic, icon table, route table, relative-time helper.
  - [ ] Write `apps/tournament-web/src/components/activity-feed.test.tsx` per Layer 4.

- [ ] **Task 3 — EventHomePage integration (AC #11).**
  - [ ] Add `<ActivityFeed />` below the entry cards in `apps/tournament-web/src/routes/events.$eventId.index.tsx`. Add the import line.
  - [ ] Update `events.$eventId.index.test.tsx` with the wiring assertion.

- [ ] **Task 4 — Regression sweep.**
  - [ ] `pnpm --filter @tournament/web test` — every previously-passing test still passes; +N new tests for feed + headline.
  - [ ] `pnpm -r typecheck` and `pnpm -r lint` — clean.

## Files this story will edit

- apps/tournament-web/src/components/activity-feed.tsx
- apps/tournament-web/src/components/activity-feed.test.tsx
- apps/tournament-web/src/lib/activity-headline.ts
- apps/tournament-web/src/lib/activity-headline.test.ts
- apps/tournament-web/src/components/tournament-toast.tsx
- apps/tournament-web/src/components/tournament-banner.tsx
- apps/tournament-web/src/routes/events.$eventId.index.tsx
- apps/tournament-web/src/routes/events.$eventId.index.test.tsx
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

## Dev Notes

### Architectural alignment

- **FR-C3 + FD-5** ("pull not push"): the feed is a passive consumer of the existing 5s-poll provider. No new push surface, no new fetch path beyond the provider's existing `loadMore()`.
- **T8-2 singleton invariant**: feed reads from context only. Verified at AC #1 — no useQuery, no fetch.
- **Live event prepend**: relies on T8-2's reactive `rows[]`. Feed test exercises this via stub-provider rows mutation.

### Key references

- **T8-2 provider**: `apps/tournament-web/src/providers/activity-feed-provider.tsx` — context value shape (rows, cursorBefore, loadMore, subscribe, isPolling, error). Feed consumes via `useActivityFeed()` hook from T8-2.
- **T8-2 stub-provider test pattern**: `apps/tournament-web/src/components/tournament-banner.test.tsx` lines 32-72 show the StubContext + `vi.mock('../hooks/use-activity-feed', ...)` pattern that the feed test will mirror.
- **EventHomePage**: `apps/tournament-web/src/routes/events.$eventId.index.tsx:223-245` — entry cards block; feed sits below.

### Risk acceptance

- **Player-name hydration deferred** to v1.5 (same posture as T8-2 toast/banner). Trip-day organizers can map UUIDs to names; not blocking.
- **Empty-state countdown deferred**: the epic AC mentioned "Round 1 begins {countdown}" but EventHomePage already renders the round countdown above this feed. Duplicating it in the feed surface is unnecessary; the simpler "Activity will show here once scoring starts." copy is sufficient.
- **Tap routing for `round.cancelled`**: no destination route makes sense for a cancelled round (the round-detail surface isn't a thing in this app). Renders as static text without Link. Acceptable for trip-day record-keeping.
- **Visible-count two-stage Load more**: the slice-then-backfill pattern means the user can repeatedly tap Load more to consume cached rows BEFORE any network round-trip happens. Network only fires when local cache is exhausted. Trip-day battery + Pinehurst-cell-spotty friendly.

### Followups

- **Player-name hydration** (v1.5) — unify across Toast / Banner / Feed via a shared lookup hook.
- **Empty-state countdown** (v1.5 polish) — duplicate the EventHomePage countdown into the feed's empty-state card if UX wants it more prominent.
- **Auto-Load-more on scroll** (v1.5) — current Load more is a manual button. Trip-day pull-out-of-pocket scenario favors the explicit button; v1.5 could add intersection-observer auto-loading.
- **Time-tick re-render** — relative time labels stale until next provider poll (5s). Acceptable for trip-day. v1.5 could add a 30s tick if "1m ago" lingering as "30s ago" becomes annoying.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Opus 4.7, 1M context)

### Debug Log References

### Completion Notes List

### File List
